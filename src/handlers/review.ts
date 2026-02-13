import type {
  PullRequestOpenedEvent,
  PullRequestReadyForReviewEvent,
  PullRequestReviewRequestedEvent,
} from "@octokit/webhooks-types";
import type { Logger } from "pino";
import type { EventRouter, WebhookEvent } from "../webhook/types.ts";
import type { JobQueue, WorkspaceManager, Workspace } from "../jobs/types.ts";
import type { GitHubApp } from "../auth/github-app.ts";
import type { createExecutor } from "../execution/executor.ts";
import type { TelemetryStore } from "../telemetry/types.ts";
import type { KnowledgeStore } from "../knowledge/types.ts";
import { loadRepoConfig } from "../execution/config.ts";
import { analyzeDiff } from "../execution/diff-analysis.ts";
import {
  buildReviewPrompt,
  matchPathInstructions,
} from "../execution/review-prompt.ts";
import { computeConfidence, matchesSuppression } from "../knowledge/confidence.ts";
import { classifyError, formatErrorComment, postOrUpdateErrorComment } from "../lib/errors.ts";
import {
  buildReviewOutputMarker,
  buildReviewOutputKey,
  ensureReviewOutputNotPublished,
} from "./review-idempotency.ts";
import { requestRereviewTeamBestEffort } from "./rereview-team.ts";
import picomatch from "picomatch";
import { $ } from "bun";
import { fetchAndCheckoutPullRequestHeadRef } from "../jobs/workspace.ts";

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
};

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
  linesAnalyzed: number;
  linesChanged: number;
  findingCounts: {
    critical: number;
    major: number;
    medium: number;
    minor: number;
  };
  suppressionsApplied: number;
  minConfidence: number;
  visibleFindings: ProcessedFinding[];
  lowConfidenceFindings: ProcessedFinding[];
}): string {
  const {
    reviewOutputKey,
    filesReviewed,
    linesAnalyzed,
    linesChanged,
    findingCounts,
    suppressionsApplied,
    minConfidence,
    visibleFindings,
    lowConfidenceFindings,
  } = params;

  // Time-saved estimate is deterministic and intentionally simple:
  // - 3 minutes per actionable finding (triage + patch decision)
  // - 1 minute per low-confidence finding (quick validation pass)
  // - 0.25 minute per reviewed file (scan/setup overhead)
  const estimatedMinutesSaved = Math.max(
    1,
    Math.round((visibleFindings.length * 3 + lowConfidenceFindings.length + filesReviewed * 0.25) * 10) / 10,
  );

  const sections = [
    "<details>",
    "<summary>Review Details</summary>",
    "",
    `- Files reviewed: ${filesReviewed}`,
    `- Lines analyzed: ${linesAnalyzed}`,
    `- Lines changed: ${linesChanged}`,
    `- Severity counts: critical ${findingCounts.critical}, major ${findingCounts.major}, medium ${findingCounts.medium}, minor ${findingCounts.minor}`,
    `- Suppressions applied: ${suppressionsApplied}`,
    `- Estimated review time saved: ~${estimatedMinutesSaved} minutes`,
    "- Time-saved formula: (3 min x actionable findings) + (1 min x low-confidence findings) + (0.25 min x files reviewed)",
    "</details>",
  ];

  if (lowConfidenceFindings.length > 0) {
    const lowConfidenceLines = lowConfidenceFindings.map((finding) => {
      const lineInfo = finding.endLine ?? finding.startLine;
      const location = lineInfo ? `${finding.filePath}:${lineInfo}` : finding.filePath;
      return `- ${location} [${finding.severity}] ${finding.title} (confidence: ${finding.confidence})`;
    });

    sections.push(
      "",
      "<details>",
      `<summary>Low Confidence Findings (threshold: ${minConfidence})</summary>`,
      "",
      ...lowConfidenceLines,
      "</details>",
    );
  }

  sections.push("", buildReviewDetailsMarker(reviewOutputKey));

  return sections.join("\n");
}

