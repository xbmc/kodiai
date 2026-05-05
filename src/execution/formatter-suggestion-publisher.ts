import type { Octokit } from "@octokit/rest";
import {
  buildReviewOutputMarker,
  type ReviewOutputIdempotencyDecision,
  type ReviewOutputIdempotencyLocation,
  type ReviewOutputPublicationState,
  type ReviewOutputScanStats,
} from "../handlers/review-idempotency.ts";
import type { FormatterDiffSkip, FormatterSuggestionPayload } from "./formatter-suggestions.ts";
import {
  sanitizeOutgoingMentions,
  scanOutgoingForSecrets,
} from "../lib/sanitizer.ts";
import {
  createReviewOutputPublicationGate,
  type ReviewOutputPublicationGate,
} from "./mcp/review-output-publication-gate.ts";

export type FormatterSuggestionPublisherStatus =
  | "posted"
  | "skipped"
  | "no-suggestions"
  | "blocked"
  | "failed";

export interface FormatterSuggestionReviewCommentPayload {
  path: string;
  line: number;
  side: "RIGHT";
  body: string;
  start_line?: number;
  start_side?: "RIGHT";
}

export interface FormatterSuggestionCreateReviewPayload {
  owner: string;
  repo: string;
  pull_number: number;
  commit_id: string;
  event: "COMMENT";
  body: string;
  comments: FormatterSuggestionReviewCommentPayload[];
}

export interface FormatterSuggestionPublisherOctokit {
  rest: {
    pulls: {
      createReview(
        payload: FormatterSuggestionCreateReviewPayload,
      ): Promise<{ data: { id?: number | null; html_url?: string | null } }>;
    };
  };
}

export interface PublishFormatterSuggestionReviewOptions {
  octokit: FormatterSuggestionPublisherOctokit;
  owner: string;
  repo: string;
  prNumber: number;
  commitId: string;
  suggestions: FormatterSuggestionPayload[];
  reviewOutputKey?: string;
  skipped?: FormatterDiffSkip[];
  publicationGate?: ReviewOutputPublicationGate;
  botHandles?: string[];
  logger?: {
    warn?(fields: Record<string, unknown>, message?: string): void;
    error?(fields: Record<string, unknown>, message?: string): void;
  };
}

export interface FormatterSuggestionReviewOutputResult {
  key?: string;
  marker?: string;
  markerIncluded: boolean;
  publicationState?: ReviewOutputPublicationState;
  existingLocation?: ReviewOutputIdempotencyLocation | null;
  idempotencyDecision?: ReviewOutputIdempotencyDecision;
  scanStats?: ReviewOutputScanStats;
}

export interface FormatterSuggestionPublishedReview {
  id?: number;
  url?: string;
}

export interface FormatterSuggestionBlockedPublication {
  pattern: string;
  location: "review-body" | "comment";
}

export interface FormatterSuggestionRejectedPublication {
  status?: number;
  message: string;
}

export interface FormatterSuggestionPublisherResult {
  status: FormatterSuggestionPublisherStatus;
  posted: number;
  skipped: number;
  review?: FormatterSuggestionPublishedReview;
  reviewOutput: FormatterSuggestionReviewOutputResult;
  skippedSuggestions: FormatterDiffSkip[];
  error?: string;
  blocked?: FormatterSuggestionBlockedPublication;
  failed?: boolean;
  rejection?: FormatterSuggestionRejectedPublication;
}

function buildReviewBody(options: Pick<PublishFormatterSuggestionReviewOptions, "suggestions" | "reviewOutputKey">): string {
  const summary = [
    "Kodiai formatter suggestions",
    "",
    `Generated ${options.suggestions.length} inline formatter suggestion${options.suggestions.length === 1 ? "" : "s"}.`,
  ];

  if (options.reviewOutputKey) {
    summary.push("", buildReviewOutputMarker(options.reviewOutputKey));
  }

  return summary.join("\n");
}

