import type { DuplicateCandidate } from "./duplicate-detector.ts";

export const TRIAGE_MARKER_PREFIX = "kodiai:triage";

/**
 * Build an HTML comment marker for idempotency fallback detection.
 */
export function buildTriageMarker(repo: string, issueNumber: number): string {
  return `<!-- ${TRIAGE_MARKER_PREFIX}:${repo}:${issueNumber} -->`;
}

/**
 * Format a triage comment with duplicate candidates as a compact markdown table.
 *
 * Sorting: closed candidates first, then by similarity descending.
 * If all candidates are closed, appends a note about resolution.
 * Includes an HTML marker for idempotency fallback.
 */
export function formatTriageComment(
  candidates: DuplicateCandidate[],
  marker: string,
): string {
  const sorted = [...candidates].sort((a, b) => {
    if (a.state === "closed" && b.state !== "closed") return -1;
    if (a.state !== "closed" && b.state === "closed") return 1;
    return b.similarityPct - a.similarityPct;
  });

  const lines: string[] = [];
  lines.push("Possible duplicates detected:");
  lines.push("");
  lines.push("| Issue | Title | Similarity | Status |");
  lines.push("|-------|-------|------------|--------|");
  for (const c of sorted) {
    lines.push(`| #${c.issueNumber} | ${c.title} | ${c.similarityPct}% | ${c.state} |`);
  }

  if (sorted.every((c) => c.state === "closed")) {
    lines.push("");
    lines.push("All matches are closed issues -- the problem may already be resolved.");
  }

  lines.push("");
  lines.push(marker);

  return lines.join("\n");
}