async function upsertReviewDetailsComment(params: {
  octokit: Awaited<ReturnType<GitHubApp["getInstallationOctokit"]>>;
  owner: string;
  repo: string;
  prNumber: number;
  reviewOutputKey: string;
  body: string;
}): Promise<void> {
  const { octokit, owner, repo, prNumber, reviewOutputKey, body } = params;
  const marker = buildReviewDetailsMarker(reviewOutputKey);

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
      body,
    });
    return;
  }

  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body,
  });
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
  },
): boolean {
  if (action === "opened") return triggers.onOpened;
  if (action === "ready_for_review") return triggers.onReadyForReview;
  if (action === "review_requested") return triggers.onReviewRequested;
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
    logger,
  } = deps;

  const rereviewTeamSlugs = new Set(["ai-review", "aireview"]);

  async function handleReview(event: WebhookEvent): Promise<void> {
    const payload = event.payload as unknown as
      | PullRequestOpenedEvent
      | PullRequestReadyForReviewEvent
      | PullRequestReviewRequestedEvent;

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

        const numstatLines = diffContext.numstatLines;
        const diffContent = changedFiles.length <= 200 ? diffContext.diffContent : undefined;

        const diffAnalysis = analyzeDiff({
          changedFiles,
          numstatLines,
          diffContent,
          fileCategories: config.review.fileCategories as Record<string, string[]> | undefined,
        });

        const matchedPathInstructions = config.review.pathInstructions.length > 0
          ? matchPathInstructions(config.review.pathInstructions, changedFiles)
          : [];

        let resolvedSeverityMinLevel = config.review.severity.minLevel;
        let resolvedMaxComments = config.review.maxComments;
        let resolvedFocusAreas = [...config.review.focusAreas];
        let resolvedIgnoredAreas = [...config.review.ignoredAreas];

        if (config.review.profile) {
          const preset = PROFILE_PRESETS[config.review.profile];
          if (preset) {
            if (resolvedSeverityMinLevel === "minor") {
              resolvedSeverityMinLevel = preset.severityMinLevel;
            }
            if (resolvedMaxComments === 7) {
              resolvedMaxComments = preset.maxComments;
            }
            if (resolvedFocusAreas.length === 0) {
              resolvedFocusAreas = [...preset.focusAreas];
            }
            if (resolvedIgnoredAreas.length === 0) {
              resolvedIgnoredAreas = [...preset.ignoredAreas];
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
              profile: config.review.profile ?? null,
              diffCollectionStrategy: diffContext.strategy,
              mergeBaseRecovered: diffContext.mergeBaseRecovered,
              diffCollectionAttempts: diffContext.deepenAttempts,
            },
            "Diff analysis and context enrichment complete",
          );

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
          changedFiles,
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
        });

        // Execute review via Claude
        const result = await executor.execute({
          workspace,
          installationId: event.installationId,
          owner: apiOwner,
          repo: apiRepo,
          prNumber: pr.number,
          commentId: undefined,
          eventType: `pull_request.${payload.action}`,
          triggerBody: reviewPrompt,
          prompt: reviewPrompt,
          reviewOutputKey,
          deliveryId: event.id,
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

        const suppressionMatchCounts = new Map<string, number>();
        const processedFindings: ProcessedFinding[] = extractedFindings.map((finding) => {
          const matchedSuppression = config.review.suppressions.find((suppression) =>
            matchesSuppression(
              {
                filePath: finding.filePath,
                title: finding.title,
                severity: finding.severity,
                category: finding.category,
              },
              suppression,
            )
          );
          const suppressed = Boolean(matchedSuppression);
          const suppressionPattern = typeof matchedSuppression === "string"
            ? matchedSuppression
            : matchedSuppression?.pattern;
          if (suppressionPattern) {
            const existing = suppressionMatchCounts.get(suppressionPattern) ?? 0;
            suppressionMatchCounts.set(suppressionPattern, existing + 1);
          }

          const confidence = computeConfidence({
            severity: finding.severity,
            category: finding.category,
            matchesKnownPattern: Boolean(matchedSuppression),
          });

          return {
            ...finding,
            suppressed,
            confidence,
            suppressionPattern,
          };
        });

        const visibleFindings = processedFindings.filter((finding) =>
          !finding.suppressed && finding.confidence >= config.review.minConfidence
        );
        const lowConfidenceFindings = processedFindings.filter((finding) =>
          !finding.suppressed && finding.confidence < config.review.minConfidence
        );
        const filteredInlineFindings = processedFindings.filter((finding) =>
          finding.suppressed || finding.confidence < config.review.minConfidence
        );

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
            },
            "Attempting deterministic Review Details publication",
          );

          try {
            const reviewDetailsBody = formatReviewDetailsSummary({
              reviewOutputKey,
              filesReviewed: diffAnalysis?.metrics.totalFiles ?? changedFiles.length,
              linesAnalyzed: linesChanged,
              linesChanged,
              findingCounts,
              suppressionsApplied,
              minConfidence: config.review.minConfidence,
              visibleFindings,
              lowConfidenceFindings,
            });
            await upsertReviewDetailsComment({
              octokit: extractionOctokit,
              owner: apiOwner,
              repo: apiRepo,
              prNumber: pr.number,
              reviewOutputKey,
              body: reviewDetailsBody,
            });
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
              conclusion: result.conclusion,
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
                body: `> **Kodiai cost warning:** This execution cost \$${result.costUsd.toFixed(4)} USD, exceeding the configured threshold of \$${config.telemetry.costWarningUsd.toFixed(2)} USD.\n>\n> Configure in \`.kodiai.yml\`:\n> \`\`\`yml\n> telemetry:\n>   costWarningUsd: 5.0  # or 0 to disable\n> \`\`\``,
              });
            } catch (err) {
              logger.warn({ err }, "Failed to post cost warning comment (non-blocking)");
            }
          }
        }

        if (knowledgeStore) {
          try {
            const reviewId = knowledgeStore.recordReview({
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

            logger.debug(
              {
                reviewId,
                repo: `${apiOwner}/${apiRepo}`,
                prNumber: pr.number,
                findingsCaptured: processedFindings.length,
              },
              "Knowledge store: review recorded",
            );

            knowledgeStore.recordFindings(
              processedFindings.map((finding) => ({
                reviewId,
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
                reviewId,
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

        // Post error comment if execution failed or timed out
        if (result.conclusion === "error") {
          const category = result.isTimeout
            ? "timeout"
            : classifyError(new Error(result.errorMessage ?? "Unknown error"), false);
          const errorBody = formatErrorComment(
            category,
            result.errorMessage ?? "An unexpected error occurred during review.",
          );
          const octokit = await githubApp.getInstallationOctokit(event.installationId);
          await postOrUpdateErrorComment(octokit, {
            owner: apiOwner,
            repo: apiRepo,
            issueNumber: pr.number,
          }, errorBody, logger);
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
                body: idempotencyCheck.marker,
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
          }, errorBody, logger);
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
}
