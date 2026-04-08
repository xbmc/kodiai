/**
 * Fail-open degradation wrapper for thematic cluster scoring.
 *
 * Consolidates the inline try/catch scoring block from review.ts into a
 * single function with explicit, observable degradation paths. Every
 * skip/error path emits a structured log entry with a typed reason code
 * so operational dashboards can distinguish "no model" from "scoring error".
 *
 * Degradation reasons (exhaustive):
 *   no-store            — clusterModelStore not configured (optional dep)
 *   no-embedding        — embeddingProvider not configured (optional dep)
 *   model-load-error    — staleness-aware store read failed unexpectedly
 *   no-model            — no usable cached model after staleness policy
 *   model-not-eligible  — model exists but insufficient centroid members
 *   scoring-error       — scoreFindings threw an unexpected error
 *   (absent)            — scoring ran successfully; degradationReason is null
 *
 * The function is generic over the finding type T so the caller's
 * processedFindings array is returned with its original shape preserved.
 */

import type { Logger } from "pino";
import type { FindingSeverity, FindingCategory, EmbeddingProvider } from "./types.ts";
import type { SuggestionClusterStore, SuggestionClusterModel } from "./suggestion-cluster-store.ts";
import { resolveModelForScoring } from "./suggestion-cluster-staleness.ts";
import { scoreFindings, isModelEligibleForScoring } from "./suggestion-cluster-scoring.ts";
import { applyClusterScoreAdjustment } from "../feedback/confidence-adjuster.ts";

// ── Types ─────────────────────────────────────────────────────────────

/**
 * Typed reason codes for all scoring skip paths.
 * null means scoring ran successfully (no degradation).
 */
export type ScoringDegradationReason =
  | "no-store"
  | "no-embedding"
  | "model-load-error"
  | "no-model"
  | "model-not-eligible"
  | "scoring-error";

/**
 * Shape of a finding that can be submitted to cluster scoring.
 * Callers may extend this with additional fields — only these are required
 * for scoring input. The original fields are preserved in the output.
 */
export type ClusterScoringFinding = {
  title: string;
  severity: FindingSeverity;
  category: FindingCategory;
  confidence: number;
  /** Whether the finding was already suppressed by an upstream gate. */
  suppressed?: boolean;
};

/**
 * Result of `applyClusterScoringWithDegradation`.
 */
export type ClusterScoringDegradationResult<T extends ClusterScoringFinding> = {
  /**
   * The findings array, possibly modified with cluster score adjustments.
   * On any degradation path, this is the input array returned unchanged.
   */
  findings: T[];

  /**
   * Whether the cluster model was loaded and scoring ran.
   * false on any degradation path.
   */
  modelUsed: boolean;

  /**
   * Number of findings suppressed by cluster signal. 0 on degradation.
   */
  suppressedCount: number;

  /**
   * Number of findings confidence-boosted by cluster signal. 0 on degradation.
   */
  boostedCount: number;

  /**
   * Reason scoring was skipped. null when scoring ran successfully.
   */
  degradationReason: ScoringDegradationReason | null;

  /**
   * The cluster model that was used for scoring, or null.
   * Useful for callers that need to log model metadata.
   */
  model: SuggestionClusterModel | null;
};

// ── No-op result builder ──────────────────────────────────────────────

function noOpResult<T extends ClusterScoringFinding>(
  findings: T[],
  reason: ScoringDegradationReason,
): ClusterScoringDegradationResult<T> {
  return {
    findings,
    modelUsed: false,
    suppressedCount: 0,
    boostedCount: 0,
    degradationReason: reason,
    model: null,
  };
}

// ── Main export ───────────────────────────────────────────────────────

/**
 * Apply thematic cluster scoring to a batch of findings with full
 * fail-open behavior and structured degradation observability.
 *
 * Safe to call unconditionally — never throws. On any error or missing
 * dependency, returns the input findings unchanged with a typed
 * `degradationReason` describing why scoring was skipped.
 *
 * Degradation paths:
 * 1. `no-store`           — clusterModelStore is null/undefined
 * 2. `no-embedding`       — embeddingProvider is null/undefined
 * 3. `model-load-error`   — staleness-aware model load failed (warn log)
 * 4. `no-model`           — no usable cached model after staleness policy (debug log)
 * 5. `model-not-eligible` — model has insufficient centroid members (info log)
 * 6. `scoring-error`      — scoreFindings rejected (warn log)
 *
 * @param findings          - Array of findings to score. Not mutated on degradation paths.
 * @param clusterModelStore - Optional cluster model store; null → no-store degradation.
 * @param embeddingProvider - Optional embedding provider; null → no-embedding degradation.
 * @param repo              - Repository identifier (e.g. "owner/repo").
 * @param logger            - Structured logger for degradation observability.
 * @returns ClusterScoringDegradationResult with findings and degradation metadata.
 */
