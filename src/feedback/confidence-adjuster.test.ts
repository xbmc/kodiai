import { describe, expect, test } from "bun:test";
import type { Logger } from "pino";
import type { FeedbackPattern, FeedbackSuppressionConfig } from "./types.ts";
import type { KnowledgeStore } from "../knowledge/types.ts";
import { adjustConfidenceForFeedback } from "./confidence-adjuster.ts";
import { evaluateFeedbackSuppressions } from "./index.ts";

describe("adjustConfidenceForFeedback", () => {
  test("no change with zero feedback", () => {
    expect(adjustConfidenceForFeedback(50, { thumbsUp: 0, thumbsDown: 0 })).toBe(50);
  });

  test("adds +10 per thumbs-up", () => {
    expect(adjustConfidenceForFeedback(50, { thumbsUp: 3, thumbsDown: 0 })).toBe(80);
  });

  test("subtracts -20 per thumbs-down and clamps at 0", () => {
    expect(adjustConfidenceForFeedback(50, { thumbsUp: 0, thumbsDown: 3 })).toBe(0);
  });

  test("subtracts -20 per thumbs-down", () => {
    expect(adjustConfidenceForFeedback(80, { thumbsUp: 0, thumbsDown: 1 })).toBe(60);
  });

  test("clamps at 100", () => {
    expect(adjustConfidenceForFeedback(90, { thumbsUp: 2, thumbsDown: 0 })).toBe(100);
  });

  test("applies both thumbs-up and thumbs-down", () => {
    // 30 + (1*10) - (1*20) = 20
    expect(adjustConfidenceForFeedback(30, { thumbsUp: 1, thumbsDown: 1 })).toBe(20);
  });

  test("clamps at 0 when result would be negative", () => {
    expect(adjustConfidenceForFeedback(5, { thumbsUp: 0, thumbsDown: 1 })).toBe(0);
  });
});

function createNoopLogger(): Logger {
  const noop = () => undefined;
  return {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: () => createNoopLogger(),
  } as unknown as Logger;
}

function createMockStore(patterns: FeedbackPattern[]): KnowledgeStore {
  return {
    aggregateFeedbackPatterns: (_repo: string) => patterns,
  } as unknown as KnowledgeStore;
}

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

describe("evaluateFeedbackSuppressions", () => {
  const defaultConfig: FeedbackSuppressionConfig = {
    enabled: true,
    thresholds: {
      minThumbsDown: 3,
      minDistinctReactors: 3,
      minDistinctPRs: 2,
    },
  };

  test("early-returns empty result when config.enabled is false", () => {
    const store = createMockStore([
      makePattern({ thumbsDownCount: 10, distinctReactors: 10, distinctPRs: 10 }),
    ]);
    const result = evaluateFeedbackSuppressions({
      store,
      repo: "owner/repo",
      config: { ...defaultConfig, enabled: false },
      logger: createNoopLogger(),
    });
    expect(result.suppressedFingerprints.size).toBe(0);
    expect(result.suppressedPatternCount).toBe(0);
    expect(result.patterns).toHaveLength(0);
  });

  test("filters out safety-protected patterns", () => {
    const critical = makePattern({
      fingerprint: "fp-critical",
      severity: "critical",
      category: "security",
    });
    const medium = makePattern({
      fingerprint: "fp-medium",
      severity: "medium",
      category: "style",
    });
    const store = createMockStore([critical, medium]);
    const result = evaluateFeedbackSuppressions({
      store,
      repo: "owner/repo",
      config: defaultConfig,
      logger: createNoopLogger(),
    });
    expect(result.suppressedFingerprints.has("fp-medium")).toBe(true);
    expect(result.suppressedFingerprints.has("fp-critical")).toBe(false);
    expect(result.suppressedPatternCount).toBe(1);
    expect(result.patterns).toHaveLength(1);
    expect(result.patterns[0]!.fingerprint).toBe("fp-medium");
  });

  test("filters out major security patterns (safety-protected)", () => {
    const majorSecurity = makePattern({
      fingerprint: "fp-major-sec",
      severity: "major",
      category: "security",
    });
    const majorStyle = makePattern({
      fingerprint: "fp-major-style",
      severity: "major",
      category: "style",
    });
    const store = createMockStore([majorSecurity, majorStyle]);
    const result = evaluateFeedbackSuppressions({
      store,
      repo: "owner/repo",
      config: defaultConfig,
      logger: createNoopLogger(),
    });
    expect(result.suppressedFingerprints.has("fp-major-sec")).toBe(false);
    expect(result.suppressedFingerprints.has("fp-major-style")).toBe(true);
    expect(result.suppressedPatternCount).toBe(1);
  });

  test("returns correct fingerprints set and count", () => {
    const p1 = makePattern({ fingerprint: "fp-1", severity: "medium", category: "style" });
    const p2 = makePattern({ fingerprint: "fp-2", severity: "minor", category: "documentation" });
    const store = createMockStore([p1, p2]);
    const result = evaluateFeedbackSuppressions({
      store,
      repo: "owner/repo",
      config: defaultConfig,
      logger: createNoopLogger(),
    });
    expect(result.suppressedFingerprints.size).toBe(2);
    expect(result.suppressedPatternCount).toBe(2);
    expect(result.patterns).toHaveLength(2);
  });

  test("returns empty result on store error (fail-open)", () => {
    const errorStore = {
      aggregateFeedbackPatterns: () => {
        throw new Error("DB connection failed");
      },
    } as unknown as KnowledgeStore;
    const warnings: string[] = [];
    const logger = {
      ...createNoopLogger(),
      warn: (data: unknown, msg?: string) => {
        warnings.push(msg ?? String(data));
      },
    } as unknown as Logger;
    const result = evaluateFeedbackSuppressions({
      store: errorStore,
      repo: "owner/repo",
      config: defaultConfig,
      logger,
    });
    expect(result.suppressedFingerprints.size).toBe(0);
    expect(result.suppressedPatternCount).toBe(0);
    expect(result.patterns).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
  });
});
