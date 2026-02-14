import type {
  PullRequestOpenedEvent,
  PullRequestReadyForReviewEvent,
  PullRequestReviewRequestedEvent,
  PullRequestSynchronizeEvent,
} from "@octokit/webhooks-types";
import type { Logger } from "pino";
import type { EventRouter, WebhookEvent } from "../webhook/types.ts";
import type { JobQueue, WorkspaceManager, Workspace } from "../jobs/types.ts";
import type { GitHubApp } from "../auth/github-app.ts";
import type { createExecutor } from "../execution/executor.ts";
import type { TelemetryStore } from "../telemetry/types.ts";
import type { KnowledgeStore, PriorFinding } from "../knowledge/types.ts";
import type { LearningMemoryStore, EmbeddingProvider, LearningMemoryRecord } from "../learning/types.ts";
import type { IsolationLayer } from "../learning/isolation.ts";
import { computeIncrementalDiff, type IncrementalDiffResult } from "../lib/incremental-diff.ts";
import { buildPriorFindingContext, shouldSuppressFinding, type PriorFindingContext } from "../lib/finding-dedup.ts";
import { classifyFindingDeltas, type DeltaClassification } from "../lib/delta-classifier.ts";
import { loadRepoConfig } from "../execution/config.ts";
import { analyzeDiff, parseNumstatPerFile } from "../execution/diff-analysis.ts";
import { computeFileRiskScores, triageFilesByRisk, type TieredFiles, type FileRiskScore } from "../lib/file-risk-scorer.ts";
import {
  buildReviewPrompt,
  matchPathInstructions,
} from "../execution/review-prompt.ts";
import {
  buildKeywordParsingSection,
  DEFAULT_EMPTY_INTENT,
  parsePRIntent,
  type ParsedPRIntent,
} from "../lib/pr-intent-parser.ts";
import {
  resolveReviewProfile,
  type ResolvedReviewProfile,
} from "../lib/auto-profile.ts";
import { prioritizeFindings } from "../lib/finding-prioritizer.ts";
import { computeConfidence, matchesSuppression } from "../knowledge/confidence.ts";
import { applyEnforcement } from "../enforcement/index.ts";
import { evaluateFeedbackSuppressions, adjustConfidenceForFeedback } from "../feedback/index.ts";
import { classifyError, formatErrorComment, postOrUpdateErrorComment } from "../lib/errors.ts";
import { estimateTimeoutRisk, computeLanguageComplexity } from "../lib/timeout-estimator.ts";
import { buildRetrievalQuery } from "../learning/retrieval-query.ts";
import { rerankByLanguage } from "../learning/retrieval-rerank.ts";
import {
  buildReviewOutputMarker,
  buildReviewOutputKey,
  ensureReviewOutputNotPublished,
} from "./review-idempotency.ts";
import { requestRereviewTeamBestEffort } from "./rereview-team.ts";
import picomatch from "picomatch";
import { $ } from "bun";
import { fetchAndCheckoutPullRequestHeadRef } from "../jobs/workspace.ts";
import { classifyAuthor, type AuthorTier } from "../lib/author-classifier.ts";
import { sanitizeOutgoingMentions } from "../lib/sanitizer.ts";

type ReviewArea = "security" | "correctness" | "performance" | "style" | "documentation";

type FindingSeverity = "critical" | "major" | "medium" | "minor";
type FindingCategory = "security" | "correctness" | "performance" | "style" | "documentation";
type ConfidenceBand = "high" | "medium" | "low";

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
};

type RetrievalContextForPrompt = {
  findings: Array<{
    findingText: string;
    severity: string;
    category: string;
    filePath: string;
    outcome: string;
    distance: number;
    sourceRepo: string;
  }>;
};

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

function toConfidenceBand(confidence: number): ConfidenceBand {
  if (confidence >= 75) return "high";
  if (confidence >= 50) return "medium";
  return "low";
}

function fingerprintFindingTitle(title: string): string {
  const normalized = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ");

  let hash = 2166136261;
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  const unsigned = hash >>> 0;
  return `fp-${unsigned.toString(16).padStart(8, "0")}`;
}

function buildReviewDetailsMarker(reviewOutputKey: string): string {
  return `<!-- kodiai:review-details:${reviewOutputKey} -->`;
}

