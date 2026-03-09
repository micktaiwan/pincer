import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { z } from "zod";
import type { AgentManager } from "./agent-manager.js";

interface McpServerConfig {
  port: number;
  agentManager: AgentManager;
  log: (level: "info" | "error", ...args: unknown[]) => void;
}

export function createMcpServer(config: McpServerConfig) {
  const { port, agentManager, log } = config;

  // Map SSE session ID → agent ID
  const sessionToAgent = new Map<string, string>();
  // Map SSE session ID → transport (for routing POST /messages)
  const transports = new Map<string, SSEServerTransport>();

  // Create a fresh McpServer instance per agent connection, with the same tools.
  // The MCP SDK only allows one transport per McpServer instance.
  function createMcpInstance(): McpServer {
    const mcp = new McpServer({
      name: "pincer-bridge",
      version: "1.0.0",
    });

    // --- Tool: set_label ---
    mcp.tool(
      "set_label",
      "Set a short label for this agent (e.g. 'Notion', 'PR-142'). Call this first.",
      { label: z.string().describe("Short label (1-2 words) describing the task") },
      async (params, extra) => {
        const agentId = resolveAgentId(extra);
        if (!agentId) return errorResult("Agent not identified");
        agentManager.setLabel(agentId, params.label);
        return { content: [{ type: "text" as const, text: `Label set to: ${params.label}` }] };
      },
    );

    // --- Tool: send_message ---
    mcp.tool(
      "send_message",
      "Send a message to the user on Telegram. Non-blocking.",
      { text: z.string().describe("Message text to send") },
      async (params, extra) => {
        const agentId = resolveAgentId(extra);
        if (!agentId) return errorResult("Agent not identified");
        try {
          await agentManager.sendMessage(agentId, params.text);
          return { content: [{ type: "text" as const, text: "Message sent." }] };
        } catch (err) {
          return errorResult(`Failed to send: ${(err as Error).message}`);
        }
      },
    );

    // --- Tool: ask_user ---
    mcp.tool(
      "ask_user",
      "Ask the user a question and wait for their reply (blocks up to 30 minutes).",
      { question: z.string().describe("Question to ask the user") },
      async (params, extra) => {
        const agentId = resolveAgentId(extra);
        if (!agentId) return errorResult("Agent not identified");
        try {
          const reply = await agentManager.askUser(agentId, params.question);
          return { content: [{ type: "text" as const, text: reply }] };
        } catch (err) {
          return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
        }
      },
    );

    return mcp;
  }

  function resolveAgentId(extra: any): string | null {
    const sessionId = extra?.sessionId;
    if (sessionId && sessionToAgent.has(sessionId)) {
      return sessionToAgent.get(sessionId)!;
    }
    return null;
  }

  function errorResult(message: string) {
    return { content: [{ type: "text" as const, text: message }], isError: true };
  }

  // --- HTTP server for SSE transport ---
  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || "/", `http://localhost:${port}`);

    // CORS headers for MCP client
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // SSE endpoint — one connection per agent, one McpServer per connection
    if (req.method === "GET" && url.pathname === "/sse") {
      const agentId = url.searchParams.get("agent");
      if (!agentId) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Missing ?agent= parameter");
        return;
      }

      log("info", `[mcp] SSE connection from agent ${agentId}`);

      const transport = new SSEServerTransport("/messages", res);
      const sessionId = transport.sessionId;
      sessionToAgent.set(sessionId, agentId);
      transports.set(sessionId, transport);

      // Clean up on disconnect
      res.on("close", () => {
        sessionToAgent.delete(sessionId);
        transports.delete(sessionId);
        log("info", `[mcp] SSE disconnected: agent ${agentId}`);
      });

      const mcpInstance = createMcpInstance();
      await mcpInstance.connect(transport);
      return;
    }

    // Message endpoint — receives JSON-RPC messages from the client
    if (req.method === "POST" && url.pathname === "/messages") {
      const sessionId = url.searchParams.get("sessionId");
      if (!sessionId || !transports.has(sessionId)) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Invalid or missing sessionId");
        return;
      }

      const transport = transports.get(sessionId)!;
      await transport.handlePostMessage(req, res);
      return;
    }

    // Trigger endpoint — spawn an agent from cron or external script
    if (req.method === "POST" && url.pathname === "/trigger") {
      let body = "";
      req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      req.on("end", async () => {
        try {
          const { prompt } = JSON.parse(body);
          if (!prompt || typeof prompt !== "string") {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "Missing or invalid 'prompt'" }));
            return;
          }
          const agentId = await agentManager.spawn(prompt);
          log("info", `[trigger] spawned agent ${agentId} for: ${prompt.slice(0, 100)}`);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, agentId }));
        } catch (err) {
          const message = (err as Error).message;
          log("error", `[trigger] failed: ${message}`);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: message }));
        }
      });
      return;
    }

    // Health check
    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", agents: sessionToAgent.size }));
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  return {
    start() {
      httpServer.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          log("error", `[mcp] Port ${port} already in use — MCP server not started. Persistent agents won't work.`);
        } else {
          log("error", `[mcp] HTTP server error: ${err.message}`);
        }
      });
      httpServer.listen(port, "127.0.0.1", () => {
        log("info", `[mcp] MCP SSE server listening on http://127.0.0.1:${port}`);
      });
    },
  };
}
