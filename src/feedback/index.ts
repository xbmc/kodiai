import type { Logger } from "pino";
import type { KnowledgeStore } from "../knowledge/types.ts";
import type {
  FeedbackSuppressionConfig,
  FeedbackSuppressionResult,
} from "./types.ts";
import { aggregateSuppressiblePatterns } from "./aggregator.ts";
import { isFeedbackSuppressionProtected } from "./safety-guard.ts";
import { adjustConfidenceForFeedback } from "./confidence-adjuster.ts";

// Re-export all types
export type {
  FeedbackPattern,
  FeedbackThresholds,
  FeedbackSuppressionResult,
  FeedbackSuppressionConfig,
} from "./types.ts";

// Re-export functions
export { aggregateSuppressiblePatterns } from "./aggregator.ts";
export { isFeedbackSuppressionProtected } from "./safety-guard.ts";
export { adjustConfidenceForFeedback } from "./confidence-adjuster.ts";

const EMPTY_RESULT: FeedbackSuppressionResult = {
  suppressedFingerprints: new Set<string>(),
  suppressedPatternCount: 0,
  patterns: [],
};

/**
 * Orchestrator: evaluate which finding patterns should be auto-suppressed
 * based on accumulated user feedback.
 *
 * 1. Early-returns empty result if config.enabled is false
 * 2. Aggregates patterns meeting threshold criteria from the store
 * 3. Filters out safety-protected patterns (CRITICAL, MAJOR security/correctness)
 * 4. Returns suppression set with fingerprints and count
 * 5. Fail-open: on any error, logs warning and returns empty result
 */
export function evaluateFeedbackSuppressions(params: {
  store: KnowledgeStore;
  repo: string;
  config: FeedbackSuppressionConfig;
  logger: Logger;
}): FeedbackSuppressionResult {
  const { store, repo, config, logger } = params;

  if (!config.enabled) {
    return EMPTY_RESULT;
  }

  try {
    const candidates = aggregateSuppressiblePatterns(
      store,
      repo,
      config.thresholds,
    );

    const suppressable = candidates.filter(
      (p) => !isFeedbackSuppressionProtected(p),
    );

    const fingerprints = new Set(suppressable.map((p) => p.fingerprint));

    return {
      suppressedFingerprints: fingerprints,
      suppressedPatternCount: suppressable.length,
      patterns: suppressable,
    };
  } catch (err) {
    logger.warn(
      { err, repo },
      "Failed to evaluate feedback suppressions, returning empty result (fail-open)",
    );
    return EMPTY_RESULT;
  }
}
