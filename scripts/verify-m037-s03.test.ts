import { describe, test, expect } from "bun:test";
import {
  M037_S03_CHECK_IDS,
  evaluateM037S03,
  buildM037S03ProofHarness,
  runCacheReuseCheck,
  runStaleGraceCheck,
  runRefreshSweepCheck,
  runFailOpenNaiveCheck,
} from "./verify-m037-s03.ts";
import type {
  EvaluationReport,
  CacheReuseFixtureResult,
  StaleGraceFixtureResult,
  RefreshSweepFixtureResult,
  FailOpenNaiveFixtureResult,
} from "./verify-m037-s03.ts";

// ── Shared fixture helpers ────────────────────────────────────────────

function makeCacheReuseResult(
  overrides?: Partial<CacheReuseFixtureResult>,
): CacheReuseFixtureResult {
  return {
    modelUsed: true,
    degradationReason: null,
    suppressedCount: 1,
    getModelIncludingStaleCalls: 1,
    getModelCalls: 0,
    ...overrides,
  };
}

function makeStaleGraceResult(
  overrides?: Partial<StaleGraceFixtureResult>,
): StaleGraceFixtureResult {
  return {
    staleStatus: "stale",
    staleDescription: "stale (age=1500.0min, expired by 1.0min)",
    staleModelUsed: true,
    staleSuppressed: true,
    veryStaleStatus: "very-stale",
    veryStaleDescription: "very-stale (age=1740.0min, expired by 241.0min, beyond grace period)",
    veryStaleModelUsed: false,
    veryStaleDegradationReason: "no-model",
    ...overrides,
  };
}

function makeRefreshSweepResult(
  overrides?: Partial<{
    repoCount: number;
    reposBuilt: number;
    reposSkipped: number;
    reposFailed: number;
    totalPositiveCentroids: number;
    totalNegativeCentroids: number;
  }>,
): RefreshSweepFixtureResult {
  return {
    result: {
      repoCount: 2,
      reposBuilt: 1,
      reposSkipped: 1,
      reposFailed: 0,
      totalPositiveCentroids: 2,
      totalNegativeCentroids: 1,
      repoResults: [],
      durationMs: 10,
      ...overrides,
    },
  };
}

function makeFailOpenNaiveResult(
  overrides?: Partial<FailOpenNaiveFixtureResult>,
): FailOpenNaiveFixtureResult {
  return {
    modelUsed: false,
    degradationReason: "no-store",
    allUnsuppressed: true,
    confidenceUnchanged: true,
    findingCount: 2,
    ...overrides,
  };
}

// ── M037-S03-CACHE-REUSE ──────────────────────────────────────────────

