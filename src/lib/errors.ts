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
import { redactGitHubTokens } from "./sanitizer.ts";

/** The five user-facing error categories */
export type ErrorCategory =
  | "timeout"
  | "api_error"
  | "config_error"
  | "clone_error"
  | "internal_error";

/**
 * Classify an error into a user-understandable category.
 *
 * @param error - The caught error (unknown type from catch blocks)
 * @param isTimeout - Whether the execution was terminated by timeout
 * @returns The error category for formatting
 */
export function classifyError(
  error: unknown,
  isTimeout: boolean,
): ErrorCategory {
  if (isTimeout) return "timeout";

  const message =
    error instanceof Error ? error.message : String(error);

  if (message.includes(".kodiai.yml")) return "config_error";

  // API errors checked before clone errors: "rate limit" contains "git"
  // and status codes are more specific than the broad "git" match
  if (/rate limit|API|\b[45]\d{2}\b/i.test(message)) return "api_error";

  if (/clone|git/i.test(message)) return "clone_error";

  return "internal_error";
}

/** Human-readable headers for each error category */
const HEADERS: Record<ErrorCategory, string> = {
  timeout: "Kodiai timed out",
  api_error: "Kodiai encountered an API error",
  config_error: "Kodiai found a configuration problem",
  clone_error: "Kodiai couldn't access the repository",
  internal_error: "Kodiai encountered an error",
};

/** Actionable suggestions for each error category */
const SUGGESTIONS: Record<ErrorCategory, string> = {
  timeout:
    "Try breaking the task into smaller pieces, or increase the timeout in `.kodiai.yml`.",
  api_error: "This is usually temporary. Try again in a few minutes.",
  config_error:
    "Check your `.kodiai.yml` file for syntax or schema errors.",
  clone_error:
    "Verify the repository is accessible and the branch exists.",
  internal_error: "If this persists, please report this issue.",
};

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
  const sanitizedDetail = redactGitHubTokens(detail);

  return `> **${header}**\n\n_${sanitizedDetail}_\n\n${suggestion}`;
}

/**
 * Post or update an error comment on a GitHub issue/PR.
 *
 * If trackingCommentId is provided, updates that comment. Otherwise creates a new one.
 *
 * IMPORTANT: This function never throws. If the GitHub API call fails,
 * the error is logged but swallowed. Error reporting must not mask
 * the original error that triggered it (Pitfall 6).
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
): Promise<void> {
  try {
    if (target.trackingCommentId) {
      await octokit.rest.issues.updateComment({
        owner: target.owner,
        repo: target.repo,
        comment_id: target.trackingCommentId,
        body,
      });
    } else {
      await octokit.rest.issues.createComment({
        owner: target.owner,
        repo: target.repo,
        issue_number: target.issueNumber,
        body,
      });
    }
  } catch (err) {
    logger.error(
      { err, owner: target.owner, repo: target.repo, issueNumber: target.issueNumber },
      "Failed to post/update error comment",
    );
  }
}