function mapSuggestionToReviewComment(
  suggestion: FormatterSuggestionPayload,
): FormatterSuggestionReviewCommentPayload {
  return {
    path: suggestion.path,
    line: suggestion.line,
    side: suggestion.side,
    body: suggestion.suggestionBody,
    ...(suggestion.startLine === undefined
      ? {}
      : { start_line: suggestion.startLine, start_side: "RIGHT" as const }),
  };
}

function buildReviewOutputResult(params: {
  reviewOutputKey: string | undefined;
  markerIncluded: boolean;
  publicationStatus?: Awaited<ReturnType<ReviewOutputPublicationGate["resolve"]>>;
}): FormatterSuggestionReviewOutputResult {
  const key = params.publicationStatus?.reviewOutputKey ?? params.reviewOutputKey;
  if (!key) {
    return { markerIncluded: false };
  }

  return {
    key,
    marker: params.publicationStatus?.marker ?? buildReviewOutputMarker(key),
    markerIncluded: params.markerIncluded,
    ...(params.publicationStatus
      ? {
        publicationState: params.publicationStatus.publicationState,
        existingLocation: params.publicationStatus.existingLocation,
        idempotencyDecision: params.publicationStatus.idempotencyDecision,
        scanStats: params.publicationStatus.scanStats,
      }
      : {}),
  };
}

function buildBoundedErrorMessage(error: unknown): string {
  const responseMessage = typeof error === "object" && error !== null && "response" in error
    ? (error as { response?: { data?: { message?: unknown } } }).response?.data?.message
    : undefined;
  const message = typeof responseMessage === "string"
    ? responseMessage
    : error instanceof Error
      ? error.message
      : String(error);
  return message
    .replace(/\bgh[pors]_[A-Za-z0-9_]+\b/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]+\b/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/\bsk-ant-[a-z0-9]+-[A-Za-z0-9_\-]+\b/gi, "[REDACTED_ANTHROPIC_API_KEY]")
    .slice(0, 500);
}

function getErrorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return undefined;
  }

  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function safelyLog(
  logger: PublishFormatterSuggestionReviewOptions["logger"] | undefined,
  level: "warn" | "error",
  fields: Record<string, unknown>,
  message: string,
): void {
  try {
    logger?.[level]?.(fields, message);
  } catch {
    // Best-effort observability must never change publication behavior.
  }
}

function sanitizeOutgoingBody(body: string, botHandles: string[] | undefined): string {
  return sanitizeOutgoingMentions(body, botHandles ?? []);
}

function scanOutgoingBodies(params: {
  reviewBody: string;
  comments: FormatterSuggestionReviewCommentPayload[];
}): FormatterSuggestionBlockedPublication | undefined {
  const reviewScan = scanOutgoingForSecrets(params.reviewBody);
  if (reviewScan.blocked && reviewScan.matchedPattern) {
    return { pattern: reviewScan.matchedPattern, location: "review-body" };
  }

  for (const comment of params.comments) {
    const commentScan = scanOutgoingForSecrets(comment.body);
    if (commentScan.blocked && commentScan.matchedPattern) {
      return { pattern: commentScan.matchedPattern, location: "comment" };
    }
  }

  return undefined;
}

