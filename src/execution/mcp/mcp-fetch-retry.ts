/**
 * mcp-fetch-retry.ts — agent-side bounded retry for MCP HTTP callbacks.
 *
 * The agent job calls back into the orchestrator's MCP server over HTTP. When
 * the orchestrator's single-threaded event loop is briefly busy, those calls
 * can fail transiently (a fast-fail 503 from the request-timeout guard, a 502/
 * 504 from the ingress, or a dropped connection). The Agent SDK's "http" MCP
 * transport issues these via globalThis.fetch and has no built-in retry, so a
 * single transient blip silently loses a review finding or comment.
 *
 * This wraps fetch with bounded exponential backoff + jitter. It is a pure
 * MECHANISM: it retries POSTs to the exact URLs it is told are retry-safe and
 * passes everything else straight through. The POLICY of which endpoints are
 * safe to retry (idempotent / dedup their writes) lives with the server-name
 * declarations in agent-entrypoint.ts, so it can never duplicate a PR comment.
 */

import type { Logger } from "pino";

const RETRYABLE_STATUS = new Set([502, 503, 504]);

export interface McpFetchRetryOptions {
  /**
   * Normalized keys (origin + pathname, via normalizeMcpUrlKey) of the MCP
   * callback URLs that are safe to retry. Requests whose key is absent pass
   * through untouched.
   */
  retrySafeUrls: ReadonlySet<string>;
  /** Total attempts including the first (default 3 → up to 2 retries). */
  maxAttempts?: number;
  /** Base backoff in ms; attempt N waits ~baseDelayMs * 2^(N-1) with jitter. */
  baseDelayMs?: number;
  /** Upper bound on a single backoff wait. */
  maxDelayMs?: number;
  logger?: Pick<Logger, "warn" | "info">;
  /** Injectable sleep (tests). Resolves false if the signal aborts first. */
  sleepFn?: (ms: number, signal?: AbortSignal) => Promise<boolean>;
  /** Injectable jitter in [0,1) (tests). Defaults to Math.random. */
  randomFn?: () => number;
}

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

function requestUrl(input: FetchInput): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function requestMethod(input: FetchInput, init: FetchInit): string {
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  return method.toUpperCase();
}

/**
 * Canonical retry key for an MCP callback URL: origin + pathname, ignoring
 * query/hash so it is stable across any session params the SDK may add. Both
 * the retry-safe set and the per-request match are built through this, so they
 * normalize identically. Returns undefined for an unparseable URL.
 */
export function normalizeMcpUrlKey(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.origin + parsed.pathname;
  } catch {
    return undefined;
  }
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (signal?.aborted) {
      resolve(false);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener?.("abort", onAbort);
      resolve(true);
    }, ms);
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

/**
 * Wrap a fetch implementation with gated, bounded retry for MCP callbacks.
 * Non-POST requests and requests whose key is not in `retrySafeUrls` pass
 * straight through to `baseFetch`.
 */
export function createRetryingFetch(
  baseFetch: typeof fetch,
  options: McpFetchRetryOptions,
): typeof fetch {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const baseDelayMs = options.baseDelayMs ?? 250;
  const maxDelayMs = options.maxDelayMs ?? 2_000;
  const sleep = options.sleepFn ?? defaultSleep;
  const random = options.randomFn ?? Math.random;
  const logger = options.logger;

  const retryingFetch = (async (input: FetchInput, init?: FetchInit): Promise<Response> => {
    const key = requestMethod(input, init) === "POST"
      ? normalizeMcpUrlKey(requestUrl(input))
      : undefined;
    if (key === undefined || !options.retrySafeUrls.has(key)) {
      return baseFetch(input, init);
    }

    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);

    /** Log + back off before the next attempt; resolves false if aborted. */
    const waitToRetry = (attempt: number, reason: Record<string, unknown>): Promise<boolean> => {
      const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const backoffMs = Math.floor(exp * random()); // full jitter avoids retry storms
      logger?.warn(
        { event: "mcp-fetch-retry", target: key, attempt, maxAttempts, backoffMs, ...reason },
        "MCP callback failed transiently; retrying",
      );
      return sleep(backoffMs, signal ?? undefined);
    };

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await baseFetch(input, init);
        if (attempt >= maxAttempts || !RETRYABLE_STATUS.has(response.status)) {
          return response;
        }
        // Release the body so the connection can be reused, then back off.
        await response.body?.cancel?.().catch(() => {});
        if (!(await waitToRetry(attempt, { status: response.status }))) {
          return response; // aborted during backoff
        }
      } catch (err) {
        // An explicit abort or the final attempt is terminal — surface it.
        if (signal?.aborted || attempt >= maxAttempts) throw err;
        if (!(await waitToRetry(attempt, { error: err instanceof Error ? err.message : String(err) }))) {
          throw err; // aborted during backoff
        }
      }
    }
    // Unreachable: the loop always returns or throws on the final attempt.
    throw new Error("mcp-fetch-retry: exhausted attempts without resolution");
  }) as typeof fetch;

  return retryingFetch;
}

/**
 * Install the retrying fetch as globalThis.fetch (the Agent SDK's "http" MCP
 * transport calls globalThis.fetch). Returns a function that restores the
 * original fetch.
 */
export function installMcpFetchRetry(options: McpFetchRetryOptions): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = createRetryingFetch(original.bind(globalThis), options);
  return () => {
    globalThis.fetch = original;
  };
}
