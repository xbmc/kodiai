/**
 * Thematic finding scoring against positive/negative cluster centroids.
 *
 * This module provides the ephemeral per-run scoring layer for M037:
 * given a set of draft findings and a cached cluster model, embed each
 * finding and compute suppression / confidence-boost signals based on
 * cosine similarity to positive and negative centroids.
 *
 * Key properties:
 * - Fail-open: any error (missing model, embedding failure) returns
 *   unmodified findings with no signals applied.
 * - No DB writes: this is a pure ephemeral scoring step. Durable state
 *   lives in the cluster model cache, not here.
 * - Safety guard: CRITICAL findings cannot be suppressed regardless of
 *   cluster signal (matches existing isFeedbackSuppressionProtected logic).
 * - CRITICAL findings also bypass confidence boosting (no positive boost
 *   for findings that should always be surfaced regardless of history).
 * - Conservative thresholds: 0.85 for suppression, 0.70 for boosting.
 * - Minimum centroid cluster members: 5 before participating in scoring.
 */

import type { Logger } from "pino";
import type { FindingSeverity, FindingCategory, EmbeddingProvider } from "./types.ts";
import type { SuggestionClusterModel } from "./suggestion-cluster-store.ts";
import { cosineSimilarity } from "./cluster-pipeline.ts";
import { isFeedbackSuppressionProtected } from "../feedback/safety-guard.ts";

// ── Constants ─────────────────────────────────────────────────────────

/**
 * Cosine similarity threshold for suppression (conservative).
 * A finding must score ≥ this against a negative centroid to be suppressed.
 */
export const SUPPRESSION_THRESHOLD = 0.85;

/**
 * Cosine similarity threshold for confidence boosting.
 * A finding must score ≥ this against a positive centroid to be boosted.
 */
export const BOOST_THRESHOLD = 0.70;

/**
 * Minimum number of members a centroid cluster must represent before it
 * participates in scoring. Centroids from small clusters are unreliable.
 */
export const MIN_CENTROID_MEMBERS_FOR_SCORING = 5;

/**
 * Confidence points added when a finding matches a positive centroid.
 * Applied before clamping to [0, 100].
 */
export const CONFIDENCE_BOOST_DELTA = 15;

// ── Types ─────────────────────────────────────────────────────────────

/**
 * A minimal finding shape accepted by the scoring function.
 * The caller may pass richer types — only these fields are required.
 */
export type ScoringFinding = {
  title: string;
  severity: FindingSeverity;
  category: FindingCategory;
  /** Base confidence score [0, 100]. Used for boost calculation. */
  confidence: number;
};

/**
 * Scoring result for a single finding.
 */
export type FindingScoreResult = {
  /** Should this finding be suppressed based on negative cluster signal? */
  suppress: boolean;

  /**
   * Adjusted confidence after applying positive cluster boost.
   * Equal to the input confidence when no boost applies.
   * Clamped to [0, 100].
   */
  adjustedConfidence: number;

  /**
   * Cosine similarity to the nearest negative centroid, or null when no
   * negative centroids were available or scored.
   */
  negativeScore: number | null;

  /**
   * Cosine similarity to the nearest positive centroid, or null when no
   * positive centroids were available or scored.
   */
  positiveScore: number | null;

  /** Reason a suppression was triggered, or null when not suppressed. */
  suppressionReason: string | null;
};

/**
 * Result of the full batch scoring call.
 */
export type ScoredFindings<T extends ScoringFinding> = {
  /**
   * Per-finding score results, in the same order as the input `findings`
   * array. Index alignment is guaranteed: scores[i] corresponds to
   * findings[i].
   */
  scores: FindingScoreResult[];

  /**
   * The findings array with inline score results merged in. Each element
   * is the original finding extended with its score.
   */
  findings: Array<T & FindingScoreResult>;

  /**
   * Whether the cluster model was available and used.
   * false = scoring was skipped (fail-open path).
   */
  modelUsed: boolean;

  /**
   * Total number of findings suppressed.
   */
  suppressedCount: number;

  /**
   * Total number of findings that received a confidence boost.
   */
  boostedCount: number;
};

