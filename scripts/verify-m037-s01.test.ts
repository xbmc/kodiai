import { describe, test, expect } from "bun:test";
import {
  M037_S01_CHECK_IDS,
  evaluateM037S01,
  buildM037S01ProofHarness,
  runBuildAndCacheCheck,
  runRefreshSweepCheck,
  runFailOpenCheck,
} from "./verify-m037-s01.ts";
import type {
  EvaluationReport,
  BuildAndCacheFixtureResult,
  RefreshSweepFixtureResult,
  FailOpenFixtureResult,
} from "./verify-m037-s01.ts";

// ── Shared fixture helpers ────────────────────────────────────────────

function makeRefreshSweepResult(overrides?: Partial<{
  repoCount: number;
  reposBuilt: number;
  reposSkipped: number;
  reposFailed: number;
  totalPositiveCentroids: number;
  totalNegativeCentroids: number;
}>): RefreshSweepFixtureResult {
  return {
    result: {
      repoCount: 3,
      reposBuilt: 3,
      reposSkipped: 0,
      reposFailed: 0,
      totalPositiveCentroids: 6,
      totalNegativeCentroids: 3,
      repoResults: [],
      durationMs: 10,
      ...overrides,
    },
  };
}

function makeFailOpenResult(overrides?: Partial<{
  repoCount: number;
  reposFailed: number;
  reposBuilt: number;
  warnCount: number;
}>): FailOpenFixtureResult {
  const base = {
    repoCount: 2,
    reposFailed: 1,
    reposBuilt: 1,
    warnCount: 1,
    ...overrides,
  };
  return {
    result: {
      repoCount: base.repoCount,
      reposBuilt: base.reposBuilt,
      reposSkipped: 0,
      reposFailed: base.reposFailed,
      totalPositiveCentroids: 0,
      totalNegativeCentroids: 0,
      repoResults: [],
      durationMs: 5,
    },
    warnCount: base.warnCount,
  };
}

function makeBuildAndCacheResult(overrides?: Partial<BuildAndCacheFixtureResult>): BuildAndCacheFixtureResult {
  return {
    built: true,
    positiveCentroidCount: 1,
    negativeCentroidCount: 0,
    savedPayloads: [
      {
        repo: "org/fixture-repo",
        positiveCentroids: [new Float32Array([1, 0])],
        negativeCentroids: [],
        memberCount: 5,
        positiveMemberCount: 5,
        negativeMemberCount: 0,
      },
    ],
    ...overrides,
  };
}

// ── M037-S01-BUILD-AND-CACHE ──────────────────────────────────────────

