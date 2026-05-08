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
import type { TelemetryStore } from "../telemetry/types.ts";
import type {
  KnowledgeStore,
  PriorFinding,
  ContinuationFamilyAuthoritativeOutcome,
  ContinuationFamilyFinalStopReason,
  ContinuationFamilyProjectionStatus,
} from "../knowledge/types.ts";
import type { LearningMemoryStore, EmbeddingProvider, LearningMemoryRecord } from "../knowledge/types.ts";
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

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function hashPromptString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return sha256Hex(value);
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

function mergeReviewDetailsIntoSummaryBody(params: {
  summaryBody: string;
  reviewDetailsBlock: string;
  requireDegradationDisclosure: boolean;
  reviewBoundedness?: ReviewBoundednessContract | null;
}): string {
  let updatedReviewDetails = params.reviewDetailsBlock;
  let summaryBody = ensureReviewBoundednessDisclosureInSummary(
    params.summaryBody,
    params.reviewBoundedness,
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

    logger.warn(
      {
        ...baseLog,
        gate: "diff-collection",
        stage,
        reason,
        strategy: "github-pr-files-fallback",
        deepenAttempts,
        unshallowAttempted,
        mergeBaseRecovered,
        diffRange,
        changedFilesCount: changedFiles.length,
        patchFilesCount: uniqueFiles.filter((file) => typeof file.patch === "string" && file.patch.trim().length > 0).length,
      },
      "Diff collection degraded to GitHub PR files fallback",
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

  logger.warn(
    {
      ...baseLog,
      gate: "diff-collection",
      stage,
      reason,
      strategy: "github-file-list-fallback",
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
    statusTarget: { status: "hit" | "miss" | "degraded" | "bypass"; reason: string | null };
  }): Promise<PromptBuildResult> {
    const fingerprintResult = buildReviewPromptFingerprint(params.context);
    if (!fingerprintResult.fingerprint) {
      params.statusTarget.status = "bypass";
      params.statusTarget.reason = fingerprintResult.missingSignals.join(",") || "incomplete-fingerprint";
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
      return result;
    } catch (error) {
      params.statusTarget.status = "degraded";
      params.statusTarget.reason = "prompt-build-failed";
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

        // Fork PR / deleted fork: fetch PR head ref from base repo
        if (usesPrRef) {
          await fetchAndCheckoutPullRequestHeadRef({
            dir: workspace.dir,
            prNumber: pr.number,
            localBranch: "pr-review",
            token: workspace.token,
            fallbackRemoteUrl: pr.head.repo ? `https://github.com/${pr.head.repo.full_name}.git` : undefined,
            fallbackRef: pr.head.ref,
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
        // Load repo config (.kodiai.yml) with defaults
        const { config, warnings } = await loadRepoConfig(workspace.dir);
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
        let structuralImpactForReview: import("../structural-impact/types.ts").StructuralImpactPayload | null = null;
        if (reviewGraphQuery) {
          // Trivial-change bypass: skip graph query overhead for small PRs.
          const trivialCheck = isTrivialChange({
            changedFileCount: reviewFiles.length,
            totalLinesChanged: (diffAnalysis?.metrics.totalLinesAdded ?? 0) + (diffAnalysis?.metrics.totalLinesRemoved ?? 0),
          });

          if (trivialCheck.bypass) {
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
        const tieredFiles = triageFilesByRisk({
          riskScores: graphSelection.riskScores,
          fileThreshold: config.largePR.fileThreshold,
          fullReviewCount: config.largePR.fullReviewCount,
          abbreviatedCount: config.largePR.abbreviatedCount,
          totalFileCount: changedFiles.length,
        });

        // Build the file list for the prompt: only full + abbreviated tier files
        const promptFiles = tieredFiles.isLargePR
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

            if (config.telemetry.enabled) {
              try {
                const totalEmbeddingLookups = (result?.provenance.embeddingRequests ?? 0) + (result?.provenance.embeddingCacheHits ?? 0);
                await telemetryStore.recordRateLimitEvent({
                  deliveryId: event.id,
                  executionIdentity: `${event.id}:reuse.retrieval-query-embedding.main`,
                  repo: `${apiOwner}/${apiRepo}`,
                  prNumber: pr.number,
                  eventType: "reuse.retrieval-query-embedding.main",
                  cacheHitRate: totalEmbeddingLookups > 0
                    ? (result?.provenance.embeddingCacheHits ?? 0) / totalEmbeddingLookups
                    : 0,
                  skippedQueries: result?.provenance.embeddingCacheHits ?? 0,
                  retryAttempts: result?.provenance.embeddingRequests ?? 0,
                  degradationPath: result == null
                    ? "degraded"
                    : (result.provenance.embeddingCacheHits > 0 ? "hit" : "miss"),
                });
              } catch (err) {
                logger.warn(
                  { ...baseLog, err },
                  "Review retrieval reuse telemetry write failed (non-blocking)",
                );
              }
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
            gate: "timeout-estimation",
            riskLevel: timeoutEstimate.riskLevel,
            dynamicTimeout: timeoutEstimate.dynamicTimeoutSeconds,
            remoteRuntimeBudgetSeconds: timeoutEstimate.remoteRuntimeBudgetSeconds,
            infraOverheadBudgetSeconds: timeoutEstimate.infraOverheadBudgetSeconds,
            totalTimeoutSeconds: timeoutEstimate.totalTimeoutSeconds,
            shouldReduceScope: timeoutEstimate.shouldReduceScope,
            complexity: timeoutEstimate.reasoning,
          },
          "Timeout risk estimated",
        );

        const checkpointEnabled =
          reviewRouting.taskType === TASK_TYPES.REVIEW_FULL ||
          timeoutEstimate.riskLevel === "medium" ||
          timeoutEstimate.riskLevel === "high";

        // TMO-02: Scope reduction for high-risk auto-profile PRs
        const requestedProfileSelection = { ...profileSelection };
        let timeoutReductionApplied = false;
        let timeoutReductionSkippedReason: "explicit-profile" | "config-disabled" | null = null;
        if (
          timeoutEstimate.shouldReduceScope &&
          profileSelection.source === "auto" &&
          config.timeout.autoReduceScope !== false
        ) {
          // Override to minimal profile
          profileSelection.selectedProfile = "minimal";
          const minimalPreset = PROFILE_PRESETS["minimal"];
          if (minimalPreset) {
            resolvedSeverityMinLevel = minimalPreset.severityMinLevel;
            resolvedMaxComments = minimalPreset.maxComments;
            resolvedFocusAreas = [...minimalPreset.focusAreas];
            resolvedIgnoredAreas = [...minimalPreset.ignoredAreas];
          }

          // Cap file count if needed
          if (
            timeoutEstimate.reducedFileCount !== null &&
            tieredFiles.full.length > timeoutEstimate.reducedFileCount
          ) {
            const excess = tieredFiles.full.splice(timeoutEstimate.reducedFileCount);
            tieredFiles.abbreviated.push(...excess);
          }

          timeoutReductionApplied = true;
          logger.info(
            {
              ...baseLog,
              gate: "timeout-scope-reduction",
              originalProfile: requestedProfileSelection.selectedProfile,
              reducedProfile: "minimal",
              originalFileCount: tieredFiles.full.length + (tieredFiles.abbreviated.length - (timeoutEstimate.reducedFileCount !== null ? tieredFiles.abbreviated.length : 0)),
              reducedFileCount: timeoutEstimate.reducedFileCount,
            },
            "Auto-reduced review scope for high timeout risk",
          );
        } else if (timeoutEstimate.shouldReduceScope && profileSelection.source !== "auto") {
          timeoutReductionSkippedReason = "explicit-profile";
          logger.warn(
            {
              ...baseLog,
              gate: "timeout-scope-reduction",
              gateResult: "skipped",
              skipReason: timeoutReductionSkippedReason,
              profile: profileSelection.selectedProfile,
              source: profileSelection.source,
            },
            "Skipping scope reduction: user explicitly configured profile",
          );
        } else if (timeoutEstimate.shouldReduceScope && config.timeout.autoReduceScope === false) {
          timeoutReductionSkippedReason = "config-disabled";
          logger.info(
            {
              ...baseLog,
              gate: "timeout-scope-reduction",
              gateResult: "skipped",
              skipReason: timeoutReductionSkippedReason,
              profile: profileSelection.selectedProfile,
              source: profileSelection.source,
            },
            "Skipping scope reduction because timeout auto-reduction is disabled",
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
          smallDiffReview: reviewRouting.taskType === TASK_TYPES.REVIEW_SMALL_DIFF,
        } satisfies ReviewPromptBuildContext;
        const reviewPromptCacheState: {
          status: "hit" | "miss" | "degraded" | "bypass";
          reason: string | null;
        } = {
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
        logger.info(
          {
            ...baseLog,
            gate: "review-derived-prompt-cache",
            gateResult: reviewPromptDerivedCacheStatus,
            ...(reviewPromptDerivedCacheReason ? { reason: reviewPromptDerivedCacheReason } : {}),
          },
          "Resolved review prompt derived-cache state",
        );
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
          knowledgeStore,
          totalFiles: changedFiles.length,
          enableCheckpointTool: checkpointEnabled,
          // TMO-04: total timeout = infra overhead cushion + complexity-scaled remote runtime budget
          dynamicTimeoutSeconds: appliedTimeoutBudget
            ? appliedTimeoutBudget.totalTimeoutSeconds
            : undefined,
          maxTurnsOverride: reviewMaxTurnsOverride,
        });
        executorResult = result;
        executorPhaseTimings = result.executorPhaseTimings ?? buildExecutorUnavailablePhases(
          "executor phase timings unavailable",
        );
        for (const phase of executorPhaseTimings) {
          reviewPhaseTimings.set(phase.name, phase);
        }
        publicationPhaseStartedAt = Date.now();

        executorResult = result;
        executorPhaseTimings = result.executorPhaseTimings ?? buildExecutorUnavailablePhases(
          "executor phase timings unavailable",
        );
        for (const phase of executorPhaseTimings) {
          reviewPhaseTimings.set(phase.name, phase);
        }
        publicationPhaseStartedAt = Date.now();

        logger.info(
          {
            prNumber: pr.number,
            conclusion: result.conclusion,
            published: result.published,
            costUsd: result.costUsd,
            numTurns: result.numTurns,
            durationMs: result.durationMs,
            sessionId: result.sessionId,
          },
          "Review execution completed",
        );

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

        // Language-aware enforcement (LANG-01 through LANG-10)
        // Runs between finding extraction and existing suppression matching.
        // Fail-open: errors log warning and return findings unchanged.
        const enforcedFindings = extractedFindings.length > 0
          ? await applyEnforcement({
              findings: extractedFindings,
              workspaceDir: workspace.dir,
              filesByCategory: diffAnalysis?.filesByCategory ?? {},
              filesByLanguage: diffAnalysis?.filesByLanguage ?? {},
              languageRules: config.languageRules,
              logger,
            })
          : [];

        const toolingSuppressedCount = enforcedFindings.filter(f => f.toolingSuppressed).length;
        const severityElevatedCount = enforcedFindings.filter(f => f.severityElevated).length;
        if (toolingSuppressedCount > 0 || severityElevatedCount > 0) {
          logger.info(
            { ...baseLog, toolingSuppressedCount, severityElevatedCount },
            "Language enforcement applied",
          );
        }

        // Feedback-driven suppression (FEED-01 through FEED-10)
        // Runs after enforcement, before config suppression matching.
        // Early returns empty when feedback.autoSuppress.enabled is false (FEED-08).
        // Fail-open: errors log warning and return empty suppression set.
        const feedbackSuppression = knowledgeStore
          ? await evaluateFeedbackSuppressions({
              store: knowledgeStore,
              repo: `${apiOwner}/${apiRepo}`,
              config: config.feedback.autoSuppress,
              logger,
            })
          : { suppressedFingerprints: new Set<string>(), suppressedPatternCount: 0, patterns: [] };

        if (feedbackSuppression.suppressedPatternCount > 0) {
          logger.info(
            { ...baseLog, feedbackSuppressedPatterns: feedbackSuppression.suppressedPatternCount },
            "Feedback-driven suppression applied",
          );
        }

        // Thematic cluster scoring placeholder — model resolved in the scoring step below (M037/S03).
        // applyClusterScoringWithDegradation handles model load, eligibility, and scoring in one call.

        // Post-LLM abbreviated tier enforcement (LARGE-08)
        // Suppress medium/minor findings on abbreviated-tier files deterministically.
        const abbreviatedFileSet = tieredFiles.isLargePR
          ? new Set(tieredFiles.abbreviated.map(f => f.filePath))
          : new Set<string>();

        // Post-LLM claim classification (CLAIM-01 through CLAIM-03)
        // Classifies each finding's claims as diff-grounded, external-knowledge, or inferential.
        // Fail-open: errors log warning and return findings unchanged.
        const fileDiffs = diffContext.diffContent
          ? buildFileDiffsMap(splitDiffByFile(diffContext.diffContent))
          : new Map();
        const classifiedFindings = classifyClaims({
          findings: enforcedFindings as unknown as Array<ExtractedFinding & Record<string, unknown>>,
          fileDiffs,
          prDescription: pr.body ?? null,
          commitMessages: commitMessagesForLinking,
        });
        const claimClassificationMap = new Map(
          classifiedFindings.map((f) => [f.commentId, f.claimClassification]),
        );
        const externalClaimCount = classifiedFindings.filter(
          (f) => f.claimClassification?.summaryLabel === "primarily-external",
        ).length;
        const mixedClaimCount = classifiedFindings.filter(
          (f) => f.claimClassification?.summaryLabel === "mixed",
        ).length;
        if (externalClaimCount > 0 || mixedClaimCount > 0) {
          logger.info(
            { ...baseLog, externalClaimFindings: externalClaimCount, mixedClaimFindings: mixedClaimCount },
            "Claim classification applied",
          );
        }

        // Severity demotion: cap primarily-external findings at medium (SEV-01, SEV-02)
        const demotedFindings = demoteExternalClaimSeverities(
          (enforcedFindings as unknown as DemotableFinding[]).map((f) => ({
            ...f,
            claimClassification: claimClassificationMap.get((f as unknown as { commentId: number }).commentId),
          })),
          logger,
        );
        const demotionMap = new Map(
          demotedFindings
            .filter((f) => f.severityDemoted)
            .map((f) => [f.commentId, {
              severity: f.severity as FindingSeverity,
              preDemotionSeverity: f.preDemotionSeverity!,
              demotionReason: f.demotionReason!,
            }]),
        );
        const demotionCount = demotedFindings.filter((f) => f.severityDemoted).length;
        if (demotionCount > 0) {
          logger.info(
            { ...baseLog, demotedFindings: demotionCount },
            "Severity demotion applied to external-claim findings",
          );
        }

        const suppressionMatchCounts = new Map<string, number>();
        // Enforcement preserves all ExtractedFinding fields; cast back to the
        // intersection so downstream code can access commentId, startLine, etc.
        type EnforcedExtractedFinding = ExtractedFinding & {
          originalSeverity: FindingSeverity;
          severityElevated: boolean;
          toolingSuppressed: boolean;
          enforcementPatternId?: string;
        };
        let processedFindings: ProcessedFinding[] = (enforcedFindings as EnforcedExtractedFinding[]).map((finding) => {
          const category = finding.category;
          const matchedSuppression = config.review.suppressions.find((suppression) =>
            matchesSuppression(
              {
                filePath: finding.filePath,
                title: finding.title,
                severity: finding.severity,
                category,
              },
              suppression,
            )
          );
          // Incremental dedup suppression (REV-02)
          const dedupSuppressed = priorFindingCtx
            ? shouldSuppressFinding({
                filePath: finding.filePath,
                titleFingerprint: fingerprintFindingTitle(finding.title),
                suppressionFingerprints: priorFindingCtx.suppressionFingerprints,
              })
            : false;
          // Abbreviated tier enforcement: suppress medium/minor findings on abbreviated files
          const abbreviatedSuppressed = abbreviatedFileSet.has(finding.filePath)
            && (finding.severity === "medium" || finding.severity === "minor");
          // Feedback-driven suppression: suppress findings whose title fingerprint is in the suppression set
          const titleFp = fingerprintFindingTitle(finding.title);
          const feedbackSuppressed = feedbackSuppression.suppressedFingerprints.has(titleFp);
          const suppressed = finding.toolingSuppressed || Boolean(matchedSuppression) || dedupSuppressed || abbreviatedSuppressed || feedbackSuppressed;
          const suppressionPattern = typeof matchedSuppression === "string"
            ? matchedSuppression
            : matchedSuppression?.pattern;
          if (suppressionPattern) {
            const existing = suppressionMatchCounts.get(suppressionPattern) ?? 0;
            suppressionMatchCounts.set(suppressionPattern, existing + 1);
          }

          // Confidence: base score adjusted by feedback history when pattern data exists
          const feedbackPattern = feedbackSuppression.patterns.find(p => p.fingerprint === titleFp);
          const baseConfidence = computeConfidence({
            severity: finding.severity,
            category,
            matchesKnownPattern: Boolean(matchedSuppression),
          });
          const confidence = feedbackPattern
            ? adjustConfidenceForFeedback(baseConfidence, {
                thumbsUp: feedbackPattern.thumbsUpCount,
                thumbsDown: feedbackPattern.thumbsDownCount,
              })
            : baseConfidence;

          // Apply severity demotion for primarily-external findings (SEV-01, SEV-02)
          const demotion = demotionMap.get(finding.commentId);
          const effectiveSeverity = demotion ? demotion.severity : finding.severity;

          return {
            ...finding,
            severity: effectiveSeverity,
            category,
            suppressed,
            confidence,
            suppressionPattern,
            claimClassification: claimClassificationMap.get(finding.commentId),
            preDemotionSeverity: demotion?.preDemotionSeverity,
            severityDemoted: demotion ? true : undefined,
            demotionReason: demotion?.demotionReason,
          };
        });

        // Thematic cluster scoring (M037/S03): score processed findings against
        // positive/negative centroids using the fail-open degradation wrapper.
        // Runs after feedback suppression so cluster signal applies to feedback-adjusted
        // confidence values. All error paths degrade cleanly — review always completes.
        {
          const clusterResult = await applyClusterScoringWithDegradation(
            processedFindings.map(f => ({
              ...f,
              // ClusterScoringFinding shape — extra fields preserved via spread
            })),
            clusterModelStore ?? null,
            embeddingProvider ?? null,
            `${apiOwner}/${apiRepo}`,
            logger,
          );
          if (clusterResult.modelUsed) {
            // Merge adjusted findings back (confidence and suppressed fields may have changed)
            processedFindings = processedFindings.map((f, i) => {
              const adj = clusterResult.findings[i];
              if (!adj) return f;
              return { ...f, confidence: adj.confidence, suppressed: adj.suppressed };
            });
          }
        }

        // Output filtering: rewrite mixed findings, suppress primarily-external findings (FILT-01, FILT-02)
        const filterResult = filterExternalClaims(
          processedFindings as FilterableFinding[],
          logger,
        );

        if (filterResult.suppressionCount > 0 || filterResult.rewriteCount > 0) {
          const suppressedIds = new Set(
            filterResult.filtered
              .filter(r => r.action === "suppressed")
              .map(r => r.commentId),
          );
          const rewriteMap = new Map(
            filterResult.filtered
              .filter(r => r.action === "rewritten")
              .map(r => [r.commentId, r.rewrittenTitle!]),
          );

          processedFindings = processedFindings.map(f => {
            if (suppressedIds.has(f.commentId)) {
              return { ...f, suppressed: true, filterAction: "suppressed" as const, originalTitle: f.title };
            }
            const rewrittenTitle = rewriteMap.get(f.commentId);
            if (rewrittenTitle) {
              return { ...f, title: rewrittenTitle, filterAction: "rewritten" as const, originalTitle: f.title };
            }
            return f;
          });

          // Log filter summary (FILT-03)
          logger.info(
            {
              ...baseLog,
              rewriteCount: filterResult.rewriteCount,
              suppressionCount: filterResult.suppressionCount,
              filteredFindings: filterResult.filtered.map(r => ({
                commentId: r.commentId,
                action: r.action,
                originalTitle: r.originalTitle.slice(0, 100),
                reason: r.reason,
              })),
            },
            "Output filter applied: external knowledge claims filtered",
          );
        }

        // Unified guardrail pipeline (GUARD-01): authoritative claim-level filtering.
        // Runs after existing classifyClaims+filterExternalClaims for defense-in-depth.
        // Fail-open: on error, existing filter results are used as fallback.
        try {
          const guardResult = await runGuardrailPipeline({
            adapter: reviewAdapter,
            input: {
              findings: enforcedFindings as unknown as Array<import("../lib/claim-classifier.ts").FindingForClassification>,
              fileDiffs,
              prDescription: pr.body ?? null,
              commitMessages: commitMessagesForLinking,
            } satisfies ReviewInput,
            output: {
              findings: processedFindings as unknown as import("../lib/guardrail/adapters/review-adapter.ts").ReviewFinding[],
            },
            config: { strictness: config.guardrails?.strictness ?? "standard" },
            repo: `${apiOwner}/${apiRepo}`,
            auditStore: guardrailAuditStore,
          });
          if (guardResult.claimsRemoved > 0) {
            logger.info(
              {
                ...baseLog,
                guardrailClaimsTotal: guardResult.claimsTotal,
                guardrailClaimsRemoved: guardResult.claimsRemoved,
                guardrailSuppressed: guardResult.suppressed,
              },
              "Guardrail pipeline applied to review findings",
            );
          }
          // Apply guardrail result: replace processedFindings with filtered output (GUARD-01).
          // Owner decision: guardrail pipeline is authoritative for reviews, not shadow/audit-only.
          if (guardResult.output !== null && !guardResult.suppressed) {
            processedFindings = processedFindings.map((f) => {
              const kept = guardResult.output!.findings.find((gf) => gf.commentId === f.commentId);
              if (!kept) {
                // Finding was removed by guardrail -- suppress it
                return { ...f, suppressed: true, filterAction: "guardrail-suppressed" as const, originalTitle: f.title };
              }
              if (kept.title !== f.title) {
                // Finding title was rewritten by guardrail
                return { ...f, title: kept.title, filterAction: "guardrail-rewritten" as const, originalTitle: f.title };
              }
              return f;
            });
          }
        } catch (guardErr) {
          logger.warn(
            { ...baseLog, err: guardErr },
            "Guardrail pipeline failed (fail-open, existing filter results used)",
          );
        }

        // Optional graph-amplified finding validation (M040/S03).
        // Runs only when graphBlastRadius is available and config.review.graphValidation.enabled=true.
        // Fail-open: errors log a warning and leave processedFindings unchanged.
        if (graphBlastRadius && (config.review as Record<string, unknown> & { graphValidation?: { enabled?: boolean } }).graphValidation?.enabled) {
          try {
            const graphValidationLLM = {
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
            };

            const graphValidationInput = processedFindings.map((f) => ({
              id: f.commentId,
              filePath: f.filePath,
              title: f.title,
              severity: f.severity,
            } satisfies GraphValidationFinding));

            const validationResult = await validateGraphAmplifiedFindings(
              graphValidationInput,
              graphBlastRadius,
              graphValidationLLM,
              { enabled: true },
              logger,
            );

            if (validationResult.succeeded && validationResult.validatedCount > 0) {
              logger.info(
                {
                  ...baseLog,
                  gate: "graph-amplified-validation",
                  validatedCount: validationResult.validatedCount,
                  confirmedCount: validationResult.confirmedCount,
                  uncertainCount: validationResult.uncertainCount,
                },
                "Graph-amplified finding validation applied",
              );

              // Attach graphValidationVerdict to processedFindings for downstream telemetry.
              const verdictMap = new Map(
                validationResult.findings.map((f) => [f.id, { graphValidated: f.graphValidated, graphValidationVerdict: f.graphValidationVerdict }]),
              );
              processedFindings = processedFindings.map((f) => {
                const v = verdictMap.get(f.commentId);
                if (!v) return f;
                return { ...f, ...v };
              });
            } else if (!validationResult.succeeded) {
              logger.warn(
                { ...baseLog, gate: "graph-amplified-validation", error: validationResult.errorMessage },
                "Graph-amplified finding validation failed (fail-open, continuing without validation)",
              );
            }
          } catch (validationErr) {
            logger.warn(
              { ...baseLog, gate: "graph-amplified-validation", err: validationErr },
              "Graph-amplified finding validation threw unexpectedly (fail-open)",
            );
          }
        }

        const recurrenceCounts = new Map<string, number>();
        for (const finding of processedFindings) {
          if (finding.suppressed || finding.confidence < config.review.minConfidence) {
            continue;
          }
          const fingerprint = fingerprintFindingTitle(finding.title);
          recurrenceCounts.set(fingerprint, (recurrenceCounts.get(fingerprint) ?? 0) + 1);
        }

        const fileRiskByPath = new Map(riskScores.map((risk) => [risk.filePath, risk.score]));

        let visibleFindings = processedFindings.filter((finding) =>
          !finding.suppressed && finding.confidence >= config.review.minConfidence
        );

        let prioritizationStats: {
          findingsScored: number;
          topScore: number | null;
          thresholdScore: number | null;
          maxComments?: number;
          selectedFindings?: number;
          omittedFindings?: number;
        } | undefined;

        if (visibleFindings.length > resolvedMaxComments) {
          const prioritized = prioritizeFindings({
            findings: visibleFindings.map((finding) => {
              const titleFingerprint = fingerprintFindingTitle(finding.title);
              return {
                ...finding,
                fileRiskScore: fileRiskByPath.get(finding.filePath) ?? 0,
                recurrenceCount: recurrenceCounts.get(titleFingerprint) ?? 1,
              };
            }),
            maxComments: resolvedMaxComments,
            weights: config.review.prioritization,
          });

          prioritizationStats = {
            ...prioritized.stats,
            maxComments: resolvedMaxComments,
            selectedFindings: prioritized.selectedFindings.length,
            omittedFindings: Math.max(0, visibleFindings.length - prioritized.selectedFindings.length),
          };

          const selectedOriginalIndexes = new Set(
            prioritized.selectedFindings.map((finding) => finding.originalIndex),
          );
          const selectedCommentIds = new Set(
            visibleFindings
              .filter((_, index) => selectedOriginalIndexes.has(index))
              .map((finding) => finding.commentId),
          );

          processedFindings = processedFindings.map((finding) => {
            if (finding.suppressed || finding.confidence < config.review.minConfidence) {
              return finding;
            }

            if (selectedCommentIds.has(finding.commentId)) {
              return finding;
            }

            return {
              ...finding,
              deprioritized: true,
            };
          });

          visibleFindings = processedFindings.filter((finding) =>
            !finding.suppressed && !finding.deprioritized && finding.confidence >= config.review.minConfidence
          );
        }

        const lowConfidenceFindings = processedFindings.filter((finding) =>
          !finding.suppressed && finding.confidence < config.review.minConfidence
        );
        const filteredInlineFindings = processedFindings.filter((finding) =>
          finding.suppressed || finding.confidence < config.review.minConfidence || Boolean(finding.deprioritized)
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
          const reviewDetailsBody = formatReviewDetailsSummary({
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
            prioritization: prioritizationStats,
            usageLimit: result.usageLimit,
            tokenUsage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens, costUsd: result.costUsd },
            structuralImpact: structuralImpactForReview,
            phaseTimingSummary: buildReviewDetailsPhaseTimingSummary({
              phases: reviewPhaseTimings,
              publicationPhaseStartedAt,
              totalPhaseStartAt,
            }),
            timeoutProgress: params?.timeoutProgress,
            timeoutBudget: params?.timeoutBudget,
            lineCountSource: reviewDetailsLineCounts.source,
          });

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
                } catch (appendErr) {
                  logger.warn(
                    { ...baseLog, gate: "review-details-output", gateResult: "degraded-fallback", err: appendErr },
                    "Failed to update canonical review surface with Review Details; using degraded fallback comment",
                  );
                  if (canPublishVisibleOutput("degraded Review Details fallback comment")) {
                    setReviewWorkPhase("publish");
                    await upsertDegradedReviewDetailsFallbackComment({
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
              const approvalWillOwnCanonicalSurface = result.conclusion === "success";

              if (!approvalWillOwnCanonicalSurface && canPublishVisibleOutput("degraded Review Details fallback comment")) {
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

            for (const finding of processedFindings) {
              try {
                // Determine outcome from finding state
                const outcome: string = finding.suppressed ? 'suppressed' : 'accepted';

                // Build embedding text: finding title + severity + category + file path for context
                const embeddingText = [
                  `[${finding.severity}] [${finding.category}]`,
                  finding.title,
                  `File: ${finding.filePath}`,
                ].join('\n');

                const embeddingResult = await embeddingProvider.generate(embeddingText, 'document');
                if (!embeddingResult) {
                  // Embedding failed (already logged by provider), skip this finding
                  failed++;
                  continue;
                }

                const memoryRecord: LearningMemoryRecord = {
                  repo,
                  owner,
                  findingId: finding.commentId, // Use comment ID as finding reference
                  reviewId: reviewId ?? 0,       // reviewId from knowledge store recordReview above
                  sourceRepo: repo,
                  findingText: finding.title,
                  severity: finding.severity,
                  category: finding.category,
                  filePath: finding.filePath,
                  outcome: outcome as LearningMemoryRecord["outcome"],
                  embeddingModel: embeddingResult.model,
                  embeddingDim: embeddingResult.dimensions,
                  stale: false,
                  // Context-aware language classification: .h files in C++ PRs become "cpp" (LANG-01)
                  language: classifyFileLanguageWithContext(finding.filePath, changedFiles),
                };

                await learningMemoryStore.writeMemory(memoryRecord, embeddingResult.embedding);
                written++;
              } catch (err) {
                failed++;
                logger.warn(
                  { err, findingTitle: finding.title, filePath: finding.filePath },
                  'Learning memory write failed for finding (fail-open)',
                );
              }
            }

            if (written > 0 || failed > 0) {
              logger.info(
                {
                  ...baseLog,
                  gate: 'learning-memory-write',
                  written,
                  failed,
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
                      smallDiffReview: reviewRouting.taskType === TASK_TYPES.REVIEW_SMALL_DIFF,
                    } satisfies ReviewPromptBuildContext;
                    const retryPromptCacheState: {
                      status: "hit" | "miss" | "degraded" | "bypass";
                      reason: string | null;
                    } = {
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
                      dynamicTimeoutSeconds: retryTimeout,
                      maxTurnsOverride: reviewMaxTurnsOverride,
                      knowledgeStore,
                      totalFiles: timeoutTotalFiles,
                      enableCheckpointTool: retryCheckpointEnabled,
                      enableCommentTools: false,
                    });

                      const retryCheckpoint = (await knowledgeStore?.getCheckpoint?.(retryReviewOutputKey)) ?? null;
                      const retryHasResults =
                        (retryCheckpoint?.findingCount ?? 0) >= 1 ||
                        (retryResult.published ?? false);

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
              await postOrUpdateErrorComment(octokit, {
                owner: apiOwner,
                repo: apiRepo,
                issueNumber: pr.number,
              }, sanitizeOutgoingMentions(errorBody, [githubApp.getAppSlug(), "claude"]), logger);
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
            await postOrUpdateErrorComment(
              octokit,
              {
                owner: apiOwner,
                repo: apiRepo,
                issueNumber: pr.number,
              },
              sanitizeOutgoingMentions(failureBody, [githubApp.getAppSlug(), "claude"]),
              logger,
            );
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
              if (
                canonicalReviewDetailsBody &&
                canPublishVisibleOutput("degraded Review Details fallback comment")
              ) {
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
              return;
            }

            const cleanReviewPublicationReason = config.review.autoApprove
              ? "auto-approval"
              : "clean review publication";
            if (!canPublishVisibleOutput(cleanReviewPublicationReason)) {
              return;
            }

            setReviewWorkPhase("publish");
            const approvalEvidence = [
              `Review prompt covered ${promptFiles.length} changed file${promptFiles.length === 1 ? "" : "s"}.`,
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
              await upsertCanonicalReviewSurface({
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
            }

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
            logger.info(
              {
                deliveryId: event.id,
                reviewOutputKey,
                installationId: event.installationId,
                repo: `${apiOwner}/${apiRepo}`,
                prNumber: pr.number,
                conclusion: executorResult?.conclusion,
                published: executorResult?.published,
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
