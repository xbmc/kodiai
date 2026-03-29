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

    hasToken(token: string): boolean {
      const entry = registry.get(token);
      if (!entry) return false;
      // Treat expired entries as absent (lazy expiry).
      if (entry.expiresAt <= Date.now()) {
        registry.delete(token);
        return false;
      }
      return true;
    },

    getFactory(
      token: string,
      serverName: string,
    ): (() => McpSdkServerConfigWithInstance) | undefined {
      const entry = registry.get(token);
      if (!entry) return undefined;
      if (entry.expiresAt <= Date.now()) {
        registry.delete(token);
        return undefined;
      }
      return entry.factories[serverName];
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

    if (!token || !registry.hasToken(token)) {
      logger?.warn(
        { tokenPrefix: token?.slice(0, 8) },
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
