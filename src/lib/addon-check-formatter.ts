import type { AddonFinding } from "../handlers/addon-check.ts";
import type {
  AddonCheckClassificationMode,
  AddonCheckClassificationResult,
} from "./addon-check-classification.ts";
import type {
  AddonRuleFinding,
  AddonRuleIncompleteReason,
  AddonRuleReviewComment,
} from "./addon-rule-types.ts";

export const ADDON_CHECK_MARKER_PREFIX = "kodiai:addon-check";
export const ADDON_REVIEW_REQUEST_MARKER_PREFIX = "kodiai:addon-review-request";

const INCOMPLETE_CHECKER_MODES = new Set<AddonCheckClassificationMode>([
  "partial-timeout",
  "all-timeout",
  "mixed-incomplete",
  "tool-unavailable",
  "unknown-malformed-evidence",
]);

export function buildAddonCheckMarker(owner: string, repo: string, prNumber: number): string {
  return `<!-- ${ADDON_CHECK_MARKER_PREFIX}:${owner}/${repo}:${prNumber} -->`;
}

export function buildAddonReviewRequestMarker(deliveryId: string): string {
  return `<!-- ${ADDON_REVIEW_REQUEST_MARKER_PREFIX}:${deliveryId} -->`;
}

export function formatAddonCheckComment(
  checkerFindings: AddonFinding[],
  marker: string,
  classification?: AddonCheckClassificationResult,
  addonRuleReview?: AddonRuleReviewComment,
): string {
  const findings = collectPublicFindings(checkerFindings, addonRuleReview?.findings ?? []);
  const checkerMode = classification && INCOMPLETE_CHECKER_MODES.has(classification.mode)
    ? classification.mode
    : undefined;
  const checkerIncomplete = checkerMode !== undefined;
  const reviewReasons = addonRuleReview?.incompleteReasons ?? [];
  const incomplete = checkerIncomplete || reviewReasons.length > 0;
  const errorCount = findings.filter((finding) => finding.level === "ERROR").length;
  const warningCount = findings.filter((finding) => finding.level === "WARN").length;

  const lines = [
    marker,
    "## Kodiai Add-on Review",
    "",
    "### Summary",
    "",
    boundedSummary(addonRuleReview?.summary),
  ];

  const caveat = renderIncompleteCaveat(checkerMode, reviewReasons);
  if (caveat) lines.push("", caveat);

  lines.push("", "### Findings", "");
  if (findings.length === 0) {
    lines.push("No addon-rule violations were found in the reviewed diff.");
  } else {
    for (const finding of findings) {
      const location = escapeInlineCode(finding.path ?? finding.addonId);
      lines.push(`- **${finding.level}** \`${location}\`: ${boundedMessage(finding.message)}`);
    }
  }

  lines.push("", "### Verdict", "");
  if (findings.length === 0) {
    lines.push(
      incomplete
        ? "No addon-rule violations found, but the review is incomplete. Final approval remains with a human reviewer."
        : "No addon-rule violations found. Final approval remains with a human reviewer.",
    );
  } else {
    lines.push(
      `Needs human review: ${errorCount} ${plural(errorCount, "error")} and ${warningCount} ${plural(warningCount, "warning")} found.${incomplete ? " The review is incomplete." : ""} Final approval remains with a human reviewer.`,
    );
  }

  return lines.join("\n");
}

type PublicFinding = Pick<AddonRuleFinding, "addonId" | "path" | "level" | "message">;

function collectPublicFindings(
  checkerFindings: readonly AddonFinding[],
  ruleFindings: readonly AddonRuleFinding[],
): PublicFinding[] {
  const relevant: PublicFinding[] = [];
  for (const finding of checkerFindings) {
    if (finding.level === "ERROR" || finding.level === "WARN") {
      relevant.push({
        addonId: finding.addonId,
        level: finding.level,
        message: finding.message,
      });
    }
  }
  relevant.push(...ruleFindings);

  const seen = new Set<string>();
  return relevant.filter((finding) => {
    const key = `${finding.addonId}|${finding.path ?? ""}|${finding.level}|${finding.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function boundedSummary(summary: string | undefined): string {
  const normalized = normalizeLine(summary ?? "Automated checks reviewed the changed add-on submission.");
  return normalized.slice(0, 600);
}

function boundedMessage(message: string): string {
  return normalizeLine(message).slice(0, 400);
}

function normalizeLine(value: string): string {
  return value.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
}

function escapeInlineCode(value: string): string {
  return normalizeLine(value).replace(/`/g, "\\`");
}

function plural(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}

function renderIncompleteCaveat(
  checkerMode: AddonCheckClassificationMode | undefined,
  reviewReasons: readonly AddonRuleIncompleteReason[],
): string | undefined {
  const clauses: string[] = [];
  if (checkerMode === "all-timeout" || checkerMode === "partial-timeout") {
    clauses.push("kodi-addon-checker timed out before checking every changed addon");
  } else if (checkerMode === "tool-unavailable") {
    clauses.push("kodi-addon-checker was unavailable");
  } else if (checkerMode) {
    clauses.push("kodi-addon-checker did not complete for every changed addon");
  }
  if (reviewReasons.includes("rules-fallback")) clauses.push("the live rules were unavailable");
  if (reviewReasons.includes("llm-incomplete")) clauses.push("the model-backed rule check was incomplete");
  if (reviewReasons.includes("patch-unavailable")) clauses.push("at least one changed patch was unavailable");
  if (reviewReasons.includes("patch-truncated")) clauses.push("at least one patch was truncated");
  if (reviewReasons.includes("checker-incomplete") && !checkerMode) {
    clauses.push("kodi-addon-checker did not complete");
  }
  if (clauses.length === 0) return undefined;
  return `⚠️ Review incomplete: ${joinClauses(clauses)}.`;
}

function joinClauses(clauses: readonly string[]): string {
  if (clauses.length === 1) return clauses[0]!;
  if (clauses.length === 2) return `${clauses[0]} and ${clauses[1]}`;
  return `${clauses.slice(0, -1).join(", ")}, and ${clauses.at(-1)}`;
}
