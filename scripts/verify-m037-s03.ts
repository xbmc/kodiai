/**
 * M037 S03 proof harness: cache reuse, stale-model policy, refresh, and
 * fail-open review scoring behavior.
 *
 * Proves four properties without a live DB or embedding API:
 *
 *   M037-S03-CACHE-REUSE — the live cluster-scoring wrapper reuses a cached
 *     fresh model via the staleness-aware loader (`getModelIncludingStale`),
 *     applies cluster signal, and does not fall back to the strict fresh-only
 *     `getModel` path.
 *
 *   M037-S03-STALE-GRACE-POLICY — a model within the stale grace window is
 *     still usable for scoring, while a very-stale model degrades cleanly to
 *     `no-model` and preserves the fail-open path.
 *
 *   M037-S03-REFRESH-SWEEP — the background refresh sweep processes expired
 *     repos and returns stable aggregate totals for built vs skipped models.
 *
 *   M037-S03-FAIL-OPEN-NAIVE — when the cluster layer is unavailable, review
 *     scoring falls back to the naive path: findings remain unsuppressed,
 *     confidence is unchanged, and the function resolves with modelUsed=false.
 */

import type { Logger } from "pino";
import type { Sql } from "../src/db/client.ts";
import type { EmbeddingProvider, EmbeddingResult } from "../src/knowledge/types.ts";
import {
  applyClusterScoringWithDegradation,
  type ClusterScoringFinding,
  type ScoringDegradationReason,
} from "../src/knowledge/suggestion-cluster-degradation.ts";
import {
  createClusterRefresh,
  type ClusterRefreshResult,
} from "../src/knowledge/suggestion-cluster-refresh.ts";
import {
  CLUSTER_MODEL_STALE_GRACE_MS,
  formatStalenessDescription,
  resolveModelForScoring,
} from "../src/knowledge/suggestion-cluster-staleness.ts";
import type {
  SuggestionClusterModel,
  SuggestionClusterStore,
} from "../src/knowledge/suggestion-cluster-store.ts";

// ── Check IDs ─────────────────────────────────────────────────────────

export const M037_S03_CHECK_IDS = [
  "M037-S03-CACHE-REUSE",
  "M037-S03-STALE-GRACE-POLICY",
  "M037-S03-REFRESH-SWEEP",
  "M037-S03-FAIL-OPEN-NAIVE",
] as const;

export type M037S03CheckId = (typeof M037_S03_CHECK_IDS)[number];

