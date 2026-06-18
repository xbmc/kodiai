/**
 * Error classification, formatting, and comment posting utility.
 *
 * Provides shared error handling primitives for review and mention handlers:
 * - Classify errors into user-understandable categories
 * - Format error comments as actionable markdown
 * - Post or update error comments on GitHub (with defense-in-depth token redaction)
 *
 * Design: postOrUpdateErrorComment never throws -- error reporting must not
 * mask the original error (Pitfall 6 from research).
 */

import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import { retryGitHubRateLimitOnly } from "./github-retry.ts";
import { redactGitHubTokens } from "./sanitizer.ts";

/** User-facing error categories. */
export type ErrorCategory =
  | "timeout"
  | "timeout_partial"
  | "api_error"
  | "config_error"
  | "clone_error"
  | "internal_error"
  | "usage_limit";

export type ErrorCommentPublicationMethod = "create-comment" | "update-comment";
export type ErrorCommentPublicationResolution = "created" | "updated" | "failed";

export type ErrorCommentPublicationStatus = {
  ok: boolean;
  resolution: ErrorCommentPublicationResolution;
  method: ErrorCommentPublicationMethod;
  error?: unknown;
};

/**
 * Classify an error into a user-understandable category.
 *
 * @param error - The caught error (unknown type from catch blocks)
 * @param isTimeout - Whether the execution was terminated by timeout
 * @param published - Whether any inline comments were published before the error
 * @returns The error category for formatting
 */