export async function publishFormatterSuggestionReview(
  options: PublishFormatterSuggestionReviewOptions,
): Promise<FormatterSuggestionPublisherResult> {
  if (options.suggestions.length === 0) {
    return {
      status: "no-suggestions",
      posted: 0,
      skipped: options.skipped?.length ?? 0,
      reviewOutput: buildReviewOutputResult({
        reviewOutputKey: options.reviewOutputKey,
        markerIncluded: false,
      }),
      skippedSuggestions: options.skipped ?? [],
    };
  }

  const publicationGate = options.reviewOutputKey
    ? options.publicationGate ?? createReviewOutputPublicationGate({
      owner: options.owner,
      repo: options.repo,
      prNumber: options.prNumber,
      reviewOutputKey: options.reviewOutputKey,
    })
    : undefined;
  let publicationStatus: Awaited<ReturnType<ReviewOutputPublicationGate["resolve"]>> | undefined;
  try {
    publicationStatus = publicationGate
      ? await publicationGate.resolve(options.octokit as unknown as Octokit)
      : undefined;
  } catch (error) {
    return {
      status: "failed",
      posted: 0,
      skipped: options.skipped?.length ?? 0,
      reviewOutput: buildReviewOutputResult({
        reviewOutputKey: options.reviewOutputKey,
        markerIncluded: false,
      }),
      skippedSuggestions: options.skipped ?? [],
      error: buildBoundedErrorMessage(error),
    };
  }

  if (publicationStatus && !publicationStatus.shouldPublish) {
    return {
      status: "skipped",
      posted: 0,
      skipped: options.skipped?.length ?? 0,
      reviewOutput: buildReviewOutputResult({
        reviewOutputKey: options.reviewOutputKey,
        markerIncluded: false,
        publicationStatus,
      }),
      skippedSuggestions: options.skipped ?? [],
    };
  }

  const body = buildReviewBody(options);
  const rawComments = options.suggestions.map(mapSuggestionToReviewComment);
  const blocked = scanOutgoingBodies({ reviewBody: body, comments: rawComments });
  if (blocked) {
    safelyLog(options.logger, "warn", {
      status: "blocked",
      posted: 0,
      pattern: blocked.pattern,
      location: blocked.location,
      suggestions: rawComments.length,
    }, "Blocked formatter suggestion review publication due to outgoing secret pattern");
    return {
      status: "blocked",
      posted: 0,
      skipped: options.skipped?.length ?? 0,
      blocked,
      reviewOutput: buildReviewOutputResult({
        reviewOutputKey: blocked.location === "review-body" ? undefined : options.reviewOutputKey,
        markerIncluded: false,
        publicationStatus: blocked.location === "review-body" ? undefined : publicationStatus,
      }),
      skippedSuggestions: options.skipped ?? [],
    };
  }

  const sanitizedBody = sanitizeOutgoingBody(body, options.botHandles);
  const comments = rawComments.map((comment) => ({
    ...comment,
    body: sanitizeOutgoingBody(comment.body, options.botHandles),
  }));

  let response: { data: { id?: number | null; html_url?: string | null } };
  try {
    response = await options.octokit.rest.pulls.createReview({
      owner: options.owner,
      repo: options.repo,
      pull_number: options.prNumber,
      commit_id: options.commitId,
      event: "COMMENT",
      body: sanitizedBody,
      comments,
    });
  } catch (error) {
    const rejection = {
      status: getErrorStatus(error),
      message: buildBoundedErrorMessage(error),
    };
    safelyLog(options.logger, "error", {
      status: "failed",
      posted: 0,
      rejectionStatus: rejection.status,
      rejectionMessage: rejection.message,
      suggestions: comments.length,
    }, "GitHub rejected formatter suggestion review batch");
    return {
      status: "failed",
      posted: 0,
      skipped: options.skipped?.length ?? 0,
      failed: true,
      rejection,
      error: rejection.message,
      reviewOutput: buildReviewOutputResult({
        reviewOutputKey: options.reviewOutputKey,
        markerIncluded: false,
        publicationStatus,
      }),
      skippedSuggestions: options.skipped ?? [],
    };
  }

  return {
    status: "posted",
    posted: comments.length,
    skipped: options.skipped?.length ?? 0,
    review: {
      id: response.data.id ?? undefined,
      url: response.data.html_url ?? undefined,
    },
    reviewOutput: buildReviewOutputResult({
      reviewOutputKey: options.reviewOutputKey,
      markerIncluded: Boolean(options.reviewOutputKey),
      publicationStatus,
    }),
    skippedSuggestions: options.skipped ?? [],
  };
}
