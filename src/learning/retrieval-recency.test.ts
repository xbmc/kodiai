import { describe, test, expect } from "bun:test";
import { applyRecencyWeighting } from "./retrieval-recency.ts";
import type { RerankedResult } from "./retrieval-rerank.ts";
import type { LearningMemoryRecord } from "./types.ts";

function makeRecord(overrides: Partial<LearningMemoryRecord> = {}): LearningMemoryRecord {
  return {
    repo: "owner/repo",
    owner: "owner",
    findingId: 1,
    reviewId: 1,
    sourceRepo: "owner/repo",
    findingText: "Some finding",
    severity: "major",
    category: "correctness",
    filePath: "src/index.ts",
    outcome: "accepted",
    embeddingModel: "voyage-code-3",
    embeddingDim: 1024,
    stale: false,
    ...overrides,
  };
}

function isoDaysAgo(now: Date, daysAgo: number): string {
  const msPerDay = 86_400_000;
  return new Date(now.getTime() - daysAgo * msPerDay).toISOString();
}

function makeRerankedResult(params: {
  memoryId: number;
  adjustedDistance: number;
  severity: LearningMemoryRecord["severity"];
  createdAt?: string;
}): RerankedResult {
  const { memoryId, adjustedDistance, severity, createdAt } = params;

  return {
    memoryId,
    distance: adjustedDistance,
    adjustedDistance,
    languageMatch: true,
    record: makeRecord({ severity, createdAt }),
    sourceRepo: "owner/repo",
  };
}

describe("applyRecencyWeighting", () => {
  test("recent results score better than old results", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");

    const recent = makeRerankedResult({
      memoryId: 1,
      adjustedDistance: 0.2,
      severity: "major",
      createdAt: isoDaysAgo(now, 7),
    });
    const old = makeRerankedResult({
      memoryId: 2,
      adjustedDistance: 0.2,
      severity: "major",
      createdAt: isoDaysAgo(now, 200),
    });

    const weighted = applyRecencyWeighting({ results: [old, recent], now });

    expect(weighted).toHaveLength(2);
    expect(weighted[0]!.memoryId).toBe(1);
    expect(weighted[0]!.adjustedDistance).toBeLessThan(weighted[1]!.adjustedDistance);
  });

  test("CRITICAL floor at 0.3", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const r = makeRerankedResult({
      memoryId: 1,
      adjustedDistance: 0.2,
      severity: "critical",
      createdAt: isoDaysAgo(now, 365),
    });

    const weighted = applyRecencyWeighting({ results: [r], now });
    expect(weighted[0]!.adjustedDistance).toBeCloseTo(0.2 * 1.7);
  });

  test("non-critical results have lower floor (0.15)", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const r = makeRerankedResult({
      memoryId: 1,
      adjustedDistance: 0.2,
      severity: "minor",
      createdAt: isoDaysAgo(now, 365),
    });

    const weighted = applyRecencyWeighting({ results: [r], now });
    expect(weighted[0]!.adjustedDistance).toBeCloseTo(0.2 * 1.85);
  });

  test("missing createdAt treated as recent", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const r = makeRerankedResult({
      memoryId: 1,
      adjustedDistance: 0.2,
      severity: "major",
      createdAt: undefined,
    });

    const weighted = applyRecencyWeighting({ results: [r], now });
    expect(weighted[0]!.adjustedDistance).toBeCloseTo(0.2);
  });

  test("output is re-sorted by adjustedDistance", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");

    // Without recency weighting, the old result would win (0.20 < 0.25).
    // With weighting, the old result gets penalized enough to lose.
    const recent = makeRerankedResult({
      memoryId: 1,
      adjustedDistance: 0.25,
      severity: "major",
      createdAt: isoDaysAgo(now, 5),
    });
    const old = makeRerankedResult({
      memoryId: 2,
      adjustedDistance: 0.2,
      severity: "major",
      createdAt: isoDaysAgo(now, 365),
    });

    const weighted = applyRecencyWeighting({ results: [old, recent], now });
    expect(weighted[0]!.memoryId).toBe(1);
    expect(weighted[1]!.memoryId).toBe(2);
  });

  test("input array not mutated", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const a = makeRerankedResult({
      memoryId: 1,
      adjustedDistance: 0.2,
      severity: "major",
      createdAt: isoDaysAgo(now, 7),
    });
    const b = makeRerankedResult({
      memoryId: 2,
      adjustedDistance: 0.2,
      severity: "major",
      createdAt: isoDaysAgo(now, 200),
    });

    const results: RerankedResult[] = [a, b];
    const original = results.map((r) => ({ ...r, record: { ...r.record } }));

    void applyRecencyWeighting({ results, now });

    expect(results).toEqual(original);
    expect(results[0]).toBe(a);
    expect(results[1]).toBe(b);
    expect(results[0]!.adjustedDistance).toBe(0.2);
    expect(results[1]!.adjustedDistance).toBe(0.2);
  });
});
