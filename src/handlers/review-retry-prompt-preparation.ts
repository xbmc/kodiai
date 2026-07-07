import type { Logger } from "pino";
import type { RepoConfig } from "../execution/config.ts";
import type { DiffAnalysis } from "../execution/diff-analysis.ts";
import type { PromptBuildResult } from "../execution/prompt-section-metrics.ts";
import type { PromptSectionRecord, TelemetryStore } from "../telemetry/types.ts";
import type { PriorFinding } from "../knowledge/types.ts";
import type { IncrementalDiffResult } from "../lib/incremental-diff.ts";
import type { DepBumpContext } from "../lib/dep-bump-detector.ts";
import type { SearchCache } from "../lib/search-cache.ts";
import type { ReviewWorkPhase } from "../jobs/review-work-coordinator.ts";
import type { ReviewAuthorClassification } from "../contributor/review-author-resolution.ts";
import type { RepoDoctrineProjection } from "../repo-doctrine/contracts.ts";
import type { ReviewPromptBuildContext } from "../review-orchestration/review-prompt-fingerprint.ts";
import {
  buildReviewPromptFingerprint,
  type ReviewPromptFingerprintResult,
} from "../review-orchestration/review-prompt-fingerprint.ts";
import { buildReviewPromptDetails } from "../execution/review-prompt.ts";
import { buildRetryReviewPromptRuntime } from "./review-prompt-cache-runtime.ts";
import { buildReviewRetryPromptBuildContext } from "./review-retry-prompt-context.ts";
import { projectReviewAuthorExpertiseForPrompt } from "./review-author-context.ts";
import type { ReviewVisibleBudgetProjectionState } from "./review-visible-budget-state.ts";
import type { ReviewRetryEnqueueContext } from "./review-retry-enqueue-context.ts";

type RetryPromptContextParams = Parameters<typeof buildReviewRetryPromptBuildContext>[0];

export type RetryReviewPromptPreparationResult = {
  retryReviewPromptDerivedCacheStatus: "hit" | "miss" | "degraded" | "bypass";
  retryReviewPromptDerivedCacheReason: string | null;
  retryPrompt: string;
  retryPromptSections: PromptSectionRecord[];
};

