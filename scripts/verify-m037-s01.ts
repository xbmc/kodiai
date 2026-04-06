/**
 * M037 S01 proof harness: cluster model build + cache.
 *
 * Proves three properties without a live DB:
 *
 *   M037-S01-BUILD-AND-CACHE  — buildClusterModel produces a model (positive
 *     centroids present) when given sufficient learning memories, and the
 *     model is saved to the store exactly once.
 *
 *   M037-S01-REFRESH-SWEEP — createClusterRefresh processes a list of expired
 *     repos, calls buildFn for each, and returns correct totals.
 *
 *   M037-S01-FAIL-OPEN — the refresh sweep continues through failures (one
 *     crashing repo) and emits a warn log for each failure without aborting.
 *
 * All checks run with pure-code stubs — no DB connection required.
 */

import type { Logger } from "pino";
import type { Sql } from "../src/db/client.ts";
import {
  buildClusterModel,
} from "../src/knowledge/suggestion-cluster-builder.ts";
import {
  createClusterRefresh,
  type ClusterRefreshResult,
} from "../src/knowledge/suggestion-cluster-refresh.ts";
import type {
  SuggestionClusterStore,
  SuggestionClusterModel,
  SuggestionClusterModelPayload,
} from "../src/knowledge/suggestion-cluster-store.ts";

// ── Check IDs ─────────────────────────────────────────────────────────

export const M037_S01_CHECK_IDS = [
  "M037-S01-BUILD-AND-CACHE",
  "M037-S01-REFRESH-SWEEP",
  "M037-S01-FAIL-OPEN",
] as const;

export type M037S01CheckId = (typeof M037_S01_CHECK_IDS)[number];

