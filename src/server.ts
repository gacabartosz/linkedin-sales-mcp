/**
 * LinkedIn Sales Intelligence MCP Server
 *
 * Remote MCP server for claude.ai with OAuth 2.1 + Streamable HTTP transport.
 * Read-only tools for competitive intelligence and sales research.
 */

import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { ensureDataDirs, config } from "./utils/config.js";
import { log } from "./utils/logger.js";
import { LinkedInSalesOAuthProvider } from "./oauth/provider.js";
import { cleanupExpired } from "./oauth/store.js";
import { toolDefinitions, handleToolCall } from "./tools.js";

// ── Create MCP Server Instance ───────────────────────────────────────────────

function createMcpServer(): Server {
  const server = new Server(
    { name: "linkedin-sales-mcp", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolDefinitions,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return handleToolCall(request.params.name, request.params.arguments || {});
  });

  return server;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  ensureDataDirs();

  const app = express();
  app.set("trust proxy", 1);  // Behind 1 reverse proxy (Traefik)
  app.use(cors());
  app.use(express.json());

  // ── OAuth Router ─────────────────────────────────────────────────────────
  const oauthProvider = new LinkedInSalesOAuthProvider();
  const publicUrl = new URL(config.publicUrl);

  app.use(mcpAuthRouter({
    provider: oauthProvider,
    issuerUrl: publicUrl,
    baseUrl: publicUrl,
    resourceServerUrl: publicUrl,
    scopesSupported: ["mcp:tools"],
    resourceName: "LinkedIn Sales Intelligence",
    serviceDocumentationUrl: new URL("https://github.com/gacabartosz/linkedin-sales-mcp"),
  }));

  // ── Session Management ───────────────────────────────────────────────────
  const sessions = new Map<string, {
    transport: StreamableHTTPServerTransport;
    server: Server;
  }>();

  // ── MCP Endpoint (Streamable HTTP) ───────────────────────────────────────
  app.all("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (req.method === "POST") {
      // Check if this is an initialization request (no session ID)
      if (!sessionId) {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
        });

        const server = createMcpServer();
        await server.connect(transport);

        // Store session after connection (transport.sessionId is set after first handleRequest)
        transport.onclose = () => {
          const sid = (transport as unknown as { sessionId?: string }).sessionId;
          if (sid) {
            sessions.delete(sid);
            log("info", `Session closed: ${sid}`);
          }
        };

        await transport.handleRequest(req, res, req.body);

        // Store session
        const sid = (transport as unknown as { sessionId?: string }).sessionId;
        if (sid) {
          sessions.set(sid, { transport, server });
          log("info", `New session: ${sid}`);
        }
        return;
      }

      // Existing session
      const session = sessions.get(sessionId);
      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }
      await session.transport.handleRequest(req, res, req.body);
      return;
    }

    if (req.method === "GET") {
      // SSE stream for server notifications
      if (!sessionId) {
        res.status(400).json({ error: "Session ID required for GET" });
        return;
      }
      const session = sessions.get(sessionId);
      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }
      await session.transport.handleRequest(req, res);
      return;
    }

    if (req.method === "DELETE") {
      // Session teardown
      if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId)!;
        await session.transport.close();
        sessions.delete(sessionId);
        log("info", `Session deleted: ${sessionId}`);
      }
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: "Method not allowed" });
  });

  // ── Health Check ─────────────────────────────────────────────────────────
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      server: "linkedin-sales-mcp",
      version: "1.0.0",
      sessions: sessions.size,
      timestamp: new Date().toISOString(),
    });
  });

  // ── Cleanup expired OAuth tokens every hour ──────────────────────────────
  setInterval(() => {
    cleanupExpired();
  }, 3_600_000);

  // ── Start Server ─────────────────────────────────────────────────────────
  app.listen(config.serverPort, config.serverHost, () => {
    log("info", `LinkedIn Sales MCP server listening on ${config.serverHost}:${config.serverPort}`);
    log("info", `Public URL: ${config.publicUrl}`);
    log("info", `MCP endpoint: ${config.publicUrl}/mcp`);
    log("info", `OAuth metadata: ${config.publicUrl}/.well-known/oauth-authorization-server`);
    log("info", `Health: ${config.publicUrl}/health`);
  });
}

main().catch((err) => {
  log("error", "Server failed to start", err);
  process.exit(1);
});
