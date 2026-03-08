import { Bot } from "grammy";
import { spawn, execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, appendFileSync, renameSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env");

// Agent runtime directory — separate from the source repo
const agentHome = resolve(homedir(), ".pincer");
mkdirSync(agentHome, { recursive: true });

// Persistent log file
const logFile = resolve(agentHome, "bridge.log");

function log(level: "info" | "error", ...args: unknown[]) {
  const timestamp = new Date().toISOString();
  const message = args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ");
  const line = `[${timestamp}] [${level}] ${message}\n`;
  const consoleFn = level === "error" ? console.error : console.log;
  consoleFn(message);
  try { appendFileSync(logFile, line); } catch { /* best effort */ }
}

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
// Only CLAUDE.md and meta.md are copied here. personality.md and tools.md are
// personal config that lives in ~/.pincer/ — the agent reads them via the Read
// tool when needed (referenced from CLAUDE.md). This lets the user (or the
// agent itself) edit them directly without any assembly step.
for (const file of ["CLAUDE.md", "meta.md"]) {
  const src = resolve(agentDir, file);
  if (existsSync(src)) {
    copyFileSync(src, resolve(agentHome, file));
    log("info", `[init] copied agent/${file} to ${agentHome}`);
  }
}

// Seed default personal config from .example templates if missing.
// These files are never overwritten — the user (or agent) owns them.
let needsSetup = false;
for (const file of ["personality.md", "tools.md"]) {
  const dest = resolve(agentHome, file);
  if (!existsSync(dest)) {
    const example = resolve(agentDir, `${file}.example`);
    if (existsSync(example)) {
      let content = readFileSync(example, "utf-8");
      // Auto-fill the source code path so the agent can find its own repo
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

function extractText(blocks: any[]): string {
  return blocks.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
}

class ClaudeError extends Error {
  constructor(message: string, public readonly isTimeout: boolean = false) {
    super(message);
  }
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
          // Capture session ID from init
          if (data.type === "system" && data.subtype === "init" && data.session_id) {
            sessionId = data.session_id;
            saveSession();
            log("info", `[claude] session: ${sessionId}`);
          }
          // Log tool usage
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
          // Log tool results
          if (data.type === "tool_result") {
            const status = data.is_error ? "error" : "ok";
            log("info", `[claude] tool_result (${status}): ${String(data.tool_use_id || "").slice(0, 20)}`);
          }
          // Capture result text (final)
          if (data.type === "result" && data.subtype !== "error" && data.subtype !== "error_during_execution") {
            const blocks = data.result?.content || data.content || [];
            const text = extractText(blocks);
            if (text) resultText = text;
            log("info", `[claude] cost: $${Number(data.total_cost_usd ?? 0).toFixed(2)} duration: ${data.duration_ms}ms (api: ${data.duration_api_ms}ms)`);
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
      // Process remaining buffer
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

// Structured conversation log for context recovery
const convFile = resolve(agentHome, "conversations.jsonl");

function logConversation(role: "user" | "pincer", message: string) {
  const entry = { ts: new Date().toISOString(), role, message };
  try { appendFileSync(convFile, JSON.stringify(entry) + "\n"); } catch { /* best effort */ }
}

function getRecentConversation(maxEntries = 20): string {
  try {
    const content = readFileSync(convFile, "utf-8");
    const entries = content.trim().split("\n")
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean)
      .slice(-maxEntries);
    return entries.map((e: { role: string; message: string }) =>
      `${e.role === "user" ? "user" : "Pincer"}: ${e.message}`
    ).join("\n\n");
  } catch {
    return "";
  }
}

const dateFormatter = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", dateStyle: "full", timeStyle: "short" });

bot.on("message:text", async (ctx) => {
  // Only respond to allowed chat
  if (allowedChatId && String(ctx.chat.id) !== allowedChatId) {
    log("info", `[ignored] message from chat ${ctx.chat.id}`);
    return;
  }

  const text = ctx.message.text;
  log("info", `[message] ${text}`);

  // /new — save memory + reset session
  if (/^\/new(@\w+)?$/i.test(text.trim())) {
    log("info", "[/new] starting memory save + session reset");
    try {
      await ctx.api.setMessageReaction(ctx.chat.id, ctx.message.message_id, [{ type: "emoji", emoji: "👀" }]);
    } catch (err) {
      log("error", "[reaction] failed to set 👀:", (err as Error).message);
    }
    await ctx.replyWithChatAction("typing");

    let memoryResponse = "";
    // Step 1: ask current session to save anything important to memory
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

    // Step 2: archive conversations.jsonl
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const archivePath = resolve(agentHome, `conversations-${ts}.jsonl`);
    try {
      renameSync(convFile, archivePath);
      log("info", `[/new] archived conversations → ${archivePath}`);
    } catch {
      // No file to archive — that's fine
    }

    // Step 3: clear session
    sessionId = null;
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

  const now = dateFormatter.format(new Date());
  let prompt = `[${now}]\n${text}`;

  // First-run: inject setup prompt before the user's first message
  if (needsSetup) {
    prompt = `[System] This is a fresh install. personality.md contains placeholder values. ` +
      `Before responding to the user's message, ask them for a name, language, and preferred tone for this agent. ` +
      `Then write personality.md with their answers. Keep it short — 3 questions max.\n\n${prompt}`;
    needsSetup = false;
  }

  logConversation("user", text);

  // Acknowledge receipt with a reaction
  try {
    await ctx.api.setMessageReaction(ctx.chat.id, ctx.message.message_id, [{ type: "emoji", emoji: "👀" }]);
  } catch (err) {
    log("error", "[reaction] failed to set 👀:", (err as Error).message);
  }

  // Show typing indicator
  await ctx.replyWithChatAction("typing");

  try {
    let response: string;
    try {
      response = await claude(prompt);
    } catch (err) {
      const claudeErr = err instanceof ClaudeError ? err : null;

      // Retry 1: same session (transient error like timeout from permission popup)
      if (sessionId) {
        log("info", `[bridge] retry 1 — same session (${claudeErr?.isTimeout ? "timeout" : "error"})`);
        try {
          response = await claude(prompt);
        } catch {
          // Retry 2: fresh session with conversation context
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
        // No session to retry — start fresh
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
    // Remove 👀 reaction
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
]);

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
