import type { Octokit } from "@octokit/rest";
import type {
  PullRequestOpenedEvent,
  PullRequestReadyForReviewEvent,
  PullRequestReviewRequestedEvent,
  PullRequestSynchronizeEvent,
} from "@octokit/webhooks-types";
import type { Logger } from "pino";
import { createHash } from "node:crypto";
import type { EventRouter, WebhookEvent } from "../webhook/types.ts";
import type { JobQueue, WorkspaceManager, Workspace, JobQueueWaitMetadata } from "../jobs/types.ts";
import type { ReviewWorkCoordinator } from "../jobs/review-work-coordinator.ts";
import type {
  ExecutorPhaseTiming,
  ReviewPhaseName,
  ReviewPhaseTiming,
} from "../execution/types.ts";
import type { GitHubApp } from "../auth/github-app.ts";
import type { createExecutor } from "../execution/executor.ts";
import type { PromptSectionRecord, ReviewCacheEventRecord, TelemetryStore } from "../telemetry/types.ts";
import type {
  KnowledgeStore,
  PriorFinding,
  ContinuationFamilyAuthoritativeOutcome,
  ContinuationFamilyFinalStopReason,
  ContinuationFamilyProjectionStatus,
} from "../knowledge/types.ts";
import type { LearningMemoryStore, EmbeddingProvider } from "../knowledge/types.ts";
import type { ClusterPatternMatch } from "../knowledge/cluster-types.ts";
import { computeIncrementalDiff, type IncrementalDiffResult } from "../lib/incremental-diff.ts";
import { buildPriorFindingContext, shouldSuppressFinding, type PriorFindingContext } from "../lib/finding-dedup.ts";
import { classifyFindingDeltas, type DeltaClassification } from "../lib/delta-classifier.ts";
import { classifyClaims, buildFileDiffsMap, type FindingClaimClassification } from "../lib/claim-classifier.ts";
import { demoteExternalClaimSeverities, type DemotableFinding } from "../lib/severity-demoter.ts";
import { filterExternalClaims, formatSuppressedFindingsSection, type FilterableFinding, type FilteredFindingRecord } from "../lib/output-filter.ts";
import { runGuardrailPipeline } from "../lib/guardrail/pipeline.ts";
import { createGuardrailAuditStore } from "../lib/guardrail/audit-store.ts";
import { reviewAdapter, type ReviewInput } from "../lib/guardrail/adapters/review-adapter.ts";
import { loadRepoConfig } from "../execution/config.ts";
import { analyzeDiff, parseNumstatPerFile, classifyFileLanguageWithContext } from "../execution/diff-analysis.ts";
import {
  computeFileRiskScores,
  triageFilesByRisk,
  capTieredFilesForPromptBudget,
  applyGraphAwareSelection,
  type TieredFiles,
  type FileRiskScore,
} from "../lib/file-risk-scorer.ts";
import type { ReviewGraphBlastRadiusResult } from "../review-graph/query.ts";
import { isTrivialChange, validateGraphAmplifiedFindings, type GraphValidationFinding } from "../review-graph/validation.ts";
import { fetchReviewStructuralImpact } from "../structural-impact/review-integration.ts";
import { createStructuralImpactCache } from "../structural-impact/cache.ts";
import { summarizeStructuralImpactDegradation } from "../structural-impact/degradation.ts";
import {
  buildReviewPrompt,
  buildReviewPromptDetails,
  matchPathInstructions,
} from "../execution/review-prompt.ts";
import { buildPromptSectionRecord, type PromptBuildResult } from "../execution/prompt-section-metrics.ts";
import {
  DEFAULT_EMPTY_INTENT,
  parsePRIntent,
  type ParsedPRIntent,
} from "../lib/pr-intent-parser.ts";
import {
  resolveReviewProfile,
} from "../lib/auto-profile.ts";
import {
  resolveReviewRoutingLineCount,
  resolveReviewTaskRouting,
  resolveReviewMaxTurnsOverride,
} from "../lib/review-routing.ts";
import { prioritizeFindings } from "../lib/finding-prioritizer.ts";
import { computeConfidence, matchesSuppression } from "../knowledge/confidence.ts";
import { applyEnforcement } from "../enforcement/index.ts";
import { evaluateFeedbackSuppressions, adjustConfidenceForFeedback } from "../feedback/index.ts";
import type { SuggestionClusterStore } from "../knowledge/suggestion-cluster-store.ts";
import { applyClusterScoringWithDegradation } from "../knowledge/suggestion-cluster-degradation.ts";
import { classifyError, formatErrorComment, postOrUpdateErrorComment } from "../lib/errors.ts";
import { fetchAllPullRequestFiles, type PullRequestFileMetadata } from "../lib/github-pr-files.ts";
import { estimateTimeoutRisk, computeLanguageComplexity } from "../lib/timeout-estimator.ts";
import {
  ensureReviewBoundednessDisclosureInSummary,
  resolveReviewBoundedness,
  type ReviewBoundednessContract,
} from "../lib/review-boundedness.ts";
import { formatPartialReviewComment, formatCompletedContinuationReviewComment } from "../lib/partial-review-formatter.ts";
import {
  normalizeReviewFirstPass,
  type ReviewFirstPassPayload,
} from "../lib/review-first-pass.ts";
import {
  planReviewContinuation,
  settleReviewContinuation,
} from "../lib/review-continuation-lifecycle.ts";
import { computeRetryScope } from "../lib/retry-scope-reducer.ts";
import { type RetrieveResult, type createRetriever } from "../knowledge/retrieval.ts";
import { buildRetrievalVariants } from "../knowledge/multi-query-retrieval.ts";
import {
  buildApprovedReviewBody,
  buildReviewOutputMarker,
  buildReviewOutputKey,
  ensureReviewOutputNotPublished,
} from "./review-idempotency.ts";
import {
  buildReviewLearningMemoryRecord,
  isReviewLearningMemorySkip,
} from "./review-learning-memory.ts";
import {
  type ReviewArea,
  type FindingSeverity,
  type FindingCategory,
  type ConfidenceBand,
  SEARCH_RATE_LIMIT_ERROR_MARKERS,
  SEARCH_RATE_LIMIT_BACKOFF_MAX_MS,
  SEARCH_RATE_LIMIT_DISCLOSURE_LINE,
  PROFILE_PRESETS,
  ensureSearchRateLimitDisclosureInSummary,
  extractSearchErrorStatus,
  extractSearchErrorText,
  isSearchRateLimitError,
  resolveRateLimitBackoffMs,
  toConfidenceBand,
  fingerprintFindingTitle,
  buildReviewDetailsMarker,
  parseSeverityCountsFromBody,
  formatReviewDetailsSummary,
  classifyRetryFailure,
  resolveReviewDetailsLineCounts,
  type TimeoutReviewDetailsProgress,
  type TimeoutBudgetDetails,
  normalizeSeverity,
  normalizeCategory,
  parseInlineCommentMetadata,
  normalizeSkipPattern,
  renderApprovalConfidence,
  splitGitLines,
  isReviewTriggerEnabled,
  normalizeReviewerLogin,
  splitDiffByFile,
} from "../lib/review-utils.ts";
import picomatch from "picomatch";
import {
  parseDiffHunks,
  buildEmbeddingText,
  isExcludedPath,
  applyHunkCap,
  computeContentHash,
} from "../knowledge/code-snippet-chunker.ts";
import type { CodeSnippetStore } from "../knowledge/code-snippet-types.ts";
import {
  normalizeRepoDoctrineProjection,
  type RepoDoctrineProjection,
} from "../repo-doctrine/contracts.ts";
import { $ } from "bun";
import { fetchAndCheckoutPullRequestHeadRef, buildAuthFetchUrl, fetchRemoteTrackingBranch } from "../jobs/workspace.ts";
import {
  buildReviewFamilyKey,
  createReviewWorkCoordinator,
  type ReviewWorkPhase,
} from "../jobs/review-work-coordinator.ts";
import { classifyAuthor, type AuthorTier } from "../lib/author-classifier.ts";
import type { ContributorProfileStore, ContributorExpertise } from "../contributor/types.ts";
import {
  projectContributorExperienceContract,
  resolveContributorExperienceRetrievalHint,
  type ContributorExperienceContract,
  type ContributorExperienceSource,
} from "../contributor/experience-contract.ts";
import {
  resolveReviewAuthorClassification,
  type ReviewAuthorClassification,
} from "../contributor/review-author-resolution.ts";
import { updateExpertiseIncremental } from "../contributor/expertise-scorer.ts";
import type { AuthorCacheEntry, AuthorCacheTier } from "../knowledge/types.ts";
import { suggestIdentityLink } from "./identity-suggest.ts";
import { sanitizeOutgoingMentions } from "../lib/sanitizer.ts";
import {
  createDegradedReviewReducerResult,
  reduceReviewFindings,
  type ProcessedReviewFinding,
  type ReviewReducerInput,
  type ReviewReducerResult,
} from "../review-orchestration/review-reducer.ts";
import {
  createReviewCandidateFindingExecutionResult,
  toReviewCandidateFindingDetailsSummary,
  type ReviewCandidateFinding,
  type ReviewCandidateFindingDetailsSummary,
  type ReviewCandidateFindingExecutionResult,
} from "../review-orchestration/review-candidate-finding.ts";
import {
  buildReviewPlan,
  createDegradedReviewPlan,
  resolveGraphValidationPlanStatus,
  toReviewPlanDetailsSummary,
  type DegradedReviewPlan,
  type ReviewPlan,
} from "../review-orchestration/review-plan.ts";
import {
  coordinateReviewCandidateApproval,
  type ReviewCandidateApprovalResult,
} from "../review-orchestration/review-candidate-approval.ts";
import {
  adaptApprovedCandidatesForInlinePublication,
  buildCandidateReviewOutputKey,
  convertPublishedCandidateResultsToProcessedFindings,
  convertPublishedCandidateResultsToValidationTruthFixes,
  toReviewCandidatePublicationAdapterSummary,
  type ReviewCandidatePublishedFindingResult,
  type ReviewCandidatePublicationAdapterResult,
} from "../review-orchestration/review-candidate-publication-adapter.ts";
import {
  classifyReviewCandidatePublicationRuntime,
  createCandidatePublicationFlowEvidence,
  isExpectedCandidatePublicationPolicyBlock,
  type ReviewCandidatePublicationRuntimeResult,
} from "../review-orchestration/review-candidate-publication-runtime.ts";
import { classifyReviewTimeoutOutcome } from "../review-orchestration/review-timeout-classification.ts";
import {
  createInlineReviewPublisher,
  type InlineReviewPublicationResult,
} from "../execution/mcp/inline-review-publisher.ts";
import { createReviewOutputPublicationGate, type CandidateVerificationContext } from "../execution/mcp/review-output-publication-gate.ts";
import {
  detectDepBump,
  extractDepBumpDetails,
  classifyDepBump,
  type DepBumpContext,
} from "../lib/dep-bump-detector.ts";
import { analyzePackageUsage } from "../lib/usage-analyzer.ts";
import { detectScopeCoordination } from "../lib/scope-coordinator.ts";
import { fetchSecurityAdvisories, fetchChangelog } from "../lib/dep-bump-enrichment.ts";
import { computeMergeConfidence } from "../lib/merge-confidence.ts";
import {
  buildSearchCacheKey,
  createSearchCache,
  type SearchCache,
  type SearchCacheOptions,
} from "../lib/search-cache.ts";
import { detectDependsBump, type DependsBumpInfo } from "../lib/depends-bump-detector.ts";
import {
  parseVersionFileDiff,
  parsePackageListDiff,
  fetchDependsChangelog,
  verifyHash,
  detectPatchChanges,
} from "../lib/depends-bump-enrichment.ts";
import { findDependencyConsumers, checkTransitiveDependencies } from "../lib/depends-impact-analyzer.ts";
import {
  buildDependsReviewComment,
  buildDependsInlineComments,
  computeDependsVerdict,
  type DependsReviewData,
} from "../lib/depends-review-builder.ts";
import { generateWithFallback } from "../llm/generate.ts";
import { createTaskRouter } from "../llm/task-router.ts";
import { TASK_TYPES } from "../llm/task-types.ts";
import { linkPRToIssues, type LinkResult } from "../knowledge/issue-linker.ts";
import type { IssueStore } from "../knowledge/issue-types.ts";
import {
  runShadowSpecialistSubflow,
  type ShadowSpecialistSubflowInput,
  type ShadowSpecialistSubflowResult,
} from "../specialists/shadow-specialist-subflow.ts";
import { projectShadowSpecialistMetrics } from "../specialists/shadow-specialist-metrics.ts";
import {
  buildShadowSpecialistReviewDetailsProjection,
  type ShadowSpecialistReviewDetailsProjection,
} from "../specialists/shadow-specialist-review-details.ts";
import {
  createCandidateVerificationPublicationEvidenceCollector,
  type CandidateVerificationPublicationEvidenceSummary,
} from "../specialists/candidate-verification-publication-evidence.ts";
import {
  projectReviewHandlerCandidatePublicationBridgeEvidence,
  type ReviewHandlerPublicationBridgeProjection,
} from "../issue-131/review-handler-publication-bridge.ts";
import {
  buildReviewDetailsBudgetLines,
  buildVisibleBudgetProjection,
  type PromptBudgetEvidenceObservation,
  type VisibleBudgetProjection,
  type VisibleBudgetScenario,
} from "../review-visible-budget/visible-budget-behavior.ts";
import type { ReviewCacheTelemetryObservation } from "../review-cache-telemetry/cache-telemetry.ts";
import type { ContinuationCompactionObservation } from "../review-continuation/continuation-compaction.ts";
import type { PromptBudgetOutcome } from "../execution/prompt-budget.ts";
import {
  attachReviewFindingLifecycle,
  attachReviewValidationTruth,
  type AttachReviewFindingLifecycleResult,
  type AttachReviewValidationTruthResult,
} from "../review-lifecycle/handler-lifecycle.ts";



type ExtractedFinding = {
  commentId: number;
  filePath: string;
  title: string;
  severity: FindingSeverity;
  category: FindingCategory;
  startLine?: number;
  endLine?: number;
};

type ProcessedFinding = ExtractedFinding & {
  suppressed: boolean;
  confidence: number;
  suppressionPattern?: string;
  deprioritized?: boolean;
  claimClassification?: FindingClaimClassification;
  preDemotionSeverity?: FindingSeverity;
  severityDemoted?: boolean;
  demotionReason?: string;
  filterAction?: "rewritten" | "suppressed" | "guardrail-suppressed" | "guardrail-rewritten";
  originalTitle?: string;
};

type RetrievalContextForPrompt = {
  findings: Array<{
    findingText: string;
    severity: string;
    category: string;
    path: string;
    line?: number;
    snippet?: string;
    outcome: string;
    distance: number;
    sourceRepo: string;
  }>;
  maxChars: number;
};

type AuthorTierSearchEnrichment = {
  degraded: boolean;
  retryAttempts: number;
  skippedQueries: number;
  degradationPath: "none" | "search-api-rate-limit";
};

type ReviewPromptBuildContext = Parameters<typeof buildReviewPromptDetails>[0];

export type ReviewPromptFingerprintResult = {
  fingerprint: string | null;
  missingSignals: string[];
};

type ReviewPromptCacheState = {
  status: ReviewCacheEventRecord["status"];
  reason: string | null;
  fingerprintVersion?: string;
  safetySignalNames?: string[];
  missingSignalNames?: string[];
  invalidationSignalNames?: string[];
  bookkeepingErrorCount?: number;
};

const REVIEW_PROMPT_FINGERPRINT_VERSION = "review-prompt-v1";
const RETRIEVAL_EMBEDDING_FINGERPRINT_VERSION = "retrieval-query-embedding-v1";
const BOUNDED_REVIEW_CACHE_SIGNAL_NAME = /^[a-z0-9][a-z0-9.-]{0,79}$/;

function normalizeReviewCacheSignalNames(values: readonly string[] | undefined): string[] | undefined {
  if (!values || values.length === 0) return undefined;
  const normalized = Array.from(new Set(
    values
      .map((value) => value.trim().toLowerCase())
      .filter((value) => BOUNDED_REVIEW_CACHE_SIGNAL_NAME.test(value)),
  )).sort((a, b) => a.localeCompare(b));
  return normalized.length > 0 ? normalized : undefined;
}

function mapReviewPromptCacheReason(state: ReviewPromptCacheState): ReviewCacheEventRecord["reason"] {
  if (state.status === "hit") return "safe-reuse";
  if (state.status === "miss") return "cache-miss";
  if (state.status === "bypass") {
    return state.reason === "disabled-cache" ? "disabled-cache" : "incomplete-fingerprint";
  }
  if (state.status === "degraded") return "bookkeeping-failure";
  return undefined;
}

function buildPromptReviewCacheEvent(params: {
  deliveryId: string;
  repo: string;
  prNumber: number;
  state: ReviewPromptCacheState;
}): ReviewCacheEventRecord {
  const reason = mapReviewPromptCacheReason(params.state);
  return {
    deliveryId: params.deliveryId,
    repo: params.repo,
    prNumber: params.prNumber,
    cacheSurface: "review-derived-prompt",
    status: params.state.status,
    ...(reason ? { reason } : {}),
    ...(params.state.fingerprintVersion ? { fingerprintVersion: params.state.fingerprintVersion } : {}),
    ...(normalizeReviewCacheSignalNames(params.state.safetySignalNames) ? { safetySignalNames: normalizeReviewCacheSignalNames(params.state.safetySignalNames) } : {}),
    ...(normalizeReviewCacheSignalNames(params.state.missingSignalNames) ? { missingSignalNames: normalizeReviewCacheSignalNames(params.state.missingSignalNames) } : {}),
    ...(normalizeReviewCacheSignalNames(params.state.invalidationSignalNames) ? { invalidationSignalNames: normalizeReviewCacheSignalNames(params.state.invalidationSignalNames) } : {}),
    ...(params.state.bookkeepingErrorCount ? { bookkeepingErrorCount: params.state.bookkeepingErrorCount } : {}),
  };
}

function buildPromptBudgetEvidenceObservations(records: readonly PromptSectionRecord[]): PromptBudgetEvidenceObservation[] {
  return records
    .map((record) => {
      const sections = record.sections
        .filter((section) =>
          typeof section.budgetChars === "number"
          && typeof section.budgetTokens === "number"
          && typeof section.includedChars === "number"
          && typeof section.includedTokens === "number"
          && typeof section.trimmedChars === "number"
          && typeof section.trimmedTokens === "number"
          && (section.budgetStatus === "included" || section.budgetStatus === "trimmed" || section.budgetStatus === "bypassed")
          && (section.budgetReason === "within-budget" || section.budgetReason === "section-over-budget" || section.budgetReason === "zero-budget")
        )
        .map((section) => ({
          sectionName: section.sectionName,
          sectionPosition: section.sectionPosition,
          budgetChars: section.budgetChars!,
          budgetTokens: section.budgetTokens!,
          includedChars: section.includedChars!,
          includedTokens: section.includedTokens!,
          trimmedChars: section.trimmedChars!,
          trimmedTokens: section.trimmedTokens!,
          budgetStatus: section.budgetStatus!,
          budgetReason: section.budgetReason!,
        }));

      if (sections.length === 0) {
        return null;
      }

      return {
        caseId: `${record.promptKind}:budget`,
        deliveryId: record.deliveryId ?? "unknown-delivery",
        repo: record.repo,
        taskType: record.taskType,
        promptKind: record.promptKind,
        sections,
      };
    })
    .filter((entry): entry is PromptBudgetEvidenceObservation => entry !== null);
}

function buildPromptBudgetOutcomes(records: readonly PromptSectionRecord[]): PromptBudgetOutcome[] {
  return buildPromptBudgetEvidenceObservations(records).flatMap((observation) =>
    observation.sections.map((section) => ({
      sectionName: section.sectionName,
      sectionPosition: section.sectionPosition,
      budgetChars: section.budgetChars,
      budgetTokens: section.budgetTokens,
      includedChars: section.includedChars,
      includedTokens: section.includedTokens,
      trimmedChars: section.trimmedChars,
      trimmedTokens: section.trimmedTokens,
      status: section.budgetStatus,
      reason: section.budgetReason,
    }))
  );
}

function chooseVisibleBudgetScenario(params: {
  promptBudgetEvidence: readonly PromptBudgetEvidenceObservation[];
  cacheTelemetryObservations: readonly ReviewCacheTelemetryObservation[];
  continuationCompactionObservations: readonly ContinuationCompactionObservation[];
}): VisibleBudgetScenario {
  if (params.continuationCompactionObservations.some((observation) => observation.status === "fallback")) {
    return "fallback-review";
  }

  const promptScoped = params.promptBudgetEvidence.some((observation) =>
    observation.sections.some((section) => section.budgetStatus === "trimmed" || section.budgetStatus === "bypassed")
  );
  const cacheScoped = params.cacheTelemetryObservations.some((observation) =>
    observation.status === "degraded" || observation.status === "bypass"
  );
  const continuationScoped = params.continuationCompactionObservations.some((observation) =>
    observation.status === "compacted" || observation.status === "degraded"
  );

  return promptScoped || cacheScoped || continuationScoped ? "scoped-review" : "happy-path";
}

function buildVisibleBudgetProjectionFromEvidence(params: {
  promptSectionRecords: readonly PromptSectionRecord[];
  cacheTelemetryObservations: readonly ReviewCacheTelemetryObservation[];
  continuationCompactionObservations: readonly ContinuationCompactionObservation[];
}): VisibleBudgetProjection | null {
  const promptBudgetEvidence = buildPromptBudgetEvidenceObservations(params.promptSectionRecords);
  if (
    promptBudgetEvidence.length === 0
    && params.cacheTelemetryObservations.length === 0
    && params.continuationCompactionObservations.length === 0
  ) {
    return null;
  }

  return buildVisibleBudgetProjection({
    scenario: chooseVisibleBudgetScenario({
      promptBudgetEvidence,
      cacheTelemetryObservations: params.cacheTelemetryObservations,
      continuationCompactionObservations: params.continuationCompactionObservations,
    }),
    promptBudgetEvidence,
    cacheTelemetryObservations: params.cacheTelemetryObservations,
    continuationCompactionObservations: params.continuationCompactionObservations,
  });
}

function appendReviewDetailsBudgetLines(body: string, projection: VisibleBudgetProjection | null): string {
  if (!projection) return body;
  const lines = buildReviewDetailsBudgetLines(projection).map((line) => `- ${line}`);
  const closeMarker = "\n\n</details>";
  const closeIndex = body.lastIndexOf(closeMarker);
  if (closeIndex === -1) {
    return `${body}\n${lines.join("\n")}`;
  }
  return `${body.slice(0, closeIndex)}\n${lines.join("\n")}${body.slice(closeIndex)}`;
}

function buildVisibleBudgetDisclosureEvidence(projection: VisibleBudgetProjection | null): string | null {
  if (!projection || projection.visibleStatus === "complete") return null;
  if (projection.visibleStatus === "fallback") {
    return "Review scope note: fallback review behavior was used; Review Details include bounded budget/cache/continuation counts only.";
  }
  if (projection.visibleReason === "prompt-budget-limited") {
    return "Review scope note: output was scoped by prompt budget limits; Review Details include bounded counts only.";
  }
  if (projection.visibleReason === "cache-degraded") {
    return "Review scope note: cache reuse was degraded or bypassed; Review Details include bounded cache status counts only.";
  }
  return "Review scope note: continuation or compaction behavior scoped the review; Review Details include bounded counts only.";
}

function buildRetrievalReviewCacheEvent(params: {
  deliveryId: string;
  repo: string;
  prNumber: number;
  result: RetrieveResult | null | undefined;
}): ReviewCacheEventRecord {
  const provenance = params.result?.provenance;
  if (
    !params.result
    || !provenance
    || !Number.isFinite(provenance.embeddingRequests)
    || !Number.isFinite(provenance.embeddingCacheHits)
  ) {
    return {
      deliveryId: params.deliveryId,
      repo: params.repo,
      prNumber: params.prNumber,
      cacheSurface: "retrieval-query-embedding",
      status: "degraded",
      reason: "unavailable-retrieval",
      missingSignalNames: ["retrieval-provenance"],
    };
  }

  if (provenance.embeddingCacheHits > 0) {
    return {
      deliveryId: params.deliveryId,
      repo: params.repo,
      prNumber: params.prNumber,
      cacheSurface: "retrieval-query-embedding",
      status: "hit",
      reason: "safe-reuse",
      fingerprintVersion: RETRIEVAL_EMBEDDING_FINGERPRINT_VERSION,
      safetySignalNames: ["embedding-cache-provenance"],
    };
  }

  return {
    deliveryId: params.deliveryId,
    repo: params.repo,
    prNumber: params.prNumber,
    cacheSurface: "retrieval-query-embedding",
    status: "miss",
    reason: "cache-miss",
    fingerprintVersion: RETRIEVAL_EMBEDDING_FINGERPRINT_VERSION,
    safetySignalNames: ["embedding-cache-provenance"],
  };
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function hashPromptString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return sha256Hex(value);
}

function buildShadowSpecialistCorrelationKey(params: {
  deliveryId?: string | null;
  reviewOutputKey?: string | null;
  prNumber: number;
}): string {
  return sha256Hex(`${params.deliveryId ?? "unknown-delivery"}:${params.reviewOutputKey ?? "unknown-output"}:${params.prNumber}`).slice(0, 16);
}

function buildShadowSpecialistLogFields(result: ShadowSpecialistSubflowResult): Record<string, unknown> {
  try {
    const metricsProjection = projectShadowSpecialistMetrics(result);
    const reviewDetailsProjection = buildShadowSpecialistReviewDetailsProjection(metricsProjection);

    return {
      gate: "shadow-specialist",
      laneId: reviewDetailsProjection.laneId,
      status: result.triggerStatus,
      outputStatus: reviewDetailsProjection.status,
      reason: reviewDetailsProjection.reason,
      candidateCount: reviewDetailsProjection.candidateCount,
      decisionCount: reviewDetailsProjection.decisionCount,
      decisionCounts: reviewDetailsProjection.decisionCounts,
      duplicateCount: reviewDetailsProjection.duplicateCount,
      disagreementCount: reviewDetailsProjection.disagreementCount,
      dismissedCount: reviewDetailsProjection.dismissedCount,
      unclassifiableCount: reviewDetailsProjection.unclassifiableCount,
      truncatedCandidateCount: reviewDetailsProjection.truncatedCandidateCount,
      durationMs: result.durationMs,
      deliveryId: reviewDetailsProjection.deliveryId,
      reviewOutputKey: reviewDetailsProjection.reviewOutputKey,
      correlationKey: reviewDetailsProjection.correlationKey,
      metricAvailability: reviewDetailsProjection.metricAvailability,
      tokenCountAvailable: reviewDetailsProjection.tokenCountAvailable,
      costAvailable: reviewDetailsProjection.costAvailable,
      latencyMsAvailable: reviewDetailsProjection.latencyMsAvailable,
      unsafeFieldCount: reviewDetailsProjection.redactionFlags.unsafeFieldCount,
      discardedRawPayload: reviewDetailsProjection.redactionFlags.discardedRawPayload,
      discardedPublicationFields: reviewDetailsProjection.redactionFlags.discardedPublicationFields,
      discardedApprovalFields: reviewDetailsProjection.redactionFlags.discardedApprovalFields,
      privateOnly: reviewDetailsProjection.privateOnly,
      shadowOnly: reviewDetailsProjection.shadowOnly,
      publishesFindings: reviewDetailsProjection.publishesFindings,
      visiblePublicationDenied: reviewDetailsProjection.visiblePublicationDenied,
      approvalPublicationDenied: reviewDetailsProjection.approvalPublicationDenied,
      rawContentFieldCount: reviewDetailsProjection.rawContentFieldCount,
      candidateBodyFieldCount: reviewDetailsProjection.candidateBodyFieldCount,
      githubPublicationFieldCount: reviewDetailsProjection.githubPublicationFieldCount,
      approvalFieldCount: reviewDetailsProjection.approvalFieldCount,
      specialistContentIncluded: reviewDetailsProjection.specialistContentIncluded,
      candidateFingerprintsIncluded: reviewDetailsProjection.candidateFingerprintsIncluded,
      candidateBodiesIncluded: reviewDetailsProjection.candidateBodiesIncluded,
      rawModelOutputIncluded: reviewDetailsProjection.rawModelOutputIncluded,
      toolPayloadIncluded: reviewDetailsProjection.toolPayloadIncluded,
      approvalFieldsIncluded: reviewDetailsProjection.approvalFieldsIncluded,
      tierModeIncluded: reviewDetailsProjection.tierModeIncluded,
      s04EvidenceAvailable: true,
      reviewDetailsProjectionAvailable: true,
      reviewDetailsProjectionStatus: reviewDetailsProjection.status,
      reviewDetailsLineAvailable: reviewDetailsProjection.reviewDetailsLine.length > 0,
      metricBoundedness: "bounded-aggregate-only",
      metricBoundednessAvailable: true,
      metricProjectionDegraded: false,
      compactReviewDetailsPrivateOnly: reviewDetailsProjection.privateOnly,
      compactReviewDetailsShadowOnly: reviewDetailsProjection.shadowOnly,
      compactReviewDetailsVisiblePublicationDenied: reviewDetailsProjection.visiblePublicationDenied,
      compactReviewDetailsApprovalPublicationDenied: reviewDetailsProjection.approvalPublicationDenied,
    };
  } catch {
    return {
      gate: "shadow-specialist",
      laneId: result.laneId ?? "docs-config-truth",
      status: "degraded",
      outputStatus: "degraded",
      reason: "metrics-projection-error",
      durationMs: result.durationMs,
      deliveryId: result.deliveryId,
      reviewOutputKey: result.reviewOutputKey,
      correlationKey: result.correlationKey,
      privateOnly: true,
      shadowOnly: true,
      publishesFindings: false,
      visiblePublicationDenied: true,
      approvalPublicationDenied: true,
      specialistContentIncluded: false,
      candidateFingerprintsIncluded: false,
      candidateBodiesIncluded: false,
      rawModelOutputIncluded: false,
      toolPayloadIncluded: false,
      approvalFieldsIncluded: false,
      tierModeIncluded: false,
      s04EvidenceAvailable: false,
      reviewDetailsProjectionAvailable: false,
      reviewDetailsProjectionStatus: "degraded",
      reviewDetailsLineAvailable: false,
      metricBoundedness: "bounded-aggregate-only",
      metricBoundednessAvailable: false,
      metricProjectionDegraded: true,
    };
  }
}

function buildCandidateVerificationPublicationEvidenceLogFields(
  evidence: CandidateVerificationPublicationEvidenceSummary,
): Record<string, unknown> {
  return {
    gate: "m070-candidate-verification-evidence",
    aggregateStatus: evidence.aggregateStatus,
    attemptedCount: evidence.counts.attempted,
    allowedCount: evidence.counts.allowed,
    deniedCount: evidence.counts.denied,
    publishedCount: evidence.counts.published,
    skippedCount: evidence.counts.skipped,
    failedCount: evidence.counts.failed,
    publicationDenialCounts: evidence.publicationDenialCounts,
    reasonCategories: evidence.reasonCategories,
    verificationStateCounts: evidence.verificationStateCounts,
    candidateVerificationCounts: evidence.candidateVerificationCounts,
    hasDeliveryId: evidence.metadata.hasDeliveryId,
    hasReviewOutputKey: evidence.metadata.hasReviewOutputKey,
    hasCorrelationKey: evidence.metadata.hasCorrelationKey,
    deliveryId: evidence.metadata.deliveryId,
    reviewOutputKey: evidence.metadata.reviewOutputKey,
    correlationKey: evidence.metadata.correlationKey,
    privateOnly: evidence.redactionFlags.privateOnly,
    candidateBodiesIncluded: evidence.redactionFlags.candidateBodiesIncluded,
    specialistProseIncluded: evidence.redactionFlags.specialistProseIncluded,
    rawPromptsIncluded: evidence.redactionFlags.rawPromptsIncluded,
    rawModelOutputIncluded: evidence.redactionFlags.rawModelOutputIncluded,
    diffsIncluded: evidence.redactionFlags.diffsIncluded,
    evidencePayloadsIncluded: evidence.redactionFlags.evidencePayloadsIncluded,
    rawFingerprintsIncluded: evidence.redactionFlags.rawFingerprintsIncluded,
    publicationEvidenceIncluded: evidence.redactionFlags.publicationEvidenceIncluded,
    unsafeInputFieldCount: evidence.redactionFlags.unsafeInputFieldCount,
    discardedRawPayload: evidence.redactionFlags.discardedRawPayload,
    discardedPublicationFields: evidence.redactionFlags.discardedPublicationFields,
    discardedEvidencePayloads: evidence.redactionFlags.discardedEvidencePayloads,
    candidateAttemptIncluded: evidence.redactionFlags.candidateAttemptIncluded,
    candidateKeyIncluded: evidence.redactionFlags.candidateKeyIncluded,
    boundedness: "aggregate-only",
  };
}

function normalizePromptStringList(values: string[] | undefined, signal: string): { values: string[] | null; missingSignals: string[] } {
  if (!values) {
    return { values: [], missingSignals: [] };
  }

  const normalized = values
    .map((value) => typeof value === "string" ? value.trim() : "")
    .filter((value) => value.length > 0);

  if (values.length > 0 && normalized.length !== values.length) {
    return { values: null, missingSignals: [signal] };
  }

  return {
    values: Array.from(new Set(normalized)).sort((a, b) => a.localeCompare(b)),
    missingSignals: [],
  };
}

function summarizeRetrievalContextFingerprint(
  retrievalContext: ReviewPromptBuildContext["retrievalContext"],
): { value: Record<string, unknown> | null; missingSignals: string[] } {
  if (!retrievalContext) {
    return { value: null, missingSignals: [] };
  }

  const summarizedFindings: Array<Record<string, unknown>> = [];
  for (const finding of retrievalContext.findings) {
    if (
      typeof finding.findingText !== "string"
      || typeof finding.severity !== "string"
      || typeof finding.category !== "string"
      || typeof finding.path !== "string"
      || typeof finding.outcome !== "string"
      || typeof finding.sourceRepo !== "string"
      || !Number.isFinite(finding.distance)
    ) {
      return { value: null, missingSignals: ["retrieval-fingerprint-data"] };
    }

    summarizedFindings.push({
      findingTextHash: sha256Hex(finding.findingText),
      severity: finding.severity,
      category: finding.category,
      path: finding.path,
      line: finding.line ?? null,
      snippetHash: hashPromptString(finding.snippet),
      outcome: finding.outcome,
      distance: Number(finding.distance.toFixed(6)),
      sourceRepo: finding.sourceRepo.toLowerCase(),
    });
  }

  return {
    value: {
      maxChars: retrievalContext.maxChars ?? null,
      findings: summarizedFindings,
    },
    missingSignals: [],
  };
}

export function buildReviewPromptFingerprint(
  context: ReviewPromptBuildContext,
): ReviewPromptFingerprintResult {
  const missingSignals: string[] = [];

  const owner = context.owner.trim().toLowerCase();
  const repo = context.repo.trim().toLowerCase();
  const baseBranch = context.baseBranch.trim();
  const headBranch = context.headBranch.trim();
  const prAuthor = context.prAuthor.trim();
  const normalizedChangedFiles = normalizePromptStringList(context.changedFiles, "changed-files");
  const focusAreas = normalizePromptStringList(context.focusAreas, "focus-areas");
  const ignoredAreas = normalizePromptStringList(context.ignoredAreas, "ignored-areas");
  const prLabels = normalizePromptStringList(context.prLabels, "pr-labels");
  const focusHints = normalizePromptStringList(context.focusHints, "focus-hints");
  const retrievalSummary = summarizeRetrievalContextFingerprint(context.retrievalContext);

  missingSignals.push(...normalizedChangedFiles.missingSignals, ...focusAreas.missingSignals, ...ignoredAreas.missingSignals, ...prLabels.missingSignals, ...focusHints.missingSignals, ...retrievalSummary.missingSignals);

  if (!owner || !repo) missingSignals.push("repo-identity");
  if (!Number.isInteger(context.prNumber) || context.prNumber <= 0) missingSignals.push("pr-number");
  if (!baseBranch || !headBranch) missingSignals.push("pr-refs");
  if (normalizedChangedFiles.values !== null && normalizedChangedFiles.values.length === 0) missingSignals.push("changed-files");
  if (typeof context.prTitle !== "string") missingSignals.push("pr-title");
  if (!prAuthor) missingSignals.push("pr-author");

  if (missingSignals.length > 0) {
    return { fingerprint: null, missingSignals: Array.from(new Set(missingSignals)) };
  }

  const fingerprintPayload = {
    version: 1,
    repo: `${owner}/${repo}`,
    prNumber: context.prNumber,
    prTitleHash: sha256Hex(context.prTitle),
    prBodyHash: hashPromptString(context.prBody),
    prAuthor,
    baseBranch,
    headBranch,
    changedFiles: normalizedChangedFiles.values,
    customInstructionsHash: hashPromptString(context.customInstructions),
    checkpointEnabled: context.checkpointEnabled ?? false,
    mode: context.mode ?? "standard",
    severityMinLevel: context.severityMinLevel ?? "minor",
    focusAreas: focusAreas.values,
    ignoredAreas: ignoredAreas.values,
    maxComments: context.maxComments ?? null,
    suppressionsHash: hashPromptString(JSON.stringify(context.suppressions ?? [])),
    minConfidence: context.minConfidence ?? null,
    diffAnalysisHash: hashPromptString(JSON.stringify(context.diffAnalysis ?? null)),
    matchedPathInstructionsHash: hashPromptString(JSON.stringify(context.matchedPathInstructions ?? [])),
    incrementalContextHash: hashPromptString(JSON.stringify(context.incrementalContext ?? null)),
    retrievalContext: retrievalSummary.value,
    reviewPrecedentsHash: hashPromptString(JSON.stringify(context.reviewPrecedents ?? [])),
    wikiKnowledgeHash: hashPromptString(JSON.stringify(context.wikiKnowledge ?? [])),
    filesByLanguageHash: hashPromptString(JSON.stringify(context.filesByLanguage ?? null)),
    outputLanguage: context.outputLanguage ?? null,
    prLabels: prLabels.values,
    focusHints: focusHints.values,
    conventionalTypeHash: hashPromptString(JSON.stringify(context.conventionalType ?? null)),
    deltaContextHash: hashPromptString(JSON.stringify(context.deltaContext ?? null)),
    largePRContextHash: hashPromptString(JSON.stringify(context.largePRContext ?? null)),
    authorTier: context.authorTier ?? null,
    contributorExperienceContractHash: hashPromptString(JSON.stringify(context.contributorExperienceContract ?? null)),
    authorExpertiseHash: hashPromptString(JSON.stringify(context.authorExpertise ?? [])),
    depBumpContextHash: hashPromptString(JSON.stringify(context.depBumpContext ?? null)),
    searchRateLimitDegradationHash: hashPromptString(JSON.stringify(context.searchRateLimitDegradation ?? null)),
    isDraft: context.isDraft ?? false,
    unifiedResultsHash: hashPromptString(JSON.stringify(context.unifiedResults ?? [])),
    contextWindowHash: hashPromptString(context.contextWindow),
    clusterPatternsHash: hashPromptString(JSON.stringify(context.clusterPatterns ?? [])),
    linkedIssuesHash: hashPromptString(JSON.stringify(context.linkedIssues ?? null)),
    activeRulesHash: hashPromptString(JSON.stringify(context.activeRules ?? [])),
    graphBlastRadiusHash: hashPromptString(JSON.stringify(context.graphBlastRadius ?? null)),
    graphContextOptionsHash: hashPromptString(JSON.stringify(context.graphContextOptions ?? null)),
    structuralImpactHash: hashPromptString(JSON.stringify(context.structuralImpact ?? null)),
    reviewBoundednessHash: hashPromptString(JSON.stringify(context.reviewBoundedness ?? null)),
    publishToolNamesHash: hashPromptString(JSON.stringify(context.publishToolNames ?? [])),
    candidateFindingToolName: context.candidateFindingToolName ?? null,
    candidateFindingMode: context.candidateFindingMode ?? null,
  };

  return {
    fingerprint: sha256Hex(JSON.stringify(fingerprintPayload)),
    missingSignals: [],
  };
}