describe("M037-S01-BUILD-AND-CACHE", () => {
  test("passes with the real deterministic build fixture", async () => {
    const result = await runBuildAndCacheCheck();

    expect(result.id).toBe("M037-S01-BUILD-AND-CACHE");
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.status_code).toBe("model_built_and_cached");
    expect(result.detail).toContain("positiveCentroidCount=");
    expect(result.detail).toContain("saveCallCount=1");
  });

  test("fails when built=false", async () => {
    const result = await runBuildAndCacheCheck(
      async (): Promise<BuildAndCacheFixtureResult> => makeBuildAndCacheResult({ built: false, savedPayloads: [] }),
    );

    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("build_or_cache_failed");
    expect(result.detail).toContain("built=false");
  });

  test("fails when positiveCentroidCount is zero", async () => {
    const result = await runBuildAndCacheCheck(
      async (): Promise<BuildAndCacheFixtureResult> =>
        makeBuildAndCacheResult({ positiveCentroidCount: 0 }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("positiveCentroidCount=0 expected >0");
  });

  test("fails when saveModel was not called", async () => {
    const result = await runBuildAndCacheCheck(
      async (): Promise<BuildAndCacheFixtureResult> =>
        makeBuildAndCacheResult({ savedPayloads: [] }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("saveCallCount=0 expected 1");
  });

  test("fails when model saved for wrong repo", async () => {
    const result = await runBuildAndCacheCheck(
      async (): Promise<BuildAndCacheFixtureResult> =>
        makeBuildAndCacheResult({
          savedPayloads: [{
            repo: "wrong/repo",
            positiveCentroids: [new Float32Array([1, 0])],
            negativeCentroids: [],
            memberCount: 5,
            positiveMemberCount: 5,
            negativeMemberCount: 0,
          }],
        }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("store.saveModel not called for correct repo");
  });
});

// ── M037-S01-REFRESH-SWEEP ────────────────────────────────────────────

describe("M037-S01-REFRESH-SWEEP", () => {
  test("passes with the real deterministic sweep fixture", async () => {
    const result = await runRefreshSweepCheck();

    expect(result.id).toBe("M037-S01-REFRESH-SWEEP");
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.status_code).toBe("sweep_processed_all_repos");
    expect(result.detail).toContain("repoCount=3");
    expect(result.detail).toContain("reposBuilt=3");
    expect(result.detail).toContain("totalPositiveCentroids=6");
  });

  test("fails when reposBuilt is less than repoCount", async () => {
    const result = await runRefreshSweepCheck(
      async (): Promise<RefreshSweepFixtureResult> =>
        makeRefreshSweepResult({ reposBuilt: 2, reposFailed: 1 }),
    );

    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("sweep_totals_mismatch");
    expect(result.detail).toContain("reposBuilt=2 expected 3");
  });

  test("fails when totalPositiveCentroids is wrong", async () => {
    const result = await runRefreshSweepCheck(
      async (): Promise<RefreshSweepFixtureResult> =>
        makeRefreshSweepResult({ totalPositiveCentroids: 0 }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("totalPositiveCentroids=0 expected 6");
  });

  test("fails when reposFailed > 0", async () => {
    const result = await runRefreshSweepCheck(
      async (): Promise<RefreshSweepFixtureResult> =>
        makeRefreshSweepResult({ reposFailed: 2, reposBuilt: 1 }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("reposFailed=2 expected 0");
  });
});

// ── M037-S01-FAIL-OPEN ────────────────────────────────────────────────

describe("M037-S01-FAIL-OPEN", () => {
  test("passes with the real deterministic fail-open fixture", async () => {
    const result = await runFailOpenCheck();

    expect(result.id).toBe("M037-S01-FAIL-OPEN");
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.status_code).toBe("sweep_continues_after_failure");
    expect(result.detail).toContain("reposFailed=1");
    expect(result.detail).toContain("reposBuilt=1");
    expect(result.detail).toContain("warnCount=");
  });

  test("fails when sweep aborts (reposBuilt=0 after 2 repos)", async () => {
    const result = await runFailOpenCheck(
      async (): Promise<FailOpenFixtureResult> => makeFailOpenResult({ reposBuilt: 0 }),
    );

    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("sweep_not_fail_open");
    expect(result.detail).toContain("reposBuilt=0 expected 1");
  });

  test("fails when no warn log is emitted on build crash", async () => {
    const result = await runFailOpenCheck(
      async (): Promise<FailOpenFixtureResult> => makeFailOpenResult({ warnCount: 0 }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("warnCount=0 expected >=1");
  });

  test("fails when reposFailed=0 despite a crashing build", async () => {
    const result = await runFailOpenCheck(
      async (): Promise<FailOpenFixtureResult> => makeFailOpenResult({ reposFailed: 0 }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("reposFailed=0 expected 1");
  });
});

// ── evaluateM037S01 ───────────────────────────────────────────────────

describe("evaluateM037S01", () => {
  test("returns all three check ids and passes with real fixtures", async () => {
    const report = await evaluateM037S01();

    expect(report.check_ids).toStrictEqual(M037_S01_CHECK_IDS);
    expect(report.checks.length).toBe(3);
    expect(report.overallPassed).toBe(true);
    expect(report.checks.every((c) => c.passed && !c.skipped)).toBe(true);
  });

  test("overallPassed is false when one check fails", async () => {
    const report = await evaluateM037S01({
      _buildAndCacheRunFn: async (): Promise<BuildAndCacheFixtureResult> =>
        makeBuildAndCacheResult({ built: false, savedPayloads: [] }),
    });

    expect(report.overallPassed).toBe(false);
    const failing = report.checks.filter((c) => !c.passed);
    expect(failing.length).toBe(1);
    expect(failing[0]!.id).toBe("M037-S01-BUILD-AND-CACHE");
  });

  test("overallPassed is false when multiple checks fail", async () => {
    const report = await evaluateM037S01({
      _buildAndCacheRunFn: async (): Promise<BuildAndCacheFixtureResult> =>
        makeBuildAndCacheResult({ built: false, savedPayloads: [] }),
      _refreshSweepRunFn: async (): Promise<RefreshSweepFixtureResult> =>
        makeRefreshSweepResult({ reposBuilt: 0, reposFailed: 3 }),
    });

    expect(report.overallPassed).toBe(false);
    const failingIds = report.checks.filter((c) => !c.passed).map((c) => c.id);
    expect(failingIds).toContain("M037-S01-BUILD-AND-CACHE");
    expect(failingIds).toContain("M037-S01-REFRESH-SWEEP");
  });
});

// ── buildM037S01ProofHarness ──────────────────────────────────────────

describe("buildM037S01ProofHarness", () => {
  test("prints text output containing all three check ids", async () => {
    const chunks: string[] = [];
    const stdout = { write: (s: string) => { chunks.push(s); } };
    const stderr = { write: (_s: string) => {} };

    const { exitCode } = await buildM037S01ProofHarness({ stdout, stderr });
    const output = chunks.join("");

    expect(exitCode).toBe(0);
    expect(output).toContain("M037-S01-BUILD-AND-CACHE");
    expect(output).toContain("M037-S01-REFRESH-SWEEP");
    expect(output).toContain("M037-S01-FAIL-OPEN");
    expect(output).toContain("Final verdict: PASS");
  });

  test("prints valid JSON in json mode", async () => {
    const chunks: string[] = [];
    const stdout = { write: (s: string) => { chunks.push(s); } };
    const stderr = { write: (_s: string) => {} };

    await buildM037S01ProofHarness({ stdout, stderr, json: true });
    const parsed = JSON.parse(chunks.join("")) as EvaluationReport;

    expect(parsed.check_ids).toStrictEqual(Array.from(M037_S01_CHECK_IDS));
    expect(parsed.checks.length).toBe(3);
    expect(typeof parsed.overallPassed).toBe("boolean");
    expect(parsed.overallPassed).toBe(true);
  });

  test("returns exitCode 1 and stderr message when a check fails", async () => {
    const stdout = { write: (_s: string) => {} };
    const stderrChunks: string[] = [];
    const stderr = { write: (s: string) => { stderrChunks.push(s); } };

    const { exitCode } = await buildM037S01ProofHarness({
      stdout,
      stderr,
      _failOpenRunFn: async (): Promise<FailOpenFixtureResult> =>
        makeFailOpenResult({ warnCount: 0 }),
    });

    expect(exitCode).toBe(1);
    expect(stderrChunks.join("")).toContain("verify:m037:s01 failed");
    expect(stderrChunks.join("")).toContain("M037-S01-FAIL-OPEN");
  });

  test("JSON output has correct shape when a check fails", async () => {
    const chunks: string[] = [];
    const stdout = { write: (s: string) => { chunks.push(s); } };
    const stderr = { write: (_s: string) => {} };

    await buildM037S01ProofHarness({
      stdout,
      stderr,
      json: true,
      _buildAndCacheRunFn: async (): Promise<BuildAndCacheFixtureResult> =>
        makeBuildAndCacheResult({ built: false, savedPayloads: [] }),
    });

    const parsed = JSON.parse(chunks.join("")) as EvaluationReport;
    expect(parsed.overallPassed).toBe(false);
    const failing = parsed.checks.filter((c) => !c.passed);
    expect(failing.length).toBeGreaterThan(0);
    expect(failing[0]!.id).toBe("M037-S01-BUILD-AND-CACHE");
  });
});
