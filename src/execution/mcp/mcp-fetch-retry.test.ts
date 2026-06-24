import { describe, test, expect } from "bun:test";
import { createRetryingFetch, normalizeMcpUrlKey } from "./mcp-fetch-retry.ts";

const BASE = "http://ca-kodiai";
const SAFE_URL = `${BASE}/internal/mcp/github_comment`;
const UNSAFE_URL = `${BASE}/internal/mcp/github_issue_comment`;
const retrySafeUrls = new Set([normalizeMcpUrlKey(SAFE_URL)!]);

// Deterministic helpers so tests never actually sleep or jitter.
const noSleep = () => Promise.resolve(true);
const noJitter = () => 0.999; // ~full backoff, but sleep is stubbed so it's free.

function jsonResponse(status: number): Response {
  return new Response(JSON.stringify({ status }), { status });
}

/** A baseFetch that returns a scripted sequence of statuses (or throws). */
function scriptedFetch(steps: Array<number | Error>) {
  let i = 0;
  const fn = (async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => {
    const step = steps[Math.min(i, steps.length - 1)]!;
    i++;
    if (step instanceof Error) throw step;
    return jsonResponse(step);
  }) as typeof fetch;
  return { fn, attempts: () => i };
}

const post = (url: string) => [url, { method: "POST", body: "{}" }] as const;

function makeFetch(base: { fn: typeof fetch }, overrides = {}) {
  return createRetryingFetch(base.fn, {
    retrySafeUrls,
    sleepFn: noSleep,
    randomFn: noJitter,
    ...overrides,
  });
}

describe("normalizeMcpUrlKey", () => {
  test("returns origin + pathname, ignoring query and hash", () => {
    expect(normalizeMcpUrlKey(`${SAFE_URL}?session=abc#x`)).toBe(SAFE_URL);
  });

  test("a trailing-slash-free and host-qualified URL normalize to the same key", () => {
    expect(normalizeMcpUrlKey(SAFE_URL)).toBe(`${BASE}/internal/mcp/github_comment`);
  });

  test("returns undefined for an unparseable URL", () => {
    expect(normalizeMcpUrlKey("not a url")).toBeUndefined();
  });
});

describe("createRetryingFetch", () => {
  test("retries a retry-safe URL on 503 then succeeds", async () => {
    const base = scriptedFetch([503, 200]);
    const res = await makeFetch(base)(...post(SAFE_URL));
    expect(res.status).toBe(200);
    expect(base.attempts()).toBe(2);
  });

  test("gives up after maxAttempts and returns the last retryable response", async () => {
    const base = scriptedFetch([503, 503, 503]);
    const res = await makeFetch(base, { maxAttempts: 3 })(...post(SAFE_URL));
    expect(res.status).toBe(503);
    expect(base.attempts()).toBe(3);
  });

  test("retries on a thrown network error then succeeds", async () => {
    const base = scriptedFetch([new Error("ECONNRESET"), 200]);
    const res = await makeFetch(base)(...post(SAFE_URL));
    expect(res.status).toBe(200);
    expect(base.attempts()).toBe(2);
  });

  test("does NOT retry URLs absent from the retry-safe set (would duplicate output)", async () => {
    const base = scriptedFetch([503, 200]);
    const res = await makeFetch(base)(...post(UNSAFE_URL));
    expect(res.status).toBe(503);
    expect(base.attempts()).toBe(1);
  });

  test("matches the retry-safe key even with session query params", async () => {
    const base = scriptedFetch([503, 200]);
    const res = await makeFetch(base)(...post(`${SAFE_URL}?session=xyz`));
    expect(res.status).toBe(200);
    expect(base.attempts()).toBe(2);
  });

  test("does NOT retry GET (the SSE notification stream)", async () => {
    const base = scriptedFetch([503, 200]);
    const res = await makeFetch(base)(SAFE_URL, { method: "GET" });
    expect(res.status).toBe(503);
    expect(base.attempts()).toBe(1);
  });

  test("does NOT retry non-retryable statuses (e.g. 401/404)", async () => {
    const base = scriptedFetch([401, 200]);
    const res = await makeFetch(base)(...post(SAFE_URL));
    expect(res.status).toBe(401);
    expect(base.attempts()).toBe(1);
  });

  test("passes non-MCP requests straight through", async () => {
    const base = scriptedFetch([503, 200]);
    const res = await makeFetch(base)(`${BASE}/webhooks/github`, { method: "POST", body: "{}" });
    expect(res.status).toBe(503);
    expect(base.attempts()).toBe(1);
  });

  test("stops retrying when the abort signal fires during backoff", async () => {
    const base = scriptedFetch([503, 200]);
    const controller = new AbortController();
    const f = createRetryingFetch(base.fn, {
      retrySafeUrls,
      // Simulate the signal aborting while we wait to retry.
      sleepFn: () => {
        controller.abort();
        return Promise.resolve(false);
      },
      randomFn: noJitter,
    });
    const res = await f(SAFE_URL, { method: "POST", body: "{}", signal: controller.signal });
    expect(res.status).toBe(503);
    expect(base.attempts()).toBe(1);
  });

  test("logs a structured retry event keyed on the request target", async () => {
    const warns: Array<Record<string, unknown>> = [];
    const base = scriptedFetch([503, 200]);
    const f = makeFetch(base, {
      logger: { warn: (d: Record<string, unknown>) => warns.push(d), info: () => {} },
    });
    await f(...post(SAFE_URL));
    expect(warns).toContainEqual(
      expect.objectContaining({ event: "mcp-fetch-retry", target: SAFE_URL, attempt: 1, status: 503 }),
    );
  });
});