function formatReviewDetailsSummary(params: {
  reviewOutputKey: string;
  filesReviewed: number;
  linesAdded: number;
  linesRemoved: number;
  findingCounts: {
    critical: number;
    major: number;
    medium: number;
    minor: number;
  };
  largePRTriage?: {
    fullCount: number;
    abbreviatedCount: number;
    mentionOnlyFiles: Array<{ filePath: string; score: number }>;
    totalFiles: number;
  };
  feedbackSuppressionCount?: number;
  keywordParsing?: ParsedPRIntent;
  profileSelection: ResolvedReviewProfile;
  authorTier?: string;
  prioritization?: {
    findingsScored: number;
    topScore: number | null;
    thresholdScore: number | null;
  };
}): string {
  const {
    reviewOutputKey,
    filesReviewed,
    linesAdded,
    linesRemoved,
    findingCounts,
    largePRTriage,
    feedbackSuppressionCount,
    keywordParsing,
    profileSelection,
    authorTier,
    prioritization,
  } = params;

  const profileLine = profileSelection.source === "auto"
    ? `- Profile: ${profileSelection.selectedProfile} (auto, lines changed: ${profileSelection.linesChanged})`
    : profileSelection.source === "manual"
      ? `- Profile: ${profileSelection.selectedProfile} (manual config)`
      : `- Profile: ${profileSelection.selectedProfile} (keyword override)`;

  const sections = [
    "<details>",
    "<summary>Review Details</summary>",
    "",
    `- Files reviewed: ${filesReviewed}`,
    `- Lines changed: +${linesAdded} -${linesRemoved}`,
    profileLine,
    `- Author: ${authorTier ?? "regular"} (${authorTier === "regular" ? "default" : "adapted tone"})`,
    `- Findings: ${findingCounts.critical} critical, ${findingCounts.major} major, ${findingCounts.medium} medium, ${findingCounts.minor} minor`,
    `- Review completed: ${new Date().toISOString()}`,
  ];

  if (largePRTriage) {
    const reviewedCount = largePRTriage.fullCount + largePRTriage.abbreviatedCount;
    const notReviewedCount = largePRTriage.totalFiles - reviewedCount;

    sections.push(
      "",
      `- Review scope: Reviewed ${reviewedCount}/${largePRTriage.totalFiles} files, prioritized by risk`,
      `- Full review: ${largePRTriage.fullCount} files | Abbreviated review: ${largePRTriage.abbreviatedCount} files | Not reviewed: ${notReviewedCount} files`,
    );

    if (largePRTriage.mentionOnlyFiles.length > 0) {
      const MAX_MENTION_ONLY_ENTRIES = 100;
      const cappedFiles = largePRTriage.mentionOnlyFiles.slice(0, MAX_MENTION_ONLY_ENTRIES);
      const remaining = largePRTriage.mentionOnlyFiles.length - cappedFiles.length;

      sections.push(
        "",
        "<details>",
        "<summary>Files not fully reviewed (sorted by risk score)</summary>",
        "",
      );

      for (const file of cappedFiles) {
        sections.push(`- ${file.filePath} (risk: ${file.score})`);
      }

      if (remaining > 0) {
        sections.push(`- ...and ${remaining} more files`);
      }

      sections.push("", "</details>");
    }
  }

  if (feedbackSuppressionCount && feedbackSuppressionCount > 0) {
    sections.push(`- ${feedbackSuppressionCount} pattern${feedbackSuppressionCount === 1 ? '' : 's'} auto-suppressed by feedback`);
  }

  if (prioritization) {
    sections.push(
      `- Prioritization: scored ${prioritization.findingsScored} findings | top score ${prioritization.topScore ?? "n/a"} | threshold score ${prioritization.thresholdScore ?? "n/a"}`,
    );
  }

  const keywordSection = buildKeywordParsingSection(
    keywordParsing ?? DEFAULT_EMPTY_INTENT,
  );
  sections.push(keywordSection);

  sections.push(
    "",
    "</details>",
    "",
    buildReviewDetailsMarker(reviewOutputKey),
  );

  return sections.join("\n");
}

async function upsertReviewDetailsComment(params: {
  octokit: Awaited<ReturnType<GitHubApp["getInstallationOctokit"]>>;
  owner: string;
  repo: string;
  prNumber: number;
  reviewOutputKey: string;
  body: string;
  botHandles: string[];
}): Promise<void> {
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

  if (existingComment) {
    await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existingComment.id,
      body: sanitizedBody,
    });
    return;
  }

  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body: sanitizedBody,
  });
}

async function appendReviewDetailsToSummary(params: {
  octokit: Awaited<ReturnType<GitHubApp["getInstallationOctokit"]>>;
  owner: string;
  repo: string;
  prNumber: number;
  reviewOutputKey: string;
  reviewDetailsBlock: string;
  botHandles: string[];
}): Promise<void> {
  const { octokit, owner, repo, prNumber, reviewOutputKey, reviewDetailsBlock, botHandles } = params;
  const marker = buildReviewOutputMarker(reviewOutputKey);

  const commentsResponse = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: prNumber,
    per_page: 100,
    sort: "created",
    direction: "desc",
  });

  const summaryComment = commentsResponse.data.find((comment) =>
    typeof comment.body === "string" && comment.body.includes(marker)
  );

  if (!summaryComment) {
    throw new Error("Summary comment not found for review output marker");
  }

  const updatedBody = `${summaryComment.body}\n\n${reviewDetailsBlock}`;
  await octokit.rest.issues.updateComment({
    owner,
    repo,
    comment_id: summaryComment.id,
    body: sanitizeOutgoingMentions(updatedBody, botHandles),
  });
}

