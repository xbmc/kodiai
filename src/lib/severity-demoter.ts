import type { FindingSeverity } from "../knowledge/types.ts";
import type { FindingClaimClassification } from "./claim-classifier.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Input: a finding with severity and optional claim classification */
export type DemotableFinding = {
  severity: FindingSeverity;
  title: string;
  commentId: number;
  claimClassification?: FindingClaimClassification;
  [key: string]: unknown;
};

/** Output: finding with severity potentially overwritten and audit fields added */
export type DemotedFinding<T extends DemotableFinding> = T & {
  preDemotionSeverity?: FindingSeverity;
  severityDemoted?: boolean;
  demotionReason?: string;
};

type DemotionLogger = {
  info: (obj: Record<string, unknown>, msg: string) => void;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Severity levels eligible for demotion (above the cap) */
const DEMOTABLE_SEVERITIES: ReadonlySet<FindingSeverity> = new Set(["critical", "major"]);

/** Target severity after demotion */
const DEMOTION_CAP: FindingSeverity = "medium";

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Demote findings whose core claims depend on unverified external knowledge.
 *
 * Only findings with `summaryLabel === "primarily-external"` AND severity
 * above the cap (critical, major) are demoted to medium. All other findings
 * pass through unchanged. Missing/errored classification data is treated as
 * fail-open (no demotion).
 *
 * Returns new objects — inputs are never mutated.
 */
export function demoteExternalClaimSeverities<T extends DemotableFinding>(
  findings: T[],
  logger?: DemotionLogger,
): DemotedFinding<T>[] {
  return findings.map((finding) => {
    const summaryLabel = finding.claimClassification?.summaryLabel;

    // Fail-open: no classification or non-external label → pass through
    if (summaryLabel !== "primarily-external") {
      return { ...finding } as DemotedFinding<T>;
    }

    // Already at or below cap → no demotion needed
    if (!DEMOTABLE_SEVERITIES.has(finding.severity)) {
      return { ...finding } as DemotedFinding<T>;
    }

    // Build demotion reason from external-knowledge claim evidence
    const externalClaims = finding.claimClassification?.claims?.filter(
      (c) => c.label === "external-knowledge",
    ) ?? [];
    const evidenceStrings = externalClaims
      .map((c) => c.evidence)
      .filter(Boolean);
    const demotionReason = evidenceStrings.length > 0
      ? `External knowledge claims: ${evidenceStrings.join("; ")}`
      : "Finding primarily depends on unverified external knowledge";

    if (logger) {
      logger.info(
        {
          findingTitle: finding.title,
          originalSeverity: finding.severity,
          newSeverity: DEMOTION_CAP,
          reason: demotionReason,
          summaryLabel,
        },
        "Severity demoted: external knowledge claim",
      );
    }

    return {
      ...finding,
      severity: DEMOTION_CAP,
      preDemotionSeverity: finding.severity,
      severityDemoted: true,
      demotionReason,
    } as DemotedFinding<T>;
  });
}