export type Check = {
  id: M037S03CheckId;
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

export type CacheReuseFixtureResult = {
  modelUsed: boolean;
  degradationReason: ScoringDegradationReason | null;
  suppressedCount: number;
  getModelIncludingStaleCalls: number;
  getModelCalls: number;
};

export type StaleGraceFixtureResult = {
  staleStatus: string;
  staleDescription: string;
  staleModelUsed: boolean;
  staleSuppressed: boolean;
  veryStaleStatus: string;
  veryStaleDescription: string;
  veryStaleModelUsed: boolean;
  veryStaleDegradationReason: ScoringDegradationReason | null;
};

export type RefreshSweepFixtureResult = {
  result: ClusterRefreshResult;
};

export type FailOpenNaiveFixtureResult = {
  modelUsed: boolean;
  degradationReason: ScoringDegradationReason | null;
  allUnsuppressed: boolean;
  confidenceUnchanged: boolean;
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

function createNoopSql(): Sql {
  return (() => Promise.resolve([])) as unknown as Sql;
}

function fa(nums: number[]): Float32Array {
  return new Float32Array(nums);
}

const HIGH_SIM_CENTROID = fa([1, 0, 0, 0]);

function makeModel(overrides: Partial<SuggestionClusterModel> = {}): SuggestionClusterModel {
  const now = Date.now();
  const builtAt = new Date(now - 60_000).toISOString();
  const expiresAt = new Date(now + 24 * 60 * 60 * 1000).toISOString();

  return {
    id: 1,
    repo: "owner/repo",
    positiveCentroids: [],
    negativeCentroids: [HIGH_SIM_CENTROID],
    memberCount: 10,
    positiveMemberCount: 0,
    negativeMemberCount: 10,
    builtAt,
    expiresAt,
    createdAt: builtAt,
    updatedAt: builtAt,
    ...overrides,
  };
}

function makeExpiredModel(expiredByMs: number): SuggestionClusterModel {
  const expiresAt = new Date(Date.now() - expiredByMs);
  const builtAt = new Date(expiresAt.getTime() - 24 * 60 * 60 * 1000);
  return makeModel({
    builtAt: builtAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });
}

function makeFindings(): ClusterScoringFinding[] {
  return [
    {
      title: "Missing semicolon in output formatter",
      severity: "medium",
      category: "style",
      confidence: 55,
      suppressed: false,
    },
    {
      title: "Neutral finding",
      severity: "minor",
      category: "style",
      confidence: 40,
      suppressed: false,
    },
  ];
}

function makeEmbeddingProvider(vector: Float32Array): EmbeddingProvider {
  return {
    generate: async (): Promise<EmbeddingResult> => ({
      embedding: vector,
      model: "stub",
      dimensions: vector.length,
    }),
    model: "stub",
    dimensions: vector.length,
  } as unknown as EmbeddingProvider;
}

function makeCountingStore(model: SuggestionClusterModel | null): SuggestionClusterStore & {
  counts: { getModel: number; getModelIncludingStale: number };
} {
  const counts = { getModel: 0, getModelIncludingStale: 0 };

  const store: SuggestionClusterStore & {
    counts: { getModel: number; getModelIncludingStale: number };
  } = {
    counts,
    getModel: async () => {
      counts.getModel++;
      return model;
    },
    getModelIncludingStale: async () => {
      counts.getModelIncludingStale++;
      return model;
    },
    saveModel: async () => model ?? makeModel(),
    deleteModel: async () => {},
    listExpiredModelRepos: async () => [],
  };

  return store;
}

// ── Fixture: CACHE-REUSE ──────────────────────────────────────────────

export async function runCacheReuseFixture(): Promise<CacheReuseFixtureResult> {
  const logger = createSilentLogger();
  const store = makeCountingStore(makeModel());
  const result = await applyClusterScoringWithDegradation(
    [makeFindings()[0]!],
    store,
    makeEmbeddingProvider(HIGH_SIM_CENTROID),
    "owner/repo",
    logger,
  );

  return {
    modelUsed: result.modelUsed,
    degradationReason: result.degradationReason,
    suppressedCount: result.suppressedCount,
    getModelIncludingStaleCalls: store.counts.getModelIncludingStale,
    getModelCalls: store.counts.getModel,
  };
}

// ── Fixture: STALE-GRACE-POLICY ───────────────────────────────────────

export async function runStaleGraceFixture(): Promise<StaleGraceFixtureResult> {
  const logger = createSilentLogger();

  const staleStore = makeCountingStore(makeExpiredModel(60_000));
  const staleResolved = await resolveModelForScoring("owner/repo", staleStore, logger);
  const staleScored = await applyClusterScoringWithDegradation(
    [makeFindings()[0]!],
    staleStore,
    makeEmbeddingProvider(HIGH_SIM_CENTROID),
    "owner/repo",
    logger,
  );

  const veryStaleStore = makeCountingStore(
    makeExpiredModel(CLUSTER_MODEL_STALE_GRACE_MS + 60_000),
  );
  const veryStaleResolved = await resolveModelForScoring("owner/repo", veryStaleStore, logger);
  const veryStaleScored = await applyClusterScoringWithDegradation(
    [makeFindings()[0]!],
    veryStaleStore,
    makeEmbeddingProvider(HIGH_SIM_CENTROID),
    "owner/repo",
    logger,
  );

  return {
    staleStatus: staleResolved.staleness.status,
    staleDescription: formatStalenessDescription(staleResolved.staleness),
    staleModelUsed: staleScored.modelUsed,
    staleSuppressed: staleScored.findings[0]?.suppressed === true,
    veryStaleStatus: veryStaleResolved.staleness.status,
    veryStaleDescription: formatStalenessDescription(veryStaleResolved.staleness),
    veryStaleModelUsed: veryStaleScored.modelUsed,
    veryStaleDegradationReason: veryStaleScored.degradationReason,
  };
}

// ── Fixture: REFRESH-SWEEP ────────────────────────────────────────────

export async function runRefreshSweepFixture(): Promise<RefreshSweepFixtureResult> {
  const logger = createSilentLogger();

  const store: SuggestionClusterStore = {
    getModel: async () => null,
    getModelIncludingStale: async () => null,
    saveModel: async (payload) => ({
      id: 1,
      repo: payload.repo,
      positiveCentroids: payload.positiveCentroids,
      negativeCentroids: payload.negativeCentroids,
      memberCount: payload.memberCount,
      positiveMemberCount: payload.positiveMemberCount,
      negativeMemberCount: payload.negativeMemberCount,
      builtAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    deleteModel: async () => {},
    listExpiredModelRepos: async () => ["owner/repo-a", "owner/repo-b"],
  };

  const refresh = createClusterRefresh({
    sql: createNoopSql(),
    store,
    logger,
    _buildFn: async ({ repo }) => {
      if (repo === "owner/repo-b") {
        return {
          repo,
          built: false,
          skipReason: "insufficient-learning-memories",
          model: null,
          positiveCentroidCount: 0,
          negativeCentroidCount: 0,
          positiveMemberCount: 2,
          negativeMemberCount: 1,
          skippedClusters: 0,
        };
      }

      return {
        repo,
        built: true,
        model: null,
        positiveCentroidCount: 2,
        negativeCentroidCount: 1,
        positiveMemberCount: 8,
        negativeMemberCount: 5,
        skippedClusters: 0,
      };
    },
  });

  return { result: await refresh.run() };
}

// ── Fixture: FAIL-OPEN-NAIVE ──────────────────────────────────────────

export async function runFailOpenNaiveFixture(): Promise<FailOpenNaiveFixtureResult> {
  const logger = createSilentLogger();
  const findings = makeFindings();

  const result = await applyClusterScoringWithDegradation(
    findings,
    null,
    makeEmbeddingProvider(HIGH_SIM_CENTROID),
    "owner/repo",
    logger,
  );

  return {
    modelUsed: result.modelUsed,
    degradationReason: result.degradationReason,
    allUnsuppressed: result.findings.every((f) => !f.suppressed),
    confidenceUnchanged: result.findings.every(
      (f, i) => f.confidence === findings[i]!.confidence,
    ),
    findingCount: result.findings.length,
  };
}

// ── Check functions ───────────────────────────────────────────────────

export async function runCacheReuseCheck(
  _runFn?: () => Promise<CacheReuseFixtureResult>,
): Promise<Check> {
  const result = await (_runFn ?? runCacheReuseFixture)();
  const problems: string[] = [];

  if (!result.modelUsed) problems.push("modelUsed=false expected true");
  if (result.degradationReason !== null) {
    problems.push(`degradationReason=${result.degradationReason} expected null`);
  }
  if (result.suppressedCount !== 1) {
    problems.push(`suppressedCount=${result.suppressedCount} expected 1`);
  }
  if (result.getModelIncludingStaleCalls !== 1) {
    problems.push(`getModelIncludingStaleCalls=${result.getModelIncludingStaleCalls} expected 1`);
  }
  if (result.getModelCalls !== 0) {
    problems.push(`getModelCalls=${result.getModelCalls} expected 0`);
  }

  if (problems.length === 0) {
    return {
      id: "M037-S03-CACHE-REUSE",
      passed: true,
      skipped: false,
      status_code: "cached_model_reused_via_staleness_loader",
      detail: `modelUsed=${result.modelUsed} suppressedCount=${result.suppressedCount} getModelIncludingStaleCalls=${result.getModelIncludingStaleCalls} getModelCalls=${result.getModelCalls}`,
    };
  }

  return {
    id: "M037-S03-CACHE-REUSE",
    passed: false,
    skipped: false,
    status_code: "cache_reuse_mismatch",
    detail: problems.join("; "),
  };
}

export async function runStaleGraceCheck(
  _runFn?: () => Promise<StaleGraceFixtureResult>,
): Promise<Check> {
  const result = await (_runFn ?? runStaleGraceFixture)();
  const problems: string[] = [];

  if (result.staleStatus !== "stale") {
    problems.push(`staleStatus=${result.staleStatus} expected stale`);
  }
  if (!result.staleModelUsed) {
    problems.push("stale model was not used within grace window");
  }
  if (!result.staleSuppressed) {
    problems.push("stale model did not apply cluster scoring inside grace window");
  }
  if (result.veryStaleStatus !== "very-stale") {
    problems.push(`veryStaleStatus=${result.veryStaleStatus} expected very-stale`);
  }
  if (result.veryStaleModelUsed) {
    problems.push("very-stale model was used — expected fail-open skip");
  }
  if (result.veryStaleDegradationReason !== "no-model") {
    problems.push(`veryStaleDegradationReason=${result.veryStaleDegradationReason} expected no-model`);
  }

  if (problems.length === 0) {
    return {
      id: "M037-S03-STALE-GRACE-POLICY",
      passed: true,
      skipped: false,
      status_code: "stale_window_respected",
      detail: `stale=${result.staleDescription}; veryStale=${result.veryStaleDescription}; veryStaleDegradationReason=${result.veryStaleDegradationReason}`,
    };
  }

  return {
    id: "M037-S03-STALE-GRACE-POLICY",
    passed: false,
    skipped: false,
    status_code: "stale_policy_mismatch",
    detail: problems.join("; "),
  };
}

export async function runRefreshSweepCheck(
  _runFn?: () => Promise<RefreshSweepFixtureResult>,
): Promise<Check> {
  const { result } = await (_runFn ?? runRefreshSweepFixture)();
  const problems: string[] = [];

  if (result.repoCount !== 2) problems.push(`repoCount=${result.repoCount} expected 2`);
  if (result.reposBuilt !== 1) problems.push(`reposBuilt=${result.reposBuilt} expected 1`);
  if (result.reposSkipped !== 1) problems.push(`reposSkipped=${result.reposSkipped} expected 1`);
  if (result.reposFailed !== 0) problems.push(`reposFailed=${result.reposFailed} expected 0`);
  if (result.totalPositiveCentroids !== 2) {
    problems.push(`totalPositiveCentroids=${result.totalPositiveCentroids} expected 2`);
  }
  if (result.totalNegativeCentroids !== 1) {
    problems.push(`totalNegativeCentroids=${result.totalNegativeCentroids} expected 1`);
  }

  if (problems.length === 0) {
    return {
      id: "M037-S03-REFRESH-SWEEP",
      passed: true,
      skipped: false,
      status_code: "refresh_processed_expired_repos",
      detail: `repoCount=${result.repoCount} reposBuilt=${result.reposBuilt} reposSkipped=${result.reposSkipped} totalPositiveCentroids=${result.totalPositiveCentroids}`,
    };
  }

  return {
    id: "M037-S03-REFRESH-SWEEP",
    passed: false,
    skipped: false,
    status_code: "refresh_totals_mismatch",
    detail: problems.join("; "),
  };
}

export async function runFailOpenNaiveCheck(
  _runFn?: () => Promise<FailOpenNaiveFixtureResult>,
): Promise<Check> {
  const result = await (_runFn ?? runFailOpenNaiveFixture)();
  const problems: string[] = [];

  if (result.modelUsed) problems.push("modelUsed=true expected false");
  if (result.degradationReason !== "no-store") {
    problems.push(`degradationReason=${result.degradationReason} expected no-store`);
  }
  if (!result.allUnsuppressed) problems.push("findings were suppressed on naive fallback path");
  if (!result.confidenceUnchanged) problems.push("confidence changed on naive fallback path");
  if (result.findingCount !== 2) problems.push(`findingCount=${result.findingCount} expected 2`);

  if (problems.length === 0) {
    return {
      id: "M037-S03-FAIL-OPEN-NAIVE",
      passed: true,
      skipped: false,
      status_code: "review_fell_back_to_naive_path",
      detail: `modelUsed=${result.modelUsed} degradationReason=${result.degradationReason} findingCount=${result.findingCount}`,
    };
  }

  return {
    id: "M037-S03-FAIL-OPEN-NAIVE",
    passed: false,
    skipped: false,
    status_code: "naive_fallback_mismatch",
    detail: problems.join("; "),
  };
}

// ── Evaluation ────────────────────────────────────────────────────────

export async function evaluateM037S03(opts?: {
  _cacheReuseRunFn?: () => Promise<CacheReuseFixtureResult>;
  _staleGraceRunFn?: () => Promise<StaleGraceFixtureResult>;
  _refreshSweepRunFn?: () => Promise<RefreshSweepFixtureResult>;
  _failOpenNaiveRunFn?: () => Promise<FailOpenNaiveFixtureResult>;
}): Promise<EvaluationReport> {
  const [cacheReuse, staleGrace, refreshSweep, failOpenNaive] = await Promise.all([
    runCacheReuseCheck(opts?._cacheReuseRunFn),
    runStaleGraceCheck(opts?._staleGraceRunFn),
    runRefreshSweepCheck(opts?._refreshSweepRunFn),
    runFailOpenNaiveCheck(opts?._failOpenNaiveRunFn),
  ]);

  const checks: Check[] = [cacheReuse, staleGrace, refreshSweep, failOpenNaive];
  const overallPassed = checks
    .filter((c) => !c.skipped)
    .every((c) => c.passed);

  return {
    check_ids: M037_S03_CHECK_IDS,
    overallPassed,
    checks,
  };
}

// ── Rendering ─────────────────────────────────────────────────────────

function renderReport(report: EvaluationReport): string {
  const lines = [
    "M037 S03 proof harness",
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

export async function buildM037S03ProofHarness(opts?: {
  _cacheReuseRunFn?: () => Promise<CacheReuseFixtureResult>;
  _staleGraceRunFn?: () => Promise<StaleGraceFixtureResult>;
  _refreshSweepRunFn?: () => Promise<RefreshSweepFixtureResult>;
  _failOpenNaiveRunFn?: () => Promise<FailOpenNaiveFixtureResult>;
  stdout?: { write: (chunk: string) => void };
  stderr?: { write: (chunk: string) => void };
  json?: boolean;
}): Promise<{ exitCode: number }> {
  const stdout = opts?.stdout ?? process.stdout;
  const stderr = opts?.stderr ?? process.stderr;
  const useJson = opts?.json ?? false;

  const report = await evaluateM037S03({
    _cacheReuseRunFn: opts?._cacheReuseRunFn,
    _staleGraceRunFn: opts?._staleGraceRunFn,
    _refreshSweepRunFn: opts?._refreshSweepRunFn,
    _failOpenNaiveRunFn: opts?._failOpenNaiveRunFn,
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
    stderr.write(`verify:m037:s03 failed: ${failingCodes}\n`);
  }

  return { exitCode: report.overallPassed ? 0 : 1 };
}

if (import.meta.main) {
  const useJson = process.argv.includes("--json");
  const { exitCode } = await buildM037S03ProofHarness({ json: useJson });
  process.exit(exitCode);
}