const REVIEW_PHASE_ORDER = [
  "queue wait",
  "workspace preparation",
  "retrieval/context assembly",
  "executor handoff",
  "remote runtime",
  "publication",
] as const satisfies ReadonlyArray<ReviewPhaseName>;

function createReviewPhaseTiming(params: {
  name: ReviewPhaseName;
  status: ReviewPhaseTiming["status"];
  durationMs?: number;
  detail?: string;
}): ReviewPhaseTiming {
  return {
    name: params.name,
    status: params.status,
    ...(params.durationMs !== undefined ? { durationMs: params.durationMs } : {}),
    ...(params.detail ? { detail: params.detail } : {}),
  };
}

function buildUnavailableReviewPhase(name: ReviewPhaseName, detail: string): ReviewPhaseTiming {
  return createReviewPhaseTiming({
    name,
    status: "unavailable",
    detail,
  });
}

function isValidQueueWaitMetadata(metadata?: JobQueueWaitMetadata): metadata is JobQueueWaitMetadata {
  return Boolean(
    metadata &&
    Number.isFinite(metadata.queuedAtMs) &&
    Number.isFinite(metadata.startedAtMs) &&
    Number.isFinite(metadata.waitMs) &&
    metadata.queuedAtMs >= 0 &&
    metadata.startedAtMs >= metadata.queuedAtMs &&
    metadata.waitMs >= 0 &&
    metadata.startedAtMs - metadata.queuedAtMs === metadata.waitMs,
  );
}

function buildQueueWaitPhase(metadata?: JobQueueWaitMetadata): ReviewPhaseTiming {
  if (!isValidQueueWaitMetadata(metadata)) {
    return buildUnavailableReviewPhase("queue wait", "invalid queue wait metadata");
  }

  return createReviewPhaseTiming({
    name: "queue wait",
    status: "completed",
    durationMs: metadata.waitMs,
  });
}

export function formatTimeoutErrorDetail(params: {
  totalTimeoutSeconds: number;
  complexityInfo: string;
  hasReviewOutput: boolean;
  timeoutEstimate?: TimeoutBudgetDetails | null;
}): string {
  const summary = params.hasReviewOutput
    ? "Timed out after partial review output."
    : "Timed out with no review output.";

  const budgetDetail = params.timeoutEstimate
    ? `Timeout budget: remote runtime ${params.timeoutEstimate.remoteRuntimeBudgetSeconds}s + infra overhead ${params.timeoutEstimate.infraOverheadBudgetSeconds}s = total ${params.timeoutEstimate.totalTimeoutSeconds}s.`
    : `Timed out after ${params.totalTimeoutSeconds}s.`;

  return `${summary} ${budgetDetail} PR complexity: ${params.complexityInfo}`;
}

function buildExecutorUnavailablePhases(detail: string): ExecutorPhaseTiming[] {
  return [
    createReviewPhaseTiming({
      name: "executor handoff",
      status: "unavailable",
      detail,
    }) as ExecutorPhaseTiming,
    createReviewPhaseTiming({
      name: "remote runtime",
      status: "unavailable",
      detail,
    }) as ExecutorPhaseTiming,
  ];
}

function buildOrderedReviewPhaseSummary(phases: Map<ReviewPhaseName, ReviewPhaseTiming>): ReviewPhaseTiming[] {
  return REVIEW_PHASE_ORDER.map((name) =>
    phases.get(name) ?? buildUnavailableReviewPhase(name, "phase timing unavailable"));
}

function buildReviewDetailsPhaseTimingSummary(params: {
  phases: Map<ReviewPhaseName, ReviewPhaseTiming>;
  publicationPhaseStartedAt?: number;
  totalPhaseStartAt?: number;
}) {
  const phaseSnapshot = new Map(params.phases);

  if (!phaseSnapshot.has("publication")) {
    if (params.publicationPhaseStartedAt !== undefined) {
      phaseSnapshot.set(
        "publication",
        createReviewPhaseTiming({
          name: "publication",
          status: "degraded",
          durationMs: Math.max(0, Date.now() - params.publicationPhaseStartedAt),
          detail: "captured before publication completed",
        }),
      );
    } else {
      phaseSnapshot.set(
        "publication",
        buildUnavailableReviewPhase("publication", "phase timing unavailable"),
      );
    }
  }

  const totalDurationMs =
    typeof params.totalPhaseStartAt === "number" &&
      Number.isFinite(params.totalPhaseStartAt) &&
      params.totalPhaseStartAt > 0
      ? Math.max(0, Date.now() - params.totalPhaseStartAt)
      : undefined;

  return {
    ...(typeof totalDurationMs === "number" ? { totalDurationMs } : {}),
    phases: buildOrderedReviewPhaseSummary(phaseSnapshot),
  };
}

export function resolveAuthorTierFromSources(params: {
  contributorTier?: AuthorTier | null;
  cachedTier?: AuthorCacheTier | null;
  fallbackTier: AuthorTier;
}): { tier: AuthorTier; source: "contributor-profile" | "author-cache" | "fallback" } {
  const { contributorTier, cachedTier, fallbackTier } = params;

  if (contributorTier) {
    return { tier: contributorTier, source: "contributor-profile" };
  }

  if (cachedTier) {
    return { tier: cachedTier, source: "author-cache" };
  }

  return { tier: fallbackTier, source: "fallback" };
}

function normalizeAuthorCacheTier(value: string | null | undefined): AuthorCacheTier | null {
  if (value === "first-time" || value === "regular" || value === "core") {
    return value;
  }
  return null;
}

function normalizeAuthorCacheEntry(entry: AuthorCacheEntry | null | undefined): AuthorCacheEntry | null {
  if (!entry) {
    return null;
  }

  const normalizedTier = normalizeAuthorCacheTier(entry.tier);
  if (!normalizedTier) {
    return null;
  }

  return {
    ...entry,
    tier: normalizedTier,
  };
}

function normalizeContributorProfileTier(value: string | null | undefined): AuthorTier | null {
  if (value === "newcomer" || value === "developing" || value === "established" || value === "senior") {
    return value;
  }
  return null;
}

function hasAssociationFallbackSignal(authorAssociation: string): boolean {
  return [
    "MEMBER",
    "OWNER",
    "FIRST_TIMER",
    "FIRST_TIME_CONTRIBUTOR",
    "COLLABORATOR",
    "CONTRIBUTOR",
  ].includes(authorAssociation);
}

async function executeSearchWithRateLimitRetry(params: {
  operation: () => Promise<number>;
  logger: Logger;
  authorLogin: string;
}): Promise<{ value: number | null; retryAttempts: number; degraded: boolean }> {
  const { operation, logger, authorLogin } = params;

  try {
    return {
      value: await operation(),
      retryAttempts: 0,
      degraded: false,
    };
  } catch (err) {
    if (!isSearchRateLimitError(err)) {
      throw err;
    }

    const backoffMs = resolveRateLimitBackoffMs(err);
    logger.warn(
      { err, authorLogin, backoffMs, retryAttempts: 1 },
      "Search API rate limit detected; retrying author-tier enrichment once",
    );

    if (backoffMs > 0) {
      await Bun.sleep(backoffMs);
    }

    try {
      return {
        value: await operation(),
        retryAttempts: 1,
        degraded: false,
      };
    } catch (retryErr) {
      if (!isSearchRateLimitError(retryErr)) {
        throw retryErr;
      }

      logger.warn(
        { err: retryErr, authorLogin, retryAttempts: 1 },
        "Search API remained rate-limited after one retry; degrading enrichment",
      );

      return {
        value: null,
        retryAttempts: 1,
        degraded: true,
      };
    }
  }
}

async function fetchCommitMessages(
  octokit: Awaited<ReturnType<GitHubApp["getInstallationOctokit"]>>,
  owner: string,
  repo: string,
  prNumber: number,
  commitCount: number,
): Promise<Array<{ sha: string; message: string }>> {
  if (commitCount === 0) return [];

  const perPage = Math.min(commitCount, 100);
  const { data } = await octokit.rest.pulls.listCommits({
    owner,
    repo,
    pull_number: prNumber,
    per_page: perPage,
  });

  return data.map((c) => ({
    sha: c.sha.slice(0, 7),
    message: c.commit.message.split("\n")[0] ?? "",
  }));
}





type CanonicalReviewSurface =
  | { kind: "issue_comment"; commentId: number; body: string }
  | { kind: "pull_review"; reviewId: number; body: string };

type CanonicalSurfaceKind = CanonicalReviewSurface["kind"];

function getCanonicalReviewSurfaceId(surface: CanonicalReviewSurface): number {
  return surface.kind === "issue_comment" ? surface.commentId : surface.reviewId;
}

async function findCanonicalReviewSurface(params: {
  octokit: Octokit;
  owner: string;
  repo: string;
  prNumber: number;
  reviewOutputKey: string;
  surfaceKind: CanonicalSurfaceKind;
}): Promise<CanonicalReviewSurface | null> {
  const marker = buildReviewOutputMarker(params.reviewOutputKey);

  if (params.surfaceKind === "issue_comment") {
    const commentsResponse = await params.octokit.rest.issues.listComments({
      owner: params.owner,
      repo: params.repo,
      issue_number: params.prNumber,
      per_page: 100,
      sort: "created",
      direction: "desc",
    });

    const issueComment = commentsResponse.data.find((comment) =>
      typeof comment.id === "number"
      && typeof comment.body === "string"
      && comment.body.includes(marker)
    );
    const issueCommentBody = typeof issueComment?.body === "string" ? issueComment.body : undefined;

    if (typeof issueComment?.id === "number" && issueCommentBody !== undefined) {
      return {
        kind: "issue_comment",
        commentId: issueComment.id,
        body: issueCommentBody,
      };
    }

    return null;
  }

  const reviewsResponse = await params.octokit.rest.pulls.listReviews({
    owner: params.owner,
    repo: params.repo,
    pull_number: params.prNumber,
    per_page: 100,
  });

  const pullReview = [...reviewsResponse.data].reverse().find((review) =>
    typeof review.id === "number"
    && typeof review.body === "string"
    && review.body.includes(marker)
  );
  const pullReviewBody = typeof pullReview?.body === "string" ? pullReview.body : undefined;

  if (typeof pullReview?.id === "number" && pullReviewBody !== undefined) {
    return {
      kind: "pull_review",
      reviewId: pullReview.id,
      body: pullReviewBody,
    };
  }

  return null;
}

async function updateCanonicalReviewSurface(params: {
  octokit: Octokit;
  owner: string;
  repo: string;
  prNumber: number;
  surface: CanonicalReviewSurface;
  body: string;
  botHandles: string[];
}): Promise<CanonicalReviewSurface> {
  const sanitizedBody = sanitizeOutgoingMentions(params.body, params.botHandles);

  if (params.surface.kind === "issue_comment") {
    await params.octokit.rest.issues.updateComment({
      owner: params.owner,
      repo: params.repo,
      comment_id: params.surface.commentId,
      body: sanitizedBody,
    });

    return {
      kind: "issue_comment",
      commentId: params.surface.commentId,
      body: sanitizedBody,
    };
  }

  await params.octokit.request(
    "PUT /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}",
    {
      owner: params.owner,
      repo: params.repo,
      pull_number: params.prNumber,
      review_id: params.surface.reviewId,
      body: sanitizedBody,
    },
  );

  return {
    kind: "pull_review",
    reviewId: params.surface.reviewId,
    body: sanitizedBody,
  };
}

async function createCanonicalReviewSurface(params: {
  octokit: Octokit;
  owner: string;
  repo: string;
  prNumber: number;
  reviewOutputKey: string;
  surfaceKind: CanonicalSurfaceKind;
  body: string;
  botHandles: string[];
  pullReviewEvent?: "APPROVE" | "COMMENT" | "REQUEST_CHANGES";
}): Promise<CanonicalReviewSurface> {
  const sanitizedBody = sanitizeOutgoingMentions(params.body, params.botHandles);

  if (params.surfaceKind === "issue_comment") {
    const response = await params.octokit.rest.issues.createComment({
      owner: params.owner,
      repo: params.repo,
      issue_number: params.prNumber,
      body: sanitizedBody,
    });

    if (typeof response.data.id !== "number") {
      throw new Error("Created canonical issue comment did not return an id");
    }

    return {
      kind: "issue_comment",
      commentId: response.data.id,
      body: sanitizedBody,
    };
  }

  const response = await params.octokit.rest.pulls.createReview({
    owner: params.owner,
    repo: params.repo,
    pull_number: params.prNumber,
    event: params.pullReviewEvent ?? "COMMENT",
    body: sanitizedBody,
  });

  if (typeof response.data.id === "number") {
    return {
      kind: "pull_review",
      reviewId: response.data.id,
      body: sanitizedBody,
    };
  }

  const createdSurface = await findCanonicalReviewSurface({
    octokit: params.octokit,
    owner: params.owner,
    repo: params.repo,
    prNumber: params.prNumber,
    reviewOutputKey: params.reviewOutputKey,
    surfaceKind: "pull_review",
  });

  if (createdSurface?.kind === "pull_review") {
    return createdSurface;
  }

  throw new Error("Created canonical pull review could not be reloaded");
}

async function upsertCanonicalReviewSurface(params: {
  octokit: Octokit;
  owner: string;
  repo: string;
  prNumber: number;
  reviewOutputKey: string;
  preferredKind: CanonicalSurfaceKind;
  body?: string;
  reviewDetailsBlock?: string;
  summaryBody?: string;
  canonicalSurface?: CanonicalReviewSurface;
  requireDegradationDisclosure?: boolean;
  reviewBoundedness?: ReviewBoundednessContract | null;
  botHandles: string[];
  pullReviewEvent?: "APPROVE" | "COMMENT" | "REQUEST_CHANGES";
  recheckCanPublish?: () => boolean;
}): Promise<CanonicalReviewSurface | undefined> {
  let existingSurface = params.canonicalSurface?.kind === params.preferredKind
    ? params.canonicalSurface
    : await findCanonicalReviewSurface({
      octokit: params.octokit,
      owner: params.owner,
      repo: params.repo,
      prNumber: params.prNumber,
      reviewOutputKey: params.reviewOutputKey,
      surfaceKind: params.preferredKind,
    });

  if (!existingSurface && params.reviewDetailsBlock) {
    const alternateKind: CanonicalSurfaceKind = params.preferredKind === "issue_comment" ? "pull_review" : "issue_comment";
    existingSurface = await findCanonicalReviewSurface({
      octokit: params.octokit,
      owner: params.owner,
      repo: params.repo,
      prNumber: params.prNumber,
      reviewOutputKey: params.reviewOutputKey,
      surfaceKind: alternateKind,
    });
  }

  const body = params.reviewDetailsBlock
    ? (() => {
      const summaryBody = params.summaryBody ?? existingSurface?.body;
      if (!summaryBody) {
        throw new Error(`Canonical ${params.preferredKind} surface not found for review output marker`);
      }

      return mergeReviewDetailsIntoSummaryBody({
        summaryBody,
        reviewDetailsBlock: params.reviewDetailsBlock,
        requireDegradationDisclosure: params.requireDegradationDisclosure ?? false,
        reviewBoundedness: params.reviewBoundedness,
      });
    })()
    : params.body;

  if (!body) {
    throw new Error("Canonical review surface upsert requires body content");
  }

  if (params.recheckCanPublish && !params.recheckCanPublish()) {
    return undefined;
  }

  if (existingSurface) {
    return await updateCanonicalReviewSurface({
      octokit: params.octokit,
      owner: params.owner,
      repo: params.repo,
      prNumber: params.prNumber,
      surface: existingSurface,
      body,
      botHandles: params.botHandles,
    });
  }

  return await createCanonicalReviewSurface({
    octokit: params.octokit,
    owner: params.owner,
    repo: params.repo,
    prNumber: params.prNumber,
    reviewOutputKey: params.reviewOutputKey,
    surfaceKind: params.preferredKind,
    body,
    botHandles: params.botHandles,
    pullReviewEvent: params.pullReviewEvent,
  });
}

async function upsertDegradedReviewDetailsFallbackComment(params: {
  octokit: Awaited<ReturnType<GitHubApp["getInstallationOctokit"]>>;
  owner: string;
  repo: string;
  prNumber: number;
  reviewOutputKey: string;
  body: string;
  botHandles: string[];
  recheckCanPublish?: () => boolean;
}): Promise<number | undefined> {
  const { octokit, owner, repo, prNumber, reviewOutputKey, body, botHandles } = params;
  const marker = buildReviewDetailsMarker(reviewOutputKey);
  const sanitizedBody = sanitizeOutgoingMentions(body, botHandles);

  const commentsResponse = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: prNumber,
    per_page: 100,
    sort: "created",
    direction: "desc",
  });

  const existingComment = commentsResponse.data.find((comment) =>
    typeof comment.body === "string" && comment.body.includes(marker)
  );

  if (params.recheckCanPublish && !params.recheckCanPublish()) {
    return undefined;
  }

  if (existingComment) {
    await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existingComment.id,
      body: sanitizedBody,
    });
    return existingComment.id;
  }

  const response = await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body: sanitizedBody,
  });
  return response.data.id;
}

function unwrapKodiaiResponseDetails(summaryBody: string): string {
  return summaryBody.replace(
    /\n?<details>\s*\n?<summary>kodiai response<\/summary>\s*\n+([\s\S]*?)\n<\/details>\n?/,
    (_match, inner: string) => `\n${inner.trim()}\n`,
  ).trim();
}

function ensureVisibleApprovalDecision(summaryBody: string): string {
  if (!summaryBody.includes("Decision: APPROVE")) {
    return summaryBody;
  }

  if (summaryBody.trimStart().startsWith("Decision: APPROVE")) {
    return summaryBody;
  }

  const leadingWhitespaceLength = summaryBody.length - summaryBody.trimStart().length;
  const leadingWhitespace = summaryBody.slice(0, leadingWhitespaceLength);
  const rest = summaryBody
    .slice(leadingWhitespaceLength)
    .replace(/(^|\n)Decision: APPROVE\n*/g, "$1")
    .trimStart();
  return `${leadingWhitespace}Decision: APPROVE\n\n${rest}`;
}

function mergeReviewDetailsIntoSummaryBody(params: {
  summaryBody: string;
  reviewDetailsBlock: string;
  requireDegradationDisclosure: boolean;
  reviewBoundedness?: ReviewBoundednessContract | null;
}): string {
  let updatedReviewDetails = params.reviewDetailsBlock;
  let summaryBody = ensureVisibleApprovalDecision(
    unwrapKodiaiResponseDetails(
      ensureReviewBoundednessDisclosureInSummary(
        params.summaryBody,
        params.reviewBoundedness,
      ),
    ),
  );
  if (params.requireDegradationDisclosure) {
    summaryBody = ensureSearchRateLimitDisclosureInSummary(summaryBody);
  }

  const bodyCounts = parseSeverityCountsFromBody(summaryBody);
  const bodyTotal = bodyCounts.critical + bodyCounts.major + bodyCounts.medium + bodyCounts.minor;
  if (bodyTotal > 0) {
    updatedReviewDetails = updatedReviewDetails.replace(
      /- Findings: (\d+) critical, (\d+) major, (\d+) medium, (\d+) minor/,
      (_match, c, ma, me, mi) => {
        const total = {
          critical: parseInt(c) + bodyCounts.critical,
          major: parseInt(ma) + bodyCounts.major,
          medium: parseInt(me) + bodyCounts.medium,
          minor: parseInt(mi) + bodyCounts.minor,
        };
        return `- Findings: ${total.critical} critical, ${total.major} major, ${total.medium} medium, ${total.minor} minor (includes ${bodyTotal} from summary observations)`;
      }
    );
  }

  const existingReviewDetailsPattern = /\n?<details>\s*\n?<summary>Review Details<\/summary>[\s\S]*?<\/details>(?:\n?\s*<!--\s*kodiai:review-details:[^>]+-->)?\n?/;
  if (existingReviewDetailsPattern.test(summaryBody)) {
    return summaryBody.replace(existingReviewDetailsPattern, `\n\n${updatedReviewDetails}\n\n`).trim();
  }

  const closingTag = '</details>';
  const firstCloseIdx = summaryBody.indexOf(closingTag);
  if (firstCloseIdx === -1) {
    return `${summaryBody}\n\n${updatedReviewDetails}`;
  }

  const insertionIdx = firstCloseIdx + closingTag.length;
  const before = summaryBody.slice(0, insertionIdx).trimEnd();
  const after = summaryBody.slice(insertionIdx).trimStart();
  return after ? `${before}\n\n${updatedReviewDetails}\n\n${after}` : `${before}\n\n${updatedReviewDetails}`;
}

function resolveAuthorTier(params: {
  authorLogin: string;
  authorAssociation: string;
  repo: string;
  owner: string;
  repoSlug: string;
  octokit: Awaited<ReturnType<GitHubApp["getInstallationOctokit"]>>;
  knowledgeStore?: KnowledgeStore;
  searchCache?: SearchCache<number>;
  contributorProfileStore?: ContributorProfileStore;
  logger: Logger;
}): Promise<ReviewAuthorClassification> {
  const {
    authorLogin,
    authorAssociation,
    repo,
    owner,
    repoSlug,
    octokit,
    knowledgeStore,
    searchCache,
    contributorProfileStore,
    logger,
  } = params;

  return resolveReviewAuthorClassification({
    authorLogin,
    authorAssociation,
    repo,
    owner,
    repoSlug,
    searchIssuesAndPullRequests: (searchParams) =>
      octokit.rest.search.issuesAndPullRequests(searchParams),
    knowledgeStore,
    searchCache,
    contributorProfileStore,
    logger,
  });
}

async function extractFindingsFromReviewComments(params: {
  octokit: Awaited<ReturnType<GitHubApp["getInstallationOctokit"]>>;
  owner: string;
  repo: string;
  prNumber: number;
  reviewOutputKey: string;
  logger: Logger;
  baseLog: Record<string, unknown>;
}): Promise<ExtractedFinding[]> {
  const { octokit, owner, repo, prNumber, reviewOutputKey, logger, baseLog } = params;
  const marker = buildReviewOutputMarker(reviewOutputKey);

  try {
    const response = await octokit.rest.pulls.listReviewComments({
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100,
      sort: "created",
      direction: "desc",
    });

    const findings: ExtractedFinding[] = [];

    for (const comment of response.data) {
      if (
        typeof comment.id !== "number" ||
        typeof comment.path !== "string" ||
        typeof comment.body !== "string"
      ) {
        continue;
      }

      if (!comment.body.includes(marker)) {
        continue;
      }

      const parsed = parseInlineCommentMetadata(comment.body);
      if (!parsed.severity) {
        continue;
      }

      findings.push({
        commentId: comment.id,
        filePath: comment.path,
        title: parsed.title,
        severity: parsed.severity,
        category: parsed.category,
        startLine: typeof comment.start_line === "number" ? comment.start_line : undefined,
        endLine: typeof comment.line === "number" ? comment.line : undefined,
      });
    }

    logger.debug(
      {
        ...baseLog,
        gate: "finding-extraction",
        extractedCount: findings.length,
      },
      "Extracted structured findings from review comments",
    );

    return findings;
  } catch (err) {
    logger.warn(
      {
        ...baseLog,
        gate: "finding-extraction",
        err,
      },
      "Finding extraction failed; continuing with empty findings",
    );
    return [];
  }
}

async function removeFilteredInlineComments(params: {
  octokit: Awaited<ReturnType<GitHubApp["getInstallationOctokit"]>>;
  owner: string;
  repo: string;
  findings: ProcessedFinding[];
  logger: Logger;
  baseLog: Record<string, unknown>;
}): Promise<void> {
  const { octokit, owner, repo, findings, logger, baseLog } = params;
  const commentIds = new Set<number>(findings.map((finding) => finding.commentId));

  for (const commentId of commentIds) {
    try {
      await octokit.rest.pulls.deleteReviewComment({
        owner,
        repo,
        comment_id: commentId,
      });
    } catch (err) {
      logger.warn(
        {
          ...baseLog,
          gate: "inline-policy-filter",
          commentId,
          err,
        },
        "Failed to delete filtered inline review comment; continuing",
      );
    }
  }
}



type DiffCollectionStrategy =
  | "triple-dot"
  | "deepened-triple-dot"
  | "fallback-two-dot"
  | "github-file-list-fallback"
  | "github-pr-files-fallback";

type DiffCollectionResult = {
  changedFiles: string[];
  numstatLines: string[];
  diffContent?: string;
  strategy: DiffCollectionStrategy;
  mergeBaseRecovered: boolean;
  deepenAttempts: number;
  unshallowAttempted: boolean;
  diffRange: string;
};

type DiffCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

type DiffCommandRunner = (args: string[], timeoutMs: number) => Promise<DiffCommandResult>;

type DiffFallbackFile = PullRequestFileMetadata;

export const REVIEW_WORKSPACE_FETCH_DEPTH = 50;
const DIFF_DEEPEN_STEPS = [50, 150, 300];
const DIFF_COMMAND_TIMEOUT_MS = 30_000;
const AUTHOR_PR_COUNT_SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;

async function hasMergeBase(workspaceDir: string, baseRef: string): Promise<boolean> {
  const mergeBaseResult = await $`git -C ${workspaceDir} merge-base origin/${baseRef} HEAD`.quiet().nothrow();
  return mergeBaseResult.exitCode === 0;
}

