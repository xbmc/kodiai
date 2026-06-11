/**
 * Pure formatting module for addon-check PR comments.
 *
 * No I/O, no GitHub API — takes structured findings and returns a markdown string
 * suitable for posting or updating as a PR comment.
 */

import type { AddonFinding } from "../handlers/addon-check.ts";
import type {
  AddonCheckClassificationMode,
  AddonCheckClassificationResult,
  AddonCheckReasonCode,
} from "./addon-check-classification.ts";

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

const INCOMPLETE_DIAGNOSTIC_MODES = new Set<AddonCheckClassificationMode>([
  "partial-timeout",
  "all-timeout",
  "mixed-incomplete",
  "tool-unavailable",
  "unknown-malformed-evidence",
]);

const SAFE_REASON_CODES = new Set<AddonCheckReasonCode>([
  "no-addons",
  "findings-present",
  "completed-clean",
  "partial-timeout",
  "all-timeout",
  "tool-unavailable",
  "mixed-incomplete",
  "malformed-summary",
  "negative-count",
  "unsafe-reason-code",
  "empty-reason-codes",
  "unbounded-reason-codes",
  "raw-canary-detected",
  "safe-degraded",
  "unknown-evidence",
]);

function boundedNonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.min(10_000, Math.floor(value))
    : 0;
}

function boundedTimeBudgetMs(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.min(3_600_000, Math.floor(value))
    : 0;
}

function safeMode(value: unknown): AddonCheckClassificationMode {
  return typeof value === "string" && INCOMPLETE_DIAGNOSTIC_MODES.has(value as AddonCheckClassificationMode)
    ? value as AddonCheckClassificationMode
    : "unknown-malformed-evidence";
}

function safeReasonCodes(value: unknown): AddonCheckReasonCode[] {
  if (!Array.isArray(value)) return ["unknown-evidence", "safe-degraded"];

  const reasons: AddonCheckReasonCode[] = [];
  for (const reason of value) {
    if (typeof reason !== "string") continue;
    if (!SAFE_REASON_CODES.has(reason as AddonCheckReasonCode)) continue;
    if (reasons.includes(reason as AddonCheckReasonCode)) continue;
    reasons.push(reason as AddonCheckReasonCode);
    if (reasons.length >= 8) break;
  }

  return reasons.length > 0 ? reasons : ["unknown-evidence", "safe-degraded"];
}

function shouldRenderIncompleteDiagnostic(classification: unknown): boolean {
  if (!classification || typeof classification !== "object") return false;
  const mode = (classification as { mode?: unknown }).mode;
  if (typeof mode !== "string") return true;
  return INCOMPLETE_DIAGNOSTIC_MODES.has(mode as AddonCheckClassificationMode);
}

function renderIncompleteDiagnostic(classification: unknown): string[] {
  const projection = classification as Partial<AddonCheckClassificationResult> | undefined;
  const counts = (projection?.counts ?? {}) as Partial<AddonCheckClassificationResult["counts"]>;
  const mode = safeMode(projection?.mode);
  const reasonCodes = safeReasonCodes(projection?.reasonCodes);
  const addonCount = boundedNonNegativeInteger(counts.addonCount);
  const completedCount = boundedNonNegativeInteger(counts.completedCount);
  const timedOutCount = boundedNonNegativeInteger(counts.timedOutCount);
  const toolNotFoundCount = boundedNonNegativeInteger(counts.toolNotFoundCount);
  const findingCount = boundedNonNegativeInteger(counts.findingCount);
  const timeBudgetMs = boundedTimeBudgetMs(counts.timeBudgetMs);

  return [
    "⚠️ **Addon check incomplete.** kodi-addon-checker did not complete for every changed addon, so this review may not include every addon-check finding.",
    "",
    `- Mode: \`${mode}\``,
    `- Reason codes: ${reasonCodes.map((reason) => `\`${reason}\``).join(", ")}`,
    `- Addons checked: ${completedCount}/${addonCount}; timed out: ${timedOutCount}; tool unavailable: ${toolNotFoundCount}.`,
    `- Findings reported from completed addons: ${findingCount}.`,
    `- Time budget: ${timeBudgetMs}ms per addon.`,
    "",
    "Raw checker output, workspace paths, GitHub payloads, and addon identifiers for skipped addons are omitted.",
  ];
}

/**
 * Render the full PR comment body for an addon-check run.
 *
 * Structure:
 *   - Marker on line 1 (for idempotent upsert detection)
 *   - ## Kodiai Addon Check heading
 *   - Optional bounded incomplete-check diagnostic for timeout/incomplete modes
 *   - Markdown table of ERROR and WARN findings (INFO filtered out)
 *   - Summary line: _X error(s), Y warning(s) found._
 *
 * If there are no ERROR or WARN findings and no incomplete diagnostic, emits a
 * clean-pass body instead.
 */
export function formatAddonCheckComment(
  findings: AddonFinding[],
  marker: string,
  classification?: AddonCheckClassificationResult,
): string {
  const relevant = findings.filter(
    (f) => f.level === "ERROR" || f.level === "WARN",
  );
  const renderDiagnostic = shouldRenderIncompleteDiagnostic(classification);

  const lines: string[] = [];
  lines.push(marker);
  lines.push("## Kodiai Addon Check");
  lines.push("");

  if (renderDiagnostic) {
    lines.push(...renderIncompleteDiagnostic(classification));
    lines.push("");
  }

  if (relevant.length === 0) {
    if (!renderDiagnostic) {
      lines.push("✅ No issues found by kodi-addon-checker.");
    }
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
