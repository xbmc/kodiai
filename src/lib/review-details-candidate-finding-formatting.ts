import type { ReviewCandidateFindingDetailsSummary } from "../review-orchestration/review-candidate-finding.ts";

export function formatReviewCandidateFindingDetailsLine(
  reviewCandidateFinding?: ReviewCandidateFindingDetailsSummary | null,
): string[] {
  try {
    if (reviewCandidateFinding?.label !== "Review candidates") return [];
    if (
      reviewCandidateFinding.status !== "shadow"
      && reviewCandidateFinding.status !== "unavailable"
      && reviewCandidateFinding.status !== "degraded"
    ) {
      return [];
    }

    const text = typeof reviewCandidateFinding.text === "string"
      ? sanitizeReviewCandidateDetailsText(reviewCandidateFinding.text)
      : "";
    if (!text || !text.startsWith("Review candidates:")) return [];
    return [`- ${text}`];
  } catch {
    return [];
  }
}

function sanitizeReviewCandidateDetailsText(value: string): string {
  return value
    .replace(/sk-[a-zA-Z0-9_-]+/g, "redacted")
    .replace(/gh[pousr]_[a-zA-Z0-9_]+/g, "redacted")
    .replace(/TOKEN\s*=\s*[^\s]+/gi, "token-redacted")
    .replace(/PROMPT[_-]?SECRET/gi, "prompt-redacted")
    .replace(/diff --git/gi, "diff-redacted")
    .replace(/BEGIN\s+PROMPT/gi, "prompt-redacted")
    .replace(/system prompt|hidden instructions/gi, "prompt-redacted")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 260);
}
