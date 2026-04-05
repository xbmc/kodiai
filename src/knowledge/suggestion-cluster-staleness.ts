/**
 * Stale-model policy for cached cluster models.
 *
 * Cluster models expire after CLUSTER_MODEL_TTL_MS (24h). This module
 * applies a bounded grace period beyond expiry: stale models within
 * CLUSTER_MODEL_STALE_GRACE_MS of their expiry can still be used for
 * scoring, but a warning is emitted. Beyond the grace period, scoring
 * degrades gracefully to no-signal (fail-open).
 *
 * Staleness states:
 *   fresh       — not expired; normal use
 *   stale       — past expiresAt but within CLUSTER_MODEL_STALE_GRACE_MS;
 *                 model is used with a stale-use warning
 *   very-stale  — beyond grace period; degrade to no-scoring (null model)
 *   missing     — no model row in DB; degrade to no-scoring
 *
 * The primary export for scoring callers is `resolveModelForScoring`, which
 * wraps the store call, applies policy, and emits structured observability
 * signals for each outcome path.
 */

import type { Logger } from "pino";
import type { SuggestionClusterStore, SuggestionClusterModel } from "./suggestion-cluster-store.ts";
import { CLUSTER_MODEL_TTL_MS } from "./suggestion-cluster-store.ts";

// ── Constants ─────────────────────────────────────────────────────────

/**
 * How long after expiresAt a stale model is still usable for scoring.
 * Within this window, scoring proceeds with a stale-use warning.
 * Beyond this window, scoring degrades to no-signal (null model returned).
 *
 * Set to 4 hours — enough buffer for a delayed refresh job while still
 * bounding the age of stale signal that can influence reviews.
 */
export const CLUSTER_MODEL_STALE_GRACE_MS = 4 * 60 * 60 * 1000;

// ── Types ─────────────────────────────────────────────────────────────

/** Staleness classification for a cached cluster model. */
export type ModelStalenessStatus = "fresh" | "stale" | "very-stale" | "missing";

/** Result of evaluating a model against the staleness policy. */
export type ModelStalenessResult = {
  /** Staleness classification. */
  status: ModelStalenessStatus;
  /**
   * Age of the model in milliseconds since builtAt.
   * Null when status is "missing" (no model row exists).
   */
  modelAgeMs: number | null;
  /**
   * How many milliseconds past expiresAt the model is.
   * 0 when status is "fresh" (not yet expired).
   * Null when status is "missing".
   */
  expiredByMs: number | null;
};

/**
 * Result of resolveModelForScoring — the model to use (or null for
 * fail-open) plus the staleness classification and age signals.
 */
export type ResolveModelForScoringResult = {
  /**
   * The cluster model to pass to scoreFindings, or null when degrading
   * to no-signal (very-stale or missing paths).
   */
  model: SuggestionClusterModel | null;
  staleness: ModelStalenessResult;
};

// ── Pure evaluation ───────────────────────────────────────────────────

/**
 * Evaluate the staleness of a cluster model against the policy.
 *
 * Pure function — no I/O, no side effects. Accepts an optional nowMs
 * argument for testability (defaults to Date.now()).
 *
 * @param model - The model row, or null when no row exists.
 * @param nowMs - Current time in milliseconds (default: Date.now()).
 */
export function evaluateModelStaleness(
  model: SuggestionClusterModel | null,
  nowMs: number = Date.now(),
): ModelStalenessResult {
  if (!model) {
    return { status: "missing", modelAgeMs: null, expiredByMs: null };
  }

  const builtAtMs = new Date(model.builtAt).getTime();
  const expiresAtMs = new Date(model.expiresAt).getTime();
  const modelAgeMs = nowMs - builtAtMs;
  const expiredByMs = Math.max(0, nowMs - expiresAtMs);

  if (nowMs < expiresAtMs) {
    // Not yet expired
    return { status: "fresh", modelAgeMs, expiredByMs: 0 };
  }

  if (expiredByMs <= CLUSTER_MODEL_STALE_GRACE_MS) {
    // Within grace window — usable with warning
    return { status: "stale", modelAgeMs, expiredByMs };
  }

  // Beyond grace period — degrade to no-scoring
  return { status: "very-stale", modelAgeMs, expiredByMs };
}