// ── Centroid eligibility ──────────────────────────────────────────────

/**
 * Determine whether a cluster model has enough member coverage to be
 * trustworthy for scoring.
 *
 * A model is eligible if:
 * - It has at least one positive or negative centroid, AND
 * - The total member count across the relevant class is ≥ MIN_CENTROID_MEMBERS_FOR_SCORING.
 *
 * This is checked at model level (not per-centroid) because the builder
 * already enforces per-centroid minimums (MIN_CLUSTER_MEMBERS=3). The
 * per-class member count is the authoritative guard here.
 */
export function isModelEligibleForScoring(model: SuggestionClusterModel): boolean {
  const hasNegative =
    model.negativeCentroids.length > 0 &&
    model.negativeMemberCount >= MIN_CENTROID_MEMBERS_FOR_SCORING;
  const hasPositive =
    model.positiveCentroids.length > 0 &&
    model.positiveMemberCount >= MIN_CENTROID_MEMBERS_FOR_SCORING;
  return hasNegative || hasPositive;
}

// ── Core similarity ───────────────────────────────────────────────────

/**
 * Find the maximum cosine similarity between an embedding and a set of
 * centroids. Returns null when the centroids array is empty.
 */
export function maxSimilarityToCentroids(
  embedding: Float32Array,
  centroids: Float32Array[],
): number | null {
  if (centroids.length === 0) return null;
  let best = -Infinity;
  for (const centroid of centroids) {
    if (centroid.length === 0) continue;
    const sim = cosineSimilarity(embedding, centroid);
    if (sim > best) best = sim;
  }
  return best === -Infinity ? null : best;
}

// ── Single finding scorer ─────────────────────────────────────────────

/**
 * Score a single finding against a cluster model using a pre-computed
 * embedding. Returns the score result without any DB or embedding I/O.
 */