export type Check = {
  id: M037S01CheckId;
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

export type BuildAndCacheFixtureResult = {
  built: boolean;
  positiveCentroidCount: number;
  negativeCentroidCount: number;
  savedPayloads: SuggestionClusterModelPayload[];
};

export type RefreshSweepFixtureResult = {
  result: ClusterRefreshResult;
};

export type FailOpenFixtureResult = {
  result: ClusterRefreshResult;
  warnCount: number;
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

function createWarnSpyLogger(): Logger & { _warnCalls: unknown[][] } {
  const warnCalls: unknown[][] = [];
  const logger = {
    _warnCalls: warnCalls,
    info: () => {},
    warn: (...args: unknown[]) => { warnCalls.push(args); },
    error: () => {},
    debug: () => {},
    child: () => logger,
  };
  return logger as unknown as Logger & { _warnCalls: unknown[][] };
}

function createNoopSql(): Sql {
  return (() => Promise.resolve([])) as unknown as Sql;
}

/** Build a normalized embedding vector seeded from an integer. */
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
  for (let i = 0; i < dim; i++) arr[i] = arr[i]! / norm;
  return arr;
}

/** Slightly adjust a base embedding to produce a close-but-distinct vector. */
function slightlyAdjustedEmbedding(base: Float32Array, delta: number): Float32Array {
  const arr = new Float32Array(base.length);
  for (let i = 0; i < base.length; i++) arr[i] = base[i]! + delta;
  let norm = 0;
  for (let i = 0; i < arr.length; i++) norm += arr[i]! * arr[i]!;
  norm = Math.sqrt(norm);
  for (let i = 0; i < arr.length; i++) arr[i] = arr[i]! / norm;
  return arr;
}

function toVectorString(arr: Float32Array): string {
  return `[${Array.from(arr).join(",")}]`;
}

/** Create a capturing store that records saveModel calls. */
function createCapturingStore(savedPayloads: SuggestionClusterModelPayload[]): SuggestionClusterStore {
  let nextId = 1;
  return {
    getModel: async () => null,
    getModelIncludingStale: async () => null,
    saveModel: async (payload) => {
      savedPayloads.push(payload);
      const id = nextId++;
      return {
        id,
        repo: payload.repo,
        positiveCentroids: payload.positiveCentroids,
        negativeCentroids: payload.negativeCentroids,
        memberCount: payload.memberCount,
        positiveMemberCount: payload.positiveMemberCount,
        negativeMemberCount: payload.negativeMemberCount,
        builtAt: new Date().toISOString(),
        expiresAt: (payload.expiresAt ?? new Date(Date.now() + 86400000)).toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } satisfies SuggestionClusterModel;
    },
    deleteModel: async () => {},
    listExpiredModelRepos: async () => [],
  };
}

// ── Fixture: BUILD-AND-CACHE ──────────────────────────────────────────

/**
 * Runs buildClusterModel with a synthetic SQL stub that returns enough
 * positive-class rows to produce at least one centroid.
 */
async function runBuildAndCacheFixture(): Promise<BuildAndCacheFixtureResult> {
  const savedPayloads: SuggestionClusterModelPayload[] = [];
  const store = createCapturingStore(savedPayloads);
  const logger = createSilentLogger();
  const repo = "org/fixture-repo";

  // Build a tight positive cluster of 5 rows + 3 noisy rows
  const base = normalizedEmbedding(42, 8);
  const positiveRows = [
    { id: 1, outcome: "accepted", embedding: toVectorString(base) },
    { id: 2, outcome: "accepted", embedding: toVectorString(slightlyAdjustedEmbedding(base, 0.001)) },
    { id: 3, outcome: "thumbs_up", embedding: toVectorString(slightlyAdjustedEmbedding(base, -0.001)) },
    { id: 4, outcome: "accepted", embedding: toVectorString(slightlyAdjustedEmbedding(base, 0.002)) },
    { id: 5, outcome: "thumbs_up", embedding: toVectorString(slightlyAdjustedEmbedding(base, -0.002)) },
  ];
  const noiseBase = normalizedEmbedding(99, 8);
  const noiseRows = [
    { id: 6, outcome: "accepted", embedding: toVectorString(noiseBase) },
    { id: 7, outcome: "accepted", embedding: toVectorString(slightlyAdjustedEmbedding(noiseBase, 0.01)) },
    { id: 8, outcome: "accepted", embedding: toVectorString(slightlyAdjustedEmbedding(noiseBase, -0.01)) },
  ];

  const allRows = [...positiveRows, ...noiseRows];

  const sql = (async (_strings: TemplateStringsArray, ..._values: unknown[]) => {
    return allRows;
  }) as unknown as Sql;

  const result = await buildClusterModel({ repo, sql, store, logger });

  return {
    built: result.built,
    positiveCentroidCount: result.positiveCentroidCount,
    negativeCentroidCount: result.negativeCentroidCount,
    savedPayloads,
  };
}

// ── Fixture: REFRESH-SWEEP ────────────────────────────────────────────

async function runRefreshSweepFixture(): Promise<RefreshSweepFixtureResult> {
  const logger = createSilentLogger();
  const expiredRepos = ["org/repo-alpha", "org/repo-beta", "org/repo-gamma"];

  const store: SuggestionClusterStore = {
    getModel: async () => null,
    getModelIncludingStale: async () => null,
    saveModel: async (p) => ({
      id: 1, repo: p.repo,
      positiveCentroids: p.positiveCentroids, negativeCentroids: p.negativeCentroids,
      memberCount: p.memberCount, positiveMemberCount: p.positiveMemberCount,
      negativeMemberCount: p.negativeMemberCount,
      builtAt: new Date().toISOString(), expiresAt: new Date().toISOString(),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }),
    deleteModel: async () => {},
    listExpiredModelRepos: async () => expiredRepos,
  };

  const refresh = createClusterRefresh({
    sql: createNoopSql(),
    logger,
    store,
    _buildFn: async ({ repo }) => ({
      repo,
      built: true,
      model: null,
      positiveCentroidCount: 2,
      negativeCentroidCount: 1,
      positiveMemberCount: 8,
      negativeMemberCount: 4,
      skippedClusters: 0,
    }),
  });

  const result = await refresh.run();
  return { result };
}

// ── Fixture: FAIL-OPEN ────────────────────────────────────────────────

async function runFailOpenFixture(): Promise<FailOpenFixtureResult> {
  const logger = createWarnSpyLogger();

  const store: SuggestionClusterStore = {
    getModel: async () => null,
    getModelIncludingStale: async () => null,
    saveModel: async () => ({ id: 1, repo: "x", positiveCentroids: [], negativeCentroids: [], memberCount: 0, positiveMemberCount: 0, negativeMemberCount: 0, builtAt: "", expiresAt: "", createdAt: "", updatedAt: "" }),
    deleteModel: async () => {},
    listExpiredModelRepos: async () => [],
  };

  const refresh = createClusterRefresh({
    sql: createNoopSql(),
    logger,
    store,
    _buildFn: async ({ repo }) => {
      if (repo === "org/crashing") throw new Error("simulated build crash");
      return {
        repo,
        built: true,
        model: null,
        positiveCentroidCount: 1,
        negativeCentroidCount: 1,
        positiveMemberCount: 5,
        negativeMemberCount: 5,
        skippedClusters: 0,
      };
    },
  });

  const result = await refresh.run({ repos: ["org/crashing", "org/healthy"] });
  return { result, warnCount: logger._warnCalls.length };
}

// ── Check functions ───────────────────────────────────────────────────

export async function runBuildAndCacheCheck(
  _runFn?: () => Promise<BuildAndCacheFixtureResult>,
): Promise<Check> {
  const { built, positiveCentroidCount, negativeCentroidCount, savedPayloads } =
    await (_runFn ?? runBuildAndCacheFixture)();

  const saveCallCount = savedPayloads.length;
  const savedRepos = new Set(savedPayloads.map((p) => p.repo));

  if (
    built &&
    positiveCentroidCount > 0 &&
    saveCallCount === 1 &&
    savedRepos.has("org/fixture-repo")
  ) {
    return {
      id: "M037-S01-BUILD-AND-CACHE",
      passed: true,
      skipped: false,
      status_code: "model_built_and_cached",
      detail: `positiveCentroidCount=${positiveCentroidCount} negativeCentroidCount=${negativeCentroidCount} saveCallCount=${saveCallCount}`,
    };
  }

  const problems: string[] = [];
  if (!built) problems.push("built=false");
  if (positiveCentroidCount === 0) problems.push("positiveCentroidCount=0 expected >0");
  if (saveCallCount !== 1) problems.push(`saveCallCount=${saveCallCount} expected 1`);
  if (!savedRepos.has("org/fixture-repo")) problems.push("store.saveModel not called for correct repo");

  return {
    id: "M037-S01-BUILD-AND-CACHE",
    passed: false,
    skipped: false,
    status_code: "build_or_cache_failed",
    detail: problems.join("; "),
  };
}

export async function runRefreshSweepCheck(
  _runFn?: () => Promise<RefreshSweepFixtureResult>,
): Promise<Check> {
  const { result } = await (_runFn ?? runRefreshSweepFixture)();

  const allBuilt =
    result.repoCount === 3 &&
    result.reposBuilt === 3 &&
    result.reposSkipped === 0 &&
    result.reposFailed === 0 &&
    result.totalPositiveCentroids === 6 &&
    result.totalNegativeCentroids === 3;

  if (allBuilt) {
    return {
      id: "M037-S01-REFRESH-SWEEP",
      passed: true,
      skipped: false,
      status_code: "sweep_processed_all_repos",
      detail: `repoCount=${result.repoCount} reposBuilt=${result.reposBuilt} totalPositiveCentroids=${result.totalPositiveCentroids}`,
    };
  }

  const problems: string[] = [];
  if (result.repoCount !== 3) problems.push(`repoCount=${result.repoCount} expected 3`);
  if (result.reposBuilt !== 3) problems.push(`reposBuilt=${result.reposBuilt} expected 3`);
  if (result.reposFailed !== 0) problems.push(`reposFailed=${result.reposFailed} expected 0`);
  if (result.totalPositiveCentroids !== 6) problems.push(`totalPositiveCentroids=${result.totalPositiveCentroids} expected 6`);
  if (result.totalNegativeCentroids !== 3) problems.push(`totalNegativeCentroids=${result.totalNegativeCentroids} expected 3`);

  return {
    id: "M037-S01-REFRESH-SWEEP",
    passed: false,
    skipped: false,
    status_code: "sweep_totals_mismatch",
    detail: problems.join("; "),
  };
}

export async function runFailOpenCheck(
  _runFn?: () => Promise<FailOpenFixtureResult>,
): Promise<Check> {
  const { result, warnCount } = await (_runFn ?? runFailOpenFixture)();

  const failOpen =
    result.repoCount === 2 &&
    result.reposFailed === 1 &&
    result.reposBuilt === 1 &&
    warnCount >= 1;

  if (failOpen) {
    return {
      id: "M037-S01-FAIL-OPEN",
      passed: true,
      skipped: false,
      status_code: "sweep_continues_after_failure",
      detail: `reposFailed=${result.reposFailed} reposBuilt=${result.reposBuilt} warnCount=${warnCount}`,
    };
  }

  const problems: string[] = [];
  if (result.repoCount !== 2) problems.push(`repoCount=${result.repoCount} expected 2`);
  if (result.reposFailed !== 1) problems.push(`reposFailed=${result.reposFailed} expected 1`);
  if (result.reposBuilt !== 1) problems.push(`reposBuilt=${result.reposBuilt} expected 1`);
  if (warnCount < 1) problems.push(`warnCount=${warnCount} expected >=1`);

  return {
    id: "M037-S01-FAIL-OPEN",
    passed: false,
    skipped: false,
    status_code: "sweep_not_fail_open",
    detail: problems.join("; "),
  };
}

// ── Evaluation ────────────────────────────────────────────────────────

export async function evaluateM037S01(opts?: {
  _buildAndCacheRunFn?: () => Promise<BuildAndCacheFixtureResult>;
  _refreshSweepRunFn?: () => Promise<RefreshSweepFixtureResult>;
  _failOpenRunFn?: () => Promise<FailOpenFixtureResult>;
}): Promise<EvaluationReport> {
  const [buildAndCache, refreshSweep, failOpen] = await Promise.all([
    runBuildAndCacheCheck(opts?._buildAndCacheRunFn),
    runRefreshSweepCheck(opts?._refreshSweepRunFn),
    runFailOpenCheck(opts?._failOpenRunFn),
  ]);

  const checks: Check[] = [buildAndCache, refreshSweep, failOpen];
  const overallPassed = checks
    .filter((c) => !c.skipped)
    .every((c) => c.passed);

  return {
    check_ids: M037_S01_CHECK_IDS,
    overallPassed,
    checks,
  };
}

// ── Rendering ─────────────────────────────────────────────────────────

function renderReport(report: EvaluationReport): string {
  const lines = [
    "M037 S01 proof harness",
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

export async function buildM037S01ProofHarness(opts?: {
  _buildAndCacheRunFn?: () => Promise<BuildAndCacheFixtureResult>;
  _refreshSweepRunFn?: () => Promise<RefreshSweepFixtureResult>;
  _failOpenRunFn?: () => Promise<FailOpenFixtureResult>;
  stdout?: { write: (chunk: string) => void };
  stderr?: { write: (chunk: string) => void };
  json?: boolean;
}): Promise<{ exitCode: number }> {
  const stdout = opts?.stdout ?? process.stdout;
  const stderr = opts?.stderr ?? process.stderr;
  const useJson = opts?.json ?? false;

  const report = await evaluateM037S01({
    _buildAndCacheRunFn: opts?._buildAndCacheRunFn,
    _refreshSweepRunFn: opts?._refreshSweepRunFn,
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
    stderr.write(`verify:m037:s01 failed: ${failingCodes}\n`);
  }

  return { exitCode: report.overallPassed ? 0 : 1 };
}

if (import.meta.main) {
  const useJson = process.argv.includes("--json");
  const { exitCode } = await buildM037S01ProofHarness({ json: useJson });
  process.exit(exitCode);
}
