import type { FindingSeverity } from "../knowledge/types.ts";
import { buildPrDiffCommentabilityIndex, type PrDiffCommentabilityIndex } from "../execution/formatter-suggestions.ts";

/**
 * Diff grounding: a cheap structural fact-check applied to high-severity
 * findings before publication.
 *
 * This does NOT verify that a finding's reasoning is semantically correct
 * (that would require an expensive, unreliable LLM re-check). It only
 * verifies that, for a file the collected diff *does* cover, the finding's
 * cited line actually falls within a diff hunk for that file -- i.e. the
 * citation is not a hallucinated line number. A cited line missing from an
 * otherwise-present file is a strong signal that the LLM fabricated (or
 * mis-transcribed) evidence, so critical/major findings are downgraded
 * rather than published at face value. Findings are never silently dropped
 * here -- see same-pr-fix-eligibility.ts for the analogous "never drop,
 * downgrade or flag instead" precedent.
 *
 * A cited file that is entirely absent from the collected diff is treated
 * as fail-open (not downgraded): findings can legitimately reference a file
 * outside this delivery's diff slice -- e.g. a previously-published finding
 * being re-run through enforcement during reconciliation, or a diff
 * collection scoped to only the incremental commits since the last review.
 * Only an in-diff file with an out-of-range line is unambiguous evidence of
 * a hallucinated citation.
 */

export type DiffGroundingReasonCode =
  | "not-applicable"
  | "no-diff-available"
  | "diff-truncated"
  | "file-not-in-diff"
  | "line-outside-diff"
  | "grounded";

export type DiffGroundingResult = {
  groundingChecked: boolean;
  groundingVerified: boolean;
  groundingDowngraded: boolean;
  groundingReason: DiffGroundingReasonCode;
  preGroundingSeverity?: FindingSeverity;
};

/** Severities whose file:line citation is expensive enough to warrant a grounding check. */
const GROUNDING_GATED_SEVERITIES: ReadonlySet<FindingSeverity> = new Set(["critical", "major"]);

/** Target severity when a citation cannot be located in the diff. */
export const DIFF_GROUNDING_DOWNGRADE_TARGET: FindingSeverity = "medium";

export type DiffGroundingFindingInput = {
  filePath: string;
  severity: FindingSeverity;
  startLine?: number;
  endLine?: number;
  [key: string]: unknown;
};

/**
 * Build the per-file set of diff-visible line numbers (right-hand side /
 * post-change numbering) used to ground finding citations. Thin wrapper
 * around the shared PR-diff commentability index so both the same-PR-fix
 * publication path and this enforcement gate stay in lockstep with a single
 * parser.
 */
export function buildDiffGroundingIndex(diffText: string | null | undefined): PrDiffCommentabilityIndex {
  return buildPrDiffCommentabilityIndex(diffText ?? "");
}

/**
 * Markers the diff collector appends when it hits its output cap
 * (review-diff-collection.ts). A truncated diff can cut off mid-file, leaving
 * that file present in the index with only its early hunks -- so a correct
 * citation to a later line looks identical to a hallucinated one. Detecting
 * truncation lets the gate fail open rather than demote real findings.
 */
const DIFF_TRUNCATION_MARKERS = [
  "[Full diff truncated at",
  "[GitHub patch fallback truncated]",
];

export function isDiffTruncated(diffText: string | null | undefined): boolean {
  if (!diffText) return false;
  return DIFF_TRUNCATION_MARKERS.some((marker) => diffText.includes(marker));
}

/**
 * Verify that critical/major findings cite a file:line that actually falls
 * within the collected diff's changed-line ranges. Findings below the
 * gated severities, findings without an explicit line citation, findings
 * whose cited file does not appear in the diff at all, and every finding
 * when no diff text was collected for this review (fail-open -- absence of
 * evidence is not evidence of hallucination) pass through unchanged.
 *
 * Pure function: no side effects, mirrors enforceSeverityFloors.
 */
export function enforceDiffGrounding<T extends DiffGroundingFindingInput>(params: {
  findings: T[];
  diffLineIndex: PrDiffCommentabilityIndex;
  diffTruncated?: boolean;
}): (T & DiffGroundingResult)[] {
  const { findings, diffLineIndex } = params;
  const diffAvailable = diffLineIndex.size > 0;

  return findings.map((finding) => {
    if (!GROUNDING_GATED_SEVERITIES.has(finding.severity)) {
      return passThrough(finding, "not-applicable");
    }

    const startLine = normalizeLine(finding.startLine);
    const endLine = normalizeLine(finding.endLine) ?? startLine;
    if (!startLine || !endLine) {
      // No explicit line citation to fact-check.
      return passThrough(finding, "not-applicable");
    }

    if (!diffAvailable) {
      return passThrough(finding, "no-diff-available");
    }

    if (params.diffTruncated) {
      // The collected diff hit its size cap and may have been cut mid-file, so
      // a missing line proves nothing about the citation. Fail open.
      return passThrough(finding, "diff-truncated");
    }

    const commentableLines = diffLineIndex.get(finding.filePath);
    if (!commentableLines) {
      // The file is entirely absent from this delivery's diff slice --
      // ambiguous (reconciliation of a pre-existing finding, incremental
      // diff scoping, etc.), not necessarily a hallucination. Fail open.
      return passThrough(finding, "file-not-in-diff");
    }

    // Intersection, not containment: a finding about a whole function
    // legitimately spans lines beyond the hunk that changed it (the rest being
    // unchanged context the diff never carried). Requiring *every* cited line
    // to be in the index would demote those as fabricated. One diff-visible
    // line in the cited range is enough to prove the citation is real.
    const lo = Math.min(startLine, endLine);
    const hi = Math.max(startLine, endLine);
    let intersectsDiff = false;
    for (let line = lo; line <= hi; line += 1) {
      if (commentableLines.has(line)) {
        intersectsDiff = true;
        break;
      }
    }
    if (!intersectsDiff) {
      return downgrade(finding, "line-outside-diff");
    }

    return {
      ...finding,
      groundingChecked: true,
      groundingVerified: true,
      groundingDowngraded: false,
      groundingReason: "grounded",
    };
  });
}

function passThrough<T extends DiffGroundingFindingInput>(
  finding: T,
  reason: DiffGroundingReasonCode,
): T & DiffGroundingResult {
  return {
    ...finding,
    groundingChecked: false,
    groundingVerified: true,
    groundingDowngraded: false,
    groundingReason: reason,
  };
}

function downgrade<T extends DiffGroundingFindingInput>(
  finding: T,
  reason: DiffGroundingReasonCode,
): T & DiffGroundingResult {
  return {
    ...finding,
    severity: DIFF_GROUNDING_DOWNGRADE_TARGET,
    preGroundingSeverity: finding.severity,
    groundingChecked: true,
    groundingVerified: false,
    groundingDowngraded: true,
    groundingReason: reason,
  };
}

function normalizeLine(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) return undefined;
  return Math.floor(value);
}
