import type { ClassifiedFailure } from "./ci-failure-classifier.ts";

/**
 * Build the hidden HTML marker used to identify the CI analysis comment for upsert.
 */
export function buildCIAnalysisMarker(
  owner: string,
  repo: string,
  prNumber: number,
): string {
  return `<!-- kodiai:ci-analysis:${owner}/${repo}/pr-${prNumber} -->`;
}

const ICON_MAP: Record<string, string> = {
  unrelated: ":white_check_mark:",
  "flaky-unrelated": ":warning:",
  "possibly-pr-related": ":x:",
};

const CONFIDENCE_LABEL: Record<string, string> = {
  high: "high confidence",
  medium: "medium confidence",
  low: "low confidence",
};

/**
 * Format classified CI failures into a markdown section for the PR comment.
 *
 * @param classified - Array of classified failures from classifyFailures()
 * @param totalFailures - Total number of failed checks on the PR head
 * @returns Formatted markdown string
 */
export function formatCISection(
  classified: ClassifiedFailure[],
  totalFailures: number,
): string {
  if (classified.length === 0) return "";

  const unrelatedCount = classified.filter(
    (c) =>
      c.classification === "unrelated" ||
      c.classification === "flaky-unrelated",
  ).length;

  const lines: string[] = [];
  lines.push("### CI Failure Analysis");
  lines.push("");

  // Summary line
  if (unrelatedCount === totalFailures && totalFailures > 0) {
    lines.push(
      `**All ${totalFailures} failure${totalFailures === 1 ? "" : "s"} appear unrelated to this PR**`,
    );
  } else {
    lines.push(
      `**${unrelatedCount} of ${totalFailures} failure${totalFailures === 1 ? "" : "s"} appear unrelated to this PR**`,
    );
  }

  lines.push("");
  lines.push("<details><summary>Failure details</summary>");
  lines.push("");

  for (const item of classified) {
    const icon = ICON_MAP[item.classification] ?? ":question:";
    const conf = CONFIDENCE_LABEL[item.confidence] ?? item.confidence;
    lines.push(
      `- ${icon} **${item.checkName}** [${conf}] — ${item.evidence}`,
    );

    if (item.flakiness) {
      const pct = Math.round(item.flakiness.failRate * 100);
      lines.push(
        `  Failed ${pct}% of last ${item.flakiness.window} runs`,
      );
    }
  }

  lines.push("");
  lines.push("</details>");

  return lines.join("\n");
}
