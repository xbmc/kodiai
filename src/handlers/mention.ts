import type {
  IssueCommentCreatedEvent,
  PullRequestReviewCommentCreatedEvent,
  PullRequestReviewSubmittedEvent,
} from "@octokit/webhooks-types";
import type { Logger } from "pino";
import { $ } from "bun";
import { createHash } from "node:crypto";
import type { EventRouter, WebhookEvent } from "../webhook/types.ts";
import type { JobQueue, WorkspaceManager, Workspace } from "../jobs/types.ts";
import type { ReviewWorkCoordinator } from "../jobs/review-work-coordinator.ts";
import type { GitHubApp } from "../auth/github-app.ts";
import type { createExecutor } from "../execution/executor.ts";
import type { TelemetryStore } from "../telemetry/types.ts";
import type { KnowledgeStore } from "../knowledge/types.ts";
import type { createRetriever } from "../knowledge/retrieval.ts";
import { loadRepoConfig } from "../execution/config.ts";
import {
  fetchAndCheckoutPullRequestHeadRef,
  getGitStatusPorcelain,
  createBranchCommitAndPush,
  commitAndPushToRemoteRef,
  pushHeadToRemoteRef,
  buildAuthFetchUrl,
  WritePolicyError,
  assertOriginIsFork,
  shouldUseGist,
} from "../jobs/workspace.ts";
import type { ForkManager } from "../jobs/fork-manager.ts";
import type { GistPublisher } from "../jobs/gist-publisher.ts";
import {
  buildReviewFamilyKey,
  createReviewWorkCoordinator,
  type ReviewWorkPhase,
} from "../jobs/review-work-coordinator.ts";
import {
  type MentionEvent,
  normalizeIssueComment,
  normalizeReviewComment,
  normalizeReviewBody,
  containsMention,
  stripMention,
} from "./mention-types.ts";
import { buildMentionContext } from "../execution/mention-context.ts";
import { buildIssueCodeContext } from "../execution/issue-code-context.ts";
import { buildMentionPrompt } from "../execution/mention-prompt.ts";
import { buildReviewPrompt, matchPathInstructions } from "../execution/review-prompt.ts";
import { buildRetrievalVariants } from "../knowledge/multi-query-retrieval.ts";
import { analyzeDiff, classifyFileLanguage, parseNumstatPerFile } from "../execution/diff-analysis.ts";
import { computeFileRiskScores, triageFilesByRisk } from "../lib/file-risk-scorer.ts";
import {
  type ErrorCategory,
  classifyError,
  formatErrorComment,
  postOrUpdateErrorComment,
} from "../lib/errors.ts";
import { wrapInDetails } from "../lib/formatting.ts";
import { sanitizeOutgoingMentions } from "../lib/sanitizer.ts";
import { validateIssue, generateGuidanceComment, generateLabelRecommendation, generateGenericNudge } from "../triage/triage-agent.ts";
import { runGuardrailPipeline } from "../lib/guardrail/pipeline.ts";
import { createGuardrailAuditStore } from "../lib/guardrail/audit-store.ts";
import { mentionAdapter } from "../lib/guardrail/adapters/mention-adapter.ts";
import { FORK_WRITE_POLICY_INSTRUCTIONS } from "../execution/prompts.ts";
import { buildWritePolicyRefusalMessage, scanLinesForFabricatedContent } from "../lib/mention-utils.ts";
import {
  buildApprovedReviewBody,
  buildReviewOutputKey,
  buildReviewOutputPublicationLogFields,
  ensureReviewOutputNotPublished,
} from "./review-idempotency.ts";
import { collectDiffContext } from "./review.ts";

type MentionRetrievalContext = {
  maxChars?: number;
  maxItems?: number;
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
};

type IssueWriteFailureStep = "branch-push" | "create-pr" | "issue-linkback";
type MentionPublishResolution =
  | "none"
  | "executor"
  | "approval-bridge"
  | "idempotency-skip"
  | "duplicate-suppressed"
  | "publish-failure-fallback"
  | "publish-failure-comment-failed";
type MentionErrorDelivery =
  | "review-thread-reply"
  | "error-comment-created"
  | "error-comment-updated"
  | "error-comment-failed";
type MentionErrorPostResult = {
  posted: boolean;
  delivery: MentionErrorDelivery;
};

const MENTION_RETRIEVAL_MAX_CONTEXT_CHARS = 1200;

function buildMentionQueueKey(owner: string, repo: string, issueOrPrNumber: number): string {
  return `${owner.trim().toLowerCase()}/${repo.trim().toLowerCase()}#${issueOrPrNumber}`;
}

function findLatestReviewPredecessor(
  snapshot: ReturnType<ReviewWorkCoordinator["getSnapshot"]>,
  currentAttemptId: string,
) {
  if (!snapshot) {
    return null;
  }

  return snapshot.attempts
    .filter((attempt) => attempt.attemptId !== currentAttemptId)
    .sort((left, right) => {
      if (right.lastProgressAtMs !== left.lastProgressAtMs) {
        return right.lastProgressAtMs - left.lastProgressAtMs;
      }
      return right.claimedAtMs - left.claimedAtMs;
    })[0] ?? null;
}




/**
 * Create the mention handler and register it with the event router.
 *
 * Handles @kodiai mentions across all four comment surfaces:
 * - issue_comment.created (issues and PR general comments)
 * - pull_request_review_comment.created (inline diff comments)
 * - pull_request_review.submitted (review body)
 */
