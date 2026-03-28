/**
 * Pure formatting module for addon-check PR comments.
 *
 * No I/O, no GitHub API — takes structured findings and returns a markdown string
 * suitable for posting or updating as a PR comment.
 */

import type { AddonFinding } from "../handlers/addon-check.ts";

export const ADDON_CHECK_MARKER_PREFIX = "kodiai:addon-check";

/**
 * Build the HTML comment marker used for idempotent comment upsert.
 * Format: <!-- kodiai:addon-check:{owner}/{repo}:{prNumber} -->
 */
export function buildAddonCheckMarker(
  owner: string,
  repo: string,
  prNumber: number,
): string {
  return `<!-- ${ADDON_CHECK_MARKER_PREFIX}:${owner}/${repo}:${prNumber} -->`;
}

/**
 * Render the full PR comment body for an addon-check run.
 *
 * Structure:
 *   - Marker on line 1 (for idempotent upsert detection)
 *   - ## Kodiai Addon Check heading
 *   - Markdown table of ERROR and WARN findings (INFO filtered out)
 *   - Summary line: _X error(s), Y warning(s) found._
 *
 * If there are no ERROR or WARN findings, emits a clean-pass body instead.
 */
export function formatAddonCheckComment(
  findings: AddonFinding[],
  marker: string,
): string {
  const relevant = findings.filter(
    (f) => f.level === "ERROR" || f.level === "WARN",
  );

  const lines: string[] = [];
  lines.push(marker);
  lines.push("## Kodiai Addon Check");
  lines.push("");

  if (relevant.length === 0) {
    lines.push("✅ No issues found by kodi-addon-checker.");
    return lines.join("\n");
  }

  // Findings table
  lines.push("| Addon | Level | Message |");
  lines.push("|-------|-------|---------|");
  for (const f of relevant) {
    lines.push(`| ${f.addonId} | ${f.level} | ${f.message} |`);
  }

  const errorCount = relevant.filter((f) => f.level === "ERROR").length;
  const warnCount = relevant.filter((f) => f.level === "WARN").length;

  lines.push("");
  lines.push(`_${errorCount} error(s), ${warnCount} warning(s) found._`);

  return lines.join("\n");
}
