import { describe, expect, test } from "bun:test";
import {
  computeFileRiskScores,
  triageFilesByRisk,
  applyGraphAwareSelection,
  DEFAULT_RISK_WEIGHTS,
  type RiskWeights,
  type FileRiskScore,
} from "./file-risk-scorer.ts";
import type { ReviewGraphBlastRadiusResult } from "../review-graph/query.ts";

// ---------- computeFileRiskScores ----------

describe("computeFileRiskScores", () => {
  test("auth file scores higher than test file for same line count", () => {
    const perFileStats = new Map([
      ["src/auth/login.ts", { added: 80, removed: 20 }],
      ["src/utils.test.ts", { added: 80, removed: 20 }],
    ]);

    const filesByCategory: Record<string, string[]> = {
      source: ["src/auth/login.ts"],
      test: ["src/utils.test.ts"],
    };

    const scores = computeFileRiskScores({
      files: ["src/auth/login.ts", "src/utils.test.ts"],
      perFileStats,
      filesByCategory,
      weights: DEFAULT_RISK_WEIGHTS,
    });

    const authScore = scores.find((s) => s.filePath === "src/auth/login.ts");
    const testScore = scores.find((s) => s.filePath === "src/utils.test.ts");

    expect(authScore).toBeDefined();
    expect(testScore).toBeDefined();
    expect(authScore!.score).toBeGreaterThan(testScore!.score);
  });

  test("file with 0 lines changed still gets non-zero score from path/category/language", () => {
    const perFileStats = new Map([
      ["src/auth/login.ts", { added: 0, removed: 0 }],
    ]);

    const filesByCategory: Record<string, string[]> = {
      source: ["src/auth/login.ts"],
    };

    const scores = computeFileRiskScores({
      files: ["src/auth/login.ts"],
      perFileStats,
      filesByCategory,
      weights: DEFAULT_RISK_WEIGHTS,
    });

    expect(scores).toHaveLength(1);
    expect(scores[0]!.score).toBeGreaterThan(0);
  });

  test("single file returns score between 0 and 100", () => {
    const perFileStats = new Map([
      ["src/app.ts", { added: 50, removed: 10 }],
    ]);

    const filesByCategory: Record<string, string[]> = {
      source: ["src/app.ts"],
    };

    const scores = computeFileRiskScores({
      files: ["src/app.ts"],
      perFileStats,
      filesByCategory,
      weights: DEFAULT_RISK_WEIGHTS,
    });

    expect(scores).toHaveLength(1);
    expect(scores[0]!.score).toBeGreaterThanOrEqual(0);
    expect(scores[0]!.score).toBeLessThanOrEqual(100);
  });

  test("results are sorted descending by score", () => {
    const perFileStats = new Map([
      ["src/auth/session.ts", { added: 100, removed: 50 }],
      ["README.md", { added: 5, removed: 2 }],
      ["src/utils.ts", { added: 30, removed: 10 }],
    ]);

    const filesByCategory: Record<string, string[]> = {
      source: ["src/auth/session.ts", "src/utils.ts"],
      docs: ["README.md"],
    };

    const scores = computeFileRiskScores({
      files: ["src/auth/session.ts", "README.md", "src/utils.ts"],
      perFileStats,
      filesByCategory,
      weights: DEFAULT_RISK_WEIGHTS,
    });

    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1]!.score).toBeGreaterThanOrEqual(scores[i]!.score);
    }
  });

  test("weights summing to 2.0 still produce valid 0-100 scores (runtime normalization)", () => {
    const doubledWeights: RiskWeights = {
      linesChanged: 0.60,
      pathRisk: 0.60,
      fileCategory: 0.40,
      languageRisk: 0.20,
      fileExtension: 0.20,
    };

    const perFileStats = new Map([
      ["src/app.ts", { added: 50, removed: 10 }],
    ]);

    const filesByCategory: Record<string, string[]> = {
      source: ["src/app.ts"],
    };

    const scores = computeFileRiskScores({
      files: ["src/app.ts"],
      perFileStats,
      filesByCategory,
      weights: doubledWeights,
    });

    expect(scores).toHaveLength(1);
    expect(scores[0]!.score).toBeGreaterThanOrEqual(0);
    expect(scores[0]!.score).toBeLessThanOrEqual(100);
  });
});

// ---------- applyGraphAwareSelection ----------