export function classifyError(
  error: unknown,
  isTimeout: boolean,
  published?: boolean,
): ErrorCategory {
  if (isTimeout && published) return "timeout_partial";
  if (isTimeout) return "timeout";

  const message =
    error instanceof Error ? error.message : String(error);
  const status =
    typeof error === "object" && error !== null
      ? typeof (error as { status?: unknown }).status === "number"
        ? (error as { status: number }).status
        : typeof (error as { response?: { status?: unknown } }).response?.status === "number"
          ? ((error as { response: { status: number } }).response.status)
          : undefined
      : undefined;

  if (message.includes(".kodiai.yml")) return "config_error";

  if (/you(?:'|’)ve hit your limit|you have hit your limit|usage limit/i.test(message)) {
    return "usage_limit";
  }

  if (status !== undefined && status >= 400 && status < 600) return "api_error";

  // API errors checked before clone errors: "rate limit" contains "git"
  // and status codes are more specific than the broad "git" match
  if (/rate limit|API|\b[45]\d{2}\b/i.test(message)) return "api_error";

  if (/clone|git/i.test(message)) return "clone_error";

  return "internal_error";
}

/** Human-readable headers for each error category */
const HEADERS: Record<ErrorCategory, string> = {
  timeout: "Kodiai timed out",
  timeout_partial: "Kodiai completed a partial review",
  api_error: "Kodiai encountered an API error",
  config_error: "Kodiai found a configuration problem",
  clone_error: "Kodiai couldn't access the repository",
  internal_error: "Kodiai could not complete the request",
  usage_limit: "Kodiai hit its review provider usage limit",
};

/** Actionable suggestions for each error category */
const SUGGESTIONS: Record<ErrorCategory, string> = {
  timeout:
    "Try a narrower request such as `@kodiai review path/to/file.cpp` if it repeats.",
  timeout_partial:
    "Some inline comments were posted above. Try a narrower follow-up request if you need the remaining files reviewed.",
  api_error: "This is usually temporary. Try again in a few minutes.",
  config_error:
    "Check your `.kodiai.yml` file for syntax or schema errors.",
  clone_error:
    "Verify the repository is accessible and the branch exists.",
  internal_error: "The failure was recorded in KodiAI logs. Try again later, or narrow the request if it repeats.",
  usage_limit:
    "Kodiai cannot run another review until the provider usage limit resets. Please try again after the reset time shown above.",
};

const USAGE_LIMIT_ERROR_MARKER = "<!-- kodiai:error:usage-limit -->";
const USAGE_LIMIT_DEDUPE_WINDOW_MS = 15 * 60 * 1000;

/**
 * Format an error into a user-facing markdown comment.
 *
 * Defense-in-depth: the detail string is run through redactGitHubTokens()
 * before inclusion, ensuring no tokens leak even if callers forget to sanitize.
 *
 * @param category - The classified error category
 * @param detail - The error detail message (will be sanitized)
 * @returns Formatted markdown string ready for posting as a GitHub comment
 */
export function formatErrorComment(
  category: ErrorCategory,
  detail: string,
): string {
  const header = HEADERS[category];
  const suggestion = SUGGESTIONS[category];
  const sanitizedDetail = formatPublicErrorDetail(category, detail);

  return [
    `> **${header}**\n\n_${sanitizedDetail}_\n\n${suggestion}`,
    category === "usage_limit" ? USAGE_LIMIT_ERROR_MARKER : undefined,
  ].filter((line): line is string => line !== undefined).join("\n\n");
}

function formatPublicErrorDetail(
  category: ErrorCategory,
  detail: string,
): string {
  const redacted = redactGitHubTokens(detail).trim();

  switch (category) {
    case "timeout":
      return "The request exceeded its execution time before KodiAI could publish a complete response.";
    case "timeout_partial":
      return "The request exceeded its execution time after KodiAI published partial output.";
    case "api_error":
      return "A GitHub or runtime API request failed before KodiAI could publish a complete response.";
    case "config_error":
      return "KodiAI could not load or validate the repository configuration.";
    case "clone_error":
      return "KodiAI could not prepare the repository checkout for this request.";
    case "usage_limit":
      return formatUsageLimitPublicDetail(redacted);
    case "internal_error":
      return "The request failed before KodiAI could publish a complete response.";
  }
}

function formatUsageLimitPublicDetail(detail: string): string {
  const resetMatch = detail.match(/\bresets?\s+([^.\n\r]+)/i);
  if (!resetMatch?.[1]) {
    return "The review provider usage limit was reached.";
  }

  return `The review provider usage limit was reached; reset ${resetMatch[1].trim()}.`;
}

async function findRecentUsageLimitErrorComment(
  octokit: Octokit,
  target: {
    owner: string;
    repo: string;
    issueNumber: number;
  },
): Promise<number | undefined> {
  const listComments = octokit.rest.issues.listComments;
  if (typeof listComments !== "function") {
    return undefined;
  }

  const { data } = await retryGitHubRateLimitOnly(() =>
    listComments({
      owner: target.owner,
      repo: target.repo,
      issue_number: target.issueNumber,
      per_page: 100,
    }),
  );

  const cutoffMs = Date.now() - USAGE_LIMIT_DEDUPE_WINDOW_MS;
  const recent = data
    .filter((comment) => {
      const body = typeof comment.body === "string" ? comment.body : "";
      const login = comment.user?.login ?? "";
      const createdAtMs = Date.parse(comment.created_at ?? "");
      return body.includes(USAGE_LIMIT_ERROR_MARKER)
        && login.includes("kodiai")
        && Number.isFinite(createdAtMs)
        && createdAtMs >= cutoffMs;
    })
    .sort((a, b) => Date.parse(b.created_at ?? "") - Date.parse(a.created_at ?? ""));

  return recent[0]?.id;
}

/**
 * Post or update an error comment on a GitHub issue/PR.
 *
 * If trackingCommentId is provided, updates that comment. Otherwise creates a new one.
 *
 * IMPORTANT: This function never throws. If the GitHub API call fails,
 * the error is logged but swallowed. Error reporting must not mask
 * the original error that triggered it (Pitfall 6). The return value
 * truthfully reports whether the fallback comment was created, updated,
 * or failed to publish.
 *
 * @param octokit - Authenticated Octokit instance
 * @param target - The issue/PR to comment on
 * @param body - The formatted comment body
 * @param logger - Logger for recording API failures
 */
export async function postOrUpdateErrorComment(
  octokit: Octokit,
  target: {
    owner: string;
    repo: string;
    issueNumber: number;
    trackingCommentId?: number;
  },
  body: string,
  logger: Logger,
): Promise<ErrorCommentPublicationStatus> {
  const method: ErrorCommentPublicationMethod = target.trackingCommentId
    ? "update-comment"
    : "create-comment";

  try {
    if (target.trackingCommentId) {
      const trackingCommentId = target.trackingCommentId;
      await retryGitHubRateLimitOnly(() =>
        octokit.rest.issues.updateComment({
          owner: target.owner,
          repo: target.repo,
          comment_id: trackingCommentId,
          body,
        }),
      );
      return { ok: true, resolution: "updated", method };
    }

    if (body.includes(USAGE_LIMIT_ERROR_MARKER)) {
      const duplicateCommentId = await findRecentUsageLimitErrorComment(octokit, target);
      if (duplicateCommentId !== undefined) {
        await retryGitHubRateLimitOnly(() =>
          octokit.rest.issues.updateComment({
            owner: target.owner,
            repo: target.repo,
            comment_id: duplicateCommentId,
            body,
          }),
        );
        return { ok: true, resolution: "updated", method: "update-comment" };
      }
    }

    await retryGitHubRateLimitOnly(() =>
      octokit.rest.issues.createComment({
        owner: target.owner,
        repo: target.repo,
        issue_number: target.issueNumber,
        body,
      }),
    );
    return { ok: true, resolution: "created", method };
  } catch (err) {
    logger.error(
      {
        err,
        owner: target.owner,
        repo: target.repo,
        issueNumber: target.issueNumber,
        trackingCommentId: target.trackingCommentId ?? null,
        errorCommentMethod: method,
      },
      "Failed to post/update error comment",
    );
    return { ok: false, resolution: "failed", method, error: err };
  }
}
