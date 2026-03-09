import { Bot } from "grammy";
import { spawn, execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, renameSync, statSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  agentHome, logFile, costsFile, convFile,
  log, logCost, extractText, ClaudeError,
  parseJsonl, formatDuration, logConversation, getRecentConversation, dateFormatter,
} from "./utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env");

// Ensure agent runtime directory exists
mkdirSync(agentHome, { recursive: true });

// Resolve claude binary path at startup (Node's PATH may not include homebrew/nvm dirs)
let claudeBin = "claude";
try {
  claudeBin = execSync("which claude", { encoding: "utf8" }).trim();
  log("info", `[init] claude binary: ${claudeBin}`);
} catch {
  log("error", "[init] 'claude' not found in PATH, spawn will likely fail");
}

// Load .env manually (no extra dependency)
const env: Record<string, string> = {};
for (const line of readFileSync(envPath, "utf-8").split("\n")) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) env[match[1].trim()] = match[2].trim();
}

const token = env.TELEGRAM_BOT_TOKEN;
const allowedChatId = env.TELEGRAM_CHAT_ID;

if (!token) {
  log("error", "TELEGRAM_BOT_TOKEN missing in .env");
  process.exit(1);
}

const bot = new Bot(token);

const projectDir = resolve(__dirname, "..");
const agentDir = resolve(projectDir, "agent");

// Copy agent files to runtime dir.
for (const file of ["CLAUDE.md", "meta.md"]) {
  const src = resolve(agentDir, file);
  if (existsSync(src)) {
    copyFileSync(src, resolve(agentHome, file));
    log("info", `[init] copied agent/${file} to ${agentHome}`);
  }
}

// Seed default personal config from .example templates if missing.
let needsSetup = false;
for (const file of ["personality.md", "tools.md"]) {
  const dest = resolve(agentHome, file);
  if (!existsSync(dest)) {
    const example = resolve(agentDir, `${file}.example`);
    if (existsSync(example)) {
      let content = readFileSync(example, "utf-8");
      content = content.replace("/path/to/your/pincer/clone/", projectDir + "/");
      writeFileSync(dest, content);
      log("info", `[init] seeded ${file} from example template`);
      if (file === "personality.md") needsSetup = true;
    }
  }
}

// Session ID for conversation continuity (persisted to disk)
const sessionFile = resolve(agentHome, ".session");
let sessionId: string | null = null;

try {
  if (existsSync(sessionFile)) {
    sessionId = readFileSync(sessionFile, "utf-8").trim() || null;
    if (sessionId) log("info", `[init] resumed session: ${sessionId}`);
  }
} catch { /* start fresh */ }

function saveSession() {
  try {
    writeFileSync(sessionFile, sessionId || "");
  } catch { /* best effort */ }
}

function claude(prompt: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const args = ["-p", prompt, "--output-format", "stream-json", "--verbose", "--permission-mode", "bypassPermissions"];
    if (sessionId) {
      args.push("--resume", sessionId);
    }

    log("info", `[claude] spawn ${sessionId ? `(resume ${sessionId})` : "(new session)"}`);

    const child = spawn(claudeBin, args, {
      cwd: agentHome,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    child.stdin.end();

    let buffer = "";
    let resultText = "";
    let killed = false;

    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          if (data.type === "system" && data.subtype === "init" && data.session_id) {
            sessionId = data.session_id;
            saveSession();
            log("info", `[claude] session: ${sessionId}`);
          }
          if (data.type === "assistant") {
            const blocks = data.message?.content || [];
            for (const b of blocks) {
              if (b.type === "tool_use") {
                log("info", `[claude] tool_use: ${b.name} ${JSON.stringify(b.input)}`);
              }
            }
            const text = extractText(blocks);
            if (text) resultText = text;
          }
          if (data.type === "tool_result") {
            const status = data.is_error ? "error" : "ok";
            log("info", `[claude] tool_result (${status}): ${String(data.tool_use_id || "").slice(0, 20)}`);
          }
          if (data.type === "result" && data.subtype !== "error" && data.subtype !== "error_during_execution") {
            const blocks = data.result?.content || data.content || [];
            const text = extractText(blocks);
            if (text) resultText = text;
            const costUsd = Number(data.total_cost_usd ?? 0);
            logCost(costUsd, data.duration_ms ?? 0, data.duration_api_ms ?? 0, sessionId);
          }
          if (data.type === "result" && (data.subtype === "error" || data.subtype === "error_during_execution")) {
            log("error", "[claude] error result:", data.error || data.result?.error);
          }
        } catch {
          // skip non-JSON lines
        }
      }
    });

    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      log("error", `[claude stderr] ${text.trim()}`);
    });

    child.on("close", (code) => {
      if (buffer.trim()) {
        try {
          const data = JSON.parse(buffer.trim());
          if (data.type === "assistant") {
            const blocks = data.message?.content || [];
            const text = extractText(blocks);
            if (text) resultText = text;
          }
          if (data.type === "result" && data.subtype !== "error" && data.subtype !== "error_during_execution") {
            const blocks = data.result?.content || data.content || [];
            const text = extractText(blocks);
            if (text) resultText = text;
          }
        } catch { /* skip */ }
      }

      if (code !== 0 || killed) {
        log("error", `[claude exit] code=${code} killed=${killed}`, stderr);
        reject(new ClaudeError(`claude exited with code ${code}`, killed));
        return;
      }
      log("info", `[claude exit] code=0 (response: ${resultText.length} chars)`);
      resolvePromise(resultText.trim());
    });

    child.on("error", (err) => {
      log("error", "[claude spawn error]", err.message);
      reject(new ClaudeError(err.message));
    });

    setTimeout(() => {
      killed = true;
      child.kill();
    }, 120_000);
  });
}

