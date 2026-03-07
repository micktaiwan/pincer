import { Bot } from "grammy";
import { spawn, execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env");

// Resolve claude binary path at startup (Node's PATH may not include homebrew/nvm dirs)
let claudeBin = "claude";
try {
  claudeBin = execSync("which claude", { encoding: "utf8" }).trim();
  console.log(`[init] claude binary: ${claudeBin}`);
} catch {
  console.warn("[init] 'claude' not found in PATH, spawn will likely fail");
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
  console.error("TELEGRAM_BOT_TOKEN missing in .env");
  process.exit(1);
}

const bot = new Bot(token);

const projectDir = resolve(__dirname, "..");
const agentDir = resolve(projectDir, "agent");

// Agent runtime directory — separate from the source repo
const agentHome = resolve(homedir(), ".pincer");
mkdirSync(agentHome, { recursive: true });

// Copy agent CLAUDE.md to runtime dir at startup
const agentClaudeMd = resolve(agentDir, "CLAUDE.md");
if (existsSync(agentClaudeMd)) {
  copyFileSync(agentClaudeMd, resolve(agentHome, "CLAUDE.md"));
  console.log(`[init] copied agent CLAUDE.md to ${agentHome}`);
}

// Session ID for conversation continuity (persisted to disk)
const sessionFile = resolve(agentHome, ".session");
let sessionId: string | null = null;

try {
  if (existsSync(sessionFile)) {
    sessionId = readFileSync(sessionFile, "utf-8").trim() || null;
    if (sessionId) console.log(`[init] resumed session: ${sessionId}`);
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

    console.log(`[claude] spawn ${sessionId ? `(resume ${sessionId})` : "(new session)"}`);

    const child = spawn(claudeBin, args, {
      cwd: agentHome,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    child.stdin.end();

    let buffer = "";
    let resultText = "";

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
            console.log(`[claude] session: ${sessionId}`);
          }
          // Capture assistant text
          if (data.type === "assistant") {
            const blocks = data.message?.content || [];
            const text = blocks.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
            if (text) resultText = text;
          }
          // Capture result text (final)
          if (data.type === "result" && data.subtype !== "error" && data.subtype !== "error_during_execution") {
            const blocks = data.result?.content || data.content || [];
            const text = blocks.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
            if (text) resultText = text;
            console.log(`[claude] cost: $${Number(data.total_cost_usd ?? 0).toFixed(2)} duration: ${data.duration_ms}ms (api: ${data.duration_api_ms}ms)`);
          }
          if (data.type === "result" && (data.subtype === "error" || data.subtype === "error_during_execution")) {
            console.error("[claude] error result:", data.error || data.result?.error);
          }
        } catch {
          // skip non-JSON lines
        }
      }
    });

    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      // Process remaining buffer
      if (buffer.trim()) {
        try {
          const data = JSON.parse(buffer.trim());
          if (data.type === "assistant") {
            const blocks = data.message?.content || [];
            const text = blocks.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
            if (text) resultText = text;
          }
          if (data.type === "result" && data.subtype !== "error") {
            const blocks = data.result?.content || data.content || [];
            const text = blocks.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
            if (text) resultText = text;
          }
        } catch { /* skip */ }
      }

      if (code !== 0) {
        console.error("[claude exit]", code, stderr);
        // Reset session on error so next call starts fresh
        sessionId = null;
        saveSession();
        reject(new Error(`claude exited with code ${code}`));
        return;
      }
      resolvePromise(resultText.trim());
    });

    child.on("error", (err) => {
      console.error("[claude spawn error]", err.message);
      reject(err);
    });

    setTimeout(() => {
      child.kill();
      reject(new Error("claude timeout"));
    }, 120_000);
  });
}

bot.on("message:text", async (ctx) => {
  // Only respond to allowed chat
  if (allowedChatId && String(ctx.chat.id) !== allowedChatId) {
    console.log(`[ignored] message from chat ${ctx.chat.id}`);
    return;
  }

  const text = ctx.message.text;
  console.log(`[message] ${text}`);

  // Show typing indicator
  await ctx.replyWithChatAction("typing");

  try {
    let response: string;
    try {
      response = await claude(text);
    } catch {
      // Session may be stale — retry with a fresh session
      console.log("[bridge] retrying with fresh session");
      sessionId = null;
      saveSession();
      response = await claude(text);
    }
    if (response) {
      await ctx.reply(response);
    } else {
      await ctx.reply("(pas de réponse)");
    }
  } catch (err) {
    await ctx.reply("Erreur lors du traitement du message.");
  }
});

bot.catch((err) => {
  console.error("[bot error]", err.message);
});

console.log("Pincer bridge started — listening for Telegram messages...");
bot.start();
