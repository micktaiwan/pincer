import type { ChildProcess } from "node:child_process";

export interface AgentState {
  id: string;
  label: string;
  process: ChildProcess;
  sessionId: string | null;
  status: "working" | "waiting" | "done" | "error";
  startedAt: number;
  pendingAsk: {
    messageId: number;
    resolve: (reply: string) => void;
    timer: NodeJS.Timeout;
  } | null;
  costUsd: number;
  logFile: string;
}

// Config constants (overridable via .env)
export const MCP_PORT = 3100;
export const MAX_AGENTS = 3;
export const AGENT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes of active work
export const ASK_TIMEOUT_MS = 30 * 60 * 1000;   // 30 minutes waiting for user reply
