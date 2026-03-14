import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { z } from "zod";
import { createTransport, type Transporter } from "nodemailer";
import type { AgentManager } from "./agent-manager.js";

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
}

interface McpServerConfig {
  port: number;
  agentManager: AgentManager;
  smtp?: SmtpConfig;
  log: (level: "info" | "error", ...args: unknown[]) => void;
}

export function createMcpServer(config: McpServerConfig) {
  const { port, agentManager, smtp, log } = config;

  // SMTP transporter (lazy — created on first use)
  let smtpTransporter: Transporter | null = null;
  function getSmtpTransporter(): Transporter {
    if (!smtpTransporter) {
      if (!smtp) throw new Error("SMTP not configured (missing SMTP_HOST in .env)");
      smtpTransporter = createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: false, // STARTTLS on 587
        auth: { user: smtp.user, pass: smtp.password },
      });
    }
    return smtpTransporter;
  }

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

    // --- Tool: send_email ---
    mcp.tool(
      "send_email",
      "Send an email from pincer@mickaelfm.me.",
      {
        to: z.string().describe("Recipient email address"),
        subject: z.string().describe("Email subject"),
        body: z.string().describe("Email body (plain text)"),
      },
      async (params) => {
        try {
          const transporter = getSmtpTransporter();
          const info = await transporter.sendMail({
            from: smtp!.from,
            to: params.to,
            subject: params.subject,
            text: params.body,
          });
          log("info", `[email] sent to ${params.to}: ${info.messageId}`);
          return { content: [{ type: "text" as const, text: `Email sent to ${params.to} (${info.messageId})` }] };
        } catch (err) {
          log("error", `[email] failed to send to ${params.to}:`, (err as Error).message);
          return errorResult(`Failed to send email: ${(err as Error).message}`);
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

      const mcpInstance = createMcpInstance();

      // Clean up on disconnect
      res.on("close", () => {
        sessionToAgent.delete(sessionId);
        transports.delete(sessionId);
        try { mcpInstance.close?.(); } catch { /* best effort */ }
        log("info", `[mcp] SSE disconnected: agent ${agentId}`);
      });

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
      const MAX_BODY_SIZE = 16 * 1024; // 16 KB
      let body = "";
      let tooLarge = false;
      req.on("data", (chunk: Buffer) => {
        body += chunk.toString();
        if (body.length > MAX_BODY_SIZE) { tooLarge = true; req.destroy(); }
      });
      req.on("end", async () => {
        if (tooLarge) {
          res.writeHead(413, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "Request body too large" }));
          return;
        }
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
    stop(): Promise<void> {
      return new Promise((resolve) => {
        // Force-close lingering SSE connections first so httpServer.close can complete
        for (const [, transport] of transports) {
          try { transport.close?.(); } catch { /* ignore */ }
        }
        httpServer.close(() => resolve());
        // Fallback: resolve after 5s if connections still linger
        setTimeout(() => resolve(), 5000);
      });
    },
  };
}
