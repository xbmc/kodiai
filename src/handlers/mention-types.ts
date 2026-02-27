import type {
  IssueCommentCreatedEvent,
  PullRequestReviewCommentCreatedEvent,
  PullRequestReviewSubmittedEvent,
} from "@octokit/webhooks-types";

/** Normalized mention event shape that all four comment surfaces map to. */
export interface MentionEvent {
  surface: "issue_comment" | "pr_comment" | "pr_review_comment" | "pr_review_body";
  owner: string;
  repo: string;
  /** Issue or PR number (used for issue comment API calls) */
  issueNumber: number;
  /** Set only for PR surfaces */
  prNumber: number | undefined;
  /** The comment that triggered the mention */
  commentId: number;
  /** The comment text containing @kodiai */
  commentBody: string;
  /** Who wrote the trigger comment */
  commentAuthor: string;
  /** ISO timestamp for TOCTOU filtering (Phase 6) */
  commentCreatedAt: string;
  /** PR head branch ref (for clone). Needs fetch for issue_comment on PR. */
  headRef: string | undefined;
  /** PR base branch ref (for diff) */
  baseRef: string | undefined;
  /** Fork clone target owner */
  headRepoOwner: string | undefined;
  /** Fork clone target repo name */
  headRepoName: string | undefined;
  /** Only for pr_review_comment surface */
  diffHunk: string | undefined;
  /** Only for pr_review_comment surface */
  filePath: string | undefined;
  /** Only for pr_review_comment surface */
  fileLine: number | undefined;
  /** For pr_review_comment: the comment ID this is replying to (thread parent) */
  inReplyToId: number | undefined;
  /** Issue body text (for triage validation on issue_comment surface) */
  issueBody: string | null;
}

/**
 * Normalize an issue_comment.created payload into a MentionEvent.
 *
 * Checks `issue.pull_request` to distinguish PR comments from pure issue comments.
 * headRef/baseRef/headRepoOwner/headRepoName are left undefined for PR comments
 * and must be fetched via pulls.get() by the handler.
 */
export function normalizeIssueComment(
  payload: IssueCommentCreatedEvent,
): MentionEvent {
  const isPR = !!payload.issue.pull_request;
  return {
    surface: isPR ? "pr_comment" : "issue_comment",
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    issueNumber: payload.issue.number,
    prNumber: isPR ? payload.issue.number : undefined,
    commentId: payload.comment.id,
    commentBody: payload.comment.body,
    commentAuthor: payload.comment.user.login,
    commentCreatedAt: payload.comment.created_at,
    headRef: undefined,
    baseRef: undefined,
    headRepoOwner: undefined,
    headRepoName: undefined,
    diffHunk: undefined,
    filePath: undefined,
    fileLine: undefined,
    inReplyToId: undefined,
    issueBody: payload.issue.body ?? null,
  };
}

/**
 * Normalize a pull_request_review_comment.created payload into a MentionEvent.
 *
 * Surface is always "pr_review_comment". PR details are available in the payload.
 */
export function normalizeReviewComment(
  payload: PullRequestReviewCommentCreatedEvent,
): MentionEvent {
  return {
    surface: "pr_review_comment",
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    issueNumber: payload.pull_request.number,
    prNumber: payload.pull_request.number,
    commentId: payload.comment.id,
    commentBody: payload.comment.body,
    commentAuthor: payload.comment.user.login,
    commentCreatedAt: payload.comment.created_at,
    headRef: payload.pull_request.head.ref,
    baseRef: payload.pull_request.base.ref,
    headRepoOwner: payload.pull_request.head.repo?.owner.login,
    headRepoName: payload.pull_request.head.repo?.name,
    diffHunk: payload.comment.diff_hunk,
    filePath: payload.comment.path,
    fileLine: payload.comment.line ?? payload.comment.original_line ?? undefined,
    inReplyToId: payload.comment.in_reply_to_id ?? undefined,
    issueBody: null,
  };
}

/**
 * Normalize a pull_request_review.submitted payload into a MentionEvent.
 *
 * The commentId is the review ID. The caller must null-check review.body
 * before calling this (a review with null body has no mention).
 */
export function normalizeReviewBody(
  payload: PullRequestReviewSubmittedEvent,
): MentionEvent {
  return {
    surface: "pr_review_body",
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    issueNumber: payload.pull_request.number,
    prNumber: payload.pull_request.number,
    commentId: payload.review.id,
    commentBody: payload.review.body ?? "",
    commentAuthor: payload.review.user.login,
    commentCreatedAt: payload.review.submitted_at ?? payload.pull_request.updated_at,
    headRef: payload.pull_request.head.ref,
    baseRef: payload.pull_request.base.ref,
    headRepoOwner: payload.pull_request.head.repo?.owner.login,
    headRepoName: payload.pull_request.head.repo?.name,
    diffHunk: undefined,
    filePath: undefined,
    fileLine: undefined,
    inReplyToId: undefined,
    issueBody: null,
  };
}

/** Case-insensitive check for @appSlug mention in a comment body. */
export function containsMention(
  body: string | null | undefined,
  acceptedHandles: string[],
): boolean {
  if (!body) return false;

  const regex = buildMentionRegex(acceptedHandles, "i");
  return regex.test(body);
}

/** Remove any accepted mention handles from the comment body and trim whitespace. */
export function stripMention(body: string, acceptedHandles: string[]): string {
  const regex = buildMentionRegex(acceptedHandles, "gi");
  return body.replace(regex, "").trim();
}

function buildMentionRegex(handles: string[], flags: string): RegExp {
  const cleaned = handles
    .map((h) => (h.startsWith("@") ? h.slice(1) : h))
    .map((h) => h.trim())
    .filter((h) => h.length > 0)
    .map(escapeRegExp);

  if (cleaned.length === 0) {
    // Never matches.
    return new RegExp("$^", flags);
  }

  return new RegExp(`@(?:${cleaned.join("|")})\\b`, flags);
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&");
}
