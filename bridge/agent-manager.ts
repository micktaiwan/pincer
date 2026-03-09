import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync, appendFileSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentState } from "./types.js";
import { ASK_TIMEOUT_MS } from "./types.js";
import { log, logCost, extractText, parseJsonlString } from "./utils.js";

interface AgentManagerConfig {
  claudeBin: string;
  agentHome: string;
  mcpPort: number;
  maxAgents: number;
  agentTimeoutMs: number;
  sendTelegram: (text: string) => Promise<number>;
  logConversation: (role: "user" | "pincer", message: string) => void;
}

export interface AgentManager {
  spawn(task: string, options?: { timeoutMs?: number }): Promise<string>;
  spawnFollowUp(previousAgentId: string, userMessage: string): Promise<string>;
  continueAgent(labelOrId: string, userMessage: string): Promise<string>;
  kill(idOrLabel: string): boolean;
  killAll(): number;
  listActive(): AgentState[];
  get(id: string): AgentState | undefined;
  getAgentByMessageId(messageId: number): string | null;
  getAgentLogContent(agentId: string): string | null;
  resolveAsk(agentId: string, reply: string): void;
  drainPendingSummaries(): string | null;
  setLabel(agentId: string, label: string): void;
  sendMessage(agentId: string, text: string): Promise<number>;
  askUser(agentId: string, question: string): Promise<string>;
}

