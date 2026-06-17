import type { Logger } from "pino";
import type { GitHubApp } from "../auth/github-app.ts";
import { mapWithConcurrency } from "../lib/concurrency.ts";
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
  startLine?: number;
  endLine?: number;
};

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

export async function removeFilteredInlineComments(params: {
  octokit: Awaited<ReturnType<GitHubApp["getInstallationOctokit"]>>;
  owner: string;
  repo: string;
  findings: Array<{ commentId: number }>;
  logger: Logger;
  baseLog: Record<string, unknown>;
}): Promise<void> {
  const { octokit, owner, repo, findings, logger, baseLog } = params;
  const commentIds = new Set<number>(findings.map((finding) => finding.commentId));

  await mapWithConcurrency([...commentIds], 4, async (commentId) => {
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
  });
}
