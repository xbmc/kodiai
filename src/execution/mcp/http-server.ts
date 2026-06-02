import { createHash } from "node:crypto";
import { Hono } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import type { Logger } from "pino";

type RateLimitWindowOptions = {
  max?: number;
  windowMs?: number;
  maxKeys?: number;
};

type McpHttpRateLimitOptions = {
  preAuth?: RateLimitWindowOptions;
  verified?: RateLimitWindowOptions;
};

type RateLimiter = {
  isLimited(key: string): boolean;
};

function createSlidingWindowRateLimiter(
  options: RateLimitWindowOptions | undefined,
  defaults: Required<RateLimitWindowOptions>,
): RateLimiter {
  const max = options?.max ?? defaults.max;
  const windowMs = options?.windowMs ?? defaults.windowMs;
  const maxKeys = options?.maxKeys ?? defaults.maxKeys;
  const timestampsByKey = new Map<string, number[]>();

  function pruneKeys(cutoff: number): void {
    if (timestampsByKey.size <= maxKeys) return;
    for (const [key, timestamps] of timestampsByKey) {
      if (timestamps.length === 0 || timestamps[timestamps.length - 1]! <= cutoff) {
        timestampsByKey.delete(key);
      }
      if (timestampsByKey.size <= maxKeys) return;
    }

    for (const key of timestampsByKey.keys()) {
      timestampsByKey.delete(key);
      if (timestampsByKey.size <= maxKeys) return;
    }
  }

  return {
    isLimited(key: string): boolean {
      const now = Date.now();
      const cutoff = now - windowMs;
      let timestamps = timestampsByKey.get(key);
      if (!timestamps) {
        timestamps = [];
        timestampsByKey.set(key, timestamps);
      }

      const validStart = timestamps.findIndex((timestamp) => timestamp > cutoff);
      if (validStart > 0) {
        timestamps.splice(0, validStart);
      } else if (validStart === -1) {
        timestamps.length = 0;
      }

      if (timestamps.length >= max) {
        pruneKeys(cutoff);
        return true;
      }

      timestamps.push(now);
      pruneKeys(cutoff);
      return false;
    },
  };
}

function requestSourceKey(header: (name: string) => string | undefined): string {
  const forwardedFor = header("x-forwarded-for")?.split(",")[0]?.trim();
  return header("cf-connecting-ip") ?? header("x-real-ip") ?? forwardedFor ?? "unknown";
}

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
  const preAuthLimiter = createSlidingWindowRateLimiter(rateLimitOptions?.preAuth, {
    max: 240,
    windowMs: 60_000,
    maxKeys: 2_000,
  });
  const verifiedLimiter = createSlidingWindowRateLimiter(rateLimitOptions?.verified, {
    max: 120,
    windowMs: 60_000,
    maxKeys: 5_000,
  });

  app.all("/internal/mcp/:serverName", async (c) => {
    const requestSource = requestSourceKey((name) => c.req.header(name));
    if (preAuthLimiter.isLimited(`mcp:${requestSource}`)) {
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
    if (verifiedLimiter.isLimited(`token:${tokenLogId}:server:${serverName}`)) {
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
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    await serverConfig.instance.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  return app;
}
