import { Hono } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import type { Logger } from "pino";

// ---------------------------------------------------------------------------
// Per-job registry
// ---------------------------------------------------------------------------

type McpJobEntry = {
  factories: Record<string, () => McpSdkServerConfigWithInstance>;
  expiresAt: number;
};

/**
 * Registry keyed by per-job bearer token.
 * Each entry maps server names to factory functions that produce a fresh
 * McpSdkServerConfigWithInstance on every call (required for stateless mode).
 */
export function createMcpJobRegistry() {
  const registry = new Map<string, McpJobEntry>();

  const inspectToken = (token: string):
    | { ok: true; ttlRemainingMs: number }
    | { ok: false; reason: "missing" | "expired"; ttlRemainingMs?: number } => {
    const entry = registry.get(token);
    if (!entry) return { ok: false, reason: "missing" };

    const ttlRemainingMs = entry.expiresAt - Date.now();
    if (ttlRemainingMs <= 0) {
      registry.delete(token);
      return { ok: false, reason: "expired", ttlRemainingMs };
    }

    return { ok: true, ttlRemainingMs };
  };

  return {
    register(
      token: string,
      factories: Record<string, () => McpSdkServerConfigWithInstance>,
      ttlMs = 3_600_000,
    ): void {
      registry.set(token, { factories, expiresAt: Date.now() + ttlMs });
    },

    unregister(token: string): void {
      registry.delete(token);
    },

    inspectToken,

    hasToken(token: string): boolean {
      return inspectToken(token).ok;
    },

    getFactory(
      token: string,
      serverName: string,
    ): (() => McpSdkServerConfigWithInstance) | undefined {
      if (!inspectToken(token).ok) return undefined;
      return registry.get(token)?.factories[serverName];
    },
  };
}

export type McpJobRegistry = ReturnType<typeof createMcpJobRegistry>;

// ---------------------------------------------------------------------------
// Hono routes
// ---------------------------------------------------------------------------

/**
 * Returns a Hono app with a single catch-all route at /internal/mcp/:serverName.
 *
 * Auth: Bearer token validated against the registry.
 * Transport: fresh WebStandardStreamableHTTPServerTransport per request (stateless
 *   mode — sessionIdGenerator: undefined) to avoid the _hasHandledRequest invariant.
 * Server: fresh McpSdkServerConfigWithInstance per request via factory() to avoid
 *   tool-handler re-registration errors on a reused McpServer instance.
 */
export function createMcpHttpRoutes(
  registry: McpJobRegistry,
  logger?: Logger,
): Hono {
  const app = new Hono();

  app.all("/internal/mcp/:serverName", async (c) => {
    const authHeader = c.req.header("Authorization");
    const token = authHeader?.replace(/^Bearer /, "");

    if (!token) {
      logger?.warn(
        { tokenPrefix: undefined, authFailureReason: "missing" },
        "MCP HTTP: unauthorized",
      );
      return c.json({ error: "Unauthorized" }, 401);
    }

    const authState = registry.inspectToken(token);
    if (!authState.ok) {
      logger?.warn(
        {
          tokenPrefix: token.slice(0, 8),
          authFailureReason: authState.reason,
          ...(authState.ttlRemainingMs !== undefined
            ? { ttlRemainingMs: authState.ttlRemainingMs }
            : {}),
        },
        "MCP HTTP: unauthorized",
      );
      return c.json({ error: "Unauthorized" }, 401);
    }

    const serverName = c.req.param("serverName");
    const factory = registry.getFactory(token, serverName);

    if (!factory) {
      logger?.warn(
        { serverName, tokenPrefix: token.slice(0, 8) },
        "MCP HTTP: server not found",
      );
      return c.json({ error: "Not Found" }, 404);
    }

    // Fresh instances per request — required by stateless transport invariant.
    const serverConfig = factory();
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    await serverConfig.instance.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  return app;
}
