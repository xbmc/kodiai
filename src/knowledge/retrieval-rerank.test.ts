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

function makeResult(distance: number, filePath: string, memoryId = 1, language?: string): RetrievalResult {
  return {
    memoryId,
    distance,
    record: makeRecord({ filePath, language }),
    sourceRepo: "owner/repo",
  };
}

describe("rerankByLanguage", () => {
  // --- Stored language field (new behavior) ---

  test("stored language boost — record.language 'typescript' with prLanguages ['typescript'] gets boost", () => {
    const results = [makeResult(0.5, "src/auth.ts", 1, "typescript")];
    const reranked = rerankByLanguage({
      results,
      prLanguages: ["typescript"],
    });

    expect(reranked).toHaveLength(1);
    expect(reranked[0]!.adjustedDistance).toBeCloseTo(0.5 * 0.85);
    expect(reranked[0]!.languageMatch).toBe(true);
  });

  test("no penalty — record.language 'python' with prLanguages ['typescript'] gets NO penalty (multiplier 1.0)", () => {
    const results = [makeResult(0.5, "src/utils.py", 1, "python")];
    const reranked = rerankByLanguage({
      results,
      prLanguages: ["typescript"],
    });

    expect(reranked).toHaveLength(1);
    // NO penalty — stays at original distance
    expect(reranked[0]!.adjustedDistance).toBeCloseTo(0.5 * 1.0);
    expect(reranked[0]!.languageMatch).toBe(false);
  });

  test("unknown language neutral — record.language 'unknown' gets no boost or penalty (multiplier 1.0)", () => {
    const results = [makeResult(0.5, "config/settings.json", 1, "unknown")];
    const reranked = rerankByLanguage({
      results,
      prLanguages: ["typescript"],
    });

    expect(reranked).toHaveLength(1);
    expect(reranked[0]!.adjustedDistance).toBeCloseTo(0.5 * 1.0);
    expect(reranked[0]!.languageMatch).toBe(false);
  });

  test("undefined language fallback — record without language field falls back to classifyFileLanguage(filePath)", () => {
    // No language field set — should fall back to classifyFileLanguage("src/auth/jwt.ts") = "TypeScript"
    const results = [makeResult(0.5, "src/auth/jwt.ts", 1, undefined)];
    const reranked = rerankByLanguage({
      results,
      prLanguages: ["TypeScript"],
    });

    expect(reranked).toHaveLength(1);
    // Falls back to classifyFileLanguage which returns "TypeScript" (Title Case)
    // Must still match prLanguages ["TypeScript"]
    expect(reranked[0]!.adjustedDistance).toBeCloseTo(0.5 * 0.85);
    expect(reranked[0]!.languageMatch).toBe(true);
  });

  test("related language affinity — record.language 'c' with prLanguages ['cpp'] gets partial boost (50% of exact)", () => {
    // Related: c and cpp are related. Boost = 1.0 - (1.0 - 0.85) * 0.5 = 0.925
    const results = [makeResult(0.5, "src/utils.c", 1, "c")];
    const reranked = rerankByLanguage({
      results,
      prLanguages: ["cpp"],
    });

    expect(reranked).toHaveLength(1);
    // Partial boost: 1.0 - (1.0 - 0.85) * 0.5 = 0.925
    expect(reranked[0]!.adjustedDistance).toBeCloseTo(0.5 * 0.925);
    expect(reranked[0]!.languageMatch).toBe(false); // partial match, not exact
  });

  test("related language affinity — record.language 'cpp' with prLanguages ['c'] gets partial boost", () => {
    const results = [makeResult(0.5, "src/main.cpp", 1, "cpp")];
    const reranked = rerankByLanguage({
      results,
      prLanguages: ["c"],
    });

    expect(reranked).toHaveLength(1);
    expect(reranked[0]!.adjustedDistance).toBeCloseTo(0.5 * 0.925);
    expect(reranked[0]!.languageMatch).toBe(false);
  });

  test("same-language boost — TypeScript PR with TypeScript finding (case-insensitive via fallback)", () => {
    // Legacy test: no stored language, file-path classification gives "TypeScript"
    const results = [makeResult(0.5, "src/auth/jwt.ts")];
    const reranked = rerankByLanguage({
      results,
      prLanguages: ["TypeScript"],
    });

    expect(reranked).toHaveLength(1);
    expect(reranked[0]!.adjustedDistance).toBeCloseTo(0.5 * 0.85);
    expect(reranked[0]!.languageMatch).toBe(true);
  });

  test("no penalty replaces cross-language penalty — TypeScript PR with Python finding (no penalty)", () => {
    // OLD behavior: 0.5 * 1.15. NEW behavior: 0.5 * 1.0 (no penalty)
    const results = [makeResult(0.5, "src/utils.py")];
    const reranked = rerankByLanguage({
      results,
      prLanguages: ["TypeScript"],
    });

    expect(reranked).toHaveLength(1);
    // No penalty — original distance unchanged
    expect(reranked[0]!.adjustedDistance).toBeCloseTo(0.5 * 1.0);
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
      makeResult(0.3, "src/utils.py", 1, "python"),   // no-penalty: 0.3 * 1.0 = 0.3
      makeResult(0.4, "src/auth.ts", 2, "typescript"), // boost: 0.4 * 0.85 = 0.34
      makeResult(0.35, "config.json", 3),               // neutral: 0.35 * 1.0 = 0.35
    ];
    const reranked = rerankByLanguage({
      results,
      prLanguages: ["TypeScript"],
    });

    expect(reranked).toHaveLength(3);
    // After re-ranking: utils.py (0.3) < auth.ts (0.34) < config.json (0.35)
    expect(reranked[0]!.memoryId).toBe(1); // python no-penalty, lowest distance
    expect(reranked[1]!.memoryId).toBe(2); // typescript boosted: 0.34
    expect(reranked[2]!.memoryId).toBe(3); // neutral: 0.35
  });

  test("custom config — custom boost and relatedLanguageRatio applied correctly", () => {
    const results = [
      makeResult(0.5, "src/auth.ts", 1, "typescript"),
      makeResult(0.5, "src/utils.py", 2, "python"),
    ];
    const config: RerankConfig = {
      sameLanguageBoost: 0.7,
      relatedLanguageRatio: 0.5,
    };
    const reranked = rerankByLanguage({
      results,
      prLanguages: ["TypeScript"],
      config,
    });

    expect(reranked[0]!.adjustedDistance).toBeCloseTo(0.5 * 0.7); // TS match
    expect(reranked[1]!.adjustedDistance).toBeCloseTo(0.5 * 1.0); // Python: no penalty
  });

  test("empty results — empty array in, empty array out", () => {
    const reranked = rerankByLanguage({
      results: [],
      prLanguages: ["TypeScript"],
    });

    expect(reranked).toHaveLength(0);
  });

  test("ordering change — no-penalty cross-lang with low distance beats same-language with high distance", () => {
    const results = [
      makeResult(0.10, "src/utils.py", 1, "python"),   // no-penalty: 0.10 * 1.0 = 0.10
      makeResult(0.25, "src/auth.ts", 2, "typescript"), // boost: 0.25 * 0.85 = 0.2125
    ];
    const reranked = rerankByLanguage({
      results,
      prLanguages: ["TypeScript"],
    });

    // Python result with distance 0.10 should still be first (0.10 < 0.2125)
    expect(reranked[0]!.memoryId).toBe(1);
    expect(reranked[1]!.memoryId).toBe(2);
  });

  test("multiple PR languages — findings in either language get the boost, others get no penalty", () => {
    const results = [
      makeResult(0.5, "src/auth.ts", 1, "typescript"),  // TypeScript — matches
      makeResult(0.5, "src/utils.py", 2, "python"),     // Python — matches
      makeResult(0.5, "src/main.go", 3, "go"),          // Go — no match, no penalty
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
    // Go gets NO penalty — original distance preserved
    expect(reranked[2]!.adjustedDistance).toBeCloseTo(0.5 * 1.0);
  });

  test("DEFAULT_RERANK_CONFIG has expected values", () => {
    expect(DEFAULT_RERANK_CONFIG.sameLanguageBoost).toBe(0.85);
    expect(DEFAULT_RERANK_CONFIG.relatedLanguageRatio).toBe(0.5);
  });
});
