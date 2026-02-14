import type { FeedbackPattern, FeedbackThresholds } from "./types.ts";
import type { KnowledgeStore } from "../knowledge/types.ts";

/**
 * Retrieve feedback patterns from the store and filter to only those
 * meeting ALL suppression threshold criteria.
 *
 * Returns suppression candidates (before safety guard filtering).
 */
export function aggregateSuppressiblePatterns(
  store: KnowledgeStore,
  repo: string,
  thresholds: FeedbackThresholds,
): FeedbackPattern[] {
  const patterns = store.aggregateFeedbackPatterns(repo);
  return patterns.filter(
    (p) =>
      p.thumbsDownCount >= thresholds.minThumbsDown &&
      p.distinctReactors >= thresholds.minDistinctReactors &&
      p.distinctPRs >= thresholds.minDistinctPRs,
  );
}
