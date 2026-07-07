import type { Logger } from "pino";
import type { RepoConfig } from "../execution/config.ts";
import type { DiffAnalysis } from "../execution/diff-analysis.ts";
import type { ReviewPhaseName, ReviewPhaseTiming } from "../execution/types.ts";
import type { PromptBuildResult } from "../execution/prompt-section-metrics.ts";
import type { PromptSectionRecord, TelemetryStore } from "../telemetry/types.ts";
import type { ReviewWorkPhase } from "../jobs/review-work-coordinator.ts";
import type { IssueStore } from "../knowledge/issue-types.ts";
import type { EmbeddingProvider } from "../knowledge/types.ts";
import type { PriorFinding } from "../knowledge/types.ts";
import type { IncrementalDiffResult } from "../lib/incremental-diff.ts";
import type { TieredFiles } from "../lib/file-risk-scorer.ts";
import type { DepBumpContext } from "../lib/dep-bump-detector.ts";
import type { SearchCache } from "../lib/search-cache.ts";
import type { ReviewAuthorClassification } from "../contributor/review-author-resolution.ts";
import type { ReviewGraphBlastRadiusResult } from "../review-graph/query.ts";
import type { RepoDoctrineProjection } from "../repo-doctrine/contracts.ts";
import type { ReviewPromptBuildContext } from "../review-orchestration/review-prompt-fingerprint.ts";
import {
  buildReviewPromptFingerprint,
  type ReviewPromptFingerprintResult,
} from "../review-orchestration/review-prompt-fingerprint.ts";
import { completeReviewRetrievalContextPhaseTiming } from "../review-orchestration/review-phase-timing.ts";
import { buildReviewPromptDetails } from "../execution/review-prompt.ts";
import { buildReviewPromptEnrichment } from "./review-prompt-enrichment.ts";
import { buildInitialReviewPromptContext } from "./review-prompt-build-context.ts";
import { buildInitialReviewPromptRuntime } from "./review-prompt-cache-runtime.ts";
import { projectReviewAuthorExpertiseForPrompt } from "./review-author-context.ts";
import type { ReviewVisibleBudgetProjectionState } from "./review-visible-budget-state.ts";

type InitialReviewPromptContextParams = Parameters<typeof buildInitialReviewPromptContext>[0];
type ReviewPromptEnrichmentParams = Parameters<typeof buildReviewPromptEnrichment>[0];

export type InitialReviewPromptPreparationResult = {
  prLabels: string[];
  clusterPatternsForPrompt: InitialReviewPromptContextParams["clusterPatterns"];
  linkedIssueResult: InitialReviewPromptContextParams["linkedIssues"];
  reviewPromptDerivedCacheStatus: "hit" | "miss" | "degraded" | "bypass";
  reviewPromptDerivedCacheReason: string | null;
  reviewPrompt: string;
  reviewPromptSections: PromptSectionRecord[];
};

