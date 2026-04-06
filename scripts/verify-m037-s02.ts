/**
 * M037 S02 proof harness: thematic finding scoring and review integration.
 *
 * Proves three properties without a live DB or embedding API:
 *
 *   M037-S02-SCORING-CHANGES-FINDINGS  — scoreFindings with a cluster model
 *     suppresses a finding that exceeds SUPPRESSION_THRESHOLD against the
 *     negative centroid, while the naive path (model=null) leaves it unsuppressed.
 *     Also proves that a finding above BOOST_THRESHOLD gains confidence.
 *
 *   M037-S02-SAFETY-GUARD-CRITICAL  — a CRITICAL-severity finding is never
 *     suppressed even when its embedding exceeds the suppression threshold,
 *     and is never boosted even when it exceeds the boost threshold.
 *
 *   M037-S02-FAIL-OPEN  — scoreFindings with model=null returns all findings
 *     unsuppressed, at their original confidence, with modelUsed=false.
 *
 * All checks run with pure-code stubs — no DB connection or embedding API required.
 * Embeddings are synthesized with controlled cosine similarity to make
 * threshold crossing deterministic.
 */

import type { Logger } from "pino";
import type { EmbeddingProvider } from "../src/knowledge/types.ts";
import {
  scoreFindings,
  scoreFindingEmbedding,
  isModelEligibleForScoring,
  SUPPRESSION_THRESHOLD,
  BOOST_THRESHOLD,
  CONFIDENCE_BOOST_DELTA,
  MIN_CENTROID_MEMBERS_FOR_SCORING,
  type ScoringFinding,
} from "../src/knowledge/suggestion-cluster-scoring.ts";
import {
  applyClusterScoreAdjustment,
} from "../src/feedback/confidence-adjuster.ts";
import type { SuggestionClusterModel } from "../src/knowledge/suggestion-cluster-store.ts";

// ── Check IDs ─────────────────────────────────────────────────────────

export const M037_S02_CHECK_IDS = [
  "M037-S02-SCORING-CHANGES-FINDINGS",
  "M037-S02-SAFETY-GUARD-CRITICAL",
  "M037-S02-FAIL-OPEN",
] as const;

export type M037S02CheckId = (typeof M037_S02_CHECK_IDS)[number];

export type Check = {
  id: M037S02CheckId;
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail?: string;
};

export type EvaluationReport = {
  check_ids: readonly string[];
  overallPassed: boolean;
  checks: Check[];
};

// ── Fixture types ─────────────────────────────────────────────────────

export type ScoringChangesFixtureResult = {
  /** Naive path: no model — was the matching finding suppressed? */
  naiveSuppressed: boolean;
  /** Scored path: with model — was the matching finding suppressed? */
  scoredSuppressed: boolean;
  /** Original confidence of the boost-candidate finding. */
  originalConfidence: number;
  /** Confidence after scoring (should be boosted). */
  scoredConfidence: number;
  /** Was the cluster model used in the scored path? */
  modelUsed: boolean;
};

export type SafetyGuardFixtureResult = {
  /** Was the CRITICAL finding suppressed despite exceeding threshold? */
  criticalSuppressed: boolean;
  /** Was the CRITICAL finding boosted despite exceeding boost threshold? */
  criticalBoosted: boolean;
  /** Negative score for the CRITICAL finding (should be >= SUPPRESSION_THRESHOLD). */
  criticalNegativeScore: number | null;
  /** Positive score for the CRITICAL finding (should be >= BOOST_THRESHOLD). */
  criticalPositiveScore: number | null;
};

export type FailOpenFixtureResult = {
  /** Was modelUsed=false for the null-model path? */
  modelUsed: boolean;
  /** All findings unsuppressed? */
  allUnsuppressed: boolean;
  /** All findings at original confidence? */
  confidenceUnchanged: boolean;
  /** Finding count matches input? */
  findingCount: number;
};

// ── Shared helpers ────────────────────────────────────────────────────

function createSilentLogger(): Logger {
  const logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    child: () => logger,
  };
  return logger as unknown as Logger;
}

/**
 * Build a unit-normalized embedding vector from a seed integer.
 * Pure function — deterministic output for the same seed and dim.
 */
function normalizedEmbedding(seed: number, dim = 8): Float32Array {
  let state = seed;
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
  const arr = new Float32Array(dim);
  for (let i = 0; i < dim; i++) arr[i] = next() * 2 - 1;
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += arr[i]! * arr[i]!;
  norm = Math.sqrt(norm);
  for (let i = 0; i < arr.length; i++) arr[i] = arr[i]! / norm;
  return arr;
}

