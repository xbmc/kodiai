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

export interface FormatterSuggestionPublisherResult {
  status: FormatterSuggestionPublisherStatus;
  posted: number;
  skipped: number;
  review?: FormatterSuggestionPublishedReview;
  reviewOutput: FormatterSuggestionReviewOutputResult;
  skippedSuggestions: FormatterDiffSkip[];
  error?: string;
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
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/\bgh[pors]_[A-Za-z0-9_]+\b/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]+\b/g, "[REDACTED_GITHUB_TOKEN]")
    .slice(0, 500);
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
  const comments = options.suggestions.map(mapSuggestionToReviewComment);
  const response = await options.octokit.rest.pulls.createReview({
    owner: options.owner,
    repo: options.repo,
    pull_number: options.prNumber,
    commit_id: options.commitId,
    event: "COMMENT",
    body,
    comments,
  });

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
