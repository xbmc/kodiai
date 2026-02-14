import type { FindingSeverity, FindingCategory } from "../knowledge/types.ts";

/**
 * Determines whether a finding pattern is protected from feedback-based
 * auto-suppression.
 *
 * Protected (returns true):
 *   - CRITICAL severity (any category) -- FEED-04
 *   - MAJOR severity with security or correctness category -- FEED-05
 *
 * All other combinations are NOT protected and may be auto-suppressed.
 */
export function isFeedbackSuppressionProtected(finding: {
  severity: FindingSeverity;
  category: FindingCategory;
}): boolean {
  if (finding.severity === "critical") return true;
  if (
    finding.severity === "major" &&
    (finding.category === "security" || finding.category === "correctness")
  ) {
    return true;
  }
  return false;
}
