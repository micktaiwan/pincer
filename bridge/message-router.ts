import type { AgentManager } from "./agent-manager.js";

interface RouteInput {
  text: string;
  replyToMessageId: number | null;
  agentManager: AgentManager;
  log: (level: "info" | "error", ...args: unknown[]) => void;
}

type RouteResult =
  | { action: "routed" }
  | { action: "follow-up"; agentId: string }
  | { action: "ambiguous" }
  | { action: "none" };

/**
 * Try to route an incoming message to a waiting or finished persistent agent.
 * Returns the routing result so the caller can act on it.
 */
export function routeMessage({ text, replyToMessageId, agentManager, log }: RouteInput): RouteResult {
  // 1. Reply-to routing: find the agent that sent the replied-to message
  if (replyToMessageId != null) {
    const agentId = agentManager.getAgentByMessageId(replyToMessageId);
    if (agentId) {
      const agent = agentManager.get(agentId);

      // Active agent waiting for a reply → deliver directly
      if (agent?.pendingAsk) {
        log("info", `[router] reply-to routed to agent [${agent.label}]`);
        agentManager.resolveAsk(agentId, text);
        return { action: "routed" };
      }

      // Finished/errored agent → follow-up (spawn new agent with old context)
      if (agent && (agent.status === "done" || agent.status === "error")) {
        log("info", `[router] follow-up on finished agent [${agent.label}]`);
        return { action: "follow-up", agentId };
      }
    }
  }

  // 2. Single waiting agent — auto-route
  const waiting = agentManager.listActive().filter(a => a.status === "waiting");

  if (waiting.length === 1) {
    log("info", `[router] auto-routed to single waiting agent [${waiting[0].label}]`);
    agentManager.resolveAsk(waiting[0].id, text);
    return { action: "routed" };
  }

  if (waiting.length > 1) {
    return { action: "ambiguous" };
  }

  // 3. No agents waiting — fall through to regular conversation
  return { action: "none" };
}
