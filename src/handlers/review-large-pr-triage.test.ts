import { describe, expect, test } from "bun:test";
import { DEFAULT_RISK_WEIGHTS, type GraphAwareSelectionResult } from "../lib/file-risk-scorer.ts";
import {
  buildReviewFileRiskScores,
  resolveReviewLargePrTriage,
} from "./review-large-pr-triage.ts";

const makeGraphSelection = (riskScores: GraphAwareSelectionResult["riskScores"]): GraphAwareSelectionResult => ({
  riskScores,
  usedGraph: true,
  graphHits: 2,
  graphRankedSelections: 1,
  graphImpactedFiles: ["src/auth/session.ts"],
  graphLikelyTests: [],
});

describe("buildReviewFileRiskScores", () => {
  test("parses numstat and scores only files selected for review", () => {
    const { riskScores, perFileStats } = buildReviewFileRiskScores({
      reviewFiles: ["src/auth/session.ts", "README.md"],
      numstatLines: [
        "40\t10\tsrc/auth/session.ts",
        "5\t1\tREADME.md",
        "200\t0\tsrc/ignored.ts",
      ],
      filesByCategory: {
        source: ["src/auth/session.ts", "src/ignored.ts"],
        docs: ["README.md"],
      },
      riskWeights: DEFAULT_RISK_WEIGHTS,
    });

    expect(riskScores.map((score) => score.filePath)).toEqual([
      "src/auth/session.ts",
      "README.md",
    ]);
    expect(riskScores.some((score) => score.filePath === "src/ignored.ts")).toBe(false);
    expect(perFileStats.get("src/auth/session.ts")).toEqual({ added: 40, removed: 10 });
    expect(perFileStats.get("src/ignored.ts")).toEqual({ added: 200, removed: 0 });
  });
});

describe("resolveReviewLargePrTriage", () => {
  test("keeps the incremental review file list for non-large PR prompts", () => {
    const riskScores = [
      {
        filePath: "src/auth/session.ts",
        score: 100,
        breakdown: {
          linesChanged: 100,
          pathRisk: 100,
          fileCategory: 70,
          languageRisk: 80,
          fileExtension: 100,
        },
      },
    ];
    const infoCalls: unknown[] = [];

    const result = resolveReviewLargePrTriage({
      graphSelection: makeGraphSelection(riskScores),
      reviewFiles: ["src/auth/session.ts"],
      changedFiles: ["src/auth/session.ts"],
      largePrConfig: {
        fileThreshold: 50,
        fullReviewCount: 30,
        abbreviatedCount: 20,
      },
      baseLog: { deliveryId: "d1" },
      logger: {
        info: (...args: unknown[]) => {
          infoCalls.push(args);
        },
      },
    });

    expect(result.tieredFiles.isLargePR).toBe(false);
    expect(result.promptFiles).toEqual(["src/auth/session.ts"]);
    expect(infoCalls).toHaveLength(0);
  });

  test("uses full and abbreviated tiers for large PR prompts and logs graph context", () => {
    const riskScores = Array.from({ length: 5 }, (_, index) => ({
      filePath: `src/file-${index}.ts`,
      score: 100 - index,
      breakdown: {
        linesChanged: 50,
        pathRisk: 30,
        fileCategory: 20,
        languageRisk: 10,
        fileExtension: 10,
      },
    }));
    const infoCalls: unknown[][] = [];

    const result = resolveReviewLargePrTriage({
      graphSelection: makeGraphSelection(riskScores),
      reviewFiles: riskScores.map((score) => score.filePath),
      changedFiles: [...riskScores.map((score) => score.filePath), "docs/extra.md"],
      largePrConfig: {
        fileThreshold: 3,
        fullReviewCount: 2,
        abbreviatedCount: 1,
      },
      baseLog: { deliveryId: "d1" },
      logger: {
        info: (...args: unknown[]) => {
          infoCalls.push(args);
        },
      },
    });

    expect(result.tieredFiles.isLargePR).toBe(true);
    expect(result.promptFiles).toEqual(["src/file-0.ts", "src/file-1.ts", "src/file-2.ts"]);
    expect(result.tieredFiles.mentionOnly.map((file) => file.filePath)).toEqual([
      "src/file-3.ts",
      "src/file-4.ts",
    ]);
    expect(infoCalls).toHaveLength(1);
    expect(infoCalls[0]?.[0]).toMatchObject({
      gate: "large-pr-triage",
      graphHitCount: 2,
      graphRankedSelections: 1,
      graphAwareSelectionApplied: true,
      totalFiles: 6,
      fullReview: 2,
      abbreviated: 1,
      mentionOnly: 2,
    });
    expect(infoCalls[0]?.[1]).toBe("Large PR file triage applied");
  });
});
