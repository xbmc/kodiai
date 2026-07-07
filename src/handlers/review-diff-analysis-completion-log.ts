import type { Logger } from "pino";

export function logReviewDiffAnalysisCompleted(params: {
  logger: Pick<Logger, "info">;
  baseLog: Record<string, unknown>;
  totalFiles: number;
  isLargePR: boolean;
  riskSignals: number;
  matchedInstructions: number;
  detectedLanguages: number;
  profile: string | null;
  diffCollectionStrategy: string;
  mergeBaseRecovered: boolean;
  diffCollectionAttempts: number;
}): void {
  params.logger.info(
    {
      ...params.baseLog,
      gate: "diff-analysis",
      totalFiles: params.totalFiles,
      isLargePR: params.isLargePR,
      riskSignals: params.riskSignals,
      matchedInstructions: params.matchedInstructions,
      detectedLanguages: params.detectedLanguages,
      profile: params.profile,
      diffCollectionStrategy: params.diffCollectionStrategy,
      mergeBaseRecovered: params.mergeBaseRecovered,
      diffCollectionAttempts: params.diffCollectionAttempts,
    },
    "Diff analysis and context enrichment complete",
  );
}
