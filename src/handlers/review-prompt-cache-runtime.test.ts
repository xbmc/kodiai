import { describe, expect, test } from "bun:test";
import type { PromptBuildResult } from "../execution/prompt-section-metrics.ts";
import type { SearchCache } from "../lib/search-cache.ts";
import type { ReviewPromptCacheState } from "../review-orchestration/review-prompt-cache-events.ts";
import { buildReviewPromptResultWithCache } from "./review-prompt-cache-runtime.ts";

type TestContext = {
  owner: string;
  repo: string;
};

function makePromptResult(text: string): PromptBuildResult {
  return { text, sections: [] };
}

function makeCache(overrides: Partial<SearchCache<PromptBuildResult>> = {}): SearchCache<PromptBuildResult> {
  return {
    get: () => undefined,
    set: () => {},
    getOrLoad: async (_key, loader) => loader(),
    purgeExpired: () => 0,
    ...overrides,
  };
}

describe("buildReviewPromptResultWithCache", () => {
  test("bypasses cache and records missing signals when fingerprint is incomplete", async () => {
    let builderCalls = 0;
    const statusTarget: ReviewPromptCacheState = { status: "hit", reason: null };
    const result = await buildReviewPromptResultWithCache<TestContext>({
      cacheQuery: "initial:42:abc123",
      context: { owner: "acme", repo: "widgets" },
      statusTarget,
      promptBuilder: async () => {
        builderCalls += 1;
        return makePromptResult("fresh prompt");
      },
      cache: makeCache({
        getOrLoad: async () => {
          throw new Error("cache should not be used");
        },
      }),
      getCacheErrorCount: () => 0,
      buildFingerprint: () => ({
        fingerprint: null,
        missingSignals: ["head-sha"],
      }),
      logger: { warn: () => {} },
    });

    expect(result.text).toBe("fresh prompt");
    expect(builderCalls).toBe(1);
    expect(statusTarget).toEqual({
      status: "bypass",
      reason: "incomplete-fingerprint",
      missingSignalNames: ["head-sha"],
    });
  });

  test("records a cache miss with fingerprint safety signals when the loader runs", async () => {
    const statusTarget: ReviewPromptCacheState = { status: "bypass", reason: null };
    const result = await buildReviewPromptResultWithCache<TestContext>({
      cacheQuery: "initial:42:abc123",
      context: { owner: "acme", repo: "widgets" },
      statusTarget,
      promptBuilder: async () => makePromptResult("loaded prompt"),
      cache: makeCache(),
      getCacheErrorCount: () => 0,
      buildFingerprint: () => ({
        fingerprint: "fingerprint-1",
        missingSignals: [],
      }),
      logger: { warn: () => {} },
    });

    expect(result.text).toBe("loaded prompt");
    expect(statusTarget).toEqual({
      status: "miss",
      reason: null,
      fingerprintVersion: "review-prompt-v1",
      safetySignalNames: ["prompt-fingerprint-v1", "prompt-cache-query-head-sha"],
    });
  });

  test("records degraded cache state and rebuilds directly when cache lookup fails", async () => {
    const warnings: Array<{ fields: Record<string, unknown>; message?: string }> = [];
    const error = new Error("cache unavailable");
    const statusTarget: ReviewPromptCacheState = { status: "hit", reason: null };
    const result = await buildReviewPromptResultWithCache<TestContext>({
      cacheQuery: "retry:42:key",
      context: { owner: "acme", repo: "widgets" },
      statusTarget,
      promptBuilder: async () => makePromptResult("rebuilt prompt"),
      cache: makeCache({
        getOrLoad: async () => {
          throw error;
        },
      }),
      getCacheErrorCount: () => 3,
      buildFingerprint: () => ({
        fingerprint: "fingerprint-2",
        missingSignals: [],
      }),
      logger: {
        warn: (fields, message) => {
          warnings.push({ fields, message });
        },
      },
    });

    expect(result.text).toBe("rebuilt prompt");
    expect(statusTarget).toEqual({
      status: "degraded",
      reason: "cache-bookkeeping-error",
      bookkeepingErrorCount: 1,
    });
    expect(warnings).toEqual([{
      fields: {
        err: error,
        gate: "review-derived-prompt-cache",
        gateResult: "degraded",
        cacheQuery: "retry:42:key",
      },
      message: "Review prompt cache lookup failed; rebuilding directly",
    }]);
  });
});