describe("M037-S03-CACHE-REUSE", () => {
  test("passes with the real deterministic fixture", async () => {
    const result = await runCacheReuseCheck();

    expect(result.id).toBe("M037-S03-CACHE-REUSE");
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.status_code).toBe("cached_model_reused_via_staleness_loader");
    expect(result.detail).toContain("getModelIncludingStaleCalls=1");
    expect(result.detail).toContain("getModelCalls=0");
  });

  test("fails when scoring did not use the cached model", async () => {
    const result = await runCacheReuseCheck(
      async (): Promise<CacheReuseFixtureResult> =>
        makeCacheReuseResult({ modelUsed: false, degradationReason: "no-model" }),
    );

    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("cache_reuse_mismatch");
    expect(result.detail).toContain("modelUsed=false expected true");
  });

  test("fails when strict getModel path was used", async () => {
    const result = await runCacheReuseCheck(
      async (): Promise<CacheReuseFixtureResult> =>
        makeCacheReuseResult({ getModelCalls: 1, getModelIncludingStaleCalls: 0 }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("getModelIncludingStaleCalls=0 expected 1");
    expect(result.detail).toContain("getModelCalls=1 expected 0");
  });
});

// ── M037-S03-STALE-GRACE-POLICY ───────────────────────────────────────

describe("M037-S03-STALE-GRACE-POLICY", () => {
  test("passes with the real deterministic fixture", async () => {
    const result = await runStaleGraceCheck();

    expect(result.id).toBe("M037-S03-STALE-GRACE-POLICY");
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.status_code).toBe("stale_window_respected");
    expect(result.detail).toContain("stale=");
    expect(result.detail).toContain("veryStale=");
  });

  test("fails when stale models are not used inside the grace window", async () => {
    const result = await runStaleGraceCheck(
      async (): Promise<StaleGraceFixtureResult> =>
        makeStaleGraceResult({ staleModelUsed: false, staleSuppressed: false }),
    );

    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("stale_policy_mismatch");
    expect(result.detail).toContain("stale model was not used within grace window");
  });

  test("fails when very-stale models do not degrade to no-model", async () => {
    const result = await runStaleGraceCheck(
      async (): Promise<StaleGraceFixtureResult> =>
        makeStaleGraceResult({
          veryStaleModelUsed: true,
          veryStaleDegradationReason: null,
        }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("very-stale model was used");
    expect(result.detail).toContain("expected no-model");
  });
});

// ── M037-S03-REFRESH-SWEEP ────────────────────────────────────────────

describe("M037-S03-REFRESH-SWEEP", () => {
  test("passes with the real deterministic fixture", async () => {
    const result = await runRefreshSweepCheck();

    expect(result.id).toBe("M037-S03-REFRESH-SWEEP");
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.status_code).toBe("refresh_processed_expired_repos");
    expect(result.detail).toContain("repoCount=2");
    expect(result.detail).toContain("reposBuilt=1");
    expect(result.detail).toContain("reposSkipped=1");
  });

  test("fails when refresh totals are wrong", async () => {
    const result = await runRefreshSweepCheck(
      async (): Promise<RefreshSweepFixtureResult> =>
        makeRefreshSweepResult({ reposBuilt: 2, reposSkipped: 0 }),
    );

    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("refresh_totals_mismatch");
    expect(result.detail).toContain("reposBuilt=2 expected 1");
    expect(result.detail).toContain("reposSkipped=0 expected 1");
  });
});

// ── M037-S03-FAIL-OPEN-NAIVE ──────────────────────────────────────────

describe("M037-S03-FAIL-OPEN-NAIVE", () => {
  test("passes with the real deterministic fixture", async () => {
    const result = await runFailOpenNaiveCheck();

    expect(result.id).toBe("M037-S03-FAIL-OPEN-NAIVE");
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.status_code).toBe("review_fell_back_to_naive_path");
    expect(result.detail).toContain("degradationReason=no-store");
    expect(result.detail).toContain("findingCount=2");
  });

  test("fails when findings mutate on the naive fallback path", async () => {
    const result = await runFailOpenNaiveCheck(
      async (): Promise<FailOpenNaiveFixtureResult> =>
        makeFailOpenNaiveResult({ confidenceUnchanged: false, allUnsuppressed: false }),
    );

    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("naive_fallback_mismatch");
    expect(result.detail).toContain("findings were suppressed");
    expect(result.detail).toContain("confidence changed");
  });
});

// ── evaluateM037S03 ───────────────────────────────────────────────────

