import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

export const agentHome = resolve(homedir(), ".pincer");
export const logFile = resolve(agentHome, "bridge.log");
export const costsFile = resolve(agentHome, "costs.jsonl");
export const convFile = resolve(agentHome, "conversations.jsonl");

export function log(level: "info" | "error", ...args: unknown[]) {
  const timestamp = new Date().toISOString();
  const message = args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ");
  const line = `[${timestamp}] [${level}] ${message}\n`;
  const consoleFn = level === "error" ? console.error : console.log;
  consoleFn(message);
  try { appendFileSync(logFile, line); } catch { /* best effort */ }
}

export function logCost(costUsd: number, durationMs: number, durationApiMs: number, session: string | null) {
  const entry = {
    ts: new Date().toISOString(),
    cost_usd: costUsd,
    duration_ms: durationMs,
    duration_api_ms: durationApiMs,
    session: session?.slice(0, 8) || null,
  };
  try { appendFileSync(costsFile, JSON.stringify(entry) + "\n"); } catch { /* best effort */ }
}

export function extractText(blocks: any[]): string {
  return blocks.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
}

export class ClaudeError extends Error {
  constructor(message: string, public readonly isTimeout: boolean = false) {
    super(message);
  }
}

export function parseJsonl<T = any>(path: string): T[] {
  try {
    const raw = existsSync(path) ? readFileSync(path, "utf-8").trim() : "";
    if (!raw) return [];
    return raw.split("\n")
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

export function parseJsonlString(raw: string): Record<string, unknown>[] {
  if (!raw) return [];
  return raw.split("\n")
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h${m}m`;
  if (m > 0) return `${m}m`;
  return `${seconds}s`;
}

export function logConversation(role: "user" | "pincer", message: string) {
  const entry = { ts: new Date().toISOString(), role, message };
  try { appendFileSync(convFile, JSON.stringify(entry) + "\n"); } catch { /* best effort */ }
}

export function getRecentConversation(maxEntries = 20): string {
  const entries = parseJsonl<{ role: string; message: string }>(convFile).slice(-maxEntries);
  return entries.map(e =>
    `${e.role === "user" ? "user" : "Pincer"}: ${e.message}`
  ).join("\n\n");
}

export function trimJsonl(path: string, maxEntries: number) {
  try {
    const raw = readFileSync(path, "utf-8").trim();
    if (!raw) return;
    const lines = raw.split("\n");
    if (lines.length <= maxEntries) return;
    const trimmed = lines.slice(-maxEntries).join("\n") + "\n";
    writeFileSync(path, trimmed);
    log("info", `[trim] ${path}: ${lines.length} → ${maxEntries} entries`);
  } catch { /* best effort */ }
}

export const dateFormatter = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", dateStyle: "full", timeStyle: "short" });

const TELEGRAM_MAX_LENGTH = 4096;

/**
 * Split a message into chunks that fit within Telegram's 4096 char limit.
 * Prefers splitting on newlines; falls back to hard cut at maxLen.
 */
export function splitMessage(text: string, maxLen = TELEGRAM_MAX_LENGTH): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    // Find the last newline within the limit
    let splitAt = remaining.lastIndexOf("\n", maxLen);
    if (splitAt <= 0) {
      // No newline found — hard cut at maxLen
      splitAt = maxLen;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n/, ""); // trim leading newline from next chunk
  }

  return chunks;
}
