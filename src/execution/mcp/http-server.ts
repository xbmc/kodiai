import { createHash } from "node:crypto";
import { Hono } from "hono";
import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import type { Logger } from "pino";
import {
  createRateLimitPair,
  requestSourceKey,
  type RateLimitWindowOptions,
} from "../../lib/sliding-window-rate-limiter.ts";
import { withTimeout } from "../../lib/with-timeout.ts";

type McpHttpRateLimitOptions = {
  preAuth?: RateLimitWindowOptions;
  verified?: RateLimitWindowOptions;
};

/**
 * Hard ceiling on how long a single MCP request may run before we fast-fail it.
 *
 * The orchestrator serves this MCP server on the same external ingress that
 * agent jobs call back into. Azure Container Apps' ingress enforces a 240s
 * stream_idle_timeout: a request that produces no response bytes for 240s is
 * silently reset to a 504 with no application-level log. When the single-
 * threaded event loop is briefly starved during review-time CPU bursts, in-
 * flight MCP calls hit that limit and review findings/comments are lost.
 *
 * Failing fast (well under 240s) with a retryable 503 turns an invisible 4-minute
 * hang into an observable, short-lived error the caller can react to, and frees
 * the connection instead of holding it open against the ingress timeout.
 */
const MCP_REQUEST_TIMEOUT_MS = (() => {
  const raw = Number(process.env.MCP_REQUEST_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 30_000;
})();

/** Requests slower than this are logged (warn) even when they ultimately succeed. */
const MCP_SLOW_REQUEST_MS = (() => {
  const raw = Number(process.env.MCP_SLOW_REQUEST_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 10_000;
})();

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
const MAX_ACTIVE_MCP_TOKENS = 5_000;
const MAX_RETIRED_TOKEN_FINGERPRINTS = 10_000;

function evictOldestMapEntries<K, V>(map: Map<K, V>, maxSize: number): void {
  while (map.size > maxSize) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }
}

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
    evictOldestMapEntries(retiredTokenFingerprints, MAX_RETIRED_TOKEN_FINGERPRINTS);
  };

  const markRetired = (token: string): void => {
    pruneRetiredTokens();
    retiredTokenFingerprints.set(tokenFingerprint(token), Date.now() + RETIRED_TOKEN_TTL_MS);
    evictOldestMapEntries(retiredTokenFingerprints, MAX_RETIRED_TOKEN_FINGERPRINTS);
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
      const now = Date.now();
      for (const [existingToken, entry] of registry) {
        if (entry.expiresAt <= now) {
          registry.delete(existingToken);
          markRetired(existingToken);
        }
      }
      registry.set(token, { factories, expiresAt: Date.now() + ttlMs });
      evictOldestMapEntries(registry, MAX_ACTIVE_MCP_TOKENS);
    },

    unregister(token: string): void {
      if (registry.delete(token)) {
        markRetired(token);
      }
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
  options?: { rateLimit?: McpHttpRateLimitOptions } | McpHttpRateLimitOptions,
): Hono {
  const app = new Hono();
  const rateLimitOptions = "rateLimit" in (options ?? {})
    ? (options as { rateLimit?: McpHttpRateLimitOptions }).rateLimit
    : options as McpHttpRateLimitOptions | undefined;
  const rateLimiters = createRateLimitPair({
    pre: rateLimitOptions?.preAuth,
    verified: rateLimitOptions?.verified,
  }, {
    pre: { max: 240, windowMs: 60_000, maxKeys: 2_000 },
    verified: { max: 120, windowMs: 60_000, maxKeys: 5_000 },
  });

  app.all("/internal/mcp/:serverName", async (c) => {
    const requestSource = requestSourceKey((name) => c.req.header(name));
    if (rateLimiters.pre.isLimited(`mcp:${requestSource}`)) {
      logger?.warn({ requestSource }, "MCP HTTP: request rate-limited before auth");
      return c.json({ error: "Rate limited" }, 429);
    }

    const authHeader = c.req.header("Authorization");
    const token = authHeader?.replace(/^Bearer /, "");

    if (!token) {
      logger?.info(
        { authFailureReason: "missing", authFailureExpected: true },
        "MCP HTTP: unauthorized",
      );
      return c.json({ error: "Unauthorized" }, 401);
    }

    const authState = registry.inspectToken(token);
    if (!authState.ok) {
      const authFailureExpected = authState.reason === "missing" || authState.reason === "retired" || authState.reason === "expired";
      const logAuthFailure = authFailureExpected
        ? logger?.info.bind(logger)
        : logger?.warn.bind(logger);
      logAuthFailure?.(
        {
          tokenLogId: registry.getTokenLogId(token),
          authFailureReason: authState.reason,
          authFailureExpected,
          ...(authState.ttlRemainingMs !== undefined
            ? { ttlRemainingMs: authState.ttlRemainingMs }
            : {}),
        },
        "MCP HTTP: unauthorized",
      );
      return c.json({ error: "Unauthorized" }, 401);
    }

    const serverName = c.req.param("serverName");
    const tokenLogId = registry.getTokenLogId(token);
    if (rateLimiters.verified.isLimited(`token:${tokenLogId}:server:${serverName}`)) {
      logger?.warn({ serverName, tokenLogId }, "MCP HTTP: verified token rate-limited");
      return c.json({ error: "Rate limited" }, 429);
    }

    const factory = registry.getFactory(token, serverName);

    if (!factory) {
      logger?.warn(
        { serverName, tokenLogId },
        "MCP HTTP: server not found",
      );
      return c.json({ error: "Not Found" }, 404);
    }

    // Fresh instances per request — required by stateless transport invariant.
    const serverConfig = factory();
    const { WebStandardStreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js");
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    await serverConfig.instance.connect(transport);

    // Bound the request so a starved event loop can never let it hang until the
    // ingress 240s stream_idle_timeout (which surfaces as a silent 504). On
    // timeout we fast-fail with a retryable 503 and emit a structured log so the
    // stall is observable instead of invisible.
    const startedAt = Date.now();
    const outcome = await withTimeout(
      transport.handleRequest(c.req.raw),
      MCP_REQUEST_TIMEOUT_MS,
    );

    if (outcome.timedOut) {
      logger?.warn(
        {
          event: "mcp-http-request-timeout",
          serverName,
          tokenLogId,
          durationMs: Date.now() - startedAt,
          timeoutMs: MCP_REQUEST_TIMEOUT_MS,
        },
        "MCP HTTP: request exceeded timeout; failing fast",
      );
      return c.json(
        { error: "MCP request timed out", retryable: true },
        503,
        { "Retry-After": "1" },
      );
    }

    const durationMs = Date.now() - startedAt;
    if (durationMs >= MCP_SLOW_REQUEST_MS) {
      logger?.warn(
        { event: "mcp-http-request-slow", serverName, tokenLogId, durationMs },
        "MCP HTTP: slow request",
      );
    }

    return outcome.value;
  });

  return app;
}