export function scoreFindingEmbedding(
  finding: ScoringFinding,
  embedding: Float32Array,
  model: SuggestionClusterModel,
): FindingScoreResult {
  const negativeScore = maxSimilarityToCentroids(embedding, model.negativeCentroids);
  const positiveScore = maxSimilarityToCentroids(embedding, model.positiveCentroids);

  // ── Suppression logic ─────────────────────────────────────────────
  let suppress = false;
  let suppressionReason: string | null = null;

  if (negativeScore !== null && negativeScore >= SUPPRESSION_THRESHOLD) {
    // Safety guard: CRITICAL findings cannot be suppressed
    if (isFeedbackSuppressionProtected({ severity: finding.severity, category: finding.category })) {
      suppress = false;
      suppressionReason = null;
    } else {
      suppress = true;
      suppressionReason = `cluster:negative:score=${negativeScore.toFixed(3)}`;
    }
  }

  // ── Boost logic ───────────────────────────────────────────────────
  let adjustedConfidence = finding.confidence;

  if (!suppress && positiveScore !== null && positiveScore >= BOOST_THRESHOLD) {
    // Safety guard: CRITICAL findings also bypass boosting (they should
    // always be surfaced at face value, not inflated by historical signal)
    if (!isFeedbackSuppressionProtected({ severity: finding.severity, category: finding.category })) {
      adjustedConfidence = Math.min(100, finding.confidence + CONFIDENCE_BOOST_DELTA);
    }
  }

  return {
    suppress,
    adjustedConfidence,
    negativeScore,
    positiveScore,
    suppressionReason,
  };
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Score a batch of draft findings against a cached cluster model.
 *
 * For each finding:
 * 1. Embed the finding title using the provided EmbeddingProvider.
 * 2. Compute cosine similarity to all negative centroids → suppression signal.
 * 3. Compute cosine similarity to all positive centroids → boost signal.
 * 4. Apply safety guard: CRITICAL findings cannot be suppressed or boosted.
 *
 * Fail-open behavior:
 * - `model` null/undefined → no scoring, original findings returned.
 * - `model` not eligible (insufficient members) → no scoring, skip logged.
 * - Embedding failure for an individual finding → that finding gets no signal.
 * - Any unexpected error → warn, return original findings.
 *
 * @param findings - Array of draft findings to score. Not mutated.
 * @param model - Cached cluster model, or null for fail-open.
 * @param embeddingProvider - Provider used to embed finding titles.
 * @param logger - Structured logger.
 * @returns ScoredFindings with per-item signals and merged finding objects.
 */
export async function scoreFindings<T extends ScoringFinding>(
  findings: T[],
  model: SuggestionClusterModel | null,
  embeddingProvider: EmbeddingProvider,
  logger: Logger,
): Promise<ScoredFindings<T>> {
  const noOpResult = (reason: string): ScoredFindings<T> => {
    logger.debug({ reason, findingCount: findings.length }, "Cluster scoring skipped (fail-open)");
    const emptyScore: FindingScoreResult = {
      suppress: false,
      adjustedConfidence: 0, // will be overridden below via finding.confidence
      negativeScore: null,
      positiveScore: null,
      suppressionReason: null,
    };
    const scores = findings.map((f): FindingScoreResult => ({
      ...emptyScore,
      adjustedConfidence: f.confidence,
    }));
    return {
      scores,
      findings: findings.map((f, i) => ({ ...f, ...scores[i]! })),
      modelUsed: false,
      suppressedCount: 0,
      boostedCount: 0,
    };
  };

  // ── Fail-open guards ──────────────────────────────────────────────
  if (!model) {
    return noOpResult("no cluster model available");
  }

  if (!isModelEligibleForScoring(model)) {
    logger.info(
      {
        repo: model.repo,
        positiveMemberCount: model.positiveMemberCount,
        negativeMemberCount: model.negativeMemberCount,
        positiveCentroidCount: model.positiveCentroids.length,
        negativeCentroidCount: model.negativeCentroids.length,
        minRequired: MIN_CENTROID_MEMBERS_FOR_SCORING,
      },
      "Cluster model ineligible for scoring (insufficient members); skipping",
    );
    return noOpResult("cluster model insufficient members");
  }

  if (findings.length === 0) {
    return {
      scores: [],
      findings: [],
      modelUsed: true,
      suppressedCount: 0,
      boostedCount: 0,
    };
  }

  try {
    const scores: FindingScoreResult[] = [];
    let suppressedCount = 0;
    let boostedCount = 0;

    for (const finding of findings) {
      // Embed the finding title as a query (not document) since we're
      // searching against stored centroids.
      let embeddingResult;
      try {
        embeddingResult = await embeddingProvider.generate(finding.title, "query");
      } catch (embErr) {
        logger.warn(
          { err: embErr, title: finding.title },
          "Embedding failed for finding; applying no cluster signal (fail-open)",
        );
        scores.push({
          suppress: false,
          adjustedConfidence: finding.confidence,
          negativeScore: null,
          positiveScore: null,
          suppressionReason: null,
        });
        continue;
      }

      if (!embeddingResult) {
        // Provider returned null — fail-open for this finding
        scores.push({
          suppress: false,
          adjustedConfidence: finding.confidence,
          negativeScore: null,
          positiveScore: null,
          suppressionReason: null,
        });
        continue;
      }

      const score = scoreFindingEmbedding(finding, embeddingResult.embedding, model);
      scores.push(score);

      if (score.suppress) suppressedCount++;
      if (score.adjustedConfidence > finding.confidence) boostedCount++;
    }

    logger.info(
      {
        repo: model.repo,
        findingCount: findings.length,
        suppressedCount,
        boostedCount,
        positiveCentroidCount: model.positiveCentroids.length,
        negativeCentroidCount: model.negativeCentroids.length,
      },
      "Cluster scoring complete",
    );

    return {
      scores,
      findings: findings.map((f, i) => ({ ...f, ...scores[i]! })),
      modelUsed: true,
      suppressedCount,
      boostedCount,
    };
  } catch (err) {
    logger.warn(
      { err, repo: model?.repo, findingCount: findings.length },
      "Cluster scoring error; returning findings unmodified (fail-open)",
    );
    return noOpResult("unexpected scoring error");
  }
}
