import type { ProcessedReviewFinding } from "./review-reducer.ts";

export function isCandidatePublicationDraft(finding: unknown): boolean {
  return typeof finding === "object"
    && finding !== null
    && (finding as { candidatePublicationDraft?: unknown }).candidatePublicationDraft === true;
}

export function reviewFindingIdentityKey(finding: ProcessedReviewFinding): string {
  const candidateFingerprint = typeof finding.candidateFingerprint === "string" ? finding.candidateFingerprint.trim() : "";
  if (candidateFingerprint) return `candidate:${candidateFingerprint}`;
  if (Number.isFinite(finding.commentId)) return `comment:${Math.floor(finding.commentId)}`;
  return [
    "content",
    finding.filePath,
    finding.title,
    typeof finding.startLine === "number" ? Math.floor(finding.startLine).toString() : "",
    typeof finding.endLine === "number" ? Math.floor(finding.endLine).toString() : "",
  ].join(":");
}

export function mergeCandidatePublishedFindings(
  directFindings: ReadonlyArray<ProcessedReviewFinding>,
  candidateFindings: ReadonlyArray<ProcessedReviewFinding>,
): ProcessedReviewFinding[] {
  if (candidateFindings.length === 0) return [...directFindings];

  const merged: ProcessedReviewFinding[] = [...directFindings];
  const seen = new Set(merged.map(reviewFindingIdentityKey));
  for (const finding of candidateFindings) {
    const key = reviewFindingIdentityKey(finding);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(finding);
  }
  return merged;
}
