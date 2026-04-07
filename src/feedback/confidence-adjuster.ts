import { isFeedbackSuppressionProtected } from "./safety-guard.ts";
import type { FindingSeverity, FindingCategory } from "../knowledge/types.ts";

/**
 * Adjust a base confidence score based on user feedback reactions.
 *
 * Formula: baseConfidence + (thumbsUp * 10) - (thumbsDown * 20)
 * Result is clamped to [0, 100].
 */
export function adjustConfidenceForFeedback(
  baseConfidence: number,
  feedback: { thumbsUp: number; thumbsDown: number },
): number {
  const adjusted =
    baseConfidence + feedback.thumbsUp * 10 - feedback.thumbsDown * 20;
  return Math.max(0, Math.min(100, adjusted));
}

/**
 * Apply thematic cluster score signals to a finding's confidence and suppression state.
 *
 * This merges the cluster-derived suppression and confidence adjustment into the
 * finding's existing confidence value (already adjusted for feedback) and the
 * finding's suppression state.
 *
 * Rules:
 * - If clusterSuppress is true AND the finding is not safety-protected, the finding
 *   is marked suppressed.
 * - If clusterAdjustedConfidence > baseConfidence AND the finding is not
 *   safety-protected, the adjusted confidence is used.
 * - Safety-protected findings (CRITICAL, MAJOR security/correctness) are never
 *   suppressed or boosted by cluster signal — they pass through unchanged.
 * - If clusterModelUsed is false, the function is a no-op (returns input unchanged).
 *
 * @param finding - The finding shape (title not needed; only severity and category).
 * @param baseConfidence - Current confidence after feedback adjustment.
 * @param clusterSuppress - Suppression signal from scoreFindings().
 * @param clusterAdjustedConfidence - Cluster-boosted confidence from scoreFindings().
 * @param clusterModelUsed - Whether the cluster model was active (fail-open guard).
 * @param baseSuppressed - Existing suppression state from earlier pipeline stages.
 * @returns { confidence, suppressed } — final values after cluster adjustment.
 */
export function applyClusterScoreAdjustment(
  finding: { severity: FindingSeverity; category: FindingCategory },
  baseConfidence: number,
  clusterSuppress: boolean,
  clusterAdjustedConfidence: number,
  clusterModelUsed: boolean,
  baseSuppressed = false,
): { confidence: number; suppressed: boolean } {
  // Fail-open: if model was not used, preserve upstream state unchanged.
  if (!clusterModelUsed) {
    return { confidence: baseConfidence, suppressed: baseSuppressed };
  }

  // Safety-protected findings bypass all cluster signal but preserve upstream suppression.
  if (isFeedbackSuppressionProtected(finding)) {
    return { confidence: baseConfidence, suppressed: baseSuppressed };
  }

  // Apply suppression signal, merging with upstream state.
  if (clusterSuppress) {
    return { confidence: baseConfidence, suppressed: true };
  }

  // Apply confidence boost (already computed by scoreFindingEmbedding with clamp)
  const confidence =
    clusterAdjustedConfidence > baseConfidence
      ? clusterAdjustedConfidence
      : baseConfidence;

  return { confidence, suppressed: baseSuppressed };
}
