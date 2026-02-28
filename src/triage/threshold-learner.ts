import type { Sql } from "../db/client.ts";
import type { Logger } from "pino";

// ── Pure computation (no DB, no side effects) ────────────────────────────

export type OutcomeClassification = {
  correct: boolean;
  quadrant: "TP" | "FP" | "FN" | "TN";
};

/**
 * Classify a prediction outcome into the confusion matrix.
 * TP/TN = correct (alpha++), FP/FN = incorrect (beta++).
 */
export function classifyOutcome(
  kodiaiPredictedDuplicate: boolean,
  confirmedDuplicate: boolean,
): OutcomeClassification {
  if (kodiaiPredictedDuplicate && confirmedDuplicate) {
    return { correct: true, quadrant: "TP" };
  }
  if (kodiaiPredictedDuplicate && !confirmedDuplicate) {
    return { correct: false, quadrant: "FP" };
  }
  if (!kodiaiPredictedDuplicate && confirmedDuplicate) {
    return { correct: false, quadrant: "FN" };
  }
  return { correct: true, quadrant: "TN" };
}

/**
 * Posterior mean of the Beta distribution: alpha / (alpha + beta).
 * Represents the estimated probability that predictions are correct.
 */
export function posteriorMean(alpha: number, beta: number): number {
  return alpha / (alpha + beta);
}

/**
 * Convert Beta posterior to a similarity threshold in [floor, ceiling].
 *
 * High accuracy (mean near 1) -> lower threshold (catch more duplicates).
 * Low accuracy (mean near 0) -> higher threshold (be more selective).
 *
 * Formula: raw = 100 * (1 - mean), then clamp to [floor, ceiling].
 */
export function posteriorToThreshold(
  alpha: number,
  beta: number,
  floor: number,
  ceiling: number,
): number {
  const mean = posteriorMean(alpha, beta);
  const raw = Math.round(100 * (1 - mean));
  return Math.max(floor, Math.min(ceiling, raw));
}

// ── DB-boundary functions ────────────────────────────────────────────────

/**
 * Atomically record an observation into triage_threshold_state.
 * Uses UPSERT with SQL-side increment to avoid read-then-write race conditions.
 *
 * Only call when the outcome is relevant to duplicate detection accuracy:
 * - kodiaiPredictedDuplicate=true (TP or FP), OR
 * - confirmedDuplicate=true (TP or FN)
 * Skip pure TN (predicted=false, confirmed=false) to avoid drowning the signal.
 */
export async function recordObservation(params: {
  sql: Sql;
  repo: string;
  kodiaiPredictedDuplicate: boolean;
  confirmedDuplicate: boolean;
  logger: Logger;
}): Promise<void> {
  const { sql, repo, kodiaiPredictedDuplicate, confirmedDuplicate, logger } =
    params;

  // Skip pure TN -- no signal for duplicate detection tuning
  if (!kodiaiPredictedDuplicate && !confirmedDuplicate) {
    logger.debug(
      { repo },
      "Skipping TN observation for threshold learning (no signal)",
    );
    return;
  }

  const { correct, quadrant } = classifyOutcome(
    kodiaiPredictedDuplicate,
    confirmedDuplicate,
  );
  const alphaInc = correct ? 1 : 0;
  const betaInc = correct ? 0 : 1;

  await sql`
    INSERT INTO triage_threshold_state (repo, alpha, beta_, sample_count)
    VALUES (${repo}, ${1.0 + alphaInc}, ${1.0 + betaInc}, 1)
    ON CONFLICT (repo) DO UPDATE SET
      alpha = triage_threshold_state.alpha + ${alphaInc},
      beta_ = triage_threshold_state.beta_ + ${betaInc},
      sample_count = triage_threshold_state.sample_count + 1,
      updated_at = now()
  `;

  logger.info(
    { repo, quadrant, correct, alphaInc, betaInc },
    "Threshold learning observation recorded",
  );
}

export type EffectiveThresholdResult = {
  threshold: number;
  source: "learned" | "config";
  alpha?: number;
  beta?: number;
  sampleCount?: number;
};

/**
 * Resolve the effective duplicate detection threshold for a repo.
 *
 * Resolution chain:
 * 1. Query triage_threshold_state for this repo
 * 2. If no row or sample_count < minSamples (LEARN-02: 20), return configThreshold
 * 3. Compute from alpha/beta, clamp to [floor, ceiling] (LEARN-03: [50, 95])
 */
export async function getEffectiveThreshold(params: {
  sql: Sql;
  repo: string;
  configThreshold: number;
  minSamples?: number;
  floor?: number;
  ceiling?: number;
  logger: Logger;
}): Promise<EffectiveThresholdResult> {
  const {
    sql,
    repo,
    configThreshold,
    minSamples = 20,
    floor = 50,
    ceiling = 95,
    logger,
  } = params;

  const rows = await sql`
    SELECT alpha, beta_, sample_count
    FROM triage_threshold_state
    WHERE repo = ${repo}
  `;

  if (rows.length === 0 || (rows[0].sample_count as number) < minSamples) {
    return { threshold: configThreshold, source: "config" };
  }

  const alpha = rows[0].alpha as number;
  const beta = rows[0].beta_ as number;
  const sampleCount = rows[0].sample_count as number;
  const threshold = posteriorToThreshold(alpha, beta, floor, ceiling);

  logger.info(
    { repo, threshold, alpha, beta, sampleCount, source: "learned" },
    "Using learned threshold for duplicate detection",
  );

  return { threshold, source: "learned", alpha, beta, sampleCount };
}
