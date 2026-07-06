import type { MergeConfidence } from "../lib/merge-confidence.ts";
import { renderApprovalConfidence } from "../lib/merge-confidence-format.ts";
import { buildApprovedReviewBody } from "../review-orchestration/review-idempotency.ts";

export function buildCleanReviewApprovalBody(params: {
  reviewOutputKey: string;
  promptFileCount: number;
  visibleBudgetDisclosureEvidence?: string | null;
  mergeConfidence?: MergeConfidence | null;
  reviewDetailsBlock?: string | null;
}): string {
  const changedFileLabel = params.promptFileCount === 1 ? "changed file" : "changed files";
  const approvalEvidence = [
    `Review prompt covered ${params.promptFileCount} ${changedFileLabel}.`,
    ...(params.visibleBudgetDisclosureEvidence ? [params.visibleBudgetDisclosureEvidence] : []),
  ];
  const approvalConfidence = params.mergeConfidence
    ? renderApprovalConfidence(params.mergeConfidence)
    : null;

  return buildApprovedReviewBody({
    reviewOutputKey: params.reviewOutputKey,
    evidence: approvalEvidence,
    approvalConfidence,
    reviewDetailsBlock: params.reviewDetailsBlock,
  });
}
