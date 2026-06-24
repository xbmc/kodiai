import { describe, test, expect } from "bun:test";
import {
  createRetryingFetch,
  mcpServerNameForUrl,
  RETRY_SAFE_MCP_SERVERS,
} from "./mcp-fetch-retry.ts";

const BASE = "http://ca-kodiai";

// Deterministic helpers so tests never actually sleep or jitter.
const noSleep = () => Promise.resolve(true);
const noJitter = () => 0.999; // ~full backoff, but sleep is stubbed so it's free.

function jsonResponse(status: number): Response {
  return new Response(JSON.stringify({ status }), { status });
}

/** A baseFetch that returns a scripted sequence of statuses (or throws). */
function scriptedFetch(steps: Array<number | Error>) {
  let i = 0;
  const calls: Array<{ url: string; method: string }> = [];
  const fn = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, method: (init?.method ?? "GET").toUpperCase() });
    const step = steps[Math.min(i, steps.length - 1)]!;
    i++;
    if (step instanceof Error) throw step;
    return jsonResponse(step);
  }) as typeof fetch;
  return { fn, calls, attempts: () => i };
}

const post = (url: string) =>
  [url, { method: "POST", body: "{}" }] as const;

describe("mcpServerNameForUrl", () => {
  test("extracts server name from an MCP callback URL", () => {
    expect(mcpServerNameForUrl(`${BASE}/internal/mcp/github_comment`, BASE)).toBe("github_comment");
  });

  test("ignores trailing path segments", () => {
    expect(mcpServerNameForUrl(`${BASE}/internal/mcp/github_ci/extra`, BASE)).toBe("github_ci");
  });

  test("returns undefined for non-MCP paths", () => {
    expect(mcpServerNameForUrl(`${BASE}/webhooks/github`, BASE)).toBeUndefined();
  });

  test("returns undefined when host differs from the configured base", () => {
    expect(
      mcpServerNameForUrl("http://evil.example/internal/mcp/github_comment", BASE),
    ).toBeUndefined();
  });
});

describe("createRetryingFetch", () => {
  test("retries a retry-safe server on 503 then succeeds", async () => {
    const base = scriptedFetch([503, 200]);
    const f = createRetryingFetch(base.fn, {
      mcpBaseUrl: BASE,
      sleepFn: noSleep,
      randomFn: noJitter,
    });
    const res = await f(...post(`${BASE}/internal/mcp/github_comment`));
    expect(res.status).toBe(200);
    expect(base.attempts()).toBe(2);
  });

  test("gives up after maxAttempts and returns the last retryable response", async () => {
    const base = scriptedFetch([503, 503, 503]);
    const f = createRetryingFetch(base.fn, {
      mcpBaseUrl: BASE,
      maxAttempts: 3,
      sleepFn: noSleep,
      randomFn: noJitter,
    });
    const res = await f(...post(`${BASE}/internal/mcp/github_comment`));
    expect(res.status).toBe(503);
    expect(base.attempts()).toBe(3);
  });

  test("retries on a thrown network error then succeeds", async () => {
    const base = scriptedFetch([new Error("ECONNRESET"), 200]);
    const f = createRetryingFetch(base.fn, {
      mcpBaseUrl: BASE,
      sleepFn: noSleep,
      randomFn: noJitter,
    });
    const res = await f(...post(`${BASE}/internal/mcp/review_checkpoint`));
    expect(res.status).toBe(200);
    expect(base.attempts()).toBe(2);
  });

  test("does NOT retry non-idempotent servers (would duplicate output)", async () => {
    const base = scriptedFetch([503, 200]);
    const f = createRetryingFetch(base.fn, {
      mcpBaseUrl: BASE,
      sleepFn: noSleep,
      randomFn: noJitter,
    });
    const res = await f(...post(`${BASE}/internal/mcp/github_issue_comment`));
    expect(res.status).toBe(503);
    expect(base.attempts()).toBe(1);
  });

  test("does NOT retry GET (the SSE notification stream)", async () => {
    const base = scriptedFetch([503, 200]);
    const f = createRetryingFetch(base.fn, {
      mcpBaseUrl: BASE,
      sleepFn: noSleep,
      randomFn: noJitter,
    });
    const res = await f(`${BASE}/internal/mcp/github_comment`, { method: "GET" });
    expect(res.status).toBe(503);
    expect(base.attempts()).toBe(1);
  });

  test("does NOT retry non-retryable statuses (e.g. 401/404)", async () => {
    const base = scriptedFetch([401, 200]);
    const f = createRetryingFetch(base.fn, {
      mcpBaseUrl: BASE,
      sleepFn: noSleep,
      randomFn: noJitter,
    });
    const res = await f(...post(`${BASE}/internal/mcp/github_comment`));
    expect(res.status).toBe(401);
    expect(base.attempts()).toBe(1);
  });

  test("passes non-MCP requests straight through", async () => {
    const base = scriptedFetch([503, 200]);
    const f = createRetryingFetch(base.fn, {
      mcpBaseUrl: BASE,
      sleepFn: noSleep,
      randomFn: noJitter,
    });
    const res = await f(`${BASE}/webhooks/github`, { method: "POST", body: "{}" });
    expect(res.status).toBe(503);
    expect(base.attempts()).toBe(1);
  });

  test("stops retrying when the abort signal fires during backoff", async () => {
    const base = scriptedFetch([503, 200]);
    const controller = new AbortController();
    const f = createRetryingFetch(base.fn, {
      mcpBaseUrl: BASE,
      // Simulate the signal aborting while we wait to retry.
      sleepFn: () => {
        controller.abort();
        return Promise.resolve(false);
      },
      randomFn: noJitter,
    });
    const res = await f(`${BASE}/internal/mcp/github_comment`, {
      method: "POST",
      body: "{}",
      signal: controller.signal,
    });
    expect(res.status).toBe(503);
    expect(base.attempts()).toBe(1);
  });

  test("logs a structured retry event", async () => {
    const warns: Array<Record<string, unknown>> = [];
    const base = scriptedFetch([503, 200]);
    const f = createRetryingFetch(base.fn, {
      mcpBaseUrl: BASE,
      sleepFn: noSleep,
      randomFn: noJitter,
      logger: { warn: (d: Record<string, unknown>) => warns.push(d), info: () => {} },
    });
    await f(...post(`${BASE}/internal/mcp/github_comment`));
    expect(warns).toContainEqual(
      expect.objectContaining({ event: "mcp-fetch-retry", serverName: "github_comment", attempt: 1 }),
    );
  });

  test("RETRY_SAFE_MCP_SERVERS excludes the non-idempotent servers", () => {
    expect(RETRY_SAFE_MCP_SERVERS.has("github_comment")).toBe(true);
    expect(RETRY_SAFE_MCP_SERVERS.has("github_inline_comment")).toBe(true);
    expect(RETRY_SAFE_MCP_SERVERS.has("reviewCommentThread")).toBe(false);
    expect(RETRY_SAFE_MCP_SERVERS.has("github_issue_comment")).toBe(false);
    expect(RETRY_SAFE_MCP_SERVERS.has("review_candidate_finding")).toBe(false);
  });
});
