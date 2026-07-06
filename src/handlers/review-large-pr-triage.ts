import type { Logger } from "pino";
import {
  parseNumstatPerFile,
  type PerFileStats,
} from "../execution/diff-analysis.ts";
import {
  computeFileRiskScores,
  triageFilesByRisk,
  type FileRiskScore,
  type GraphAwareSelectionResult,
  type RiskWeights,
  type TieredFiles,
} from "../lib/file-risk-scorer.ts";

export function buildReviewFileRiskScores({
  reviewFiles,
  numstatLines,
  filesByCategory,
  riskWeights,
}: {
  reviewFiles: string[];
  numstatLines: string[];
  filesByCategory: Record<string, string[]>;
  riskWeights: RiskWeights;
}): {
  riskScores: FileRiskScore[];
  perFileStats: PerFileStats;
} {
  const perFileStats = parseNumstatPerFile(numstatLines);
  const riskScores = computeFileRiskScores({
    files: reviewFiles,
    perFileStats,
    filesByCategory,
    weights: riskWeights,
  });

  return { riskScores, perFileStats };
}

export function resolveReviewLargePrTriage({
  graphSelection,
  reviewFiles,
  changedFiles,
  largePrConfig,
  baseLog,
  logger,
}: {
  graphSelection: GraphAwareSelectionResult;
  reviewFiles: string[];
  changedFiles: string[];
  largePrConfig: {
    fileThreshold: number;
    fullReviewCount: number;
    abbreviatedCount: number;
  };
  baseLog: Record<string, unknown>;
  logger: Pick<Logger, "info">;
}): {
  tieredFiles: TieredFiles;
  promptFiles: string[];
} {
  const tieredFiles = triageFilesByRisk({
    riskScores: graphSelection.riskScores,
    fileThreshold: largePrConfig.fileThreshold,
    fullReviewCount: largePrConfig.fullReviewCount,
    abbreviatedCount: largePrConfig.abbreviatedCount,
    totalFileCount: changedFiles.length,
  });

  const promptFiles = tieredFiles.isLargePR
    ? [...tieredFiles.full.map((file) => file.filePath), ...tieredFiles.abbreviated.map((file) => file.filePath)]
    : reviewFiles;

  if (tieredFiles.isLargePR) {
    logger.info({
      ...baseLog,
      gate: "large-pr-triage",
      totalFiles: tieredFiles.totalFiles,
      fullReview: tieredFiles.full.length,
      abbreviated: tieredFiles.abbreviated.length,
      mentionOnly: tieredFiles.mentionOnly.length,
      threshold: largePrConfig.fileThreshold,
      graphHitCount: graphSelection.graphHits,
      graphRankedSelections: graphSelection.graphRankedSelections,
      graphAwareSelectionApplied: graphSelection.usedGraph,
    }, "Large PR file triage applied");
  }

  return { tieredFiles, promptFiles };
}