describe("evaluateM037S03", () => {
  test("returns all four check ids and passes with real fixtures", async () => {
    const report = await evaluateM037S03();

    expect(report.check_ids).toStrictEqual(M037_S03_CHECK_IDS);
    expect(report.checks.length).toBe(4);
    expect(report.overallPassed).toBe(true);
    expect(report.checks.every((c) => c.passed && !c.skipped)).toBe(true);
  });

  test("overallPassed is false when one check fails", async () => {
    const report = await evaluateM037S03({
      _failOpenNaiveRunFn: async (): Promise<FailOpenNaiveFixtureResult> =>
        makeFailOpenNaiveResult({ confidenceUnchanged: false }),
    });

    expect(report.overallPassed).toBe(false);
    const failing = report.checks.filter((c) => !c.passed);
    expect(failing.length).toBe(1);
    expect(failing[0]!.id).toBe("M037-S03-FAIL-OPEN-NAIVE");
  });

  test("overallPassed is false when multiple checks fail", async () => {
    const report = await evaluateM037S03({
      _cacheReuseRunFn: async (): Promise<CacheReuseFixtureResult> =>
        makeCacheReuseResult({ getModelCalls: 1, getModelIncludingStaleCalls: 0 }),
      _refreshSweepRunFn: async (): Promise<RefreshSweepFixtureResult> =>
        makeRefreshSweepResult({ reposFailed: 1 }),
    });

    expect(report.overallPassed).toBe(false);
    const failingIds = report.checks.filter((c) => !c.passed).map((c) => c.id);
    expect(failingIds).toContain("M037-S03-CACHE-REUSE");
    expect(failingIds).toContain("M037-S03-REFRESH-SWEEP");
  });
});

// ── buildM037S03ProofHarness ──────────────────────────────────────────

describe("buildM037S03ProofHarness", () => {
  test("prints text output containing all four check ids", async () => {
    const chunks: string[] = [];
    const stdout = { write: (s: string) => { chunks.push(s); } };
    const stderr = { write: (_s: string) => {} };

    const { exitCode } = await buildM037S03ProofHarness({ stdout, stderr });
    const output = chunks.join("");

    expect(exitCode).toBe(0);
    expect(output).toContain("M037-S03-CACHE-REUSE");
    expect(output).toContain("M037-S03-STALE-GRACE-POLICY");
    expect(output).toContain("M037-S03-REFRESH-SWEEP");
    expect(output).toContain("M037-S03-FAIL-OPEN-NAIVE");
    expect(output).toContain("Final verdict: PASS");
  });

  test("prints valid JSON in json mode", async () => {
    const chunks: string[] = [];
    const stdout = { write: (s: string) => { chunks.push(s); } };
    const stderr = { write: (_s: string) => {} };

    await buildM037S03ProofHarness({ stdout, stderr, json: true });
    const parsed = JSON.parse(chunks.join("")) as EvaluationReport;

    expect(parsed.check_ids).toStrictEqual(Array.from(M037_S03_CHECK_IDS));
    expect(parsed.checks.length).toBe(4);
    expect(typeof parsed.overallPassed).toBe("boolean");
    expect(parsed.overallPassed).toBe(true);
  });

  test("returns exitCode 1 and stderr message when a check fails", async () => {
    const stdout = { write: (_s: string) => {} };
    const stderrChunks: string[] = [];
    const stderr = { write: (s: string) => { stderrChunks.push(s); } };

    const { exitCode } = await buildM037S03ProofHarness({
      stdout,
      stderr,
      _staleGraceRunFn: async (): Promise<StaleGraceFixtureResult> =>
        makeStaleGraceResult({ veryStaleModelUsed: true }),
    });

    expect(exitCode).toBe(1);
    expect(stderrChunks.join("")).toContain("verify:m037:s03 failed");
    expect(stderrChunks.join("")).toContain("M037-S03-STALE-GRACE-POLICY");
  });

  test("JSON output has correct shape when a check fails", async () => {
    const chunks: string[] = [];
    const stdout = { write: (s: string) => { chunks.push(s); } };
    const stderr = { write: (_s: string) => {} };

    await buildM037S03ProofHarness({
      stdout,
      stderr,
      json: true,
      _cacheReuseRunFn: async (): Promise<CacheReuseFixtureResult> =>
        makeCacheReuseResult({ modelUsed: false, degradationReason: "no-model" }),
    });

    const parsed = JSON.parse(chunks.join("")) as EvaluationReport;
    expect(parsed.overallPassed).toBe(false);
    const failing = parsed.checks.filter((c) => !c.passed);
    expect(failing.length).toBeGreaterThan(0);
    expect(failing[0]!.id).toBe("M037-S03-CACHE-REUSE");
  });
});