// ── Store-coupled resolver ────────────────────────────────────────────

/**
 * Resolve the cluster model to use for scoring a given repo, applying
 * the staleness policy and emitting structured observability signals.
 *
 * Behaviour by staleness status:
 * - fresh:       Returns the model; logs info with modelAgeMs.
 * - stale:       Returns the model; logs warn with stale-use signal.
 * - very-stale:  Returns null (no-scoring); logs warn with no-model-fallback signal.
 * - missing:     Returns null (no-scoring); logs debug with no-model-fallback signal.
 *
 * The store call uses getModelIncludingStale so that stale rows are
 * visible for the grace-period path. getModel would hide them.
 *
 * @param repo         - Repository identifier.
 * @param store        - Cluster model store.
 * @param logger       - Structured logger (pino).
 * @param nowMs        - Current time override for testing (default: Date.now()).
 */
export async function resolveModelForScoring(
  repo: string,
  store: SuggestionClusterStore,
  logger: Logger,
  nowMs: number = Date.now(),
): Promise<ResolveModelForScoringResult> {
  let model: SuggestionClusterModel | null = null;

  try {
    model = await store.getModelIncludingStale(repo);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(
      { err: message, repo },
      "Cluster staleness: store read failed; degrading to no-scoring (fail-open)",
    );
    return {
      model: null,
      staleness: { status: "missing", modelAgeMs: null, expiredByMs: null },
    };
  }

  const staleness = evaluateModelStaleness(model, nowMs);

  switch (staleness.status) {
    case "fresh": {
      logger.info(
        {
          repo,
          modelAgeMs: staleness.modelAgeMs,
          expiresAt: model!.expiresAt,
          positiveCentroidCount: model!.positiveCentroids.length,
          negativeCentroidCount: model!.negativeCentroids.length,
        },
        "Cluster model fresh; using for scoring",
      );
      return { model, staleness };
    }

    case "stale": {
      logger.warn(
        {
          repo,
          modelAgeMs: staleness.modelAgeMs,
          expiredByMs: staleness.expiredByMs,
          gracePeriodMs: CLUSTER_MODEL_STALE_GRACE_MS,
          expiresAt: model!.expiresAt,
          staleUse: true,
        },
        "Cluster model stale but within grace period; using with stale-use warning",
      );
      return { model, staleness };
    }

    case "very-stale": {
      logger.warn(
        {
          repo,
          modelAgeMs: staleness.modelAgeMs,
          expiredByMs: staleness.expiredByMs,
          gracePeriodMs: CLUSTER_MODEL_STALE_GRACE_MS,
          expiresAt: model!.expiresAt,
          noModelFallback: true,
        },
        "Cluster model very stale (beyond grace period); degrading to no-scoring",
      );
      return { model: null, staleness };
    }

    case "missing": {
      logger.debug(
        { repo, noModelFallback: true },
        "No cluster model found for repo; scoring will be skipped",
      );
      return { model: null, staleness };
    }
  }
}

// ── Convenience helpers ───────────────────────────────────────────────

/**
 * Human-readable description of a staleness result for logs and summaries.
 * Exported primarily for testing and diagnostic scripts.
 */
export function formatStalenessDescription(result: ModelStalenessResult): string {
  const { status, modelAgeMs, expiredByMs } = result;
  const ageStr = modelAgeMs !== null ? `age=${(modelAgeMs / 1000 / 60).toFixed(1)}min` : "age=unknown";

  switch (status) {
    case "fresh":
      return `fresh (${ageStr})`;
    case "stale":
      return `stale (${ageStr}, expired by ${((expiredByMs ?? 0) / 1000 / 60).toFixed(1)}min)`;
    case "very-stale":
      return `very-stale (${ageStr}, expired by ${((expiredByMs ?? 0) / 1000 / 60).toFixed(1)}min, beyond grace period)`;
    case "missing":
      return "missing (no model row)";
  }
}

// Re-export TTL constant so callers only need to import from this module
// when they need both TTL and grace period for policy reasoning.
export { CLUSTER_MODEL_TTL_MS };
