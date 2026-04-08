import { test, expect, mock, beforeEach, afterEach } from "bun:test";
import { createRerankProvider } from "./embeddings.ts";
import type { Logger } from "pino";

// Minimal no-op logger stub
const noopLogger = {
  info: () => {},
  warn: () => {},
  debug: () => {},
  error: () => {},
  trace: () => {},
} as unknown as Logger;

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ── No-op provider (empty apiKey) ────────────────────────────────────────────

test("returns null when apiKey is empty", async () => {
  const provider = createRerankProvider({ apiKey: "", logger: noopLogger });
  const result = await provider.rerank({ query: "test", documents: ["a", "b"] });
  expect(result).toBeNull();
});

test("model getter returns rerank-2.5 for no-op provider", () => {
  const provider = createRerankProvider({ apiKey: "", logger: noopLogger });
  expect(provider.model).toBe("rerank-2.5");
});

// ── Active provider (non-empty apiKey) ───────────────────────────────────────

test("model getter returns rerank-2.5", () => {
  const provider = createRerankProvider({ apiKey: "key123", logger: noopLogger });
  expect(provider.model).toBe("rerank-2.5");
});

test("happy path: returns ordered indices", async () => {
  globalThis.fetch = mock(async () =>
    new Response(
      JSON.stringify({ data: [{ index: 1, relevance_score: 0.9 }, { index: 0, relevance_score: 0.7 }] }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )
  ) as unknown as typeof globalThis.fetch;

  const provider = createRerankProvider({ apiKey: "key123", logger: noopLogger });
  const result = await provider.rerank({ query: "q", documents: ["doc0", "doc1"] });
  expect(result).toEqual([1, 0]);
});

test("fail-open on API 500", async () => {
  globalThis.fetch = mock(async () =>
    new Response("Internal Server Error", { status: 500 })
  ) as unknown as typeof globalThis.fetch;

  const provider = createRerankProvider({ apiKey: "key123", logger: noopLogger });
  // voyageFetch has maxRetries:1 — mock handles two attempts
  const result = await provider.rerank({ query: "q", documents: ["a", "b"] });
  expect(result).toBeNull();
});

test("fail-open on network error", async () => {
  globalThis.fetch = mock(async () => {
    throw new Error("Network failure");
  }) as unknown as typeof globalThis.fetch;

  const provider = createRerankProvider({ apiKey: "key123", logger: noopLogger });
  const result = await provider.rerank({ query: "q", documents: ["a", "b"] });
  expect(result).toBeNull();
});

test("fail-open on empty data array", async () => {
  globalThis.fetch = mock(async () =>
    new Response(
      JSON.stringify({ data: [] }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )
  ) as unknown as typeof globalThis.fetch;

  const provider = createRerankProvider({ apiKey: "key123", logger: noopLogger });
  const result = await provider.rerank({ query: "q", documents: ["a"] });
  expect(result).toBeNull();
});

test("includes top_k in request body when topK provided", async () => {
  let capturedBody: Record<string, unknown> | undefined;

  globalThis.fetch = mock(async (_input: unknown, init?: RequestInit) => {
    capturedBody = JSON.parse(init?.body as string);
    return new Response(
      JSON.stringify({ data: [{ index: 0, relevance_score: 0.9 }] }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as unknown as typeof globalThis.fetch;

  const provider = createRerankProvider({ apiKey: "key123", logger: noopLogger });
  await provider.rerank({ query: "q", documents: ["doc0"], topK: 5 });
  expect(capturedBody?.top_k).toBe(5);
});

test("does not include top_k when topK is undefined", async () => {
  let capturedBody: Record<string, unknown> | undefined;

  globalThis.fetch = mock(async (_input: unknown, init?: RequestInit) => {
    capturedBody = JSON.parse(init?.body as string);
    return new Response(
      JSON.stringify({ data: [{ index: 0, relevance_score: 0.9 }] }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as unknown as typeof globalThis.fetch;

  const provider = createRerankProvider({ apiKey: "key123", logger: noopLogger });
  await provider.rerank({ query: "q", documents: ["doc0"] });
  expect(capturedBody?.top_k).toBeUndefined();
});