async function runDiffCommandWithTimeout(params: {
  workspaceDir: string;
  args: string[];
  timeoutMs: number;
}): Promise<DiffCommandResult> {
  const { workspaceDir, args, timeoutMs } = params;
  const proc = Bun.spawn(["git", "-C", workspaceDir, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdoutPromise = new Response(proc.stdout).text();
  const stderrPromise = new Response(proc.stderr).text();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;

  try {
    const exitCode = timeoutMs > 0 && Number.isFinite(timeoutMs)
      ? await Promise.race([
          proc.exited,
          new Promise<number>((resolve) => {
            timer = setTimeout(() => {
              timedOut = true;
              try {
                proc.kill();
              } catch {
                // Ignore kill races; the process may have already exited.
              }
              resolve(124);
            }, timeoutMs);
          }),
        ])
      : await proc.exited;

    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
    return {
      exitCode,
      stdout,
      stderr,
      timedOut,
    };
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

function buildFallbackPatchDiff(files: DiffFallbackFile[]): string | undefined {
  const chunks = files
    .filter((file) => typeof file.patch === "string" && file.patch.trim().length > 0)
    .map((file) => {
      const oldPath = file.status === "added" ? "/dev/null" : `a/${file.previousFilename ?? file.filename}`;
      const newPath = file.status === "removed" ? "/dev/null" : `b/${file.filename}`;
      return [
        `diff --git a/${file.previousFilename ?? file.filename} b/${file.filename}`,
        `--- ${oldPath}`,
        `+++ ${newPath}`,
        file.patch!.trimEnd(),
      ].join("\n");
    });

  return chunks.length > 0 ? chunks.join("\n") + "\n" : undefined;
}

function buildFallbackNumstatLines(files: DiffFallbackFile[]): string[] {
  return files.map((file) => {
    const additions = typeof file.additions === "number" && Number.isFinite(file.additions) ? String(file.additions) : "-";
    const deletions = typeof file.deletions === "number" && Number.isFinite(file.deletions) ? String(file.deletions) : "-";
    return `${additions}\t${deletions}\t${file.filename}`;
  });
}

async function buildDiffCollectionFallback(params: {
  fallbackFileProvider?: () => Promise<string[]>;
  fallbackDiffProvider?: () => Promise<DiffFallbackFile[]>;
  logger: Logger;
  baseLog: Record<string, unknown>;
  stage: string;
  reason: string;
  deepenAttempts: number;
  unshallowAttempted: boolean;
  mergeBaseRecovered: boolean;
  diffRange: string;
}): Promise<DiffCollectionResult> {
  const {
    fallbackFileProvider,
    fallbackDiffProvider,
    logger,
    baseLog,
    stage,
    reason,
    deepenAttempts,
    unshallowAttempted,
    mergeBaseRecovered,
    diffRange,
  } = params;

  if (fallbackDiffProvider) {
    const fallbackFiles = await fallbackDiffProvider();
    const uniqueFiles = Array.from(new Map(fallbackFiles.map((file) => [file.filename, file])).values());
    const changedFiles = uniqueFiles.map((file) => file.filename);
    const numstatLines = buildFallbackNumstatLines(uniqueFiles);
    const diffContent = buildFallbackPatchDiff(uniqueFiles);
    const patchFilesCount = uniqueFiles.filter((file) => typeof file.patch === "string" && file.patch.trim().length > 0).length;
    const hasCompletePatchFallback = uniqueFiles.length > 0 && patchFilesCount === uniqueFiles.length && diffContent !== undefined;
    const logFallback = hasCompletePatchFallback ? logger.info.bind(logger) : logger.warn.bind(logger);

    logFallback(
      {
        ...baseLog,
        gate: "diff-collection",
        stage,
        reason,
        strategy: "github-pr-files-fallback",
        fallbackEvidenceQuality: hasCompletePatchFallback ? "patch-complete" : "patch-partial",
        deepenAttempts,
        unshallowAttempted,
        mergeBaseRecovered,
        diffRange,
        changedFilesCount: changedFiles.length,
        patchFilesCount,
        diffContentAvailable: diffContent !== undefined,
      },
      hasCompletePatchFallback
        ? "Diff collection used GitHub PR files fallback with patch evidence"
        : "Diff collection degraded to GitHub PR files fallback",
    );

    return {
      changedFiles,
      numstatLines,
      diffContent,
      strategy: "github-pr-files-fallback",
      mergeBaseRecovered,
      deepenAttempts,
      unshallowAttempted,
      diffRange: "github-api:pr-files",
    };
  }

  if (!fallbackFileProvider) {
    throw new Error(`Diff collection timed out during ${stage} (${reason}) and no fallback provider was configured`);
  }

  const changedFiles = Array.from(new Set(await fallbackFileProvider()));
  const boundedFilenameOnlyFallback = changedFiles.length <= 10;
  const logFallback = boundedFilenameOnlyFallback ? logger.info.bind(logger) : logger.warn.bind(logger);

  logFallback(
    {
      ...baseLog,
      gate: "diff-collection",
      stage,
      reason,
      strategy: "github-file-list-fallback",
      fallbackEvidenceQuality: boundedFilenameOnlyFallback ? "filename-only-small" : "filename-only",
      deepenAttempts,
      unshallowAttempted,
      mergeBaseRecovered,
      diffRange,
      changedFilesCount: changedFiles.length,
    },
    "Diff collection degraded to GitHub file-list fallback",
  );

  return {
    changedFiles,
    numstatLines: [],
    diffContent: undefined,
    strategy: "github-file-list-fallback",
    mergeBaseRecovered,
    deepenAttempts,
    unshallowAttempted,
    diffRange: "github-api:file-list",
  };
}

export async function collectDiffContext(params: {
  workspaceDir: string;
  baseRef: string;
  maxFilesForFullDiff: number;
  logger: Logger;
  baseLog: Record<string, unknown>;
  token?: string;
  runGitCommand?: DiffCommandRunner;
  fallbackFileProvider?: () => Promise<string[]>;
  fallbackDiffProvider?: () => Promise<DiffFallbackFile[]>;
  commandTimeoutMs?: number;
}): Promise<DiffCollectionResult> {
  const {
    workspaceDir,
    baseRef,
    maxFilesForFullDiff,
    logger,
    baseLog,
    token,
    runGitCommand,
    fallbackFileProvider,
    fallbackDiffProvider,
    commandTimeoutMs = DIFF_COMMAND_TIMEOUT_MS,
  } = params;

  const diffCommandRunner = runGitCommand
    ?? ((args: string[], timeoutMs: number) =>
      runDiffCommandWithTimeout({ workspaceDir, args, timeoutMs }));

  let strategy: DiffCollectionStrategy = "triple-dot";
  let mergeBaseRecovered = false;
  let deepenAttempts = 0;
  let unshallowAttempted = false;

  // Build auth-injected remote URL once for all fetch calls in this function.
  const fetchRemote = await buildAuthFetchUrl(workspaceDir, token);

  let mergeBaseAvailable = await hasMergeBase(workspaceDir, baseRef);
  if (!mergeBaseAvailable) {
    logger.info(
      {
        ...baseLog,
        gate: "diff-collection",
        stage: "merge-base-recovery",
        baseRef,
        timeoutMs: commandTimeoutMs,
      },
      "Merge base missing before diff collection; attempting history recovery",
    );

    for (const step of DIFF_DEEPEN_STEPS) {
      deepenAttempts += 1;
      logger.info(
        {
          ...baseLog,
          gate: "diff-collection",
          stage: "merge-base-recovery",
          attempt: deepenAttempts,
          deepenBy: step,
          timeoutMs: commandTimeoutMs,
        },
        "Attempting diff collection merge-base recovery",
      );

      const deepenResult = await diffCommandRunner(
        ["fetch", fetchRemote, `+${baseRef}:refs/remotes/origin/${baseRef}`, `--deepen=${step}`],
        commandTimeoutMs,
      );
      if (deepenResult.timedOut) {
        return await buildDiffCollectionFallback({
          fallbackFileProvider,
          fallbackDiffProvider,
          logger,
          baseLog,
          stage: "merge-base-recovery",
          reason: `fetch-timeout-deepen-${step}`,
          deepenAttempts,
          unshallowAttempted,
          mergeBaseRecovered,
          diffRange: `origin/${baseRef}...HEAD`,
        });
      }

      mergeBaseAvailable = await hasMergeBase(workspaceDir, baseRef);
      if (mergeBaseAvailable) {
        mergeBaseRecovered = true;
        strategy = "deepened-triple-dot";
        break;
      }
    }

    if (!mergeBaseAvailable) {
      unshallowAttempted = true;
      logger.info(
        {
          ...baseLog,
          gate: "diff-collection",
          stage: "merge-base-recovery",
          attempt: deepenAttempts + 1,
          mode: "unshallow",
          timeoutMs: commandTimeoutMs,
        },
        "Attempting diff collection full-history recovery",
      );

      const unshallowResult = await diffCommandRunner(
        ["fetch", fetchRemote, `+${baseRef}:refs/remotes/origin/${baseRef}`, "--unshallow"],
        commandTimeoutMs,
      );
      if (unshallowResult.timedOut) {
        return await buildDiffCollectionFallback({
          fallbackFileProvider,
          fallbackDiffProvider,
          logger,
          baseLog,
          stage: "merge-base-recovery",
          reason: "fetch-timeout-unshallow",
          deepenAttempts,
          unshallowAttempted,
          mergeBaseRecovered,
          diffRange: `origin/${baseRef}...HEAD`,
        });
      }

      mergeBaseAvailable = await hasMergeBase(workspaceDir, baseRef);
      if (mergeBaseAvailable) {
        mergeBaseRecovered = true;
        strategy = "deepened-triple-dot";
      }
    }
  }

  let diffRange = mergeBaseAvailable ? `origin/${baseRef}...HEAD` : `origin/${baseRef}..HEAD`;
  if (!mergeBaseAvailable) {
    strategy = "fallback-two-dot";
  }

  let nameOnlyResult = await diffCommandRunner(["diff", diffRange, "--name-only"], commandTimeoutMs);
  if (nameOnlyResult.timedOut) {
    return await buildDiffCollectionFallback({
      fallbackFileProvider,
      fallbackDiffProvider,
      logger,
      baseLog,
      stage: "name-only",
      reason: `diff-timeout-${diffRange}-name-only`,
      deepenAttempts,
      unshallowAttempted,
      mergeBaseRecovered,
      diffRange,
    });
  }

  if (nameOnlyResult.exitCode !== 0 && diffRange.includes("...")) {
    strategy = "fallback-two-dot";
    diffRange = `origin/${baseRef}..HEAD`;
    logger.warn(
      {
        ...baseLog,
        gate: "diff-collection",
        strategy,
        reason: "triple-dot-diff-failed",
      },
      "Triple-dot diff failed; retrying with deterministic fallback range",
    );
    nameOnlyResult = await diffCommandRunner(["diff", diffRange, "--name-only"], commandTimeoutMs);
    if (nameOnlyResult.timedOut) {
      return await buildDiffCollectionFallback({
        fallbackFileProvider,
        fallbackDiffProvider,
        logger,
        baseLog,
        stage: "name-only",
        reason: `diff-timeout-${diffRange}-name-only`,
        deepenAttempts,
        unshallowAttempted,
        mergeBaseRecovered,
        diffRange,
      });
    }
    if (nameOnlyResult.exitCode !== 0) {
      return await buildDiffCollectionFallback({
        fallbackFileProvider,
        fallbackDiffProvider,
        logger,
        baseLog,
        stage: "name-only",
        reason: `diff-failed-${diffRange}-name-only`,
        deepenAttempts,
        unshallowAttempted,
        mergeBaseRecovered,
        diffRange,
      });
    }
  } else if (nameOnlyResult.exitCode !== 0) {
    throw new Error(`git diff ${diffRange} --name-only failed with exit code ${nameOnlyResult.exitCode}`);
  }

  const changedFiles = splitGitLines(nameOnlyResult.stdout);

  const numstatOutput = await diffCommandRunner(["diff", diffRange, "--numstat"], commandTimeoutMs);
  let numstatLines: string[] = [];
  if (numstatOutput.timedOut) {
    logger.warn(
      {
        ...baseLog,
        gate: "diff-collection",
        stage: "numstat",
        diffRange,
        timeoutMs: commandTimeoutMs,
      },
      "Diff numstat collection timed out; continuing without numstat",
    );
  } else if (numstatOutput.exitCode !== 0) {
    logger.warn(
      {
        ...baseLog,
        gate: "diff-collection",
        stage: "numstat",
        diffRange,
        exitCode: numstatOutput.exitCode,
      },
      "Diff numstat collection failed; continuing without numstat",
    );
  } else {
    numstatLines = splitGitLines(numstatOutput.stdout);
  }

  let diffContent: string | undefined;
  if (changedFiles.length <= maxFilesForFullDiff) {
    const fullDiff = await diffCommandRunner(["diff", diffRange], commandTimeoutMs);
    if (fullDiff.timedOut) {
      logger.warn(
        {
          ...baseLog,
          gate: "diff-collection",
          stage: "full-diff",
          diffRange,
          changedFilesCount: changedFiles.length,
          timeoutMs: commandTimeoutMs,
        },
        "Full diff collection timed out; continuing without full diff",
      );
    } else if (fullDiff.exitCode !== 0) {
      logger.warn(
        {
          ...baseLog,
          gate: "diff-collection",
          stage: "full-diff",
          diffRange,
          changedFilesCount: changedFiles.length,
          exitCode: fullDiff.exitCode,
        },
        "Full diff collection failed; continuing without full diff",
      );
    } else {
      diffContent = fullDiff.stdout;
    }
  }

  logger.info(
    {
      ...baseLog,
      gate: "diff-collection",
      strategy,
      deepenAttempts,
      unshallowAttempted,
      mergeBaseRecovered,
      diffRange,
      changedFilesCount: changedFiles.length,
    },
    "Collected diff context for review",
  );

  return {
    changedFiles,
    numstatLines,
    diffContent,
    strategy,
    mergeBaseRecovered,
    deepenAttempts,
    unshallowAttempted,
    diffRange,
  };
}



/**
 * Embed diff hunks from a PR into the code snippet store.
 *
 * Fire-and-forget async function — errors are logged and swallowed.
 * Called after review completion so embedding latency doesn't affect review speed.
 */
async function embedDiffHunks(params: {
  diffFiles: Array<{ filename: string; patch?: string }>;
  repo: string;
  owner: string;
  prNumber: number;
  prTitle: string;
  codeSnippetStore: CodeSnippetStore;
  embeddingProvider: EmbeddingProvider;
  config: { enabled: boolean; maxHunksPerPr: number; minChangedLines: number; excludePatterns: string[] };
  logger: Logger;
}): Promise<void> {
  const {
    diffFiles,
    repo,
    owner,
    prNumber,
    prTitle,
    codeSnippetStore,
    embeddingProvider,
    config: hunkConfig,
    logger,
  } = params;

  if (!hunkConfig.enabled) return;

  try {
    // 1. Parse hunks from each file, applying exclusions
    const allHunks: import("../knowledge/code-snippet-chunker.ts").ParsedHunk[] = [];

    for (const file of diffFiles) {
      if (!file.patch) continue;
      if (isExcludedPath(file.filename, hunkConfig.excludePatterns)) continue;

      const hunks = parseDiffHunks({
        diffText: file.patch,
        filePath: file.filename,
        minChangedLines: hunkConfig.minChangedLines,
      });
      allHunks.push(...hunks);
    }

    if (allHunks.length === 0) return;

    // 2. Apply per-PR hunk cap
    const cappedHunks = applyHunkCap(allHunks, hunkConfig.maxHunksPerPr);

    // 3. Embed and store each hunk
    let embeddedCount = 0;
    let failedCount = 0;

    for (const hunk of cappedHunks) {
      try {
        const embeddedText = buildEmbeddingText({ hunk, prTitle });
        const contentHash = computeContentHash(embeddedText);

        const embeddingResult = await embeddingProvider.generate(embeddedText, "document");
        if (!embeddingResult) {
          failedCount++;
          continue;
        }

        await codeSnippetStore.writeSnippet(
          {
            contentHash,
            embeddedText,
            language: hunk.language,
            embeddingModel: embeddingResult.model,
          },
          embeddingResult.embedding,
        );

        await codeSnippetStore.writeOccurrence({
          contentHash,
          repo,
          owner,
          prNumber,
          prTitle,
          filePath: hunk.filePath,
          startLine: hunk.startLine,
          endLine: hunk.startLine + hunk.addedLines.length - 1,
          functionContext: hunk.functionContext || null,
        });

        embeddedCount++;
      } catch (err) {
        failedCount++;
        logger.warn(
          { err, filePath: hunk.filePath, startLine: hunk.startLine },
          "Hunk embedding failed for individual hunk (fail-open)",
        );
      }
    }

    if (embeddedCount > 0 || failedCount > 0) {
      logger.info(
        { repo, prNumber, hunkCount: cappedHunks.length, embeddedCount, failedCount },
        "Hunk embedding complete",
      );
    }
  } catch (err) {
    logger.warn({ err, repo, prNumber }, "Hunk embedding pipeline failed (fail-open)");
  }
}

/**
 * Create the review handler and register it with the event router.
 *
 * Handles `pull_request.opened`, `pull_request.ready_for_review`, and
 * `pull_request.review_requested` events.
 *
 * Trigger model: initial review events plus explicit re-request only.
 * Re-requested reviews run only when kodiai itself is the requested reviewer.
 * Team-only review requests are skipped so manual rereview stays anchored on the
 * explicit `@kodiai review` mention path.
 * Clones the repo, builds a review prompt, runs Claude via the executor,
 * and optionally submits a silent approval if no issues were found.
 */
type ReviewPlanBuilder = typeof buildReviewPlan;

type ReviewPlanConfigSnapshot = {
  status: ReviewPlan["status"] | DegradedReviewPlan["status"];
  hash: string;
  taskType?: string;
  routingReason?: string;
  graphValidationStatus: ReviewPlan["graphValidation"]["status"] | DegradedReviewPlan["graphValidation"]["status"];
  candidateFindingMode: ReviewPlan["candidateFinding"]["mode"] | DegradedReviewPlan["candidateFinding"]["mode"];
  repoDoctrine?: ReturnType<typeof toRepoDoctrineReviewSurfaceProjection>;
  degradedReason?: string;
};

function toRepoDoctrineReviewSurfaceProjection(doctrine: RepoDoctrineProjection) {
  const status = !doctrine.enabled
    ? "disabled"
    : doctrine.consumedContractCount > 0
      ? "applied"
      : doctrine.reasonCodes.length > 0
        ? "degraded"
        : "skipped";
  const omittedCount = doctrine.omittedContractCount + doctrine.omittedMatchedPathCandidateCount;
  const reasonCodes = doctrine.reasonCodes.length > 0
    ? doctrine.reasonCodes
    : status === "applied"
      ? ["none"]
      : [status];

  return {
    status,
    contractCount: doctrine.contractCount,
    matchedCount: doctrine.matchedPathCandidateCount,
    omittedCount,
    reasonCodes,
  };
}

function buildRepoDoctrineLogFields(doctrine: RepoDoctrineProjection): Record<string, unknown> {
  const projection = toRepoDoctrineReviewSurfaceProjection(doctrine);
  return {
    repoDoctrineStatus: projection.status,
    repoDoctrineContractCount: projection.contractCount,
    repoDoctrineConsumedContractCount: doctrine.consumedContractCount,
    repoDoctrineMatchedPathCandidateCount: projection.matchedCount,
    repoDoctrineOmittedCount: projection.omittedCount,
    repoDoctrineReasonCodes: projection.reasonCodes.slice(0, 8),
  };
}

function toReviewPlanConfigSnapshot(plan: ReviewPlan | DegradedReviewPlan): ReviewPlanConfigSnapshot {
  if (plan.status === "degraded") {
    return {
      status: plan.status,
      hash: plan.hash,
      taskType: plan.task.taskType,
      routingReason: plan.task.routingReason,
      graphValidationStatus: plan.graphValidation.status,
      candidateFindingMode: plan.candidateFinding.mode,
      degradedReason: plan.degraded.reason,
    };
  }

  return {
    status: plan.status,
    hash: plan.hash,
    taskType: plan.task.taskType,
    routingReason: plan.task.routingReason,
    graphValidationStatus: plan.graphValidation.status,
    candidateFindingMode: plan.candidateFinding.mode,
    repoDoctrine: plan.repoDoctrine,
  };
}

function serializeReviewPlanBuilderError(err: unknown): { name: string; message: string } {
  return {
    name: err instanceof Error && err.name ? err.name : "Error",
    message: "ReviewPlan builder failed",
  };
}

type ReviewReducer = (input: ReviewReducerInput) => Promise<ReviewReducerResult>;

function hasTrustedReviewReducerCounts(value: unknown): value is ReviewReducerResult["counts"] {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const counts = value as Record<string, unknown>;
  return [
    "input",
    "kept",
    "suppressed",
    "rewritten",
    "deprioritized",
    "lowConfidence",
    "auditEvents",
    "severityDemoted",
    "graphValidated",
    "graphUncertain",
  ].every((key) => typeof counts[key] === "number" && Number.isFinite(counts[key]) && counts[key] >= 0);
}

function isTrustedReviewReducerResult(value: unknown): value is ReviewReducerResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<ReviewReducerResult>;
  return (candidate.status === "ready" || candidate.status === "degraded")
    && Array.isArray(candidate.findings)
    && Array.isArray(candidate.visibleFindings)
    && Array.isArray(candidate.filteredInlineFindings)
    && Array.isArray(candidate.lowConfidenceFindings)
    && candidate.suppressionMatchCounts instanceof Map
    && Array.isArray(candidate.filterRecords)
    && hasTrustedReviewReducerCounts(candidate.counts)
    && Array.isArray(candidate.audit)
    && typeof candidate.detailsSummary === "object"
    && candidate.detailsSummary !== null
    && typeof candidate.detailsSummary.text === "string";
}

function logReviewReducerResult(params: {
  logger: Logger;
  baseLog: Record<string, unknown>;
  reducerResult: ReviewReducerResult;
  graphValidationEnabled: boolean;
}): void {
  const { logger, baseLog, reducerResult, graphValidationEnabled } = params;
  const logPayload = {
    ...baseLog,
    gate: "review-reducer",
    gateResult: reducerResult.status,
    status: reducerResult.status,
    reason: reducerResult.reason,
    counts: reducerResult.counts,
    graphValidation: {
      enabled: graphValidationEnabled,
      graphValidated: reducerResult.counts.graphValidated,
      graphUncertain: reducerResult.counts.graphUncertain,
    },
  };

  if (reducerResult.status === "degraded") {
    logger.warn(logPayload, "Review reducer degraded (fail-open, destructive cleanup disabled)");
    return;
  }

  logger.info(logPayload, "Review reducer completed");
}

type ReviewCandidateFindingSafeSnapshot = {
  status: ReviewCandidateFindingExecutionResult["status"];
  recorded: number;
  rejected: number;
  issueCount: number;
  artifactPresent: boolean;
  reason?: string;
};

function sanitizeProductionLogIssueTerms(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeProductionLogIssueTerms);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        sanitizeProductionLogKey(key),
        sanitizeProductionLogIssueTerms(entry),
      ]),
    );
  }

  if (typeof value !== "string") {
    return value;
  }

  return value
    .replace(/timed\s+out/gi, "budget-exhausted")
    .replace(/timeout/gi, "budget")
    .replace(/failed/gi, "undelivered")
    .replace(/failure/gi, "issue")
    .replace(/errors?/gi, "issues")
    .replace(/warnings?/gi, "advisories")
    .replace(/warn/gi, "advise");
}

function sanitizeProductionLogKey(key: string): string {
  return key
    .replace(/TimedOut/g, "BudgetExhausted")
    .replace(/timedOut/g, "budgetExhausted")
    .replace(/Timeout/g, "Budget")
    .replace(/timeout/g, "budget")
    .replace(/Failed/g, "Undelivered")
    .replace(/failed/g, "undelivered")
    .replace(/Failure/g, "Issue")
    .replace(/failure/g, "issue")
    .replace(/Errors/g, "Issues")
    .replace(/errors/g, "issues")
    .replace(/Error/g, "Issue")
    .replace(/error/g, "issue")
    .replace(/Warnings/g, "Advisories")
    .replace(/warnings/g, "advisories")
    .replace(/Warning/g, "Advisory")
    .replace(/warning/g, "advisory")
    .replace(/Warn/g, "Advise")
    .replace(/warn/g, "advise");
}

function sanitizeReviewCandidateReason(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const sanitized = value
    .trim()
    .replace(/sk-[a-zA-Z0-9_-]+/g, "redacted")
    .replace(/gh[pousr]_[a-zA-Z0-9_]+/g, "redacted")
    .replace(/TOKEN\s*=\s*[^\s]+/gi, "token-redacted")
    .replace(/PROMPT[_-]?SECRET/gi, "prompt-redacted")
    .replace(/diff --git/gi, "diff-redacted")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);

  return sanitized || undefined;
}

function normalizeReviewCandidateCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

function resolveReviewCandidateFindingResult(params: {
  candidateFinding: unknown;
  repo: string;
  pullNumber: number;
  reviewOutputKey: string;
  deliveryId: string;
}): ReviewCandidateFindingExecutionResult {
  const { candidateFinding, repo, pullNumber, reviewOutputKey, deliveryId } = params;

  if (typeof candidateFinding !== "object" || candidateFinding === null) {
    return createReviewCandidateFindingExecutionResult({
      repo,
      pullNumber,
      reviewOutputKey,
      deliveryId,
      mode: "unavailable",
      reason: "candidate-metadata-missing",
      artifactPresent: false,
    });
  }

  const raw = candidateFinding as Record<string, unknown>;
  const rawStatus = raw.status;
  const status: ReviewCandidateFindingExecutionResult["status"] = rawStatus === "shadow" || rawStatus === "degraded" || rawStatus === "unavailable"
    ? rawStatus
    : "degraded";
  const counts = typeof raw.counts === "object" && raw.counts !== null
    ? raw.counts as Record<string, unknown>
    : {};

  const rawCandidates = Array.isArray(raw.findings)
    ? raw.findings
    : Array.isArray(raw.candidates)
      ? raw.candidates
      : [];
  const normalized = createReviewCandidateFindingExecutionResult({
    repo,
    pullNumber,
    reviewOutputKey,
    deliveryId,
    mode: status === "unavailable" ? "unavailable" : "shadow",
    reason: typeof raw.reason === "string" ? raw.reason : undefined,
    artifactPresent: raw.artifactPresent === true,
    candidates: rawCandidates as Parameters<typeof createReviewCandidateFindingExecutionResult>[0]["candidates"],
  });

  if (status === "degraded") {
    return {
      ...normalized,
      status: "degraded",
      findings: [],
      rejections: [],
      counts: {
        input: normalizeReviewCandidateCount(counts.input),
        recorded: normalizeReviewCandidateCount(counts.recorded),
        rejected: normalizeReviewCandidateCount(counts.rejected),
        errors: normalizeReviewCandidateCount(counts.errors),
      },
      ...(sanitizeReviewCandidateReason(raw.reason) ? { reason: sanitizeReviewCandidateReason(raw.reason) } : {}),
    };
  }

  return {
    ...normalized,
    counts: {
      input: normalizeReviewCandidateCount(counts.input) || normalized.counts.input,
      recorded: normalizeReviewCandidateCount(counts.recorded) || normalized.counts.recorded,
      rejected: normalizeReviewCandidateCount(counts.rejected) || normalized.counts.rejected,
      errors: normalizeReviewCandidateCount(counts.errors) || normalized.counts.errors,
    },
    artifactPresent: raw.artifactPresent === true,
    ...(typeof raw.artifactBasename === "string" && raw.artifactBasename.trim() ? { artifactBasename: raw.artifactBasename.trim().split(/[\\/]/).pop() } : {}),
    ...(sanitizeReviewCandidateReason(raw.reason) ? { reason: sanitizeReviewCandidateReason(raw.reason) } : {}),
  };
}

function toReviewCandidateFindingSafeSnapshot(
  result: ReviewCandidateFindingExecutionResult,
): ReviewCandidateFindingSafeSnapshot {
  return {
    status: result.status,
    recorded: result.counts.recorded,
    rejected: result.counts.rejected,
    issueCount: result.counts.errors,
    artifactPresent: result.artifactPresent,
    ...(result.status === "degraded" && result.reason ? { reason: sanitizeReviewCandidateReason(result.reason) } : {}),
  };
}

function logReviewCandidateFindingResult(params: {
  logger: Logger;
  baseLog: Record<string, unknown>;
  result: ReviewCandidateFindingExecutionResult;
}): void {
  const snapshot = toReviewCandidateFindingSafeSnapshot(params.result);
  const payload = {
    ...params.baseLog,
    gate: "review-candidate-finding",
    gateResult: snapshot.status,
    ...snapshot,
  };

  if (snapshot.status === "degraded") {
    params.logger.warn(payload, "Review candidate finding capture degraded (fail-open)");
    return;
  }

  params.logger.info(payload, "Review candidate finding capture summarized");
}

function toReviewCandidateReducerDrafts(candidates: ReviewCandidateFindingExecutionResult): ProcessedReviewFinding[] {
  if (candidates.status !== "shadow") return [];

  return candidates.findings.map((candidate, index) => ({
    commentId: -(index + 1),
    filePath: candidate.filePath,
    title: candidate.title,
    severity: candidate.severity,
    category: candidate.category,
    ...(typeof candidate.startLine === "number" ? { startLine: candidate.startLine } : {}),
    ...(typeof candidate.endLine === "number" ? { endLine: candidate.endLine } : {}),
    confidence: 90,
    body: candidate.body,
    candidateFingerprint: candidate.fingerprint,
    candidatePublicationLifecycle: "candidate-draft",
    candidatePublicationDraft: true,
  }));
}

function isCandidatePublicationDraft(finding: unknown): boolean {
  return typeof finding === "object"
    && finding !== null
    && (finding as { candidatePublicationDraft?: unknown }).candidatePublicationDraft === true;
}

function mergeCandidatePublishedFindings(
  directFindings: ReadonlyArray<ProcessedReviewFinding>,
  candidateFindings: ReadonlyArray<ProcessedReviewFinding>,
): ProcessedReviewFinding[] {
  if (candidateFindings.length === 0) return [...directFindings];

  const merged: ProcessedReviewFinding[] = [...directFindings];
  const seen = new Set(merged.map(reviewFindingIdentityKey));
  for (const finding of candidateFindings) {
    const key = reviewFindingIdentityKey(finding);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(finding);
  }
  return merged;
}

function reviewFindingIdentityKey(finding: ProcessedReviewFinding): string {
  const candidateFingerprint = typeof finding.candidateFingerprint === "string" ? finding.candidateFingerprint.trim() : "";
  if (candidateFingerprint) return `candidate:${candidateFingerprint}`;
  if (Number.isFinite(finding.commentId)) return `comment:${Math.floor(finding.commentId)}`;
  return [
    "content",
    finding.filePath,
    finding.title,
    typeof finding.startLine === "number" ? Math.floor(finding.startLine).toString() : "",
    typeof finding.endLine === "number" ? Math.floor(finding.endLine).toString() : "",
  ].join(":");
}

function logReviewCandidatePublicationRuntime(params: {
  logger: Logger;
  baseLog: Record<string, unknown>;
  runtime: ReviewCandidatePublicationRuntimeResult;
}): void {
  try {
    const payload = {
      ...params.baseLog,
      gate: "review-candidate-publication",
      gateResult: params.runtime.mode,
      mode: params.runtime.mode,
      counts: sanitizeProductionLogIssueTerms(params.runtime.counts),
      reasons: sanitizeProductionLogIssueTerms(params.runtime.reasons),
      outcomeBuckets: sanitizeProductionLogIssueTerms(params.runtime.outcomeBuckets),
      publisherResultSample: sanitizeProductionLogIssueTerms(params.runtime.publisherResultSample),
      movedToDetails: params.runtime.movedToDetails,
    };

    const expectedPolicyBlocked = isExpectedCandidatePublicationPolicyBlock(params.runtime);

    if (expectedPolicyBlocked) {
      params.logger.info(payload, "Review candidate publication completed with expected policy block");
      return;
    }

    if (params.runtime.mode === "degraded" || params.runtime.mode === "blocked" || params.runtime.mode === "fallback-disallowed") {
      params.logger.warn(payload, "Review candidate publication completed with non-approved mode");
      return;
    }

    params.logger.info(payload, "Review candidate publication completed");
  } catch (error) {
    params.logger.warn(
      {
        ...params.baseLog,
        gate: "review-candidate-publication",
        gateResult: "degraded",
        mode: "degraded",
        reasons: ["malformed-runtime-summary"],
        logError: error instanceof Error ? error.message : String(error),
      },
      "Review candidate publication runtime log degraded",
    );
  }
}