export function createMentionHandler(deps: {
  eventRouter: EventRouter;
  jobQueue: JobQueue;
  workspaceManager: WorkspaceManager;
  githubApp: GitHubApp;
  executor: ReturnType<typeof createExecutor>;
  telemetryStore: TelemetryStore;
  knowledgeStore?: KnowledgeStore;
  retriever?: ReturnType<typeof createRetriever>;
  /** Fork manager for fork-based write mode (Phase 127). */
  forkManager?: ForkManager;
  /** Gist publisher for patch output mode (Phase 127). */
  gistPublisher?: GistPublisher;
  /** Optional SQL client for guardrail audit logging (GUARD-06). */
  sql?: import("../db/client.ts").Sql;
  /** Optional in-memory coordinator for same-PR review-family publish rights. */
  reviewWorkCoordinator?: ReviewWorkCoordinator;
  logger: Logger;
}): void {
  const {
    eventRouter,
    jobQueue,
    workspaceManager,
    githubApp,
    executor,
    telemetryStore,
    retriever,
    forkManager,
    gistPublisher,
    sql,
    reviewWorkCoordinator: injectedReviewWorkCoordinator,
    logger,
  } = deps;

  const guardrailAuditStore = sql ? createGuardrailAuditStore(sql) : undefined;
  const reviewWorkCoordinator = injectedReviewWorkCoordinator ?? createReviewWorkCoordinator();
  if (!injectedReviewWorkCoordinator) {
    logger.warn(
      {
        gate: "review-family-coordinator",
        gateResult: "private-fallback",
        coordinationScope: "handler-local",
        handler: "mention",
      },
      "Review work coordinator not injected; using a private handler-local fallback (cross-handler coordination disabled)",
    );
  }

  // Basic in-memory rate limiter for write-mode requests.
  // Keyed by installation+repo; resets on process restart.
  const lastWriteAt = new Map<string, number>();
  const prConversationTurns = new Map<string, number>();
  const prConversationTouchedAt = new Map<string, number>();

  const inFlightWriteKeys = new Set<string>();

  // Per-issue triage cooldown: prevents repeated triage nudges.
  // Keyed by "{owner}/{repo}#{issueNumber}". Resets when issue body hash changes.
  const triageCooldowns = new Map<string, { lastTriagedAt: number; bodyHash: string }>();

  function pruneTriageCooldowns(now: number): void {
    const ttlMs = 24 * 60 * 60 * 1000; // 24h
    for (const [key, entry] of triageCooldowns.entries()) {
      if (now - entry.lastTriagedAt > ttlMs) {
        triageCooldowns.delete(key);
      }
    }
    // Hard cap
    if (triageCooldowns.size > 1000) {
      const sortedEntries = [...triageCooldowns.entries()]
        .sort((a, b) => a[1].lastTriagedAt - b[1].lastTriagedAt);
      const toDelete = sortedEntries.slice(0, triageCooldowns.size - 1000);
      for (const [key] of toDelete) {
        triageCooldowns.delete(key);
      }
    }
  }

  function buildWriteOutputKey(input: {
    installationId: number;
    owner: string;
    repo: string;
    sourceType: "pr" | "issue";
    sourceNumber: number;
    commentId: number;
    keyword: string;
  }): string {
    const normalizedOwner = input.owner.trim().toLowerCase();
    const normalizedRepo = input.repo.trim().toLowerCase();
    const normalizedKeyword = input.keyword.trim().toLowerCase();

    return [
      "kodiai-write-output",
      "v1",
      `inst-${input.installationId}`,
      `${normalizedOwner}/${normalizedRepo}`,
      `${input.sourceType}-${input.sourceNumber}`,
      `comment-${input.commentId}`,
      `keyword-${normalizedKeyword}`,
    ].join(":");
  }

  function buildWriteBranchName(params: {
    sourceType: "pr" | "issue";
    sourceNumber: number;
    commentId: number;
    writeOutputKey: string;
  }): string {
    const hash = createHash("sha256").update(params.writeOutputKey).digest("hex").slice(0, 12);
    return `kodiai/apply/${params.sourceType}-${params.sourceNumber}-comment-${params.commentId}-${hash}`;
  }

  function pruneRateLimiter(now: number): void {
    // Defense-in-depth: prevent unbounded growth in long-lived processes.
    // Keep recent entries only; this limiter is best-effort and not durable.
    const ttlMs = 24 * 60 * 60 * 1000; // 24h
    for (const [key, ts] of lastWriteAt.entries()) {
      if (now - ts > ttlMs) {
        lastWriteAt.delete(key);
      }
    }

    // Hard cap: if still large, drop oldest entries.
    const maxEntries = 10_000;
    if (lastWriteAt.size <= maxEntries) return;

    const entries = [...lastWriteAt.entries()].sort((a, b) => a[1] - b[1]);
    const toDelete = entries.length - maxEntries;
    for (let i = 0; i < toDelete; i++) {
      const k = entries[i]?.[0];
      if (k) lastWriteAt.delete(k);
    }
  }

  function pruneConversationTurns(now: number): void {
    const ttlMs = 24 * 60 * 60 * 1000;
    for (const [key, ts] of prConversationTouchedAt.entries()) {
      if (now - ts > ttlMs) {
        prConversationTurns.delete(key);
        prConversationTouchedAt.delete(key);
      }
    }

    const maxEntries = 10_000;
    if (prConversationTurns.size <= maxEntries) return;

    const entries = [...prConversationTouchedAt.entries()].sort((a, b) => a[1] - b[1]);
    const toDelete = entries.length - maxEntries;
    for (let i = 0; i < toDelete; i++) {
      const k = entries[i]?.[0];
      if (k) {
        prConversationTurns.delete(k);
        prConversationTouchedAt.delete(k);
      }
    }
  }

  function parseWriteIntent(userQuestion: string): {
    writeIntent: boolean;
    keyword: "apply" | "change" | "plan" | undefined;
    request: string;
  } {
    const trimmed = userQuestion.trimStart();
    const lower = trimmed.toLowerCase();

    for (const keyword of ["apply", "change", "plan"] as const) {
      const prefix = `${keyword}:`;
      if (lower.startsWith(prefix)) {
        return {
          writeIntent: true,
          keyword,
          request: trimmed.slice(prefix.length).trim(),
        };
      }
    }

    return { writeIntent: false, keyword: undefined, request: userQuestion.trim() };
  }

  function detectImplicitIssueIntent(userQuestion: string): "apply" | "plan" | undefined {
    const normalized = stripIssueIntentWrappers(userQuestion).toLowerCase();
    if (normalized.length === 0) return undefined;

    const planDirect = /^(?:please\s+)?(?:plan|draft|outline|propose)\b/;
    const planAsk =
      /^(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:help\s+me\s+)?(?:plan|draft|outline|propose)\b/;
    const planPhrase = /(?:\bwork\s+up\b|\bput\s+together\b)(?:.{0,30})\bplan\b/;

    if (planDirect.test(normalized) || planAsk.test(normalized) || planPhrase.test(normalized)) {
      return "plan";
    }

    if (isImplementationRequestWithoutPrefix(normalized)) {
      return "apply";
    }

    if (isConversationalConfirmation(normalized)) {
      return "apply";
    }

    return undefined;
  }

  function detectImplicitPrPatchIntent(userQuestion: string): "apply" | undefined {
    const normalized = stripIssueIntentWrappers(userQuestion).toLowerCase();
    if (normalized.length === 0) return undefined;

    // Direct: "create a patch", "make a patch", "open a patch PR", "submit a patch"
    const patchDirect = /^(?:please\s+)?(?:create|make|open|submit)\s+(?:a\s+)?patch\b/;
    // Direct: "patch this", "patch the earlier change"
    const patchThis = /^(?:please\s+)?patch\s+(?:this|the|that)\b/;
    // Polite: "can/could/would you create a patch"
    const patchAsk = /^(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:create|make|open|submit)\s+(?:a\s+)?patch\b/;
    // Polite: "can you patch this/the/that"
    const patchThisAsk = /^(?:can|could|would|will)\s+you\s+(?:please\s+)?patch\s+(?:this|the|that)\b/;
    // Contextual: "apply the earlier suggestion as a patch PR"
    const patchContextual = /(?:apply|implement)\s+(?:the\s+)?(?:earlier|previous|above|suggested)\s+(?:change|suggestion|fix).*(?:as\s+)?(?:a\s+)?(?:patch|pr)\b/;

    if (
      patchDirect.test(normalized) ||
      patchThis.test(normalized) ||
      patchAsk.test(normalized) ||
      patchThisAsk.test(normalized) ||
      patchContextual.test(normalized)
    ) {
      return "apply";
    }

    if (isImplementationRequestWithoutPrefix(normalized)) {
      return "apply";
    }

    if (isConversationalConfirmation(normalized)) {
      return "apply";
    }

    return undefined;
  }

  function summarizeWriteRequest(request: string): string {
    const condensed = request
      .replace(/\s+/g, " ")
      .replace(/^[@`'"([{\s]+/, "")
      .replace(/[@`'"\])}\s]+$/, "")
      .replace(/^(?:can|could|would|will)\s+you\s+/i, "")
      .replace(/^(?:please\s+)+/i, "")
      .replace(/[?.!]+$/, "")
      .trim();

    const fallback = "requested update";
    const normalized = condensed.length > 0 ? condensed : fallback;
    const maxLen = 72;
    return normalized.length <= maxLen ? normalized : `${normalized.slice(0, maxLen - 3).trimEnd()}...`;
  }

  function generatePrTitle(issueTitle: string | null, requestSummary: string, isFromPr: boolean): string {
    const maxLen = 72;

    if (issueTitle && issueTitle.trim().length > 0) {
      // Clean the issue title: remove leading [tags], trailing issue refs
      const cleaned = issueTitle
        .replace(/^\[.*?\]\s*/g, "")
        .replace(/\s*#\d+\s*$/, "")
        .trim();

      // Detect prefix from content
      const lower = cleaned.toLowerCase();
      let prefix: string;
      if (/\b(?:fix|bug|crash|broken|error)\b/.test(lower)) {
        prefix = "fix";
      } else if (/\brefactor\b/.test(lower)) {
        prefix = "refactor";
      } else if (/\b(?:add|support|implement|feature|new)\b/.test(lower)) {
        prefix = "feat";
      } else {
        prefix = isFromPr ? "fix" : "feat";
      }

      const full = `${prefix}: ${cleaned}`;
      return full.length <= maxLen ? full : `${full.slice(0, maxLen - 3).trimEnd()}...`;
    }

    // Fallback: no issue title available
    const defaultPrefix = isFromPr ? "fix" : "feat";
    const full = `${defaultPrefix}: ${requestSummary}`;
    return full.length <= maxLen ? full : `${full.slice(0, maxLen - 3).trimEnd()}...`;
  }

  function generateCommitSubject(params: {
    issueTitle: string | null | undefined;
    requestSummary: string;
    isFromPr: boolean;
    ref?: string; // e.g. "#27954" or "PR #42"
  }): string {
    const maxLen = 72;
    const { issueTitle, requestSummary, isFromPr, ref } = params;

    let subject: string;

    if (issueTitle && issueTitle.trim().length > 0) {
      const cleaned = issueTitle
        .replace(/^\[.*?\]\s*/g, "")
        .replace(/\s*#\d+\s*$/, "")
        .trim();

      const lower = cleaned.toLowerCase();
      let prefix: string;
      if (/\b(?:fix|bug|crash|broken|error)\b/.test(lower)) {
        prefix = "fix";
      } else if (/\brefactor\b/.test(lower)) {
        prefix = "refactor";
      } else if (/\b(?:add|support|implement|feature|new)\b/.test(lower)) {
        prefix = "feat";
      } else {
        prefix = isFromPr ? "fix" : "feat";
      }
      subject = `${prefix}: ${cleaned}`;
    } else {
      const defaultPrefix = isFromPr ? "fix" : "feat";
      subject = `${defaultPrefix}: ${requestSummary}`;
    }

    // Append ref if provided
    if (ref) {
      const withRef = `${subject} (${ref})`;
      if (withRef.length <= maxLen) {
        subject = withRef;
      }
      // If adding ref would exceed maxLen, truncate subject part to fit
      else {
        const refSuffix = ` (${ref})`;
        const available = maxLen - refSuffix.length - 3; // 3 for "..."
        if (available > 10) {
          subject = `${subject.slice(0, available).trimEnd()}...${refSuffix}`;
        }
        // else just truncate without ref
      }
    }

    return subject.length <= maxLen ? subject : `${subject.slice(0, maxLen - 3).trimEnd()}...`;
  }

  function generatePrBody(params: {
    summary: string;
    issueTitle: string | null;
    sourceUrl: string;
    triggerCommentUrl: string;
    deliveryId: string;
    headSha: string;
    isFromPr: boolean;
    issueNumber: number;
    prNumber: number | undefined;
    diffStat: string;
    warnings?: string[];
  }): string {
    const {
      summary, issueTitle, sourceUrl, triggerCommentUrl,
      deliveryId, headSha, isFromPr, issueNumber, prNumber, diffStat,
    } = params;

    // Summary paragraph: prefer issue title context, fall back to request summary
    const summaryParagraph = issueTitle && issueTitle.trim().length > 0
      ? issueTitle.trim()
      : summary;

    const resolveOrRelate = isFromPr
      ? `Related to #${prNumber}`
      : `Resolves #${issueNumber}`;

    const lines: string[] = [
      summaryParagraph,
      "",
    ];

    if (diffStat) {
      lines.push("## Changes", "", diffStat, "");
    }

    if (params.warnings && params.warnings.length > 0) {
      lines.push(
        "## Automated warnings",
        "",
        ...params.warnings.map((w) => `- ${w}`),
        "",
      );
    }

    lines.push(
      "---",
      "",
      resolveOrRelate,
      "",
      "<details>",
      "<summary>Metadata</summary>",
      "",
      `- Source: ${sourceUrl}`,
      `- Trigger: ${triggerCommentUrl}`,
      `- Delivery: ${deliveryId}`,
      `- Commit: ${headSha}`,
      "",
      "</details>",
    );

    return lines.join("\n");
  }

  async function scanDiffForFabricatedContent(dir: string): Promise<string[]> {
    let diffText: string;
    try {
      diffText = (await $`git -C ${dir} diff HEAD~1 HEAD`.quiet()).text();
    } catch {
      return []; // no diff available, skip scan
    }

    const addedLines = diffText
      .split("\n")
      .filter((line) => line.startsWith("+") && !line.startsWith("+++"));

    return scanLinesForFabricatedContent(addedLines);
  }

  function toErrorSignalText(value: unknown): string {
    if (typeof value === "string") {
      return value;
    }
    if (value instanceof Uint8Array) {
      return new TextDecoder().decode(value);
    }
    if (value instanceof Error) {
      return value.message;
    }
    if (value && typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }
    return String(value ?? "");
  }

  function summarizeErrorForDiagnostics(err: unknown): string {
    const parts: string[] = [];

    if (err instanceof Error) {
      if (typeof err.message === "string") {
        parts.push(err.message);
      }
      const withExtras = err as Error & {
        stderr?: unknown;
        stdout?: unknown;
        cause?: unknown;
      };
      parts.push(toErrorSignalText(withExtras.stderr));
      parts.push(toErrorSignalText(withExtras.stdout));
      parts.push(toErrorSignalText(withExtras.cause));
    }

    if (typeof err === "object" && err !== null) {
      const maybeObj = err as {
        message?: unknown;
        stderr?: unknown;
        stdout?: unknown;
        response?: unknown;
      };
      parts.push(toErrorSignalText(maybeObj.message));
      parts.push(toErrorSignalText(maybeObj.stderr));
      parts.push(toErrorSignalText(maybeObj.stdout));
      parts.push(toErrorSignalText(maybeObj.response));
    }

    const firstLine = parts
      .map((part) => part.replace(/\s+/g, " ").trim())
      .find((part) => part.length > 0);

    return firstLine ?? "Unknown publish failure";
  }

  function buildExplicitReviewPublishFailureBody(publishErr: unknown): string {
    const detail = summarizeErrorForDiagnostics(publishErr);
    const category = classifyError(publishErr, false);
    return wrapInDetails(
      formatErrorComment(
        category,
        `Review execution finished, but GitHub rejected the publish step. ${detail}`,
      ),
      "Kodiai couldn't publish the review result",
    );
  }

  function extractExplicitReviewResultFindingLines(resultText: string | undefined): string[] {
    if (!resultText) {
      return [];
    }

    const findings: string[] = [];
    const numberedFindings: Array<{
      index: number;
      path: string;
      lineNo: string;
      title: string;
    }> = [];
    const numberedSeverityByIndex = new Map<number, string>();
    let currentFilePath: string | null = null;
    let currentSeveritySection: string | null = null;
    const headingPattern = /^#{1,6}\s*\d+\.\s*\*\*\[(CRITICAL|MAJOR|MEDIUM|MINOR)\]\s+(.+?)\s+-\s+(.+?)\*\*\s*$/i;
    const inlinePattern = /^\[(CRITICAL|MAJOR|MEDIUM|MINOR)\]\s+(.+?)\s+\((\d+(?:-\d+)?)\):\s+(.+)$/i;
    const numberedPattern = /^(\d+)\.\s+\*\*(.+?):(\d+(?:-\d+)?)\*\*\s+-\s+(.+)$/;
    const severitySummaryPattern = /^-\s+\*\*\d+\s+(CRITICAL|MAJOR|MEDIUM|MINOR)\s+issues?\*\*:\s+(.+)$/i;
    const severitySectionPattern = /^#{1,6}\s+(CRITICAL|MAJOR|MEDIUM|MINOR)\s+issues\b[:\s]*$/i;
    const sectionedBoldFindingPattern = /^\*\*(\d+)\.\s+(?:\[(CRITICAL|MAJOR|MEDIUM|MINOR)\]\s+)?(.+?)\*\*\s+\((.+?):(\d+(?:-\d+)?)\)$/i;
    const fileHeaderPattern = /^###\s+(.+)$/;
    const fileScopedLinePattern = /^(\d+)\.\s+\*\*Line\s+(\d+(?:-\d+)?)\s+\[(CRITICAL|MAJOR|MEDIUM|MINOR)\]\*\*:\s+(.+)$/i;

    for (const rawLine of resultText.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }

      const severitySectionMatch = line.match(severitySectionPattern);
      if (severitySectionMatch) {
        currentSeveritySection = severitySectionMatch[1]?.toLowerCase() ?? null;
        currentFilePath = null;
        continue;
      }

      const headingMatch = line.match(headingPattern);
      if (headingMatch) {
        const severity = headingMatch[1];
        const location = headingMatch[2];
        const title = headingMatch[3];
        if (!severity || !location || !title) {
          continue;
        }
        const locationMatch = location.trim().match(/^(.*?):(\d+(?:-\d+)?)$/);
        const path = locationMatch?.[1]?.trim() || location.trim();
        const lineNo = locationMatch?.[2]?.trim() || "0";
        findings.push(`- (${findings.length + 1}) [${severity.toLowerCase()}] ${path} (${lineNo}): ${title.trim()}`);
        continue;
      }

      const inlineMatch = line.match(inlinePattern);
      if (inlineMatch) {
        const severity = inlineMatch[1];
        const path = inlineMatch[2];
        const lineNo = inlineMatch[3];
        const title = inlineMatch[4];
        if (!severity || !path || !lineNo || !title) {
          continue;
        }
        findings.push(`- (${findings.length + 1}) [${severity.toLowerCase()}] ${path.trim()} (${lineNo.trim()}): ${title.trim()}`);
        continue;
      }

      const sectionedBoldFindingMatch = line.match(sectionedBoldFindingPattern);
      if (sectionedBoldFindingMatch) {
        const severity = (sectionedBoldFindingMatch[2] ?? currentSeveritySection)?.toLowerCase();
        const title = sectionedBoldFindingMatch[3]?.trim();
        const path = sectionedBoldFindingMatch[4]?.trim();
        const lineNo = sectionedBoldFindingMatch[5]?.trim();
        if (!severity || !title || !path || !lineNo) {
          continue;
        }
        findings.push(`- (${findings.length + 1}) [${severity}] ${path} (${lineNo}): ${title}`);
        continue;
      }

      const fileHeaderMatch = line.match(fileHeaderPattern);
      if (fileHeaderMatch) {
        const candidatePath = fileHeaderMatch[1]?.trim() ?? "";
        currentFilePath = candidatePath.includes("/") && candidatePath.includes(".")
          ? candidatePath
          : null;
        continue;
      }

      const fileScopedLineMatch = line.match(fileScopedLinePattern);
      if (fileScopedLineMatch && currentFilePath) {
        const lineNo = fileScopedLineMatch[2]?.trim();
        const severity = fileScopedLineMatch[3]?.toLowerCase();
        const title = fileScopedLineMatch[4]?.trim();
        if (!lineNo || !severity || !title) {
          continue;
        }
        findings.push(`- (${findings.length + 1}) [${severity}] ${currentFilePath} (${lineNo}): ${title}`);
        continue;
      }

      const numberedMatch = line.match(numberedPattern);
      if (numberedMatch) {
        const findingIndex = Number.parseInt(numberedMatch[1] ?? "", 10);
        const path = numberedMatch[2]?.trim();
        const lineNo = numberedMatch[3]?.trim();
        const title = numberedMatch[4]?.trim();
        if (!Number.isInteger(findingIndex) || findingIndex < 1 || !path || !lineNo || !title) {
          continue;
        }
        numberedFindings.push({ index: findingIndex, path, lineNo, title });
        continue;
      }

      const severitySummaryMatch = line.match(severitySummaryPattern);
      if (severitySummaryMatch) {
        const severity = severitySummaryMatch[1]?.toLowerCase();
        const summary = severitySummaryMatch[2];
        if (!severity || !summary) {
          continue;
        }
        for (const match of summary.matchAll(/#(\d+)/g)) {
          const findingIndex = Number.parseInt(match[1] ?? "", 10);
          if (Number.isInteger(findingIndex) && findingIndex > 0) {
            numberedSeverityByIndex.set(findingIndex, severity);
          }
        }
      }
    }

    if (findings.length > 0) {
      return findings;
    }

    if (numberedFindings.length === 0) {
      return [];
    }

    return numberedFindings
      .sort((a, b) => a.index - b.index)
      .map((finding, arrayIndex) => {
        const severity = numberedSeverityByIndex.get(finding.index) ?? "major";
        return `- (${arrayIndex + 1}) [${severity}] ${finding.path} (${finding.lineNo}): ${finding.title}`;
      });
  }

  function hasExplicitReviewBlockingSignals(resultText: string | undefined): boolean {
    if (!resultText) {
      return false;
    }

    const text = resultText.toLowerCase();
    if (
      text.includes("no blocking issues found")
      || text.includes("ready to merge")
      || text.includes("decision: approve")
    ) {
      return false;
    }

    return (
      /found(?:\s+\*\*\d+)?\s+(?:several|multiple|\d+)?\s*(?:blocking|critical\/major|critical and major|major and critical|critical|major)\s+issues/.test(text)
      || /cannot be merged/.test(text)
      || /should not be merged/.test(text)
      || /address before merging/.test(text)
      || /critical issues found/.test(text)
      || /\bblocking issues\b/.test(text)
    );
  }

  function buildIssueWriteSuccessReply(params: {
    prUrl: string;
    issueLinkbackUrl: string;
  }): string {
    const lines = [
      "status: success",
      `pr_url: ${params.prUrl}`,
      `issue_linkback_url: ${params.issueLinkbackUrl}`,
      "",
      `Opened PR: ${params.prUrl}`,
    ];

    return wrapInDetails(lines.join("\n"), "kodiai response");
  }

  function buildIssueWriteFailureReply(params: {
    failedStep: IssueWriteFailureStep;
    diagnostics: string;
    retryCommand: string;
  }): string {
    const lines = [
      "Write request failed before PR publication completed.",
      "",
      "status: pr_creation_failed",
      `failed_step: ${params.failedStep}`,
      `diagnostics: ${params.diagnostics}`,
      "",
      "Next step: Fix the failed step and retry the exact same command.",
      `Retry command: ${params.retryCommand}`,
    ];

    return wrapInDetails(lines.join("\n"), "kodiai response");
  }

  function isLikelyWritePermissionFailure(err: unknown): boolean {
    if (!err) {
      return false;
    }

    const status =
      typeof err === "object" && err !== null && "status" in err && typeof err.status === "number"
        ? err.status
        : undefined;

    if (status === 401 || status === 403) {
      return true;
    }

    const parts: string[] = [];
    if (err instanceof Error) {
      parts.push(err.message);
      const errorWithExtras = err as Error & {
        stderr?: unknown;
        stdout?: unknown;
        cause?: unknown;
      };
      parts.push(toErrorSignalText(errorWithExtras.stderr));
      parts.push(toErrorSignalText(errorWithExtras.stdout));
      parts.push(toErrorSignalText(errorWithExtras.cause));
    }

    if (typeof err === "object" && err !== null) {
      const obj = err as {
        message?: unknown;
        stderr?: unknown;
        stdout?: unknown;
        response?: unknown;
      };
      parts.push(toErrorSignalText(obj.message));
      parts.push(toErrorSignalText(obj.stderr));
      parts.push(toErrorSignalText(obj.stdout));
      parts.push(toErrorSignalText(obj.response));
    }

    const signal = parts.join("\n").toLowerCase();
    if (signal.length === 0) {
      return false;
    }

    return (
      signal.includes("resource not accessible by integration") ||
      signal.includes("permission to") ||
      signal.includes("write access to repository not granted") ||
      signal.includes("permission denied") ||
      signal.includes("insufficient permission") ||
      signal.includes("forbidden") ||
      signal.includes("not permitted") ||
      signal.includes("requires write")
    );
  }

  function splitGitLines(output: string): string[] {
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  async function collectPrReviewPromptDiff(input: {
    workspaceDir: string;
    owner: string;
    repo: string;
    prNumber: number;
    baseRef: string;
    surface: MentionEvent["surface"];
    token?: string;
    fallbackFileProvider?: () => Promise<string[]>;
  }): Promise<{
    changedFiles: string[];
    numstatLines: string[];
    diffRange: string;
  }> {
    const diffContext = await collectDiffContext({
      workspaceDir: input.workspaceDir,
      baseRef: input.baseRef,
      maxFilesForFullDiff: 0,
      logger,
      baseLog: {
        surface: input.surface,
        owner: input.owner,
        repo: input.repo,
        prNumber: input.prNumber,
      },
      token: input.token,
      fallbackFileProvider: input.fallbackFileProvider,
    });

    return {
      changedFiles: diffContext.changedFiles,
      numstatLines: diffContext.numstatLines,
      diffRange: diffContext.diffRange,
    };
  }

  function stripIssueIntentWrappers(userQuestion: string): string {
    let normalized = userQuestion.trim().replace(/\s+/g, " ");

    for (let i = 0; i < 4; i++) {
      const before = normalized;
      normalized = normalized
        .replace(/^(?:>+\s*)+/, "")
        .replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, "")
        .replace(/^\/[a-z0-9._:-]+(?:\s+|$)/i, "")
        .replace(/^https?:\/\/\S+(?:\s+|$)/i, "")
        .replace(/^[`'"([{]+/, "")
        .replace(/^[,.;:!?\-\s]+/, "")
        .replace(/^(?:hey|hi|hello|quick question|question|fyi|context)[,\-:]\s+/i, "")
        .trim();
      if (normalized === before || normalized.length === 0) break;
    }

    return normalized;
  }

  function isImplementationRequestWithoutPrefix(userQuestion: string): boolean {
    const normalized = stripIssueIntentWrappers(userQuestion).toLowerCase();
    if (normalized.length === 0) return false;

    const implementationVerb =
      "(?:fix|update|change|refactor|add|remove|implement|create|rename|rewrite|patch|write|open|submit|send)";
    const rewriteVerb = "(?:improve|tweak|clean\\s*up|cleanup|clarify)";
    const codeTarget =
      "(?:code|logic|behavior|copy|text|wording|message|handler|prompt|response|implementation|flow|gating|function|test(?:s)?|readme|docs?|config|types?)";
    const styleOutcome = "(?:clear(?:er)?|better|safer|faster|consistent|more\\s+readable)";

    const directCommand = new RegExp(`^${implementationVerb}\\b`);
    const politeCommand = new RegExp(`^(?:please\\s+)?${implementationVerb}\\b`);
    const explicitAsk = new RegExp(
      `^(?:can|could|would|will)\\s+you\\s+(?:please\\s+)?(?:help\\s+me\\s+)?${implementationVerb}\\b`,
    );
    const rewriteCommand = new RegExp(
      `^(?:please\\s+)?${rewriteVerb}\\b(?:.{0,80})\\b${codeTarget}\\b`,
    );
    const rewriteAsk = new RegExp(
      `^(?:can|could|would|will)\\s+you\\s+(?:please\\s+)?(?:help\\s+me\\s+)?${rewriteVerb}\\b(?:.{0,80})\\b${codeTarget}\\b`,
    );
    const makeStyleCommand = new RegExp(
      `^(?:please\\s+)?make\\b(?:.{0,120})\\b${styleOutcome}\\b(?:.{0,120})\\b${codeTarget}\\b`,
    );
    const makeStyleAsk = new RegExp(
      `^(?:can|could|would|will)\\s+you\\s+(?:please\\s+)?(?:help\\s+me\\s+)?make\\b(?:.{0,120})\\b${styleOutcome}\\b(?:.{0,120})\\b${codeTarget}\\b`,
    );

    return (
      directCommand.test(normalized) ||
      politeCommand.test(normalized) ||
      explicitAsk.test(normalized) ||
      rewriteCommand.test(normalized) ||
      rewriteAsk.test(normalized) ||
      makeStyleCommand.test(normalized) ||
      makeStyleAsk.test(normalized)
    );
  }

  function isConversationalConfirmation(text: string): boolean {
    const normalized = stripIssueIntentWrappers(text).toLowerCase();
    if (normalized.length === 0) return false;

    const actionSignal =
      /(?:\bwrite\b|\bdo\s+it\b|\bgo\s+ahead\b|\bproceed\b|\bpr\b|\bimplement\b|\bfix\b|\bopen\b|\bsubmit\b|\bsend\b|\bmake\b|\bcreate\b)/;

    // Confirmation + action: "yes, please write the PR", "yes do it", "yes go ahead"
    // NOTE: "please" is intentionally excluded — it is a politeness prefix, not a confirmation.
    // "please do X" should be handled by the implementation-verb patterns, not treated as
    // a confirmation of a prior offer. Including "please" here caused "please do a full review
    // of this PR" to match as write intent (confirmationAction="please" + actionSignal="\bpr\b").
    const confirmationAction = /^(?:yes|yeah|yep|yup|sure|ok|okay|absolutely|definitely)\b/;
    // Sentiment + action: "sounds good, go ahead", "looks good, make the PR"
    const sentimentAction =
      /^(?:sounds?\s+good|looks?\s+good|that(?:'s|\s+is)\s+(?:good|great|perfect|fine)|perfect|great)\b/;
    // Standalone action: "go ahead", "do it", "please proceed"
    const standaloneAction =
      /^(?:(?:please\s+)?go\s+ahead|(?:please\s+)?do\s+it|(?:please\s+)?proceed)\b/;

    if (standaloneAction.test(normalized)) return true;
    if ((confirmationAction.test(normalized) || sentimentAction.test(normalized)) && actionSignal.test(normalized))
      return true;

    return false;
  }

  /**
   * Detect explicit review requests on PR surfaces.
   *
   * Review requests should never trigger write mode — the bot should post a review
   * comment/summary on the PR, not open a new PR. This guard must run before
   * detectImplicitPrPatchIntent so that "please do a full review" doesn't fall
   * through to the patch/apply detection path.
   *
   * Returns true if the request is unambiguously asking for a code review.
   */
  function isReviewRequest(userQuestion: string): boolean {
    const normalized = stripIssueIntentWrappers(userQuestion).toLowerCase().trim();
    if (normalized.length === 0) return false;

    const reviewCommand =
      "(?:do\\s+(?:a\\s+)?(?:full\\s+)?review|review|(?:retry|rerun|re-run)\\s+(?:the\\s+)?(?:full\\s+)?review)";

    // Direct: "review this", "review the PR", "do a full review", "please retry review"
    const reviewDirect = new RegExp(`^(?:please\\s+)?${reviewCommand}\\b`);
    // Polite ask: "can you review", "can you do a review", "can you retry the review"
    const reviewAsk = new RegExp(`^(?:can|could|would|will)\\s+you\\s+(?:please\\s+)?${reviewCommand}\\b`);

    return reviewDirect.test(normalized) || reviewAsk.test(normalized);
  }

  async function handleMention(event: WebhookEvent): Promise<void> {
    const appSlug = githubApp.getAppSlug();
    const possibleHandles = [appSlug, "kodai", "claude"];

    const action = (event.payload as Record<string, unknown>).action as string | undefined;

    // Normalize payload based on event type
    let mention: MentionEvent;

    if (event.name === "issue_comment") {
      if ((event.payload as Record<string, unknown>).action !== "created") return;
      mention = normalizeIssueComment(event.payload as unknown as IssueCommentCreatedEvent);
    } else if (event.name === "pull_request_review_comment") {
      if ((event.payload as Record<string, unknown>).action !== "created") return;
      mention = normalizeReviewComment(
        event.payload as unknown as PullRequestReviewCommentCreatedEvent,
      );
    } else if (event.name === "pull_request_review") {
      if ((event.payload as Record<string, unknown>).action !== "submitted") return;
      const payload = event.payload as unknown as PullRequestReviewSubmittedEvent;
      // Review body can be null (e.g. approval with no comment)
      if (!payload.review.body) return;
      mention = normalizeReviewBody(payload);
    } else {
      return;
    }

    // Fast filter: ignore if neither @appSlug nor @claude appear.
    // NOTE: Use a simple substring check here to avoid regex edge cases.
    // We still do the authoritative accepted-handles check inside the job after loading config.
    const bodyLower = mention.commentBody.toLowerCase();
    const appHandle = `@${appSlug.toLowerCase()}`;
    if (!bodyLower.includes(appHandle) && !bodyLower.includes("@kodai") && !bodyLower.includes("@claude")) return;

    const normalizedCommentAuthor = mention.commentAuthor.toLowerCase();
    if (
      normalizedCommentAuthor === appSlug.toLowerCase() ||
      normalizedCommentAuthor.endsWith("[bot]")
    ) {
      logger.debug(
        {
          owner: mention.owner,
          repo: mention.repo,
          commentAuthor: mention.commentAuthor,
          issueNumber: mention.issueNumber,
          prNumber: mention.prNumber,
        },
        "Skipping mention from self (comment-author defense)",
      );
      return;
    }

    // No tracking comment. Tracking is via eyes reaction only.
    // The response will be posted as a new comment.

    const provisionalUserQuestion = stripMention(mention.commentBody, possibleHandles);
    const reviewPrNumber = mention.prNumber;
    const isExplicitReviewRequest =
      reviewPrNumber !== undefined && isReviewRequest(provisionalUserQuestion);
    const mentionQueueKey = buildMentionQueueKey(
      mention.owner,
      mention.repo,
      reviewPrNumber ?? mention.issueNumber,
    );
    const queuedReviewWorkAttempt = reviewPrNumber !== undefined && isExplicitReviewRequest
      ? reviewWorkCoordinator.claim({
          familyKey: buildReviewFamilyKey(mention.owner, mention.repo, reviewPrNumber),
          source: "explicit-review",
          lane: "interactive-review",
          deliveryId: event.id,
          phase: "claimed",
        })
      : undefined;
    if (queuedReviewWorkAttempt) {
      const predecessor = findLatestReviewPredecessor(
        reviewWorkCoordinator.getSnapshot(queuedReviewWorkAttempt.familyKey),
        queuedReviewWorkAttempt.attemptId,
      );
      if (predecessor) {
        logger.info(
          {
            surface: mention.surface,
            owner: mention.owner,
            repo: mention.repo,
            prNumber: reviewPrNumber,
            gate: "review-family-coordinator",
            gateResult: "claimed-with-predecessor",
            reviewFamilyKey: queuedReviewWorkAttempt.familyKey,
            reviewWorkAttemptId: queuedReviewWorkAttempt.attemptId,
            predecessorAttemptId: predecessor.attemptId,
            predecessorPhase: predecessor.phase,
            predecessorAgeMs: Math.max(
              0,
              queuedReviewWorkAttempt.claimedAtMs - predecessor.lastProgressAtMs,
            ),
          },
          "Explicit review claim found a stale predecessor attempt",
        );
      }
    }
    let reviewWorkAttemptCommitted = false;
    let reviewWorkAttemptFinalized = false;

    function finalizeQueuedReviewWorkAttempt(): void {
      if (!queuedReviewWorkAttempt || reviewWorkAttemptFinalized) {
        return;
      }

      reviewWorkAttemptFinalized = true;
      if (reviewWorkAttemptCommitted) {
        reviewWorkCoordinator.complete(queuedReviewWorkAttempt.attemptId);
        return;
      }

      reviewWorkCoordinator.release(queuedReviewWorkAttempt.attemptId);
    }

    try {
      await jobQueue.enqueue(event.installationId, async () => {
      let workspace: Workspace | undefined;
      let acquiredWriteKey: string | undefined;
      const reviewWorkAttempt = queuedReviewWorkAttempt;
      let reviewPublishRightsLost = false;
      let explicitReviewRequest = false;
      let reviewOutputKey: string | undefined;
      const explicitReviewUsesCanonicalHandle =
        reviewWorkAttempt !== undefined && (
          mention.commentBody.toLowerCase().includes(`@${appSlug.toLowerCase()}`)
          || mention.commentBody.toLowerCase().includes("@kodai")
        );

      function setReviewWorkPhase(phase: ReviewWorkPhase): void {
        if (!reviewWorkAttempt) {
          return;
        }
        reviewWorkAttemptCommitted = true;
        reviewWorkCoordinator.setPhase(reviewWorkAttempt.attemptId, phase);
      }

      function canPublishExplicitReviewOutput(outputLabel: string, reviewOutputKey?: string): boolean {
        if (!reviewWorkAttempt) {
          return true;
        }
        const attempt = reviewWorkAttempt;
        if (reviewWorkCoordinator.canPublish(attempt.attemptId)) {
          return true;
        }

        reviewPublishRightsLost = true;
        const currentAttempt = reviewWorkCoordinator
          .getSnapshot(attempt.familyKey)
          ?.attempts.find((candidateAttempt) => candidateAttempt.attemptId === attempt.attemptId);
        logger.info(
          {
            surface: mention.surface,
            owner: mention.owner,
            repo: mention.repo,
            prNumber: mention.prNumber,
            gate: "review-family-coordinator",
            gateResult: "skipped",
            skipReason: "publish-rights-lost",
            reviewOutputKey: reviewOutputKey ?? null,
            reviewFamilyKey: attempt.familyKey,
            reviewWorkAttemptId: attempt.attemptId,
            supersededByAttemptId: currentAttempt?.supersededByAttemptId ?? null,
          },
          `Skipping ${outputLabel} because publish rights were superseded`,
        );
        return false;
      }

      try {
        const octokit = await githubApp.getInstallationOctokit(event.installationId);

        async function postMentionReply(
          replyBody: string,
          options?: { sanitizeMentions?: boolean },
        ): Promise<void> {
          let sanitizedBody =
            options?.sanitizeMentions === false
              ? replyBody
              : sanitizeOutgoingMentions(replyBody, possibleHandles);

          // Guardrail pipeline: filter LLM-prose output before publishing (GUARD-07)
          // Only run on substantive LLM prose; skip template/status messages
          // (wrapped in <details> tags or short messages).
          // Fail-open: on error, use original sanitized body.
          const isTemplateBased = sanitizedBody.trimStart().startsWith("<details>") || sanitizedBody.length <= 500;
          if (!isTemplateBased) {
            try {
              const guardResult = await runGuardrailPipeline({
                adapter: mentionAdapter,
                input: {
                  issueBody: mention.commentBody,
                  prDescription: undefined,
                  conversationHistory: [],
                  retrievalResults: [],
                },
                output: sanitizedBody,
                config: { strictness: "standard" },
                repo: `${mention.owner}/${mention.repo}`,
                auditStore: guardrailAuditStore,
              });
              if (guardResult.output !== null && !guardResult.suppressed) {
                sanitizedBody = guardResult.output;
              }
              // If suppressed, keep original body (fail-open)
            } catch {
              // Guardrail error: fail-open, use original sanitized body
            }
          }

          // Prefer replying in-thread for inline review comment mentions.
          if (mention.surface === "pr_review_comment" && mention.prNumber !== undefined) {
            try {
              await octokit.rest.pulls.createReplyForReviewComment({
                owner: mention.owner,
                repo: mention.repo,
                pull_number: mention.prNumber,
                comment_id: mention.commentId,
                body: sanitizedBody,
              });
              return;
            } catch (err) {
              logger.warn(
                { err, prNumber: mention.prNumber, commentId: mention.commentId },
                "Failed to post in-thread reply; falling back to top-level comment",
              );
            }
          }

          await octokit.rest.issues.createComment({
            owner: mention.owner,
            repo: mention.repo,
            issue_number: mention.issueNumber,
            body: sanitizedBody,
          });
        }

        async function postMentionError(errorBody: string): Promise<MentionErrorPostResult> {
          const sanitizedBody = sanitizeOutgoingMentions(errorBody, possibleHandles);
          // Prefer replying in-thread for inline review comment mentions.
          if (mention.surface === "pr_review_comment" && mention.prNumber !== undefined) {
            try {
              await octokit.rest.pulls.createReplyForReviewComment({
                owner: mention.owner,
                repo: mention.repo,
                pull_number: mention.prNumber,
                comment_id: mention.commentId,
                body: sanitizedBody,
              });
              return { posted: true, delivery: "review-thread-reply" };
            } catch (err) {
              logger.warn(
                { err, prNumber: mention.prNumber, commentId: mention.commentId },
                "Failed to post in-thread error reply; falling back to top-level error comment",
              );
            }
          }

          const commentStatus = await postOrUpdateErrorComment(
            octokit,
            {
              owner: mention.owner,
              repo: mention.repo,
              issueNumber: mention.issueNumber,
            },
            sanitizedBody,
            logger,
          );

          if (commentStatus.ok) {
            return {
              posted: true,
              delivery:
                commentStatus.resolution === "updated"
                  ? "error-comment-updated"
                  : "error-comment-created",
            };
          }

          return { posted: false, delivery: "error-comment-failed" };
        }

        // Determine clone parameters
        let cloneOwner = mention.owner;
        let cloneRepo = mention.repo;
        let cloneRef: string | undefined;
        let cloneDepth = 1;
        let usesPrRef = false;

        if (mention.prNumber !== undefined) {
          cloneDepth = 50; // PR mentions need diff context

          // Ensure PR details are available (issue_comment on PR requires a pulls.get fetch).
          if (!mention.baseRef || !mention.headRef) {
            const { data: pr } = await octokit.rest.pulls.get({
              owner: mention.owner,
              repo: mention.repo,
              pull_number: mention.prNumber,
            });
            mention.headRef = pr.head.ref;
            mention.baseRef = pr.base.ref;
            mention.headRepoOwner = pr.head.repo?.owner.login;
            mention.headRepoName = pr.head.repo?.name;
          }

          // Fork-safe workspace strategy: clone base repo at base ref, then fetch+checkout
          // refs/pull/<n>/head from the base repo.
          // This avoids relying on access to contributor forks and mirrors the review handler.
          cloneOwner = mention.owner;
          cloneRepo = mention.repo;
          cloneRef = mention.baseRef;
          usesPrRef = true;
        } else {
          // Pure issue mention -- clone default branch
          const repoPayload = event.payload as Record<string, unknown>;
          const repository = repoPayload.repository as Record<string, unknown> | undefined;
          cloneRef = (repository?.default_branch as string) ?? "main";
        }

        logger.info(
          {
            surface: mention.surface,
            owner: mention.owner,
            repo: mention.repo,
            issueNumber: mention.issueNumber,
            prNumber: mention.prNumber,
            cloneOwner,
            cloneRepo,
            cloneRef,
            cloneDepth,
            usesPrRef,
            workspaceStrategy: usesPrRef
              ? "base-clone+pull-ref-fetch"
              : "direct-branch-clone",
          },
          "Creating workspace for mention execution",
        );

        // Fork-based write mode: ensure fork exists and sync before cloning (Phase 127)
        // Preliminary write intent check before config is available -- fork setup is
        // harmless if config later disables write, so we gate only on user intent.
        const prelimWriteIntent = parseWriteIntent(
          stripMention(mention.commentBody, [appSlug, "claude"]),
        );
        const maybeWriteMode = prelimWriteIntent.writeIntent && prelimWriteIntent.keyword !== "plan";
        let forkContext: { forkOwner: string; forkRepo: string; botPat: string } | undefined;
        if (maybeWriteMode && !forkManager?.enabled) {
          logger.warn(
            { owner: mention.owner, repo: mention.repo },
            "Write-mode active without BOT_USER_PAT; using legacy direct-push behavior",
          );
        }
        if (forkManager?.enabled && maybeWriteMode && !usesPrRef) {
          try {
            const fork = await forkManager.ensureFork(mention.owner, mention.repo);
            await forkManager.syncFork(fork.forkOwner, fork.forkRepo, cloneRef!);
            forkContext = {
              forkOwner: fork.forkOwner,
              forkRepo: fork.forkRepo,
              botPat: forkManager.getBotPat(),
            };
            logger.info(
              { owner: mention.owner, repo: mention.repo, forkOwner: fork.forkOwner, forkRepo: fork.forkRepo },
              "Fork ensured and synced for write-mode",
            );
          } catch (forkErr) {
            logger.warn(
              { err: forkErr, owner: mention.owner, repo: mention.repo },
              "Fork setup failed; will fall back to gist or legacy mode",
            );
            // forkContext stays undefined -- handled later in output routing
          }
        }

        // Clone workspace
        if (explicitReviewUsesCanonicalHandle) {
          setReviewWorkPhase("workspace-create");
        }
        workspace = await workspaceManager.create(event.installationId, {
          owner: cloneOwner,
          repo: cloneRepo,
          ref: cloneRef!,
          depth: cloneDepth,
          forkContext,
        });

        // PR mentions: fetch and checkout PR head ref from base repo.
        if (usesPrRef && mention.prNumber !== undefined) {
          await fetchAndCheckoutPullRequestHeadRef({
            dir: workspace.dir,
            prNumber: mention.prNumber,
            localBranch: "pr-mention",
            token: workspace.token,
          });

          // Ensure base branch exists as a remote-tracking ref so git diff tools can compare
          // origin/BASE...HEAD even in --single-branch workspaces.
          if (mention.baseRef) {
            const fetchRemote1 = await buildAuthFetchUrl(workspace.dir, workspace.token);
            await $`git -C ${workspace.dir} fetch ${fetchRemote1} ${mention.baseRef}:refs/remotes/origin/${mention.baseRef} --depth=1`.quiet();
          }
        }

        if (explicitReviewUsesCanonicalHandle) {
          setReviewWorkPhase("load-config");
        }
        // Load repo config
        const { config, warnings } = await loadRepoConfig(workspace.dir);
        for (const w of warnings) {
          logger.warn(
            { section: w.section, issues: w.issues },
            "Config warning detected",
          );
        }

        // Check mention.enabled
        if (!config.mention.enabled) {
          logger.info(
            { owner: mention.owner, repo: mention.repo },
            "Mentions disabled in config, skipping",
          );
          return;
        }

        const findingLookup = deps.knowledgeStore?.getFindingByCommentId
          ? async (repo: string, commentId: number) =>
              deps.knowledgeStore!.getFindingByCommentId!({ repo, commentId })
          : undefined;

        // Check mention.allowedUsers (CONFIG-07)
        if (config.mention.allowedUsers.length > 0) {
          const normalizedAuthor = mention.commentAuthor.toLowerCase();
          const allowed = config.mention.allowedUsers.map((u) => u.toLowerCase());
          if (!allowed.includes(normalizedAuthor)) {
            logger.info(
              {
                owner: mention.owner,
                repo: mention.repo,
                commentAuthor: mention.commentAuthor,
                gate: "mention-allowed-users",
                gateResult: "skipped",
                skipReason: "user-not-allowlisted",
              },
              "Mention author not in allowedUsers, skipping",
            );
            return;
          }
        }

        // Global alias: treat @claude as an always-on alias for mentions.
        // (Repo-level opt-out remains possible via mention.acceptClaudeAlias=false,
        // but the alias is enabled by default to support immediate cutover.)
        const acceptClaudeAlias = config.mention.acceptClaudeAlias !== false;
        const acceptedHandles = acceptClaudeAlias ? [appSlug, "kodai", "claude"] : [appSlug, "kodai"];

        // Ensure the mention is actually allowed for this repo (e.g. @claude opt-out).
        // Use substring match to align with the fast filter.
        const acceptedBodyLower = mention.commentBody.toLowerCase();
        const accepted = acceptedHandles
          .map((h) => (h.startsWith("@") ? h : `@${h}`))
          .map((h) => h.toLowerCase());
        if (!accepted.some((h) => acceptedBodyLower.includes(h))) {
          logger.info(
            {
              surface: mention.surface,
              owner: mention.owner,
              repo: mention.repo,
              issueNumber: mention.issueNumber,
              prNumber: mention.prNumber,
              acceptClaudeAlias,
            },
            "Mention does not match accepted handles for repo; skipping",
          );
          return;
        }

        const userQuestion = stripMention(mention.commentBody, acceptedHandles);
        const normalizedQuestion = userQuestion.trim().toLowerCase();
        if (userQuestion.trim().length === 0) {
          logger.info(
            {
              surface: mention.surface,
              owner: mention.owner,
              repo: mention.repo,
              issueNumber: mention.issueNumber,
              prNumber: mention.prNumber,
              acceptClaudeAlias,
            },
            "Mention contained no question after stripping mention; skipping",
          );
          return;
        }

        const isIssueThreadComment = event.name === "issue_comment" && mention.prNumber === undefined;
        const isPrSurface = mention.prNumber !== undefined;
        explicitReviewRequest = isPrSurface && isReviewRequest(userQuestion);
        const parsedWriteIntent = parseWriteIntent(userQuestion);

        // Issue surfaces: broad implicit intent detection (existing behavior)
        const implicitIntent =
          isIssueThreadComment && !parsedWriteIntent.writeIntent
            ? detectImplicitIssueIntent(parsedWriteIntent.request)
            : undefined;

        // PR surfaces: broad write intent detection (implementation verbs, confirmations, patches)
        // Guard: explicit review requests must never trigger write mode — they are always read-only.
        const prWriteIntent =
          isPrSurface && !isIssueThreadComment && !parsedWriteIntent.writeIntent &&
          !isReviewRequest(parsedWriteIntent.request)
            ? detectImplicitPrPatchIntent(parsedWriteIntent.request)
            : undefined;

        const effectiveImplicit = implicitIntent ?? prWriteIntent;

        const writeIntent =
          effectiveImplicit !== undefined && !parsedWriteIntent.writeIntent
            ? {
                writeIntent: true,
                keyword: effectiveImplicit,
                request: parsedWriteIntent.request,
              }
            : parsedWriteIntent;

        const isWriteRequest = writeIntent.writeIntent;
        const isPlanOnly = writeIntent.keyword === "plan";
        const writeEnabled = isWriteRequest && !isPlanOnly && config.write.enabled;
        const writeSource =
          mention.prNumber !== undefined
            ? { type: "pr" as const, number: mention.prNumber }
            : { type: "issue" as const, number: mention.issueNumber };

        const writeKeyword = writeIntent.keyword ?? "apply";
        const retryCommand =
          writeIntent.request.trim().length > 0
            ? `@${appSlug} ${writeKeyword}: ${writeIntent.request}`
            : `@${appSlug} ${writeKeyword}: <same request>`;

        const buildWritePermissionFailureReply = (): string =>
          wrapInDetails(
            [
              "I couldn't complete this write request because of missing GitHub App permissions.",
              "",
              "Minimum required permissions for write-mode PR creation:",
              "- `Contents: Read and write`",
              "- `Pull requests: Read and write`",
              "- `Issues: Read and write`",
              "",
              "After updating permissions on the app installation, re-run the same command:",
              `- \`${retryCommand}\``,
            ].join("\n"),
            "kodiai response",
          );

        const maybeReplyWritePermissionFailure = async (err: unknown): Promise<boolean> => {
          if (!isLikelyWritePermissionFailure(err)) {
            return false;
          }
          await postMentionReply(buildWritePermissionFailureReply(), { sanitizeMentions: false });
          return true;
        };

        const writeOutputKey =
          writeEnabled
            ? buildWriteOutputKey({
                installationId: event.installationId,
                owner: mention.owner,
                repo: mention.repo,
                sourceType: writeSource.type,
                sourceNumber: writeSource.number,
                commentId: mention.commentId,
                keyword: writeKeyword,
              })
            : undefined;

        const writeBranchName =
          writeOutputKey
            ? buildWriteBranchName({
                sourceType: writeSource.type,
                sourceNumber: writeSource.number,
                commentId: mention.commentId,
                writeOutputKey,
              })
            : undefined;

        const triggerCommentUrl =
          mention.prNumber !== undefined
            ? `https://github.com/${mention.owner}/${mention.repo}/pull/${mention.prNumber}#issuecomment-${mention.commentId}`
            : `https://github.com/${mention.owner}/${mention.repo}/issues/${mention.issueNumber}#issuecomment-${mention.commentId}`;

        if (writeEnabled && writeOutputKey && writeBranchName) {
          // Idempotency: if a PR already exists for this deterministic head branch, reuse it.
          try {
            const { data: prs } = await octokit.rest.pulls.list({
              owner: mention.owner,
              repo: mention.repo,
              state: "all",
              head: `${mention.owner}:${writeBranchName}`,
              per_page: 5,
            });

            const existing = prs[0];
            if (existing?.html_url) {
              logger.info(
                {
                  evidenceType: "write-mode",
                  outcome: "reused-pr",
                  deliveryId: event.id,
                  installationId: event.installationId,
                  owner: mention.owner,
                  repoName: mention.repo,
                  repo: `${mention.owner}/${mention.repo}`,
                  sourcePrNumber: mention.prNumber,
                  triggerCommentId: mention.commentId,
                  triggerCommentUrl,
                  writeOutputKey,
                  branchName: writeBranchName,
                  prUrl: existing.html_url,
                },
                "Evidence bundle",
              );

              const replyBody = wrapInDetails(
                [`Existing PR: ${existing.html_url}`].join("\n"),
                "kodiai response",
              );
              await postMentionReply(replyBody);
              return;
            }
          } catch (err) {
            logger.warn(
              { err, writeBranchName, writeOutputKey, prNumber: mention.prNumber },
              "Failed to look up existing PR for write idempotency; continuing",
            );
          }

          // Best-effort lock: prevent duplicate work for the same trigger.
          if (inFlightWriteKeys.has(writeOutputKey)) {
            const replyBody = wrapInDetails(
              [
                "Write request already in progress.",
                "",
                "If no PR appears shortly, retry the same comment.",
              ].join("\n"),
              "kodiai response",
            );
            await postMentionReply(replyBody);
            return;
          }
          inFlightWriteKeys.add(writeOutputKey);
          acquiredWriteKey = writeOutputKey;
        }

        if (writeEnabled && config.write.minIntervalSeconds > 0) {
          const key = `${event.installationId}:${mention.owner}/${mention.repo}`;
          const now = Date.now();
          pruneRateLimiter(now);
          const last = lastWriteAt.get(key);
          const minMs = config.write.minIntervalSeconds * 1000;

          if (last !== undefined && now - last < minMs) {
            const replyBody = wrapInDetails(
              [
                "Write request rate-limited.",
                "",
                `Try again in ${Math.ceil((minMs - (now - last)) / 1000)}s.`,
              ].join("\n"),
              "kodiai response",
            );
            await postMentionReply(replyBody);
            return;
          }
        }

        if (isWriteRequest && mention.prNumber === undefined && !isIssueThreadComment) {
          const replyBody = wrapInDetails(
            [
              "I can only apply changes in a PR context.",
              "",
              "Try mentioning me on a pull request (top-level comment or inline diff thread).",
            ].join("\n"),
            "kodiai response",
          );
          await postMentionReply(replyBody, { sanitizeMentions: false });
          return;
        }

        if (isWriteRequest && !isPlanOnly && !config.write.enabled) {
          logger.info(
            {
              surface: mention.surface,
              owner: mention.owner,
              repo: mention.repo,
              issueNumber: mention.issueNumber,
              prNumber: mention.prNumber,
              commentAuthor: mention.commentAuthor,
              keyword: writeIntent.keyword,
              gate: "write-mode",
              gateResult: "skipped",
              skipReason: "write-disabled",
            },
            "Write intent detected but write-mode disabled; refusing to apply changes",
          );

          const retryCommand =
            writeIntent.request.trim().length > 0
              ? `@${appSlug} ${writeKeyword}: ${writeIntent.request}`
              : `@${appSlug} ${writeKeyword}: <same request>`;

          const replyBody = wrapInDetails(
            [
              "Write mode is disabled for this repo.",
              "",
              "Update `.kodiai.yml`:",
              "```yml",
              "write:",
              "  enabled: true",
              "```",
              "",
              `Then re-run the same \`${retryCommand}\` command.`,
            ].join("\n"),
            "kodiai response",
          );

          await postMentionReply(replyBody, { sanitizeMentions: false });
          return;
        }

        if (mention.inReplyToId !== undefined) {
          const conversationKey = `${mention.owner}/${mention.repo}#${mention.prNumber ?? mention.issueNumber}`;
          const now = Date.now();
          pruneConversationTurns(now);
          const turns = prConversationTurns.get(conversationKey) ?? 0;
          if (turns >= config.mention.conversation.maxTurnsPerPr) {
            await postMentionReply(
              [
                `Conversation limit reached (${config.mention.conversation.maxTurnsPerPr} turns per PR).`,
                "Start a new thread or open a new issue for further questions.",
              ].join("\n"),
            );
            return;
          }
        }

        logger.info(
          {
            surface: mention.surface,
            owner: mention.owner,
            repo: mention.repo,
            issueNumber: mention.issueNumber,
            prNumber: mention.prNumber,
            commentAuthor: mention.commentAuthor,
            acceptClaudeAlias,
          },
          "Processing mention",
        );

        // Add eyes reaction to trigger comment for immediate visual acknowledgment
        try {
          if (mention.surface === "pr_review_comment") {
            await octokit.rest.reactions.createForPullRequestReviewComment({
              owner: mention.owner,
              repo: mention.repo,
              comment_id: mention.commentId,
              content: "eyes",
            });
          } else if (mention.surface === "pr_review_body") {
            // PR review bodies don't support reactions -- skip silently
            // (the review ID is not a comment ID, so the reaction endpoints would 404)
          } else {
            // issue_comment and pr_comment both use the issue comment reaction endpoint
            await octokit.rest.reactions.createForIssueComment({
              owner: mention.owner,
              repo: mention.repo,
              comment_id: mention.commentId,
              content: "eyes",
            });
          }
        } catch (err) {
          // Non-fatal: don't block processing if reaction fails
          logger.warn({ err, surface: mention.surface }, "Failed to add eyes reaction");
        }

        // Build mention context (conversation + PR metadata + inline diff context)
        // Non-fatal: if context fails to load, still attempt an answer with minimal prompt.
        let mentionContext = "";
        try {
          mentionContext = await buildMentionContext(octokit, mention, {
            findingLookup,
            maxThreadChars: config.mention.conversation.contextBudgetChars,
          });
        } catch (err) {
          logger.warn(
            { err, surface: mention.surface, issueNumber: mention.issueNumber },
            "Failed to build mention context; proceeding with empty context",
          );
        }

        if (isIssueThreadComment) {
          try {
            const issueCodeContext = await buildIssueCodeContext({
              workspaceDir: workspace.dir,
              question: writeIntent.request,
            });

            if (issueCodeContext.contextBlock.trim().length > 0) {
              const contextParts = [
                mentionContext.trim(),
                "## Candidate Code Pointers",
                "",
                issueCodeContext.contextBlock.trim(),
              ].filter((part) => part.length > 0);
              mentionContext = `${contextParts.join("\n")}`;
            }
          } catch (err) {
            logger.warn(
              { err, surface: mention.surface, issueNumber: mention.issueNumber },
              "Failed to build issue code context; proceeding without code pointers",
            );
          }
        }

        // Triage validation for issue mentions when enabled
        let triageContext = "";
        if (isIssueThreadComment && config.triage.enabled) {
          const cooldownKey = `${mention.owner}/${mention.repo}#${mention.issueNumber}`;
          const bodyHash = createHash("sha256")
            .update(mention.issueBody ?? "")
            .digest("hex")
            .slice(0, 16);
          const now = Date.now();
          pruneTriageCooldowns(now);
          const cooldownEntry = triageCooldowns.get(cooldownKey);
          const cooldownMs = (config.triage.cooldownMinutes ?? 30) * 60 * 1000;

          const withinCooldown =
            cooldownEntry &&
            cooldownEntry.bodyHash === bodyHash &&
            now - cooldownEntry.lastTriagedAt < cooldownMs;

          if (!withinCooldown) {
            try {
              const validationResult = await validateIssue({
                workspaceDir: workspace.dir,
                issueBody: mention.issueBody,
              });

              if (validationResult === null) {
                // No template matched
                triageContext = generateGenericNudge();
              } else if (!validationResult.valid) {
                const guidance = generateGuidanceComment(validationResult);
                const labelRec = generateLabelRecommendation({
                  result: validationResult,
                  labelAllowlist: config.triage.labelAllowlist ?? [],
                });

                triageContext = guidance;
                if (labelRec) {
                  triageContext += `\n\nRecommended label: \`${labelRec}\``;
                }
              }
              // If valid, triageContext stays empty -- no nudge needed

              // Update cooldown
              triageCooldowns.set(cooldownKey, { lastTriagedAt: now, bodyHash });
            } catch (err) {
              logger.warn(
                { err, issueNumber: mention.issueNumber },
                "Triage validation failed (fail-open)",
              );
            }
          }
        }

        let findingContext:
          | {
              severity: string;
              category: string;
              filePath: string;
              startLine: number | null;
              title: string;
            }
          | undefined;
        if (mention.inReplyToId !== undefined && findingLookup) {
          try {
            findingContext =
              (await findingLookup(`${mention.owner}/${mention.repo}`, mention.inReplyToId)) ?? undefined;
          } catch (err) {
            logger.warn(
              {
                err,
                owner: mention.owner,
                repo: mention.repo,
                inReplyToId: mention.inReplyToId,
              },
              "Failed to hydrate finding context; proceeding without finding metadata",
            );
          }
        }

        let retrievalContext: MentionRetrievalContext | undefined;
        let unifiedResultsForPrompt: import("../knowledge/cross-corpus-rrf.ts").UnifiedRetrievalChunk[] = [];
        let contextWindowForPrompt: string | undefined;
        let reviewPrecedentsForPrompt: import("../knowledge/review-comment-retrieval.ts").ReviewCommentMatch[] = [];
        let wikiKnowledgeForPrompt: import("../knowledge/wiki-retrieval.ts").WikiKnowledgeMatch[] = [];
        if (retriever && config.knowledge?.retrieval?.enabled) {
          try {
            let filePaths: string[] = [];
            if (mention.prNumber !== undefined && mention.baseRef) {
              // Try three-dot diff first; fall back to two-dot if merge-base unreachable (shallow clone).
              let diffResult = await $`git -C ${workspace.dir} diff origin/${mention.baseRef}...HEAD --name-only`
                .quiet()
                .nothrow();
              if (diffResult.exitCode !== 0) {
                diffResult = await $`git -C ${workspace.dir} diff origin/${mention.baseRef}..HEAD --name-only`
                  .quiet()
                  .nothrow();
              }
              if (diffResult.exitCode === 0) {
                filePaths = splitGitLines(diffResult.text());
              } else {
                logger.warn(
                  {
                    surface: mention.surface,
                    owner: mention.owner,
                    repo: mention.repo,
                    prNumber: mention.prNumber,
                    baseRef: mention.baseRef,
                    exitCode: diffResult.exitCode,
                  },
                  "Failed to collect mention retrieval file paths (fail-open)",
                );
              }
            }

            const prLanguages = Array.from(
              new Set(
                filePaths
                  .map((filePath) => classifyFileLanguage(filePath))
                  .filter((language) => language !== "Unknown")
                  // Normalize to lowercase for language-aware boosting in retrieval (LANG-01)
                  .map((language) => language.toLowerCase()
                    .replace("c++", "cpp")
                    .replace("c#", "csharp")
                    .replace("objective-c++", "objectivecpp")
                    .replace("objective-c", "objectivec")
                    .replace("f#", "fsharp")),
              ),
            );
            const retrievalTopK = Math.max(1, Math.min(config.knowledge?.retrieval?.topK ?? 5, 3));
            const variants = buildRetrievalVariants({
              title: writeIntent.request,
              body: mentionContext,
              conventionalType: null,
              prLanguages,
              riskSignals: [mention.surface, mention.inReplyToId !== undefined ? "reply-thread" : "single-mention"],
              filePaths,
            });

            const result = await retriever.retrieve({
              repo: `${mention.owner}/${mention.repo}`,
              owner: mention.owner,
              queries: variants.map((v) => v.query),
              workspaceDir: workspace.dir,
              prLanguages,
              topK: retrievalTopK,
              logger,
              triggerType: "question",
            });

            // Capture unified cross-corpus results (KI-11/KI-12)
            if (result && result.unifiedResults && result.unifiedResults.length > 0) {
              unifiedResultsForPrompt = result.unifiedResults;
              contextWindowForPrompt = result.contextWindow;
            }
            if (result && result.reviewPrecedents.length > 0) {
              reviewPrecedentsForPrompt = result.reviewPrecedents;
            }
            if (result && result.wikiKnowledge.length > 0) {
              wikiKnowledgeForPrompt = result.wikiKnowledge;
            }

            if (result && result.findings.length > 0) {
              retrievalContext = {
                maxChars: MENTION_RETRIEVAL_MAX_CONTEXT_CHARS,
                maxItems: retrievalTopK,
                findings: result.findings.slice(0, retrievalTopK).map((finding, index) => {
                  const anchor = result.snippetAnchors[index];
                  return {
                    findingText: finding.record.findingText,
                    severity: finding.record.severity,
                    category: finding.record.category,
                    path: anchor?.path ?? finding.record.filePath,
                    line: anchor?.line,
                    snippet: anchor?.snippet,
                    outcome: finding.record.outcome,
                    distance: finding.distance,
                    sourceRepo: finding.sourceRepo,
                  };
                }),
              };
            }
          } catch (err) {
            logger.warn(
              {
                err,
                surface: mention.surface,
                owner: mention.owner,
                repo: mention.repo,
                issueNumber: mention.issueNumber,
                prNumber: mention.prNumber,
              },
              "Mention retrieval context generation failed (fail-open)",
            );
          }
        }

        const planOnlyInstructions = isPlanOnly
          ? [
              "Plan-only request detected (plan:).",
              "In this run:",
              "- Do NOT edit files.",
              "- Do NOT run git commands.",
              "- Do NOT propose opening a PR.",
              "- Do NOT claim any change was completed.",
              "- Do NOT ask for `apply:` / `change:` prefixes.",
              "- Never use status phrases like: 'Done', 'Implemented', 'Updated', or 'Appended'.",
              "Return a concise plan with 3-7 steps and a list of files you would touch.",
              "End by asking whether they want you to implement the plan next.",
            ].join("\n")
          : undefined;

        const writeInstructions = writeEnabled
          ? [
              "Write-intent request detected (apply/change).",
              "Write-mode is enabled.",
              "",
              "In this run:",
              "- Make the requested changes by editing files in the workspace.",
              "- Do NOT run git commands (no branch/commit/push).",
              "- Do NOT publish any GitHub comments/reviews; publish tools are disabled.",
              "- Keep changes minimal and focused on the request.",
              "- NEVER fabricate checksums, hashes, version numbers, download URLs, or any verifiable data. If you need a real value (e.g. a SHA512 of a download), leave a clearly-marked TODO placeholder like `SHA512=TODO_REPLACE_WITH_REAL_HASH` instead of generating a fake one.",
              "- NEVER invent API endpoints, package names, or configuration values that you have not verified exist in the codebase.",
              "- Verify completeness: if you add a new module/component, trace it through the build system and make sure it is actually wired in (e.g., find_package calls, CMakeLists.txt, imports, etc.).",
              FORK_WRITE_POLICY_INSTRUCTIONS,
            ].join("\n")
            : isWriteRequest
              ? [
                  "Write-intent request detected (apply/change).",
                  "In this run: do NOT create branches/commits/PRs and do NOT push changes.",
                  "Instead, propose a concrete, minimal plan (files + steps) and ask for confirmation.",
                  "Keep it concise.",
                ].join("\n")
              : undefined;

        // Pre-fetch PR diff for PR mentions — prevents turn exhaustion by giving the model
        // the diff upfront so it does not need to tool-call git to read it.
        // Cap at 8000 chars; truncate at the last newline to avoid splitting mid-line.
        const PR_DIFF_MAX_CHARS = 8_000;
        let prDiffContext: { stat: string; diff: string; truncated: boolean; fileCount: number } | undefined;
        // mention.baseRef is the PR base branch (e.g. "main"), set by the event parser.
        if (mention.prNumber !== undefined && mention.baseRef && !writeEnabled) {
          try {
            // Try three-dot diff first (shows only changes introduced by the PR branch).
            // Falls back to two-dot diff when the merge base isn't reachable — this can happen
            // in shallow clones where --depth=1 re-fetch of the base branch truncates history
            // enough that `git merge-base` fails with exit 128.
            let statResult = await $`git -C ${workspace.dir} diff origin/${mention.baseRef}...HEAD --stat`.quiet().nothrow();
            let diffResult = await $`git -C ${workspace.dir} diff origin/${mention.baseRef}...HEAD`.quiet().nothrow();
            if (statResult.exitCode !== 0 || diffResult.exitCode !== 0) {
              logger.debug(
                { surface: mention.surface, prNumber: mention.prNumber, baseRef: mention.baseRef,
                  statExitCode: statResult.exitCode, diffExitCode: diffResult.exitCode },
                "Three-dot diff failed, falling back to two-dot diff",
              );
              statResult = await $`git -C ${workspace.dir} diff origin/${mention.baseRef}..HEAD --stat`.quiet().nothrow();
              diffResult = await $`git -C ${workspace.dir} diff origin/${mention.baseRef}..HEAD`.quiet().nothrow();
            }
            if (statResult.exitCode === 0 && diffResult.exitCode === 0) {
              const stat = statResult.text().trim();
              const fullDiff = diffResult.text();
              const truncated = fullDiff.length > PR_DIFF_MAX_CHARS;
              // Truncate at last newline to avoid splitting mid-line or mid-hunk.
              let diff: string;
              if (truncated) {
                const cutPoint = fullDiff.lastIndexOf("\n", PR_DIFF_MAX_CHARS);
                diff = cutPoint > 0 ? fullDiff.slice(0, cutPoint) : fullDiff.slice(0, PR_DIFF_MAX_CHARS);
              } else {
                diff = fullDiff.trim();
              }
              // Count files from stat output (lines like "path/to/file.ts | 12 +++---")
              const fileCount = stat.split("\n").filter(l => l.includes("|")).length;
              prDiffContext = { stat, diff, truncated, fileCount };
              logger.debug(
                { surface: mention.surface, prNumber: mention.prNumber, fileCount, truncated },
                "Pre-fetched PR diff for mention context",
              );
            }
          } catch {
            // fail-open — model falls back to tool calls if this fails
          }
        }

        setReviewWorkPhase("prompt-build");
        let prompt: string;
        let explicitReviewPromptFileCount: number | undefined;
        if (explicitReviewRequest && mention.prNumber !== undefined) {
          const explicitReviewPrNumber = mention.prNumber;
          const { data: explicitReviewPr } = await octokit.rest.pulls.get({
            owner: mention.owner,
            repo: mention.repo,
            pull_number: explicitReviewPrNumber,
          });

          const promptDiffContext = mention.baseRef
            ? await collectPrReviewPromptDiff({
                workspaceDir: workspace.dir,
                owner: mention.owner,
                repo: mention.repo,
                prNumber: explicitReviewPrNumber,
                baseRef: mention.baseRef,
                surface: mention.surface,
                token: workspace.token,
                fallbackFileProvider: async () => {
                  const listFilesResponse = await octokit.rest.pulls.listFiles({
                    owner: mention.owner,
                    repo: mention.repo,
                    pull_number: explicitReviewPrNumber,
                    per_page: 100,
                  });
                  return listFilesResponse.data.map((file) => file.filename);
                },
              })
            : { changedFiles: [], numstatLines: [], diffRange: "unknown" };
          const promptChangedFiles = promptDiffContext.changedFiles;
          explicitReviewPromptFileCount = promptChangedFiles.length;

          const diffAnalysis = analyzeDiff({
            changedFiles: promptChangedFiles,
            numstatLines: promptDiffContext.numstatLines,
            fileCategories: config.review.fileCategories as Record<string, string[]> | undefined,
          });
          const matchedPathInstructions = matchPathInstructions(
            config.review.pathInstructions,
            promptChangedFiles,
          );
          const perFileStats = parseNumstatPerFile(promptDiffContext.numstatLines);
          const riskScores = computeFileRiskScores({
            files: promptChangedFiles,
            perFileStats,
            filesByCategory: diffAnalysis.filesByCategory,
            weights: config.largePR.riskWeights,
          });
          const tieredFiles = triageFilesByRisk({
            riskScores,
            fileThreshold: config.largePR.fileThreshold,
            fullReviewCount: config.largePR.fullReviewCount,
            abbreviatedCount: config.largePR.abbreviatedCount,
            totalFileCount: promptChangedFiles.length,
          });
          const promptFiles = tieredFiles.isLargePR
            ? [
                ...tieredFiles.full.map((file) => file.filePath),
                ...tieredFiles.abbreviated.map((file) => file.filePath),
              ]
            : promptChangedFiles;

          const prLabels = (explicitReviewPr.labels ?? [])
            .map((label) => typeof label === "string" ? label : label.name)
            .filter((label): label is string => typeof label === "string" && label.length > 0);

          prompt = buildReviewPrompt({
            owner: mention.owner,
            repo: mention.repo,
            prNumber: mention.prNumber,
            prTitle: explicitReviewPr.title,
            prBody: explicitReviewPr.body ?? "",
            prAuthor: explicitReviewPr.user?.login ?? "unknown",
            baseBranch: explicitReviewPr.base.ref,
            headBranch: explicitReviewPr.head.ref,
            changedFiles: promptFiles,
            customInstructions: config.review.prompt,
            mode: config.review.mode,
            severityMinLevel: config.review.severity.minLevel,
            focusAreas: config.review.focusAreas,
            ignoredAreas: config.review.ignoredAreas,
            maxComments: config.review.maxComments,
            suppressions: config.review.suppressions,
            minConfidence: config.review.minConfidence,
            diffAnalysis,
            matchedPathInstructions,
            retrievalContext,
            reviewPrecedents: reviewPrecedentsForPrompt.length > 0 ? reviewPrecedentsForPrompt : undefined,
            wikiKnowledge: wikiKnowledgeForPrompt.length > 0 ? wikiKnowledgeForPrompt : undefined,
            unifiedResults: unifiedResultsForPrompt.length > 0 ? unifiedResultsForPrompt : undefined,
            contextWindow: contextWindowForPrompt,
            filesByLanguage: diffAnalysis.filesByLanguage,
            outputLanguage: config.review.outputLanguage,
            prLabels,
            isDraft: explicitReviewPr.draft,
            largePRContext: tieredFiles.isLargePR ? {
              fullReviewFiles: tieredFiles.full.map((file) => file.filePath),
              abbreviatedFiles: tieredFiles.abbreviated.map((file) => file.filePath),
              mentionOnlyCount: tieredFiles.mentionOnly.length,
              totalFiles: tieredFiles.totalFiles,
            } : null,
            publishToolNames: [
              "mcp__github_comment__create_comment",
              "mcp__github_inline_comment__create_inline_comment",
            ],
          });
        } else {
          prompt = buildMentionPrompt({
            mention,
            mentionContext,
            retrievalContext,
            userQuestion: writeIntent.request,
            findingContext,
            customInstructions: [config.mention.prompt, planOnlyInstructions, writeInstructions]
              .filter((s) => (s ?? "").trim().length > 0)
              .join("\n\n"),
            outputLanguage: config.review.outputLanguage,
            // Unified cross-corpus context (KI-11/KI-12)
            unifiedResults: unifiedResultsForPrompt.length > 0 ? unifiedResultsForPrompt : undefined,
            contextWindow: contextWindowForPrompt,
            // Triage context for issue mentions (TRIA-03)
            triageContext: triageContext.trim().length > 0 ? triageContext : undefined,
            // Pre-fetched PR diff (prevents turn exhaustion on review-intent mentions)
            prDiffContext,
          });
        }

        // Cap max turns for read-only conversational PR mentions.
        // Explicit `@kodiai review` requests should use the full review budget so
        // large PRs do not terminate mid-tool-call before any publish step occurs.
        const mentionMaxTurns =
          explicitReviewRequest
            ? undefined
            : (!writeEnabled && mention.prNumber !== undefined)
              ? (prDiffContext !== undefined ? 12 : 20)
              : undefined; // undefined → falls through to config.maxTurns

        reviewOutputKey = explicitReviewRequest && mention.prNumber !== undefined
          ? buildReviewOutputKey({
              installationId: event.installationId,
              owner: mention.owner,
              repo: mention.repo,
              prNumber: mention.prNumber,
              action: "mention-review",
              deliveryId: event.id,
              headSha: mention.headRef ?? "unknown-head-sha",
            })
          : undefined;

        // Execute via Claude
        if (reviewWorkAttempt) {
          setReviewWorkPhase("executor-dispatch");
        }
        const result = await executor.execute({
          workspace,
          installationId: event.installationId,
          owner: mention.owner,
          repo: mention.repo,
          prNumber: mention.prNumber,
          // For inline review comment mentions, provide the triggering review comment id
          // so the executor can enable the in-thread reply MCP tool.
          commentId: mention.surface === "pr_review_comment" ? mention.commentId : undefined,
          deliveryId: event.id,
          botHandles: possibleHandles,
          writeMode: writeEnabled,
          taskType: explicitReviewRequest ? "review.full" : "mention.response",
          eventType: `${event.name}.${action ?? ""}`.replace(/\.$/, ""),
          triggerBody: explicitReviewRequest ? userQuestion : mention.commentBody,
          prompt,
          reviewOutputKey,
          maxTurnsOverride: mentionMaxTurns,
          knowledgeStore: deps.knowledgeStore,
          totalFiles: explicitReviewPromptFileCount,
          enableInlineTools: explicitReviewRequest ? true : undefined,
        });

        // Explicit PR review mentions bypass the pull_request review handler's
        // deterministic clean-review publish path. Bridge that gap here so a
        // successful no-issues run still produces a GitHub-visible approval.
        let mentionOutputPublished = Boolean(result.published);
        let publishResolution: MentionPublishResolution = mentionOutputPublished ? "executor" : "none";
        let publishFailureCategory: ErrorCategory | null = null;
        let publishFallbackDelivery: MentionErrorDelivery | null = null;
        const explicitReviewResultFindingLines = extractExplicitReviewResultFindingLines(result.resultText);
        const explicitReviewHasUnpublishedFindings =
          explicitReviewRequest &&
          mention.prNumber !== undefined &&
          !result.published &&
          (
            explicitReviewResultFindingLines.length > 0
            || hasExplicitReviewBlockingSignals(result.resultText)
          );
        const explicitReviewPublishEligible =
          explicitReviewRequest &&
          mention.prNumber !== undefined &&
          result.conclusion === "success" &&
          !result.published &&
          result.usedRepoInspectionTools === true &&
          reviewOutputKey &&
          config.review.autoApprove &&
          !explicitReviewHasUnpublishedFindings;

        if (explicitReviewRequest && mention.prNumber !== undefined && !explicitReviewPublishEligible) {
          const skipReason =
            result.conclusion !== "success"
              ? "execution-not-success"
              : result.published
                ? "output-already-published"
                : explicitReviewHasUnpublishedFindings
                  ? "result-text-findings"
                  : result.usedRepoInspectionTools !== true
                    ? "missing-inspection-evidence"
                    : !reviewOutputKey
                      ? "missing-review-output-key"
                      : !config.review.autoApprove
                        ? "auto-approve-disabled"
                        : "not-eligible";

          logger.info(
            {
              surface: mention.surface,
              owner: mention.owner,
              repo: mention.repo,
              prNumber: mention.prNumber,
              gate: "explicit-review-publish",
              gateResult: "skipped",
              skipReason,
              reviewOutputKey: reviewOutputKey ?? null,
              resultConclusion: result.conclusion,
              resultPublished: result.published,
              usedRepoInspectionTools: result.usedRepoInspectionTools ?? false,
              toolUseNames: result.toolUseNames ?? [],
              autoApprove: config.review.autoApprove,
            },
            "Skipping explicit mention review publish path",
          );
        }

        if (explicitReviewPublishEligible && reviewOutputKey && mention.prNumber !== undefined) {
          const publishOctokit = await githubApp.getInstallationOctokit(event.installationId);
          try {
            const idempotencyCheck = await ensureReviewOutputNotPublished({
              octokit: publishOctokit,
              owner: mention.owner,
              repo: mention.repo,
              prNumber: mention.prNumber,
              reviewOutputKey,
            });

            if (!idempotencyCheck.shouldPublish) {
              mentionOutputPublished = true;
              publishResolution = "idempotency-skip";
              logger.info(
                {
                  surface: mention.surface,
                  owner: mention.owner,
                  repo: mention.repo,
                  prNumber: mention.prNumber,
                  gate: "review-output-idempotency",
                  gateResult: "skipped",
                  skipReason: "already-published",
                  ...buildReviewOutputPublicationLogFields(idempotencyCheck),
                },
                "Skipping explicit mention review publish because output already exists",
              );
            } else {
              logger.info(
                {
                  surface: mention.surface,
                  owner: mention.owner,
                  repo: mention.repo,
                  prNumber: mention.prNumber,
                  gate: "review-output-idempotency",
                  gateResult: "accepted",
                  ...buildReviewOutputPublicationLogFields(idempotencyCheck),
                },
                "Explicit mention review idempotency check passed",
              );

              const appSlug = githubApp.getAppSlug();
              logger.info(
                {
                  surface: mention.surface,
                  owner: mention.owner,
                  repo: mention.repo,
                  prNumber: mention.prNumber,
                  gate: "explicit-review-publish",
                  gateResult: "attempt",
                  publishAttemptOutcome: "attempting-approval",
                  reviewOutputKey,
                },
                "Attempting explicit mention review approval publish",
              );
              const approvalEvidence = [
                typeof explicitReviewPromptFileCount === "number"
                  ? `Review prompt covered ${explicitReviewPromptFileCount} changed file${explicitReviewPromptFileCount === 1 ? "" : "s"}.`
                  : null,
                result.usedRepoInspectionTools === true
                  ? "Repo inspection tools were used to verify the changed code."
                  : null,
              ].filter((line): line is string => Boolean(line));

              if (!canPublishExplicitReviewOutput("explicit mention review publish", reviewOutputKey)) {
                logger.info(
                  {
                    surface: mention.surface,
                    owner: mention.owner,
                    repo: mention.repo,
                    prNumber: mention.prNumber,
                    gate: "explicit-review-publish",
                    gateResult: "skipped",
                    skipReason: "publish-rights-lost",
                    reviewOutputKey,
                  },
                  "Skipping explicit mention review publish because publish rights were superseded",
                );
              } else {
                setReviewWorkPhase("publish");
                await publishOctokit.rest.pulls.createReview({
                  owner: mention.owner,
                  repo: mention.repo,
                  pull_number: mention.prNumber,
                  event: "APPROVE",
                  body: sanitizeOutgoingMentions(
                    buildApprovedReviewBody({ reviewOutputKey, evidence: approvalEvidence }),
                    [appSlug, "claude", "kodai"],
                  ),
                });
                mentionOutputPublished = true;
                publishResolution = "approval-bridge";
                logger.info(
                  {
                    evidenceType: "review",
                    outcome: "submitted-approval",
                    deliveryId: event.id,
                    installationId: event.installationId,
                    owner: mention.owner,
                    repoName: mention.repo,
                    repo: `${mention.owner}/${mention.repo}`,
                    prNumber: mention.prNumber,
                    reviewOutputKey,
                    publishAttemptOutcome: "submitted-approval",
                  },
                  "Submitted approval review for explicit mention request",
                );
              }
            }
          } catch (publishErr) {
            publishFailureCategory = classifyError(publishErr, false);
            logger.warn(
              {
                err: publishErr,
                deliveryId: event.id,
                owner: mention.owner,
                repo: mention.repo,
                prNumber: mention.prNumber,
                reviewOutputKey,
                publishAttemptOutcome:
                  publishFailureCategory === "api_error" ? "github-api-rejected" : "failed",
                publishFailureCategory,
              },
              "Failed to submit approval review for explicit mention request",
            );

            let outputDetectedAfterError = false;
            try {
              const recheck = await ensureReviewOutputNotPublished({
                octokit: publishOctokit,
                owner: mention.owner,
                repo: mention.repo,
                prNumber: mention.prNumber,
                reviewOutputKey,
              });

              if (!recheck.shouldPublish) {
                mentionOutputPublished = true;
                publishResolution = "duplicate-suppressed";
                outputDetectedAfterError = true;
                logger.info(
                  {
                    surface: mention.surface,
                    owner: mention.owner,
                    repo: mention.repo,
                    prNumber: mention.prNumber,
                    gate: "review-output-idempotency",
                    gateResult: "recovered",
                    skipReason: "output-detected-after-error",
                    ...buildReviewOutputPublicationLogFields(recheck),
                  },
                  "Explicit mention review publish error still produced output; suppressing fallback",
                );
              }
            } catch (recheckErr) {
              logger.warn(
                {
                  err: recheckErr,
                  deliveryId: event.id,
                  owner: mention.owner,
                  repo: mention.repo,
                  prNumber: mention.prNumber,
                  reviewOutputKey,
                  publishAttemptOutcome: "recheck-failed",
                  publishFailureCategory,
                },
                "Failed to recheck explicit mention review output after publish error",
              );
            }

            if (!outputDetectedAfterError) {
              if (!canPublishExplicitReviewOutput("explicit mention review fallback comment", reviewOutputKey)) {
                logger.info(
                  {
                    surface: mention.surface,
                    owner: mention.owner,
                    repo: mention.repo,
                    prNumber: mention.prNumber,
                    gate: "explicit-review-publish",
                    gateResult: "skipped",
                    skipReason: "publish-rights-lost",
                    reviewOutputKey,
                    publishFailureCategory,
                  },
                  "Skipping explicit mention review fallback because publish rights were superseded",
                );
              } else {
                setReviewWorkPhase("publish");
                const fallbackResult = await postMentionError(
                  buildExplicitReviewPublishFailureBody(publishErr),
                );
                publishFallbackDelivery = fallbackResult.delivery;

                if (fallbackResult.posted) {
                  mentionOutputPublished = true;
                  publishResolution = "publish-failure-fallback";
                } else {
                  mentionOutputPublished = false;
                  publishResolution = "publish-failure-comment-failed";
                  logger.warn(
                    {
                      deliveryId: event.id,
                      owner: mention.owner,
                      repo: mention.repo,
                      prNumber: mention.prNumber,
                      reviewOutputKey,
                      publishAttemptOutcome: "fallback-comment-failed",
                      publishFailureCategory,
                      publishFallbackDelivery,
                    },
                    "Explicit mention review publish fallback could not be delivered",
                  );
                }
              }
            }
          }
        }

        logger.info(
          {
            surface: mention.surface,
            issueNumber: mention.issueNumber,
            conclusion: result.conclusion,
            published: mentionOutputPublished,
            executorPublished: result.published,
            publishResolution,
            publishFailureCategory,
            publishFallbackDelivery,
            writeEnabled,
            costUsd: result.costUsd,
            numTurns: result.numTurns,
            durationMs: result.durationMs,
            sessionId: result.sessionId,
            usedRepoInspectionTools: result.usedRepoInspectionTools ?? false,
            toolUseNames: result.toolUseNames ?? [],
            ...(explicitReviewRequest ? { explicitReviewRequest: true } : {}),
            ...(reviewOutputKey ? { reviewOutputKey } : {}),
          },
          "Mention execution completed",
        );

        if (mention.inReplyToId !== undefined && result.conclusion === "success") {
          const conversationKey = `${mention.owner}/${mention.repo}#${mention.prNumber ?? mention.issueNumber}`;
          prConversationTurns.set(conversationKey, (prConversationTurns.get(conversationKey) ?? 0) + 1);
          prConversationTouchedAt.set(conversationKey, Date.now());
        }

        // Telemetry capture (TELEM-03, TELEM-05, CONFIG-10)
        if (config.telemetry.enabled) {
          try {
            await telemetryStore.record({
              deliveryId: event.id,
              repo: `${mention.owner}/${mention.repo}`,
              prNumber: mention.prNumber,
              eventType: `${event.name}.${action ?? ""}`.replace(/\.$/, ""),
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
                repo: `${mention.owner}/${mention.repo}`,
                prNumber: mention.prNumber,
              },
              "Execution cost exceeded warning threshold",
            );
            try {
              if (
                !explicitReviewRequest ||
                canPublishExplicitReviewOutput("explicit mention review cost warning comment", reviewOutputKey)
              ) {
                const warnOctokit = await githubApp.getInstallationOctokit(event.installationId);
                await warnOctokit.rest.issues.createComment({
                  owner: mention.owner,
                  repo: mention.repo,
                  issue_number: mention.issueNumber,
                  body: `> **Kodiai cost warning:** This execution cost \$${result.costUsd.toFixed(4)} USD, exceeding the configured threshold of \$${config.telemetry.costWarningUsd.toFixed(2)} USD.\n>\n> Configure in \`.kodiai.yml\`:\n> \`\`\`yml\n> telemetry:\n>   costWarningUsd: 5.0  # or 0 to disable\n> \`\`\``,
                });
              }
            } catch (err) {
              logger.warn({ err }, "Failed to post cost warning comment (non-blocking)");
            }
          }
        }

        // Write-mode: trusted code publishes the branch + PR and replies with a link.
        if (writeEnabled && writeOutputKey && writeBranchName) {
          const isIssueWritePublishFlow = isIssueThreadComment;
          const publishFailureStatus = "pr_creation_failed" as const;

          const postIssueWriteFailure = async (
            failedStep: IssueWriteFailureStep,
            err: unknown,
          ): Promise<void> => {
            if (!isIssueWritePublishFlow) {
              throw err instanceof Error ? err : new Error(String(err));
            }

            const replyBody = buildIssueWriteFailureReply({
              failedStep,
              diagnostics: summarizeErrorForDiagnostics(err),
              retryCommand,
            });

            await postMentionReply(replyBody, { sanitizeMentions: false });

            logger.warn(
              {
                evidenceType: "write-mode",
                outcome: publishFailureStatus,
                deliveryId: event.id,
                installationId: event.installationId,
                owner: mention.owner,
                repoName: mention.repo,
                repo: `${mention.owner}/${mention.repo}`,
                sourcePrNumber: mention.prNumber,
                triggerCommentId: mention.commentId,
                triggerCommentUrl,
                writeOutputKey,
                failedStep,
                diagnostics: summarizeErrorForDiagnostics(err),
              },
              "Issue write-mode publish failed",
            );
          };

          const status = await getGitStatusPorcelain(workspace.dir);
          if (status.trim().length === 0) {
            const replyBody = wrapInDetails(
              [
                "I didn't end up making any file changes.",
                "",
                "If you still want a change, re-run with a more specific request.",
              ].join("\n"),
              "kodiai response",
            );
            await postMentionReply(replyBody);
            return;
          }

          // Fork-based output routing: determine gist vs PR (Phase 127)
          if (forkContext && gistPublisher?.enabled) {
            // Get list of changed files for routing decision
            const changedFilesRaw = (await $`git -C ${workspace.dir} diff --name-only HEAD`.quiet().nothrow()).text().trim();
            const stagedFilesRaw = (await $`git -C ${workspace.dir} diff --cached --name-only`.quiet().nothrow()).text().trim();
            const allChangedRaw = [changedFilesRaw, stagedFilesRaw].filter(Boolean).join("\n");
            const changedFiles = allChangedRaw.split("\n").map((f) => f.trim()).filter(Boolean);
            const uniqueChangedFiles = [...new Set(changedFiles)];

            const useGist = shouldUseGist({ keyword: writeIntent.keyword }, uniqueChangedFiles);

            if (useGist) {
              // Gist path: generate patch and create gist
              try {
                // Stage all changes to generate a complete diff
                await $`git -C ${workspace.dir} add -A`.quiet();
                const patch = (await $`git -C ${workspace.dir} diff --cached`.quiet()).text();

                if (patch.trim().length === 0) {
                  const replyBody = wrapInDetails(
                    "No diff content to create a patch from.",
                    "kodiai response",
                  );
                  await postMentionReply(replyBody);
                  return;
                }

                const requestSummary = summarizeWriteRequest(writeIntent.request);
                const gist = await gistPublisher.createPatchGist({
                  owner: mention.owner,
                  repo: mention.repo,
                  summary: requestSummary,
                  patch,
                });

                // Post gist link as comment with apply instructions
                const gistReplyBody = wrapInDetails(
                  [
                    `Patch gist: ${gist.htmlUrl}`,
                    "",
                    "To apply this patch locally:",
                    "```bash",
                    `curl -sL ${gist.htmlUrl}.patch | git apply`,
                    "```",
                    "",
                    `Files changed: ${uniqueChangedFiles.join(", ")}`,
                  ].join("\n"),
                  "kodiai response",
                );
                await postMentionReply(gistReplyBody);

                logger.info(
                  {
                    evidenceType: "write-mode",
                    outcome: "created-gist",
                    deliveryId: event.id,
                    installationId: event.installationId,
                    owner: mention.owner,
                    repoName: mention.repo,
                    repo: `${mention.owner}/${mention.repo}`,
                    gistUrl: gist.htmlUrl,
                    gistId: gist.id,
                    changedFiles: uniqueChangedFiles,
                    writeOutputKey,
                    triggerCommentUrl,
                  },
                  "Evidence bundle",
                );
                return;
              } catch (gistErr) {
                logger.warn(
                  { err: gistErr, owner: mention.owner, repo: mention.repo },
                  "Gist creation failed; falling through to PR path",
                );
                // Fall through to PR path
              }
            }

            // PR path with fork: commit, push to fork, create cross-fork PR
            try {
              await assertOriginIsFork(workspace.dir, forkContext.forkOwner);

              const branchName = writeBranchName;
              const sourceRef = mention.prNumber !== undefined
                ? `PR #${mention.prNumber}`
                : `#${mention.issueNumber}`;
              const commitRequestSummary = summarizeWriteRequest(writeIntent.request);
              const commitSubject = generateCommitSubject({
                issueTitle: mention.issueTitle,
                requestSummary: commitRequestSummary,
                isFromPr: mention.prNumber !== undefined,
                ref: sourceRef,
              });
              const commitMessage = [
                commitSubject,
                "",
                `kodiai-write-output-key: ${writeOutputKey}`,
                `deliveryId: ${event.id}`,
              ].join("\n");

              const pushed = await createBranchCommitAndPush({
                dir: workspace.dir,
                branchName,
                commitMessage,
                policy: {
                  allowPaths: config.write.allowPaths,
                  denyPaths: config.write.denyPaths,
                  secretScanEnabled: config.write.secretScan.enabled,
                },
                token: forkContext.botPat,
              });

              // Cross-fork PR: head uses forkOwner:branchName format
              const crossForkHead = `${forkContext.forkOwner}:${pushed.branchName}`;
              const prBaseRef = mention.prNumber !== undefined ? (mention.baseRef ?? "main") : (cloneRef ?? "main");

              let diffStat = "";
              try {
                diffStat = (await $`git -C ${workspace.dir} diff --stat HEAD~1 HEAD`.quiet()).text().trim();
              } catch {
                // diff stat is best-effort
              }

              let fabricationWarnings: string[] = [];
              try {
                fabricationWarnings = await scanDiffForFabricatedContent(workspace.dir);
              } catch {
                // best-effort scan
              }

              const requestSummary = summarizeWriteRequest(writeIntent.request);
              const prTitle = generatePrTitle(mention.issueTitle, requestSummary, mention.prNumber !== undefined);
              const sourceUrl =
                mention.prNumber !== undefined
                  ? `https://github.com/${mention.owner}/${mention.repo}/pull/${mention.prNumber}`
                  : `https://github.com/${mention.owner}/${mention.repo}/issues/${mention.issueNumber}`;
              const prBody = generatePrBody({
                summary: requestSummary,
                issueTitle: mention.issueTitle,
                sourceUrl,
                triggerCommentUrl,
                deliveryId: event.id,
                headSha: pushed.headSha,
                isFromPr: mention.prNumber !== undefined,
                issueNumber: mention.issueNumber,
                prNumber: mention.prNumber,
                diffStat,
                warnings: fabricationWarnings,
              });

              const response = await octokit.rest.pulls.create({
                owner: mention.owner,
                repo: mention.repo,
                title: prTitle,
                head: crossForkHead,
                base: prBaseRef,
                body: prBody,
              });

              const createdPrUrl = response.data.html_url;
              const issueLinkbackUrl =
                mention.prNumber !== undefined
                  ? `https://github.com/${mention.owner}/${mention.repo}/pull/${mention.prNumber}`
                  : `https://github.com/${mention.owner}/${mention.repo}/issues/${mention.issueNumber}`;

              const replyBody = buildIssueWriteSuccessReply({
                prUrl: createdPrUrl,
                issueLinkbackUrl,
              });
              await postMentionReply(replyBody);

              logger.info(
                {
                  evidenceType: "write-mode",
                  outcome: "created-cross-fork-pr",
                  deliveryId: event.id,
                  installationId: event.installationId,
                  owner: mention.owner,
                  repoName: mention.repo,
                  repo: `${mention.owner}/${mention.repo}`,
                  forkOwner: forkContext.forkOwner,
                  crossForkHead,
                  prUrl: createdPrUrl,
                  commitSha: pushed.headSha,
                  writeOutputKey,
                  triggerCommentUrl,
                },
                "Evidence bundle",
              );
              return;
            } catch (forkPrErr) {
              // Fallback to gist on fork/PR failure
              logger.warn(
                { err: forkPrErr, owner: mention.owner, repo: mention.repo },
                "Fork-based PR creation failed; falling back to gist",
              );

              if (forkPrErr instanceof WritePolicyError) {
                const refusal = buildWritePolicyRefusalMessage(forkPrErr, config.write.allowPaths);
                const replyBody = wrapInDetails(refusal, "kodiai response");
                await postMentionReply(replyBody);
                return;
              }

              if (gistPublisher.enabled) {
                try {
                  await $`git -C ${workspace.dir} add -A`.quiet();
                  const patch = (await $`git -C ${workspace.dir} diff --cached`.quiet()).text();
                  if (patch.trim().length > 0) {
                    const requestSummary = summarizeWriteRequest(writeIntent.request);
                    const gist = await gistPublisher.createPatchGist({
                      owner: mention.owner,
                      repo: mention.repo,
                      summary: requestSummary,
                      patch,
                    });

                    const gistReplyBody = wrapInDetails(
                      [
                        "Could not create a PR from the fork, but here is the patch as a gist:",
                        "",
                        `Patch gist: ${gist.htmlUrl}`,
                        "",
                        "To apply this patch locally:",
                        "```bash",
                        `curl -sL ${gist.htmlUrl}.patch | git apply`,
                        "```",
                      ].join("\n"),
                      "kodiai response",
                    );
                    await postMentionReply(gistReplyBody);

                    logger.info(
                      {
                        evidenceType: "write-mode",
                        outcome: "fallback-gist",
                        deliveryId: event.id,
                        owner: mention.owner,
                        repo: `${mention.owner}/${mention.repo}`,
                        gistUrl: gist.htmlUrl,
                        writeOutputKey,
                      },
                      "Evidence bundle",
                    );
                    return;
                  }
                } catch (fallbackErr) {
                  logger.error(
                    { err: fallbackErr },
                    "Fallback gist creation also failed",
                  );
                }
              }

              // If gist fallback failed too, fall through to legacy behavior
              logger.warn(
                { owner: mention.owner, repo: mention.repo },
                "Fork-based write mode failed completely; falling through to legacy direct-push path",
              );
            }
          }

          const sourcePrUrl =
            mention.prNumber !== undefined
              ? `https://github.com/${mention.owner}/${mention.repo}/pull/${mention.prNumber}`
              : undefined;

          const normalizeName = (s: string | undefined): string => (s ?? "").trim().toLowerCase();
          const sameRepoHead =
            normalizeName(mention.headRepoOwner) === normalizeName(mention.owner) &&
            normalizeName(mention.headRepoName) === normalizeName(mention.repo) &&
            typeof mention.headRef === "string" &&
            mention.headRef.length > 0;

          // Preferred path: update existing PR branch when possible.
          if (mention.prNumber !== undefined && sameRepoHead && mention.headRef) {
            const headRef = mention.headRef;
            const idempotencyMarker = `kodiai-write-output-key: ${writeOutputKey}`;

            // NOTE: The in-flight lock is acquired earlier for all write-mode requests.
            // It is in-process only; in multi-replica deployments, two replicas can still
            // do duplicate work concurrently. This project currently deploys with max-replicas=1.

            try {
              const fetchRemote2 = await buildAuthFetchUrl(workspace.dir, workspace.token);
              await $`git -C ${workspace.dir} fetch ${fetchRemote2} ${headRef}:refs/remotes/origin/${headRef} --depth=50`.quiet();
              const recentMessages = (
                await $`git -C ${workspace.dir} log -n 50 --pretty=%B refs/remotes/origin/${headRef}`.quiet()
              )
                .text();
              if (recentMessages.includes(idempotencyMarker)) {
                logger.info(
                  {
                    evidenceType: "write-mode",
                    outcome: "skipped-idempotent",
                    deliveryId: event.id,
                    installationId: event.installationId,
                    owner: mention.owner,
                    repoName: mention.repo,
                    repo: `${mention.owner}/${mention.repo}`,
                    sourcePrNumber: mention.prNumber,
                    triggerCommentId: mention.commentId,
                    triggerCommentUrl,
                    writeOutputKey,
                    prUrl: sourcePrUrl,
                  },
                  "Evidence bundle",
                );

                const replyBody = wrapInDetails(
                  [`Already applied (idempotent): ${sourcePrUrl}`].join("\n"),
                  "kodiai response",
                );
                await postMentionReply(replyBody);
                return;
              }
            } catch (err) {
              logger.warn(
                { err, prNumber: mention.prNumber, headRef },
                "Failed to check idempotency marker on head ref; continuing",
              );
            }

            try {
              await $`git -C ${workspace.dir} checkout -B pr-head refs/remotes/origin/${headRef}`.quiet();

              const requestSummary = summarizeWriteRequest(writeIntent.request);
              const commitSubject = generateCommitSubject({
                issueTitle: mention.issueTitle,
                requestSummary,
                isFromPr: true,
                ref: `PR #${mention.prNumber}`,
              });
              const commitMessage = [
                commitSubject,
                "",
                idempotencyMarker,
                `deliveryId: ${event.id}`,
              ].join("\n");

              const pushed = await commitAndPushToRemoteRef({
                dir: workspace.dir,
                remoteRef: headRef,
                commitMessage,
                policy: {
                  allowPaths: config.write.allowPaths,
                  denyPaths: config.write.denyPaths,
                  secretScanEnabled: config.write.secretScan.enabled,
                },
                token: workspace.token,
              });

              logger.info(
                {
                  evidenceType: "write-mode",
                  outcome: "updated-pr-branch",
                  deliveryId: event.id,
                  installationId: event.installationId,
                  owner: mention.owner,
                  repoName: mention.repo,
                  repo: `${mention.owner}/${mention.repo}`,
                  sourcePrNumber: mention.prNumber,
                  triggerCommentId: mention.commentId,
                  triggerCommentUrl,
                  writeOutputKey,
                  headRef,
                  commitSha: pushed.headSha,
                  prUrl: sourcePrUrl,
                },
                "Evidence bundle",
              );

              const replyBody = wrapInDetails(
                [`Updated PR: ${sourcePrUrl}`].join("\n"),
                "kodiai response",
              );
              try {
                await postMentionReply(replyBody);
              } catch (replyErr) {
                logger.warn(
                  { err: replyErr, prNumber: mention.prNumber, headRef },
                  "Applied changes but failed to post confirmation reply",
                );
              }
              return;
            } catch (err) {
              if (err instanceof WritePolicyError) {
                const refusal = buildWritePolicyRefusalMessage(err, config.write.allowPaths);
                const replyBody = wrapInDetails(refusal, "kodiai response");
                await postMentionReply(replyBody);
                return;
              }

              if (await maybeReplyWritePermissionFailure(err)) {
                return;
              }

              // If another concurrent run already pushed an idempotent commit, treat this as a no-op.
              try {
                const fetchRemote3 = await buildAuthFetchUrl(workspace.dir, workspace.token);
                await $`git -C ${workspace.dir} fetch ${fetchRemote3} ${headRef}:refs/remotes/origin/${headRef} --depth=50`.quiet();
                const recentMessages = (
                  await $`git -C ${workspace.dir} log -n 50 --pretty=%B refs/remotes/origin/${headRef}`.quiet()
                )
                  .text();
                if (recentMessages.includes(idempotencyMarker)) {
                  logger.info(
                    {
                      evidenceType: "write-mode",
                      outcome: "skipped-idempotent",
                      deliveryId: event.id,
                      installationId: event.installationId,
                      owner: mention.owner,
                      repoName: mention.repo,
                      repo: `${mention.owner}/${mention.repo}`,
                      sourcePrNumber: mention.prNumber,
                      triggerCommentId: mention.commentId,
                      triggerCommentUrl,
                      writeOutputKey,
                      prUrl: sourcePrUrl,
                    },
                    "Evidence bundle",
                  );

                  const replyBody = wrapInDetails(
                    [`Already applied (idempotent): ${sourcePrUrl}`].join("\n"),
                    "kodiai response",
                  );
                  await postMentionReply(replyBody);
                  return;
                }
              } catch (lookupErr) {
                logger.warn(
                  { err: lookupErr, prNumber: mention.prNumber, headRef },
                  "Failed to re-check idempotency marker after push failure",
                );
              }

              logger.warn(
                { err, prNumber: mention.prNumber, headRef },
                "Failed to push to PR head branch; falling back to bot PR",
              );

              // Fallback: push current HEAD to deterministic bot branch and open bot PR.
              try {
                await pushHeadToRemoteRef({
                  dir: workspace.dir,
                  remoteRef: writeBranchName,
                  token: workspace.token,
                });
              } catch (pushErr) {
                if (await maybeReplyWritePermissionFailure(pushErr)) {
                  return;
                }
                logger.error(
                  { err: pushErr, prNumber: mention.prNumber, branchName: writeBranchName },
                  "Fallback push to bot branch failed",
                );
                throw err;
              }
              // Continue into bot PR creation below.
            }
          }

          const branchName = writeBranchName;
          const sourceRef = mention.prNumber !== undefined
            ? `PR #${mention.prNumber}`
            : `#${mention.issueNumber}`;
          const commitRequestSummary = summarizeWriteRequest(writeIntent.request);
          const commitSubject = generateCommitSubject({
            issueTitle: mention.issueTitle,
            requestSummary: commitRequestSummary,
            isFromPr: mention.prNumber !== undefined,
            ref: sourceRef,
          });
          const commitMessage = [
            commitSubject,
            "",
            `kodiai-write-output-key: ${writeOutputKey}`,
            `deliveryId: ${event.id}`,
          ].join("\n");

          let pushed: { branchName: string; headSha: string };
          try {
            pushed = await createBranchCommitAndPush({
              dir: workspace.dir,
              branchName,
              commitMessage,
              policy: {
                allowPaths: config.write.allowPaths,
                denyPaths: config.write.denyPaths,
                secretScanEnabled: config.write.secretScan.enabled,
              },
              token: workspace.token,
            });
          } catch (err) {
            if (err instanceof WritePolicyError) {
              const refusal = buildWritePolicyRefusalMessage(err, config.write.allowPaths);
              const replyBody = wrapInDetails(refusal, "kodiai response");
              await postMentionReply(replyBody);
              return;
            }

            if (await maybeReplyWritePermissionFailure(err)) {
              return;
            }

            // If the branch already exists (e.g. replay), try to find the existing PR.
            if (err instanceof Error) {
              const msg = err.message.toLowerCase();
              const looksLikeBranchExists =
                msg.includes("non-fast-forward") ||
                msg.includes("fetch first") ||
                msg.includes("rejected") ||
                msg.includes("already exists");
              if (looksLikeBranchExists) {
                try {
                  const { data: prs } = await octokit.rest.pulls.list({
                    owner: mention.owner,
                    repo: mention.repo,
                    state: "all",
                    head: `${mention.owner}:${branchName}`,
                    per_page: 5,
                  });
                  const existing = prs[0];
                  if (existing?.html_url) {
                    const replyBody = wrapInDetails(
                      [`Existing PR: ${existing.html_url}`].join("\n"),
                      "kodiai response",
                    );
                    await postMentionReply(replyBody);
                    return;
                  }
                } catch (lookupErr) {
                  logger.warn(
                    { err: lookupErr, prNumber: mention.prNumber, branchName },
                    "Failed to look up existing PR after push failure",
                  );
                }
              }
            }

            await postIssueWriteFailure("branch-push", err);
            return;
          }

          let diffStat = "";
          try {
            diffStat = (await $`git -C ${workspace.dir} diff --stat HEAD~1 HEAD`.quiet()).text().trim();
          } catch {
            // diff stat is best-effort
          }

          let fabricationWarnings: string[] = [];
          try {
            fabricationWarnings = await scanDiffForFabricatedContent(workspace.dir);
          } catch {
            // best-effort scan, do not block PR creation
          }

          const requestSummary = summarizeWriteRequest(writeIntent.request);
          const prTitle = generatePrTitle(mention.issueTitle, requestSummary, mention.prNumber !== undefined);
          const sourceUrl =
            mention.prNumber !== undefined
              ? `https://github.com/${mention.owner}/${mention.repo}/pull/${mention.prNumber}`
              : `https://github.com/${mention.owner}/${mention.repo}/issues/${mention.issueNumber}`;
          const prBody = generatePrBody({
            summary: requestSummary,
            issueTitle: mention.issueTitle,
            sourceUrl,
            triggerCommentUrl,
            deliveryId: event.id,
            headSha: pushed.headSha,
            isFromPr: mention.prNumber !== undefined,
            issueNumber: mention.issueNumber,
            prNumber: mention.prNumber,
            diffStat,
            warnings: fabricationWarnings,
          });

          const prBaseRef = mention.prNumber !== undefined ? (mention.baseRef ?? "main") : (cloneRef ?? "main");

          let createdPr: { html_url: string } | undefined;
          const maxPrCreateAttempts = isIssueWritePublishFlow ? 2 : 1;
          for (let attempt = 1; attempt <= maxPrCreateAttempts; attempt++) {
            try {
              const response = await octokit.rest.pulls.create({
                owner: mention.owner,
                repo: mention.repo,
                title: prTitle,
                head: pushed.branchName,
                base: prBaseRef,
                body: prBody,
              });
              createdPr = response.data;
              break;
            } catch (err) {
              if (await maybeReplyWritePermissionFailure(err)) {
                return;
              }

              if (attempt < maxPrCreateAttempts) {
                logger.warn(
                  {
                    err,
                    owner: mention.owner,
                    repo: mention.repo,
                    issueNumber: mention.issueNumber,
                    attempt,
                    maxAttempts: maxPrCreateAttempts,
                    branchName: pushed.branchName,
                    writeOutputKey,
                  },
                  "Issue write-mode PR creation failed, retrying once",
                );
                continue;
              }

              await postIssueWriteFailure("create-pr", err);
              return;
            }
          }

          if (!createdPr?.html_url) {
            await postIssueWriteFailure(
              "create-pr",
              new Error("GitHub pulls.create response did not include html_url"),
            );
            return;
          }

          const issueLinkbackUrl =
            mention.prNumber !== undefined
              ? `https://github.com/${mention.owner}/${mention.repo}/pull/${mention.prNumber}`
              : `https://github.com/${mention.owner}/${mention.repo}/issues/${mention.issueNumber}`;

          const replyBody = buildIssueWriteSuccessReply({
            prUrl: createdPr.html_url,
            issueLinkbackUrl,
          });
          try {
            await postMentionReply(replyBody);
          } catch (err) {
            await postIssueWriteFailure("issue-linkback", err);
            return;
          }

          logger.info(
            {
              evidenceType: "write-mode",
              outcome: "created-pr",
              deliveryId: event.id,
              installationId: event.installationId,
              owner: mention.owner,
              repoName: mention.repo,
              repo: `${mention.owner}/${mention.repo}`,
              sourcePrNumber: mention.prNumber,
              triggerCommentId: mention.commentId,
              triggerCommentUrl,
              writeOutputKey,
              branchName,
              prUrl: createdPr.html_url,
              commitSha: pushed.headSha,
            },
            "Evidence bundle",
          );

          // Record successful publish time for rate limiting.
          if (config.write.minIntervalSeconds > 0) {
            const key = `${event.installationId}:${mention.owner}/${mention.repo}`;
            lastWriteAt.set(key, Date.now());
          }

          return;
        }

        // If Claude finished successfully but did not publish any output, post a fallback reply.
        // This prevents "silent success" where the model chose not to call any comment tools.
        // Explicit review publish failures that already exhausted the comment fallback path must
        // not fall through here, or we spam the same broken comment surface with a less specific reply.
        if (
          !writeEnabled &&
          result.conclusion === "success" &&
          !mentionOutputPublished &&
          publishResolution !== "publish-failure-comment-failed" &&
          !reviewPublishRightsLost
        ) {
          const fallbackLines = explicitReviewRequest
            ? explicitReviewResultFindingLines.length > 0
              ? [
                  "Decision: NOT APPROVED",
                  "Issues:",
                  ...explicitReviewResultFindingLines,
                ]
              : [
                  "Decision: NOT APPROVED",
                  "Issues:",
                  "- (1) [major] review execution (0): The review run completed without publishing any review findings or approval state, so this request did not produce a usable code review.",
                ]
            : [
                "I can answer this, but I need one detail first.",
                "",
                "Could you share the exact outcome you want and the primary file/path I should focus on first?",
              ];

          const fallbackBody = wrapInDetails(
            fallbackLines.join("\n"),
            "kodiai response",
          );
          const sanitizedFallbackBody = sanitizeOutgoingMentions(fallbackBody, possibleHandles);

          if (
            !explicitReviewRequest
            || canPublishExplicitReviewOutput("explicit mention review fallback reply", reviewOutputKey)
          ) {
            const replyOctokit = await githubApp.getInstallationOctokit(event.installationId);
            if (mention.surface === "pr_review_comment" && mention.prNumber !== undefined) {
              await replyOctokit.rest.pulls.createReplyForReviewComment({
                owner: mention.owner,
                repo: mention.repo,
                pull_number: mention.prNumber,
                comment_id: mention.commentId,
                body: sanitizedFallbackBody,
              });
            } else {
              await replyOctokit.rest.issues.createComment({
                owner: mention.owner,
                repo: mention.repo,
                issue_number: mention.issueNumber,
                body: sanitizedFallbackBody,
              });
            }
          }
        }

        // If execution errored, post or update error comment with classified message
        if (result.conclusion === "error" && !reviewPublishRightsLost) {
          const category = result.isTimeout
            ? "timeout"
            : classifyError(new Error(result.errorMessage ?? "Unknown error"), false);
          const errorBody = wrapInDetails(
            formatErrorComment(
              category,
              result.errorMessage ?? "An unexpected error occurred while processing your request.",
            ),
            "Kodiai encountered an error",
          );
          if (
            !explicitReviewRequest
            || canPublishExplicitReviewOutput("explicit mention review error fallback", reviewOutputKey)
          ) {
            await postMentionError(errorBody);
          }
        }

        // If execution failed without publishing, always post a user-visible fallback.
        // The SDK can return conclusion="failure" with stop reasons other than max_turns,
        // and previously those paths could finish silently.
        if (result.conclusion === "failure" && !mentionOutputPublished && !reviewPublishRightsLost) {
          if (result.stopReason === "max_turns") {
            const turnLimitBody = wrapInDetails(
              [
                "I ran out of steps analyzing this and wasn't able to post a complete response.",
                "",
                "This can happen on PRs with large or complex diffs. To get a response:",
                "- Ask a more targeted question (e.g. `@kodiai review LangInfo.cpp only`)",
                "- Or mention me again — the next run may complete within the step budget",
              ].join("\n"),
              "kodiai response",
            );
            try {
              if (
                !explicitReviewRequest
                || canPublishExplicitReviewOutput("explicit mention review failure fallback", reviewOutputKey)
              ) {
                await postMentionError(turnLimitBody);
              }
            } catch (postErr) {
              logger.warn(
                { err: postErr, surface: mention.surface, issueNumber: mention.issueNumber },
                "Failed to post turn-limit notice (non-blocking)",
              );
            }
          } else {
            const detailLines = [
              "I completed the review run but couldn't publish a GitHub review/comment from it.",
            ];
            if (result.stopReason) {
              detailLines.push("", `Stop reason: ${result.stopReason}`);
            }
            if (result.errorMessage) {
              detailLines.push("", result.errorMessage);
            }
            detailLines.push(
              "",
              "Try mentioning me again after this reply if you want another attempt.",
            );
            const failureBody = wrapInDetails(detailLines.join("\n"), "kodiai response");
            try {
              if (
                !explicitReviewRequest
                || canPublishExplicitReviewOutput("explicit mention review failure fallback", reviewOutputKey)
              ) {
                await postMentionError(failureBody);
              }
            } catch (postErr) {
              logger.warn(
                { err: postErr, surface: mention.surface, issueNumber: mention.issueNumber, stopReason: result.stopReason },
                "Failed to post failure fallback notice (non-blocking)",
              );
            }
          }
        }
      } catch (err) {
        logger.error(
          { err, surface: mention.surface, issueNumber: mention.issueNumber },
          "Mention handler failed",
        );

        // Post or update error comment with classified message
        const category = classifyError(err, false);
        const detail = err instanceof Error ? err.message : "An unexpected error occurred";
        const errorBody = wrapInDetails(formatErrorComment(category, detail), "Kodiai encountered an error");
        const sanitizedErrorBody = sanitizeOutgoingMentions(errorBody, possibleHandles);
        try {
          if (
            !explicitReviewRequest
            || canPublishExplicitReviewOutput("explicit mention review handler failure error comment", reviewOutputKey)
          ) {
            // Prefer in-thread reply for inline review comments.
            if (mention.surface === "pr_review_comment" && mention.prNumber !== undefined) {
              const errOctokit = await githubApp.getInstallationOctokit(event.installationId);
              await errOctokit.rest.pulls.createReplyForReviewComment({
                owner: mention.owner,
                repo: mention.repo,
                pull_number: mention.prNumber,
                comment_id: mention.commentId,
                body: sanitizedErrorBody,
              });
            } else {
              const errOctokit = await githubApp.getInstallationOctokit(event.installationId);
              await postOrUpdateErrorComment(
                errOctokit,
                {
                  owner: mention.owner,
                  repo: mention.repo,
                  issueNumber: mention.issueNumber,
                },
                sanitizedErrorBody,
                logger,
              );
            }
          }
        } catch (commentErr) {
          logger.error({ err: commentErr }, "Failed to post error comment");
        }
      } finally {
        if (acquiredWriteKey) {
          inFlightWriteKeys.delete(acquiredWriteKey);
        }
        if (workspace) {
          await workspace.cleanup();
        }
      }
      }, {
      deliveryId: event.id,
      eventName: event.name,
      action,
      lane: isExplicitReviewRequest ? "interactive-review" : "sync",
      key: mentionQueueKey,
      jobType: "mention",
      prNumber: mention.prNumber,
    });
    } finally {
      finalizeQueuedReviewWorkAttempt();
    }
  }

  // Register for all three mention-triggering events
  eventRouter.register("issue_comment.created", handleMention);
  eventRouter.register("pull_request_review_comment.created", handleMention);
  eventRouter.register("pull_request_review.submitted", handleMention);
}
