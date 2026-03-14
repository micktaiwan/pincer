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
  silent: boolean; // silent agents: skip "Done" notification, consolidation, 1h retention
  onDone?: (agentId: string, status: "done" | "error") => void;
}

// Config constants (overridable via .env)
export const MCP_PORT = 3100;
export const MAX_AGENTS = 3;
export const AGENT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes of active work
export const ASK_TIMEOUT_MS = 30 * 60 * 1000;   // 30 minutes waiting for user reply
// Review cycle — self-improvement loop (disabled — not yet wired in index.ts)
export const REVIEW_CHECK_INTERVAL_MS = 3 * 60 * 60 * 1000;  // 3 hours between review cycle checks
export const REVIEW_CYCLE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h between review cycles
export const REVIEW_TIMEOUT_MS = 10 * 60 * 1000;    // 10 minutes max per review agent