export async function prepareInitialReviewPrompt(params: {
  owner: string;
  repo: string;
  pr: {
    number: number;
    title: string;
    body?: string | null;
    user: { login: string };
    base: { ref: string };
    head: { ref: string; sha?: string | null };
    labels?: Array<{ name: string }>;
  };
  eventId: string;
  config: Pick<RepoConfig, "review" | "telemetry">;
  promptFiles: string[];
  commitMessages: string[];
  diffAnalysis: DiffAnalysis;
  diffContent: string | undefined;
  matchedPathInstructions: InitialReviewPromptContextParams["matchedPathInstructions"];
  incrementalResult: IncrementalDiffResult | null;
  priorFindingContext: InitialReviewPromptContextParams["priorFindingContext"];
  retrievalContext: InitialReviewPromptContextParams["retrievalContext"];
  reviewPrecedents: InitialReviewPromptContextParams["reviewPrecedents"];
  wikiKnowledge: InitialReviewPromptContextParams["wikiKnowledge"];
  unifiedResults: InitialReviewPromptContextParams["unifiedResults"];
  contextWindow: string | undefined;
  parsedIntent: {
    unrecognized: string[];
    conventionalType: InitialReviewPromptContextParams["conventionalType"];
  };
  priorFindings: PriorFinding[];
  tieredFiles: TieredFiles;
  authorClassification: ReviewAuthorClassification;
  depBumpContext: DepBumpContext | null;
  isDraft: boolean;
  graphBlastRadius: ReviewGraphBlastRadiusResult | null;
  structuralImpact: InitialReviewPromptContextParams["structuralImpact"];
  reviewBoundedness: InitialReviewPromptContextParams["reviewBoundedness"];
  repoDoctrineProjection: RepoDoctrineProjection;
  taskType: string;
  checkpointEnabled: boolean;
  resolvedSeverityMinLevel: InitialReviewPromptContextParams["severityMinLevel"];
  resolvedFocusAreas: string[];
  resolvedIgnoredAreas: string[];
  resolvedMaxComments: number;
  clusterMatcher?: ReviewPromptEnrichmentParams["clusterMatcher"];
  issueStore?: IssueStore;
  embeddingProvider?: EmbeddingProvider;
  promptBuilder: typeof buildReviewPromptDetails;
  promptCache: SearchCache<PromptBuildResult>;
  getPromptCacheErrorCount: () => number;
  buildPromptFingerprint?: (context: ReviewPromptBuildContext) => ReviewPromptFingerprintResult;
  visibleBudgetState: ReviewVisibleBudgetProjectionState;
  telemetryStore: Pick<TelemetryStore, "recordReviewCacheEvent">;
  reviewPhaseTimings: Map<ReviewPhaseName, ReviewPhaseTiming>;
  retrievalPhaseStartedAt: number | null | undefined;
  setReviewWorkPhase: (phase: ReviewWorkPhase) => void;
  logger: Pick<Logger, "info" | "warn">;
  baseLog: Record<string, unknown>;
}): Promise<InitialReviewPromptPreparationResult> {
  const prLabels = params.pr.labels?.map((label) => label.name) ?? [];

  const promptEnrichment = await buildReviewPromptEnrichment({
    repo: `${params.owner}/${params.repo}`,
    prTitle: params.pr.title,
    prBody: params.pr.body ?? null,
    commitMessages: params.commitMessages,
    promptFiles: params.promptFiles,
    filesByCategory: params.diffAnalysis.filesByCategory,
    clusterMatcher: params.clusterMatcher,
    issueStore: params.issueStore,
    embeddingProvider: params.embeddingProvider,
    logger: params.logger,
    baseLog: params.baseLog,
  });
  const clusterPatternsForPrompt = promptEnrichment.clusterPatterns;
  const linkedIssueResult = promptEnrichment.linkedIssues;

  params.setReviewWorkPhase("prompt-build");
  const reviewPromptBuildContext = buildInitialReviewPromptContext({
    owner: params.owner,
    repo: params.repo,
    prNumber: params.pr.number,
    prTitle: params.pr.title,
    prBody: params.pr.body ?? "",
    prAuthor: params.pr.user.login,
    baseBranch: params.pr.base.ref,
    headBranch: params.pr.head.ref,
    changedFiles: params.promptFiles,
    customInstructions: params.config.review.prompt,
    checkpointEnabled: params.checkpointEnabled,
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
    prLabels,
    focusHints: params.parsedIntent.unrecognized,
    conventionalType: params.parsedIntent.conventionalType,
    priorFindings: params.priorFindings,
    tieredFiles: params.tieredFiles,
    contributorExperienceContract: params.authorClassification.contract,
    authorExpertise: projectReviewAuthorExpertiseForPrompt(params.authorClassification),
    depBumpContext: params.depBumpContext,
    searchRateLimitDegradation: params.authorClassification.searchEnrichment,
    isDraft: params.isDraft,
    clusterPatterns: clusterPatternsForPrompt,
    linkedIssues: linkedIssueResult,
    graphBlastRadius: params.graphBlastRadius,
    structuralImpact: params.structuralImpact,
    reviewBoundedness: params.reviewBoundedness,
    repoDoctrine: params.repoDoctrineProjection,
    taskType: params.taskType,
  });
  const reviewPromptRuntime = await buildInitialReviewPromptRuntime({
    deliveryId: params.eventId,
    repo: `${params.owner}/${params.repo}`,
    prNumber: params.pr.number,
    headSha: params.pr.head.sha,
    taskType: params.taskType,
    context: reviewPromptBuildContext,
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

  completeReviewRetrievalContextPhaseTiming({
    phases: params.reviewPhaseTimings,
    retrievalPhaseStartedAt: params.retrievalPhaseStartedAt ?? Date.now(),
  });

  return {
    prLabels,
    clusterPatternsForPrompt,
    linkedIssueResult,
    reviewPromptDerivedCacheStatus: reviewPromptRuntime.cacheStatus,
    reviewPromptDerivedCacheReason: reviewPromptRuntime.cacheReason,
    reviewPrompt: reviewPromptRuntime.prompt,
    reviewPromptSections: reviewPromptRuntime.promptSections,
  };
}