export async function applyClusterScoringWithDegradation<T extends ClusterScoringFinding>(
  findings: T[],
  clusterModelStore: SuggestionClusterStore | null | undefined,
  embeddingProvider: EmbeddingProvider | null | undefined,
  repo: string,
  logger: Logger,
): Promise<ClusterScoringDegradationResult<T>> {
  // ── Dependency guards ─────────────────────────────────────────────
  if (!clusterModelStore) {
    logger.debug(
      { repo, degradationReason: "no-store" },
      "Cluster scoring skipped: no cluster model store configured",
    );
    return noOpResult(findings, "no-store");
  }

  if (!embeddingProvider) {
    logger.debug(
      { repo, degradationReason: "no-embedding" },
      "Cluster scoring skipped: no embedding provider configured",
    );
    return noOpResult(findings, "no-embedding");
  }

  // ── Model load + staleness policy ────────────────────────────────
  const resolvedModel = await resolveModelForScoring(repo, clusterModelStore, logger);

  if (resolvedModel.storeReadFailed) {
    logger.warn(
      { repo, gate: "cluster-model-load", degradationReason: "model-load-error" },
      "Cluster model load failed; proceeding without thematic scoring (fail-open)",
    );
    return noOpResult(findings, "model-load-error");
  }

  const model = resolvedModel.model;

  if (!model) {
    logger.debug(
      {
        repo,
        gate: "cluster-model-load",
        degradationReason: "no-model",
        stalenessStatus: resolvedModel.staleness.status,
      },
      "No usable cluster model found for repo; scoring will be skipped",
    );
    return noOpResult(findings, "no-model");
  }

  // ── Model eligibility guard ───────────────────────────────────────
  if (!isModelEligibleForScoring(model)) {
    logger.info(
      {
        repo,
        gate: "cluster-model-load",
        degradationReason: "model-not-eligible",
        positiveMemberCount: model.positiveMemberCount,
        negativeMemberCount: model.negativeMemberCount,
        positiveCentroidCount: model.positiveCentroids.length,
        negativeCentroidCount: model.negativeCentroids.length,
      },
      "Cluster model ineligible for scoring (insufficient members); skipping",
    );
    return noOpResult(findings, "model-not-eligible");
  }

  // Log successful model load
  logger.debug(
    {
      repo,
      gate: "cluster-model-load",
      positiveCentroidCount: model.positiveCentroids.length,
      negativeCentroidCount: model.negativeCentroids.length,
      positiveMemberCount: model.positiveMemberCount,
      negativeMemberCount: model.negativeMemberCount,
      builtAt: model.builtAt,
      stalenessStatus: resolvedModel.staleness.status,
    },
    "Cluster model loaded for thematic scoring",
  );

  // ── Scoring ───────────────────────────────────────────────────────
  try {
    const scoringInput = findings.map(f => ({
      title: f.title,
      severity: f.severity,
      category: f.category,
      confidence: f.confidence,
    }));

    const scoredResult = await scoreFindings(scoringInput, model, embeddingProvider, logger);

    if (!scoredResult.modelUsed) {
      // scoreFindings degraded internally (e.g. model not eligible)
      logger.debug(
        { repo, gate: "cluster-scoring", degradationReason: "model-not-eligible" },
        "scoreFindings returned modelUsed=false; cluster signal not applied",
      );
      return { ...noOpResult(findings, "model-not-eligible"), model };
    }

    // Apply cluster score adjustments to findings
    let suppressedCount = 0;
    let boostedCount = 0;

    const adjustedFindings = findings.map((f, i) => {
      const score = scoredResult.scores[i];
      if (!score) return f;

      // Skip already-suppressed findings — cluster cannot unsuppress
      if (f.suppressed) return f;

      const adj = applyClusterScoreAdjustment(
        { severity: f.severity, category: f.category },
        f.confidence,
        score.suppress,
        score.adjustedConfidence,
        true, // clusterModelUsed = true
        f.suppressed ?? false,
      );

      const didSuppress = adj.suppressed && !f.suppressed;
      const didBoost = adj.confidence > f.confidence;

      if (didSuppress) suppressedCount++;
      if (didBoost) boostedCount++;

      return { ...f, confidence: adj.confidence, suppressed: adj.suppressed };
    });

    if (suppressedCount > 0 || boostedCount > 0) {
      logger.info(
        {
          repo,
          gate: "cluster-scoring",
          findingCount: findings.length,
          clusterSuppressedCount: suppressedCount,
          clusterBoostedCount: boostedCount,
          clusterScoreSource: "suggestion_cluster_models",
        },
        "Thematic cluster scoring applied to review findings",
      );
    }

    return {
      findings: adjustedFindings,
      modelUsed: true,
      suppressedCount,
      boostedCount,
      degradationReason: null,
      model,
    };
  } catch (err) {
    logger.warn(
      { repo, err, gate: "cluster-scoring", degradationReason: "scoring-error" },
      "Thematic cluster scoring failed; findings unchanged (fail-open)",
    );
    return { ...noOpResult(findings, "scoring-error"), model };
  }
}
