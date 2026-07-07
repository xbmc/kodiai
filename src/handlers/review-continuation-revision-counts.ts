import type { Logger } from "pino";
import { classifyFindingDeltas, type DeltaClassification } from "../lib/delta-classifier.ts";
import { fingerprintFindingTitle } from "../lib/review-finding-metadata.ts";
import type { PriorFinding } from "../knowledge/types.ts";
import type { ExtractedFinding } from "../review-orchestration/review-comment-finding-extraction.ts";

export type ContinuationRevisionCounts = DeltaClassification["counts"];

export async function resolveReviewContinuationRevisionCounts(params: {
  repo: string;
  prNumber: number;
  reviewOutputKey: string;
  logger: Pick<Logger, "warn">;
  baseLog: Record<string, unknown>;
  getPriorReviewFindings?: (params: { repo: string; prNumber: number }) => Promise<PriorFinding[]>;
  extractFindings?: () => Promise<ExtractedFinding[]>;
}): Promise<ContinuationRevisionCounts | null> {
  if (!params.getPriorReviewFindings || !params.extractFindings) {
    return null;
  }

  try {
    const priorFindings = await params.getPriorReviewFindings({
      repo: params.repo,
      prNumber: params.prNumber,
    });
    if (priorFindings.length === 0) {
      return null;
    }

    const currentFindings = await params.extractFindings();
    return classifyFindingDeltas({
      currentFindings: currentFindings.map((finding) => ({
        filePath: finding.filePath,
        title: finding.title,
        severity: finding.severity,
        category: finding.category,
        commentId: finding.commentId,
        suppressed: false,
        confidence: 100,
      })),
      priorFindings,
      fingerprintFn: fingerprintFindingTitle,
    }).counts;
  } catch (err) {
    params.logger.warn(
      {
        ...params.baseLog,
        gate: "continuation-delta",
        gateResult: "failed",
        reviewOutputKey: params.reviewOutputKey,
        err,
      },
      "Continuation delta classification failed (fail-open, merging without revision labels)",
    );
    return null;
  }
}