async function resolveAuthorTier(params: {
  authorLogin: string;
  authorAssociation: string;
  repo: string;
  owner: string;
  repoSlug: string;
  octokit: Awaited<ReturnType<GitHubApp["getInstallationOctokit"]>>;
  knowledgeStore: KnowledgeStore;
  logger: Logger;
}): Promise<{ tier: AuthorTier; prCount: number | null; fromCache: boolean }> {
  const { authorLogin, authorAssociation, repo, owner, repoSlug, octokit, knowledgeStore, logger } = params;

  try {
    const cached = knowledgeStore.getAuthorCache?.({ repo: repoSlug, authorLogin });
    if (cached) {
      return {
        tier: cached.tier as AuthorTier,
        prCount: cached.prCount,
        fromCache: true,
      };
    }
  } catch (err) {
    logger.warn({ err, authorLogin }, "Author cache read failed (fail-open)");
  }

  const ambiguousAssociations = new Set(["NONE", "MANNEQUIN", "COLLABORATOR", "CONTRIBUTOR"]);
  const normalizedAssociation = (authorAssociation || "NONE").toUpperCase();
  let prCount: number | null = null;

  if (ambiguousAssociations.has(normalizedAssociation)) {
    try {
      const { data } = await octokit.rest.search.issuesAndPullRequests({
        q: `repo:${owner}/${repo} type:pr author:${authorLogin} is:merged`,
        per_page: 1,
      });
      prCount = data.total_count;
    } catch (err) {
      logger.warn({ err, authorLogin }, "Author PR count lookup failed (fail-open, proceeding without enrichment)");
    }
  }

  const tier = classifyAuthor({
    authorAssociation: normalizedAssociation,
    prCount,
  }).tier;

  try {
    knowledgeStore.upsertAuthorCache?.({
      repo: repoSlug,
      authorLogin,
      tier,
      authorAssociation: normalizedAssociation,
      prCount,
    });
  } catch (err) {
    logger.warn({ err, authorLogin }, "Author cache write failed (non-fatal)");
  }

  return { tier, prCount, fromCache: false };
}

function normalizeSeverity(value: string | undefined): FindingSeverity | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "critical" || normalized === "major" || normalized === "medium" || normalized === "minor") {
    return normalized;
  }
  return null;
}

function normalizeCategory(value: string | undefined): FindingCategory {
  if (!value) return "correctness";
  const normalized = value.trim().toLowerCase();
  if (normalized === "security") return "security";
  if (normalized === "correctness" || normalized === "error-handling") return "correctness";
  if (normalized === "performance" || normalized === "resource-management" || normalized === "concurrency") {
    return "performance";
  }
  if (normalized === "style") return "style";
  if (normalized === "documentation") return "documentation";
  return "correctness";
}

