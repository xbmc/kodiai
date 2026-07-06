import type { Logger } from "pino";
import type { FindingSeverity, ReviewArea } from "../lib/review-finding-metadata.ts";
import type { ResolvedReviewProfile, ReviewProfile } from "../lib/auto-profile.ts";
import type { ReviewTaskRouting } from "../lib/review-routing.ts";
import type { TimeoutEstimate } from "../lib/timeout-estimator.ts";
import type { ReviewBoundednessContract } from "../lib/review-boundedness.ts";
import type { TieredFiles } from "../lib/file-risk-scorer.ts";
import { TASK_TYPES } from "../llm/task-types.ts";
import { PROFILE_PRESETS } from "../lib/review-profile-presets.ts";
import { resolveReviewProfile } from "../lib/auto-profile.ts";
import {
  resolveReviewMaxTurnsOverride,
  resolveReviewRoutingLineCount,
  resolveReviewTaskRouting,
} from "../lib/review-routing.ts";
import {
  computeLanguageComplexity,
  estimateTimeoutRisk,
} from "../lib/timeout-estimator.ts";
import { capTieredFilesForPromptBudget } from "../lib/file-risk-scorer.ts";
import { resolveReviewBoundedness } from "../lib/review-boundedness.ts";
import {
  toProductionLogBudgetReasoning,
  toProductionLogTurnBudgetFields,
} from "../review-audit/production-log-projection.ts";

export type ReviewRuntimePlan = {
  resolvedSeverityMinLevel: FindingSeverity;
  resolvedMaxComments: number;
  resolvedFocusAreas: ReviewArea[];
  resolvedIgnoredAreas: ReviewArea[];
  profileSelection: ResolvedReviewProfile;
  requestedProfileSelection: ResolvedReviewProfile;
  languageComplexity: number;
  timeoutEstimate: TimeoutEstimate;
  appliedTimeoutBudget: TimeoutEstimate | null;
  diffAnalysisLinesChanged: number;
  prApiLinesChanged: number;
  reviewRoutingLinesChanged: number;
  reviewRouting: ReviewTaskRouting;
  reviewMaxTurnsOverride: number | undefined;
  checkpointEnabled: boolean;
  timeoutReductionApplied: boolean;
  timeoutReductionSkippedReason: "explicit-profile" | "config-disabled" | null;
  tieredFiles: TieredFiles;
  promptFiles: string[];
  reviewBoundedness: ReviewBoundednessContract | null;
};

