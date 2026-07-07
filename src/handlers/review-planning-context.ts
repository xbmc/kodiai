import type { Logger } from "pino";
import type { RepoConfig } from "../execution/config.ts";
import type { DiffAnalysis } from "../execution/diff-analysis.ts";
import type { TieredFiles } from "../lib/file-risk-scorer.ts";
import type { ReviewArea } from "../lib/review-finding-metadata.ts";
import type { ReviewProfile } from "../lib/auto-profile.ts";
import type { ReviewGraphBlastRadiusResult } from "../review-graph/query.ts";
import {
  toReviewPlanConfigSnapshot,
  type RepoDoctrineReviewSurfaceProjection,
} from "../review-orchestration/review-plan-doctrine-log.ts";
import type { RepoDoctrineProjection } from "../repo-doctrine/contracts.ts";
import type { ReviewPlanBuilder } from "../review-orchestration/review-plan.ts";
import { buildReviewRuntimePlan } from "./review-runtime-plan.ts";
import {
  buildReviewPlanPublication,
  logReviewPlanPublication,
} from "./review-plan-publication-context.ts";
import { applyReviewPrIntentAreas } from "./review-pr-intent-areas.ts";
import { logReviewDiffAnalysisCompleted } from "./review-diff-analysis-completion-log.ts";

type ReviewPlanningConfig = Pick<RepoConfig, "review" | "timeout" | "timeoutSeconds" | "maxTurns">;

export function resolveReviewPlanningContext(params: {
  parsedIntent: {
    profileOverride?: ReviewProfile | null;
    styleOk: boolean;
    focusAreas: string[];
  };
  reviewConfig: ReviewPlanningConfig;
  prLinesChanged: number;
  changedFiles: string[];
  diffAnalysis: DiffAnalysis;
  tieredFiles: TieredFiles;
  promptFiles: string[];
  reviewPlanBuilder: ReviewPlanBuilder;
  retrievalContextAvailable: boolean;
  matchedPathInstructionCount: number;
  repoDoctrineProjection: RepoDoctrineProjection;
  repoDoctrineReviewSurface: RepoDoctrineReviewSurfaceProjection;
  graphQueryAvailable: boolean;
  graphQueryBypassedForTrivialChange: boolean;
  graphBlastRadius: ReviewGraphBlastRadiusResult | null;
  diffCollectionStrategy: string;
  mergeBaseRecovered: boolean;
  diffCollectionAttempts: number;
  logger: Logger;
  baseLog: Record<string, unknown>;
}): ReturnType<typeof buildReviewRuntimePlan> & {
  reviewPlan: ReturnType<typeof buildReviewPlanPublication>["plan"];
  reviewPlanDetailsSummary: ReturnType<typeof buildReviewPlanPublication>["detailsSummary"];
  reviewPlanConfigSnapshot: ReturnType<typeof toReviewPlanConfigSnapshot>;
} {
  const runtimePlan = buildReviewRuntimePlan({
    parsedIntent: {
      profileOverride: params.parsedIntent.profileOverride,
    },
    reviewConfig: {
      profile: params.reviewConfig.review.profile ?? null,
      severityMinLevel: params.reviewConfig.review.severity.minLevel,
      maxComments: params.reviewConfig.review.maxComments,
      focusAreas: params.reviewConfig.review.focusAreas,
      ignoredAreas: params.reviewConfig.review.ignoredAreas,
    },
    timeoutConfig: {
      timeoutSeconds: params.reviewConfig.timeoutSeconds,
      dynamicScaling: params.reviewConfig.timeout.dynamicScaling !== false,
      autoReduceScope: params.reviewConfig.timeout.autoReduceScope !== false,
    },
    baseMaxTurns: params.reviewConfig.maxTurns,
    prLinesChanged: params.prLinesChanged,
    changedFiles: params.changedFiles,
    diffMetrics: {
      totalLinesAdded: params.diffAnalysis.metrics.totalLinesAdded ?? 0,
      totalLinesRemoved: params.diffAnalysis.metrics.totalLinesRemoved ?? 0,
      filesByLanguage: params.diffAnalysis.filesByLanguage ?? {},
      isLargePR: params.diffAnalysis.isLargePR ?? false,
    },
    tieredFiles: params.tieredFiles,
    promptFiles: params.promptFiles,
    logger: params.logger,
    baseLog: params.baseLog,
  });

  const reviewPlanPublication = buildReviewPlanPublication({
    builder: params.reviewPlanBuilder,
    reviewRouting: runtimePlan.reviewRouting,
    changedFileCount: params.changedFiles.length,
    reviewRoutingLinesChanged: runtimePlan.reviewRoutingLinesChanged,
    diffAnalysisLinesChanged: runtimePlan.diffAnalysisLinesChanged,
    prApiLinesChanged: runtimePlan.prApiLinesChanged,
    timeoutSeconds: params.reviewConfig.timeoutSeconds,
    appliedTimeoutSeconds: runtimePlan.appliedTimeoutBudget?.totalTimeoutSeconds,
    maxTurns: params.reviewConfig.maxTurns,
    reviewMaxTurnsOverride: runtimePlan.reviewMaxTurnsOverride,
    retrievalContextAvailable: params.retrievalContextAvailable,
    matchedPathInstructionCount: params.matchedPathInstructionCount,
    repoDoctrineEnabled: params.repoDoctrineProjection.enabled,
    repoDoctrineReviewSurface: params.repoDoctrineReviewSurface,
    reviewBoundednessAvailable: Boolean(runtimePlan.reviewBoundedness),
    graphValidationConfigEnabled: params.reviewConfig.review.graphValidation.enabled,
    graphQueryAvailable: params.graphQueryAvailable,
    graphQueryBypassedForTrivialChange: params.graphQueryBypassedForTrivialChange,
    graphBlastRadiusAvailable: Boolean(params.graphBlastRadius),
  });
  const {
    plan: reviewPlan,
    detailsSummary: reviewPlanDetailsSummary,
  } = reviewPlanPublication;

  logReviewPlanPublication({
    logger: params.logger,
    baseLog: params.baseLog,
    publication: reviewPlanPublication,
    reviewRouting: runtimePlan.reviewRouting,
    reviewBoundedness: runtimePlan.reviewBoundedness,
    repoDoctrineProjection: params.repoDoctrineProjection,
  });

  applyReviewPrIntentAreas({
    styleOk: params.parsedIntent.styleOk,
    focusAreas: params.parsedIntent.focusAreas,
    resolvedFocusAreas: runtimePlan.resolvedFocusAreas as ReviewArea[],
    resolvedIgnoredAreas: runtimePlan.resolvedIgnoredAreas,
  });

  logReviewDiffAnalysisCompleted({
    logger: params.logger,
    baseLog: params.baseLog,
    totalFiles: params.diffAnalysis.metrics.totalFiles,
    isLargePR: params.diffAnalysis.isLargePR,
    riskSignals: params.diffAnalysis.riskSignals.length,
    matchedInstructions: params.matchedPathInstructionCount,
    detectedLanguages: Object.keys(params.diffAnalysis.filesByLanguage ?? {}).length,
    profile: params.reviewConfig.review.profile ?? null,
    diffCollectionStrategy: params.diffCollectionStrategy,
    mergeBaseRecovered: params.mergeBaseRecovered,
    diffCollectionAttempts: params.diffCollectionAttempts,
  });

  return {
    ...runtimePlan,
    reviewPlan,
    reviewPlanDetailsSummary,
    reviewPlanConfigSnapshot: toReviewPlanConfigSnapshot(reviewPlan),
  };
}