describe("applyGraphAwareSelection", () => {
  function makeRiskScores(paths: string[]): FileRiskScore[] {
    const baseScores = [80, 70, 60];
    return paths.map((filePath, index) => ({
      filePath,
      score: baseScores[index] ?? Math.max(0, 60 - index * 5),
      breakdown: {
        linesChanged: 50,
        pathRisk: 25,
        fileCategory: 20,
        languageRisk: 10,
        fileExtension: 10,
      },
    }));
  }

  function makeGraphResult(params: {
    impactedFiles?: Array<Pick<ReviewGraphBlastRadiusResult["impactedFiles"][number], "path" | "score" | "confidence">>;
    likelyTests?: Array<Pick<ReviewGraphBlastRadiusResult["likelyTests"][number], "path" | "score" | "confidence">>;
  }): ReviewGraphBlastRadiusResult {
    return {
      changedFiles: ["src/changed.ts"],
      seedSymbols: [],
      impactedFiles: (params.impactedFiles ?? []).map((item) => ({
        path: item.path,
        score: item.score,
        confidence: item.confidence,
        reasons: ["graph impacted"],
        relatedChangedPaths: ["src/changed.ts"],
        languages: ["TypeScript"],
      })),
      probableDependents: [],
      likelyTests: (params.likelyTests ?? []).map((item) => ({
        path: item.path,
        score: item.score,
        confidence: item.confidence,
        reasons: ["graph likely test"],
        relatedChangedPaths: ["src/changed.ts"],
        languages: ["TypeScript"],
        testSymbols: ["suite"],
      })),
      graphStats: {
        files: 3,
        nodes: 5,
        edges: 4,
        changedFilesFound: 1,
      },
    };
  }

  test("preserves baseline ordering when graph data is absent", () => {
    const riskScores = makeRiskScores([
      "src/alpha.ts",
      "src/beta.ts",
      "test/beta.test.ts",
    ]);

    const result = applyGraphAwareSelection({ riskScores });

    expect(result.usedGraph).toBe(false);
    expect(result.graphHits).toBe(0);
    expect(result.graphRankedSelections).toBe(0);
    expect(result.riskScores.map((item) => item.filePath)).toEqual([
      "src/alpha.ts",
      "src/beta.ts",
      "test/beta.test.ts",
    ]);
  });

  test("promotes graph-impacted files and likely tests within bounded sorted output", () => {
    const riskScores = makeRiskScores([
      "src/alpha.ts",
      "src/beta.ts",
      "test/beta.test.ts",
    ]);

    const graph = makeGraphResult({
      impactedFiles: [{ path: "src/beta.ts", score: 0.95, confidence: 1 }],
      likelyTests: [{ path: "test/beta.test.ts", score: 0.9, confidence: 1 }],
    });

    const result = applyGraphAwareSelection({ riskScores, graph });

    expect(result.usedGraph).toBe(true);
    expect(result.graphHits).toBe(2);
    expect(result.graphRankedSelections).toBeGreaterThanOrEqual(0);
    expect(result.riskScores[0]?.filePath).toBe("src/beta.ts");
    expect(
      result.riskScores.find((item) => item.filePath === "test/beta.test.ts")?.score,
    ).toBeGreaterThan(
      riskScores.find((item) => item.filePath === "test/beta.test.ts")?.score ?? 0,
    );
  });

  test("ignores graph paths that are not already in the review set", () => {
    const riskScores = makeRiskScores([
      "src/alpha.ts",
      "src/beta.ts",
    ]);

    const graph = makeGraphResult({
      impactedFiles: [{ path: "src/not-in-review.ts", score: 1, confidence: 1 }],
    });

    const result = applyGraphAwareSelection({ riskScores, graph });

    expect(result.usedGraph).toBe(true);
    expect(result.graphHits).toBe(1);
    expect(result.graphRankedSelections).toBe(0);
    expect(result.riskScores.map((item) => item.filePath)).toEqual([
      "src/alpha.ts",
      "src/beta.ts",
    ]);
  });
});

// ---------- triageFilesByRisk ----------

describe("triageFilesByRisk", () => {
  function makeFakeScores(count: number): FileRiskScore[] {
    return Array.from({ length: count }, (_, i) => ({
      filePath: `src/file-${i}.ts`,
      score: 100 - i,
      breakdown: {
        linesChanged: 50,
        pathRisk: 30,
        fileCategory: 20,
        languageRisk: 10,
        fileExtension: 10,
      },
    }));
  }

  test("below threshold: all files in full tier, isLargePR=false", () => {
    const scores = makeFakeScores(30);
    const result = triageFilesByRisk({
      riskScores: scores,
      fileThreshold: 50,
      fullReviewCount: 30,
      abbreviatedCount: 20,
    });

    expect(result.isLargePR).toBe(false);
    expect(result.full).toHaveLength(30);
    expect(result.abbreviated).toHaveLength(0);
    expect(result.mentionOnly).toHaveLength(0);
    expect(result.totalFiles).toBe(30);
  });

  test("above threshold: correct split into full(30)/abbreviated(20)/mentionOnly(rest)", () => {
    const scores = makeFakeScores(100);
    const result = triageFilesByRisk({
      riskScores: scores,
      fileThreshold: 50,
      fullReviewCount: 30,
      abbreviatedCount: 20,
    });

    expect(result.isLargePR).toBe(true);
    expect(result.full).toHaveLength(30);
    expect(result.abbreviated).toHaveLength(20);
    expect(result.mentionOnly).toHaveLength(50);
    expect(result.totalFiles).toBe(100);
  });

  test("exactly threshold+1 files: isLargePR=true", () => {
    const scores = makeFakeScores(51);
    const result = triageFilesByRisk({
      riskScores: scores,
      fileThreshold: 50,
      fullReviewCount: 30,
      abbreviatedCount: 20,
    });

    expect(result.isLargePR).toBe(true);
    expect(result.full).toHaveLength(30);
    expect(result.abbreviated).toHaveLength(20);
    expect(result.mentionOnly).toHaveLength(1);
  });

  test("empty input: returns empty tiers", () => {
    const result = triageFilesByRisk({
      riskScores: [],
      fileThreshold: 50,
      fullReviewCount: 30,
      abbreviatedCount: 20,
    });

    expect(result.isLargePR).toBe(false);
    expect(result.full).toHaveLength(0);
    expect(result.abbreviated).toHaveLength(0);
    expect(result.mentionOnly).toHaveLength(0);
    expect(result.totalFiles).toBe(0);
  });
});