/**
 * Build an embedding that is colinear with `base` (cosine similarity = 1.0).
 * Used to guarantee threshold crossing for suppression tests.
 */
function colinearEmbedding(base: Float32Array): Float32Array {
  // Same direction → cosine similarity = 1.0
  return new Float32Array(base);
}

/**
 * Build an embedding orthogonal to `base` (cosine similarity ≈ 0.0).
 * Used to build a centroid that is far from any finding embedding.
 */
function orthogonalEmbedding(base: Float32Array): Float32Array {
  // Gram-Schmidt: subtract the projection of e_0 onto base
  const result = new Float32Array(base.length);
  result[0] = 1.0; // start with e_0 = [1, 0, 0, ...]
  const dot = base[0]!; // dot(e_0, base) = base[0] since base is normalized
  for (let i = 0; i < base.length; i++) result[i] = result[i]! - dot * base[i]!;
  let norm = 0;
  for (let i = 0; i < result.length; i++) norm += result[i]! * result[i]!;
  norm = Math.sqrt(norm);
  if (norm < 1e-9) {
    // base was e_0 — use e_1 instead
    result[0] = 0;
    result[1] = 1;
    for (let i = 2; i < base.length; i++) result[i] = 0;
    return result;
  }
  for (let i = 0; i < result.length; i++) result[i] = result[i]! / norm;
  return result;
}

/**
 * Create a stub EmbeddingProvider that returns a fixed embedding for every call.
 */
function createFixedEmbeddingProvider(embedding: Float32Array): EmbeddingProvider {
  return {
    model: "stub",
    dimensions: embedding.length,
    generate: async (_text: string, _inputType: "query" | "document") => ({
      embedding,
      model: "stub",
      dimensions: embedding.length,
    }),
  };
}

/**
 * Create a SuggestionClusterModel with enough members to pass the eligibility guard.
 */