function parseInlineCommentMetadata(body: string): {
  severity: FindingSeverity | null;
  category: FindingCategory;
  title: string;
} {
  const text = body.replace(/<!--\s*kodiai:review-output-key:[\s\S]*?-->/gi, "").trim();
  const yamlMatch = text.match(/^```yaml\s*([\s\S]*?)```/i);

  if (yamlMatch) {
    const metadataLines = (yamlMatch[1] ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.includes(":"));
    const metadata = new Map<string, string>();
    for (const line of metadataLines) {
      const idx = line.indexOf(":");
      if (idx <= 0) continue;
      const key = line.slice(0, idx).trim().toLowerCase();
      const value = line.slice(idx + 1).trim();
      metadata.set(key, value);
    }

    const titleSection = text.slice(yamlMatch[0].length).trim();
    const titleLine = titleSection
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "Untitled finding";
    const title = titleLine.replace(/^\*\*(.+)\*\*$/, "$1").trim();

    return {
      severity: normalizeSeverity(metadata.get("severity")),
      category: normalizeCategory(metadata.get("category")),
      title,
    };
  }

  const firstLine = text.split("\n").map((line) => line.trim()).find((line) => line.length > 0) ?? "";
  const severityPrefix = firstLine.match(/^\[(critical|major|medium|minor)\]\s*(.*)$/i);
  if (severityPrefix) {
    return {
      severity: normalizeSeverity(severityPrefix[1]),
      category: "correctness",
      title: (severityPrefix[2] || "Untitled finding").trim(),
    };
  }

  return {
    severity: null,
    category: "correctness",
    title: firstLine || "Untitled finding",
  };
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

const PROFILE_PRESETS: Record<string, {
  severityMinLevel: "critical" | "major" | "medium" | "minor";
  maxComments: number;
  ignoredAreas: ReviewArea[];
  focusAreas: ReviewArea[];
}> = {
  strict: {
    severityMinLevel: "minor",
    maxComments: 15,
    ignoredAreas: [],
    focusAreas: [],
  },
  balanced: {
    severityMinLevel: "medium",
    maxComments: 7,
    ignoredAreas: ["style"],
    focusAreas: [],
  },
  minimal: {
    severityMinLevel: "major",
    maxComments: 3,
    ignoredAreas: ["style", "documentation"],
    focusAreas: ["security", "correctness"],
  },
};

/**
 * Normalize a user-authored skip pattern for backward compatibility.
 * - "docs/" -> "docs/**"   (directory shorthand)
 * - "*.md"  -> "**\/*.md"  (extension-only matches nested files)
 */
function normalizeSkipPattern(pattern: string): string {
  const p = pattern.trim();
  if (p.endsWith("/")) return `${p}**`;
  if (p.startsWith("*.")) return `**/${p}`;
  return p;
}

type DiffCollectionStrategy = "triple-dot" | "deepened-triple-dot" | "fallback-two-dot";

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

const DIFF_DEEPEN_STEPS = [50, 150, 300];

function splitGitLines(output: string): string[] {
  return output.trim().split("\n").filter(Boolean);
}

async function hasMergeBase(workspaceDir: string, baseRef: string): Promise<boolean> {
  const mergeBaseResult = await $`git -C ${workspaceDir} merge-base origin/${baseRef} HEAD`.quiet().nothrow();
  return mergeBaseResult.exitCode === 0;
}

async function collectDiffContext(params: {
  workspaceDir: string;
  baseRef: string;
  maxFilesForFullDiff: number;
  logger: Logger;
  baseLog: Record<string, unknown>;
}): Promise<DiffCollectionResult> {
  const { workspaceDir, baseRef, maxFilesForFullDiff, logger, baseLog } = params;

  let strategy: DiffCollectionStrategy = "triple-dot";
  let mergeBaseRecovered = false;
  let deepenAttempts = 0;
  let unshallowAttempted = false;

  let mergeBaseAvailable = await hasMergeBase(workspaceDir, baseRef);
  if (!mergeBaseAvailable) {
    for (const step of DIFF_DEEPEN_STEPS) {
      deepenAttempts += 1;
      await $`git -C ${workspaceDir} fetch origin ${baseRef}:refs/remotes/origin/${baseRef} --deepen=${step}`
        .quiet()
        .nothrow();

      mergeBaseAvailable = await hasMergeBase(workspaceDir, baseRef);
      if (mergeBaseAvailable) {
        mergeBaseRecovered = true;
        strategy = "deepened-triple-dot";
        break;
      }
    }

    if (!mergeBaseAvailable) {
      unshallowAttempted = true;
      await $`git -C ${workspaceDir} fetch origin ${baseRef}:refs/remotes/origin/${baseRef} --unshallow`
        .quiet()
        .nothrow();

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

  let nameOnlyResult = await $`git -C ${workspaceDir} diff ${diffRange} --name-only`.quiet().nothrow();
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
    nameOnlyResult = await $`git -C ${workspaceDir} diff ${diffRange} --name-only`.quiet();
  } else if (nameOnlyResult.exitCode !== 0) {
    throw new Error(`git diff ${diffRange} --name-only failed with exit code ${nameOnlyResult.exitCode}`);
  }

  const changedFiles = splitGitLines(nameOnlyResult.text());
  const numstatOutput = await $`git -C ${workspaceDir} diff ${diffRange} --numstat`.quiet();
  const numstatLines = splitGitLines(numstatOutput.text());

  let diffContent: string | undefined;
  if (changedFiles.length <= maxFilesForFullDiff) {
    const fullDiff = await $`git -C ${workspaceDir} diff ${diffRange}`.quiet();
    diffContent = fullDiff.text();
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

function isReviewTriggerEnabled(
  action: string,
  triggers: {
    onOpened: boolean;
    onReadyForReview: boolean;
    onReviewRequested: boolean;
    onSynchronize?: boolean;
  },
): boolean {
  if (action === "opened") return triggers.onOpened;
  if (action === "ready_for_review") return triggers.onReadyForReview;
  if (action === "review_requested") return triggers.onReviewRequested;
  if (action === "synchronize") return triggers.onSynchronize ?? false;
  return false;
}

function normalizeReviewerLogin(login: string): string {
  return login.trim().toLowerCase().replace(/\[bot\]$/i, "");
}

/**
 * Create the review handler and register it with the event router.
 *
 * Handles `pull_request.opened`, `pull_request.ready_for_review`, and
 * `pull_request.review_requested` events.
 *
 * Trigger model: initial review events plus explicit re-request only.
 * Re-requested reviews run only when kodiai itself is the requested reviewer.
 * Additionally, a team-based re-request is supported for a special rereview team
 * ("ai-review" / "aireview") to enable UI-only re-review without a comment.
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
  isolationLayer?: IsolationLayer;
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
    isolationLayer,
    logger,
  } = deps;

  const rereviewTeamSlugs = new Set(["ai-review", "aireview"]);

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

    // Skip draft PRs (the opened event fires for drafts too)
    if (pr.draft) {
      logger.debug(
        baseLog,
        "Skipping draft PR",
      );
      return;
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
      } else if (requestedTeamName) {
        const normalizedTeamName = requestedTeamName.trim().toLowerCase();
        const normalizedTeamSlug = (requestedTeamSlug ?? "").trim().toLowerCase();
        const matchedTeam = rereviewTeamSlugs.has(normalizedTeamSlug) || rereviewTeamSlugs.has(normalizedTeamName);

        if (!matchedTeam) {
          logger.info(
            {
              ...baseLog,
              gate: "review_requested_reviewer",
              gateResult: "skipped",
              skipReason: "team-only-request",
              requestedReviewer: null,
              requestedTeam: requestedTeamName,
              requestedTeamSlug: requestedTeamSlug ?? null,
            },
            "Skipping review_requested event because only a non-rereview team was requested",
          );
          return;
        }

        logger.info(
          {
            ...baseLog,
            gate: "review_requested_reviewer",
            gateResult: "accepted",
            requestedReviewer: null,
            requestedTeam: requestedTeamName,
            requestedTeamSlug: requestedTeamSlug ?? null,
            rereviewTeam: true,
          },
          "Accepted review_requested event for rereview team",
        );
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

    await jobQueue.enqueue(event.installationId, async () => {
      // Durable run state idempotency check (REL-01)
      // Check before expensive workspace creation. Uses SHA pair as identity key.
      // Fail-open: if knowledgeStore is undefined or query throws, proceed with review.
      if (knowledgeStore) {
        try {
          const runCheck = knowledgeStore.checkAndClaimRun({
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
        // Create workspace with depth 50 for diff context
        workspace = await workspaceManager.create(event.installationId, {
          owner: cloneOwner,
          repo: cloneRepo,
          ref: cloneRef,
          depth: 50,
        });

        // Fork PR / deleted fork: fetch PR head ref from base repo
        if (usesPrRef) {
          await fetchAndCheckoutPullRequestHeadRef({
            dir: workspace.dir,
            prNumber: pr.number,
            localBranch: "pr-review",
          });
        }

        // Fetch base branch so git diff origin/BASE...HEAD works.
        // Explicit refspec needed because --single-branch clones don't track other branches.
        await $`git -C ${workspace.dir} fetch origin ${pr.base.ref}:refs/remotes/origin/${pr.base.ref} --depth=1`.quiet();

        // Load repo config (.kodiai.yml) with defaults
        const { config, warnings } = await loadRepoConfig(workspace.dir);
        for (const w of warnings) {
          logger.warn(
            { section: w.section, issues: w.issues },
            "Config section invalid, using defaults",
          );
        }

        // Best-effort: ensure a UI rereview team is requested so it appears under Reviewers.
        // NOTE: The resulting review_requested event sender will be the app, and our bot filter
        // drops self-events. This is intentional to avoid loops.
        if (
          config.review.requestUiRereviewTeamOnOpen &&
          config.review.uiRereviewTeam &&
          (action === "opened" || action === "ready_for_review")
        ) {
          const octokit = await githubApp.getInstallationOctokit(event.installationId);
          await requestRereviewTeamBestEffort({
            octokit,
            owner: apiOwner,
            repo: apiRepo,
            prNumber: pr.number,
            configuredTeam: config.review.uiRereviewTeam,
            fallbackReviewer: githubApp.getAppSlug(),
            logger,
          });
        }

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
        const idempotencyCheck = await ensureReviewOutputNotPublished({
          octokit: idempotencyOctokit,
          owner: apiOwner,
          repo: apiRepo,
          prNumber: pr.number,
          reviewOutputKey,
        });

        if (!idempotencyCheck.shouldPublish) {
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
        try {
          const commitMessages = await fetchCommitMessages(
            idempotencyOctokit,
            apiOwner,
            apiRepo,
            pr.number,
            pr.commits,
          );
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

        let authorClassification: { tier: AuthorTier; prCount: number | null; fromCache: boolean } = {
          tier: "regular",
          prCount: null,
          fromCache: false,
        };

        if (knowledgeStore) {
          try {
            authorClassification = await resolveAuthorTier({
              authorLogin: pr.user.login,
              authorAssociation: (pr as { author_association?: string }).author_association ?? "NONE",
              repo: apiRepo,
              owner: apiOwner,
              repoSlug: `${apiOwner}/${apiRepo}`,
              octokit: idempotencyOctokit,
              knowledgeStore,
              logger,
            });
            logger.info(
              {
                ...baseLog,
                authorTier: authorClassification.tier,
                authorPrCount: authorClassification.prCount,
                fromCache: authorClassification.fromCache,
              },
              "Author experience classification resolved",
            );
          } catch (err) {
            logger.warn(
              { ...baseLog, err },
              "Author classification failed (fail-open, using regular tier)",
            );
          }
        }

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
        const diffContext = await collectDiffContext({
          workspaceDir: workspace.dir,
          baseRef: pr.base.ref,
          maxFilesForFullDiff: 200,
          logger,
          baseLog,
        });
        const allChangedFiles = diffContext.changedFiles;

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

        // Triage uses changedFiles.length (full PR size) for threshold check,
        // not reviewFiles.length (which may be filtered for incremental mode).
        // Per pitfall 3 in research: check full PR, triage review set.
        const tieredFiles = triageFilesByRisk({
          riskScores,
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
            priorFindings = knowledgeStore.getPriorReviewFindings({
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

        // Retrieval context (LEARN-07)
        let retrievalCtx: RetrievalContextForPrompt | null = null;
        if (isolationLayer && embeddingProvider && config.knowledge.retrieval.enabled) {
          try {
            const queryText = buildRetrievalQuery({
              prTitle: pr.title,
              prBody: pr.body ?? undefined,
              conventionalType: parsedIntent.conventionalType?.type ?? null,
              detectedLanguages: Object.keys(diffAnalysis.filesByLanguage ?? {}),
              riskSignals: diffAnalysis.riskSignals ?? [],
              authorTier: authorClassification.tier,
              topFilePaths: reviewFiles.slice(0, 15),
            });
            logger.debug({ ...baseLog, queryLength: queryText.length }, "Retrieval query constructed");
            const embedResult = await embeddingProvider.generate(queryText, "query");
            if (embedResult) {
              const retrieval = isolationLayer.retrieveWithIsolation({
                queryEmbedding: embedResult.embedding,
                repo: `${apiOwner}/${apiRepo}`,
                owner: apiOwner,
                sharingEnabled: config.knowledge.sharing.enabled,
                topK: config.knowledge.retrieval.topK,
                distanceThreshold: config.knowledge.retrieval.distanceThreshold,
                logger,
              });
              if (retrieval.results.length > 0) {
                const reranked = rerankByLanguage({
                  results: retrieval.results,
                  prLanguages: Object.keys(diffAnalysis.filesByLanguage ?? {}),
                });
                retrievalCtx = {
                  findings: reranked.map(r => ({
                    findingText: r.record.findingText,
                    severity: r.record.severity,
                    category: r.record.category,
                    filePath: r.record.filePath,
                    outcome: r.record.outcome,
                    distance: r.adjustedDistance,
                    sourceRepo: r.sourceRepo,
                  })),
                };
              }
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

        logger.info(
          {
            ...baseLog,
            gate: "timeout-estimation",
            riskLevel: timeoutEstimate.riskLevel,
            dynamicTimeout: timeoutEstimate.dynamicTimeoutSeconds,
            shouldReduceScope: timeoutEstimate.shouldReduceScope,
            complexity: timeoutEstimate.reasoning,
          },
          "Timeout risk estimated",
        );

        // TMO-02: Scope reduction for high-risk auto-profile PRs
        const originalProfileSelection = { ...profileSelection };
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

          logger.info(
            {
              ...baseLog,
              gate: "timeout-scope-reduction",
              originalProfile: originalProfileSelection.selectedProfile,
              reducedProfile: "minimal",
              originalFileCount: tieredFiles.full.length + (tieredFiles.abbreviated.length - (timeoutEstimate.reducedFileCount !== null ? tieredFiles.abbreviated.length : 0)),
              reducedFileCount: timeoutEstimate.reducedFileCount,
            },
            "Auto-reduced review scope for high timeout risk",
          );
        } else if (timeoutEstimate.shouldReduceScope && profileSelection.source !== "auto") {
          logger.warn(
            {
              ...baseLog,
              gate: "timeout-scope-reduction",
              gateResult: "skipped",
              skipReason: "explicit-profile",
              profile: profileSelection.selectedProfile,
              source: profileSelection.source,
            },
            "Skipping scope reduction: user explicitly configured profile",
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

        // Build review prompt
        const reviewPrompt = buildReviewPrompt({
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
          // Multi-language context and localized output (LANG-01)
          filesByLanguage: diffAnalysis?.filesByLanguage,
          outputLanguage: config.review.outputLanguage,
          // PR labels for intent scoping (FORMAT-07)
          prLabels,
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
          authorTier: authorClassification.tier,
        });

        // Execute review via Claude
        const result = await executor.execute({
          workspace,
          installationId: event.installationId,
          owner: apiOwner,
          repo: apiRepo,
          prNumber: pr.number,
          commentId: undefined,
          botHandles: [githubApp.getAppSlug(), "claude"],
          eventType: `pull_request.${payload.action}`,
          triggerBody: reviewPrompt,
          prompt: reviewPrompt,
          reviewOutputKey,
          deliveryId: event.id,
          // TMO-04: Dynamic timeout from risk estimation
          dynamicTimeoutSeconds: config.timeout.dynamicScaling !== false
            ? timeoutEstimate.dynamicTimeoutSeconds
            : undefined,
        });

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
          ? evaluateFeedbackSuppressions({
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

        // Post-LLM abbreviated tier enforcement (LARGE-08)
        // Suppress medium/minor findings on abbreviated-tier files deterministically.
        const abbreviatedFileSet = tieredFiles.isLargePR
          ? new Set(tieredFiles.abbreviated.map(f => f.filePath))
          : new Set<string>();

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

          return {
            ...finding,
            category,
            suppressed,
            confidence,
            suppressionPattern,
          };
        });

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

          prioritizationStats = prioritized.stats;

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
            const priorFindings = knowledgeStore!.getPriorReviewFindings({
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
        const linesChanged =
          (diffAnalysis?.metrics.totalLinesAdded ?? 0) +
          (diffAnalysis?.metrics.totalLinesRemoved ?? 0);

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
            "Attempting deterministic Review Details publication",
          );

          try {
            const reviewDetailsBody = formatReviewDetailsSummary({
              reviewOutputKey,
              filesReviewed: diffAnalysis?.metrics.totalFiles ?? changedFiles.length,
              linesAdded: diffAnalysis?.metrics.totalLinesAdded ?? 0,
              linesRemoved: diffAnalysis?.metrics.totalLinesRemoved ?? 0,
              findingCounts,
              largePRTriage: tieredFiles.isLargePR ? {
                fullCount: tieredFiles.full.length,
                abbreviatedCount: tieredFiles.abbreviated.length,
                mentionOnlyFiles: tieredFiles.mentionOnly.map(f => ({ filePath: f.filePath, score: f.score })),
                totalFiles: tieredFiles.totalFiles,
              } : undefined,
              feedbackSuppressionCount: feedbackSuppression.suppressedPatternCount,
              keywordParsing: parsedIntent,
              profileSelection,
              authorTier: authorClassification.tier,
              prioritization: prioritizationStats,
            });

            if (result.published) {
              // Summary comment was posted -- append Review Details to it
              try {
                await appendReviewDetailsToSummary({
                  octokit: extractionOctokit,
                  owner: apiOwner,
                  repo: apiRepo,
                  prNumber: pr.number,
                  reviewOutputKey,
                  reviewDetailsBlock: reviewDetailsBody,
                  botHandles: [githubApp.getAppSlug(), "claude"],
                });
              } catch (appendErr) {
                // Fallback: post standalone if append fails (e.g., summary comment not found yet)
                logger.warn(
                  { ...baseLog, gate: "review-details-output", gateResult: "append-fallback", err: appendErr },
                  "Failed to append Review Details to summary comment; posting standalone",
                );
                await upsertReviewDetailsComment({
                  octokit: extractionOctokit,
                  owner: apiOwner,
                  repo: apiRepo,
                  prNumber: pr.number,
                  reviewOutputKey,
                  body: reviewDetailsBody,
                  botHandles: [githubApp.getAppSlug(), "claude"],
                });
              }
            } else {
              // No summary comment (clean review) -- post standalone Review Details
              // FORMAT-11 exemption: no summary exists to embed into; standalone preserves metrics visibility
              await upsertReviewDetailsComment({
                octokit: extractionOctokit,
                owner: apiOwner,
                repo: apiRepo,
                prNumber: pr.number,
                reviewOutputKey,
                body: reviewDetailsBody,
                botHandles: [githubApp.getAppSlug(), "claude"],
              });
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
              "Failed to publish deterministic Review Details summary",
            );
          }
        }

        // Fire-and-forget telemetry capture (TELEM-03, TELEM-05, CONFIG-10)
        if (config.telemetry.enabled) {
          try {
            telemetryStore.record({
              deliveryId: event.id,
              repo: `${apiOwner}/${apiRepo}`,
              prNumber: pr.number,
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
              const warnOctokit = await githubApp.getInstallationOctokit(event.installationId);
              await warnOctokit.rest.issues.createComment({
                owner: apiOwner,
                repo: apiRepo,
                issue_number: pr.number,
                body: sanitizeOutgoingMentions(`> **Kodiai cost warning:** This execution cost \$${result.costUsd.toFixed(4)} USD, exceeding the configured threshold of \$${config.telemetry.costWarningUsd.toFixed(2)} USD.\n>\n> Configure in \`.kodiai.yml\`:\n> \`\`\`yml\n> telemetry:\n>   costWarningUsd: 5.0  # or 0 to disable\n> \`\`\``, [githubApp.getAppSlug(), "claude"]),
              });
            } catch (err) {
              logger.warn({ err }, "Failed to post cost warning comment (non-blocking)");
            }
          }
        }

        let reviewId: number | undefined;

        if (knowledgeStore) {
          try {
            reviewId = knowledgeStore.recordReview({
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

            knowledgeStore.recordFindings(
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

            knowledgeStore.recordSuppressionLog(
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
                  knowledgeStore.recordGlobalPattern({
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
            knowledgeStore.completeRun(runKey);
          } catch (err) {
            logger.warn({ ...baseLog, err }, 'Failed to mark run as completed (non-fatal)');
          }
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
                };

                learningMemoryStore.writeMemory(memoryRecord, embeddingResult.embedding);
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

        // Post error or partial-review comment if execution failed or timed out
        if (result.conclusion === "error") {
          const category = classifyError(
            new Error(result.errorMessage ?? "Unknown error"),
            result.isTimeout ?? false,
            result.published ?? false,
          );

          const timeoutDuration = timeoutEstimate?.dynamicTimeoutSeconds ?? config.timeoutSeconds;
          const complexityInfo = timeoutEstimate?.reasoning ?? "unknown";

          let errorBody: string;
          if (category === "timeout_partial") {
            // TMO-03: Partial review -- inline comments were published before timeout
            errorBody = formatErrorComment(
              category,
              `Timed out after ${timeoutDuration}s. ` +
              `PR complexity: ${complexityInfo}`,
            );
          } else if (category === "timeout") {
            // TMO-03: Full timeout -- nothing was published
            errorBody = formatErrorComment(
              category,
              `Timed out after ${timeoutDuration}s with no review output. ` +
              `PR complexity: ${complexityInfo}`,
            );
          } else {
            errorBody = formatErrorComment(
              category,
              result.errorMessage ?? "An unexpected error occurred during review.",
            );
          }

          const octokit = await githubApp.getInstallationOctokit(event.installationId);
          await postOrUpdateErrorComment(octokit, {
            owner: apiOwner,
            repo: apiRepo,
            issueNumber: pr.number,
          }, sanitizeOutgoingMentions(errorBody, [githubApp.getAppSlug(), "claude"]), logger);
        }

        // Auto-approval: only when autoApprove is enabled AND execution succeeded AND
        // the model produced zero GitHub-visible output (no summary comment, no inline comments).
        if (config.review.autoApprove && result.conclusion === "success") {
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
              return;
            }

            {
              // No issues found -- submit silent approval
              await octokit.rest.pulls.createReview({
                owner: apiOwner,
                repo: apiRepo,
                pull_number: pr.number,
                event: "APPROVE",
                body: sanitizeOutgoingMentions(idempotencyCheck.marker, [appSlug, "claude"]),
              });

              logger.info(
                {
                  evidenceType: "review",
                  outcome: "submitted-approval",
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
                "Submitted silent approval (no issues found)",
              );
            }
          } catch (err) {
            logger.error(
              { err, prNumber: pr.number },
              "Failed to submit approval",
            );
          }
        }
      } catch (err) {
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
          await postOrUpdateErrorComment(errOctokit, {
            owner: apiOwner,
            repo: apiRepo,
            issueNumber: pr.number,
          }, sanitizeOutgoingMentions(errorBody, [githubApp.getAppSlug(), "claude"]), logger);
        } catch (commentErr) {
          logger.error({ err: commentErr }, "Failed to post error comment to PR");
        }
      } finally {
        if (workspace) {
          await workspace.cleanup();
        }
      }
    }, {
      deliveryId: event.id,
      eventName: event.name,
      action,
      jobType: "pull-request-review",
      prNumber: pr.number,
    });

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
