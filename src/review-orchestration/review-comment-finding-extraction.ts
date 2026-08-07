import type { Logger } from "pino";
import type { GitHubApp } from "../auth/github-app.ts";
import { mapWithConcurrency } from "../lib/concurrency.ts";
import { findReviewCommentsByMarkerPaged } from "../lib/github-issue-comments.ts";
import { err as resultErr, ok as resultOk, toError, type Result } from "../lib/result.ts";
import {
  parseInlineCommentMetadata,
  type FindingCategory,
  type FindingSeverity,
} from "../lib/review-finding-metadata.ts";
import { buildReviewOutputMarker } from "./review-idempotency.ts";

export type ExtractedFinding = {
  commentId: number;
  filePath: string;
  title: string;
  severity: FindingSeverity;
  category: FindingCategory;
  /**
   * The comment's prose body. Carried so enforcement/semantic-grounding.ts can
   * fact-check the reviewer's actual reasoning instead of a one-line title.
   * Omitted when the comment was a bare title.
   */
  reasoning?: string;
  startLine?: number;
  endLine?: number;
};

export type InlineCommentRemovalSummary = {
  deletedCommentIds: number[];
};

export type InlineCommentRemovalFailure = {
  commentId: number;
  error: Error;
};

export type InlineCommentRemovalResult = Result<InlineCommentRemovalSummary, InlineCommentRemovalError>;

export class InlineCommentRemovalError extends Error {
  readonly deletedCommentIds: number[];
  readonly failures: InlineCommentRemovalFailure[];

  constructor(params: {
    deletedCommentIds: number[];
    failures: InlineCommentRemovalFailure[];
  }) {
    super(`${params.failures.length} inline review comment ${params.failures.length === 1 ? "deletion" : "deletions"} failed`);
    this.name = "InlineCommentRemovalError";
    this.deletedCommentIds = params.deletedCommentIds;
    this.failures = params.failures;
  }
}

export async function extractFindingsFromReviewComments(params: {
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
    const comments = await findReviewCommentsByMarkerPaged(octokit, {
      owner,
      repo,
      prNumber,
      marker,
      sort: "created",
      direction: "desc",
    });
    const findings: ExtractedFinding[] = [];

    for (const comment of comments) {
      if (typeof comment.path !== "string" || typeof comment.body !== "string") {
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
        reasoning: parsed.reasoning.length > 0 ? parsed.reasoning : undefined,
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

export async function removeFilteredInlineComments(params: {
  octokit: Awaited<ReturnType<GitHubApp["getInstallationOctokit"]>>;
  owner: string;
  repo: string;
  findings: Array<{ commentId: number }>;
  logger: Logger;
  baseLog: Record<string, unknown>;
}): Promise<InlineCommentRemovalResult> {
  const { octokit, owner, repo, findings, logger, baseLog } = params;
  const commentIds = new Set<number>(findings.map((finding) => finding.commentId));
  const deletedCommentIds: number[] = [];
  const failures: InlineCommentRemovalFailure[] = [];

  await mapWithConcurrency([...commentIds], 4, async (commentId) => {
    try {
      await octokit.rest.pulls.deleteReviewComment({
        owner,
        repo,
        comment_id: commentId,
      });
      deletedCommentIds.push(commentId);
    } catch (err) {
      const error = toError(err);
      failures.push({ commentId, error });
      logger.warn(
        {
          ...baseLog,
          gate: "inline-policy-filter",
          commentId,
          err: error,
        },
        "Failed to delete filtered inline review comment; continuing",
      );
    }
  });

  deletedCommentIds.sort((left, right) => left - right);
  failures.sort((left, right) => left.commentId - right.commentId);

  return failures.length > 0
    ? resultErr(new InlineCommentRemovalError({ deletedCommentIds, failures }))
    : resultOk({ deletedCommentIds });
}