function createEligibleModel(opts: {
  positiveCentroids: Float32Array[];
  negativeCentroids: Float32Array[];
}): SuggestionClusterModel {
  return {
    id: 1,
    repo: "org/test-repo",
    positiveCentroids: opts.positiveCentroids,
    negativeCentroids: opts.negativeCentroids,
    memberCount: 20,
    positiveMemberCount: 10,
    negativeMemberCount: 10,
    builtAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// ── Fixture: SCORING-CHANGES-FINDINGS ─────────────────────────────────

/**
 * Fixture verifies two things:
 *
 * 1. Suppression: a finding whose embedding is colinear with the negative
 *    centroid (cosine sim = 1.0 >> SUPPRESSION_THRESHOLD=0.85) IS suppressed
 *    when model is present but NOT suppressed via the naive path (model=null).
 *
 * 2. Boosting: a finding whose embedding is colinear with the positive
 *    centroid gets its confidence boosted by CONFIDENCE_BOOST_DELTA.
 */
export async function runScoringChangesFixture(): Promise<ScoringChangesFixtureResult> {
  const logger = createSilentLogger();
  const dim = 8;

  // Two orthogonal bases for negative vs positive centroids
  const negBase = normalizedEmbedding(42, dim);
  const posBase = normalizedEmbedding(77, dim);

  const model = createEligibleModel({
    negativeCentroids: [colinearEmbedding(negBase)],
    positiveCentroids: [colinearEmbedding(posBase)],
  });

  // Finding that should be suppressed: colinear with negative centroid
  const suppressCandidate: ScoringFinding = {
    title: "Error handling missing in catch block",
    severity: "minor",
    category: "correctness",
    confidence: 60,
  };

  // Finding that should be boosted: colinear with positive centroid
  const boostCandidate: ScoringFinding = {
    title: "Add null check before dereferencing",
    severity: "minor",
    category: "correctness",
    confidence: 55,
  };

  // A third finding whose embedding is orthogonal to both centroids — unaffected
  const neutralBase = orthogonalEmbedding(negBase);
  const neutralCandidate: ScoringFinding = {
    title: "Unrelated style suggestion",
    severity: "minor",
    category: "style",
    confidence: 40,
  };

  // ── Naive path (no model) ─────────────────────────────────────────
  const naiveResult = await scoreFindings(
    [suppressCandidate],
    null,
    createFixedEmbeddingProvider(colinearEmbedding(negBase)),
    logger,
  );

  // ── Scored path ───────────────────────────────────────────────────
  // For the suppress candidate, embedding is colinear with negBase (sim=1.0)
  // Use sequential embeddings: first call → negBase (suppress candidate),
  // second call → posBase (boost candidate), third → neutral.
  const embeddingQueue: Float32Array[] = [
    colinearEmbedding(negBase),   // suppress candidate
    colinearEmbedding(posBase),   // boost candidate
    colinearEmbedding(neutralBase), // neutral candidate
  ];
  const queueDim = embeddingQueue[0]?.length ?? dim;
  let callIndex = 0;
  const sequentialProvider: EmbeddingProvider = {
    model: "stub",
    dimensions: queueDim,
    generate: async (_text: string, _inputType: "query" | "document") => {
      const emb = embeddingQueue[callIndex++];
      if (!emb) throw new Error("No more embeddings in queue");
      return { embedding: emb, model: "stub", dimensions: emb.length };
    },
  };

  const scoredResult = await scoreFindings(
    [suppressCandidate, boostCandidate, neutralCandidate],
    model,
    sequentialProvider,
    logger,
  );

  const suppressFinding = scoredResult.findings[0]!;
  const boostFinding = scoredResult.findings[1]!;

  return {
    naiveSuppressed: naiveResult.findings[0]!.suppress,
    scoredSuppressed: suppressFinding.suppress,
    originalConfidence: boostCandidate.confidence,
    scoredConfidence: boostFinding.adjustedConfidence,
    modelUsed: scoredResult.modelUsed,
  };
}

// ── Fixture: SAFETY-GUARD-CRITICAL ────────────────────────────────────

/**
 * Uses scoreFindingEmbedding() directly (pure sync, no embedding I/O) to
 * prove the safety guard fires on CRITICAL findings.
 *
 * The finding's embedding is colinear with both the negative centroid
 * (sim=1.0 >> suppression threshold) and the positive centroid
 * (sim=1.0 >> boost threshold). Despite this, a CRITICAL finding must
 * emerge with suppress=false and confidence unchanged.
 */
export async function runSafetyGuardFixture(): Promise<SafetyGuardFixtureResult> {
  const dim = 8;
  const negBase = normalizedEmbedding(13, dim);
  const posBase = normalizedEmbedding(17, dim);

  const model = createEligibleModel({
    negativeCentroids: [colinearEmbedding(negBase)],
    positiveCentroids: [colinearEmbedding(posBase)],
  });

  // For a CRITICAL finding, use an embedding that matches BOTH centroids
  // (sim=1.0 for negative, sim=1.0 for positive would require the same
  // vector, so we use separate runs — but the guard fires per finding, so
  // we use two separate findings both colinear to their respective centroids).

  const criticalNegativeFinding: ScoringFinding = {
    title: "SQL injection risk in query construction",
    severity: "critical",
    category: "security",
    confidence: 80,
  };

  const criticalPositiveFinding: ScoringFinding = {
    title: "Missing input validation on user-facing endpoint",
    severity: "critical",
    category: "security",
    confidence: 50,
  };

  // Score CRITICAL finding against a model where it would be suppressed
  const negResult = scoreFindingEmbedding(
    criticalNegativeFinding,
    colinearEmbedding(negBase),
    model,
  );

  // Score CRITICAL finding against a model where it would be boosted
  const posResult = scoreFindingEmbedding(
    criticalPositiveFinding,
    colinearEmbedding(posBase),
    model,
  );

  return {
    criticalSuppressed: negResult.suppress,
    criticalBoosted: posResult.adjustedConfidence > criticalPositiveFinding.confidence,
    criticalNegativeScore: negResult.negativeScore,
    criticalPositiveScore: posResult.positiveScore,
  };
}

// ── Fixture: FAIL-OPEN ────────────────────────────────────────────────

export async function runFailOpenFixture(): Promise<FailOpenFixtureResult> {
  const logger = createSilentLogger();
  const dim = 8;
  const base = normalizedEmbedding(99, dim);

  const findings: ScoringFinding[] = [
    { title: "Finding A", severity: "minor", category: "style", confidence: 70 },
    { title: "Finding B", severity: "major", category: "performance", confidence: 55 },
    { title: "Finding C", severity: "critical", category: "security", confidence: 90 },
  ];

  const result = await scoreFindings(
    findings,
    null, // no model → fail-open
    createFixedEmbeddingProvider(base),
    logger,
  );

  const allUnsuppressed = result.findings.every((f) => !f.suppress);
  const confidenceUnchanged = result.findings.every(
    (f, i) => f.adjustedConfidence === findings[i]!.confidence,
  );

  return {
    modelUsed: result.modelUsed,
    allUnsuppressed,
    confidenceUnchanged,
    findingCount: result.findings.length,
  };
}

// ── Check functions ───────────────────────────────────────────────────

export async function runScoringChangesCheck(
  _runFn?: () => Promise<ScoringChangesFixtureResult>,
): Promise<Check> {
  const result = await (_runFn ?? runScoringChangesFixture)();
  const problems: string[] = [];

  // Naive path must NOT suppress the finding
  if (result.naiveSuppressed) {
    problems.push("naive path (no model) suppressed finding — expected no suppression");
  }

  // Scored path MUST suppress the matching finding
  if (!result.scoredSuppressed) {
    problems.push("scored path did not suppress finding with sim>=SUPPRESSION_THRESHOLD");
  }

  // Model must have been used
  if (!result.modelUsed) {
    problems.push("modelUsed=false in scored path — model was not applied");
  }

  // Confidence must have been boosted
  const expectedConfidence = Math.min(100, result.originalConfidence + CONFIDENCE_BOOST_DELTA);
  if (result.scoredConfidence !== expectedConfidence) {
    problems.push(
      `boost candidate confidence=${result.scoredConfidence} expected ${expectedConfidence} (original=${result.originalConfidence}+${CONFIDENCE_BOOST_DELTA})`,
    );
  }

  if (problems.length === 0) {
    return {
      id: "M037-S02-SCORING-CHANGES-FINDINGS",
      passed: true,
      skipped: false,
      status_code: "scoring_suppressed_and_boosted",
      detail: `naiveSuppressed=${result.naiveSuppressed} scoredSuppressed=${result.scoredSuppressed} boostedConfidence=${result.scoredConfidence} originalConfidence=${result.originalConfidence}`,
    };
  }

  return {
    id: "M037-S02-SCORING-CHANGES-FINDINGS",
    passed: false,
    skipped: false,
    status_code: "scoring_mismatch",
    detail: problems.join("; "),
  };
}

export async function runSafetyGuardCheck(
  _runFn?: () => Promise<SafetyGuardFixtureResult>,
): Promise<Check> {
  const result = await (_runFn ?? runSafetyGuardFixture)();
  const problems: string[] = [];

  // Score must be >= suppression threshold to prove the guard fired
  if (result.criticalNegativeScore === null) {
    problems.push("criticalNegativeScore=null — negative centroid was not reached");
  } else if (result.criticalNegativeScore < SUPPRESSION_THRESHOLD) {
    problems.push(
      `criticalNegativeScore=${result.criticalNegativeScore.toFixed(3)} < SUPPRESSION_THRESHOLD=${SUPPRESSION_THRESHOLD} — guard condition not exercised`,
    );
  }

  // Score must be >= boost threshold to prove the boost guard fired
  if (result.criticalPositiveScore === null) {
    problems.push("criticalPositiveScore=null — positive centroid was not reached");
  } else if (result.criticalPositiveScore < BOOST_THRESHOLD) {
    problems.push(
      `criticalPositiveScore=${result.criticalPositiveScore.toFixed(3)} < BOOST_THRESHOLD=${BOOST_THRESHOLD} — guard condition not exercised`,
    );
  }

  // CRITICAL finding must NOT be suppressed
  if (result.criticalSuppressed) {
    problems.push("CRITICAL finding was suppressed — safety guard failed");
  }

  // CRITICAL finding must NOT be boosted
  if (result.criticalBoosted) {
    problems.push("CRITICAL finding confidence was boosted — safety guard failed");
  }

  if (problems.length === 0) {
    return {
      id: "M037-S02-SAFETY-GUARD-CRITICAL",
      passed: true,
      skipped: false,
      status_code: "critical_findings_protected",
      detail: `criticalNegativeScore=${result.criticalNegativeScore?.toFixed(3)} criticalPositiveScore=${result.criticalPositiveScore?.toFixed(3)} suppressed=${result.criticalSuppressed} boosted=${result.criticalBoosted}`,
    };
  }

  return {
    id: "M037-S02-SAFETY-GUARD-CRITICAL",
    passed: false,
    skipped: false,
    status_code: "safety_guard_failed",
    detail: problems.join("; "),
  };
}

export async function runFailOpenCheck(
  _runFn?: () => Promise<FailOpenFixtureResult>,
): Promise<Check> {
  const result = await (_runFn ?? runFailOpenFixture)();
  const problems: string[] = [];

  if (result.modelUsed) {
    problems.push("modelUsed=true for null model — fail-open did not fire");
  }

  if (!result.allUnsuppressed) {
    problems.push("some findings were suppressed in the fail-open path");
  }

  if (!result.confidenceUnchanged) {
    problems.push("finding confidence changed in the fail-open path — expected no change");
  }

  if (result.findingCount !== 3) {
    problems.push(`findingCount=${result.findingCount} expected 3`);
  }

  if (problems.length === 0) {
    return {
      id: "M037-S02-FAIL-OPEN",
      passed: true,
      skipped: false,
      status_code: "fail_open_preserved_all_findings",
      detail: `modelUsed=${result.modelUsed} allUnsuppressed=${result.allUnsuppressed} confidenceUnchanged=${result.confidenceUnchanged} findingCount=${result.findingCount}`,
    };
  }

  return {
    id: "M037-S02-FAIL-OPEN",
    passed: false,
    skipped: false,
    status_code: "fail_open_mutated_findings",
    detail: problems.join("; "),
  };
}

// ── Evaluation ────────────────────────────────────────────────────────

export async function evaluateM037S02(opts?: {
  _scoringChangesRunFn?: () => Promise<ScoringChangesFixtureResult>;
  _safetyGuardRunFn?: () => Promise<SafetyGuardFixtureResult>;
  _failOpenRunFn?: () => Promise<FailOpenFixtureResult>;
}): Promise<EvaluationReport> {
  const [scoringChanges, safetyGuard, failOpen] = await Promise.all([
    runScoringChangesCheck(opts?._scoringChangesRunFn),
    runSafetyGuardCheck(opts?._safetyGuardRunFn),
    runFailOpenCheck(opts?._failOpenRunFn),
  ]);

  const checks: Check[] = [scoringChanges, safetyGuard, failOpen];
  const overallPassed = checks
    .filter((c) => !c.skipped)
    .every((c) => c.passed);

  return {
    check_ids: M037_S02_CHECK_IDS,
    overallPassed,
    checks,
  };
}

// ── Rendering ─────────────────────────────────────────────────────────

function renderReport(report: EvaluationReport): string {
  const lines = [
    "M037 S02 proof harness",
    `Final verdict: ${report.overallPassed ? "PASS" : "FAIL"}`,
    "Checks:",
  ];

  for (const check of report.checks) {
    const verdict = check.skipped ? "SKIP" : check.passed ? "PASS" : "FAIL";
    const detail = check.detail ? ` ${check.detail}` : "";
    lines.push(`- ${check.id} ${verdict} status_code=${check.status_code}${detail}`);
  }

  return `${lines.join("\n")}\n`;
}

// ── Harness entry ─────────────────────────────────────────────────────

export async function buildM037S02ProofHarness(opts?: {
  _scoringChangesRunFn?: () => Promise<ScoringChangesFixtureResult>;
  _safetyGuardRunFn?: () => Promise<SafetyGuardFixtureResult>;
  _failOpenRunFn?: () => Promise<FailOpenFixtureResult>;
  stdout?: { write: (chunk: string) => void };
  stderr?: { write: (chunk: string) => void };
  json?: boolean;
}): Promise<{ exitCode: number }> {
  const stdout = opts?.stdout ?? process.stdout;
  const stderr = opts?.stderr ?? process.stderr;
  const useJson = opts?.json ?? false;

  const report = await evaluateM037S02({
    _scoringChangesRunFn: opts?._scoringChangesRunFn,
    _safetyGuardRunFn: opts?._safetyGuardRunFn,
    _failOpenRunFn: opts?._failOpenRunFn,
  });

  if (useJson) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    stdout.write(renderReport(report));
  }

  if (!report.overallPassed) {
    const failingCodes = report.checks
      .filter((c) => !c.passed && !c.skipped)
      .map((c) => `${c.id}:${c.status_code}`)
      .join(", ");
    stderr.write(`verify:m037:s02 failed: ${failingCodes}\n`);
  }

  return { exitCode: report.overallPassed ? 0 : 1 };
}

if (import.meta.main) {
  const useJson = process.argv.includes("--json");
  const { exitCode } = await buildM037S02ProofHarness({ json: useJson });
  process.exit(exitCode);
}
