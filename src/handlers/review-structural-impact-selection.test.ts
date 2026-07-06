import { describe, expect, mock, test } from "bun:test";
import type { Logger } from "pino";
import type { FileRiskScore } from "../lib/file-risk-scorer.ts";
import type { ReviewGraphBlastRadiusResult } from "../review-graph/query.ts";
import type { StructuralImpactPayload } from "../structural-impact/types.ts";
import { resolveReviewStructuralImpactSelection } from "./review-structural-impact-selection.ts";

function createLogger() {
  const info = mock((_bindings: Record<string, unknown>, _message: string) => {});
  const warn = mock((_bindings: Record<string, unknown>, _message: string) => {});
  return {
    logger: { info, warn } as unknown as Logger,
    info,
    warn,
  };
}

function riskScore(filePath: string, score: number): FileRiskScore {
  return {
    filePath,
    score,
    breakdown: {
      linesChanged: score,
      pathRisk: 0,
      fileCategory: 0,
      languageRisk: 0,
      fileExtension: 0,
    },
  };
}

function graphBlastRadius(): ReviewGraphBlastRadiusResult {
  return {
    changedFiles: ["src/app.ts"],
    seedSymbols: [],
    impactedFiles: [{
      path: "src/consumer.ts",
      score: 0.9,
      confidence: 1,
      reasons: ["calls changed symbol"],
      relatedChangedPaths: ["src/app.ts"],
      languages: ["TypeScript"],
    }],
    probableDependents: [],
    likelyTests: [{
      path: "src/app.test.ts",
      score: 0.8,
      confidence: 1,
      reasons: ["tests changed symbol"],
      relatedChangedPaths: ["src/app.ts"],
      languages: ["TypeScript"],
      testSymbols: ["app"],
    }],
    graphStats: {
      files: 3,
      nodes: 4,
      edges: 5,
      changedFilesFound: 1,
    },
  };
}

function structuralPayload(): StructuralImpactPayload {
  return {
    status: "ok",
    changedFiles: ["src/app.ts"],
    seedSymbols: [],
    impactedFiles: [{
      path: "src/consumer.ts",
      score: 0.9,
      confidence: 1,
      reasons: ["calls changed symbol"],
      languages: ["TypeScript"],
    }],
    probableCallers: [],
    likelyTests: [{
      path: "src/app.test.ts",
      score: 0.8,
      confidence: 1,
      reasons: ["tests changed symbol"],
      testSymbols: ["app"],
    }],
    graphStats: {
      files: 3,
      nodes: 4,
      edges: 5,
      changedFilesFound: 1,
      changedFilesRequested: 1,
    },
    canonicalEvidence: [],
    degradations: [],
  };
}

describe("resolveReviewStructuralImpactSelection", () => {
  test("returns unmodified graph selection when no graph query is available", async () => {
    const { logger, warn } = createLogger();
    const riskScores = [riskScore("src/app.ts", 20)];

    const result = await resolveReviewStructuralImpactSelection({
      reviewGraphQuery: undefined,
      structuralImpactCache: {} as never,
      logger,
      baseLog: { deliveryId: "delivery-1", prNumber: 42 },
      owner: "acme",
      repo: "widgets",
      workspaceKey: "head-sha",
      baseSha: "base-sha",
      headSha: "head-sha",
      changedPaths: ["src/app.ts"],
      canonicalRef: "main",
      fullReviewCount: 20,
      abbreviatedCount: 10,
      totalLinesChanged: 12,
      riskScores,
    });

    expect(result.graphSelection).toMatchObject({
      usedGraph: false,
      riskScores,
      graphHits: 0,
    });
    expect(result.graphBlastRadius).toBeNull();
    expect(result.graphQueryBypassedForTrivialChange).toBe(false);
    expect(result.structuralImpactForReview).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  test("bypasses graph query for trivial changes and logs the reason", async () => {
    const { logger, info } = createLogger();
    const fetchStructuralImpact = mock(async () => {
      throw new Error("should not fetch");
    });

    const result = await resolveReviewStructuralImpactSelection({
      reviewGraphQuery: mock(async () => graphBlastRadius()),
      structuralImpactCache: {} as never,
      logger,
      baseLog: { deliveryId: "delivery-1", prNumber: 42 },
      owner: "acme",
      repo: "widgets",
      workspaceKey: "head-sha",
      baseSha: "base-sha",
      headSha: "head-sha",
      changedPaths: ["README.md"],
      canonicalRef: "main",
      fullReviewCount: 20,
      abbreviatedCount: 10,
      totalLinesChanged: 1,
      riskScores: [riskScore("README.md", 5)],
      isTrivial: () => ({ bypass: true, reason: "small-doc-change" }),
      fetchStructuralImpact,
    });

    expect(result.graphQueryBypassedForTrivialChange).toBe(true);
    expect(fetchStructuralImpact).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryId: "delivery-1",
        prNumber: 42,
        gate: "graph-query-bypass",
        reason: "small-doc-change",
        fileCount: 1,
      }),
      "Trivial change detected — bypassing graph query",
    );
  });

  test("collects structural impact payload, summarizes degradation, and applies graph-aware selection", async () => {
    const { logger, info, warn } = createLogger();
    const graph = graphBlastRadius();
    const payload = structuralPayload();
    const riskScores = [
      riskScore("src/app.ts", 20),
      riskScore("src/consumer.ts", 10),
      riskScore("src/app.test.ts", 8),
    ];
    const fetchStructuralImpact = mock(async () => ({
      payload,
      graphBlastRadius: graph,
    }));

    const result = await resolveReviewStructuralImpactSelection({
      reviewGraphQuery: mock(async () => graph),
      structuralImpactCache: {} as never,
      logger,
      baseLog: { deliveryId: "delivery-1", prNumber: 42 },
      owner: "acme",
      repo: "widgets",
      workspaceKey: "head-sha",
      baseSha: "base-sha",
      headSha: "head-sha",
      changedPaths: ["src/app.ts"],
      canonicalRef: "main",
      fullReviewCount: 20,
      abbreviatedCount: 10,
      totalLinesChanged: 12,
      riskScores,
      isTrivial: () => ({ bypass: false, reason: "non-trivial" }),
      fetchStructuralImpact,
    });

    expect(fetchStructuralImpact).toHaveBeenCalledWith(
      expect.objectContaining({ reviewGraphQuery: expect.any(Function), logger }),
      expect.objectContaining({
        repo: "acme/widgets",
        owner: "acme",
        workspaceKey: "head-sha",
        baseSha: "base-sha",
        headSha: "head-sha",
        changedPaths: ["src/app.ts"],
        canonicalRef: "main",
        query: "src/app.ts",
        graphLimit: 30,
      }),
    );
    expect(result.graphBlastRadius).toBe(graph);
    expect(result.structuralImpactForReview).toMatchObject({
      status: "ok",
      impactedFiles: payload.impactedFiles,
      likelyTests: payload.likelyTests,
      degradations: [],
    });
    expect(result.graphSelection.usedGraph).toBe(true);
    expect(result.graphSelection.graphHits).toBeGreaterThan(0);
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        gate: "structural-impact",
        status: "ok",
        graphPresent: true,
        probableCallers: 0,
        impactedFiles: 1,
        likelyTests: 1,
        canonicalEvidence: 0,
        breakingChangeEvidenceUsed: true,
        fallbackUsed: false,
      }),
      "Review structural-impact payload collected",
    );
    expect(warn).not.toHaveBeenCalled();
  });
});
