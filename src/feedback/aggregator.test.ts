import { describe, expect, test } from "bun:test";
import type { FeedbackPattern, FeedbackThresholds } from "./types.ts";
import type { KnowledgeStore } from "../knowledge/types.ts";
import { aggregateSuppressiblePatterns } from "./aggregator.ts";

function createMockStore(patterns: FeedbackPattern[]): KnowledgeStore {
  return {
    aggregateFeedbackPatterns: (_repo: string) => patterns,
  } as unknown as KnowledgeStore;
}

const DEFAULT_THRESHOLDS: FeedbackThresholds = {
  minThumbsDown: 3,
  minDistinctReactors: 3,
  minDistinctPRs: 2,
};

function makePattern(overrides: Partial<FeedbackPattern> = {}): FeedbackPattern {
  return {
    fingerprint: "fp-test",
    thumbsDownCount: 5,
    thumbsUpCount: 0,
    distinctReactors: 4,
    distinctPRs: 3,
    severity: "medium",
    category: "style",
    sampleTitle: "Test pattern",
    ...overrides,
  };
}

describe("aggregateSuppressiblePatterns", () => {
  test("includes pattern exceeding all thresholds", () => {
    const pattern = makePattern({ thumbsDownCount: 5, distinctReactors: 4, distinctPRs: 3 });
    const store = createMockStore([pattern]);
    const result = aggregateSuppressiblePatterns(store, "owner/repo", DEFAULT_THRESHOLDS);
    expect(result).toHaveLength(1);
    expect(result[0]!.fingerprint).toBe("fp-test");
  });

  test("excludes pattern with thumbsDown below threshold", () => {
    const pattern = makePattern({ thumbsDownCount: 2 });
    const store = createMockStore([pattern]);
    const result = aggregateSuppressiblePatterns(store, "owner/repo", DEFAULT_THRESHOLDS);
    expect(result).toHaveLength(0);
  });

  test("excludes pattern with insufficient distinct reactors", () => {
    const pattern = makePattern({ thumbsDownCount: 3, distinctReactors: 1 });
    const store = createMockStore([pattern]);
    const result = aggregateSuppressiblePatterns(store, "owner/repo", DEFAULT_THRESHOLDS);
    expect(result).toHaveLength(0);
  });

  test("excludes pattern with insufficient distinct PRs", () => {
    const pattern = makePattern({ thumbsDownCount: 3, distinctReactors: 3, distinctPRs: 1 });
    const store = createMockStore([pattern]);
    const result = aggregateSuppressiblePatterns(store, "owner/repo", DEFAULT_THRESHOLDS);
    expect(result).toHaveLength(0);
  });

  test("includes pattern exactly at thresholds", () => {
    const pattern = makePattern({ thumbsDownCount: 3, distinctReactors: 3, distinctPRs: 2 });
    const store = createMockStore([pattern]);
    const result = aggregateSuppressiblePatterns(store, "owner/repo", DEFAULT_THRESHOLDS);
    expect(result).toHaveLength(1);
  });

  test("returns empty array for empty store", () => {
    const store = createMockStore([]);
    const result = aggregateSuppressiblePatterns(store, "owner/repo", DEFAULT_THRESHOLDS);
    expect(result).toHaveLength(0);
  });

  test("respects custom thresholds", () => {
    const pattern = makePattern({ thumbsDownCount: 4, distinctReactors: 4, distinctPRs: 3 });
    const store = createMockStore([pattern]);
    const customThresholds: FeedbackThresholds = {
      minThumbsDown: 5,
      minDistinctReactors: 3,
      minDistinctPRs: 2,
    };
    const result = aggregateSuppressiblePatterns(store, "owner/repo", customThresholds);
    expect(result).toHaveLength(0);
  });

  test("filters mixed patterns correctly", () => {
    const good = makePattern({ fingerprint: "fp-good", thumbsDownCount: 5, distinctReactors: 4, distinctPRs: 3 });
    const bad1 = makePattern({ fingerprint: "fp-bad1", thumbsDownCount: 1, distinctReactors: 4, distinctPRs: 3 });
    const bad2 = makePattern({ fingerprint: "fp-bad2", thumbsDownCount: 5, distinctReactors: 1, distinctPRs: 3 });
    const store = createMockStore([good, bad1, bad2]);
    const result = aggregateSuppressiblePatterns(store, "owner/repo", DEFAULT_THRESHOLDS);
    expect(result).toHaveLength(1);
    expect(result[0]!.fingerprint).toBe("fp-good");
  });
});
