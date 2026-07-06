import type { Logger } from "pino";
import type { KnowledgeStore, ReviewRecord } from "../knowledge/types.ts";
import { mapWithConcurrency } from "../lib/concurrency.ts";
import {
  fingerprintFindingTitle,
  toConfidenceBand,
  type FindingCategory,
  type FindingSeverity,
} from "../lib/review-finding-metadata.ts";

type ReviewKnowledgeStore = Pick<
  KnowledgeStore,
  "recordReview" | "recordFindings" | "recordSuppressionLog" | "recordGlobalPattern"
>;

export type ReviewKnowledgeFinding = {
  commentId?: number;
  filePath: string;
  startLine?: number;
  endLine?: number;
  severity: FindingSeverity;
  category: FindingCategory;
  confidence: number;
  title: string;
  suppressed: boolean;
  suppressionPattern?: string;
};

export type ReviewKnowledgePersistenceResult =
  | { status: "recorded"; reviewId: number }
  | { status: "failed" };

export async function persistReviewKnowledge(params: {
  knowledgeStore: ReviewKnowledgeStore;
  logger: Pick<Logger, "debug" | "warn">;
  repo: string;
  prNumber: number;
  reviewOutputKey: string;
  reviewRecord: ReviewRecord;
  processedFindings: ReviewKnowledgeFinding[];
  suppressionMatchCounts: Map<string, number>;
  visibleFindingCount: number;
  lowConfidenceFindingCount: number;
  suppressionsApplied: number;
  shareGlobal: boolean;
}): Promise<ReviewKnowledgePersistenceResult> {
  const {
    knowledgeStore,
    logger,
    repo,
    prNumber,
    reviewOutputKey,
    reviewRecord,
    processedFindings,
    suppressionMatchCounts,
    visibleFindingCount,
    lowConfidenceFindingCount,
    suppressionsApplied,
    shareGlobal,
  } = params;

  try {
    const reviewId = await knowledgeStore.recordReview(reviewRecord);

    logger.debug(
      {
        reviewId,
        repo,
        prNumber,
        findingsCaptured: processedFindings.length,
      },
      "Knowledge store: review recorded",
    );

    await knowledgeStore.recordFindings(
      processedFindings.map((finding) => ({
        reviewId,
        commentId: finding.commentId,
        commentSurface: "pull_request_review_comment" as const,
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

    await knowledgeStore.recordSuppressionLog(
      Array.from(suppressionMatchCounts.entries()).map(([pattern, matchedCount]) => ({
        reviewId,
        pattern,
        matchedCount,
      })),
    );

    if (shareGlobal) {
      try {
        const aggregateCounts = new Map<string, {
          severity: FindingSeverity;
          category: FindingCategory;
          confidenceBand: "high" | "medium" | "low";
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

        await mapWithConcurrency(
          [...aggregateCounts.values()],
          4,
          (aggregate) => knowledgeStore.recordGlobalPattern({
            severity: aggregate.severity,
            category: aggregate.category,
            confidenceBand: aggregate.confidenceBand,
            patternFingerprint: aggregate.patternFingerprint,
            count: aggregate.count,
          }),
        );
      } catch (err) {
        logger.warn(
          { err, repo, prNumber },
          "Knowledge store global aggregate write failed (non-fatal)",
        );
      }
    }

    logger.debug(
      {
        reviewId,
        repo,
        prNumber,
        visibleFindings: visibleFindingCount,
        lowConfidenceFindings: lowConfidenceFindingCount,
        suppressionsApplied,
      },
      "Knowledge store: findings and suppression logs recorded",
    );

    return { status: "recorded", reviewId };
  } catch (err) {
    logger.warn(
      { err, repo, prNumber },
      "Knowledge store write failed (non-fatal)",
    );
    return { status: "failed" };
  }
}