// Tracking for /status
const startedAt = Date.now();
let messageCount = 0;
let lastMessageAt: number | null = null;

// Import agent manager and MCP server (lazy — loaded after bot is created)
import { createAgentManager } from "./agent-manager.js";
import { createMcpServer } from "./mcp-server.js";
import { routeMessage } from "./message-router.js";
import { MCP_PORT, MAX_AGENTS, AGENT_TIMEOUT_MS } from "./types.js";

const mcpPort = Number(env.MCP_PORT) || MCP_PORT;
const maxAgents = Number(env.MAX_AGENTS) || MAX_AGENTS;
const agentTimeoutMs = Number(env.AGENT_TIMEOUT_MS) || AGENT_TIMEOUT_MS;

const agentManager = createAgentManager({
  claudeBin,
  agentHome,
  mcpPort,
  maxAgents,
  agentTimeoutMs,
  sendTelegram: async (text: string) => {
    if (allowedChatId) {
      const sent = await bot.api.sendMessage(allowedChatId, text);
      return sent.message_id;
    }
    return 0;
  },
  logConversation,
});

const mcpServer = createMcpServer({
  port: mcpPort,
  agentManager,
  log,
});

bot.on("message:text", async (ctx) => {
  if (allowedChatId && String(ctx.chat.id) !== allowedChatId) {
    log("info", `[ignored] message from chat ${ctx.chat.id}`);
    return;
  }

  const text = ctx.message.text;
  log("info", `[message] ${text}`);

  // /status — bridge health check
  if (/^\/status(@\w+)?(\s+deep)?$/i.test(text.trim())) {
    const isDeep = /deep$/i.test(text.trim());
    const uptimeStr = formatDuration(Math.floor((Date.now() - startedAt) / 1000));

    const fileSize = (path: string): string => {
      try {
        const bytes = statSync(path).size;
        return bytes < 1024 ? `${bytes}B` : `${(bytes / 1024).toFixed(1)}KB`;
      } catch { return "—"; }
    };

    const lastActivityStr = lastMessageAt
      ? formatDuration(Math.floor((Date.now() - lastMessageAt) / 1000)) + " ago"
      : "—";

    const archiveCount = (() => {
      try {
        return readdirSync(agentHome).filter(f => f.startsWith("conversations-") && f.endsWith(".jsonl")).length;
      } catch { return 0; }
    })();

    const activeAgents = agentManager.listActive();

    const lines = [
      `Uptime: ${uptimeStr}`,
      `Session: ${sessionId ? sessionId.slice(0, 8) + "…" : "none"}`,
      `Messages this session: ${messageCount}`,
      `Last activity: ${lastActivityStr}`,
      `Active agents: ${activeAgents.length}`,
      `memory.md: ${fileSize(resolve(agentHome, "memory.md"))}`,
      `personality.md: ${fileSize(resolve(agentHome, "personality.md"))}`,
      `tools.md: ${fileSize(resolve(agentHome, "tools.md"))}`,
      `conversations.jsonl: ${fileSize(convFile)}`,
      `Conversation archives: ${archiveCount}`,
      `bridge.log: ${fileSize(logFile)}`,
      `Claude: ${claudeBin}`,
    ];

    if (activeAgents.length > 0) {
      lines.push("");
      lines.push("Agents:");
      for (const a of activeAgents) {
        const elapsed = formatDuration(Math.floor((Date.now() - a.startedAt) / 1000));
        lines.push(`  [${a.label}] ${a.status} (${elapsed})`);
      }
    }

    await ctx.reply(lines.join("\n"));

    if (isDeep) {
      await ctx.reply("Deeper check in progress…");
      await ctx.replyWithChatAction("typing");
      try {
        const diagnosticPrompt =
          "[System command — diagnostic mode]\n" +
          "Run a quick health check. Read the following files and report:\n\n" +
          "1. ~/.pincer/memory.md — summarize what's stored (topics, size, anything stale)\n" +
          "2. ~/.pincer/personality.md — is it configured or still placeholder?\n" +
          "3. ~/.pincer/tools.md — is it configured? any broken paths?\n" +
          "4. ~/.pincer/bridge.log — read the last 50 lines, report any errors or warnings\n" +
          "5. ~/.pincer/conversations.jsonl — how many entries? when was the first/last?\n\n" +
          "Format: short bullet points per section. Flag anything that looks wrong.\n" +
          "Do NOT fix anything — just report.";
        const diagnostic = await claude(diagnosticPrompt);
        if (diagnostic) {
          await ctx.reply(diagnostic);
        }
      } catch (err) {
        log("error", "[/status] diagnostic failed:", (err as Error).message);
        await ctx.reply("Diagnostic failed — check bridge.log for details.");
      }
    }
    return;
  }

  // /cost — spending summary
  if (/^\/cost(@\w+)?$/i.test(text.trim())) {
    try {
      const entries = parseJsonl(costsFile);
      if (entries.length === 0) {
        await ctx.reply("No cost data yet.");
        return;
      }

      const now = new Date();
      const todayStr = now.toISOString().slice(0, 10);
      const weekAgo = new Date(now.getTime() - 7 * 86400000);
      const monthStr = now.toISOString().slice(0, 7);

      let totalAll = 0, totalToday = 0, totalWeek = 0, totalMonth = 0;
      let countAll = 0, countToday = 0;
      for (const e of entries) {
        const cost = e.cost_usd ?? 0;
        totalAll += cost;
        countAll++;
        if (e.ts?.startsWith(todayStr)) { totalToday += cost; countToday++; }
        if (e.ts && new Date(e.ts) >= weekAgo) totalWeek += cost;
        if (e.ts?.startsWith(monthStr)) totalMonth += cost;
      }

      const fmt = (n: number) => `$${n.toFixed(2)}`;
      const first = entries[0]?.ts?.slice(0, 10) ?? "?";
      const costLines = [
        `Today: ${fmt(totalToday)} (${countToday} calls)`,
        `Last 7 days: ${fmt(totalWeek)}`,
        `This month: ${fmt(totalMonth)}`,
        `All time: ${fmt(totalAll)} (${countAll} calls, since ${first})`,
      ];
      await ctx.reply(costLines.join("\n"));
    } catch (err) {
      log("error", "[/cost] failed:", (err as Error).message);
      await ctx.reply("Failed to read cost data.");
    }
    return;
  }

  // /agents — list active persistent agents
  if (/^\/agents(@\w+)?$/i.test(text.trim())) {
    const active = agentManager.listActive();
    if (active.length === 0) {
      await ctx.reply("No active agents.");
    } else {
      const lines = active.map(a => {
        const elapsed = formatDuration(Math.floor((Date.now() - a.startedAt) / 1000));
        return `[${a.label}] ${a.status} — ${elapsed} — $${a.costUsd.toFixed(3)}`;
      });
      await ctx.reply(lines.join("\n"));
    }
    return;
  }

  // /kill — stop a persistent agent
  const killMatch = text.trim().match(/^\/kill(@\w+)?\s+(.+)$/i);
  if (killMatch) {
    const target = killMatch[2].trim();
    if (target.toLowerCase() === "all") {
      const killed = agentManager.killAll();
      await ctx.reply(killed > 0 ? `Killed ${killed} agent(s).` : "No active agents.");
    } else {
      const success = agentManager.kill(target);
      await ctx.reply(success ? `Agent [${target}] killed.` : `No agent found with label or id "${target}".`);
    }
    return;
  }

  // /continue <label> [message] — resume a finished/timed-out agent
  // Label can be quoted ("Email Setup") or unquoted single word (c78345fd)
  const continueMatch = text.trim().match(/^\/continue(@\w+)?\s+(?:["«\u201c]([^"»\u201d]+)["»\u201d]|(\S+))(?:\s+([\s\S]+))?$/i);
  if (continueMatch) {
    const labelOrId = (continueMatch[2] || continueMatch[3] || "").trim();
    const userMessage = continueMatch[4]?.trim() || "Continue where you left off.";
    const active = agentManager.listActive();
    if (active.length >= maxAgents) {
      await ctx.reply(`${active.length} agents already running (max ${maxAgents}). Use /kill to stop one first.`);
      return;
    }

    logConversation("user", text);
    try {
      const agentId = await agentManager.continueAgent(labelOrId, userMessage);
      const agent = agentManager.get(agentId);
      await ctx.reply(`Follow-up agent [${agent?.label || agentId.slice(0, 6)}] spawned.`);
    } catch (err) {
      log("error", "[/continue] failed:", (err as Error).message);
      await ctx.reply((err as Error).message);
    }
    return;
  }

  messageCount++;
  lastMessageAt = Date.now();

  // /new — save memory + reset session + kill all agents
  if (/^\/new(@\w+)?$/i.test(text.trim())) {
    log("info", "[/new] starting memory save + session reset");

    // Kill all running agents first
    const killedCount = agentManager.killAll();
    if (killedCount > 0) {
      log("info", `[/new] killed ${killedCount} agent(s)`);
    }

    try {
      await ctx.api.setMessageReaction(ctx.chat.id, ctx.message.message_id, [{ type: "emoji", emoji: "👀" }]);
    } catch (err) {
      log("error", "[reaction] failed to set 👀:", (err as Error).message);
    }
    await ctx.replyWithChatAction("typing");

    let memoryResponse = "";
    if (sessionId) {
      try {
        memoryResponse = await claude(
          "[System command] Your session is about to be reset. " +
          "Re-read ~/.pincer/memory.md and update it if this conversation contains anything worth remembering. " +
          "Reply only with what you saved, or 'Nothing to save' if nothing notable."
        );
      } catch (err) {
        log("error", "[/new] memory save failed:", (err as Error).message);
        memoryResponse = "(memory save error)";
      }
    } else {
      memoryResponse = "No active session";
    }

    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const archivePath = resolve(agentHome, `conversations-${ts}.jsonl`);
    try {
      renameSync(convFile, archivePath);
      log("info", `[/new] archived conversations → ${archivePath}`);
    } catch {
      // No file to archive
    }

    sessionId = null;
    messageCount = 0;
    saveSession();
    log("info", "[/new] session reset");

    const reply = `${memoryResponse}\n\nSession reset.`;
    logConversation("user", "/new");
    logConversation("pincer", reply);
    await ctx.reply(reply);
    try {
      await ctx.api.setMessageReaction(ctx.chat.id, ctx.message.message_id, []);
    } catch (err) {
      log("error", "[reaction] failed to clear reaction:", (err as Error).message);
    }
    return;
  }

  // /agent [--timeout Nm|h] <prompt> — spawn a persistent agent
  const agentMatch = text.trim().match(/^\/agent(@\w+)?\s+(.+)$/is);
  if (agentMatch) {
    let task = agentMatch[2].trim();
    let timeoutMs: number | undefined;

    // Parse --timeout flag (e.g., --timeout 20m, --timeout 1h)
    const timeoutMatch = task.match(/^--timeout\s+(\d+)(m|h)\s+(.+)$/is);
    if (timeoutMatch) {
      const value = parseInt(timeoutMatch[1]);
      const unit = timeoutMatch[2].toLowerCase();
      timeoutMs = unit === "h" ? value * 60 * 60 * 1000 : value * 60 * 1000;
      task = timeoutMatch[3].trim();
    }

    const active = agentManager.listActive();
    if (active.length >= maxAgents) {
      await ctx.reply(`${active.length} agents already running (max ${maxAgents}). Use /kill to stop one first.`);
      return;
    }

    logConversation("user", text);
    try {
      const agentId = await agentManager.spawn(task, timeoutMs ? { timeoutMs } : undefined);
      const agent = agentManager.get(agentId);
      const timeoutInfo = timeoutMs ? ` (timeout: ${Math.round(timeoutMs / 60000)}min)` : "";
      await ctx.reply(`Agent [${agent?.label || agentId.slice(0, 6)}] spawned.${timeoutInfo}`);
    } catch (err) {
      log("error", "[/agent] spawn failed:", (err as Error).message);
      await ctx.reply("Failed to spawn agent — check bridge.log.");
    }
    return;
  }

  // Try to route to a waiting agent (reply-to or single-waiting)
  const routed = routeMessage({
    text,
    replyToMessageId: ctx.message.reply_to_message?.message_id ?? null,
    agentManager,
    log,
  });

  if (routed.action === "routed") {
    // Message was delivered to a waiting agent
    return;
  }

  if (routed.action === "follow-up") {
    // User replied to a finished agent's message — spawn a new agent with old context
    const active = agentManager.listActive();
    if (active.length >= maxAgents) {
      await ctx.reply(`${active.length} agents already running (max ${maxAgents}). Use /kill to stop one first.`);
      return;
    }
    try {
      const newId = await agentManager.spawnFollowUp(routed.agentId, text);
      const agent = agentManager.get(newId);
      await ctx.reply(`Follow-up agent [${agent?.label || newId.slice(0, 6)}] spawned.`);
    } catch (err) {
      log("error", "[follow-up] spawn failed:", (err as Error).message);
      await ctx.reply("Failed to spawn follow-up agent — check bridge.log.");
    }
    return;
  }

  if (routed.action === "ambiguous") {
    const waiting = agentManager.listActive().filter(a => a.status === "waiting");
    const labels = waiting.map(a => `[${a.label}]`).join(", ");
    await ctx.reply(`Multiple agents are waiting: ${labels}. Reply to the specific message to answer.`);
    return;
  }

  // Regular conversational flow
  const now = dateFormatter.format(new Date());
  let prompt = `[${now}]\n`;

  // Inject pending agent summaries so the session knows what agents did
  const agentSummaries = agentManager.drainPendingSummaries();
  if (agentSummaries) {
    prompt += `[System — recent agent activity for context]\n${agentSummaries}\n\n[User message]\n`;
  }

  prompt += text;

  if (needsSetup) {
    prompt = `[System] This is a fresh install. personality.md contains placeholder values. ` +
      `Before responding to the user's message, ask them for a name, language, and preferred tone for this agent. ` +
      `Then write personality.md with their answers. Keep it short — 3 questions max.\n\n${prompt}`;
    needsSetup = false;
  }

  logConversation("user", text);

  try {
    await ctx.api.setMessageReaction(ctx.chat.id, ctx.message.message_id, [{ type: "emoji", emoji: "👀" }]);
  } catch (err) {
    log("error", "[reaction] failed to set 👀:", (err as Error).message);
  }

  await ctx.replyWithChatAction("typing");

  try {
    let response: string;
    try {
      response = await claude(prompt);
    } catch (err) {
      const claudeErr = err instanceof ClaudeError ? err : null;

      if (sessionId) {
        log("info", `[bridge] retry 1 — same session (${claudeErr?.isTimeout ? "timeout" : "error"})`);
        try {
          response = await claude(prompt);
        } catch {
          log("info", "[bridge] retry 2 — fresh session with context recovery");
          const history = getRecentConversation();
          sessionId = null;
          saveSession();
          const contextPrompt = history
            ? `[System note: your previous session crashed (${claudeErr?.isTimeout ? "timeout — likely a system popup that blocked the terminal" : "unknown error"}). Here is recent conversation history for context:\n\n${history}\n\nThe user's last message was:]\n\n${text}`
            : text;
          log("info", `[bridge] context recovery prompt (${contextPrompt.length} chars): ${contextPrompt}`);
          response = await claude(contextPrompt);
        }
      } else {
        log("info", "[bridge] no session to retry — fresh start");
        response = await claude(prompt);
      }
    }
    if (response) {
      logConversation("pincer", response);
      await ctx.reply(response);
    } else {
      logConversation("pincer", "(no response)");
      await ctx.reply("(no response)");
    }
    try {
      await ctx.api.setMessageReaction(ctx.chat.id, ctx.message.message_id, []);
    } catch (err) {
      log("error", "[reaction] failed to clear reaction:", (err as Error).message);
    }
  } catch (err) {
    logConversation("pincer", "(error after all retries)");
    await ctx.reply("Sorry, I had a technical issue and couldn't recover. Please try again in a moment.");
  }
});

bot.catch((err) => {
  log("error", "[bot error]", err.message);
});

// Register bot commands for Telegram autocompletion
await bot.api.setMyCommands([
  { command: "new", description: "Save memory and reset session" },
  { command: "status", description: "Bridge health check" },
  { command: "cost", description: "Spending summary" },
  { command: "agent", description: "Spawn a persistent agent for a task" },
  { command: "agents", description: "List active persistent agents" },
  { command: "kill", description: "Stop an agent (label or 'all')" },
  { command: "continue", description: "Resume a finished/timed-out agent" },
]);

// Start MCP server
mcpServer.start();

log("info", "Pincer bridge started — listening for Telegram messages...");
bot.start();

// Notify on Telegram that the bridge is back online
if (allowedChatId) {
  bot.api.sendMessage(allowedChatId, "Back online ✅").then(() => {
    log("info", "[init] startup notification sent");
  }).catch((err) => {
    log("error", "[init] failed to send startup notification:", (err as Error).message);
  });
}
