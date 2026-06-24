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
 * This wraps fetch with bounded exponential backoff + jitter. Retries are
 * deliberately GATED by server name: only endpoints that are idempotent or
 * already dedup their writes (e.g. the marker-guarded comment publishers) are
 * retried, so a retry can never produce a duplicate PR comment. Non-idempotent
 * endpoints pass through unchanged.
 */

import type { Logger } from "pino";

/**
 * MCP server names whose tool calls are safe to retry because re-invoking the
 * same call does not double-apply a side effect:
 *  - github_comment / github_inline_comment: guarded by the review-output-key
 *    marker / publication gate (a retry that finds the prior comment skips).
 *  - github_ci: read-only (CI status lookups).
 *  - review_checkpoint: keyed by a stable reviewOutputKey; re-saving is a no-op.
 *  - github_issue_label: GitHub's add-labels API is idempotent.
 *
 * Intentionally EXCLUDED (no dedup — a retry could duplicate output):
 *  reviewCommentThread, github_issue_comment, review_candidate_finding.
 */
export const RETRY_SAFE_MCP_SERVERS: ReadonlySet<string> = new Set([
  "github_comment",
  "github_inline_comment",
  "github_ci",
  "review_checkpoint",
  "github_issue_label",
]);

const RETRYABLE_STATUS = new Set([502, 503, 504]);

export interface McpFetchRetryOptions {
  /** Base URL the agent uses for MCP servers (MCP_BASE_URL). */
  mcpBaseUrl: string;
  /** Total attempts including the first (default 3 → up to 2 retries). */
  maxAttempts?: number;
  /** Base backoff in ms; attempt N waits ~baseDelayMs * 2^(N-1) with jitter. */
  baseDelayMs?: number;
  /** Upper bound on a single backoff wait. */
  maxDelayMs?: number;
  /** Server names eligible for retry (defaults to RETRY_SAFE_MCP_SERVERS). */
  retrySafeServers?: ReadonlySet<string>;
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
 * Extract the MCP server name from a callback URL, or undefined if the URL is
 * not an MCP endpoint under `mcpBaseUrl`.
 */
export function mcpServerNameForUrl(url: string, mcpBaseUrl: string): string | undefined {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return undefined;
  }
  // Only treat requests aimed at the configured MCP host as MCP traffic.
  const base = mcpBaseUrl.replace(/\/+$/, "");
  let baseHost: string | undefined;
  try {
    baseHost = new URL(base).host;
  } catch {
    baseHost = undefined;
  }
  if (baseHost) {
    try {
      if (new URL(url).host !== baseHost) return undefined;
    } catch {
      return undefined;
    }
  }
  const marker = "/internal/mcp/";
  const idx = pathname.indexOf(marker);
  if (idx === -1) return undefined;
  const rest = pathname.slice(idx + marker.length);
  const name = rest.split("/")[0];
  return name || undefined;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (signal?.aborted) {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener?.("abort", onAbort);
      resolve(true);
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

/**
 * Wrap a fetch implementation with gated, bounded retry for MCP callbacks.
 * Non-MCP requests, non-POST requests, and requests to non-retry-safe servers
 * pass straight through to `baseFetch`.
 */
export function createRetryingFetch(
  baseFetch: typeof fetch,
  options: McpFetchRetryOptions,
): typeof fetch {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const baseDelayMs = options.baseDelayMs ?? 250;
  const maxDelayMs = options.maxDelayMs ?? 2_000;
  const retrySafe = options.retrySafeServers ?? RETRY_SAFE_MCP_SERVERS;
  const sleep = options.sleepFn ?? defaultSleep;
  const random = options.randomFn ?? Math.random;
  const logger = options.logger;

  const backoffFor = (attempt: number): number => {
    const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
    // Full jitter in [0, exp] avoids synchronized retry storms.
    return Math.floor(exp * random());
  };

  const retryingFetch = (async (input: FetchInput, init?: FetchInit): Promise<Response> => {
    const url = requestUrl(input);
    const serverName = mcpServerNameForUrl(url, options.mcpBaseUrl);
    const method = requestMethod(input, init);
    const eligible =
      serverName !== undefined && method === "POST" && retrySafe.has(serverName);

    if (!eligible) {
      return baseFetch(input, init);
    }

    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);

    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await baseFetch(input, init);
        if (attempt < maxAttempts && RETRYABLE_STATUS.has(response.status)) {
          const delay = backoffFor(attempt);
          logger?.warn(
            {
              event: "mcp-fetch-retry",
              serverName,
              attempt,
              maxAttempts,
              status: response.status,
              backoffMs: delay,
            },
            "MCP callback returned retryable status; retrying",
          );
          // Release the body so the connection can be reused.
          await response.body?.cancel?.().catch(() => {});
          const slept = await sleep(delay, signal ?? undefined);
          if (!slept) return response; // aborted during backoff
          continue;
        }
        return response;
      } catch (err) {
        lastError = err;
        // An explicit abort is not a transient failure — do not retry it.
        if (signal?.aborted) throw err;
        if (attempt >= maxAttempts) throw err;
        const delay = backoffFor(attempt);
        logger?.warn(
          {
            event: "mcp-fetch-retry",
            serverName,
            attempt,
            maxAttempts,
            error: err instanceof Error ? err.message : String(err),
            backoffMs: delay,
          },
          "MCP callback threw; retrying",
        );
        const slept = await sleep(delay, signal ?? undefined);
        if (!slept) throw err; // aborted during backoff
      }
    }
    // Unreachable: the loop either returns or throws.
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
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
