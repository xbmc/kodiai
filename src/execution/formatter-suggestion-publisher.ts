import { buildReviewOutputMarker } from "../handlers/review-idempotency.ts";
import type { FormatterDiffSkip, FormatterSuggestionPayload } from "./formatter-suggestions.ts";

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
}

export interface FormatterSuggestionReviewOutputResult {
  key?: string;
  marker?: string;
  markerIncluded: boolean;
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

function buildReviewOutputResult(reviewOutputKey: string | undefined): FormatterSuggestionReviewOutputResult {
  if (!reviewOutputKey) {
    return { markerIncluded: false };
  }

  return {
    key: reviewOutputKey,
    marker: buildReviewOutputMarker(reviewOutputKey),
    markerIncluded: true,
  };
}

export async function publishFormatterSuggestionReview(
  options: PublishFormatterSuggestionReviewOptions,
): Promise<FormatterSuggestionPublisherResult> {
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
    reviewOutput: buildReviewOutputResult(options.reviewOutputKey),
    skippedSuggestions: options.skipped ?? [],
  };
}