export function buildReviewRuntimePlan(params: {
  parsedIntent: {
    profileOverride?: ReviewProfile | null;
  };
  reviewConfig: {
    profile: ReviewProfile | null;
    severityMinLevel: FindingSeverity;
    maxComments: number;
    focusAreas: ReviewArea[];
    ignoredAreas: ReviewArea[];
  };
  timeoutConfig: {
    timeoutSeconds: number;
    dynamicScaling: boolean;
    autoReduceScope: boolean;
  };
  baseMaxTurns: number;
  prLinesChanged: number;
  changedFiles: string[];
  diffMetrics: {
    totalLinesAdded: number;
    totalLinesRemoved: number;
    filesByLanguage: Record<string, string[]>;
    isLargePR: boolean;
  };
  tieredFiles: TieredFiles;
  promptFiles: string[];
  logger: Pick<Logger, "info">;
  baseLog: Record<string, unknown>;
}): ReviewRuntimePlan {
  let resolvedSeverityMinLevel = params.reviewConfig.severityMinLevel;
  let resolvedMaxComments = params.reviewConfig.maxComments;
  let resolvedFocusAreas = [...params.reviewConfig.focusAreas];
  let resolvedIgnoredAreas = [...params.reviewConfig.ignoredAreas];

  const profileSelectionLinesChanged = Math.max(0, params.prLinesChanged);
  const profileSelection = resolveReviewProfile({
    keywordProfileOverride: params.parsedIntent.profileOverride ?? null,
    manualProfile: params.reviewConfig.profile ?? null,
    linesChanged: profileSelectionLinesChanged,
  });

  const selectedPreset = PROFILE_PRESETS[profileSelection.selectedProfile];
  if (selectedPreset) {
    if (profileSelection.source === "keyword") {
      resolvedSeverityMinLevel = selectedPreset.severityMinLevel;
      resolvedMaxComments = selectedPreset.maxComments;
      if (selectedPreset.focusAreas.length > 0) {
        resolvedFocusAreas = [...selectedPreset.focusAreas];
      }
      if (selectedPreset.ignoredAreas.length > 0) {
        resolvedIgnoredAreas = [...selectedPreset.ignoredAreas];
      }

      params.logger.info(
        {
          ...params.baseLog,
          gate: "keyword-profile-override",
          profile: profileSelection.selectedProfile,
        },
        "Keyword profile override applied",
      );
    } else {
      if (resolvedSeverityMinLevel === "minor") {
        resolvedSeverityMinLevel = selectedPreset.severityMinLevel;
      }
      if (resolvedMaxComments === 7) {
        resolvedMaxComments = selectedPreset.maxComments;
      }
      if (resolvedFocusAreas.length === 0) {
        resolvedFocusAreas = [...selectedPreset.focusAreas];
      }
      if (resolvedIgnoredAreas.length === 0) {
        resolvedIgnoredAreas = [...selectedPreset.ignoredAreas];
      }
    }
  }

  params.logger.info(
    {
      ...params.baseLog,
      gate: "review-profile-selection",
      selectedProfile: profileSelection.selectedProfile,
      source: profileSelection.source,
      linesChanged: profileSelection.linesChanged,
      autoBand: profileSelection.autoBand,
    },
    "Review profile resolved",
  );

  const languageComplexity = computeLanguageComplexity(params.diffMetrics.filesByLanguage ?? {});
  const diffAnalysisLinesChanged = (params.diffMetrics.totalLinesAdded ?? 0)
    + (params.diffMetrics.totalLinesRemoved ?? 0);
  const timeoutEstimate = estimateTimeoutRisk({
    fileCount: params.changedFiles.length,
    linesChanged: diffAnalysisLinesChanged,
    languageComplexity,
    isLargePR: params.diffMetrics.isLargePR ?? false,
    baseTimeoutSeconds: params.timeoutConfig.timeoutSeconds,
  });
  const appliedTimeoutBudget = params.timeoutConfig.dynamicScaling !== false
    ? timeoutEstimate
    : null;

  const prApiLinesChanged = Math.max(0, params.prLinesChanged);
  const reviewRoutingLinesChanged = resolveReviewRoutingLineCount({
    diffLinesChanged: diffAnalysisLinesChanged,
    prApiLinesChanged,
  });
  const reviewRouting = resolveReviewTaskRouting({
    changedFileCount: params.changedFiles.length,
    linesChanged: reviewRoutingLinesChanged,
  });
  const reviewMaxTurnsOverride = resolveReviewMaxTurnsOverride({
    taskType: reviewRouting.taskType,
    routingMaxTurnsOverride: reviewRouting.maxTurnsOverride,
    timeoutRiskLevel: timeoutEstimate.riskLevel,
    baseMaxTurns: params.baseMaxTurns,
    changedFiles: params.changedFiles,
  });

  params.logger.info(
    {
      ...params.baseLog,
      gate: "review-routing",
      taskType: reviewRouting.taskType,
      routingReason: reviewRouting.routingReason,
      changedFiles: params.changedFiles.length,
      linesChanged: reviewRoutingLinesChanged,
      diffAnalysisLinesChanged,
      prApiLinesChanged,
      ...toProductionLogTurnBudgetFields(
        reviewMaxTurnsOverride,
        reviewMaxTurnsOverride !== undefined ? "dynamic-risk" : "config",
      ),
    },
    "Review routing decision",
  );

  params.logger.info(
    {
      ...params.baseLog,
      gate: "budget-estimation",
      riskLevel: timeoutEstimate.riskLevel,
      dynamicBudgetSeconds: timeoutEstimate.dynamicTimeoutSeconds,
      remoteRuntimeBudgetSeconds: timeoutEstimate.remoteRuntimeBudgetSeconds,
      infraOverheadBudgetSeconds: timeoutEstimate.infraOverheadBudgetSeconds,
      totalBudgetSeconds: timeoutEstimate.totalTimeoutSeconds,
      shouldReduceScope: timeoutEstimate.shouldReduceScope,
      complexity: toProductionLogBudgetReasoning(timeoutEstimate.reasoning),
    },
    "Review budget risk estimated",
  );

  const checkpointEnabled =
    reviewRouting.taskType === TASK_TYPES.REVIEW_FULL ||
    timeoutEstimate.riskLevel === "medium" ||
    timeoutEstimate.riskLevel === "high";

  const requestedProfileSelection = { ...profileSelection };
  let timeoutReductionApplied = false;
  let timeoutReductionSkippedReason: "explicit-profile" | "config-disabled" | null = null;
  let tieredFiles = params.tieredFiles;
  let promptFiles = [...params.promptFiles];
  if (timeoutEstimate.shouldReduceScope && params.timeoutConfig.autoReduceScope === false) {
    timeoutReductionSkippedReason = "config-disabled";
    params.logger.info(
      {
        ...params.baseLog,
        gate: "budget-scope-reduction",
        gateResult: "skipped",
        skipReason: timeoutReductionSkippedReason,
        profile: profileSelection.selectedProfile,
        source: profileSelection.source,
      },
      "Skipping scope reduction because budget auto-reduction is disabled",
    );
  } else if (timeoutEstimate.shouldReduceScope) {
    const originalPromptFileCount = tieredFiles.isLargePR
      ? tieredFiles.full.length + tieredFiles.abbreviated.length
      : promptFiles.length;

    profileSelection.selectedProfile = "minimal";
    const minimalPreset = PROFILE_PRESETS["minimal"];
    if (minimalPreset) {
      resolvedSeverityMinLevel = minimalPreset.severityMinLevel;
      resolvedMaxComments = minimalPreset.maxComments;
      resolvedFocusAreas = [...minimalPreset.focusAreas];
      resolvedIgnoredAreas = [...minimalPreset.ignoredAreas];
    }

    if (timeoutEstimate.reducedFileCount !== null) {
      tieredFiles = capTieredFilesForPromptBudget(
        tieredFiles,
        timeoutEstimate.reducedFileCount,
      );
      promptFiles = tieredFiles.isLargePR
        ? [...tieredFiles.full.map(f => f.filePath), ...tieredFiles.abbreviated.map(f => f.filePath)]
        : tieredFiles.full.map(f => f.filePath);
    }

    timeoutReductionApplied = true;
    params.logger.info(
      {
        ...params.baseLog,
        gate: "budget-scope-reduction",
        originalProfile: requestedProfileSelection.selectedProfile,
        requestedProfileSource: requestedProfileSelection.source,
        reducedProfile: "minimal",
        originalFileCount: originalPromptFileCount,
        reducedFileCount: promptFiles.length,
        reductionReason: requestedProfileSelection.source === "auto"
          ? "auto-profile-high-budget-risk"
          : "explicit-profile-high-budget-risk",
      },
      "Auto-reduced review scope for high budget risk",
    );
  }

  const reviewBoundedness = resolveReviewBoundedness({
    requestedProfile: requestedProfileSelection,
    effectiveProfile: profileSelection,
    largePRTriage: tieredFiles.isLargePR
      ? {
          fullCount: tieredFiles.full.length,
          abbreviatedCount: tieredFiles.abbreviated.length,
          totalFiles: tieredFiles.totalFiles,
        }
      : null,
    timeout: {
      riskLevel: timeoutEstimate.riskLevel,
      dynamicTimeoutSeconds: timeoutEstimate.dynamicTimeoutSeconds,
      shouldReduceScope: timeoutEstimate.shouldReduceScope,
      reductionApplied: timeoutReductionApplied,
      reductionSkippedReason: timeoutReductionSkippedReason,
    },
  });

  if (reviewBoundedness) {
    params.logger.info(
      {
        ...params.baseLog,
        gate: "review-boundedness",
        disclosureRequired: reviewBoundedness.disclosureRequired,
        reasonCodes: reviewBoundedness.reasonCodes,
        requestedProfile: reviewBoundedness.requestedProfile.selectedProfile,
        effectiveProfile: reviewBoundedness.effectiveProfile.selectedProfile,
      },
      "Resolved bounded-review contract",
    );
  }

  return {
    resolvedSeverityMinLevel,
    resolvedMaxComments,
    resolvedFocusAreas,
    resolvedIgnoredAreas,
    profileSelection,
    requestedProfileSelection,
    languageComplexity,
    timeoutEstimate,
    appliedTimeoutBudget,
    diffAnalysisLinesChanged,
    prApiLinesChanged,
    reviewRoutingLinesChanged,
    reviewRouting,
    reviewMaxTurnsOverride,
    checkpointEnabled,
    timeoutReductionApplied,
    timeoutReductionSkippedReason,
    tieredFiles,
    promptFiles,
    reviewBoundedness,
  };
}