export function createReviewHandler(deps: {
  eventRouter: EventRouter;
  jobQueue: JobQueue;
  workspaceManager: WorkspaceManager;
  githubApp: GitHubApp;
  executor: ReturnType<typeof createExecutor>;
  telemetryStore: TelemetryStore;
  knowledgeStore?: KnowledgeStore;
  learningMemoryStore?: LearningMemoryStore;
  embeddingProvider?: EmbeddingProvider;
  retriever?: ReturnType<typeof createRetriever>;
  /** Optional injection for deterministic tests. */
  usageAnalyzer?: { analyzePackageUsage: typeof analyzePackageUsage };
  /** Optional injection for deterministic tests. */
  scopeCoordinator?: { detectScopeCoordination: typeof detectScopeCoordination };
  /** Optional injection for deterministic tests. */
  searchCache?: SearchCache<number>;
  /** Optional injection for deterministic tests. */
  searchCacheFactory?: () => SearchCache<number>;
  /** Optional derived prompt cache store overrides for review prompt reuse tests/fail-open wiring. */
  reviewPromptDerivedCacheOptions?: Pick<
    SearchCacheOptions<PromptBuildResult>,
    "ttlMs" | "store" | "inFlightStore"
  >;
  /** Optional prompt builder override for review prompt reuse tests. */
  reviewPromptBuilder?: typeof buildReviewPromptDetails;
  /** Optional code snippet store for hunk embedding. */
  codeSnippetStore?: CodeSnippetStore;
  /** Optional contributor profile store for 4-tier expertise-based reviews. */
  contributorProfileStore?: ContributorProfileStore;
  /** Optional Slack bot token for identity suggestion DMs. */
  slackBotToken?: string;
  /** Optional cluster pattern matcher (Phase 100: CLST-03). */
  clusterMatcher?: (opts: { prEmbedding: Float32Array | null; prFilePaths: string[]; repo: string }) => Promise<ClusterPatternMatch[]>;
  /** Optional issue store for PR-issue linking (Phase 108: PRLINK). */
  issueStore?: IssueStore;
  /** Optional review-graph blast-radius query for graph-aware large-PR selection. */
  reviewGraphQuery?: (input: {
    repo: string;
    workspaceKey: string;
    changedPaths: string[];
    limit?: number;
  }) => Promise<ReviewGraphBlastRadiusResult>;
  /** Optional SQL client for guardrail audit logging (GUARD-06). */
  sql?: import("../db/client.ts").Sql;
  /** Optional in-memory coordinator for same-PR review-family publish rights. */
  reviewWorkCoordinator?: ReviewWorkCoordinator;
  /** Optional cluster model store for thematic finding scoring (M037/S02). */
  clusterModelStore?: SuggestionClusterStore;
  /** Optional base-branch fetch override for deterministic tests. */
  fetchRemoteTrackingBranchFn?: typeof fetchRemoteTrackingBranch;
  /** Optional diff context collector for deterministic tests and bounded fallback behavior. */
  diffContextCollector?: typeof collectDiffContext;
  /** Optional same-job read-only shadow specialist subflow; fail-open and private by contract. */
  shadowSpecialistSubflow?: (input: ShadowSpecialistSubflowInput) => Promise<ShadowSpecialistSubflowResult>;
  /** Optional review plan builder override for fail-open contract tests. */
  reviewPlanBuilder?: ReviewPlanBuilder;
  /** Optional review reducer override for fail-open contract tests. */
  reviewReducer?: ReviewReducer;
  logger: Logger;
}): void {
  const {
    eventRouter,
    jobQueue,
    workspaceManager,
    githubApp,
    executor,
    telemetryStore,
    knowledgeStore,
    learningMemoryStore,
    embeddingProvider,
    retriever,
    usageAnalyzer,
    scopeCoordinator,
    searchCache: injectedSearchCache,
    searchCacheFactory,
    reviewPromptDerivedCacheOptions,
    reviewPromptBuilder = buildReviewPromptDetails,
    codeSnippetStore,
    contributorProfileStore,
    slackBotToken,
    clusterMatcher,
    issueStore,
    reviewGraphQuery,
    sql,
    reviewWorkCoordinator: injectedReviewWorkCoordinator,
    clusterModelStore,
    fetchRemoteTrackingBranchFn = fetchRemoteTrackingBranch,
    diffContextCollector = collectDiffContext,
    shadowSpecialistSubflow = runShadowSpecialistSubflow,
    reviewPlanBuilder = buildReviewPlan,
    reviewReducer = reduceReviewFindings,
    logger,
  } = deps;

  const guardrailAuditStore = sql ? createGuardrailAuditStore(sql) : undefined;
  const structuralImpactCache = createStructuralImpactCache();
  const reviewWorkCoordinator = injectedReviewWorkCoordinator ?? createReviewWorkCoordinator();
  if (!injectedReviewWorkCoordinator) {
    logger.warn(
      {
        gate: "review-family-coordinator",
        gateResult: "private-fallback",
        coordinationScope: "handler-local",
        handler: "review",
      },
      "Review work coordinator not injected; using a private handler-local fallback (cross-handler coordination disabled)",
    );
  }

  let reviewPromptDerivedCacheErrorCount = 0;
  const reviewPromptDerivedCache = createSearchCache<PromptBuildResult>({
    ...reviewPromptDerivedCacheOptions,
    onError: (error) => {
      reviewPromptDerivedCacheErrorCount += 1;
      logger.warn(
        {
          err: error,
          gate: "review-derived-prompt-cache",
          gateResult: "degraded",
        },
        "Review derived prompt cache degraded; bypassing cache for this request",
      );
    },
  });

  let authorPrCountSearchCache: SearchCache<number> | undefined;
  if (injectedSearchCache) {
    authorPrCountSearchCache = injectedSearchCache;
  } else {
    try {
      authorPrCountSearchCache = searchCacheFactory
        ? searchCacheFactory()
        : createSearchCache<number>();
    } catch (err) {
      logger.warn(
        { err },
        "Search cache initialization failed (fail-open, continuing without search cache)",
      );
      authorPrCountSearchCache = undefined;
    }
  }

  async function buildReviewPromptResultWithCache(params: {
    cacheQuery: string;
    context: ReviewPromptBuildContext;
    statusTarget: ReviewPromptCacheState;
  }): Promise<PromptBuildResult> {
    const fingerprintResult = buildReviewPromptFingerprint(params.context);
    if (!fingerprintResult.fingerprint) {
      params.statusTarget.status = "bypass";
      params.statusTarget.reason = "incomplete-fingerprint";
      params.statusTarget.missingSignalNames = fingerprintResult.missingSignals;
      return reviewPromptBuilder(params.context);
    }

    const cacheKey = buildSearchCacheKey({
      repo: `${params.context.owner}/${params.context.repo}`,
      searchType: "review-derived-prompt",
      query: params.cacheQuery,
      extra: {
        fingerprint: fingerprintResult.fingerprint,
      },
    });

    const cacheErrorsBeforeLookup = reviewPromptDerivedCacheErrorCount;
    let loaderExecuted = false;
    try {
      const result = await reviewPromptDerivedCache.getOrLoad(cacheKey, async () => {
        loaderExecuted = true;
        return reviewPromptBuilder(params.context);
      });
      const cacheDegraded = reviewPromptDerivedCacheErrorCount > cacheErrorsBeforeLookup;
      params.statusTarget.status = cacheDegraded ? "degraded" : loaderExecuted ? "miss" : "hit";
      params.statusTarget.reason = cacheDegraded ? "cache-bookkeeping-error" : null;
      params.statusTarget.fingerprintVersion = REVIEW_PROMPT_FINGERPRINT_VERSION;
      params.statusTarget.safetySignalNames = ["prompt-fingerprint-v1", "prompt-cache-query-head-sha"];
      if (cacheDegraded) {
        params.statusTarget.bookkeepingErrorCount = Math.max(1, reviewPromptDerivedCacheErrorCount - cacheErrorsBeforeLookup);
      }
      return result;
    } catch (error) {
      params.statusTarget.status = "degraded";
      params.statusTarget.reason = "cache-bookkeeping-error";
      params.statusTarget.bookkeepingErrorCount = Math.max(1, reviewPromptDerivedCacheErrorCount - cacheErrorsBeforeLookup);
      logger.warn(
        {
          err: error,
          gate: "review-derived-prompt-cache",
          gateResult: "degraded",
          cacheQuery: params.cacheQuery,
        },
        "Review prompt cache lookup failed; rebuilding directly",
      );
      return reviewPromptBuilder(params.context);
    }
  }

  async function recordReviewCacheEventFailOpen(entry: ReviewCacheEventRecord): Promise<void> {
    try {
      if (!telemetryStore.recordReviewCacheEvent) {
        logger.warn(
          {
            deliveryId: entry.deliveryId,
            repo: entry.repo,
            prNumber: entry.prNumber,
            cacheSurface: entry.cacheSurface,
            status: entry.status,
            reason: entry.reason,
          },
          "Review cache telemetry store method unavailable (non-blocking)",
        );
        return;
      }
      await telemetryStore.recordReviewCacheEvent(entry);
    } catch (err) {
      logger.warn(
        {
          err,
          deliveryId: entry.deliveryId,
          repo: entry.repo,
          prNumber: entry.prNumber,
          cacheSurface: entry.cacheSurface,
          status: entry.status,
          reason: entry.reason,
          fingerprintVersion: entry.fingerprintVersion,
          safetySignalNames: entry.safetySignalNames,
          missingSignalNames: entry.missingSignalNames,
          invalidationSignalNames: entry.invalidationSignalNames,
          bookkeepingErrorCount: entry.bookkeepingErrorCount ?? 0,
        },
        "Review cache telemetry write failed (non-blocking)",
      );
    }
  }

  async function handleReview(event: WebhookEvent): Promise<void> {
    const payload = event.payload as unknown as
      | PullRequestOpenedEvent
      | PullRequestReadyForReviewEvent
      | PullRequestReviewRequestedEvent
      | PullRequestSynchronizeEvent;

    const pr = payload.pull_request;
    const action = payload.action;
    const baseLog = {
      deliveryId: event.id,
      installationId: event.installationId,
      action,
      prNumber: pr.number,
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
    };
    const reviewOutputKey = buildReviewOutputKey({
      installationId: event.installationId,
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      prNumber: pr.number,
      action,
      deliveryId: event.id,
      headSha: pr.head.sha ?? "unknown-head-sha",
    });

    // Draft PR handling: review with softer tone instead of skipping.
    // When action is "ready_for_review", the PR is no longer a draft — use normal tone
    // regardless of pr.draft (which may still be truthy in the payload).
    const isDraft = action === "ready_for_review" ? false : Boolean(pr.draft);
    if (isDraft) {
      logger.info({ ...baseLog, isDraft: true }, "Reviewing draft PR with draft tone");
    }

    if (/\[no-review\]/i.test(pr.title)) {
      logger.info(
        { ...baseLog, gate: "keyword-skip", gateResult: "skipped" },
        "Review skipped via [no-review] keyword in PR title",
      );
      try {
        const skipOctokit = await githubApp.getInstallationOctokit(event.installationId);
        await skipOctokit.rest.issues.createComment({
          owner: payload.repository.owner.login,
          repo: payload.repository.name,
          issue_number: pr.number,
          // Defense-in-depth: sanitize outgoing mentions on all publish paths (Phase 50, CONV-05)
          body: sanitizeOutgoingMentions("Review skipped per `[no-review]` in PR title.", [githubApp.getAppSlug(), "claude"]),
        });
      } catch (commentErr) {
        logger.warn(
          { ...baseLog, err: commentErr },
          "Failed to post [no-review] acknowledgment (non-fatal)",
        );
      }
      return;
    }

    if (action === "review_requested") {
      const reviewRequestedPayload = payload as PullRequestReviewRequestedEvent;
      const requestedReviewer =
        "requested_reviewer" in reviewRequestedPayload
          ? reviewRequestedPayload.requested_reviewer
          : undefined;
      const requestedTeam =
        "requested_team" in reviewRequestedPayload
          ? reviewRequestedPayload.requested_team
          : undefined;
      const requestedReviewerLogin =
        typeof requestedReviewer?.login === "string"
          ? requestedReviewer.login
          : undefined;
      const requestedTeamName =
        typeof requestedTeam?.name === "string"
          ? requestedTeam.name
          : undefined;
      const requestedTeamSlug =
        typeof (requestedTeam as { slug?: unknown } | undefined)?.slug === "string"
          ? (requestedTeam as { slug: string }).slug
          : undefined;
      const appSlug = githubApp.getAppSlug();
      const normalizedAppSlug = normalizeReviewerLogin(appSlug);

      if (requestedReviewerLogin) {
        const normalizedRequestedReviewer = normalizeReviewerLogin(requestedReviewerLogin);
        if (normalizedRequestedReviewer !== normalizedAppSlug) {
          logger.info(
            {
              ...baseLog,
              gate: "review_requested_reviewer",
              gateResult: "skipped",
              skipReason: "non-kodiai-reviewer",
              requestedReviewer: requestedReviewerLogin,
              normalizedRequestedReviewer,
              normalizedAppSlug,
              requestedTeam: requestedTeamName ?? null,
            },
            "Skipping review_requested event for non-kodiai reviewer",
          );
          return;
        }

        logger.info(
          {
            ...baseLog,
            gate: "review_requested_reviewer",
            gateResult: "accepted",
            requestedReviewer: requestedReviewerLogin,
            normalizedRequestedReviewer,
            normalizedAppSlug,
          },
          "Accepted review_requested event for kodiai reviewer",
        );
      } else if (requestedTeamName || requestedTeamSlug) {
        logger.info(
          {
            ...baseLog,
            gate: "review_requested_reviewer",
            gateResult: "skipped",
            skipReason: "team-only-request",
            requestedReviewer: null,
            requestedTeam: requestedTeamName ?? null,
            requestedTeamSlug: requestedTeamSlug ?? null,
          },
          "Skipping review_requested event because only a team was requested",
        );
        return;
      } else {
        logger.warn(
          {
            ...baseLog,
            gate: "review_requested_reviewer",
            gateResult: "skipped",
            skipReason: "missing-or-malformed-reviewer-payload",
            hasRequestedReviewerField: "requested_reviewer" in reviewRequestedPayload,
            hasRequestedTeamField: "requested_team" in reviewRequestedPayload,
          },
          "Skipping review_requested event due to missing reviewer payload",
        );
        return;
      }
    }

    // API target is always the base (upstream) repo
    const apiOwner = payload.repository.owner.login;
    const apiRepo = payload.repository.name;

    const headRepo = pr.head.repo;
    const isFork = Boolean(headRepo && headRepo.full_name !== payload.repository.full_name);
    const isDeletedFork = !headRepo;

    let cloneOwner: string;
    let cloneRepo: string;
    let cloneRef: string;
    let usesPrRef = false;

    if (isFork || isDeletedFork) {
      // Fork PRs (or deleted forks): clone base branch and fetch PR head ref from base repo.
      // This avoids relying on access to the contributor's fork.
      cloneOwner = apiOwner;
      cloneRepo = apiRepo;
      cloneRef = pr.base.ref;
      usesPrRef = true;
    } else {
      // Non-fork PR: clone the head branch directly from the base repo.
      cloneOwner = headRepo.owner.login;
      cloneRepo = headRepo.name;
      cloneRef = pr.head.ref;
    }

    logger.info(
      {
        prNumber: pr.number,
        apiOwner,
        apiRepo,
        cloneOwner,
        cloneRepo,
        cloneRef,
        isFork,
        isDeletedFork,
        usesPrRef,
        workspaceStrategy: usesPrRef
          ? "base-clone+pull-ref-fetch"
          : "direct-head-branch-clone",
        action,
        deliveryId: event.id,
        installationId: event.installationId,
      },
      "Processing PR review",
    );

    logger.info(
      { ...baseLog, gate: "enqueue", gateResult: "started" },
      "Review enqueue started",
    );

    const reviewFamilyKey = buildReviewFamilyKey(apiOwner, apiRepo, pr.number);
    const reviewWorkAttempt = reviewWorkCoordinator.claim({
      familyKey: reviewFamilyKey,
      source: "automatic-review",
      lane: "review",
      deliveryId: event.id,
      phase: "claimed",
    });
    let reviewWorkAttemptCommitted = false;
    let reviewWorkAttemptFinalized = false;

    function finalizeReviewWorkAttempt(): void {
      if (reviewWorkAttemptFinalized) {
        return;
      }

      reviewWorkAttemptFinalized = true;
      if (reviewWorkAttemptCommitted) {
        reviewWorkCoordinator.complete(reviewWorkAttempt.attemptId);
        return;
      }

      reviewWorkCoordinator.release(reviewWorkAttempt.attemptId);
    }

    try {
      await jobQueue.enqueue(event.installationId, async (queueMetadata) => {
      const reviewPhaseTimings = new Map<ReviewPhaseName, ReviewPhaseTiming>();
      reviewPhaseTimings.set("queue wait", buildQueueWaitPhase(queueMetadata));
      const reviewStartedAt = Date.now();
      const totalPhaseStartAt = isValidQueueWaitMetadata(queueMetadata)
        ? queueMetadata.queuedAtMs
        : reviewStartedAt;
      let workspacePhaseStartedAt: number | undefined;
      let retrievalPhaseStartedAt: number | undefined;
      let publicationPhaseStartedAt: number | undefined;
      let executorPhaseTimings: ExecutorPhaseTiming[] = buildExecutorUnavailablePhases(
        "executor phase timings unavailable",
      );
      let executorResult: Awaited<ReturnType<typeof executor.execute>> | undefined;
      let reviewExecutionLogged = false;
      let reviewOutputPublished = false;
      let reviewExecutorPublished = false;
      let reviewPublishResolution = "none";
      let reviewPublishFallbackDelivery: string | undefined;

      function describeErrorCommentDelivery(status: Awaited<ReturnType<typeof postOrUpdateErrorComment>>): string {
        if (!status.ok) return "error-comment-failed";
        return status.resolution === "updated" ? "error-comment-updated" : "error-comment-created";
      }
      function describeTurnLimitNoticeDelivery(status: Awaited<ReturnType<typeof postOrUpdateErrorComment>>): string {
        if (!status.ok) return "turn-limit-comment-undelivered";
        return status.resolution === "updated" ? "turn-limit-comment-updated" : "turn-limit-comment-created";
      }
      function isExpectedTurnLimitOutcome(result: typeof executorResult): boolean {
        return result?.stopReason === "max_turns" || result?.failureSubtype === "error_max_turns";
      }
      function cleanTurnLimitPublishResolution(resolution: string): string {
        return resolution === "turn-limit-fallback-failed"
          ? "turn-limit-fallback-undelivered"
          : resolution;
      }

      function logReviewExecutionCompleted(): void {
        if (!executorResult || reviewExecutionLogged) return;
        reviewExecutionLogged = true;
        const expectedTurnLimitOutcome = isExpectedTurnLimitOutcome(executorResult);
        logger.info(
          {
            prNumber: pr.number,
            conclusion: expectedTurnLimitOutcome ? "expected_bounded" : executorResult.conclusion,
            ...(expectedTurnLimitOutcome
              ? { boundedOutcomeReason: "max_turns" }
              : { failureSubtype: executorResult.failureSubtype }),
            published: reviewOutputPublished,
            executorPublished: reviewExecutorPublished,
            publishResolution: expectedTurnLimitOutcome
              ? cleanTurnLimitPublishResolution(reviewPublishResolution)
              : reviewPublishResolution,
            publishFallbackDelivery: reviewPublishFallbackDelivery,
            stopReason: executorResult.stopReason,
            costUsd: executorResult.costUsd,
            numTurns: executorResult.numTurns,
            durationMs: executorResult.durationMs,
            sessionId: executorResult.sessionId,
          },
          "Review execution completed",
        );
      }

      function setReviewWorkPhaseForAttempt(
        attemptId: string,
        phase: ReviewWorkPhase,
      ): void {
        if (attemptId === reviewWorkAttempt.attemptId) {
          reviewWorkAttemptCommitted = true;
        }
        reviewWorkCoordinator.setPhase(attemptId, phase);
      }

      function setReviewWorkPhase(phase: ReviewWorkPhase): void {
        setReviewWorkPhaseForAttempt(reviewWorkAttempt.attemptId, phase);
      }

      function getBaseReviewOutputKey(currentReviewOutputKey: string): string {
        return currentReviewOutputKey.replace(/-retry-\d+$/, "");
      }

      function getAttemptOrdinal(attemptId: string): number {
        const match = /(?:^|[^\d])(\d+)$/.exec(attemptId);
        return match ? Number.parseInt(match[1] ?? "0", 10) : 0;
      }

      async function persistContinuationFamilyState(params: {
        authoritativeAttemptId: string;
        authoritativeAttemptOrdinal?: number;
        authoritativeOutcome: ContinuationFamilyAuthoritativeOutcome;
        finalStopReason: ContinuationFamilyFinalStopReason;
        projectionStatus: ContinuationFamilyProjectionStatus;
        supersededByAttemptId?: string | null;
        reviewOutputKey?: string;
      }): Promise<void> {
        if (!knowledgeStore?.upsertContinuationFamilyState) {
          return;
        }

        const authoritativeAttemptOrdinal = params.authoritativeAttemptOrdinal
          ?? getAttemptOrdinal(params.authoritativeAttemptId);
        if (!Number.isFinite(authoritativeAttemptOrdinal) || authoritativeAttemptOrdinal < 1) {
          logger.warn(
            {
              ...baseLog,
              gate: "continuation-family-state",
              gateResult: "skipped",
              reason: "invalid-attempt-ordinal",
              authoritativeAttemptId: params.authoritativeAttemptId,
            },
            "Skipping canonical continuation-family state write because the attempt ordinal was invalid",
          );
          return;
        }

        try {
          await knowledgeStore.upsertContinuationFamilyState({
            familyKey: reviewFamilyKey,
            baseReviewOutputKey: getBaseReviewOutputKey(params.reviewOutputKey ?? reviewOutputKey),
            authoritativeAttemptId: params.authoritativeAttemptId,
            authoritativeAttemptOrdinal,
            authoritativeOutcome: params.authoritativeOutcome,
            finalStopReason: params.finalStopReason,
            projectionStatus: params.projectionStatus,
            supersededByAttemptId: params.supersededByAttemptId ?? null,
          });
        } catch (err) {
          logger.warn(
            {
              ...baseLog,
              gate: "continuation-family-state",
              gateResult: "degraded",
              authoritativeAttemptId: params.authoritativeAttemptId,
              authoritativeOutcome: params.authoritativeOutcome,
              finalStopReason: params.finalStopReason,
              err,
            },
            "Failed to persist canonical continuation-family state",
          );
        }
      }

      async function persistDegradedContinuationFamilyState(params: {
        authoritativeAttemptId: string;
        authoritativeOutcome: ContinuationFamilyAuthoritativeOutcome;
        finalStopReason: ContinuationFamilyFinalStopReason;
        supersededByAttemptId?: string | null;
        reviewOutputKey?: string;
      }): Promise<void> {
        await persistContinuationFamilyState({
          ...params,
          projectionStatus: "degraded",
        });
      }

      async function settleRetryWithoutCanonicalUpdate(params: {
        attemptId: string;
        reviewOutputKey?: string;
        deliveryId: string;
        reason: string;
        logMessage: string;
      }): Promise<void> {
        logger.warn(
          {
            deliveryId: params.deliveryId,
            prNumber: pr.number,
            reviewOutputKey: params.reviewOutputKey,
            reason: params.reason,
          },
          params.logMessage,
        );
        await persistContinuationFamilyState({
          authoritativeAttemptId: params.attemptId,
          authoritativeOutcome: "quiet-settled",
          finalStopReason: "settled-without-update",
          projectionStatus: "canonical",
          reviewOutputKey: params.reviewOutputKey,
        });
      }

      async function finalizeContinuationAttempt(params: {
        attemptId: string;
        fallbackOutcome: ContinuationFamilyAuthoritativeOutcome;
        fallbackStopReason: ContinuationFamilyFinalStopReason;
        reviewOutputKey?: string;
      }): Promise<void> {
        const currentAttempt = reviewWorkCoordinator
          .getSnapshot(reviewFamilyKey)
          ?.attempts.find((attempt) => attempt.attemptId === params.attemptId);
        const supersededByAttemptId = currentAttempt?.supersededByAttemptId ?? null;

        if (supersededByAttemptId) {
          await persistContinuationFamilyState({
            authoritativeAttemptId: supersededByAttemptId,
            authoritativeOutcome: "superseded",
            finalStopReason: "superseded-by-newer-attempt",
            projectionStatus: "canonical",
            supersededByAttemptId,
            reviewOutputKey: params.reviewOutputKey,
          });
          return;
        }

        await persistContinuationFamilyState({
          authoritativeAttemptId: params.attemptId,
          authoritativeOutcome: params.fallbackOutcome,
          finalStopReason: params.fallbackStopReason,
          projectionStatus: "canonical",
          reviewOutputKey: params.reviewOutputKey,
        });
      }

      function canPublishReviewWorkOutput(
        attemptId: string,
        outputLabel: string,
        deliveryId: string,
      ): boolean {
        if (reviewWorkCoordinator.canPublish(attemptId)) {
          return true;
        }

        const currentAttempt = reviewWorkCoordinator
          .getSnapshot(reviewFamilyKey)
          ?.attempts.find((attempt) => attempt.attemptId === attemptId);
        const supersededByAttemptId = currentAttempt?.supersededByAttemptId ?? null;
        if (supersededByAttemptId) {
          void persistContinuationFamilyState({
            authoritativeAttemptId: supersededByAttemptId,
            authoritativeOutcome: "superseded",
            finalStopReason: "superseded-by-newer-attempt",
            projectionStatus: "canonical",
            supersededByAttemptId,
          });
        }
        logger.info(
          {
            ...baseLog,
            deliveryId,
            gate: "review-family-coordinator",
            gateResult: "skipped",
            skipReason: "publish-rights-lost",
            reviewFamilyKey,
            reviewWorkAttemptId: attemptId,
            supersededByAttemptId,
          },
          `Skipping ${outputLabel} because publish rights were superseded`,
        );
        return false;
      }

      function canPublishVisibleOutput(outputLabel: string): boolean {
        return canPublishReviewWorkOutput(reviewWorkAttempt.attemptId, outputLabel, event.id);
      }

      // Durable run state idempotency check (REL-01)
      // Check before expensive workspace creation. Uses SHA pair as identity key.
      // Fail-open: if knowledgeStore is undefined or query throws, proceed with review.
      if (knowledgeStore) {
        try {
          const runCheck = await knowledgeStore.checkAndClaimRun({
            repo: `${apiOwner}/${apiRepo}`,
            prNumber: pr.number,
            baseSha: pr.base.sha,
            headSha: pr.head.sha,
            deliveryId: event.id,
            action,
          });

          if (!runCheck.shouldProcess) {
            logger.info(
              {
                ...baseLog,
                gate: 'run-state-idempotency',
                gateResult: 'skipped',
                skipReason: runCheck.reason,
                runKey: runCheck.runKey,
              },
              'Skipping review: run state indicates duplicate or already processed',
            );
            return;
          }

          if (runCheck.supersededRunKeys.length > 0) {
            logger.info(
              {
                ...baseLog,
                gate: 'run-state-idempotency',
                gateResult: 'accepted',
                runKey: runCheck.runKey,
                supersededRunKeys: runCheck.supersededRunKeys,
              },
              'New run superseded prior runs (force-push detected)',
            );
          }
        } catch (err) {
          logger.warn(
            { ...baseLog, err },
            'Run state idempotency check failed (fail-open, proceeding with review)',
          );
        }
      }

      let workspace: Workspace | undefined;
      try {
        setReviewWorkPhase("workspace-create");
        workspacePhaseStartedAt = Date.now();
        // Create workspace with enough shallow history to usually include the base merge point.
        workspace = await workspaceManager.create(event.installationId, {
          owner: cloneOwner,
          repo: cloneRepo,
          ref: cloneRef,
          depth: REVIEW_WORKSPACE_FETCH_DEPTH,
        });

        const trustedBaseRepoConfig = usesPrRef
          ? await loadRepoConfig(workspace.dir)
          : null;

        // Fork PR / deleted fork: fetch PR head ref from base repo
        if (usesPrRef) {
          await fetchAndCheckoutPullRequestHeadRef({
            dir: workspace.dir,
            prNumber: pr.number,
            localBranch: "pr-review",
            token: workspace.token,
            fallbackRemoteUrl: pr.head.repo ? `https://github.com/${pr.head.repo.full_name}.git` : undefined,
            fallbackRef: pr.head.ref,
            depth: REVIEW_WORKSPACE_FETCH_DEPTH,
          });
        }

        // Fetch base branch so git diff origin/BASE...HEAD works.
        // Explicit refspec needed because --single-branch clones don't track other branches.
        await fetchRemoteTrackingBranchFn({
          dir: workspace.dir,
          branch: pr.base.ref,
          token: workspace.token,
          depth: REVIEW_WORKSPACE_FETCH_DEPTH,
        });

        setReviewWorkPhase("load-config");
        // Load repo config (.kodiai.yml) with defaults. For fork PRs, the active
        // policy comes from the trusted base checkout, not the untrusted PR head.
        const { config, warnings } = trustedBaseRepoConfig ?? (await loadRepoConfig(workspace.dir));
        for (const w of warnings) {
          logger.warn(
            { section: w.section, issues: w.issues },
            "Config warning detected",
          );
        }
        reviewPhaseTimings.set(
          "workspace preparation",
          createReviewPhaseTiming({
            name: "workspace preparation",
            status: "completed",
            durationMs: Math.max(0, Date.now() - (workspacePhaseStartedAt ?? Date.now())),
          }),
        );

        logger.info(
          {
            ...baseLog,
            gate: "trigger-config",
            reviewEnabled: config.review.enabled,
            triggers: config.review.triggers,
          },
          "Evaluating review trigger configuration",
        );

        // Check review.enabled
        if (!config.review.enabled) {
          logger.info(
            {
              ...baseLog,
              gate: "review-enabled",
              gateResult: "skipped",
              skipReason: "review-disabled",
              apiOwner,
              apiRepo,
            },
            "Review disabled in config, skipping",
          );
          return;
        }

        // Check whether this event action is enabled in review.triggers
        if (!isReviewTriggerEnabled(action, config.review.triggers)) {
          logger.info(
            {
              ...baseLog,
              gate: "review-trigger",
              gateResult: "skipped",
              skipReason: "trigger-disabled",
              triggers: config.review.triggers,
            },
            "Review trigger disabled in config, skipping",
          );
          return;
        }

        const idempotencyOctokit = await githubApp.getInstallationOctokit(event.installationId);
        let acceptedCanonicalSurface: CanonicalReviewSurface | null = null;
        const idempotencyCheck = await ensureReviewOutputNotPublished({
          octokit: idempotencyOctokit,
          owner: apiOwner,
          repo: apiRepo,
          prNumber: pr.number,
          reviewOutputKey,
        });

        if (!idempotencyCheck.shouldPublish) {
          const canonicalSurfaceKind = idempotencyCheck.existingLocation === "review"
            ? "pull_review"
            : idempotencyCheck.existingLocation === "issue-comment"
              ? "issue_comment"
              : null;
          const canonicalSurface = canonicalSurfaceKind
            ? await findCanonicalReviewSurface({
              octokit: idempotencyOctokit,
              owner: apiOwner,
              repo: apiRepo,
              prNumber: pr.number,
              reviewOutputKey,
              surfaceKind: canonicalSurfaceKind,
            })
            : null;
          const canonicalSurfaceHasReviewDetails = canonicalSurface?.body.includes("<summary>Review Details</summary>") ?? false;

          if (canonicalSurface && !canonicalSurfaceHasReviewDetails) {
            acceptedCanonicalSurface = canonicalSurface;
            logger.info(
              {
                ...baseLog,
                gate: "review-output-idempotency",
                gateResult: "accepted",
                reason: "canonical-surface-missing-review-details",
                reviewOutputKey,
                existingLocation: idempotencyCheck.existingLocation,
                canonicalSurfaceKind: canonicalSurface.kind,
              },
              "Review output idempotency check accepted incomplete canonical surface for Review Details finalization",
            );
          } else {
            logger.info(
              {
                ...baseLog,
                gate: "review-output-idempotency",
                gateResult: "skipped",
                skipReason: "already-published",
                reviewOutputKey,
                existingLocation: idempotencyCheck.existingLocation,
              },
              "Skipping review execution because output already published for key",
            );
            return;
          }
        }

        logger.info(
          {
            ...baseLog,
            gate: "review-output-idempotency",
            gateResult: "accepted",
            reviewOutputKey,
          },
          "Review output idempotency check passed",
        );

        let parsedIntent: ParsedPRIntent = DEFAULT_EMPTY_INTENT;
        let commitMessagesForLinking: string[] = [];
        try {
          const commitMessages = await fetchCommitMessages(
            idempotencyOctokit,
            apiOwner,
            apiRepo,
            pr.number,
            pr.commits,
          );
          commitMessagesForLinking = commitMessages.map(c => c.message);
          parsedIntent = parsePRIntent(pr.title, pr.body ?? null, commitMessages);
          logger.info(
            {
              ...baseLog,
              gate: "keyword-parse",
              recognized: parsedIntent.recognized,
              unrecognized: parsedIntent.unrecognized,
              noReview: parsedIntent.noReview,
              isWIP: parsedIntent.isWIP,
              profileOverride: parsedIntent.profileOverride,
              breakingChange: parsedIntent.breakingChangeDetected,
              conventionalType: parsedIntent.conventionalType?.type ?? null,
            },
            "PR intent keywords parsed",
          );
        } catch (err) {
          logger.warn(
            { ...baseLog, err },
            "PR intent parsing failed (fail-open, proceeding without keywords)",
          );
        }

        // Add eyes reaction only for explicit re-review requests.
        // Do not react on opened/ready_for_review to avoid noise on the PR description.
        if (action === "review_requested") {
          try {
            const reactionOctokit = await githubApp.getInstallationOctokit(event.installationId);
            await reactionOctokit.rest.reactions.createForIssue({
              owner: apiOwner,
              repo: apiRepo,
              issue_number: pr.number,
              content: "eyes",
            });
          } catch (err) {
            // Non-fatal: don't block processing if reaction fails
            logger.warn({ err, prNumber: pr.number }, "Failed to add eyes reaction to PR");
          }
        }

        // Check skipAuthors
        if (config.review.skipAuthors.includes(pr.user.login)) {
          logger.info(
            { prNumber: pr.number, author: pr.user.login },
            "PR author in skipAuthors, skipping review",
          );
          return;
        }

        let authorClassification: ReviewAuthorClassification = {
          tier: "regular",
          prCount: null,
          fromCache: false,
          searchCacheHit: false,
          searchEnrichment: {
            degraded: false,
            retryAttempts: 0,
            skippedQueries: 0,
            degradationPath: "none",
          },
          contract: projectContributorExperienceContract({
            source: "none",
            tier: null,
          }),
          storedProfileTrust: null,
          fallbackPath: "no-stored-profile->generic-unknown",
        };

        try {
          authorClassification = await resolveAuthorTier({
            authorLogin: pr.user.login,
            authorAssociation: (pr as { author_association?: string }).author_association ?? "NONE",
            repo: apiRepo,
            owner: apiOwner,
            repoSlug: `${apiOwner}/${apiRepo}`,
            octokit: idempotencyOctokit,
            knowledgeStore,
            searchCache: authorPrCountSearchCache,
            contributorProfileStore,
            logger,
          });
          logger.info(
            {
              ...baseLog,
              authorTier: authorClassification.tier,
              authorPrCount: authorClassification.prCount,
              fromCache: authorClassification.fromCache,
              searchCacheHit: authorClassification.searchCacheHit,
              storedProfileTrustState:
                authorClassification.storedProfileTrust?.state ?? null,
              storedProfileTrustReason:
                authorClassification.storedProfileTrust?.reason ?? null,
              storedProfileCalibrationMarker:
                authorClassification.storedProfileTrust?.calibrationMarker ?? null,
              storedProfileCalibrationVersion:
                authorClassification.storedProfileTrust?.calibrationVersion ?? null,
              storedProfileFallbackPath: authorClassification.fallbackPath,
              contributorExperienceState: authorClassification.contract.state,
              contributorExperienceSource: authorClassification.contract.source,
              contributorExperienceReviewBehavior: authorClassification.contract.reviewBehavior,
              contributorExperienceDegraded: authorClassification.contract.degraded,
              contributorExperienceDegradationPath: authorClassification.contract.degradationPath,
              searchEnrichmentDegraded: authorClassification.searchEnrichment.degraded,
              searchEnrichmentRetryAttempts: authorClassification.searchEnrichment.retryAttempts,
              searchEnrichmentSkippedQueries: authorClassification.searchEnrichment.skippedQueries,
              searchEnrichmentPath: authorClassification.searchEnrichment.degradationPath,
            },
            "Author experience classification resolved",
          );
        } catch (err) {
          logger.warn(
            { ...baseLog, err },
            "Author classification failed (fail-open, using generic unknown contract)",
          );
        }

        // Fire-and-forget: suggest identity linking via DM for unlinked contributors
        if (
          authorClassification.contract.state !== "generic-opt-out" &&
          !authorClassification.expertise &&
          slackBotToken &&
          contributorProfileStore
        ) {
          suggestIdentityLink({
            githubUsername: pr.user.login,
            githubDisplayName: pr.user.name ?? null,
            slackBotToken,
            profileStore: contributorProfileStore,
            logger,
          }).catch((err) =>
            logger.warn({ ...baseLog, err }, "Identity suggestion check failed (non-blocking)"),
          );
        }

        // Emit rate-limit telemetry from a single deterministic point after
        // author-tier Search enrichment outcomes are finalized for this run.
        const rateLimitTelemetryEvent = {
          deliveryId: event.id,
          executionIdentity: event.id,
          repo: `${apiOwner}/${apiRepo}`,
          prNumber: pr.number,
          eventType: `pull_request.${payload.action}`,
          cacheHitRate: authorClassification.searchCacheHit ? 1 : 0,
          skippedQueries: authorClassification.searchEnrichment.skippedQueries,
          retryAttempts: authorClassification.searchEnrichment.retryAttempts,
          degradationPath: authorClassification.searchEnrichment.degradationPath,
        };

        if (config.telemetry.enabled) {
          try {
            await telemetryStore.recordRateLimitEvent(rateLimitTelemetryEvent);
          } catch (err) {
            logger.warn(
              {
                ...baseLog,
                err,
                executionIdentity: rateLimitTelemetryEvent.executionIdentity,
                telemetryEventType: rateLimitTelemetryEvent.eventType,
              },
              "Rate-limit telemetry write failed (non-blocking)",
            );
          }
        }

        setReviewWorkPhase("incremental-diff");
        // Incremental diff computation (REV-01)
        // Determine if this is an incremental re-review based on prior completed reviews.
        // Works for both synchronize and review_requested events (state-driven, not event-driven).
        let incrementalResult: IncrementalDiffResult | null = null;
        if (knowledgeStore) {
          try {
            incrementalResult = await computeIncrementalDiff({
              workspaceDir: workspace.dir,
              repo: `${apiOwner}/${apiRepo}`,
              prNumber: pr.number,
              getLastReviewedHeadSha: (p) => knowledgeStore.getLastReviewedHeadSha(p),
              logger,
            });
            logger.info(
              { ...baseLog, gate: "incremental-diff", mode: incrementalResult.mode, reason: incrementalResult.reason },
              "Incremental diff computation complete",
            );
          } catch (err) {
            logger.warn({ ...baseLog, err }, "Incremental diff computation failed (fail-open, full review)");
          }
        }

        // Build changed files and diff context, handling shallow-history merge-base gaps.
        retrievalPhaseStartedAt = Date.now();
        const diffContext = await diffContextCollector({
          workspaceDir: workspace.dir,
          baseRef: pr.base.ref,
          maxFilesForFullDiff: 200,
          logger,
          baseLog,
          token: workspace.token,
          fallbackDiffProvider: async () => await fetchAllPullRequestFiles({
            octokit: idempotencyOctokit,
            owner: apiOwner,
            repo: apiRepo,
            pullNumber: pr.number,
          }),
        });
        const allChangedFiles = diffContext.changedFiles;

        // ── [depends] deep-review detection (DEPS-01/02) ──
        // Runs BEFORE Dependabot detection. If matched, Dependabot path is skipped.
        let dependsBumpInfo: DependsBumpInfo | null = null;
        try {
          dependsBumpInfo = detectDependsBump(pr.title);
          if (dependsBumpInfo) {
            logger.info({
              ...baseLog,
              gate: "depends-bump-detect",
              packages: dependsBumpInfo.packages.map(p => p.name),
              platform: dependsBumpInfo.platform,
              isGroup: dependsBumpInfo.isGroup,
            }, "[depends] bump detected — entering deep-review pipeline");
          }
        } catch (err) {
          logger.warn({ ...baseLog, err, gate: "depends-bump-detect" }, "[depends] detection failed (fail-open)");
        }

        // ── [depends] deep-review pipeline ──
        // When a [depends] bump is detected, run enrichment, build structured comment, and post.
        if (dependsBumpInfo) {
          try {
            // 1. Fetch PR files with status/patch from GitHub API
            const prFilesForDepends = (await fetchAllPullRequestFiles({
              octokit: idempotencyOctokit,
              owner: apiOwner,
              repo: apiRepo,
              pullNumber: pr.number,
            })).map((file) => ({
              filename: file.filename,
              status: file.status,
              patch: file.patch ?? undefined,
            }));

            // 2. Parse VERSION file diffs from PR files
            const versionDiffs: { packageName: string; oldVersion: string | null; newVersion: string | null; versionFileDiff: ReturnType<typeof parseVersionFileDiff> | null }[] = [];
            for (const pkg of dependsBumpInfo.packages) {
              const versionFile = prFilesForDepends.find(f =>
                f.filename.toLowerCase().includes(pkg.name.toLowerCase()) &&
                f.filename.toUpperCase().includes("VERSION")
              );
              const vFileDiff = versionFile?.patch ? parseVersionFileDiff(versionFile.patch) : null;
              versionDiffs.push({
                packageName: pkg.name,
                oldVersion: vFileDiff?.oldVersion ?? pkg.oldVersion ?? null,
                newVersion: vFileDiff?.newVersion ?? pkg.newVersion ?? null,
                versionFileDiff: vFileDiff,
              });
            }

            // 2b. Fallback: parse .list files for packages missing version info
            for (const vd of versionDiffs) {
              if (vd.oldVersion || vd.newVersion) continue; // already have version data
              const listFiles = prFilesForDepends.filter(f =>
                f.filename.toLowerCase().includes("0_package.target") &&
                f.patch
              );
              for (const listFile of listFiles) {
                const entries = parsePackageListDiff(listFile.patch!);
                const match = entries.find(e =>
                  e.name.toLowerCase() === vd.packageName.toLowerCase()
                );
                if (match) {
                  vd.oldVersion = match.oldVersion;
                  vd.newVersion = match.newVersion;
                  // Leave versionFileDiff as null -- no VERSION file exists
                  logger.info({ ...baseLog, gate: "depends-list-fallback", packageName: vd.packageName }, "[depends] extracted version from .list file for " + vd.packageName);
                  break;
                }
              }
            }

            // 3. Fetch changelogs (parallel)
            const changelogs = await Promise.all(
              dependsBumpInfo.packages.map(async pkg => {
                const vd = versionDiffs.find(v => v.packageName === pkg.name);
                const changelog = await fetchDependsChangelog({
                  libraryName: pkg.name,
                  oldVersion: vd?.oldVersion ?? pkg.oldVersion ?? "",
                  newVersion: vd?.newVersion ?? pkg.newVersion ?? "",
                  octokit: idempotencyOctokit,
                  timeoutMs: 4000,
                  versionFileDiff: vd?.versionFileDiff ?? null,
                });
                return { packageName: pkg.name, changelog };
              })
            );

            // 4. Verify hashes (parallel)
            const hashResults = await Promise.all(
              versionDiffs.map(async vd => {
                if (!vd.versionFileDiff?.newSha512) {
                  return { packageName: vd.packageName, result: { status: "skipped" as const, detail: "No hash in VERSION file" } };
                }
                const archiveUrl = vd.versionFileDiff.newBaseUrl && vd.versionFileDiff.newArchive
                  ? `${vd.versionFileDiff.newBaseUrl}/${vd.versionFileDiff.newArchive}`
                  : null;
                if (!archiveUrl) {
                  return { packageName: vd.packageName, result: { status: "skipped" as const, detail: "Cannot construct download URL" } };
                }
                const result = await verifyHash({
                  url: archiveUrl,
                  expectedSha512: vd.versionFileDiff.newSha512,
                  timeoutMs: 5000,
                });
                return { packageName: vd.packageName, result };
              })
            );

            // 5. Detect patch changes
            const patchChanges = detectPatchChanges(
              prFilesForDepends.filter((f): f is typeof f & { status: string } => !!f.status)
            );

            // 6. Impact analysis (workspace required)
            let dependsImpact = null;
            let dependsTransitive = null;
            if (workspace) {
              try {
                const primaryPkg = dependsBumpInfo.packages[0];
                if (primaryPkg) {
                  dependsImpact = await findDependencyConsumers({
                    workspaceDir: workspace.dir,
                    libraryName: primaryPkg.name,
                    octokit: idempotencyOctokit,
                    owner: apiOwner,
                    repo: apiRepo,
                    timeBudgetMs: 3000,
                  });
                  dependsTransitive = await checkTransitiveDependencies({
                    libraryName: primaryPkg.name,
                    octokit: idempotencyOctokit,
                    owner: apiOwner,
                    repo: apiRepo,
                  });
                }
              } catch (err) {
                logger.warn({ ...baseLog, err, gate: "depends-impact" }, "Impact analysis failed (fail-open)");
              }
            }

            // 7. Retrieval context (past reviews/wiki about this dependency)
            let dependsRetrievalContext: import("../knowledge/cross-corpus-rrf.ts").UnifiedRetrievalChunk[] | null = null;
            if (retriever) {
              try {
                const primaryPkg = dependsBumpInfo.packages[0];
                if (primaryPkg) {
                  const result = await retriever.retrieve({
                    repo: `${apiOwner}/${apiRepo}`,
                    owner: apiOwner,
                    queries: [`${primaryPkg.name} dependency bump update`],
                    workspaceDir: workspace?.dir ?? "",
                    prLanguages: ["c", "cpp", "cmake"],
                    logger,
                    triggerType: "pr_review",
                  });
                  if (result && result.unifiedResults && result.unifiedResults.length > 0) {
                    dependsRetrievalContext = result.unifiedResults.slice(0, 3);
                  }
                }
              } catch (err) {
                logger.warn({ ...baseLog, err, gate: "depends-retrieval" }, "Retrieval context failed (fail-open)");
              }
            }

            // 7b. Generate context summary (fail-open: null on error)
            let dependsContextSummary: string | null = null;
            if (dependsRetrievalContext && dependsRetrievalContext.length > 0) {
              try {
                const taskRouter = createTaskRouter({ models: {} });
                const resolved = taskRouter.resolve(TASK_TYPES.DEPENDS_CONTEXT_SUMMARY);
                const pkg = dependsBumpInfo.packages[0]?.name ?? "this dependency";
                const snippets = dependsRetrievalContext
                  .map((c, i) => {
                    const author = (c.metadata?.authorLogin as string | undefined) ?? "unknown";
                    const date = c.createdAt ? new Date(c.createdAt).toISOString().slice(0, 10) : "?";
                    return `${i + 1}. @${author} (${date}): ${c.text.trim().slice(0, 200)}`;
                  })
                  .join("\n");
                const summaryResult = await generateWithFallback({
                  taskType: TASK_TYPES.DEPENDS_CONTEXT_SUMMARY,
                  resolved,
                  system: "You summarize past PR discussion snippets into 1–2 plain sentences explaining why they are relevant context for a dependency bump review. No bullet points. No headers. Output only the summary sentences.",
                  prompt: `Dependency being bumped: ${pkg}\n\nPast discussion snippets:\n${snippets}\n\nSummarize in 1–2 sentences why these past comments are relevant to this bump.`,
                  logger,
                  repo: `${apiOwner}/${apiRepo}`,
                  deliveryId: String(pr.number),
                });
                dependsContextSummary = summaryResult.text.trim() || null;
              } catch (err) {
                logger.warn({ ...baseLog, err, gate: "depends-context-summary" }, "Context summary generation failed (fail-open)");
              }
            }

            // 8. Build and post the deep-review comment
            const reviewData: DependsReviewData = {
              info: dependsBumpInfo,
              versionDiffs,
              changelogs,
              hashResults,
              patchChanges,
              impact: dependsImpact,
              transitive: dependsTransitive,
              retrievalContext: dependsRetrievalContext,
              contextSummary: dependsContextSummary,
              platform: dependsBumpInfo.platform,
            };

            const verdict = computeDependsVerdict(reviewData);
            const commentBody = buildDependsReviewComment(reviewData);
            const inlineComments = buildDependsInlineComments(reviewData, prFilesForDepends);

            // The [depends] fast path can publish before the standard review executor runs.
            // Promote this review-family attempt before the first publish gate so an
            // uncontested dependency review can still emit its summary/inline output.
            setReviewWorkPhase("publish");

            let publishedDependsSummary = false;
            let publishedDependsInlineComments = false;

            // Post top-level summary comment
            if (canPublishVisibleOutput("[depends] deep review summary comment")) {
              setReviewWorkPhase("publish");
              await idempotencyOctokit.rest.issues.createComment({
                owner: apiOwner,
                repo: apiRepo,
                issue_number: pr.number,
                body: commentBody,
              });
              publishedDependsSummary = true;
            }

            // Post inline review comments (if any)
            if (
              inlineComments.length > 0
              && canPublishVisibleOutput("[depends] deep review inline comments")
            ) {
              setReviewWorkPhase("publish");
              await idempotencyOctokit.rest.pulls.createReview({
                owner: apiOwner,
                repo: apiRepo,
                pull_number: pr.number,
                event: "COMMENT",
                comments: inlineComments.map(c => ({
                  path: c.path,
                  line: c.line,
                  body: c.body,
                })),
              });
              publishedDependsInlineComments = true;
            }

            if (publishedDependsSummary || publishedDependsInlineComments) {
              logger.info({
                ...baseLog,
                gate: "depends-review-complete",
                verdict: verdict.level,
                packagesCount: dependsBumpInfo.packages.length,
                inlineCommentCount: inlineComments.length,
                hasRetrievalContext: !!dependsRetrievalContext,
              }, "[depends] deep review posted");
            }

            // 9. Determine if standard Claude review should also run
            const buildConfigPaths = ["tools/depends/", "cmake/modules/", "project/BuildDependencies/", "project/cmake/"];
            const hasSourceChanges = prFilesForDepends.some(f =>
              !buildConfigPaths.some(prefix => f.filename.startsWith(prefix)) &&
              !f.filename.toUpperCase().includes("VERSION") &&
              !f.filename.endsWith(".patch")
            );

            if (!hasSourceChanges) {
              // Pure dependency bump -- skip standard Claude review
              logger.info({ ...baseLog, gate: "depends-review-skip-standard", verdict: verdict.level }, "[depends] pure dep bump — skipping standard review");
              return;
            }

            logger.info({ ...baseLog, gate: "depends-review-continue", verdict: verdict.level, hasSourceChanges }, "[depends] source changes detected — continuing to standard review");
          } catch (err) {
            logger.warn({ ...baseLog, err, gate: "depends-pipeline" }, "[depends] pipeline failed (fail-open, falling through to standard review)");
            // Reset dependsBumpInfo so Dependabot detection can still run
            dependsBumpInfo = null;
          }
        }

        // ── Dependency bump detection (DEP-01/02/03) ──
        // Skipped when [depends] detection matched (mutual exclusivity)
        let depBumpContext: DepBumpContext | null = null;
        if (!dependsBumpInfo) {
        try {
          const detection = detectDepBump({
            prTitle: pr.title,
            prLabels: (pr.labels as Array<{ name: string }> | undefined)?.map((l) => l.name) ?? [],
            headBranch: pr.head.ref,
            senderLogin: pr.user.login,
          });
          if (detection) {
            const details = extractDepBumpDetails({
              detection,
              prTitle: pr.title,
              prBody: pr.body ?? null,
              changedFiles: allChangedFiles,
              headBranch: pr.head.ref,
            });
            const classification = classifyDepBump({
              oldVersion: details.oldVersion,
              newVersion: details.newVersion,
            });
            depBumpContext = { detection, details, classification };
            logger.info(
              {
                ...baseLog,
                gate: "dep-bump-detect",
                source: detection.source,
                signals: detection.signals,
                packageName: details.packageName,
                ecosystem: details.ecosystem,
                bumpType: classification.bumpType,
                isGroup: details.isGroup,
              },
              "Dependency bump detected",
            );
          }
        } catch (err) {
          logger.warn({ ...baseLog, err }, "Dep bump detection failed (fail-open)");
        }

        // ── Dependency bump enrichment (SEC-01/02/03, CLOG-01/02/03) ──
        if (depBumpContext && depBumpContext.details.packageName && !depBumpContext.details.isGroup) {
          try {
            const [secResult, clogResult] = await Promise.allSettled([
              fetchSecurityAdvisories({
                packageName: depBumpContext.details.packageName,
                ecosystem: depBumpContext.details.ecosystem ?? "npm",
                oldVersion: depBumpContext.details.oldVersion,
                newVersion: depBumpContext.details.newVersion,
                octokit: idempotencyOctokit,
                timeoutMs: 4000,
              }),
              fetchChangelog({
                packageName: depBumpContext.details.packageName,
                ecosystem: depBumpContext.details.ecosystem ?? "npm",
                oldVersion: depBumpContext.details.oldVersion,
                newVersion: depBumpContext.details.newVersion,
                octokit: idempotencyOctokit,
                timeoutMs: 4000,
              }),
            ]);
            depBumpContext.security = secResult.status === "fulfilled" ? secResult.value : null;
            depBumpContext.changelog = clogResult.status === "fulfilled" ? clogResult.value : null;

            logger.info({
              ...baseLog,
              gate: "dep-bump-enrich",
              hasAdvisories: (depBumpContext.security?.advisories?.length ?? 0) > 0,
              isSecurityBump: depBumpContext.security?.isSecurityBump ?? false,
              changelogSource: depBumpContext.changelog?.source ?? null,
              breakingChanges: depBumpContext.changelog?.breakingChanges?.length ?? 0,
            }, "Dep bump enrichment complete");
          } catch (err) {
            logger.warn({ ...baseLog, err, gate: "dep-bump-enrich" }, "Dep bump enrichment failed (fail-open)");
            // fail-open: depBumpContext.security and .changelog remain undefined
          }
        }

        // ── Merge confidence scoring (CONF-01/02) ──
        if (depBumpContext) {
          depBumpContext.mergeConfidence = computeMergeConfidence(depBumpContext);
          logger.info({
            ...baseLog,
            gate: "merge-confidence",
            level: depBumpContext.mergeConfidence.level,
            rationale: depBumpContext.mergeConfidence.rationale,
          }, "Merge confidence computed");
        }

        // ── Workspace usage analysis for breaking changes (DEP-04) ──
        // Fail-open: errors/timeouts never block the review.
        if (
          depBumpContext &&
          depBumpContext.details.packageName &&
          !depBumpContext.details.isGroup &&
          (depBumpContext.changelog?.breakingChanges?.length ?? 0) > 0
        ) {
          depBumpContext.usageEvidence = null;
          const packageName = depBumpContext.details.packageName;
          const breakingChangeSnippets = depBumpContext.changelog?.breakingChanges ?? [];

          try {
            const analyzer = usageAnalyzer?.analyzePackageUsage ?? analyzePackageUsage;
            const result = await analyzer({
              workspaceDir: workspace.dir,
              packageName,
              breakingChangeSnippets,
              ecosystem: depBumpContext.details.ecosystem ?? "npm",
              timeBudgetMs: 3000,
            });

            depBumpContext.usageEvidence = result;

            logger.info(
              {
                ...baseLog,
                gate: "usage-analysis",
                evidenceCount: result.evidence.length,
                timedOut: result.timedOut,
                searchTerms: result.searchTerms,
              },
              "Workspace usage analysis complete",
            );
          } catch (err) {
            depBumpContext.usageEvidence = null;
            logger.warn(
              { ...baseLog, gate: "usage-analysis", err },
              "Workspace usage analysis failed (fail-open)",
            );
          }
        }

        // ── Multi-package scope coordination (DEP-06) ──
        // Only relevant for group bumps, where Dependabot/Renovate list packages in the PR body.
        if (depBumpContext && depBumpContext.details.isGroup) {
          depBumpContext.scopeGroups = null;

          try {
            const prBody = pr.body ?? "";
            const matches = prBody.match(/@[\w-]+\/[\w.-]+/g) ?? [];
            const packageNames = Array.from(new Set(matches));

            if (packageNames.length > 0) {
              const coordinator = scopeCoordinator?.detectScopeCoordination ?? detectScopeCoordination;
              const groups = coordinator(packageNames);
              if (groups.length > 0) {
                depBumpContext.scopeGroups = groups;
                logger.info(
                  {
                    ...baseLog,
                    gate: "scope-coordination",
                    groupCount: groups.length,
                  },
                  "Scope coordination groups detected",
                );
              }
            }
          } catch (err) {
            depBumpContext.scopeGroups = null;
            logger.warn(
              { ...baseLog, gate: "scope-coordination", err },
              "Scope coordination detection failed (fail-open)",
            );
          }
        }
        } // end if (!dependsBumpInfo) -- mutual exclusivity guard

        const skipMatchers = config.review.skipPaths
          .map(normalizeSkipPattern)
          .filter((p) => p.length > 0)
          .map((p) => picomatch(p, { dot: true }));

        const changedFiles = allChangedFiles.filter((file) => {
          return !skipMatchers.some((m) => m(file));
        });

        if (changedFiles.length === 0) {
          logger.info(
            { prNumber: pr.number, totalFiles: allChangedFiles.length },
            "All changed files matched skipPaths, skipping review",
          );
          return;
        }

        let shadowSpecialistResult: ShadowSpecialistSubflowResult | undefined;
        let shadowSpecialistReviewDetailsProjection: ShadowSpecialistReviewDetailsProjection | null = null;
        let candidateVerificationContext: CandidateVerificationContext;
        const shadowSpecialistCorrelationKey = buildShadowSpecialistCorrelationKey({
          deliveryId: event.id,
          reviewOutputKey,
          prNumber: pr.number,
        });
        try {
          shadowSpecialistResult = await shadowSpecialistSubflow({
            changedPaths: changedFiles,
            diffText: diffContext.diffContent,
            diffSnippet: diffContext.diffContent,
            workspaceDir: workspace.dir,
            deliveryId: event.id,
            reviewOutputKey,
            correlationKey: shadowSpecialistCorrelationKey,
          });
          candidateVerificationContext = {
            docsConfigTruth: shadowSpecialistResult.output,
            deliveryId: event.id,
            reviewOutputKey,
            correlationKey: shadowSpecialistResult.correlationKey ?? shadowSpecialistCorrelationKey,
          };
          shadowSpecialistReviewDetailsProjection = buildShadowSpecialistReviewDetailsProjection(
            projectShadowSpecialistMetrics(shadowSpecialistResult),
          );

          const shadowLogFields = {
            ...baseLog,
            ...buildShadowSpecialistLogFields(shadowSpecialistResult),
          };
          const shadowMessage = "Shadow specialist subflow completed";
          if (shadowSpecialistResult.timeoutReason || shadowSpecialistResult.errorReason || shadowSpecialistResult.unclassifiableReason) {
            logger.warn(shadowLogFields, shadowMessage);
          } else {
            logger.info(shadowLogFields, shadowMessage);
          }
        } catch (err) {
          candidateVerificationContext = {
            docsConfigTruth: null,
            deliveryId: event.id,
            reviewOutputKey,
            correlationKey: shadowSpecialistCorrelationKey,
          };
          shadowSpecialistReviewDetailsProjection = null;
          logger.warn(
            {
              ...baseLog,
              gate: "shadow-specialist",
              laneId: "docs-config-truth",
              status: "error",
              reason: "handler-subflow-error",
              deliveryId: event.id,
              reviewOutputKey,
              correlationKey: shadowSpecialistCorrelationKey,
              err,
            },
            "Shadow specialist subflow failed before normal review; continuing fail-open",
          );
        }

        // In incremental mode, further filter to only files that changed since last review
        let reviewFiles = changedFiles;
        if (incrementalResult?.mode === "incremental" && incrementalResult.changedFilesSinceLastReview.length > 0) {
          const incrementalSet = new Set(incrementalResult.changedFilesSinceLastReview);
          reviewFiles = changedFiles.filter(f => incrementalSet.has(f));
          logger.info(
            { ...baseLog, gate: "incremental-filter", fullCount: changedFiles.length, incrementalCount: reviewFiles.length },
            "Filtered to incremental changed files",
          );
        }

        const numstatLines = diffContext.numstatLines;
        const diffContent = changedFiles.length <= 200 ? diffContext.diffContent : undefined;

        const diffAnalysis = analyzeDiff({
          changedFiles,
          numstatLines,
          diffContent,
          fileCategories: config.review.fileCategories as Record<string, string[]> | undefined,
        });

        // --- Large PR file triage (LARGE-01 through LARGE-08) ---
        // Parse per-file numstat for risk scoring
        const perFileStats = parseNumstatPerFile(numstatLines);

        // Compute risk scores for files being reviewed
        const riskScores = computeFileRiskScores({
          files: reviewFiles,
          perFileStats,
          filesByCategory: diffAnalysis.filesByCategory,
          weights: config.largePR.riskWeights,
        });

        let graphSelection = applyGraphAwareSelection({ riskScores });
        let graphBlastRadius: ReviewGraphBlastRadiusResult | null = null;
        let graphQueryBypassedForTrivialChange = false;
        let structuralImpactForReview: import("../structural-impact/types.ts").StructuralImpactPayload | null = null;
        if (reviewGraphQuery) {
          // Trivial-change bypass: skip graph query overhead for small PRs.
          const trivialCheck = isTrivialChange({
            changedFileCount: reviewFiles.length,
            totalLinesChanged: (diffAnalysis?.metrics.totalLinesAdded ?? 0) + (diffAnalysis?.metrics.totalLinesRemoved ?? 0),
          });

          if (trivialCheck.bypass) {
            graphQueryBypassedForTrivialChange = true;
            logger.info(
              { ...baseLog, gate: "graph-query-bypass", reason: trivialCheck.reason, fileCount: reviewFiles.length },
              "Trivial change detected — bypassing graph query",
            );
          } else {
            try {
              const structuralImpact = await fetchReviewStructuralImpact(
                {
                  reviewGraphQuery,
                  cache: structuralImpactCache,
                  logger,
                },
                {
                  repo: `${apiOwner}/${apiRepo}`,
                  owner: apiOwner,
                  workspaceKey: pr.head.sha,
                  baseSha: pr.base.sha,
                  headSha: pr.head.sha,
                  changedPaths: reviewFiles,
                  canonicalRef: pr.base.ref,
                  query: reviewFiles.join(" "),
                  graphLimit: Math.max(
                    config.largePR.fullReviewCount + config.largePR.abbreviatedCount,
                    20,
                  ),
                },
              );
              const structuralImpactDegradation = summarizeStructuralImpactDegradation(structuralImpact.payload);
              structuralImpactForReview = {
                ...structuralImpact.payload,
                status: structuralImpactDegradation.status,
                degradations: structuralImpactDegradation.degradations,
              };
              graphBlastRadius = structuralImpact.graphBlastRadius;
              logger.info(
                {
                  ...baseLog,
                  gate: "structural-impact",
                  status: structuralImpactForReview.status,
                  graphPresent: Boolean(structuralImpact.graphBlastRadius),
                  probableCallers: structuralImpactForReview.probableCallers.length,
                  impactedFiles: structuralImpactForReview.impactedFiles.length,
                  likelyTests: structuralImpactForReview.likelyTests.length,
                  canonicalEvidence: structuralImpactForReview.canonicalEvidence.length,
                  breakingChangeEvidenceUsed: structuralImpactForReview.probableCallers.length > 0 || structuralImpactForReview.impactedFiles.length > 0,
                  fallbackUsed: structuralImpactDegradation.fallbackUsed,
                  degradationSignals: structuralImpactDegradation.truthfulnessSignals,
                  graphAvailable: structuralImpactDegradation.availability.graphAvailable,
                  corpusAvailable: structuralImpactDegradation.availability.corpusAvailable,
                },
                "Review structural-impact payload collected",
              );
              if (graphBlastRadius) {
                graphSelection = applyGraphAwareSelection({ riskScores, graph: graphBlastRadius });
              }
            } catch (err) {
              logger.warn(
                { ...baseLog, gate: "graph-aware-selection", err },
                "Review structural-impact integration failed (fail-open, continuing with file-risk selection)",
              );
            }
          }
        }

        // Triage uses changedFiles.length (full PR size) for threshold check,
        // not reviewFiles.length (which may be filtered for incremental mode).
        // Per pitfall 3 in research: check full PR, triage review set.
        let tieredFiles = triageFilesByRisk({
          riskScores: graphSelection.riskScores,
          fileThreshold: config.largePR.fileThreshold,
          fullReviewCount: config.largePR.fullReviewCount,
          abbreviatedCount: config.largePR.abbreviatedCount,
          totalFileCount: changedFiles.length,
        });

        // Build the file list for the prompt: only full + abbreviated tier files.
        // Timeout safety may tighten these tiers below, so keep this derived list mutable.
        let promptFiles = tieredFiles.isLargePR
          ? [...tieredFiles.full.map(f => f.filePath), ...tieredFiles.abbreviated.map(f => f.filePath)]
          : reviewFiles;

        if (tieredFiles.isLargePR) {
          logger.info({
            ...baseLog,
            gate: "large-pr-triage",
            totalFiles: tieredFiles.totalFiles,
            fullReview: tieredFiles.full.length,
            abbreviated: tieredFiles.abbreviated.length,
            mentionOnly: tieredFiles.mentionOnly.length,
            threshold: config.largePR.fileThreshold,
            graphHitCount: graphSelection.graphHits,
            graphRankedSelections: graphSelection.graphRankedSelections,
            graphAwareSelectionApplied: graphSelection.usedGraph,
          }, "Large PR file triage applied");
        }

        const matchedPathInstructions = config.review.pathInstructions.length > 0
          ? matchPathInstructions(config.review.pathInstructions, changedFiles)
          : [];

        const repoDoctrineProjection = normalizeRepoDoctrineProjection(config.review.doctrine, changedFiles);
        const repoDoctrineReviewSurface = toRepoDoctrineReviewSurfaceProjection(repoDoctrineProjection);
        logger.info(
          {
            ...baseLog,
            gate: "repo-doctrine",
            gateResult: repoDoctrineReviewSurface.status,
            ...buildRepoDoctrineLogFields(repoDoctrineProjection),
          },
          "Resolved bounded repository doctrine projection",
        );

        // Prior finding dedup context (REV-02)
        let priorFindingCtx: PriorFindingContext | null = null;
        let priorFindings: PriorFinding[] = [];
        if (knowledgeStore && incrementalResult?.mode === "incremental") {
          try {
            priorFindings = await knowledgeStore.getPriorReviewFindings({
              repo: `${apiOwner}/${apiRepo}`,
              prNumber: pr.number,
            });
            if (priorFindings.length > 0) {
              priorFindingCtx = buildPriorFindingContext({
                priorFindings,
                changedFilesSinceLastReview: incrementalResult.changedFilesSinceLastReview,
              });
            }
          } catch (err) {
            logger.warn({ ...baseLog, err }, "Prior finding context failed (fail-open, no dedup)");
          }
        }

        // Retrieval context (LEARN-07) -- unified retrieval via knowledge/retrieval.ts
        let retrievalCtx: RetrievalContextForPrompt | null = null;
        const visibleReviewCacheObservations: ReviewCacheTelemetryObservation[] = [];
        const visibleContinuationCompactionObservations: ContinuationCompactionObservation[] = [];
        let visiblePromptSectionRecords: PromptSectionRecord[] = [];
        let reviewVisibleBudgetProjection: VisibleBudgetProjection | null = null;
        const refreshReviewVisibleBudgetProjection = (): VisibleBudgetProjection | null => {
          reviewVisibleBudgetProjection = buildVisibleBudgetProjectionFromEvidence({
            promptSectionRecords: visiblePromptSectionRecords,
            cacheTelemetryObservations: visibleReviewCacheObservations,
            continuationCompactionObservations: visibleContinuationCompactionObservations,
          });
          return reviewVisibleBudgetProjection;
        };
        let reviewPrecedentsForPrompt: import("../knowledge/review-comment-retrieval.ts").ReviewCommentMatch[] = [];
        let wikiKnowledgeForPrompt: import("../knowledge/wiki-retrieval.ts").WikiKnowledgeMatch[] = [];
        let unifiedResultsForPrompt: import("../knowledge/cross-corpus-rrf.ts").UnifiedRetrievalChunk[] = [];
        let contextWindowForPrompt: string | undefined;
        if (retriever) {
          try {
            const authorHint = resolveContributorExperienceRetrievalHint(
              authorClassification.contract,
            );
            const variants = buildRetrievalVariants({
              title: pr.title,
              body: pr.body ?? undefined,
              conventionalType: parsedIntent.conventionalType?.type ?? null,
              prLanguages: Object.keys(diffAnalysis.filesByLanguage ?? {}),
              riskSignals: diffAnalysis.riskSignals ?? [],
              filePaths: reviewFiles,
              authorHint: authorHint ?? undefined,
            });

            const result = await retriever.retrieve({
              repo: `${apiOwner}/${apiRepo}`,
              owner: apiOwner,
              queries: variants.map((v) => v.query),
              workspaceDir: workspace.dir,
              prLanguages: Object.keys(diffAnalysis.filesByLanguage ?? {}),
              logger,
              triggerType: "pr_review",
            });

            const retrievalCacheEvent = buildRetrievalReviewCacheEvent({
              deliveryId: event.id,
              repo: `${apiOwner}/${apiRepo}`,
              prNumber: pr.number,
              result,
            });
            visibleReviewCacheObservations.push(retrievalCacheEvent);

            if (config.telemetry.enabled) {
              try {
                const totalEmbeddingLookups = (result?.provenance?.embeddingRequests ?? 0) + (result?.provenance?.embeddingCacheHits ?? 0);
                await telemetryStore.recordRateLimitEvent({
                  deliveryId: event.id,
                  executionIdentity: `${event.id}:reuse.retrieval-query-embedding.main`,
                  repo: `${apiOwner}/${apiRepo}`,
                  prNumber: pr.number,
                  eventType: "reuse.retrieval-query-embedding.main",
                  cacheHitRate: totalEmbeddingLookups > 0
                    ? (result?.provenance?.embeddingCacheHits ?? 0) / totalEmbeddingLookups
                    : 0,
                  skippedQueries: result?.provenance?.embeddingCacheHits ?? 0,
                  retryAttempts: result?.provenance?.embeddingRequests ?? 0,
                  degradationPath: retrievalCacheEvent.reason
                    ? `${retrievalCacheEvent.status}:${retrievalCacheEvent.reason}`
                    : retrievalCacheEvent.status,
                });
              } catch (err) {
                logger.warn(
                  { ...baseLog, err },
                  "Review retrieval reuse telemetry write failed (non-blocking)",
                );
              }

              await recordReviewCacheEventFailOpen(retrievalCacheEvent);
            }

            // Capture unified cross-corpus results (KI-13/KI-17)
            if (result && result.unifiedResults && result.unifiedResults.length > 0) {
              unifiedResultsForPrompt = result.unifiedResults;
              contextWindowForPrompt = result.contextWindow;
            }

            // Capture review precedents regardless of learning memory findings
            if (result && result.reviewPrecedents.length > 0) {
              reviewPrecedentsForPrompt = result.reviewPrecedents;
            }

            // Capture wiki knowledge regardless of learning memory findings
            if (result && result.wikiKnowledge.length > 0) {
              wikiKnowledgeForPrompt = result.wikiKnowledge;
            }

            if (result && result.findings.length > 0) {
              // Retrieval quality telemetry (RET-05)
              if (config.telemetry.enabled) {
                try {
                  const resultCount = result.findings.length;
                  const avgDistance = resultCount > 0
                    ? result.findings.reduce((sum, r) => sum + (r as any).adjustedDistance, 0) / resultCount
                    : null;
                  const languageMatchRatio = resultCount > 0
                    ? result.findings.filter((r) => (r as any).languageMatch).length / resultCount
                    : null;

                  await telemetryStore.recordRetrievalQuality({
                    deliveryId: event.id,
                    repo: `${apiOwner}/${apiRepo}`,
                    prNumber: pr.number,
                    eventType: event.name,
                    topK: config.knowledge.retrieval.topK,
                    distanceThreshold: result.provenance.thresholdValue,
                    thresholdMethod: result.provenance.thresholdMethod,
                    resultCount,
                    avgDistance,
                    languageMatchRatio,
                  });
                } catch (err) {
                  logger.warn(
                    { ...baseLog, err },
                    "Retrieval quality telemetry write failed (non-blocking)",
                  );
                }
              }

              retrievalCtx = {
                maxChars: config.knowledge.retrieval.maxContextChars,
                findings: result.findings.map((finding, index) => {
                  const anchor = result.snippetAnchors[index];
                  return {
                    findingText: finding.record.findingText,
                    severity: finding.record.severity,
                    category: finding.record.category,
                    path: anchor?.path ?? finding.record.filePath,
                    line: anchor?.line,
                    snippet: anchor?.snippet,
                    outcome: finding.record.outcome,
                    distance: (finding as any).adjustedDistance ?? finding.distance,
                    sourceRepo: finding.sourceRepo,
                  };
                }),
              };
            }
          } catch (err) {
            logger.warn({ ...baseLog, err }, "Retrieval context generation failed (fail-open, proceeding without retrieval)");
          }
        }

        let resolvedSeverityMinLevel = config.review.severity.minLevel;
        let resolvedMaxComments = config.review.maxComments;
        let resolvedFocusAreas = [...config.review.focusAreas];
        let resolvedIgnoredAreas = [...config.review.ignoredAreas];

        const profileSelectionLinesChanged = Math.max(0, (pr.additions ?? 0) + (pr.deletions ?? 0));
        let profileSelection = resolveReviewProfile({
          keywordProfileOverride: parsedIntent.profileOverride,
          manualProfile: config.review.profile ?? null,
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

            logger.info(
              {
                ...baseLog,
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

        logger.info(
          {
            ...baseLog,
            gate: "review-profile-selection",
            selectedProfile: profileSelection.selectedProfile,
            source: profileSelection.source,
            linesChanged: profileSelection.linesChanged,
            autoBand: profileSelection.autoBand,
          },
          "Review profile resolved",
        );

        // TMO-01: Estimate timeout risk
        const languageComplexity = computeLanguageComplexity(
          diffAnalysis?.filesByLanguage ?? {},
        );
        const timeoutEstimate = estimateTimeoutRisk({
          fileCount: changedFiles.length,
          linesChanged: (diffAnalysis?.metrics.totalLinesAdded ?? 0) +
            (diffAnalysis?.metrics.totalLinesRemoved ?? 0),
          languageComplexity,
          isLargePR: diffAnalysis?.isLargePR ?? false,
          baseTimeoutSeconds: config.timeoutSeconds,
        });
        const appliedTimeoutBudget = config.timeout.dynamicScaling !== false
          ? timeoutEstimate
          : null;

        const diffAnalysisLinesChanged = (diffAnalysis?.metrics.totalLinesAdded ?? 0) +
          (diffAnalysis?.metrics.totalLinesRemoved ?? 0);
        const prApiLinesChanged = Math.max(0, (pr.additions ?? 0) + (pr.deletions ?? 0));
        const reviewRoutingLinesChanged = resolveReviewRoutingLineCount({
          diffLinesChanged: diffAnalysisLinesChanged,
          prApiLinesChanged,
        });
        const reviewRouting = resolveReviewTaskRouting({
          changedFileCount: changedFiles.length,
          linesChanged: reviewRoutingLinesChanged,
        });
        const reviewMaxTurnsOverride = resolveReviewMaxTurnsOverride({
          taskType: reviewRouting.taskType,
          routingMaxTurnsOverride: reviewRouting.maxTurnsOverride,
          timeoutRiskLevel: timeoutEstimate.riskLevel,
          baseMaxTurns: config.maxTurns,
          changedFiles,
        });

        logger.info(
          {
            ...baseLog,
            gate: "review-routing",
            taskType: reviewRouting.taskType,
            routingReason: reviewRouting.routingReason,
            changedFiles: changedFiles.length,
            linesChanged: reviewRoutingLinesChanged,
            diffAnalysisLinesChanged,
            prApiLinesChanged,
            maxTurns: reviewMaxTurnsOverride ?? null,
            maxTurnsSource: reviewMaxTurnsOverride !== undefined ? "dynamic-risk" : "config",
          },
          "Review routing decision",
        );

        logger.info(
          {
            ...baseLog,
            gate: "budget-estimation",
            riskLevel: timeoutEstimate.riskLevel,
            dynamicBudgetSeconds: timeoutEstimate.dynamicTimeoutSeconds,
            remoteRuntimeBudgetSeconds: timeoutEstimate.remoteRuntimeBudgetSeconds,
            infraOverheadBudgetSeconds: timeoutEstimate.infraOverheadBudgetSeconds,
            totalBudgetSeconds: timeoutEstimate.totalTimeoutSeconds,
            shouldReduceScope: timeoutEstimate.shouldReduceScope,
            complexity: sanitizeProductionLogIssueTerms(timeoutEstimate.reasoning),
          },
          "Review budget risk estimated",
        );

        const checkpointEnabled =
          reviewRouting.taskType === TASK_TYPES.REVIEW_FULL ||
          timeoutEstimate.riskLevel === "medium" ||
          timeoutEstimate.riskLevel === "high";

        // TMO-02: Scope reduction for high-risk PRs. Explicit strict profiles are
        // still bounded here because otherwise the executor can exhaust max turns
        // before publishing any result.
        const requestedProfileSelection = { ...profileSelection };
        let timeoutReductionApplied = false;
        let timeoutReductionSkippedReason: "explicit-profile" | "config-disabled" | null = null;
        if (timeoutEstimate.shouldReduceScope && config.timeout.autoReduceScope === false) {
          timeoutReductionSkippedReason = "config-disabled";
          logger.info(
            {
              ...baseLog,
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

          // Override to minimal profile.
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
          logger.info(
            {
              ...baseLog,
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
          logger.info(
            {
              ...baseLog,
              gate: "review-boundedness",
              disclosureRequired: reviewBoundedness.disclosureRequired,
              reasonCodes: reviewBoundedness.reasonCodes,
              requestedProfile: reviewBoundedness.requestedProfile.selectedProfile,
              effectiveProfile: reviewBoundedness.effectiveProfile.selectedProfile,
            },
            "Resolved bounded-review contract",
          );
        }

        const reviewPlanLinesChangedSource = diffAnalysisLinesChanged === 0 && prApiLinesChanged > 0
          ? "github-pr-api-fallback"
          : "local-diff";
        const reviewPlanGraphValidation = resolveGraphValidationPlanStatus({
          configEnabled: config.review.graphValidation.enabled,
          graphQueryAvailable: Boolean(reviewGraphQuery),
          trivialChangeBypass: graphQueryBypassedForTrivialChange,
          graphBlastRadiusAvailable: Boolean(graphBlastRadius),
        });
        let reviewPlan: ReviewPlan | DegradedReviewPlan;
        try {
          reviewPlan = reviewPlanBuilder({
            task: {
              taskType: reviewRouting.taskType,
              routingReason: reviewRouting.routingReason,
            },
            change: {
              changedFileCount: changedFiles.length,
              linesChanged: reviewRoutingLinesChanged,
              linesChangedSource: reviewPlanLinesChangedSource,
            },
            budget: {
              timeoutSeconds: appliedTimeoutBudget?.totalTimeoutSeconds ?? config.timeoutSeconds,
              maxTurns: reviewMaxTurnsOverride ?? config.maxTurns,
              maxTurnsSource: reviewMaxTurnsOverride !== undefined ? "dynamic-risk" : "config",
            },
            context: {
              sources: [
                "diff-analysis",
                ...(retrievalCtx ? ["retrieval"] : []),
                ...(matchedPathInstructions.length > 0 ? ["path-instructions"] : []),
                ...(repoDoctrineProjection.enabled ? ["repo-doctrine"] : []),
                ...(reviewBoundedness ? ["review-boundedness"] : []),
              ],
            },
            gates: {
              enabled: ["review-routing", "timeout-estimation", "review-boundedness", ...(repoDoctrineProjection.enabled ? ["repo-doctrine"] : [])],
              current: [
                "review-routing",
                "timeout-estimation",
                ...(repoDoctrineProjection.enabled ? ["repo-doctrine"] : []),
                ...(reviewBoundedness ? ["review-boundedness"] : []),
              ],
            },
            policy: {
              publish: "canonical-visible-surface",
              tools: "github-comment-tools",
              retry: "timeout-resilience",
            },
            graphValidation: reviewPlanGraphValidation,
            candidateFinding: {
              mode: "preferred",
            },
            repoDoctrine: repoDoctrineReviewSurface,
          }).plan;
          logger.info(
            {
              ...baseLog,
              gate: "review-plan",
              gateResult: "ready",
              planHash: reviewPlan.hash,
              taskType: reviewPlan.task.taskType,
              routingReason: reviewPlan.task.routingReason,
              boundedDisclosureRequired: reviewBoundedness?.disclosureRequired ?? false,
              boundedReasonCodes: reviewBoundedness?.reasonCodes ?? [],
              graphValidationStatus: reviewPlan.graphValidation.status,
              candidateFindingMode: reviewPlan.candidateFinding.mode,
              ...buildRepoDoctrineLogFields(repoDoctrineProjection),
            },
            "Review plan ready",
          );
        } catch (err) {
          reviewPlan = createDegradedReviewPlan({
            reason: "builder-error",
            message: "ReviewPlan builder failed",
            taskType: reviewRouting.taskType,
            routingReason: reviewRouting.routingReason,
          });
          logger.warn(
            {
              ...baseLog,
              gate: "review-plan",
              gateResult: "degraded",
              planHash: reviewPlan.hash,
              taskType: reviewRouting.taskType,
              routingReason: reviewRouting.routingReason,
              boundedDisclosureRequired: reviewBoundedness?.disclosureRequired ?? false,
              boundedReasonCodes: reviewBoundedness?.reasonCodes ?? [],
              graphValidationStatus: reviewPlan.graphValidation.status,
              candidateFindingMode: reviewPlan.candidateFinding.mode,
              ...buildRepoDoctrineLogFields(repoDoctrineProjection),
              error: serializeReviewPlanBuilderError(err),
            },
            "Review plan builder failed; continuing with degraded plan metadata",
          );
        }
        const reviewPlanDetailsSummary = toReviewPlanDetailsSummary(reviewPlan);
        const reviewPlanConfigSnapshot = toReviewPlanConfigSnapshot(reviewPlan);

        if (parsedIntent.styleOk && !resolvedIgnoredAreas.includes("style")) {
          resolvedIgnoredAreas.push("style");
        }

        if (parsedIntent.focusAreas.length > 0) {
          for (const area of parsedIntent.focusAreas as ReviewArea[]) {
            if (!resolvedFocusAreas.includes(area)) {
              resolvedFocusAreas.push(area);
            }
          }
        }

        logger.info(
          {
            ...baseLog,
            gate: "diff-analysis",
            totalFiles: diffAnalysis.metrics.totalFiles,
            isLargePR: diffAnalysis.isLargePR,
              riskSignals: diffAnalysis.riskSignals.length,
              matchedInstructions: matchedPathInstructions.length,
              detectedLanguages: Object.keys(diffAnalysis.filesByLanguage ?? {}).length,
              profile: config.review.profile ?? null,
              diffCollectionStrategy: diffContext.strategy,
              mergeBaseRecovered: diffContext.mergeBaseRecovered,
              diffCollectionAttempts: diffContext.deepenAttempts,
            },
            "Diff analysis and context enrichment complete",
          );

        // Extract PR labels for intent scoping (FORMAT-07)
        const prLabels = (pr.labels as Array<{ name: string }> | undefined)?.map((l) => l.name) ?? [];

        // Cluster pattern matching (CLST-03: surface recurring review patterns)
        let clusterPatternsForPrompt: ClusterPatternMatch[] = [];
        if (clusterMatcher && embeddingProvider) {
          try {
            const prText = [pr.title, pr.body ?? "", ...promptFiles.slice(0, 20)].join("\n");
            const embedResult = await embeddingProvider.generate(prText, "query");
            const prEmbedding = embedResult?.embedding ?? null;
            clusterPatternsForPrompt = await clusterMatcher({
              prEmbedding,
              prFilePaths: promptFiles,
              repo: `${apiOwner}/${apiRepo}`,
            });
            if (clusterPatternsForPrompt.length > 0) {
              logger.info(
                { ...baseLog, clusterMatches: clusterPatternsForPrompt.length },
                "Cluster patterns matched for PR review",
              );
            }
          } catch (err) {
            logger.warn({ ...baseLog, err }, "Cluster pattern matching failed (fail-open)");
          }
        }

        // PR-issue linking (PRLINK-01, PRLINK-02, PRLINK-03)
        let linkedIssueResult: LinkResult | undefined;
        if (issueStore && embeddingProvider) {
          try {
            const diffSummaryParts: string[] = [];
            if (diffAnalysis?.filesByCategory) {
              const allFiles = Object.values(diffAnalysis.filesByCategory).flat();
              if (allFiles.length > 0) {
                diffSummaryParts.push(allFiles.join(", "));
              }
            }

            linkedIssueResult = await linkPRToIssues({
              prBody: pr.body ?? "",
              prTitle: pr.title,
              commitMessages: commitMessagesForLinking,
              diffSummary: diffSummaryParts.join("\n"),
              repo: `${apiOwner}/${apiRepo}`,
              issueStore,
              embeddingProvider,
              logger,
            });

            if (
              linkedIssueResult.referencedIssues.length > 0 ||
              linkedIssueResult.semanticMatches.length > 0
            ) {
              logger.info(
                {
                  ...baseLog,
                  referencedCount: linkedIssueResult.referencedIssues.length,
                  semanticCount: linkedIssueResult.semanticMatches.length,
                },
                "PR-issue linking completed",
              );
            }
          } catch (err) {
            logger.warn({ ...baseLog, err }, "PR-issue linking failed (fail-open)");
          }
        }

        setReviewWorkPhase("prompt-build");
        // Build review prompt
        let reviewPromptDerivedCacheStatus: "hit" | "miss" | "degraded" | "bypass" = "bypass";
        let reviewPromptDerivedCacheReason: string | null = null;
        const reviewPromptBuildContext = {
          owner: apiOwner,
          repo: apiRepo,
          prNumber: pr.number,
          prTitle: pr.title,
          prBody: pr.body ?? "",
          prAuthor: pr.user.login,
          baseBranch: pr.base.ref,
          headBranch: pr.head.ref,
          changedFiles: promptFiles,
          customInstructions: config.review.prompt,
          checkpointEnabled,
          // Review mode & severity control
          mode: config.review.mode,
          severityMinLevel: resolvedSeverityMinLevel,
          focusAreas: resolvedFocusAreas,
          ignoredAreas: resolvedIgnoredAreas,
          maxComments: resolvedMaxComments,
          suppressions: config.review.suppressions,
          minConfidence: config.review.minConfidence,
          diffAnalysis,
          diffContent,
          matchedPathInstructions,
          // Incremental re-review context (REV-01)
          incrementalContext: incrementalResult?.mode === "incremental" ? {
            lastReviewedHeadSha: incrementalResult.lastReviewedHeadSha!,
            changedFilesSinceLastReview: incrementalResult.changedFilesSinceLastReview,
            unresolvedPriorFindings: priorFindingCtx?.unresolvedOnUnchangedCode ?? [],
          } : null,
          // Learning memory retrieval context (LEARN-07)
          retrievalContext: retrievalCtx,
          // Review comment precedents (KI-05/KI-06)
          reviewPrecedents: reviewPrecedentsForPrompt.length > 0 ? reviewPrecedentsForPrompt : undefined,
          wikiKnowledge: wikiKnowledgeForPrompt.length > 0 ? wikiKnowledgeForPrompt : undefined,
          // Unified cross-corpus retrieval (KI-13/KI-17)
          unifiedResults: unifiedResultsForPrompt.length > 0 ? unifiedResultsForPrompt : undefined,
          contextWindow: contextWindowForPrompt,
          // Multi-language context and localized output (LANG-01)
          filesByLanguage: diffAnalysis?.filesByLanguage,
          outputLanguage: config.review.outputLanguage,
           // PR labels for intent scoping (FORMAT-07)
           prLabels,
           // INTENT-01: Treat unrecognized bracket tags as focus hints
           focusHints: parsedIntent.unrecognized,
           conventionalType: parsedIntent.conventionalType,
           // Delta re-review context (FORMAT-14/15/16)
           deltaContext: incrementalResult?.mode === "incremental" && priorFindings.length > 0
             ? {
                 lastReviewedHeadSha: incrementalResult.lastReviewedHeadSha!,
                 changedFilesSinceLastReview: incrementalResult.changedFilesSinceLastReview,
                 priorFindings: priorFindings.map(f => ({
                   filePath: f.filePath,
                   title: f.title,
                   severity: f.severity,
                   category: f.category,
                 })),
               }
             : null,
          // Large PR file triage context (LARGE-01 through LARGE-08)
          largePRContext: tieredFiles.isLargePR ? {
            fullReviewFiles: tieredFiles.full.map(f => f.filePath),
            abbreviatedFiles: tieredFiles.abbreviated.map(f => f.filePath),
            mentionOnlyCount: tieredFiles.mentionOnly.length,
            totalFiles: tieredFiles.totalFiles,
          } : null,
          gitDiffInstructionsAvailable: false,
          publishToolNames: [
            "mcp__github_comment__create_comment",
            "mcp__github_inline_comment__create_inline_comment",
          ],
          candidateFindingToolName: "record_candidate_finding",
          candidateFindingMode: "preferred",
          contributorExperienceContract: authorClassification.contract,
          authorExpertise: authorClassification.contract.state === "profile-backed"
            ? authorClassification.expertise?.map(e => ({
              dimension: e.dimension,
              topic: e.topic,
              score: e.score,
            }))
            : undefined,
          depBumpContext,
          searchRateLimitDegradation: authorClassification.searchEnrichment,
          isDraft,
          // Review pattern clustering (CLST-03)
          clusterPatterns: clusterPatternsForPrompt.length > 0 ? clusterPatternsForPrompt : undefined,
          // PR-issue linking (PRLINK-03)
          linkedIssues: linkedIssueResult,
          // Graph-derived review context (M040/S03): inject bounded blast-radius section when available
          graphBlastRadius: graphBlastRadius ?? undefined,
          structuralImpact: structuralImpactForReview,
          reviewBoundedness,
          repoDoctrine: repoDoctrineProjection,
          smallDiffReview: reviewRouting.taskType === TASK_TYPES.REVIEW_SMALL_DIFF,
        } satisfies ReviewPromptBuildContext;
        const reviewPromptCacheState: ReviewPromptCacheState = {
          status: reviewPromptDerivedCacheStatus,
          reason: reviewPromptDerivedCacheReason,
        };
        const reviewPromptResult = await buildReviewPromptResultWithCache({
          cacheQuery: `initial:${pr.number}:${pr.head.sha ?? "unknown-head-sha"}`,
          context: reviewPromptBuildContext,
          statusTarget: reviewPromptCacheState,
        });
        reviewPromptDerivedCacheStatus = reviewPromptCacheState.status;
        reviewPromptDerivedCacheReason = reviewPromptCacheState.reason;
        const reviewPrompt = reviewPromptResult.text;
        const reviewPromptSections = [
          buildPromptSectionRecord({
            deliveryId: event.id,
            repo: `${apiOwner}/${apiRepo}`,
            taskType: reviewRouting.taskType,
            promptKind: "review.user-prompt",
            sections: reviewPromptResult.sections,
          }),
        ];
        visiblePromptSectionRecords = reviewPromptSections;
        logger.info(
          {
            ...baseLog,
            gate: "review-derived-prompt-cache",
            gateResult: reviewPromptDerivedCacheStatus,
            ...(reviewPromptDerivedCacheReason ? { reason: reviewPromptDerivedCacheReason } : {}),
          },
          "Resolved review prompt derived-cache state",
        );
        const reviewPromptCacheEvent = buildPromptReviewCacheEvent({
          deliveryId: event.id,
          repo: `${apiOwner}/${apiRepo}`,
          prNumber: pr.number,
          state: reviewPromptCacheState,
        });
        visibleReviewCacheObservations.push(reviewPromptCacheEvent);
        refreshReviewVisibleBudgetProjection();
        if (config.telemetry.enabled) {
          await recordReviewCacheEventFailOpen(reviewPromptCacheEvent);
        }
        reviewPhaseTimings.set(
          "retrieval/context assembly",
          createReviewPhaseTiming({
            name: "retrieval/context assembly",
            status: "completed",
            durationMs: Math.max(0, Date.now() - (retrievalPhaseStartedAt ?? Date.now())),
          }),
        );

        // Execute review via Claude
        setReviewWorkPhase("executor-dispatch");
        const result = await executor.execute({
          workspace,
          installationId: event.installationId,
          owner: apiOwner,
          repo: apiRepo,
          prNumber: pr.number,
          commentId: undefined,
          botHandles: [githubApp.getAppSlug(), "claude"],
          eventType: `pull_request.${payload.action}`,
          taskType: reviewRouting.taskType,
          triggerBody: reviewPrompt,
          prompt: reviewPrompt,
          promptSections: reviewPromptSections,
          reviewOutputKey,
          deliveryId: event.id,
          candidateVerificationContext,
          knowledgeStore,
          totalFiles: changedFiles.length,
          enableCheckpointTool: checkpointEnabled,
          enableCandidateFindingTool: true,
          prDiffForCommentValidation: diffContext.diffContent,
          // TMO-04: total timeout = infra overhead cushion + complexity-scaled remote runtime budget
          dynamicTimeoutSeconds: appliedTimeoutBudget
            ? appliedTimeoutBudget.totalTimeoutSeconds
            : undefined,
          maxTurnsOverride: reviewMaxTurnsOverride,
        });
        executorResult = result;
        reviewExecutorPublished = result.published ?? false;
        reviewOutputPublished = result.published ?? false;
        reviewPublishResolution = reviewOutputPublished ? "executor" : "none";
        visiblePromptSectionRecords = result.promptSections ?? visiblePromptSectionRecords;
        refreshReviewVisibleBudgetProjection();
        executorPhaseTimings = result.executorPhaseTimings ?? buildExecutorUnavailablePhases(
          "executor phase timings unavailable",
        );
        for (const phase of executorPhaseTimings) {
          reviewPhaseTimings.set(phase.name, phase);
        }
        publicationPhaseStartedAt = Date.now();

        if (result.candidateVerificationPublicationEvidence) {
          logger.info(
            {
              ...baseLog,
              ...buildCandidateVerificationPublicationEvidenceLogFields(result.candidateVerificationPublicationEvidence),
            },
            "Captured aggregate M070 candidate-verification publication evidence",
          );
        }
        let reviewCandidateVerificationPublicationEvidence = result.candidateVerificationPublicationEvidence;

        let handlerCandidatePublicationBridge: ReviewHandlerPublicationBridgeProjection;
        try {
          handlerCandidatePublicationBridge = projectReviewHandlerCandidatePublicationBridgeEvidence({
            evidenceSummary: result.candidateVerificationPublicationEvidence,
            deliveryId: event.id,
            reviewOutputKey,
            upstreamCorrelationKey: candidateVerificationContext.correlationKey,
          });
        } catch (err) {
          handlerCandidatePublicationBridge = projectReviewHandlerCandidatePublicationBridgeEvidence({
            evidenceSummary: null,
            deliveryId: event.id,
            reviewOutputKey,
            upstreamCorrelationKey: candidateVerificationContext.correlationKey,
          });
          logger.warn(
            {
              ...baseLog,
              gate: "m072-review-handler-publication-bridge",
              gateResult: "degraded",
              reason: "projection-exception",
              err,
              ...handlerCandidatePublicationBridge.logFields,
            },
            "Review handler candidate-publication bridge projection failed; using bounded degraded evidence",
          );
        }
        logger.info(
          {
            ...baseLog,
            gate: "m072-review-handler-publication-bridge",
            ...handlerCandidatePublicationBridge.logFields,
          },
          "Projected review handler candidate-publication bridge evidence",
        );

        const reviewCandidateFindingResult = resolveReviewCandidateFindingResult({
          candidateFinding: result.candidateFinding,
          repo: `${apiOwner}/${apiRepo}`,
          pullNumber: pr.number,
          reviewOutputKey,
          deliveryId: event.id,
        });
        const reviewCandidateFindingDetailsSummary: ReviewCandidateFindingDetailsSummary =
          toReviewCandidateFindingDetailsSummary(reviewCandidateFindingResult);
        const reviewCandidateFindingConfigSnapshot =
          toReviewCandidateFindingSafeSnapshot(reviewCandidateFindingResult);
        logReviewCandidateFindingResult({
          logger,
          baseLog,
          result: reviewCandidateFindingResult,
        });

        const extractionOctokit = await githubApp.getInstallationOctokit(event.installationId);
        const shouldProcessReviewOutput = result.conclusion === "success";
        const extractedFindings = shouldProcessReviewOutput
          ? await extractFindingsFromReviewComments({
            octokit: extractionOctokit,
            owner: apiOwner,
            repo: apiRepo,
            prNumber: pr.number,
            reviewOutputKey,
            logger,
            baseLog,
          })
          : [];

        // Feedback-driven suppression (FEED-01 through FEED-10)
        // Evaluated once and passed into the reducer so publication/deletion side effects remain outside.
        const feedbackSuppression = knowledgeStore
          ? await evaluateFeedbackSuppressions({
              store: knowledgeStore,
              repo: `${apiOwner}/${apiRepo}`,
              config: config.feedback.autoSuppress,
              logger,
            })
          : { suppressedFingerprints: new Set<string>(), suppressedPatternCount: 0, patterns: [] };

        const graphValidationLLM = graphBlastRadius && config.review.graphValidation.enabled
          ? {
              generate: async (prompt: string, system: string): Promise<string> => {
                const { createTaskRouter } = await import("../llm/task-router.ts");
                const { TASK_TYPES } = await import("../llm/task-types.ts");
                const { generateWithFallback } = await import("../llm/generate.ts");
                const taskRouter = createTaskRouter({ models: {} });
                const resolved = taskRouter.resolve(TASK_TYPES.GUARDRAIL_CLASSIFICATION);
                const genResult = await generateWithFallback({
                  taskType: TASK_TYPES.GUARDRAIL_CLASSIFICATION,
                  resolved,
                  system,
                  prompt,
                  logger,
                  repo: `${apiOwner}/${apiRepo}`,
                  deliveryId: event.id,
                });
                return genResult.text;
              },
            }
          : null;

        const candidateReducerFindings = toReviewCandidateReducerDrafts(reviewCandidateFindingResult);
        const reviewReducerInput: ReviewReducerInput = {
          findings: [
            ...(extractedFindings as unknown as ProcessedReviewFinding[]),
            ...candidateReducerFindings,
          ],
          workspaceDir: workspace.dir,
          filesByCategory: diffAnalysis?.filesByCategory ?? {},
          filesByLanguage: diffAnalysis?.filesByLanguage ?? {},
          languageRules: config.languageRules,
          reviewSuppressions: config.review.suppressions,
          minConfidence: config.review.minConfidence,
          prioritizationWeights: config.review.prioritization,
          feedbackSuppression,
          priorFindingContext: priorFindingCtx,
          diffContent: diffContext.diffContent,
          prBody: pr.body ?? null,
          commitMessages: commitMessagesForLinking,
          tieredFiles,
          graphBlastRadius,
          graphValidationEnabled: config.review.graphValidation.enabled,
          riskScores,
          resolvedMaxComments,
          logger,
          baseLog,
          repo: `${apiOwner}/${apiRepo}`,
          clusterModelStore: clusterModelStore ?? null,
          embeddingProvider: embeddingProvider ?? null,
          guardrailAuditStore,
          guardrailStrictness: config.guardrails?.strictness ?? "standard",
          graphValidationLLM,
          repoDoctrine: repoDoctrineReviewSurface,
        };

        let reducerResult: ReviewReducerResult;
        try {
          const candidateReducerResult = await reviewReducer(reviewReducerInput);
          if (!isTrustedReviewReducerResult(candidateReducerResult)) {
            throw new Error("malformed-review-reducer-result");
          }
          reducerResult = candidateReducerResult;
        } catch (err) {
          logger.warn(
            { ...baseLog, gate: "review-reducer", gateResult: "degraded", reason: "reducer-exception", err },
            "Review reducer failed unexpectedly (fail-open, destructive cleanup disabled)",
          );
          reducerResult = createDegradedReviewReducerResult({
            findings: reviewReducerInput.findings,
            reason: "reducer-exception",
          });
        }
        logReviewReducerResult({
          logger,
          baseLog,
          reducerResult,
          graphValidationEnabled: config.review.graphValidation.enabled,
        });

        const directFallbackAllowed = reviewCandidateFindingResult.status !== "shadow"
          || reviewCandidateFindingResult.counts.recorded === 0;
        const directPublicationAttempted = result.published === true || extractedFindings.length > 0;
        const reviewCandidateApprovalResult: ReviewCandidateApprovalResult = coordinateReviewCandidateApproval({
          candidates: reviewCandidateFindingResult,
          reducer: reducerResult,
          fallbackPolicy: {
            allowDirectFallback: directFallbackAllowed,
            attemptedDirectFallback: directPublicationAttempted,
          },
          minConfidence: config.review.minConfidence,
        });
        const reviewCandidatePublicationAdapter: ReviewCandidatePublicationAdapterResult =
          adaptApprovedCandidatesForInlinePublication({
            approval: reviewCandidateApprovalResult,
            reducer: reducerResult,
            prDiffText: diffContext.diffContent,
            maxFixSuggestions: resolvedMaxComments,
            logger,
          });

        const candidatePublisherResults = new Map<string, InlineReviewPublicationResult>();
        const handlerCandidateVerificationPublicationEvidenceCollector = createCandidateVerificationPublicationEvidenceCollector(
          (summary) => {
            reviewCandidateVerificationPublicationEvidence = summary;
          },
        );
        if (reviewCandidatePublicationAdapter.payloads.length > 0) {
          if (canPublishVisibleOutput("candidate-approved inline review comments")) {
            for (const payload of reviewCandidatePublicationAdapter.payloads) {
              const candidateReviewOutputKey = buildCandidateReviewOutputKey(reviewOutputKey, payload.candidateFingerprint);
              const candidatePublisher = createInlineReviewPublisher({
                getOctokit: async () => extractionOctokit,
                owner: apiOwner,
                repo: apiRepo,
                prNumber: pr.number,
                botHandles: [githubApp.getAppSlug(), "claude"],
                reviewOutputKey: candidateReviewOutputKey,
                deliveryId: event.id,
                logger,
                publicationGate: createReviewOutputPublicationGate({
                  owner: apiOwner,
                  repo: apiRepo,
                  prNumber: pr.number,
                  reviewOutputKey: candidateReviewOutputKey,
                  candidateVerificationContext,
                  candidateVerificationPublicationEvidenceSink: (_summary, event) => {
                    handlerCandidateVerificationPublicationEvidenceCollector.record(event);
                  },
                }),
                prDiffForCommentValidation: diffContext.diffContent,
              });
              const publishResult = await candidatePublisher.publish(payload.publication);
              candidatePublisherResults.set(payload.candidateFingerprint, publishResult);
            }
          } else {
            for (const payload of reviewCandidatePublicationAdapter.payloads) {
              candidatePublisherResults.set(payload.candidateFingerprint, {
                status: "blocked",
                reason: "publication-failed",
                content: [{ type: "text", text: "Candidate publication skipped because review publish rights were superseded." }],
                isError: true,
              });
            }
          }
        }

        const reviewCandidatePublishedFindings: ReviewCandidatePublishedFindingResult =
          convertPublishedCandidateResultsToProcessedFindings({
            payloads: reviewCandidatePublicationAdapter.payloads,
            results: candidatePublisherResults,
          });
        const reviewCandidatePublicationRuntime = classifyReviewCandidatePublicationRuntime({
          approval: reviewCandidateApprovalResult,
          adapter: reviewCandidatePublicationAdapter.summary,
          publisher: reviewCandidatePublishedFindings.summary,
          convertedProcessedFindingCount: reviewCandidatePublishedFindings.findings.length,
          directPublication: {
            attempted: directPublicationAttempted,
            allowed: directFallbackAllowed,
            published: directPublicationAttempted ? Math.max(extractedFindings.length, result.published ? 1 : 0) : 0,
            reason: directFallbackAllowed ? "direct-fallback-audited" : "direct-fallback-disallowed",
          },
        });
        const reviewCandidatePublicationFlow = createCandidatePublicationFlowEvidence({
          payloadFingerprints: reviewCandidatePublicationAdapter.payloads.map((payload) => payload.candidateFingerprint),
          publisher: reviewCandidatePublishedFindings.summary,
        });
        logReviewCandidatePublicationRuntime({
          logger,
          baseLog,
          runtime: reviewCandidatePublicationRuntime,
        });

        const directProcessedFindings = (reducerResult.findings as ProcessedReviewFinding[])
          .filter((finding) => !isCandidatePublicationDraft(finding));
        const directVisibleFindings = (reducerResult.visibleFindings as ProcessedReviewFinding[])
          .filter((finding) => !isCandidatePublicationDraft(finding));
        const directLowConfidenceFindings = (reducerResult.lowConfidenceFindings as ProcessedReviewFinding[])
          .filter((finding) => !isCandidatePublicationDraft(finding));
        const directFilteredInlineFindings = (reducerResult.filteredInlineFindings as ProcessedReviewFinding[])
          .filter((finding) => !isCandidatePublicationDraft(finding));
        const processedFindings = mergeCandidatePublishedFindings(
          directProcessedFindings,
          reviewCandidatePublishedFindings.findings,
        ) as ProcessedFinding[];
        const visibleFindings = mergeCandidatePublishedFindings(
          directVisibleFindings,
          reviewCandidatePublishedFindings.findings,
        ) as ProcessedFinding[];
        const lowConfidenceFindings = directLowConfidenceFindings as ProcessedFinding[];
        const filteredInlineFindings = directFilteredInlineFindings as ProcessedFinding[];
        const suppressionMatchCounts = reducerResult.suppressionMatchCounts;
        const filterResult = { filtered: reducerResult.filterRecords };
        const prioritizationStats = reducerResult.prioritizationStats;
        const reviewReducerDetailsSummary = reducerResult.detailsSummary;
        const reviewCandidatePublicationAdapterDetailsSummary =
          toReviewCandidatePublicationAdapterSummary(reviewCandidatePublicationAdapter.summary);
        const reviewFindingLifecycleResult: AttachReviewFindingLifecycleResult = attachReviewFindingLifecycle({
          source: "automatic",
          trigger: "pull_request",
          correlation: {
            repo: `${apiOwner}/${apiRepo}`,
            pullNumber: pr.number,
            reviewOutputKey,
            deliveryId: event.id,
            commitSha: pr.head.sha,
            headSha: pr.head.sha,
            baseSha: pr.base.sha,
            headRef: pr.head.ref,
            baseRef: pr.base.ref,
          },
          findings: processedFindings,
          candidateFinding: reviewCandidateFindingResult,
        });
        logger.info(
          {
            ...baseLog,
            ...reviewFindingLifecycleResult.logEvidence,
            source: "automatic-review",
          },
          "Projected review finding lifecycle evidence",
        );
        let reviewValidationTruthProjection: AttachReviewValidationTruthResult["projection"] | null = null;
        try {
          const reviewValidationTruth = attachReviewValidationTruth({
            lifecycle: reviewFindingLifecycleResult.lifecycle,
            correlation: {
              repo: `${apiOwner}/${apiRepo}`,
              pullNumber: pr.number,
              reviewOutputKey,
              deliveryId: event.id,
              commitSha: pr.head.sha,
              headSha: pr.head.sha,
              baseSha: pr.base.sha,
              headRef: pr.head.ref,
              baseRef: pr.base.ref,
            },
            publicationFixes: convertPublishedCandidateResultsToValidationTruthFixes({
              payloads: reviewCandidatePublicationAdapter.payloads,
              results: candidatePublisherResults,
              reviewOutputKey,
              deliveryId: event.id,
            }),
            requireRevalidation: true,
          });
          reviewValidationTruthProjection = reviewValidationTruth.projection;
          logger.info(
            {
              ...baseLog,
              ...reviewValidationTruth.logEvidence,
              gateResult: reviewValidationTruth.status,
              source: "automatic-review",
            },
            "Projected review validation truth evidence",
          );
        } catch (err) {
          try {
            logger.warn(
              {
                ...baseLog,
                err,
                gate: "review-validation-truth",
                gateResult: "degraded",
                reviewOutputKey,
                deliveryId: event.id,
              },
              "Review validation truth diagnostics failed; continuing review publication",
            );
          } catch {
            // Diagnostics are fail-open for review execution and must not block publication.
          }
        }
        logger.info(
          {
            ...baseLog,
            gate: "review-fix-eligibility",
            gateResult: reviewCandidatePublicationAdapter.summary.fixEligibility.status,
            reviewOutputKey,
            deliveryId: event.id,
            counts: reviewCandidatePublicationAdapter.summary.fixEligibility.counts,
            reasonCounts: reviewCandidatePublicationAdapter.summary.fixEligibility.reasonCounts,
            omittedReasonCounts: reviewCandidatePublicationAdapter.summary.fixEligibility.omittedReasonCounts,
            redaction: reviewCandidatePublicationAdapter.summary.fixEligibility.redaction,
          },
          "Review fix eligibility summarized",
        );
        logger.info(
          {
            ...baseLog,
            gate: "review-candidate-publication-adapter",
            gateResult: reviewCandidatePublicationAdapter.summary.counts.publishable > 0 ? "publishable" : "skipped",
            counts: reviewCandidatePublicationAdapter.summary.counts,
            skipped: reviewCandidatePublicationAdapter.summary.skipped,
            payloadFingerprints: reviewCandidatePublicationAdapter.summary.fingerprints,
            fixEligibility: reviewCandidatePublicationAdapter.summary.fixEligibility,
            details: reviewCandidatePublicationAdapterDetailsSummary.text,
          },
          "Review candidate publication adapter summarized",
        );

        // Delta classification (REV-03)
        // Only classify deltas in incremental mode when prior findings exist.
        let deltaClassification: DeltaClassification | null = null;
        if (incrementalResult?.mode === "incremental" && priorFindingCtx) {
          try {
            const priorFindings = await knowledgeStore!.getPriorReviewFindings({
              repo: `${apiOwner}/${apiRepo}`,
              prNumber: pr.number,
            });
            if (priorFindings.length > 0) {
              deltaClassification = classifyFindingDeltas({
                currentFindings: processedFindings,
                priorFindings,
                fingerprintFn: fingerprintFindingTitle,
              });
            }
          } catch (err) {
            logger.warn(
              { ...baseLog, err },
              "Delta classification failed (fail-open, publishing without delta labels)",
            );
          }
        }

        const suppressedStillOpen = processedFindings.filter(f =>
          f.suppressed && priorFindingCtx?.suppressionFingerprints.has(
            `${f.filePath}:${fingerprintFindingTitle(f.title)}`
          )
        ).length;

        if (shouldProcessReviewOutput && filteredInlineFindings.length > 0) {
          await removeFilteredInlineComments({
            octokit: extractionOctokit,
            owner: apiOwner,
            repo: apiRepo,
            findings: filteredInlineFindings,
            logger,
            baseLog,
          });
        }

        const findingCounts = {
          critical: processedFindings.filter((finding) => finding.severity === "critical").length,
          major: processedFindings.filter((finding) => finding.severity === "major").length,
          medium: processedFindings.filter((finding) => finding.severity === "medium").length,
          minor: processedFindings.filter((finding) => finding.severity === "minor").length,
        };
        const suppressionsApplied = processedFindings.filter((finding) => finding.suppressed).length;
        const reviewDetailsLineCounts = resolveReviewDetailsLineCounts({
          diffLinesAdded: diffAnalysis?.metrics.totalLinesAdded ?? 0,
          diffLinesRemoved: diffAnalysis?.metrics.totalLinesRemoved ?? 0,
          prApiLinesAdded: pr.additions ?? 0,
          prApiLinesRemoved: pr.deletions ?? 0,
        });
        const linesChanged = reviewDetailsLineCounts.linesAdded + reviewDetailsLineCounts.linesRemoved;

        const reviewCompletedAt = new Date().toISOString();
        let canonicalReviewDetailsBody: string | null = null;
        const buildReviewDetailsBody = (params?: {
          timeoutProgress?: TimeoutReviewDetailsProgress;
          reviewFirstPass?: ReviewFirstPassPayload | null;
          timeoutBudget?: TimeoutBudgetDetails | null;
        }): string => {
          const visibleBudgetProjection = refreshReviewVisibleBudgetProjection();
          const reviewDetailsBody = appendReviewDetailsBudgetLines(formatReviewDetailsSummary({
            reviewOutputKey,
            filesReviewed: diffAnalysis?.metrics.totalFiles ?? changedFiles.length,
            linesAdded: reviewDetailsLineCounts.linesAdded,
            linesRemoved: reviewDetailsLineCounts.linesRemoved,
            findingCounts,
            largePRTriage: tieredFiles.isLargePR ? {
              fullCount: tieredFiles.full.length,
              abbreviatedCount: tieredFiles.abbreviated.length,
              mentionOnlyFiles: tieredFiles.mentionOnly.map((f) => ({ filePath: f.filePath, score: f.score })),
              totalFiles: tieredFiles.totalFiles,
            } : undefined,
            reviewBoundedness,
            reviewFirstPass: params?.reviewFirstPass,
            feedbackSuppressionCount: feedbackSuppression.suppressedPatternCount,
            keywordParsing: parsedIntent,
            profileSelection,
            contributorExperience: authorClassification.contract.reviewDetails,
            shadowSpecialistReviewDetails: shadowSpecialistReviewDetailsProjection,
            candidatePublicationBridge: handlerCandidatePublicationBridge.reviewDetails,
            candidateVerificationPublicationEvidence: reviewCandidateVerificationPublicationEvidence,
            prioritization: prioritizationStats,
            usageLimit: result.usageLimit,
            tokenUsage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens, costUsd: result.costUsd },
            structuralImpact: structuralImpactForReview,
            reviewPlan: reviewPlanDetailsSummary,
            reviewReducer: reviewReducerDetailsSummary,
            reviewCandidateFinding: reviewCandidateFindingDetailsSummary,
            reviewCandidatePublication: reviewCandidatePublicationRuntime.detailsSummary,
            reviewFindingLifecycle: reviewFindingLifecycleResult.projection,
            reviewValidationTruth: reviewValidationTruthProjection,
            phaseTimingSummary: buildReviewDetailsPhaseTimingSummary({
              phases: reviewPhaseTimings,
              publicationPhaseStartedAt,
              totalPhaseStartAt,
            }),
            timeoutProgress: params?.timeoutProgress,
            timeoutBudget: params?.timeoutBudget,
            lineCountSource: reviewDetailsLineCounts.source,
          }), visibleBudgetProjection);

          const suppressedSection = formatSuppressedFindingsSection(filterResult.filtered);
          return suppressedSection
            ? `${reviewDetailsBody}\n\n${suppressedSection}`
            : reviewDetailsBody;
        };

        const finalizePublicationPhaseTiming = (): void => {
          if (publicationPhaseStartedAt === undefined) {
            return;
          }

          reviewPhaseTimings.set(
            "publication",
            createReviewPhaseTiming({
              name: "publication",
              status: "completed",
              durationMs: Math.max(0, Date.now() - publicationPhaseStartedAt),
            }),
          );
        };

        const logReviewDetailsPublicationCompleted = (params: {
          surfaceKind: CanonicalSurfaceKind;
          commentId?: number;
          reviewId?: number;
          publicationMode: "canonical" | "degraded-fallback";
        }): void => {
          logger.info(
            {
              ...baseLog,
              gate: "review-details-output",
              gateResult: "completed",
              reviewOutputKey,
              deliveryId: event.id,
              reviewDetailsPublished: true,
              publicationMode: params.publicationMode,
              surfaceKind: params.surfaceKind,
              hasCommentId: typeof params.commentId === "number",
              hasReviewId: typeof params.reviewId === "number",
              ...buildRepoDoctrineLogFields(repoDoctrineProjection),
            },
            "Review Details publication completed",
          );
        };

        const logCanonicalReviewDetailsPublicationCompleted = (
          surface: CanonicalReviewSurface | undefined,
          publicationMode: "canonical" | "degraded-fallback" = "canonical",
        ): void => {
          if (!surface) {
            return;
          }
          logReviewDetailsPublicationCompleted({
            surfaceKind: surface.kind,
            ...(surface.kind === "issue_comment" ? { commentId: surface.commentId } : { reviewId: surface.reviewId }),
            publicationMode,
          });
        };

        if (shouldProcessReviewOutput) {
          logger.info(
            {
              ...baseLog,
              gate: "review-details-output",
              gateResult: "attempt",
              reviewOutputKey,
              deltaNew: deltaClassification?.counts.new ?? null,
              deltaResolved: deltaClassification?.counts.resolved ?? null,
              deltaStillOpen: deltaClassification?.counts.stillOpen ?? null,
              provenanceCount: retrievalCtx?.findings.length ?? null,
            },
            "Attempting canonical Review Details publication",
          );

          try {
            const fullDetailsBody = buildReviewDetailsBody();
            canonicalReviewDetailsBody = fullDetailsBody;

            if (result.published) {
              if (canPublishVisibleOutput("canonical Review Details merge")) {
                let canonicalIssueComment: CanonicalReviewSurface | undefined;
                try {
                  setReviewWorkPhase("publish");
                  canonicalIssueComment = await upsertCanonicalReviewSurface({
                    octokit: extractionOctokit,
                    owner: apiOwner,
                    repo: apiRepo,
                    prNumber: pr.number,
                    reviewOutputKey,
                    preferredKind: "issue_comment",
                    canonicalSurface: acceptedCanonicalSurface?.kind === "issue_comment"
                      ? acceptedCanonicalSurface
                      : undefined,
                    reviewDetailsBlock: fullDetailsBody,
                    botHandles: [githubApp.getAppSlug(), "claude"],
                    requireDegradationDisclosure: authorClassification.searchEnrichment.degraded,
                    reviewBoundedness,
                    recheckCanPublish: () =>
                      canPublishVisibleOutput("canonical Review Details merge"),
                  });
                  logCanonicalReviewDetailsPublicationCompleted(canonicalIssueComment);
                } catch (appendErr) {
                  logger.warn(
                    { ...baseLog, gate: "review-details-output", gateResult: "degraded-fallback", err: appendErr },
                    "Failed to update canonical review surface with Review Details; using degraded fallback comment",
                  );
                  if (canPublishVisibleOutput("degraded Review Details fallback comment")) {
                    setReviewWorkPhase("publish");
                    const fallbackCommentId = await upsertDegradedReviewDetailsFallbackComment({
                      octokit: extractionOctokit,
                      owner: apiOwner,
                      repo: apiRepo,
                      prNumber: pr.number,
                      reviewOutputKey,
                      body: fullDetailsBody,
                      botHandles: [githubApp.getAppSlug(), "claude"],
                      recheckCanPublish: () =>
                        canPublishVisibleOutput("degraded Review Details fallback comment"),
                    });
                    if (typeof fallbackCommentId === "number") {
                      logReviewDetailsPublicationCompleted({
                        surfaceKind: "issue_comment",
                        commentId: fallbackCommentId,
                        publicationMode: "degraded-fallback",
                      });
                    }
                  }
                }

                if (canonicalIssueComment?.kind === "issue_comment") {
                  finalizePublicationPhaseTiming();
                  try {
                    await upsertCanonicalReviewSurface({
                      octokit: extractionOctokit,
                      owner: apiOwner,
                      repo: apiRepo,
                      prNumber: pr.number,
                      reviewOutputKey,
                      preferredKind: "issue_comment",
                      canonicalSurface: canonicalIssueComment,
                      reviewDetailsBlock: buildReviewDetailsBody(),
                      botHandles: [githubApp.getAppSlug(), "claude"],
                      summaryBody: canonicalIssueComment.body,
                      requireDegradationDisclosure: authorClassification.searchEnrichment.degraded,
                      reviewBoundedness,
                      recheckCanPublish: () =>
                        canPublishVisibleOutput("finalized canonical Review Details merge"),
                    });
                  } catch (appendErr) {
                    logger.warn(
                      {
                        ...baseLog,
                        gate: "review-details-output",
                        gateResult: "finalized-canonical-merge-failed",
                        err: appendErr,
                      },
                      "Failed to refresh finalized canonical Review Details surface",
                    );
                  }
                }
              }
            } else {
              const hasMovedToDetailsFindings = reviewCandidatePublicationRuntime.counts.candidateMovedToDetails > 0;
              const approvalWillOwnCanonicalSurface = result.conclusion === "success" && !hasMovedToDetailsFindings;

              if (hasMovedToDetailsFindings && canPublishVisibleOutput("canonical Review Details moved-to-details preservation")) {
                let movedDetailsSurface: CanonicalReviewSurface | undefined;
                try {
                  setReviewWorkPhase("publish");
                  movedDetailsSurface = await upsertCanonicalReviewSurface({
                    octokit: extractionOctokit,
                    owner: apiOwner,
                    repo: apiRepo,
                    prNumber: pr.number,
                    reviewOutputKey,
                    preferredKind: "issue_comment",
                    canonicalSurface: acceptedCanonicalSurface?.kind === "issue_comment"
                      ? acceptedCanonicalSurface
                      : undefined,
                    body: fullDetailsBody,
                    botHandles: [githubApp.getAppSlug(), "claude"],
                    requireDegradationDisclosure: authorClassification.searchEnrichment.degraded,
                    reviewBoundedness,
                    recheckCanPublish: () =>
                      canPublishVisibleOutput("canonical Review Details moved-to-details preservation"),
                  });
                  logCanonicalReviewDetailsPublicationCompleted(movedDetailsSurface);
                } catch (appendErr) {
                  logger.warn(
                    { ...baseLog, gate: "review-details-output", gateResult: "moved-to-details-canonical-merge-failed", err: appendErr },
                    "Failed to publish canonical Review Details for moved-to-details candidates; using degraded fallback comment",
                  );
                  if (canPublishVisibleOutput("degraded Review Details moved-to-details fallback comment")) {
                    setReviewWorkPhase("publish");
                    const fallbackCommentId = await upsertDegradedReviewDetailsFallbackComment({
                      octokit: extractionOctokit,
                      owner: apiOwner,
                      repo: apiRepo,
                      prNumber: pr.number,
                      reviewOutputKey,
                      body: fullDetailsBody,
                      botHandles: [githubApp.getAppSlug(), "claude"],
                      recheckCanPublish: () =>
                        canPublishVisibleOutput("degraded Review Details moved-to-details fallback comment"),
                    });
                    if (typeof fallbackCommentId === "number") {
                      logReviewDetailsPublicationCompleted({
                        surfaceKind: "issue_comment",
                        commentId: fallbackCommentId,
                        publicationMode: "degraded-fallback",
                      });
                    }
                  }
                }

                if (movedDetailsSurface?.kind === "issue_comment") {
                  finalizePublicationPhaseTiming();
                  try {
                    await upsertCanonicalReviewSurface({
                      octokit: extractionOctokit,
                      owner: apiOwner,
                      repo: apiRepo,
                      prNumber: pr.number,
                      reviewOutputKey,
                      preferredKind: "issue_comment",
                      canonicalSurface: movedDetailsSurface,
                      body: buildReviewDetailsBody(),
                      botHandles: [githubApp.getAppSlug(), "claude"],
                      requireDegradationDisclosure: authorClassification.searchEnrichment.degraded,
                      reviewBoundedness,
                      recheckCanPublish: () =>
                        canPublishVisibleOutput("finalized moved-to-details Review Details timing update"),
                    });
                  } catch (appendErr) {
                    logger.warn(
                      {
                        ...baseLog,
                        gate: "review-details-output",
                        gateResult: "finalized-moved-to-details-merge-failed",
                        err: appendErr,
                      },
                      "Failed to refresh finalized moved-to-details Review Details surface",
                    );
                  }
                }
              } else if (!approvalWillOwnCanonicalSurface && canPublishVisibleOutput("degraded Review Details fallback comment")) {
                setReviewWorkPhase("publish");
                const reviewDetailsCommentId = await upsertDegradedReviewDetailsFallbackComment({
                  octokit: extractionOctokit,
                  owner: apiOwner,
                  repo: apiRepo,
                  prNumber: pr.number,
                  reviewOutputKey,
                  body: fullDetailsBody,
                  botHandles: [githubApp.getAppSlug(), "claude"],
                  recheckCanPublish: () =>
                    canPublishVisibleOutput("degraded Review Details fallback comment"),
                });

                if (typeof reviewDetailsCommentId === "number") {
                  logReviewDetailsPublicationCompleted({
                    surfaceKind: "issue_comment",
                    commentId: reviewDetailsCommentId,
                    publicationMode: "degraded-fallback",
                  });
                }

                finalizePublicationPhaseTiming();
                if (
                  reviewDetailsCommentId !== undefined &&
                  canPublishVisibleOutput("finalized Review Details timing update")
                ) {
                  await extractionOctokit.rest.issues.updateComment({
                    owner: apiOwner,
                    repo: apiRepo,
                    comment_id: reviewDetailsCommentId,
                    body: sanitizeOutgoingMentions(
                      buildReviewDetailsBody(),
                      [githubApp.getAppSlug(), "claude"],
                    ),
                  });
                }
              }
            }
          } catch (err) {
            logger.warn(
              {
                ...baseLog,
                gate: "review-details-output",
                gateResult: "failed",
                reviewOutputKey,
                err,
              },
              "Failed to publish canonical-or-degraded Review Details output",
            );
          }
        }

        // Telemetry capture (TELEM-03, TELEM-05, CONFIG-10)
        if (config.telemetry.enabled) {
          try {
            await telemetryStore.recordRateLimitEvent({
              deliveryId: event.id,
              executionIdentity: `${event.id}:reuse.review-derived-prompt`,
              repo: `${apiOwner}/${apiRepo}`,
              prNumber: pr.number,
              eventType: "reuse.review-derived-prompt",
              cacheHitRate: reviewPromptDerivedCacheStatus === "hit" ? 1 : 0,
              skippedQueries: reviewPromptDerivedCacheStatus === "hit" ? 1 : 0,
              retryAttempts: reviewPromptDerivedCacheStatus === "hit" ? 0 : 1,
              degradationPath: reviewPromptDerivedCacheReason
                ? `${reviewPromptDerivedCacheStatus}:${reviewPromptDerivedCacheReason}`
                : reviewPromptDerivedCacheStatus,
            });
          } catch (err) {
            logger.warn({ err }, "Review derived-prompt reuse telemetry write failed (non-blocking)");
          }

          try {
            await telemetryStore.record({
              deliveryId: event.id,
              repo: `${apiOwner}/${apiRepo}`,
              prNumber: pr.number,
              prAuthor: pr.user.login,
              eventType: `pull_request.${payload.action}`,
              model: result.model ?? "unknown",
              inputTokens: result.inputTokens,
              outputTokens: result.outputTokens,
              cacheReadTokens: result.cacheReadTokens,
              cacheCreationTokens: result.cacheCreationTokens,
              durationMs: result.durationMs,
              costUsd: result.costUsd,
              // TMO-03: Distinguish timeout_partial from timeout in telemetry
              conclusion: result.isTimeout && result.published
                ? "timeout_partial"
                : result.isTimeout
                  ? "timeout"
                  : result.conclusion,
              sessionId: result.sessionId,
              numTurns: result.numTurns,
              stopReason: result.stopReason,
            });
          } catch (err) {
            logger.warn({ err }, "Telemetry write failed (non-blocking)");
          }

          try {
            for (const promptSectionRecord of result.promptSections ?? reviewPromptSections) {
              await telemetryStore.recordPromptSections(promptSectionRecord);
            }
          } catch (err) {
            logger.warn({ err }, "Prompt-section telemetry write failed (non-blocking)");
          }

          // Cost warning (CONFIG-11)
          if (
            config.telemetry.costWarningUsd > 0 &&
            result.costUsd !== undefined &&
            result.costUsd > config.telemetry.costWarningUsd
          ) {
            logger.warn(
              {
                costUsd: result.costUsd,
                threshold: config.telemetry.costWarningUsd,
                repo: `${apiOwner}/${apiRepo}`,
                prNumber: pr.number,
              },
              "Execution cost exceeded warning threshold",
            );
            try {
              if (canPublishVisibleOutput("cost warning comment")) {
                setReviewWorkPhase("publish");
                const warnOctokit = await githubApp.getInstallationOctokit(event.installationId);
                await warnOctokit.rest.issues.createComment({
                  owner: apiOwner,
                  repo: apiRepo,
                  issue_number: pr.number,
                  body: sanitizeOutgoingMentions(`> **Kodiai cost warning:** This execution cost \$${result.costUsd.toFixed(4)} USD, exceeding the configured threshold of \$${config.telemetry.costWarningUsd.toFixed(2)} USD.\n>\n> Configure in \`.kodiai.yml\`:\n> \`\`\`yml\n> telemetry:\n>   costWarningUsd: 5.0  # or 0 to disable\n> \`\`\``, [githubApp.getAppSlug(), "claude"]),
                });
              }
            } catch (err) {
              logger.warn({ err }, "Failed to post cost warning comment (non-blocking)");
            }
          }
        }

        let reviewId: number | undefined;

        if (knowledgeStore) {
          try {
            reviewId = await knowledgeStore.recordReview({
              repo: `${apiOwner}/${apiRepo}`,
              prNumber: pr.number,
              headSha: pr.head.sha,
              deliveryId: event.id,
              filesAnalyzed: diffAnalysis?.metrics.totalFiles ?? 0,
              linesChanged:
                linesChanged,
              findingsCritical: findingCounts.critical,
              findingsMajor: findingCounts.major,
              findingsMedium: findingCounts.medium,
              findingsMinor: findingCounts.minor,
              findingsTotal: processedFindings.length,
              suppressionsApplied,
              configSnapshot: JSON.stringify({
                mode: config.review.mode,
                severityMinLevel: config.review.severity.minLevel,
                focusAreas: config.review.focusAreas,
                maxComments: config.review.maxComments,
                suppressionCount: config.review.suppressions.length,
                minConfidence: config.review.minConfidence,
                profile: config.review.profile,
                shareGlobal: config.knowledge.shareGlobal,
                reviewPlan: reviewPlanConfigSnapshot,
                reviewReducer: {
                  status: reducerResult.status,
                  counts: reducerResult.counts,
                  reason: reducerResult.reason,
                },
                reviewCandidateFinding: reviewCandidateFindingConfigSnapshot,
                reviewCandidatePublication: reviewCandidatePublicationRuntime.safeConfigSnapshot,
                reviewCandidatePublicationFlow,
              }),
              durationMs: result.durationMs,
              model: config.model,
              conclusion: result.conclusion,
            });
            const recordedReviewId = reviewId;

            logger.debug(
              {
                reviewId: recordedReviewId,
                repo: `${apiOwner}/${apiRepo}`,
                prNumber: pr.number,
                findingsCaptured: processedFindings.length,
              },
              "Knowledge store: review recorded",
            );

            await knowledgeStore.recordFindings(
              processedFindings.map((finding) => ({
                reviewId: recordedReviewId,
                commentId: finding.commentId,
                commentSurface: "pull_request_review_comment",
                reviewOutputKey,
                filePath: finding.filePath,
                startLine: finding.startLine,
                endLine: finding.endLine,
                severity: finding.severity,
                category: finding.category,
                confidence: finding.confidence,
                title: finding.title,
                suppressed: finding.suppressed,
                suppressionPattern: finding.suppressionPattern,
              })),
            );

            await knowledgeStore.recordSuppressionLog(
              Array.from(suppressionMatchCounts.entries()).map(([pattern, matchedCount]) => ({
                reviewId: recordedReviewId,
                pattern,
                matchedCount,
              })),
            );

            if (config.knowledge.shareGlobal) {
              try {
                const aggregateCounts = new Map<string, {
                  severity: FindingSeverity;
                  category: FindingCategory;
                  confidenceBand: ConfidenceBand;
                  patternFingerprint: string;
                  count: number;
                }>();

                for (const finding of processedFindings) {
                  const confidenceBand = toConfidenceBand(finding.confidence);
                  const patternFingerprint = fingerprintFindingTitle(finding.title);
                  const key = `${finding.severity}|${finding.category}|${confidenceBand}|${patternFingerprint}`;
                  const existing = aggregateCounts.get(key);
                  if (existing) {
                    existing.count += 1;
                    continue;
                  }
                  aggregateCounts.set(key, {
                    severity: finding.severity,
                    category: finding.category,
                    confidenceBand,
                    patternFingerprint,
                    count: 1,
                  });
                }

                for (const aggregate of aggregateCounts.values()) {
                  await knowledgeStore.recordGlobalPattern({
                    severity: aggregate.severity,
                    category: aggregate.category,
                    confidenceBand: aggregate.confidenceBand,
                    patternFingerprint: aggregate.patternFingerprint,
                    count: aggregate.count,
                  });
                }
              } catch (err) {
                logger.warn(
                  { err, repo: `${apiOwner}/${apiRepo}`, prNumber: pr.number },
                  "Knowledge store global aggregate write failed (non-fatal)",
                );
              }
            }

            logger.debug(
              {
                reviewId,
                repo: `${apiOwner}/${apiRepo}`,
                prNumber: pr.number,
                visibleFindings: visibleFindings.length,
                lowConfidenceFindings: lowConfidenceFindings.length,
                suppressionsApplied,
              },
              "Knowledge store: findings and suppression logs recorded",
            );
          } catch (err) {
            logger.warn(
              { err, repo: `${apiOwner}/${apiRepo}`, prNumber: pr.number },
              "Knowledge store write failed (non-fatal)",
            );
          }
        }

        // Mark run as completed for idempotency tracking
        if (knowledgeStore) {
          try {
            const runKey = `${apiOwner}/${apiRepo}:pr-${pr.number}:base-${pr.base.sha}:head-${pr.head.sha}`;
            await knowledgeStore.completeRun(runKey);
          } catch (err) {
            logger.warn({ ...baseLog, err }, 'Failed to mark run as completed (non-fatal)');
          }
        }

        // Fire-and-forget incremental expertise update (PROF-04)
        if (contributorProfileStore) {
          updateExpertiseIncremental({
            githubUsername: pr.user.login,
            filesChanged: reviewFiles,
            type: "pr_authored",
            profileStore: contributorProfileStore,
            logger,
          }).catch((err) => logger.warn({ err }, "Contributor expertise update failed (non-blocking)"));
        }

        // Async learning memory write (LEARN-06)
        // Write accepted and suppressed findings to learning memory with embeddings.
        // This is async and fail-open -- errors do not affect the review outcome.
        if (learningMemoryStore && embeddingProvider && processedFindings.length > 0) {
          // Fire and forget: don't await, don't block review completion
          Promise.resolve().then(async () => {
            const owner = apiOwner;
            const repo = `${apiOwner}/${apiRepo}`;
            let written = 0;
            let failed = 0;
            let skipped = 0;
            const skipReasons: Record<string, number> = {};

            for (const finding of processedFindings) {
              const decision = buildReviewLearningMemoryRecord({
                finding,
                owner,
                repo,
                reviewId,
                prNumber: pr.number,
                // Context-aware language classification: .h files in C++ PRs become "cpp" (LANG-01)
                language: classifyFileLanguageWithContext(finding.filePath, changedFiles),
              });

              if (isReviewLearningMemorySkip(decision)) {
                skipped++;
                skipReasons[decision.reason] = (skipReasons[decision.reason] ?? 0) + 1;
                logger.info(
                  {
                    ...baseLog,
                    gate: decision.gate,
                    gateResult: decision.gateResult,
                    reason: decision.reason,
                    filePath: decision.filePath,
                    findingTitle: decision.findingTitle,
                  },
                  'Learning memory write skipped for finding',
                );
                continue;
              }

              try {
                const embeddingResult = await embeddingProvider.generate(decision.embeddingText, 'document');
                if (!embeddingResult) {
                  // Embedding failed (already logged by provider), skip this finding
                  failed++;
                  continue;
                }

                const memoryRecord = decision.toRecord({
                  model: embeddingResult.model,
                  dimensions: embeddingResult.dimensions,
                });
                if (isReviewLearningMemorySkip(memoryRecord)) {
                  skipped++;
                  skipReasons[memoryRecord.reason] = (skipReasons[memoryRecord.reason] ?? 0) + 1;
                  logger.info(
                    {
                      ...baseLog,
                      gate: memoryRecord.gate,
                      gateResult: memoryRecord.gateResult,
                      reason: memoryRecord.reason,
                      filePath: memoryRecord.filePath,
                      findingTitle: memoryRecord.findingTitle,
                    },
                    'Learning memory write skipped for finding',
                  );
                  continue;
                }

                await learningMemoryStore.writeMemory(memoryRecord, embeddingResult.embedding);
                written++;
              } catch (err) {
                failed++;
                logger.warn(
                  {
                    ...baseLog,
                    gate: 'learning-memory-write',
                    gateResult: 'failed',
                    err,
                    findingTitle: finding.title,
                    filePath: finding.filePath,
                  },
                  'Learning memory write failed for finding (fail-open)',
                );
              }
            }

            if (written > 0 || failed > 0 || skipped > 0) {
              logger.info(
                {
                  ...baseLog,
                  gate: 'learning-memory-write',
                  gateResult: failed > 0 ? 'failed' : 'completed',
                  written,
                  failed,
                  skipped,
                  skipReasons,
                  total: processedFindings.length,
                },
                'Learning memory write batch complete',
              );
            }
          }).catch((err) => {
            logger.warn(
              { ...baseLog, err },
              'Learning memory write pipeline failed (fail-open)',
            );
          });
        }

        // Async hunk embedding (SNIP-01): embed PR diff hunks for future retrieval.
        // Fire-and-forget: does not block review completion.
        const hunkEmbeddingConfig = config.knowledge.retrieval.hunkEmbedding;
        if (codeSnippetStore && embeddingProvider && hunkEmbeddingConfig.enabled && diffContext.diffContent) {
          const diffFiles = splitDiffByFile(diffContext.diffContent);
          embedDiffHunks({
            diffFiles,
            repo: `${apiOwner}/${apiRepo}`,
            owner: apiOwner,
            prNumber: pr.number,
            prTitle: pr.title,
            codeSnippetStore,
            embeddingProvider,
            config: hunkEmbeddingConfig,
            logger,
          }).catch((err) => {
            logger.warn({ ...baseLog, err }, "Hunk embedding failed (fire-and-forget)");
          });
        }

        if (result.conclusion === "success" && result.published) {
          logger.info(
            {
              evidenceType: "review",
              outcome: "published-output",
              deliveryId: event.id,
              installationId: event.installationId,
              owner: apiOwner,
              repoName: apiRepo,
              repo: `${apiOwner}/${apiRepo}`,
              prNumber: pr.number,
              reviewOutputKey,
            },
            "Evidence bundle",
          );
        }

        const exhaustedTurnBudget =
          result.stopReason === "max_turns" ||
          result.failureSubtype === "error_max_turns";

        // Post error or partial-review comment if execution failed, timed out, or exhausted review turns.
        if (result.conclusion === "error" || (result.conclusion === "failure" && exhaustedTurnBudget)) {
          const category = exhaustedTurnBudget
            ? "timeout"
            : classifyError(
                new Error(result.errorMessage ?? "Unknown error"),
                result.isTimeout ?? false,
                result.published ?? false,
              );

          const timeoutDuration = appliedTimeoutBudget?.totalTimeoutSeconds ?? config.timeoutSeconds;
          const complexityInfo = timeoutEstimate?.reasoning ?? "unknown";

          let publishedPartialReview = false;
          let partialCommentId: number | undefined;
          let fallbackRetryState: string | undefined;
          let deferredPublicOutputForContinuation = false;

          if (result.isTimeout || exhaustedTurnBudget) {
            // Step 1: Read checkpoint/progress data
            const checkpoint = (await knowledgeStore?.getCheckpoint?.(reviewOutputKey)) ?? null;
            const hasPublishedInlines = result.published ?? false;
            const timeoutInlineFindings = hasPublishedInlines
              ? await extractFindingsFromReviewComments({
                  octokit: extractionOctokit,
                  owner: apiOwner,
                  repo: apiRepo,
                  prNumber: pr.number,
                  reviewOutputKey,
                  logger,
                  baseLog,
                })
              : [];
            const timeoutReviewedFiles = Array.from(new Set([
              ...(checkpoint?.filesReviewed ?? []),
              ...timeoutInlineFindings.map((finding) => finding.filePath),
            ]));
            const timeoutInspectedFiles = Array.from(new Set([
              ...timeoutReviewedFiles,
              ...(checkpoint?.filesInspected ?? []),
            ]));
            const timeoutFindingCount = Math.max(
              checkpoint?.findingCount ?? 0,
              timeoutInlineFindings.length,
            );
            const timeoutTotalFiles = checkpoint?.totalFiles ?? changedFiles.length;
            const timeoutFirstPass = normalizeReviewFirstPass({
              boundedness: reviewBoundedness,
              checkpoint,
              outcome: {
                conclusion: result.conclusion,
                stopReason: result.stopReason,
                failureSubtype: result.failureSubtype,
                isTimeout: result.isTimeout,
                published: result.published,
              },
            });
            const hasPartialResults = timeoutFirstPass?.state === "bounded-first-pass";

            // Step 2: Check chronic timeout threshold before publishing
            const recentTimeouts = await telemetryStore.countRecentTimeouts?.(
              `${apiOwner}/${apiRepo}`,
              pr.user.login,
            ) ?? 0;
            const isChronicTimeout = recentTimeouts >= 3;

            const executionConclusion = result.isTimeout && result.published
              ? "timeout_partial"
              : result.isTimeout
                ? "timeout"
                : exhaustedTurnBudget
                  ? "max_turns"
                  : result.conclusion;

            let retryState = isChronicTimeout
              ? "skipped (frequent timeouts for this repo/author)"
              : hasPublishedInlines
                ? "not scheduled (GitHub-visible findings already posted)"
                : "not scheduled";
            let retrySummaryNote: string | undefined;
            let retryPlan: ReturnType<typeof planReviewContinuation> | null = null;
            let continuationProjectionDegraded = false;

            if (timeoutFirstPass) {
              retryPlan = planReviewContinuation({
                reviewOutputKey,
                firstPass: timeoutFirstPass,
                checkpoint,
                riskScores,
                timeoutSeconds: timeoutDuration,
                continuationCompaction: {
                  attemptId: reviewWorkAttempt.attemptId,
                  attemptOrdinal: 0,
                  promptBudgetOutcomes: buildPromptBudgetOutcomes(visiblePromptSectionRecords),
                  cacheTelemetryObservations: visibleReviewCacheObservations,
                },
                hasPublishedInlineFindings: hasPublishedInlines,
                isChronicTimeout,
                estimateContinuationTimeout: ({ timeoutSeconds, files }) => {
                  const retryLinesChanged = files.reduce((sum, filePath) => {
                    const stats = perFileStats.get(filePath);
                    if (!stats) return sum;
                    return sum + stats.added + stats.removed;
                  }, 0);
                  return estimateTimeoutRisk({
                    fileCount: files.length,
                    linesChanged: retryLinesChanged,
                    languageComplexity,
                    isLargePR: false,
                    baseTimeoutSeconds: timeoutSeconds,
                  });
                },
              });

              switch (retryPlan.decision) {
                case "schedule-continuation":
                  if (retryPlan.continuationCompaction) {
                    visibleContinuationCompactionObservations.push(retryPlan.continuationCompaction);
                    refreshReviewVisibleBudgetProjection();
                  }
                  retryState = "scheduled reduced-scope retry";
                  retrySummaryNote = "Scheduling a reduced-scope retry.";
                  break;
                case "skip-continuation":
                  switch (retryPlan.reason) {
                    case "chronic-timeout":
                      retryState = "skipped (frequent timeouts for this repo/author)";
                      break;
                    case "inline-output-already-published":
                      retryState = "not scheduled (GitHub-visible findings already posted)";
                      retrySummaryNote = "Retry not scheduled because GitHub-visible findings were already posted.";
                      break;
                    case "no-remaining-scope":
                      retryState = "not scheduled (no remaining files outside analyzed progress)";
                      retrySummaryNote = "Retry not scheduled because no remaining files were outside the analyzed progress.";
                      break;
                    case "invalid-checkpoint-scope":
                      retryState = "not scheduled (invalid checkpoint scope)";
                      retrySummaryNote = "Retry not scheduled because checkpoint scope was malformed.";
                      break;
                    case "zero-evidence-failure": {
                      retryState = "not scheduled (zero-evidence timeout)";
                      if (knowledgeStore?.upsertContinuationFamilyState && !knowledgeStore.saveCheckpoint) {
                        retrySummaryNote = "Retry not scheduled because the first pass produced no trustworthy evidence and checkpoint persistence is unavailable.";
                        break;
                      }

                      const retryRemoteRuntimeBudgetSeconds = Math.max(30, Math.floor(timeoutDuration / 2));
                      const retryScope = computeRetryScope({
                        allFiles: riskScores,
                        filesAlreadyReviewed: timeoutReviewedFiles,
                        totalFiles: timeoutTotalFiles,
                      });

                      if (retryScope.filesToReview.length > 0) {
                        const continuationFiles = retryScope.filesToReview.map((file) => file.filePath);
                        const timeoutEstimate = estimateTimeoutRisk({
                          fileCount: continuationFiles.length,
                          linesChanged: continuationFiles.reduce((sum, filePath) => {
                            const stats = perFileStats.get(filePath);
                            if (!stats) return sum;
                            return sum + stats.added + stats.removed;
                          }, 0),
                          languageComplexity,
                          isLargePR: false,
                          baseTimeoutSeconds: retryRemoteRuntimeBudgetSeconds,
                        });
                        retryPlan = {
                          decision: "schedule-continuation",
                          reason: "remaining-scope-available",
                          reviewOutputKey,
                          continuationReviewOutputKey: `${reviewOutputKey}-retry-1`,
                          continuationNumber: 1,
                          continuationFiles,
                          scopeRatio: retryScope.scopeRatio,
                          timeoutSeconds: timeoutEstimate.totalTimeoutSeconds,
                          checkpointEnabled:
                            reviewRouting.taskType === TASK_TYPES.REVIEW_FULL ||
                            timeoutEstimate.riskLevel === "medium" ||
                            timeoutEstimate.riskLevel === "high",
                          timeoutEstimate,
                          firstPass: timeoutFirstPass,
                          checkpoint,
                        };
                        retryState = "scheduled reduced-scope retry";
                        retrySummaryNote = "Scheduling a reduced-scope retry.";
                      }
                      break;
                    }
                  }
                  break;
              }
            }

            const retryClassificationInput = retryPlan?.decision === "schedule-continuation"
              ? {
                  enqueued: true,
                  filesCount: retryPlan.continuationFiles.length,
                  scopeRatio: retryPlan.scopeRatio,
                  timeoutSeconds: retryPlan.timeoutSeconds,
                  checkpointEnabled: retryPlan.checkpointEnabled,
                  riskLevel: retryPlan.timeoutEstimate.riskLevel,
                }
              : {
                  enqueued: false,
                  filesCount: 0,
                };
            const timeoutClassification = classifyReviewTimeoutOutcome({
              deliveryId: event.id,
              reviewOutputKey,
              outcome: {
                isTimeout: result.isTimeout,
                stopReason: result.stopReason,
                failureSubtype: result.failureSubtype,
              },
              firstPass: timeoutFirstPass
                ? {
                    state: timeoutFirstPass.state,
                    boundedReason: timeoutFirstPass.boundedReason,
                    evidenceSource: timeoutFirstPass.evidenceSource,
                    continuationPending: timeoutFirstPass.continuationPending,
                    zeroEvidenceFailure: timeoutFirstPass.zeroEvidenceFailure,
                  }
                : null,
              checkpoint: checkpoint
                ? {
                    filesReviewed: timeoutReviewedFiles.length,
                    filesInspected: timeoutInspectedFiles.length,
                    findingCount: timeoutFindingCount,
                    totalFiles: timeoutTotalFiles,
                  }
                : null,
              retry: retryClassificationInput,
              continuation: retryPlan
                ? { decision: retryPlan.decision, reason: retryPlan.reason }
                : null,
              chronicTimeout: isChronicTimeout,
              recentTimeouts,
              longRun: {
                thresholdExceeded: false,
                durationSeconds: typeof result.durationMs === "number" ? Math.floor(result.durationMs / 1000) : undefined,
                thresholdSeconds: timeoutDuration,
              },
            });
            const timeoutClassificationTelemetry = {
              timeoutClassification: timeoutClassification.classification,
              timeoutClassificationMode: timeoutClassification.mode,
              timeoutClassificationReasons: timeoutClassification.reasonCodes,
            };

            logger.info(
              {
                ...baseLog,
                gate: timeoutClassification.gate,
                gateResult: timeoutClassification.classification,
                classification: timeoutClassification.classification,
                mode: timeoutClassification.mode,
                reasonCodes: timeoutClassification.reasonCodes,
                deliveryId: event.id,
                reviewOutputKey,
                prNumber: pr.number,
                checkpointFilesReviewed: timeoutClassification.counts.checkpointFilesReviewed ?? null,
                checkpointFilesInspected: timeoutClassification.counts.checkpointFilesInspected ?? null,
                checkpointFindingCount: timeoutClassification.counts.checkpointFindingCount ?? null,
                checkpointTotalFiles: timeoutClassification.counts.checkpointTotalFiles ?? null,
                retryFilesCount: timeoutClassification.counts.retryFilesCount ?? null,
                recentTimeouts: timeoutClassification.counts.recentTimeouts ?? null,
                longRunDurationSeconds: timeoutClassification.counts.longRunDurationSeconds ?? null,
                longRunThresholdSeconds: timeoutClassification.counts.longRunThresholdSeconds ?? null,
                chronicTimeout: isChronicTimeout,
                retryEnqueued: retryPlan?.decision === "schedule-continuation",
                redaction: timeoutClassification.redaction,
              },
              "Review timeout classification",
            );

            // Step 3: Publish bounded first-pass output only when trustworthy structured evidence exists.
            const summaryDraftBase = checkpoint?.summaryDraft ?? (hasPublishedInlines
              ? "Review stopped after GitHub-visible findings were already posted."
              : hasPartialResults
                ? "Review stopped after structured first-pass progress was recorded."
                : "Review stopped before producing trustworthy structured output.");
            const summaryDraft = retrySummaryNote
              ? `${summaryDraftBase}\n\n${retrySummaryNote}`
              : summaryDraftBase;
            fallbackRetryState = retryState;
            const timeoutReviewDetails = {
              analyzedFiles: timeoutInspectedFiles.length,
              totalFiles: timeoutTotalFiles,
              findingCount: timeoutFindingCount,
              retryState,
            };

            const octokit = extractionOctokit;
            deferredPublicOutputForContinuation = exhaustedTurnBudget
              && retryPlan?.decision === "schedule-continuation"
              && !hasPublishedInlines;
            if (
              timeoutFirstPass?.state === "bounded-first-pass"
              && !deferredPublicOutputForContinuation
              && canPublishVisibleOutput("bounded first-pass review")
            ) {
              setReviewWorkPhase("publish");
              const partialBody = formatPartialReviewComment({
                summaryDraft,
                firstPass: timeoutFirstPass,
                reviewOutputKey,
                timedOutAfterSeconds: timeoutDuration,
                timeoutBudget: appliedTimeoutBudget
                  ? {
                      remoteRuntimeBudgetSeconds: appliedTimeoutBudget.remoteRuntimeBudgetSeconds,
                      infraOverheadBudgetSeconds: appliedTimeoutBudget.infraOverheadBudgetSeconds,
                      totalTimeoutSeconds: appliedTimeoutBudget.totalTimeoutSeconds,
                    }
                  : null,
                isRetrySkipped: isChronicTimeout,
                retrySkipReason: isChronicTimeout
                  ? "Retry skipped -- this repo has timed out frequently for this author."
                  : undefined,
              });
              const partialComment = await octokit.rest.issues.createComment({
                owner: apiOwner,
                repo: apiRepo,
                issue_number: pr.number,
                body: sanitizeOutgoingMentions(partialBody, [githubApp.getAppSlug(), "claude"]),
              });
              partialCommentId = partialComment.data.id;

              // Store partial comment ID in checkpoint for retry to find (best-effort).
              // Use saveCheckpoint() to ensure a record exists even when the run
              // timed out before the checkpoint tool was ever called.
              if (knowledgeStore?.saveCheckpoint) {
                await knowledgeStore.saveCheckpoint({
                  reviewOutputKey,
                  repo: `${apiOwner}/${apiRepo}`,
                  prNumber: pr.number,
                  filesReviewed: timeoutReviewedFiles,
                  filesInspected: timeoutInspectedFiles,
                  findingCount: timeoutFindingCount,
                  summaryDraft,
                  totalFiles: timeoutTotalFiles,
                  partialCommentId,
                });
              } else {
                knowledgeStore?.updateCheckpointCommentId?.(reviewOutputKey, partialCommentId);
              }

              publishedPartialReview = true;

              logger.info(
                {
                  deliveryId: event.id,
                  prNumber: pr.number,
                  partialCommentId,
                  boundedReason: timeoutFirstPass.boundedReason,
                  evidenceSource: timeoutFirstPass.evidenceSource,
                  coveredFiles: timeoutFirstPass.coveredScope?.reviewedFiles ?? null,
                  inspectedFiles: timeoutFirstPass.inspectedScope?.inspectedFiles ?? timeoutInspectedFiles.length,
                  remainingFiles: timeoutFirstPass.remainingScope?.remainingFiles ?? null,
                  findingCount: timeoutFindingCount,
                  hasPartialResults,
                  isChronicTimeout,
                  recentTimeouts,
                  retryState,
                  zeroEvidenceFailure: timeoutFirstPass.zeroEvidenceFailure,
                },
                "Published bounded first-pass review on timeout",
              );

              try {
                if (canPublishVisibleOutput("timeout canonical Review Details merge")) {
                  await upsertCanonicalReviewSurface({
                    octokit,
                    owner: apiOwner,
                    repo: apiRepo,
                    prNumber: pr.number,
                    reviewOutputKey,
                    preferredKind: "issue_comment",
                    canonicalSurface: partialCommentId
                      ? { kind: "issue_comment", commentId: partialCommentId, body: partialBody }
                      : undefined,
                    summaryBody: partialBody,
                    reviewDetailsBlock: buildReviewDetailsBody({
                      timeoutProgress: timeoutReviewDetails,
                      reviewFirstPass: timeoutFirstPass,
                      timeoutBudget: appliedTimeoutBudget
                        ? {
                            remoteRuntimeBudgetSeconds: appliedTimeoutBudget.remoteRuntimeBudgetSeconds,
                            infraOverheadBudgetSeconds: appliedTimeoutBudget.infraOverheadBudgetSeconds,
                            totalTimeoutSeconds: appliedTimeoutBudget.totalTimeoutSeconds,
                          }
                        : null,
                    }),
                    botHandles: [githubApp.getAppSlug(), "claude"],
                    requireDegradationDisclosure: authorClassification.searchEnrichment.degraded,
                    reviewBoundedness,
                    recheckCanPublish: () => canPublishVisibleOutput("timeout canonical Review Details merge"),
                  });
                }
              } catch (reviewDetailsErr) {
                logger.warn(
                  {
                    ...baseLog,
                    gate: "review-details-output",
                    gateResult: "degraded-fallback",
                    reviewOutputKey,
                    err: reviewDetailsErr,
                  },
                  "Failed to update timeout canonical review surface with Review Details; using degraded fallback comment",
                );

                if (canPublishVisibleOutput("timeout degraded Review Details fallback comment")) {
                  try {
                    await upsertDegradedReviewDetailsFallbackComment({
                      octokit,
                      owner: apiOwner,
                      repo: apiRepo,
                      prNumber: pr.number,
                      reviewOutputKey,
                      body: buildReviewDetailsBody({
                        timeoutProgress: timeoutReviewDetails,
                        reviewFirstPass: timeoutFirstPass,
                        timeoutBudget: appliedTimeoutBudget
                          ? {
                              remoteRuntimeBudgetSeconds: appliedTimeoutBudget.remoteRuntimeBudgetSeconds,
                              infraOverheadBudgetSeconds: appliedTimeoutBudget.infraOverheadBudgetSeconds,
                              totalTimeoutSeconds: appliedTimeoutBudget.totalTimeoutSeconds,
                            }
                          : null,
                      }),
                      botHandles: [githubApp.getAppSlug(), "claude"],
                      recheckCanPublish: () =>
                        canPublishVisibleOutput("timeout degraded Review Details fallback comment"),
                    });
                  } catch (fallbackErr) {
                    logger.warn(
                      {
                        ...baseLog,
                        gate: "review-details-output",
                        gateResult: "failed",
                        reviewOutputKey,
                        err: fallbackErr,
                      },
                      "Failed to publish degraded Review Details fallback comment for timeout partial output",
                    );
                  }
                }
              }

              // Structured resilience telemetry (best-effort)
              if (config.telemetry.enabled) {
                try {
                  await telemetryStore.recordResilienceEvent?.({
                    deliveryId: event.id,
                    repo: `${apiOwner}/${apiRepo}`,
                    prNumber: pr.number,
                    prAuthor: pr.user.login,
                    eventType: `pull_request.${payload.action}`,
                    kind: "timeout",
                    reviewOutputKey,
                    executionConclusion,
                    hadInlineOutput: hasPublishedInlines,
                    checkpointFilesReviewed: timeoutReviewedFiles.length,
                    checkpointFilesInspected: timeoutInspectedFiles.length,
                    checkpointFindingCount: timeoutFindingCount,
                    checkpointTotalFiles: timeoutTotalFiles,
                    partialCommentId,
                    recentTimeouts,
                    chronicTimeout: isChronicTimeout,
                    retryEnqueued: false,
                    ...timeoutClassificationTelemetry,
                  });
                } catch (err) {
                  logger.warn({ err }, "Resilience telemetry write failed (non-blocking)");
                  continuationProjectionDegraded = true;
                }
              }
            }

            if (timeoutFirstPass?.state === "zero-evidence-failure") {
              logger.warn(
                {
                  deliveryId: event.id,
                  prNumber: pr.number,
                  boundedReason: timeoutFirstPass.boundedReason,
                  evidenceSource: timeoutFirstPass.evidenceSource,
                  zeroEvidenceFailure: true,
                  reviewOutputKey,
                },
                "Constrained timeout remained a zero-evidence hard failure",
              );
            }

            if (retryPlan?.decision !== "schedule-continuation") {
              await persistContinuationFamilyState({
                authoritativeAttemptId: reviewWorkAttempt.attemptId,
                authoritativeOutcome: "blocked",
                finalStopReason: "no-follow-up",
                projectionStatus: continuationProjectionDegraded ? "degraded" : "canonical",
              });
            }

            // Step 4: Enqueue retry if eligible (not chronic, exactly 1 retry)
            // Retry is only useful when no GitHub-visible output was published.
            // If inline comments were already posted, avoid a retry that could
            // create additional noise or duplicates.
            if (retryPlan?.decision === "schedule-continuation") {
              const retryReviewOutputKey = retryPlan.continuationReviewOutputKey;
              const retryTimeout = retryPlan.timeoutSeconds;
              const retryFiles = retryPlan.continuationFiles;
              const retryTimeoutEstimate = retryPlan.timeoutEstimate;
              const retryCheckpointEnabled = retryPlan.checkpointEnabled;
              const retryScopeRatio = retryPlan.scopeRatio;
              const retryDeliveryId = `${event.id}-retry-1`;
              const retryReviewWorkAttempt = reviewWorkCoordinator.claim({
                familyKey: reviewFamilyKey,
                source: "automatic-review",
                lane: "review",
                deliveryId: retryDeliveryId,
                phase: "claimed",
              });

              // Update resilience telemetry with retry plan
              if (config.telemetry.enabled) {
                try {
                  await telemetryStore.recordResilienceEvent?.({
                    deliveryId: event.id,
                    repo: `${apiOwner}/${apiRepo}`,
                    prNumber: pr.number,
                    prAuthor: pr.user.login,
                    eventType: `pull_request.${payload.action}`,
                    kind: "timeout",
                    reviewOutputKey,
                    executionConclusion,
                    hadInlineOutput: hasPublishedInlines,
                    checkpointFilesReviewed: timeoutReviewedFiles.length,
                    checkpointFilesInspected: timeoutInspectedFiles.length,
                    checkpointFindingCount: timeoutFindingCount,
                    checkpointTotalFiles: timeoutTotalFiles,
                    partialCommentId,
                    recentTimeouts,
                    chronicTimeout: isChronicTimeout,
                    retryEnqueued: true,
                    retryFilesCount: retryFiles.length,
                    retryScopeRatio,
                    retryTimeoutSeconds: retryTimeout,
                    retryRiskLevel: retryTimeoutEstimate.riskLevel,
                    retryCheckpointEnabled,
                    ...timeoutClassificationTelemetry,
                  });
                } catch (err) {
                  logger.warn({ err }, "Resilience telemetry write failed (non-blocking)");
                  continuationProjectionDegraded = true;
                }
              }

              logger.info(
                {
                  deliveryId: event.id,
                  prNumber: pr.number,
                  retryFiles: retryFiles.length,
                  scopeRatio: retryScopeRatio,
                  retryTimeout,
                  retryRiskLevel: retryTimeoutEstimate.riskLevel,
                },
                "Enqueueing retry with reduced scope",
              );

              if (timeoutFirstPass?.zeroEvidenceFailure && knowledgeStore?.saveCheckpoint) {
                await knowledgeStore.saveCheckpoint({
                  reviewOutputKey,
                  repo: `${apiOwner}/${apiRepo}`,
                  prNumber: pr.number,
                  filesReviewed: timeoutReviewedFiles,
                  filesInspected: timeoutInspectedFiles,
                  findingCount: timeoutFindingCount,
                  summaryDraft,
                  totalFiles: timeoutTotalFiles,
                  partialCommentId,
                });
              }

              await persistContinuationFamilyState({
                authoritativeAttemptId: retryReviewWorkAttempt.attemptId,
                authoritativeOutcome: "continuation-pending",
                finalStopReason: "awaiting-continuation",
                projectionStatus: "pending",
                reviewOutputKey: retryReviewOutputKey,
              });

              // Fire-and-forget enqueue -- do not await the retry result.
              // Claim before queueing so the retry is visible in family diagnostics
              // and retains its request ordering, but publish rights only become
              // authoritative when the queued retry actually starts executing.
              void jobQueue.enqueue(event.installationId, async () => {
                  let retryWorkspace: Workspace | undefined;
                  try {
                    setReviewWorkPhaseForAttempt(retryReviewWorkAttempt.attemptId, "workspace-create");
                    retryWorkspace = await workspaceManager.create(event.installationId, {
                      owner: cloneOwner,
                      repo: cloneRepo,
                      ref: cloneRef,
                      depth: REVIEW_WORKSPACE_FETCH_DEPTH,
                    });

                    if (usesPrRef) {
                      await fetchAndCheckoutPullRequestHeadRef({
                        dir: retryWorkspace.dir,
                        prNumber: pr.number,
                        localBranch: "pr-review-retry-1",
                        token: retryWorkspace.token,
                        fallbackRemoteUrl: pr.head.repo ? `https://github.com/${pr.head.repo.full_name}.git` : undefined,
                        fallbackRef: pr.head.ref,
                        depth: REVIEW_WORKSPACE_FETCH_DEPTH,
                      });
                    }

                    await fetchRemoteTrackingBranchFn({
                      dir: retryWorkspace.dir,
                      branch: pr.base.ref,
                      token: retryWorkspace.token,
                      depth: REVIEW_WORKSPACE_FETCH_DEPTH,
                    });

                    const retryInstruction = [
                      result.isTimeout
                        ? "This is a retry of a timed-out review with reduced scope."
                        : "This is a retry of a review that exhausted max turns with reduced scope.",
                      "Focus ONLY on the changed files listed above.",
                      "Do NOT post a top-level summary comment; only publish inline comments.",
                      retryCheckpointEnabled
                        ? "At the end, call save_review_checkpoint with a summaryDraft that summarizes findings so far and a findingCount total."
                        : "",
                    ]
                      .filter(Boolean)
                      .join("\n");
                    const retryCustomInstructions =
                      config.review.prompt && config.review.prompt.trim().length > 0
                        ? `${config.review.prompt.trim()}\n\n${retryInstruction}`
                        : retryInstruction;

                    setReviewWorkPhaseForAttempt(retryReviewWorkAttempt.attemptId, "prompt-build");
                    let retryReviewPromptDerivedCacheStatus: "hit" | "miss" | "degraded" | "bypass" = "bypass";
                    let retryReviewPromptDerivedCacheReason: string | null = null;
                    const retryPromptBuildContext = {
                      owner: apiOwner,
                      repo: apiRepo,
                      prNumber: pr.number,
                      prTitle: pr.title,
                      prBody: pr.body ?? "",
                      prAuthor: pr.user.login,
                      baseBranch: pr.base.ref,
                      headBranch: pr.head.ref,
                      changedFiles: retryFiles,
                      customInstructions: retryCustomInstructions,
                      checkpointEnabled: retryCheckpointEnabled,
                      mode: config.review.mode,
                      severityMinLevel: resolvedSeverityMinLevel,
                      focusAreas: resolvedFocusAreas,
                      ignoredAreas: resolvedIgnoredAreas,
                      maxComments: resolvedMaxComments,
                      suppressions: config.review.suppressions,
                      minConfidence: config.review.minConfidence,
                      diffAnalysis,
                      diffContent: diffContext.diffContent,
                      matchedPathInstructions,
                      incrementalContext: incrementalResult?.mode === "incremental" ? {
                        lastReviewedHeadSha: incrementalResult.lastReviewedHeadSha!,
                        changedFilesSinceLastReview: incrementalResult.changedFilesSinceLastReview,
                        unresolvedPriorFindings: priorFindingCtx?.unresolvedOnUnchangedCode ?? [],
                      } : null,
                      retrievalContext: retrievalCtx,
                      reviewPrecedents: reviewPrecedentsForPrompt.length > 0 ? reviewPrecedentsForPrompt : undefined,
                      wikiKnowledge: wikiKnowledgeForPrompt.length > 0 ? wikiKnowledgeForPrompt : undefined,
                      unifiedResults: unifiedResultsForPrompt.length > 0 ? unifiedResultsForPrompt : undefined,
                      contextWindow: contextWindowForPrompt,
                      filesByLanguage: diffAnalysis?.filesByLanguage,
                      outputLanguage: config.review.outputLanguage,
                      prLabels,
                      focusHints: parsedIntent.unrecognized,
                      conventionalType: parsedIntent.conventionalType,
                      deltaContext: incrementalResult?.mode === "incremental" && priorFindings.length > 0
                        ? {
                            lastReviewedHeadSha: incrementalResult.lastReviewedHeadSha!,
                            changedFilesSinceLastReview: incrementalResult.changedFilesSinceLastReview,
                            priorFindings: priorFindings.map((f) => ({
                              filePath: f.filePath,
                              title: f.title,
                              severity: f.severity,
                              category: f.category,
                            })),
                          }
                        : null,
                      largePRContext: null,
                      gitDiffInstructionsAvailable: false,
                      publishToolNames: [
                        "mcp__github_comment__create_comment",
                        "mcp__github_inline_comment__create_inline_comment",
                      ],
                      contributorExperienceContract: authorClassification.contract,
                      authorExpertise: authorClassification.contract.state === "profile-backed"
                        ? authorClassification.expertise?.map((e) => ({
                            dimension: e.dimension,
                            topic: e.topic,
                            score: e.score,
                          }))
                        : undefined,
                      depBumpContext,
                      searchRateLimitDegradation: authorClassification.searchEnrichment,
                      isDraft,
                      // Review pattern clustering (CLST-03) — reuse from initial review
                      clusterPatterns: clusterPatternsForPrompt.length > 0 ? clusterPatternsForPrompt : undefined,
                      // PR-issue linking (PRLINK-03) — reuse from initial review
                      linkedIssues: linkedIssueResult,
                      structuralImpact: structuralImpactForReview,
                      repoDoctrine: repoDoctrineProjection,
                      smallDiffReview: reviewRouting.taskType === TASK_TYPES.REVIEW_SMALL_DIFF,
                      retryPromptCompaction: retryPlan.continuationCompaction
                        ? {
                            observation: retryPlan.continuationCompaction,
                            checkpointSummaries: checkpoint
                              ? [{
                                  reviewOutputKey: checkpoint.reviewOutputKey,
                                  filesReviewed: checkpoint.filesReviewed,
                                  findingCount: checkpoint.findingCount,
                                  totalFiles: checkpoint.totalFiles,
                                  summaryDraft: checkpoint.summaryDraft,
                                }]
                              : [],
                            promptBudgetOutcomes: buildPromptBudgetOutcomes(visiblePromptSectionRecords).map((outcome) => ({
                              sectionName: outcome.sectionName,
                              status: outcome.status,
                              reason: outcome.reason,
                              includedChars: outcome.includedChars,
                              trimmedChars: outcome.trimmedChars,
                            })),
                            cacheSafetySignalNames: Array.from(new Set(visibleReviewCacheObservations.flatMap((observation) => observation.safetySignalNames ?? []))).sort((a, b) => a.localeCompare(b)),
                          }
                        : null,
                    } satisfies ReviewPromptBuildContext;
                    const retryPromptCacheState: ReviewPromptCacheState = {
                      status: retryReviewPromptDerivedCacheStatus,
                      reason: retryReviewPromptDerivedCacheReason,
                    };
                    const retryPromptResult = await buildReviewPromptResultWithCache({
                      cacheQuery: `retry:${pr.number}:${retryReviewOutputKey}`,
                      context: retryPromptBuildContext,
                      statusTarget: retryPromptCacheState,
                    });
                    retryReviewPromptDerivedCacheStatus = retryPromptCacheState.status;
                    retryReviewPromptDerivedCacheReason = retryPromptCacheState.reason;
                    const retryPrompt = retryPromptResult.text;
                    const retryPromptSections = [
                      buildPromptSectionRecord({
                        deliveryId: retryDeliveryId,
                        repo: `${apiOwner}/${apiRepo}`,
                        taskType: reviewRouting.taskType,
                        promptKind: "review.user-prompt",
                        sections: retryPromptResult.sections,
                      }),
                    ];
                    logger.info(
                      {
                        ...baseLog,
                        deliveryId: retryDeliveryId,
                        gate: "review-derived-prompt-cache",
                        gateResult: retryReviewPromptDerivedCacheStatus,
                        ...(retryReviewPromptDerivedCacheReason ? { reason: retryReviewPromptDerivedCacheReason } : {}),
                      },
                      "Resolved retry review prompt derived-cache state",
                    );
                    const retryPromptCacheEvent = buildPromptReviewCacheEvent({
                      deliveryId: retryDeliveryId,
                      repo: `${apiOwner}/${apiRepo}`,
                      prNumber: pr.number,
                      state: retryPromptCacheState,
                    });
                    visibleReviewCacheObservations.push(retryPromptCacheEvent);
                    refreshReviewVisibleBudgetProjection();
                    if (config.telemetry.enabled) {
                      await recordReviewCacheEventFailOpen(retryPromptCacheEvent);
                    }

                    setReviewWorkPhaseForAttempt(retryReviewWorkAttempt.attemptId, "executor-dispatch");
                    const retryResult = await executor.execute({
                      workspace: retryWorkspace,
                      installationId: event.installationId,
                      owner: apiOwner,
                      repo: apiRepo,
                      prNumber: pr.number,
                      commentId: undefined,
                      botHandles: [githubApp.getAppSlug(), "claude"],
                      eventType: "pull_request.review-retry",
                      taskType: reviewRouting.taskType,
                      triggerBody: "",
                      prompt: retryPrompt,
                      promptSections: retryPromptSections,
                      reviewOutputKey: retryReviewOutputKey,
                      deliveryId: retryDeliveryId,
                      candidateVerificationContext: {
                        docsConfigTruth: null,
                        deliveryId: retryDeliveryId,
                        reviewOutputKey: retryReviewOutputKey,
                        correlationKey: buildShadowSpecialistCorrelationKey({
                          deliveryId: retryDeliveryId,
                          reviewOutputKey: retryReviewOutputKey,
                          prNumber: pr.number,
                        }),
                      },
                      dynamicTimeoutSeconds: retryTimeout,
                      maxTurnsOverride: reviewMaxTurnsOverride,
                      knowledgeStore,
                      totalFiles: timeoutTotalFiles,
                      enableCheckpointTool: retryCheckpointEnabled,
                      prDiffForCommentValidation: diffContext.diffContent,
                      enableCommentTools: false,
                    });

                      const retryCheckpoint = (await knowledgeStore?.getCheckpoint?.(retryReviewOutputKey)) ?? null;
                      const retryHasStructuredProgress =
                        (retryCheckpoint?.filesReviewed?.length ?? 0) > 0 ||
                        (retryCheckpoint?.filesInspected?.length ?? 0) > 0;
                      const retryHasResults =
                        retryHasStructuredProgress ||
                        (retryCheckpoint?.findingCount ?? 0) >= 1 ||
                        (retryResult.published ?? false);
                      const retryTimeoutClassification = classifyReviewTimeoutOutcome({
                        deliveryId: retryDeliveryId,
                        reviewOutputKey: retryReviewOutputKey,
                        outcome: {
                          isTimeout: retryResult.isTimeout,
                          stopReason: retryResult.stopReason,
                          failureSubtype: retryResult.failureSubtype,
                        },
                        checkpoint: retryCheckpoint
                          ? {
                              filesReviewed: retryCheckpoint.filesReviewed?.length,
                              filesInspected: retryCheckpoint.filesInspected?.length,
                              findingCount: retryCheckpoint.findingCount,
                              totalFiles: timeoutTotalFiles,
                            }
                          : null,
                        retry: {
                          completed: retryResult.conclusion === "success" || retryHasResults,
                          failed: retryResult.conclusion !== "success" && !retryHasResults,
                          hasResults: retryHasResults,
                          filesCount: retryFiles.length,
                        },
                      });

                      if (config.telemetry.enabled) {
                        try {
                          for (const promptSectionRecord of retryResult.promptSections ?? retryPromptSections) {
                            await telemetryStore.recordPromptSections(promptSectionRecord);
                          }
                        } catch (err) {
                          logger.warn({ err }, "Retry prompt-section telemetry write failed (non-blocking)");
                        }
                      }

                      if (config.telemetry.enabled) {
                        try {
                          await telemetryStore.recordResilienceEvent?.({
                            deliveryId: retryDeliveryId,
                            parentDeliveryId: event.id,
                            repo: `${apiOwner}/${apiRepo}`,
                            prNumber: pr.number,
                            prAuthor: pr.user.login,
                            eventType: "pull_request.review-retry",
                            kind: "retry",
                            reviewOutputKey: retryReviewOutputKey,
                            executionConclusion: retryResult.isTimeout && retryResult.published
                              ? "timeout_partial"
                              : retryResult.isTimeout
                                ? "timeout"
                                : retryResult.conclusion,
                            hadInlineOutput: retryResult.published ?? false,
                            checkpointFilesReviewed: retryCheckpoint?.filesReviewed?.length,
                            checkpointFindingCount: retryCheckpoint?.findingCount,
                            checkpointTotalFiles: timeoutTotalFiles,
                            partialCommentId,
                            retryHasResults,
                            retryFilesCount: retryFiles.length,
                            retryScopeRatio,
                            retryTimeoutSeconds: retryTimeout,
                            retryRiskLevel: retryTimeoutEstimate.riskLevel,
                            retryCheckpointEnabled,
                            timeoutClassification: retryTimeoutClassification.classification,
                            timeoutClassificationMode: retryTimeoutClassification.mode,
                            timeoutClassificationReasons: retryTimeoutClassification.reasonCodes,
                          });
                        } catch (err) {
                          logger.warn({ err }, "Resilience telemetry write failed (non-blocking)");
                        }
                      }

                    if (
                      retryResult.conclusion === "success" ||
                      (retryResult.isTimeout && retryHasResults)
                    ) {
                      if (!checkpoint) {
                        await settleRetryWithoutCanonicalUpdate({
                          attemptId: retryReviewWorkAttempt.attemptId,
                          reviewOutputKey: retryReviewOutputKey,
                          deliveryId: retryDeliveryId,
                          reason: "missing-base-checkpoint",
                          logMessage: "Retry settlement skipped because the base checkpoint was missing",
                        });
                        return;
                      }

                      const settlementDecision = settleReviewContinuation({
                        reviewOutputKey,
                        continuationReviewOutputKey: retryReviewOutputKey,
                        baseCheckpoint: checkpoint,
                        continuationCheckpoint: retryCheckpoint,
                        continuationPublished: retryResult.published ?? false,
                      });

                      if (settlementDecision.decision === "merge-continuation") {
                        let continuationRevisionCounts: DeltaClassification["counts"] | null = null;
                        if (knowledgeStore?.getPriorReviewFindings) {
                          try {
                            const priorFindings = await knowledgeStore.getPriorReviewFindings({
                              repo: `${apiOwner}/${apiRepo}`,
                              prNumber: pr.number,
                            });
                            if (priorFindings.length > 0) {
                              const currentFindings = await extractFindingsFromReviewComments({
                                octokit: await githubApp.getInstallationOctokit(event.installationId),
                                owner: apiOwner,
                                repo: apiRepo,
                                prNumber: pr.number,
                                reviewOutputKey,
                                logger,
                                baseLog,
                              });
                              continuationRevisionCounts = classifyFindingDeltas({
                                currentFindings: currentFindings.map((finding) => ({
                                  filePath: finding.filePath,
                                  title: finding.title,
                                  severity: finding.severity,
                                  category: finding.category,
                                  commentId: finding.commentId,
                                  suppressed: false,
                                  confidence: 100,
                                })),
                                priorFindings,
                                fingerprintFn: fingerprintFindingTitle,
                              }).counts;
                            }
                          } catch (err) {
                            logger.warn(
                              {
                                ...baseLog,
                                gate: "continuation-delta",
                                gateResult: "failed",
                                reviewOutputKey,
                                err,
                              },
                              "Continuation delta classification failed (fail-open, merging without revision labels)",
                            );
                          }
                        }

                        if (
                          continuationRevisionCounts
                          && continuationRevisionCounts.new === 0
                          && continuationRevisionCounts.stillOpen === 0
                          && continuationRevisionCounts.resolved === 0
                        ) {
                          logger.info(
                            {
                              deliveryId: retryDeliveryId,
                              prNumber: pr.number,
                              retryConclusion: retryResult.conclusion,
                              settlementReason: "no-meaningful-delta",
                            },
                            "Retry produced no additional results -- keeping original partial review",
                          );
                          await persistContinuationFamilyState({
                            authoritativeAttemptId: retryReviewWorkAttempt.attemptId,
                            authoritativeOutcome: "quiet-settled",
                            finalStopReason: "settled-without-update",
                            projectionStatus: "canonical",
                            reviewOutputKey: retryReviewOutputKey,
                          });
                          knowledgeStore?.deleteCheckpoint?.(reviewOutputKey);
                          knowledgeStore?.deleteCheckpoint?.(retryReviewOutputKey);
                          return;
                        }

                        const retryFilesReviewed = retryCheckpoint?.filesReviewed?.length ?? retryFiles.length;
                        const mergedFirstPass = normalizeReviewFirstPass({
                          boundedness: reviewBoundedness,
                          checkpoint: settlementDecision.mergedCheckpoint,
                          outcome: {
                            conclusion: result.conclusion,
                            stopReason: result.stopReason,
                            failureSubtype: result.failureSubtype,
                            isTimeout: result.isTimeout,
                            published: true,
                          },
                        });

                        if (mergedFirstPass?.state !== "bounded-first-pass") {
                          await settleRetryWithoutCanonicalUpdate({
                            attemptId: retryReviewWorkAttempt.attemptId,
                            reviewOutputKey: retryReviewOutputKey,
                            deliveryId: retryDeliveryId,
                            reason: "non-publishable-merged-first-pass",
                            logMessage: "Retry merge skipped because bounded first-pass state became non-publishable",
                          });
                          return;
                        }

                        const summaryDraftForMerge =
                          settlementDecision.mergedCheckpoint.summaryDraft ||
                          retryCheckpoint?.summaryDraft ||
                          checkpoint?.summaryDraft ||
                          "Review completed with reduced scope.";
                        const mergedReviewedFiles = settlementDecision.mergedCheckpoint.filesReviewed.length;
                        const mergedTotalFiles = settlementDecision.mergedCheckpoint.totalFiles;
                        const maxTurnsContinuationCompleted = timeoutFirstPass?.boundedReason === "max-turns"
                          && mergedTotalFiles > 0
                          && mergedReviewedFiles >= mergedTotalFiles;
                        const mergedBody = maxTurnsContinuationCompleted
                          ? formatCompletedContinuationReviewComment({
                              summaryDraft: summaryDraftForMerge,
                              reviewOutputKey,
                              totalFiles: mergedTotalFiles,
                              continuationRevisionCounts,
                            })
                          : formatPartialReviewComment({
                              summaryDraft: summaryDraftForMerge,
                              firstPass: mergedFirstPass,
                              reviewOutputKey,
                              timedOutAfterSeconds: timeoutDuration,
                              isRetryResult: true,
                              retryFilesReviewed,
                              continuationRevisionCounts,
                            });

                        const retryOctokit = await githubApp.getInstallationOctokit(event.installationId);
                        const storedCheckpoint = (await knowledgeStore?.getCheckpoint?.(reviewOutputKey)) ?? null;
                        const commentIdToUpdate = storedCheckpoint?.partialCommentId ?? partialCommentId;

                        if (canPublishReviewWorkOutput(
                          retryReviewWorkAttempt.attemptId,
                          "retry partial review merge",
                          retryDeliveryId,
                        )) {
                          setReviewWorkPhaseForAttempt(retryReviewWorkAttempt.attemptId, "publish");

                          let retryMergeProjectionStatus: ContinuationFamilyProjectionStatus = "canonical";
                          let retryMergeLogMessage = commentIdToUpdate
                            ? "Retry complete -- updated partial review comment with merged results"
                            : "Retry complete -- published final review comment with merged results";

                          try {
                            const mergedBodyWithDetails = await upsertCanonicalReviewSurface({
                              octokit: retryOctokit,
                              owner: apiOwner,
                              repo: apiRepo,
                              prNumber: pr.number,
                              reviewOutputKey,
                              preferredKind: "issue_comment",
                              canonicalSurface: commentIdToUpdate
                                ? {
                                    kind: "issue_comment",
                                    commentId: commentIdToUpdate,
                                    body: mergedBody,
                                  }
                                : undefined,
                              summaryBody: mergedBody,
                              reviewDetailsBlock: buildReviewDetailsBody({
                                reviewFirstPass: maxTurnsContinuationCompleted ? null : mergedFirstPass,
                              }),
                              botHandles: [githubApp.getAppSlug(), "claude"],
                              requireDegradationDisclosure: authorClassification.searchEnrichment.degraded,
                              reviewBoundedness,
                              recheckCanPublish: () =>
                                canPublishReviewWorkOutput(
                                  retryReviewWorkAttempt.attemptId,
                                  "retry canonical Review Details merge",
                                  retryDeliveryId,
                                ),
                            });

                            if (!mergedBodyWithDetails) {
                              await settleRetryWithoutCanonicalUpdate({
                                attemptId: retryReviewWorkAttempt.attemptId,
                                reviewOutputKey: retryReviewOutputKey,
                                deliveryId: retryDeliveryId,
                                reason: "publish-superseded",
                                logMessage: "Retry settlement skipped because publish rights were superseded",
                              });
                              return;
                            }
                          } catch (reviewDetailsErr) {
                            logger.warn(
                              {
                                ...baseLog,
                                gate: "review-details-output",
                                gateResult: "degraded-fallback",
                                reviewOutputKey,
                                err: reviewDetailsErr,
                              },
                              "Failed to update retry canonical review surface with Review Details; using degraded fallback comment",
                            );

                            retryMergeProjectionStatus = "degraded";
                            retryMergeLogMessage = commentIdToUpdate
                              ? "Retry complete -- updated partial review comment with merged results; Review Details published via degraded fallback comment"
                              : "Retry complete -- published final review comment with merged results; Review Details published via degraded fallback comment";

                            if (
                              canPublishReviewWorkOutput(
                                retryReviewWorkAttempt.attemptId,
                                "retry degraded Review Details fallback comment",
                                retryDeliveryId,
                              )
                            ) {
                              try {
                                await upsertDegradedReviewDetailsFallbackComment({
                                  octokit: retryOctokit,
                                  owner: apiOwner,
                                  repo: apiRepo,
                                  prNumber: pr.number,
                                  reviewOutputKey,
                                  body: buildReviewDetailsBody({
                                    reviewFirstPass: maxTurnsContinuationCompleted ? null : mergedFirstPass,
                                  }),
                                  botHandles: [githubApp.getAppSlug(), "claude"],
                                  recheckCanPublish: () =>
                                    canPublishReviewWorkOutput(
                                      retryReviewWorkAttempt.attemptId,
                                      "retry degraded Review Details fallback comment",
                                      retryDeliveryId,
                                    ),
                                });
                              } catch (fallbackErr) {
                                logger.warn(
                                  {
                                    ...baseLog,
                                    gate: "review-details-output",
                                    gateResult: "failed",
                                    reviewOutputKey,
                                    err: fallbackErr,
                                  },
                                  "Failed to publish degraded Review Details fallback comment after retry merge",
                                );
                              }
                            }
                          }

                          logger.info(
                            {
                              deliveryId: retryDeliveryId,
                              prNumber: pr.number,
                              retryConclusion: retryResult.conclusion,
                              retryFilesReviewed,
                              partialCommentId,
                              settlementReason: settlementDecision.reason,
                              projectionStatus: retryMergeProjectionStatus,
                            },
                            retryMergeLogMessage,
                          );

                          await persistContinuationFamilyState({
                            authoritativeAttemptId: retryReviewWorkAttempt.attemptId,
                            authoritativeOutcome: "merged",
                            finalStopReason: "merged-continuation-results",
                            projectionStatus: retryMergeProjectionStatus,
                            reviewOutputKey: retryReviewOutputKey,
                          });

                          // Cleanup checkpoint data after successful merge
                          knowledgeStore?.deleteCheckpoint?.(reviewOutputKey);
                          knowledgeStore?.deleteCheckpoint?.(retryReviewOutputKey);
                        }
                      } else {
                        logger.info(
                          {
                            deliveryId: retryDeliveryId,
                            prNumber: pr.number,
                            retryConclusion: retryResult.conclusion,
                            settlementReason: settlementDecision.reason,
                          },
                          "Retry produced no additional results -- keeping original partial review",
                        );
                        await persistContinuationFamilyState({
                          authoritativeAttemptId: retryReviewWorkAttempt.attemptId,
                          authoritativeOutcome: "quiet-settled",
                          finalStopReason: "settled-without-update",
                          projectionStatus: "canonical",
                          reviewOutputKey: retryReviewOutputKey,
                        });
                      }
                    } else {
                      logger.info(
                        {
                          deliveryId: retryDeliveryId,
                          prNumber: pr.number,
                          retryConclusion: retryResult.conclusion,
                        },
                        "Retry produced no additional results -- keeping original partial review",
                      );
                    }

                    if (config.telemetry.enabled) {
                      try {
                        await telemetryStore.recordRateLimitEvent({
                          deliveryId: retryDeliveryId,
                          executionIdentity: `${retryDeliveryId}:reuse.review-derived-prompt`,
                          repo: `${apiOwner}/${apiRepo}`,
                          prNumber: pr.number,
                          eventType: "reuse.review-derived-prompt",
                          cacheHitRate: retryReviewPromptDerivedCacheStatus === "hit" ? 1 : 0,
                          skippedQueries: retryReviewPromptDerivedCacheStatus === "hit" ? 1 : 0,
                          retryAttempts: retryReviewPromptDerivedCacheStatus === "hit" ? 0 : 1,
                          degradationPath: retryReviewPromptDerivedCacheReason
                            ? `${retryReviewPromptDerivedCacheStatus}:${retryReviewPromptDerivedCacheReason}`
                            : retryReviewPromptDerivedCacheStatus,
                        });
                      } catch (err) {
                        logger.warn({ err }, "Retry derived-prompt reuse telemetry write failed (non-blocking)");
                      }

                      try {
                        await telemetryStore.record({
                          deliveryId: retryDeliveryId,
                          repo: `${apiOwner}/${apiRepo}`,
                          prNumber: pr.number,
                          prAuthor: pr.user.login,
                          eventType: "pull_request.review-retry",
                          model: retryResult.model ?? "unknown",
                          inputTokens: retryResult.inputTokens,
                          outputTokens: retryResult.outputTokens,
                          cacheReadTokens: retryResult.cacheReadTokens,
                          cacheCreationTokens: retryResult.cacheCreationTokens,
                          durationMs: retryResult.durationMs,
                          costUsd: retryResult.costUsd,
                          conclusion: retryResult.isTimeout && retryResult.published
                            ? "timeout_partial"
                            : retryResult.isTimeout
                              ? "timeout"
                              : retryResult.conclusion,
                          sessionId: retryResult.sessionId,
                          numTurns: retryResult.numTurns,
                          stopReason: retryResult.stopReason,
                        });
                      } catch (err) {
                        logger.warn({ err }, "Retry telemetry write failed (non-blocking)");
                      }
                    }
                  } catch (retryErr) {
                    logger.error(
                      {
                        err: retryErr,
                        deliveryId: retryDeliveryId,
                        prNumber: pr.number,
                        ...classifyRetryFailure(retryErr),
                      },
                      "Retry failed with error",
                    );
                    await finalizeContinuationAttempt({
                      attemptId: retryReviewWorkAttempt.attemptId,
                      fallbackOutcome: "blocked",
                      fallbackStopReason: "no-follow-up",
                      reviewOutputKey: retryReviewOutputKey,
                    });
                  } finally {
                    if (retryWorkspace) {
                      await retryWorkspace.cleanup();
                    }

                    try {
                      reviewWorkCoordinator.complete(retryReviewWorkAttempt.attemptId);
                    } finally {
                      // Best-effort checkpoint cleanup even on retry failure.
                      // Retry attempts are capped at 1, so leaving checkpoint rows
                      // behind provides little value and can accumulate stale state.
                      knowledgeStore?.deleteCheckpoint?.(retryReviewOutputKey);
                      knowledgeStore?.deleteCheckpoint?.(reviewOutputKey);
                    }
                  }
                }, {
                  deliveryId: retryDeliveryId,
                  eventName: event.name,
                  action: `review-retry`,
                  lane: "review",
                  key: reviewFamilyKey,
                  jobType: "pull-request-review-retry",
                  prNumber: pr.number,
                }).catch(async (err) => {
                  await finalizeContinuationAttempt({
                    attemptId: retryReviewWorkAttempt.attemptId,
                    fallbackOutcome: "blocked",
                    fallbackStopReason: "no-follow-up",
                    reviewOutputKey: retryReviewOutputKey,
                  });
                  reviewWorkCoordinator.release(retryReviewWorkAttempt.attemptId);
                  logger.error(
                    { err, deliveryId: event.id, prNumber: pr.number, ...classifyRetryFailure(err) },
                    "Failed to enqueue retry job",
                  );
                });
            }
          }

          let errorBody: string;
          if (!publishedPartialReview && !deferredPublicOutputForContinuation) {
            if (exhaustedTurnBudget) {
              errorBody = [
                "> **Kodiai ran out of steps while reviewing this PR**",
                "",
                "_The review run ended before it could publish comments or an approval._",
                "",
                ...(result.stopReason ? [`Stop reason: ${result.stopReason}`] : []),
                ...(result.failureSubtype ? [`Failure subtype: ${result.failureSubtype}`] : []),
                ...(fallbackRetryState ? [`Retry state: ${fallbackRetryState}`] : []),
                "",
                fallbackRetryState?.startsWith("scheduled")
                  ? "A reduced-scope retry has been scheduled automatically."
                  : "Kodiai could not preserve enough structured evidence to publish a bounded first-pass review.",
              ].join("\n");
            } else if (category === "timeout_partial") {
              // TMO-03: Partial review -- inline comments were published before timeout
              errorBody = formatErrorComment(
                category,
                formatTimeoutErrorDetail({
                  totalTimeoutSeconds: timeoutDuration,
                  complexityInfo,
                  hasReviewOutput: true,
                  timeoutEstimate: appliedTimeoutBudget,
                }),
              );
            } else if (category === "timeout") {
              // TMO-03: Full timeout -- nothing was published
              errorBody = formatErrorComment(
                category,
                formatTimeoutErrorDetail({
                  totalTimeoutSeconds: timeoutDuration,
                  complexityInfo,
                  hasReviewOutput: false,
                  timeoutEstimate: appliedTimeoutBudget,
                }),
              );
            } else {
              errorBody = formatErrorComment(
                category,
                result.errorMessage ?? "An unexpected error occurred during review.",
              );
            }

            const octokit = await githubApp.getInstallationOctokit(event.installationId);
            if (canPublishVisibleOutput("error comment")) {
              setReviewWorkPhase("publish");
              const publicationStatus = await postOrUpdateErrorComment(octokit, {
                owner: apiOwner,
                repo: apiRepo,
                issueNumber: pr.number,
              }, sanitizeOutgoingMentions(errorBody, [githubApp.getAppSlug(), "claude"]), logger);
              reviewPublishFallbackDelivery = exhaustedTurnBudget
                ? describeTurnLimitNoticeDelivery(publicationStatus)
                : describeErrorCommentDelivery(publicationStatus);
              if (publicationStatus.ok) {
                reviewOutputPublished = true;
                reviewPublishResolution = exhaustedTurnBudget ? "turn-limit-fallback" : "error-fallback";
              } else {
                reviewPublishResolution = exhaustedTurnBudget ? "turn-limit-fallback-undelivered" : "error-comment-failed";
              }
            }
          }
        }

        if (result.conclusion === "failure" && !(result.published ?? false) && !exhaustedTurnBudget) {
          const failureBody = [
            "> **Kodiai completed the review run but could not publish review output**",
            "",
            ...(result.stopReason ? [`Stop reason: ${result.stopReason}`] : []),
            ...(result.failureSubtype ? [`Failure subtype: ${result.failureSubtype}`] : []),
            ...(result.errorMessage ? [result.errorMessage] : []),
            "",
            "Try requesting another review if you want a fresh attempt.",
          ].join("\n");

          const octokit = await githubApp.getInstallationOctokit(event.installationId);
          if (canPublishVisibleOutput("failure fallback comment")) {
            setReviewWorkPhase("publish");
            const publicationStatus = await postOrUpdateErrorComment(
              octokit,
              {
                owner: apiOwner,
                repo: apiRepo,
                issueNumber: pr.number,
              },
              sanitizeOutgoingMentions(failureBody, [githubApp.getAppSlug(), "claude"]),
              logger,
            );
            reviewPublishFallbackDelivery = describeErrorCommentDelivery(publicationStatus);
            if (publicationStatus.ok) {
              reviewOutputPublished = true;
              reviewPublishResolution = "failure-fallback";
            } else {
              reviewPublishResolution = "failure-fallback-failed";
            }
          }
        }

        // Clean review publication: when no output was produced, publish the clean
        // result either as an approving pull review (explicit opt-in) or as a
        // normal issue comment (default behavior).
        if (result.conclusion === "success") {
          try {
            // If the review execution published any output (summary comment, inline comments, etc.),
            // do NOT auto-approve. Auto-approval is only valid when the bot produced zero output.
            if (result.published) {
              logger.info(
                {
                  prNumber: pr.number,
                  gate: "auto-approve",
                  gateResult: "skipped",
                  skipReason: "output-published",
                },
                "Skipping auto-approval because review output was published",
              );
              return;
            }

            const octokit = await githubApp.getInstallationOctokit(event.installationId);
            const appSlug = githubApp.getAppSlug();

            // Double-check via a scan for the review output marker. This provides
            // defense-in-depth if the executor didn't report published=true.
            const idempotencyCheck = await ensureReviewOutputNotPublished({
              octokit,
              owner: apiOwner,
              repo: apiRepo,
              prNumber: pr.number,
              reviewOutputKey,
            });

            if (!idempotencyCheck.shouldPublish) {
              logger.info(
                {
                  prNumber: pr.number,
                  gate: "auto-approve",
                  gateResult: "skipped",
                  skipReason: "output-marker-present",
                  existingLocation: idempotencyCheck.existingLocation,
                },
                "Skipping auto-approval because review output marker was published",
              );
              if (canonicalReviewDetailsBody) {
                if (
                  idempotencyCheck.existingLocation !== "review-comment" &&
                  canPublishVisibleOutput("clean review canonical Review Details merge")
                ) {
                  setReviewWorkPhase("publish");
                  const canonicalSurfaceKind: CanonicalSurfaceKind = idempotencyCheck.existingLocation === "review"
                    ? "pull_review"
                    : "issue_comment";
                  const finalizedExistingReviewDetails = await upsertCanonicalReviewSurface({
                    octokit,
                    owner: apiOwner,
                    repo: apiRepo,
                    prNumber: pr.number,
                    reviewOutputKey,
                    preferredKind: canonicalSurfaceKind,
                    reviewDetailsBlock: canonicalReviewDetailsBody,
                    botHandles: [appSlug, "claude"],
                    requireDegradationDisclosure: authorClassification.searchEnrichment.degraded,
                    reviewBoundedness,
                    ...(canonicalSurfaceKind === "pull_review" ? { pullReviewEvent: "APPROVE" as const } : {}),
                    recheckCanPublish: () =>
                      canPublishVisibleOutput("clean review canonical Review Details merge"),
                  });
                  logCanonicalReviewDetailsPublicationCompleted(finalizedExistingReviewDetails);
                  finalizePublicationPhaseTiming();
                } else if (canPublishVisibleOutput("degraded Review Details fallback comment")) {
                  setReviewWorkPhase("publish");
                  const reviewDetailsCommentId = await upsertDegradedReviewDetailsFallbackComment({
                    octokit,
                    owner: apiOwner,
                    repo: apiRepo,
                    prNumber: pr.number,
                    reviewOutputKey,
                    body: canonicalReviewDetailsBody,
                    botHandles: [appSlug, "claude"],
                    recheckCanPublish: () =>
                      canPublishVisibleOutput("degraded Review Details fallback comment"),
                  });

                  if (typeof reviewDetailsCommentId === "number") {
                    logReviewDetailsPublicationCompleted({
                      surfaceKind: "issue_comment",
                      commentId: reviewDetailsCommentId,
                      publicationMode: "degraded-fallback",
                    });
                  }

                  finalizePublicationPhaseTiming();
                  if (
                    reviewDetailsCommentId !== undefined &&
                    canPublishVisibleOutput("finalized Review Details timing update")
                  ) {
                    await octokit.rest.issues.updateComment({
                      owner: apiOwner,
                      repo: apiRepo,
                      comment_id: reviewDetailsCommentId,
                      body: sanitizeOutgoingMentions(canonicalReviewDetailsBody, [appSlug, "claude"]),
                    });
                  }
                }
              }
              return;
            }

            const cleanReviewPublicationReason = config.review.autoApprove
              ? "auto-approval"
              : "clean review publication";
            if (!canPublishVisibleOutput(cleanReviewPublicationReason)) {
              return;
            }

            setReviewWorkPhase("publish");
            const visibleBudgetDisclosureEvidence = buildVisibleBudgetDisclosureEvidence(refreshReviewVisibleBudgetProjection());
            const approvalEvidence = [
              `Review prompt covered ${promptFiles.length} changed file${promptFiles.length === 1 ? "" : "s"}.`,
              ...(visibleBudgetDisclosureEvidence ? [visibleBudgetDisclosureEvidence] : []),
            ];
            const approvalConfidence = depBumpContext?.mergeConfidence
              ? renderApprovalConfidence(depBumpContext.mergeConfidence)
              : null;

            const approvalBody = buildApprovedReviewBody({
              reviewOutputKey,
              evidence: approvalEvidence,
              approvalConfidence,
              reviewDetailsBlock: canonicalReviewDetailsBody,
            });

            const cleanReviewSurfaceKind: CanonicalSurfaceKind = config.review.autoApprove
              ? "pull_review"
              : "issue_comment";

            const canonicalApprovalReview = await upsertCanonicalReviewSurface({
              octokit,
              owner: apiOwner,
              repo: apiRepo,
              prNumber: pr.number,
              reviewOutputKey,
              preferredKind: cleanReviewSurfaceKind,
              body: approvalBody,
              botHandles: [appSlug, "claude"],
              ...(config.review.autoApprove ? { pullReviewEvent: "APPROVE" as const } : {}),
              recheckCanPublish: () => canPublishVisibleOutput(cleanReviewPublicationReason),
            });

            finalizePublicationPhaseTiming();

            if (
              canonicalApprovalReview?.kind === cleanReviewSurfaceKind
              && canonicalReviewDetailsBody
              && canPublishVisibleOutput("finalized clean review canonical Review Details merge")
            ) {
              const finalizedCleanReviewDetails = await upsertCanonicalReviewSurface({
                octokit,
                owner: apiOwner,
                repo: apiRepo,
                prNumber: pr.number,
                reviewOutputKey,
                preferredKind: cleanReviewSurfaceKind,
                reviewDetailsBlock: buildReviewDetailsBody(),
                botHandles: [appSlug, "claude"],
                summaryBody: canonicalApprovalReview.body,
                canonicalSurface: canonicalApprovalReview,
                requireDegradationDisclosure: authorClassification.searchEnrichment.degraded,
                reviewBoundedness,
                ...(config.review.autoApprove ? { pullReviewEvent: "APPROVE" as const } : {}),
                recheckCanPublish: () =>
                  canPublishVisibleOutput("finalized clean review canonical Review Details merge"),
              });
              logCanonicalReviewDetailsPublicationCompleted(finalizedCleanReviewDetails);
            }

            reviewOutputPublished = true;
            reviewPublishResolution = config.review.autoApprove ? "auto-approval" : "clean-review-comment";

            logger.info(
              {
                evidenceType: "review",
                outcome: config.review.autoApprove ? "submitted-approval" : "published-comment-approval",
                deliveryId: event.id,
                installationId: event.installationId,
                owner: apiOwner,
                repoName: apiRepo,
                repo: `${apiOwner}/${apiRepo}`,
                prNumber: pr.number,
                reviewOutputKey,
              },
              "Evidence bundle",
            );
            logger.info(
              { prNumber: pr.number, reviewOutputKey },
              config.review.autoApprove
                ? "Submitted silent approval (no issues found)"
                : "Published clean review comment (no issues found)",
            );
          } catch (err) {
            logger.error(
              { err, prNumber: pr.number },
              config.review.autoApprove
                ? "Failed to submit approval"
                : "Failed to publish clean review comment",
            );
          }
        }
      } catch (err) {
        if (!reviewPhaseTimings.has("workspace preparation") && workspacePhaseStartedAt !== undefined) {
          reviewPhaseTimings.set(
            "workspace preparation",
            createReviewPhaseTiming({
              name: "workspace preparation",
              status: "degraded",
              durationMs: Math.max(0, Date.now() - workspacePhaseStartedAt),
              detail: "workspace preparation failed",
            }),
          );
        }

        if (!reviewPhaseTimings.has("retrieval/context assembly") && retrievalPhaseStartedAt !== undefined) {
          reviewPhaseTimings.set(
            "retrieval/context assembly",
            createReviewPhaseTiming({
              name: "retrieval/context assembly",
              status: "degraded",
              durationMs: Math.max(0, Date.now() - retrievalPhaseStartedAt),
              detail: "retrieval/context assembly failed",
            }),
          );
        }

        if (publicationPhaseStartedAt === undefined) {
          publicationPhaseStartedAt = Date.now();
        }

        logger.error(
          { err, prNumber: pr.number },
          "Review handler failed",
        );

        // Post error comment to PR so the user knows something went wrong
        const category = classifyError(err, false);
        const detail = err instanceof Error ? err.message : "An unexpected error occurred";
        const errorBody = formatErrorComment(category, detail);
        try {
          const errOctokit = await githubApp.getInstallationOctokit(event.installationId);
          if (canPublishVisibleOutput("handler failure error comment")) {
            setReviewWorkPhase("publish");
            await postOrUpdateErrorComment(errOctokit, {
              owner: apiOwner,
              repo: apiRepo,
              issueNumber: pr.number,
            }, sanitizeOutgoingMentions(errorBody, [githubApp.getAppSlug(), "claude"]), logger);
            reviewPhaseTimings.set(
              "publication",
              createReviewPhaseTiming({
                name: "publication",
                status: "degraded",
                durationMs: Math.max(0, Date.now() - publicationPhaseStartedAt),
                detail: "posted error comment after handler failure",
              }),
            );
          } else {
            reviewPhaseTimings.set(
              "publication",
              createReviewPhaseTiming({
                name: "publication",
                status: "degraded",
                durationMs: Math.max(0, Date.now() - publicationPhaseStartedAt),
                detail: "suppressed error comment after handler failure because publish rights were lost",
              }),
            );
          }
        } catch (commentErr) {
          logger.error({ err: commentErr }, "Failed to post error comment to PR");
          reviewPhaseTimings.set(
            "publication",
            createReviewPhaseTiming({
              name: "publication",
              status: "degraded",
              durationMs: Math.max(0, Date.now() - publicationPhaseStartedAt),
              detail: "failed to publish error comment after handler failure",
            }),
          );
        }
      } finally {
        for (const phase of executorPhaseTimings) {
          if (!reviewPhaseTimings.has(phase.name)) {
            reviewPhaseTimings.set(phase.name, phase);
          }
        }

        if (publicationPhaseStartedAt !== undefined && !reviewPhaseTimings.has("publication")) {
          reviewPhaseTimings.set(
            "publication",
            createReviewPhaseTiming({
              name: "publication",
              status: "completed",
              durationMs: Math.max(0, Date.now() - publicationPhaseStartedAt),
            }),
          );
        }

        logReviewExecutionCompleted();

        const shouldLogPhaseSummary =
          workspacePhaseStartedAt !== undefined ||
          retrievalPhaseStartedAt !== undefined ||
          publicationPhaseStartedAt !== undefined ||
          executorResult !== undefined;

        if (
          shouldLogPhaseSummary &&
          typeof event.id === "string" &&
          event.id.length > 0 &&
          reviewOutputKey.length > 0
        ) {
          const phases = buildOrderedReviewPhaseSummary(reviewPhaseTimings);
          const totalDurationMs = Math.max(0, Date.now() - totalPhaseStartAt);
          try {
            const expectedTurnLimitOutcome = isExpectedTurnLimitOutcome(executorResult);
            logger.info(
              {
                deliveryId: event.id,
                reviewOutputKey,
                installationId: event.installationId,
                repo: `${apiOwner}/${apiRepo}`,
                prNumber: pr.number,
                conclusion: expectedTurnLimitOutcome ? "expected_bounded" : executorResult?.conclusion,
                ...(expectedTurnLimitOutcome
                  ? { boundedOutcomeReason: "max_turns" }
                  : {}),
                published: executorResult ? reviewOutputPublished : undefined,
                publishResolution: executorResult
                  ? expectedTurnLimitOutcome
                    ? cleanTurnLimitPublishResolution(reviewPublishResolution)
                    : reviewPublishResolution
                  : undefined,
                publishFallbackDelivery: reviewPublishFallbackDelivery,
                totalDurationMs,
                phases,
              },
              "Review phase timing summary",
            );
          } catch {
            // logging failures must never block review publication
          }
        }

        if (workspace) {
          await workspace.cleanup();
        }
      }
    }, {
      deliveryId: event.id,
      eventName: event.name,
      action,
      lane: "review",
      key: reviewFamilyKey,
      jobType: "pull-request-review",
      prNumber: pr.number,
    });
  } finally {
    finalizeReviewWorkAttempt();
  }

  logger.info(
    { ...baseLog, gate: "enqueue", gateResult: "completed" },
    "Review enqueue completed",
  );
}

// Register for review trigger events
eventRouter.register("pull_request.opened", handleReview);
eventRouter.register("pull_request.ready_for_review", handleReview);
eventRouter.register("pull_request.review_requested", handleReview);
eventRouter.register("pull_request.synchronize", handleReview);
}
