import { describe, test, expect } from "bun:test";
import { rerankByLanguage, DEFAULT_RERANK_CONFIG, type RerankConfig, type RerankedResult } from "./retrieval-rerank.ts";
import type { RetrievalResult, LearningMemoryRecord } from "./types.ts";

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

function makeResult(distance: number, filePath: string, memoryId = 1): RetrievalResult {
  return {
    memoryId,
    distance,
    record: makeRecord({ filePath }),
    sourceRepo: "owner/repo",
  };
}

describe("rerankByLanguage", () => {
  test("same-language boost — TypeScript PR with TypeScript finding", () => {
    const results = [makeResult(0.5, "src/auth/jwt.ts")];
    const reranked = rerankByLanguage({
      results,
      prLanguages: ["TypeScript"],
    });

    expect(reranked).toHaveLength(1);
    expect(reranked[0]!.adjustedDistance).toBeCloseTo(0.5 * 0.85);
    expect(reranked[0]!.languageMatch).toBe(true);
  });

  test("cross-language penalty — TypeScript PR with Python finding", () => {
    const results = [makeResult(0.5, "src/utils.py")];
    const reranked = rerankByLanguage({
      results,
      prLanguages: ["TypeScript"],
    });

    expect(reranked).toHaveLength(1);
    expect(reranked[0]!.adjustedDistance).toBeCloseTo(0.5 * 1.15);
    expect(reranked[0]!.languageMatch).toBe(false);
  });

  test("unknown language neutral — .json filePath gets no boost or penalty", () => {
    const results = [makeResult(0.5, "config/settings.json")];
    const reranked = rerankByLanguage({
      results,
      prLanguages: ["TypeScript"],
    });

    expect(reranked).toHaveLength(1);
    expect(reranked[0]!.adjustedDistance).toBeCloseTo(0.5 * 1.0);
    expect(reranked[0]!.languageMatch).toBe(false);
  });

  test("re-sort order — mixed results sorted by adjustedDistance ascending", () => {
    const results = [
      makeResult(0.3, "src/utils.py", 1),    // cross-language: 0.3 * 1.15 = 0.345
      makeResult(0.4, "src/auth.ts", 2),      // same-language: 0.4 * 0.85 = 0.34
      makeResult(0.35, "config.json", 3),      // neutral: 0.35 * 1.0 = 0.35
    ];
    const reranked = rerankByLanguage({
      results,
      prLanguages: ["TypeScript"],
    });

    expect(reranked).toHaveLength(3);
    // After re-ranking: auth.ts (0.34) < utils.py (0.345) < config.json (0.35)
    expect(reranked[0]!.memoryId).toBe(2);
    expect(reranked[1]!.memoryId).toBe(1);
    expect(reranked[2]!.memoryId).toBe(3);
  });

  test("custom config — custom boost and penalty factors applied correctly", () => {
    const results = [
      makeResult(0.5, "src/auth.ts", 1),
      makeResult(0.5, "src/utils.py", 2),
    ];
    const config: RerankConfig = {
      sameLanguageBoost: 0.7,
      crossLanguagePenalty: 1.3,
    };
    const reranked = rerankByLanguage({
      results,
      prLanguages: ["TypeScript"],
      config,
    });

    expect(reranked[0]!.adjustedDistance).toBeCloseTo(0.5 * 0.7); // TS match
    expect(reranked[1]!.adjustedDistance).toBeCloseTo(0.5 * 1.3); // Python cross
  });

  test("empty results — empty array in, empty array out", () => {
    const reranked = rerankByLanguage({
      results: [],
      prLanguages: ["TypeScript"],
    });

    expect(reranked).toHaveLength(0);
  });

  test("ordering change — cross-language with low distance still beats same-language with high distance", () => {
    const results = [
      makeResult(0.10, "src/utils.py", 1),   // cross: 0.10 * 1.15 = 0.115
      makeResult(0.25, "src/auth.ts", 2),     // same: 0.25 * 0.85 = 0.2125
    ];
    const reranked = rerankByLanguage({
      results,
      prLanguages: ["TypeScript"],
    });

    // Cross-language with distance 0.10 should still be first (0.115 < 0.2125)
    expect(reranked[0]!.memoryId).toBe(1);
    expect(reranked[1]!.memoryId).toBe(2);
  });

  test("multiple PR languages — findings in either language get the boost", () => {
    const results = [
      makeResult(0.5, "src/auth.ts", 1),      // TypeScript — matches
      makeResult(0.5, "src/utils.py", 2),      // Python — matches
      makeResult(0.5, "src/main.go", 3),       // Go — no match
    ];
    const reranked = rerankByLanguage({
      results,
      prLanguages: ["TypeScript", "Python"],
    });

    expect(reranked[0]!.languageMatch).toBe(true);
    expect(reranked[1]!.languageMatch).toBe(true);
    expect(reranked[2]!.languageMatch).toBe(false);
    expect(reranked[0]!.adjustedDistance).toBeCloseTo(0.5 * 0.85);
    expect(reranked[1]!.adjustedDistance).toBeCloseTo(0.5 * 0.85);
    expect(reranked[2]!.adjustedDistance).toBeCloseTo(0.5 * 1.15);
  });

  test("DEFAULT_RERANK_CONFIG has expected values", () => {
    expect(DEFAULT_RERANK_CONFIG.sameLanguageBoost).toBe(0.85);
    expect(DEFAULT_RERANK_CONFIG.crossLanguagePenalty).toBe(1.15);
  });
});
