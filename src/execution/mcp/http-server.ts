import { createHash } from "node:crypto";
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
const RETIRED_TOKEN_TTL_MS = 5 * 60 * 1000;

export function createMcpJobRegistry() {
  const registry = new Map<string, McpJobEntry>();
  const retiredTokenFingerprints = new Map<string, number>();

  const tokenFingerprint = (token: string): string =>
    createHash("sha256").update(token).digest("hex");

  const tokenLogId = (token: string): string => tokenFingerprint(token).slice(0, 16);

  const pruneRetiredTokens = (): void => {
    const now = Date.now();
    for (const [fingerprint, expiresAt] of retiredTokenFingerprints) {
      if (expiresAt <= now) {
        retiredTokenFingerprints.delete(fingerprint);
      }
    }
  };

  const markRetired = (token: string): void => {
    pruneRetiredTokens();
    retiredTokenFingerprints.set(tokenFingerprint(token), Date.now() + RETIRED_TOKEN_TTL_MS);
  };

  const inspectToken = (token: string):
    | { ok: true; ttlRemainingMs: number }
    | { ok: false; reason: "missing" | "expired" | "retired"; ttlRemainingMs?: number } => {
    const entry = registry.get(token);
    if (!entry) {
      pruneRetiredTokens();
      return retiredTokenFingerprints.has(tokenFingerprint(token))
        ? { ok: false, reason: "retired" }
        : { ok: false, reason: "missing" };
    }

    const ttlRemainingMs = entry.expiresAt - Date.now();
    if (ttlRemainingMs <= 0) {
      registry.delete(token);
      markRetired(token);
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
      markRetired(token);
    },

    inspectToken,

    getTokenLogId(token: string): string {
      return tokenLogId(token);
    },

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
        { authFailureReason: "missing" },
        "MCP HTTP: unauthorized",
      );
      return c.json({ error: "Unauthorized" }, 401);
    }

    const authState = registry.inspectToken(token);
    if (!authState.ok) {
      const logAuthFailure = authState.reason === "retired" || authState.reason === "expired"
        ? logger?.info.bind(logger)
        : logger?.warn.bind(logger);
      logAuthFailure?.(
        {
          tokenLogId: registry.getTokenLogId(token),
          authFailureReason: authState.reason,
          authFailureExpected: authState.reason === "retired" || authState.reason === "expired",
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
        { serverName, tokenLogId: registry.getTokenLogId(token) },
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