export function createAgentManager(config: AgentManagerConfig): AgentManager {
  const agents = new Map<string, AgentState>();
  const messageToAgent = new Map<number, string>();
  const pendingSummaries: string[] = [];
  let agentCounter = 0;

  const agentsDir = resolve(config.agentHome, "agents");
  mkdirSync(agentsDir, { recursive: true });

  function logAgent(agent: AgentState, type: string, data: Record<string, unknown>) {
    const entry = { ts: new Date().toISOString(), type, ...data };
    try { appendFileSync(agent.logFile, JSON.stringify(entry) + "\n"); } catch { /* best effort */ }
  }

  function readAgentLog(agent: AgentState): string {
    try {
      return readFileSync(agent.logFile, "utf-8").trim();
    } catch { return ""; }
  }

  function cleanupAgent(agentId: string) {
    // Clean up messageToAgent entries for this agent
    for (const [msgId, aId] of messageToAgent) {
      if (aId === agentId) messageToAgent.delete(msgId);
    }
    agents.delete(agentId);
  }

  function notifyDone(agent: AgentState, cachedLog: string) {
    const activeRemaining = [...agents.values()].filter(a => a.status === "working" || a.status === "waiting");
    if (activeRemaining.length === 0) {
      consolidateMemory();
    }
  }

  function consolidateMemory() {
    const finishedAgents = [...agents.values()].filter(a => a.status === "done" || a.status === "error");
    if (finishedAgents.length === 0) return;

    const logSummaries: string[] = [];
    for (const agent of finishedAgents) {
      const logContent = readAgentLog(agent);
      if (logContent) {
        logSummaries.push(`## Agent [${agent.label}]\n${logContent}`);
      }
    }

    if (logSummaries.length === 0) return;

    const prompt =
      "[System command — memory consolidation]\n" +
      "The following persistent agents have finished. Review their logs and update ~/.pincer/memory.md " +
      "with anything worth remembering (decisions, results, user preferences discovered). " +
      "Be concise — only add genuinely useful information.\n\n" +
      logSummaries.join("\n\n");

    log("info", "[agents] consolidating memory from finished agents");

    const child = spawn(config.claudeBin, [
      "-p", prompt,
      "--permission-mode", "bypassPermissions",
    ], {
      cwd: config.agentHome,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    child.stdin.end();

    child.stderr.on("data", (chunk: Buffer) => {
      log("error", `[agents consolidation stderr] ${chunk.toString().trim()}`);
    });

    child.on("close", (code) => {
      log("info", `[agents] memory consolidation ${code === 0 ? "done" : "failed"} (exit ${code})`);
      // Schedule cleanup of finished agents after 1 hour (keep them for follow-up replies)
      for (const agent of finishedAgents) {
        setTimeout(() => cleanupAgent(agent.id), 60 * 60 * 1000);
      }
    });

    child.on("error", (err) => {
      log("error", "[agents] memory consolidation spawn error:", err.message);
    });
  }

  function handleAgentExit(agentId: string, code: number | null) {
    const agent = agents.get(agentId);
    if (!agent) return;

    const wasError = code !== 0 && agent.status !== "done";
    agent.status = wasError ? "error" : "done";

    if (agent.pendingAsk) {
      clearTimeout(agent.pendingAsk.timer);
      agent.pendingAsk = null;
    }

    logAgent(agent, "exit", { code, status: agent.status });
    log("info", `[agent ${agent.label}] exited (code=${code}, status=${agent.status})`);

    // Build summary from agent's sent messages (read log once, reused by consolidateMemory)
    const logContent = readAgentLog(agent);
    if (logContent) {
      const entries = parseJsonlString(logContent);
      const sentMessages = entries
        .filter((e: Record<string, unknown>) => e.type === "sent")
        .map((e: Record<string, unknown>) => e.text as string);
      if (sentMessages.length > 0) {
        const summary = `[Agent ${agent.label}] ${sentMessages.join("\n\n")}`;
        config.logConversation("pincer", summary);
        // Cap at 5 pending summaries to avoid enormous prompts
        if (pendingSummaries.length < 5) {
          pendingSummaries.push(summary);
        }
      }
    }

    const doneMsg = wasError
      ? `[${agent.label}] Agent stopped with an error. Reply to continue.`
      : `[${agent.label}] Done.`;
    config.sendTelegram(doneMsg).then((msgId) => {
      if (msgId) messageToAgent.set(msgId, agentId);
    }).catch(() => {});

    notifyDone(agent, logContent);
  }

  return {
    async spawn(task: string, options?: { timeoutMs?: number }): Promise<string> {
      const effectiveTimeout = options?.timeoutMs ?? config.agentTimeoutMs;
      // Enforce max agents
      const active = [...agents.values()].filter(a => a.status === "working" || a.status === "waiting");
      if (active.length >= config.maxAgents) {
        throw new Error(`Max agents reached (${config.maxAgents})`);
      }

      const id = randomUUID().slice(0, 8);
      agentCounter++;
      const defaultLabel = `#${agentCounter}`;

      const agentDir = resolve(agentsDir, id);
      mkdirSync(agentDir, { recursive: true });

      const mcpConfig = {
        mcpServers: {
          "pincer-bridge": {
            type: "sse",
            url: `http://localhost:${config.mcpPort}/sse?agent=${id}`,
          },
        },
      };
      const mcpConfigPath = resolve(agentDir, "mcp.json");
      writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig));

      const logFilePath = resolve(agentDir, "agent.log");

      const agent: AgentState = {
        id,
        label: defaultLabel,
        process: null!,
        sessionId: null,
        status: "working",
        startedAt: Date.now(),
        pendingAsk: null,
        costUsd: 0,
        logFile: logFilePath,
      };

      const timeoutMinutes = Math.round((options?.timeoutMs ?? config.agentTimeoutMs) / 60000);
      const agentPrompt =
        `[System] You are a persistent agent. Your task:\n${task}\n\n` +
        `You have MCP tools to communicate with the user:\n` +
        `- mcp__pincer-bridge__set_label: call FIRST with a short label for your task (1-2 words)\n` +
        `- mcp__pincer-bridge__send_message: send progress updates\n` +
        `- mcp__pincer-bridge__ask_user: ask a question and wait for the answer\n\n` +
        `Important context:\n` +
        `- Your cwd is ~/.pincer/ (not the source repo). Use absolute paths for other projects.\n` +
        `- You have SSH access to remote servers. If something might be on a server, try SSH before searching local files.\n` +
        `- You have a ${timeoutMinutes}min active work timeout. Be efficient: try the simplest approach first.\n` +
        `- Avoid excessive exploration. If 3-5 searches don't find what you need, ask the user rather than running 50 more searches.\n\n` +
        `Start by calling set_label, then work on the task. Send progress updates. ` +
        `If blocked, ask the user. Don't give up — try alternative approaches. ` +
        `When done, send a final summary via send_message.`;

      const args = [
        "-p", agentPrompt,
        "--output-format", "stream-json",
        "--verbose",
        "--permission-mode", "bypassPermissions",
        "--mcp-config", mcpConfigPath,
      ];

      log("info", `[agent ${defaultLabel}] spawning for task: ${task.slice(0, 100)}`);

      const child = spawn(config.claudeBin, args, {
        cwd: config.agentHome,
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env,
      });

      child.stdin.end();
      agent.process = child;
      agents.set(id, agent);

      logAgent(agent, "spawn", { task });

      let buffer = "";
      child.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);

            if (data.type === "system" && data.subtype === "init" && data.session_id) {
              agent.sessionId = data.session_id;
              log("info", `[agent ${agent.label}] session: ${agent.sessionId}`);
            }

            if (data.type === "assistant") {
              const blocks = data.message?.content || [];
              for (const b of blocks) {
                if (b.type === "tool_use") {
                  logAgent(agent, "tool_use", { name: b.name, input: b.input });
                }
              }
              const text = extractText(blocks);
              if (text) {
                logAgent(agent, "assistant_text", { text });
              }
            }

            if (data.type === "result" && data.subtype !== "error" && data.subtype !== "error_during_execution") {
              const costUsd = Number(data.total_cost_usd ?? 0);
              agent.costUsd = costUsd;
              logCost(costUsd, data.duration_ms ?? 0, data.duration_api_ms ?? 0, agent.sessionId);

              const blocks = data.result?.content || data.content || [];
              const text = extractText(blocks);
              if (text) {
                config.sendTelegram(`[${agent.label}] ${text}`).catch(() => {});
              }
              agent.status = "done";
            }

            if (data.type === "result" && (data.subtype === "error" || data.subtype === "error_during_execution")) {
              log("error", `[agent ${agent.label}] error result:`, data.error || data.result?.error);
            }
          } catch {
            // skip non-JSON
          }
        }
      });

      child.stderr.on("data", (chunk: Buffer) => {
        log("error", `[agent ${agent.label} stderr] ${chunk.toString().trim()}`);
      });

      child.on("close", (code) => handleAgentExit(id, code));

      child.on("error", (err) => {
        log("error", `[agent ${agent.label}] spawn error:`, err.message);
        agent.status = "error";
        notifyDone(agent, "");
      });

      // Agent work timeout — tracks cumulative active work time (paused while waiting)
      let activeTimeMs = 0;
      let workStartedAt = Date.now();
      let wasWorking = true;
      const timeoutTimer = setInterval(() => {
        if (agent.status !== "working" && agent.status !== "waiting") {
          clearInterval(timeoutTimer);
          return;
        }
        const isWorking = agent.status === "working";
        if (isWorking && !wasWorking) {
          workStartedAt = Date.now();
        } else if (!isWorking && wasWorking) {
          activeTimeMs += Date.now() - workStartedAt;
        }
        wasWorking = isWorking;

        const totalActive = isWorking ? activeTimeMs + (Date.now() - workStartedAt) : activeTimeMs;
        if (totalActive >= effectiveTimeout) {
          log("info", `[agent ${agent.label}] timed out after ${Math.round(totalActive / 1000)}s of active work (limit: ${Math.round(effectiveTimeout / 1000)}s)`);
          clearInterval(timeoutTimer);
          agent.status = "done"; // Mark done before kill to prevent double notification in handleAgentExit
          child.kill();
          config.sendTelegram(`[${agent.label}] Agent timed out (${Math.round(effectiveTimeout / 60000)}min limit). Reply to continue.`).then((msgId) => {
            if (msgId) messageToAgent.set(msgId, agentId);
          }).catch(() => {});
        }
      }, 5000);

      return id;
    },

    kill(idOrLabel: string): boolean {
      let agent: AgentState | undefined;
      agent = agents.get(idOrLabel);
      if (!agent) {
        for (const a of agents.values()) {
          if (a.label.toLowerCase() === idOrLabel.toLowerCase() && (a.status === "working" || a.status === "waiting")) {
            agent = a;
            break;
          }
        }
      }

      if (!agent || (agent.status !== "working" && agent.status !== "waiting")) {
        return false;
      }

      log("info", `[agent ${agent.label}] killing`);

      if (agent.pendingAsk) {
        clearTimeout(agent.pendingAsk.timer);
        agent.pendingAsk = null;
      }

      agent.status = "done";
      agent.process.kill("SIGTERM");

      setTimeout(() => {
        try { agent!.process.kill("SIGKILL"); } catch { /* already dead */ }
      }, 5000);

      logAgent(agent, "killed", {});
      return true;
    },

    killAll(): number {
      let count = 0;
      for (const agent of agents.values()) {
        if (agent.status === "working" || agent.status === "waiting") {
          if (agent.pendingAsk) {
            clearTimeout(agent.pendingAsk.timer);
            agent.pendingAsk = null;
          }
          agent.status = "done";
          agent.process.kill("SIGTERM");
          logAgent(agent, "killed", { reason: "killAll" });
          count++;
        }
      }
      return count;
    },

    listActive(): AgentState[] {
      return [...agents.values()].filter(a => a.status === "working" || a.status === "waiting");
    },

    get(id: string): AgentState | undefined {
      return agents.get(id);
    },

    getAgentByMessageId(messageId: number): string | null {
      return messageToAgent.get(messageId) ?? null;
    },

    getAgentLogContent(agentId: string): string | null {
      const agent = agents.get(agentId);
      if (!agent) return null;
      const content = readAgentLog(agent);
      return content || null;
    },

    async spawnFollowUp(previousAgentId: string, userMessage: string): Promise<string> {
      const previousAgent = agents.get(previousAgentId);
      if (!previousAgent) throw new Error("Previous agent not found");

      const logContent = this.getAgentLogContent(previousAgentId);
      const task =
        `[System] This is a follow-up to a previous agent task [${previousAgent.label}].\n` +
        `Here is the previous agent's log for context:\n\n${logContent}\n\n` +
        `The user replied with: ${userMessage}`;

      return this.spawn(task);
    },

    async continueAgent(labelOrId: string, userMessage: string): Promise<string> {
      // First try to find agent in memory (active or recently finished)
      let agentId: string | undefined;
      let label: string | undefined;
      let logContent: string | undefined;

      for (const [id, a] of agents) {
        if (a.label.toLowerCase() === labelOrId.toLowerCase() || id.startsWith(labelOrId)) {
          agentId = id;
          label = a.label;
          logContent = readAgentLog(a);
          break;
        }
      }

      // If not in memory, scan agent dirs on disk
      if (!logContent) {
        const dirs = (() => { try { return readdirSync(agentsDir); } catch { return []; } })();
        for (const dir of dirs) {
          const logPath = resolve(agentsDir, dir, "agent.log");
          try {
            const content = readFileSync(logPath, "utf-8").trim();
            if (!content) continue;
            // Check if this agent's label matches (parse first set_label entry)
            const labelMatch = content.match(/"type":"set_label".*?"to":"([^"]+)"/);
            const dirLabel = labelMatch?.[1];
            if (dirLabel?.toLowerCase() === labelOrId.toLowerCase() || dir.startsWith(labelOrId)) {
              agentId = dir;
              label = dirLabel || dir;
              logContent = content;
              break;
            }
          } catch { continue; }
        }
      }

      if (!logContent) throw new Error(`No agent found matching "${labelOrId}"`);

      const task =
        `[System] This is a continuation of a previous agent task [${label}].\n` +
        `Here is the previous agent's log for context:\n\n${logContent}\n\n` +
        `The user says: ${userMessage}`;

      return this.spawn(task);
    },

    resolveAsk(agentId: string, reply: string) {
      const agent = agents.get(agentId);
      if (!agent?.pendingAsk) return;

      clearTimeout(agent.pendingAsk.timer);
      agent.pendingAsk.resolve(reply);
      agent.pendingAsk = null;
      agent.status = "working";
      logAgent(agent, "received", { text: reply });
    },

    setLabel(agentId: string, label: string) {
      const agent = agents.get(agentId);
      if (agent) {
        const oldLabel = agent.label;
        agent.label = label;
        logAgent(agent, "set_label", { from: oldLabel, to: label });
        log("info", `[agent] label changed: ${oldLabel} → ${label}`);
      }
    },

    async sendMessage(agentId: string, text: string): Promise<number> {
      const agent = agents.get(agentId);
      const label = agent?.label || "?";
      const prefixed = `[${label}] ${text}`;
      const messageId = await config.sendTelegram(prefixed);
      messageToAgent.set(messageId, agentId);
      if (agent) logAgent(agent, "sent", { text });
      return messageId;
    },

    async askUser(agentId: string, question: string): Promise<string> {
      const agent = agents.get(agentId);
      if (!agent) throw new Error("Agent not found");

      const label = agent.label;
      const prefixed = `[${label}] ${question}`;
      const messageId = await config.sendTelegram(prefixed);
      messageToAgent.set(messageId, agentId);

      agent.status = "waiting";
      logAgent(agent, "ask", { question });

      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          agent.pendingAsk = null;
          agent.status = "working";
          reject(new Error("Timeout: no reply after 30 minutes"));
        }, ASK_TIMEOUT_MS);

        agent.pendingAsk = { messageId, resolve, timer };
      });
    },

    drainPendingSummaries(): string | null {
      if (pendingSummaries.length === 0) return null;
      return pendingSummaries.splice(0).join("\n\n");
    },
  };
}