export async function prepareRetryReviewPrompt(params: {
  owner: string;
  repo: string;
  pr: {
    number: number;
    title: string;
    body?: string | null;
    user: { login: string };
    base: { ref: string };
    head: { ref: string };
  };
  retryAttemptId: string;
  retryDeliveryId: string;
  retryReviewOutputKey: string;
  config: Pick<RepoConfig, "review" | "telemetry">;
  taskType: string;
  resolvedSeverityMinLevel: RetryPromptContextParams["severityMinLevel"];
  resolvedFocusAreas: string[];
  resolvedIgnoredAreas: string[];
  resolvedMaxComments: number;
  diffAnalysis: DiffAnalysis;
  diffContent: string | undefined;
  matchedPathInstructions: RetryPromptContextParams["matchedPathInstructions"];
  incrementalResult: IncrementalDiffResult | null;
  priorFindingContext: RetryPromptContextParams["priorFindingContext"];
  retrievalContext: RetryPromptContextParams["retrievalContext"];
  reviewPrecedents: RetryPromptContextParams["reviewPrecedents"];
  wikiKnowledge: RetryPromptContextParams["wikiKnowledge"];
  unifiedResults: RetryPromptContextParams["unifiedResults"];
  contextWindow: string | undefined;
  prLabels: string[];
  focusHints: string[];
  conventionalType: RetryPromptContextParams["conventionalType"];
  priorFindings: PriorFinding[];
  authorClassification: ReviewAuthorClassification;
  depBumpContext: DepBumpContext | null;
  isDraft: boolean;
  clusterPatterns: RetryPromptContextParams["clusterPatterns"];
  linkedIssues: RetryPromptContextParams["linkedIssues"];
  structuralImpact: RetryPromptContextParams["structuralImpact"];
  repoDoctrineProjection: RepoDoctrineProjection;
  checkpoint: RetryPromptContextParams["checkpoint"];
  isTimeout: boolean;
  retryEnqueueContext: ReviewRetryEnqueueContext;
  visibleBudgetState: ReviewVisibleBudgetProjectionState;
  promptBuilder: typeof buildReviewPromptDetails;
  promptCache: SearchCache<PromptBuildResult>;
  getPromptCacheErrorCount: () => number;
  buildPromptFingerprint?: (context: ReviewPromptBuildContext) => ReviewPromptFingerprintResult;
  telemetryStore: Pick<TelemetryStore, "recordReviewCacheEvent">;
  setReviewWorkPhaseForAttempt: (attemptId: string, phase: ReviewWorkPhase) => void;
  logger: Pick<Logger, "info" | "warn">;
  baseLog: Record<string, unknown>;
}): Promise<RetryReviewPromptPreparationResult> {
  params.setReviewWorkPhaseForAttempt(params.retryAttemptId, "prompt-build");

  const retryPromptBuildContext = buildReviewRetryPromptBuildContext({
    owner: params.owner,
    repo: params.repo,
    prNumber: params.pr.number,
    prTitle: params.pr.title,
    prBody: params.pr.body ?? "",
    prAuthor: params.pr.user.login,
    baseBranch: params.pr.base.ref,
    headBranch: params.pr.head.ref,
    mode: params.config.review.mode,
    severityMinLevel: params.resolvedSeverityMinLevel,
    focusAreas: params.resolvedFocusAreas,
    ignoredAreas: params.resolvedIgnoredAreas,
    maxComments: params.resolvedMaxComments,
    suppressions: params.config.review.suppressions,
    minConfidence: params.config.review.minConfidence,
    diffAnalysis: params.diffAnalysis,
    diffContent: params.diffContent,
    matchedPathInstructions: params.matchedPathInstructions,
    incrementalResult: params.incrementalResult,
    priorFindingContext: params.priorFindingContext,
    retrievalContext: params.retrievalContext,
    reviewPrecedents: params.reviewPrecedents,
    wikiKnowledge: params.wikiKnowledge,
    unifiedResults: params.unifiedResults,
    contextWindow: params.contextWindow,
    outputLanguage: params.config.review.outputLanguage,
    prLabels: params.prLabels,
    focusHints: params.focusHints,
    conventionalType: params.conventionalType,
    priorFindings: params.priorFindings,
    contributorExperienceContract: params.authorClassification.contract,
    authorExpertise: projectReviewAuthorExpertiseForPrompt(params.authorClassification),
    depBumpContext: params.depBumpContext,
    searchRateLimitDegradation: params.authorClassification.searchEnrichment,
    isDraft: params.isDraft,
    clusterPatterns: params.clusterPatterns,
    linkedIssues: params.linkedIssues,
    structuralImpact: params.structuralImpact,
    repoDoctrine: params.repoDoctrineProjection,
    taskType: params.taskType,
    checkpoint: params.checkpoint,
    basePrompt: params.config.review.prompt,
    isTimeout: params.isTimeout,
    retryEnqueueContext: params.retryEnqueueContext,
    visibleBudgetState: params.visibleBudgetState,
  });

  const retryPromptRuntime = await buildRetryReviewPromptRuntime({
    deliveryId: params.retryDeliveryId,
    repo: `${params.owner}/${params.repo}`,
    prNumber: params.pr.number,
    taskType: params.taskType,
    reviewOutputKey: params.retryReviewOutputKey,
    context: retryPromptBuildContext,
    promptBuilder: params.promptBuilder,
    cache: params.promptCache,
    getCacheErrorCount: params.getPromptCacheErrorCount,
    buildFingerprint: params.buildPromptFingerprint ?? buildReviewPromptFingerprint,
    visibleBudgetState: params.visibleBudgetState,
    telemetryEnabled: params.config.telemetry.enabled,
    telemetryStore: params.telemetryStore,
    logger: params.logger,
    baseLog: params.baseLog,
  });

  return {
    retryReviewPromptDerivedCacheStatus: retryPromptRuntime.cacheStatus,
    retryReviewPromptDerivedCacheReason: retryPromptRuntime.cacheReason,
    retryPrompt: retryPromptRuntime.prompt,
    retryPromptSections: retryPromptRuntime.promptSections,
  };
}
