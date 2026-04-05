import { describe, test, expect } from "bun:test";
import {
  M040_S02_CHECK_IDS,
  evaluateM040S02,
  buildM040S02ProofHarness,
  runMissedFilesCheck,
  runLikelyTestsCheck,
  runDependentsCheck,
  runFallbackCheck,
  type EvaluationReport,
  type MissedFilesFixtureResult,
  type LikelyTestsFixtureResult,
  type DependentsFixtureResult,
  type FallbackFixtureResult,
} from "./verify-m040-s02.ts";

// ── Shared fixture helpers ────────────────────────────────────────────

function makeMissedFilesResult(
  overrides?: Partial<MissedFilesFixtureResult>,
): MissedFilesFixtureResult {
  return {
    graphAwareTopN: ["xbmc/cores/VideoPlayer/VideoPlayer.cpp"],
    riskOnlyTopN: ["xbmc/network/oauth/OAuth2Handler.cpp"],
    graphSurfacedExtra: ["xbmc/cores/VideoPlayer/VideoPlayer.cpp"],
    expectedSurfacedPath: "xbmc/cores/VideoPlayer/VideoPlayer.cpp",
    graphHits: 1,
    usedGraph: true,
    ...overrides,
  };
}

function makeLikelyTestsResult(
  overrides?: Partial<LikelyTestsFixtureResult>,
): LikelyTestsFixtureResult {
  return {
    graphLikelyTests: ["tests/utils/test_string_utils.py"],
    graphAwareTopN: ["xbmc/cores/player/player.py", "tests/utils/test_string_utils.py"],
    riskOnlyTopN: ["xbmc/cores/player/player.py", "xbmc/utils/string_utils.py"],
    testPromoted: true,
    expectedTestPath: "tests/utils/test_string_utils.py",
    ...overrides,
  };
}

function makeDependentsResult(
  overrides?: Partial<DependentsFixtureResult>,
): DependentsFixtureResult {
  return {
    probableDependents: [
      {
        stableKey: "FileCurl::Open",
        filePath: "xbmc/filesystem/FileCurl.cpp",
        score: 0.8,
      },
    ],
    graphAwareRanking: [
      "xbmc/filesystem/FileCurl.cpp",
      "xbmc/pvr/PVRManager.cpp",
      "xbmc/utils/URIUtils.cpp",
    ],
    riskOnlyRanking: [
      "xbmc/pvr/PVRManager.cpp",
      "xbmc/filesystem/FileCurl.cpp",
      "xbmc/utils/URIUtils.cpp",
    ],
    callerPromoted: true,
    expectedCallerPath: "xbmc/filesystem/FileCurl.cpp",
    ...overrides,
  };
}

function makeFallbackResult(
  overrides?: Partial<FallbackFixtureResult>,
): FallbackFixtureResult {
  return {
    usedGraph: false,
    graphHits: 0,
    graphRankedSelections: 0,
    riskOrderPreserved: true,
    riskScoreCount: 3,
    ...overrides,
  };
}

// ── M040-S02-GRAPH-SURFACES-MISSED-FILES ─────────────────────────────

describe("M040-S02-GRAPH-SURFACES-MISSED-FILES", () => {
  test("passes with the real deterministic fixture", async () => {
    const result = await runMissedFilesCheck();

    expect(result.id).toBe("M040-S02-GRAPH-SURFACES-MISSED-FILES");
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.status_code).toBe("graph_surfaces_impacted_files_beyond_risk_triage");
    expect(result.detail).toContain("graphHits=");
    expect(result.detail).toContain("graphSurfacedExtra=");
  });

  test("fails when graph was not applied", async () => {
    const result = await runMissedFilesCheck(() => makeMissedFilesResult({ usedGraph: false }));

    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("graph_missed_files_check_failed");
    expect(result.detail).toContain("usedGraph=false");
  });

  test("fails when no impacted files were surfaced by the blast-radius query", async () => {
    const result = await runMissedFilesCheck(() =>
      makeMissedFilesResult({ graphHits: 0, graphSurfacedExtra: [] }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("graphHits=0");
  });

  test("fails when expected impacted file is not in graph-aware top-N", async () => {
    const result = await runMissedFilesCheck(() =>
      makeMissedFilesResult({
        graphAwareTopN: ["xbmc/network/oauth/OAuth2Handler.cpp"],
        graphSurfacedExtra: [],
      }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("xbmc/cores/VideoPlayer/VideoPlayer.cpp not in graphAwareTopN");
  });

  test("fails when graph selection does not surface any new files beyond risk-only top-N", async () => {
    const result = await runMissedFilesCheck(() =>
      makeMissedFilesResult({ graphSurfacedExtra: [] }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("graphSurfacedExtra is empty");
  });
});

// ── M040-S02-GRAPH-SURFACES-LIKELY-TESTS ─────────────────────────────

describe("M040-S02-GRAPH-SURFACES-LIKELY-TESTS", () => {
  test("passes with the real deterministic fixture", async () => {
    const result = await runLikelyTestsCheck();

    expect(result.id).toBe("M040-S02-GRAPH-SURFACES-LIKELY-TESTS");
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.status_code).toBe("graph_promotes_likely_tests_above_risk_floor");
    expect(result.detail).toContain("graphLikelyTests=");
    expect(result.detail).toContain("testPromoted=true");
  });

  test("fails when blast-radius query surfaces no test files", async () => {
    const result = await runLikelyTestsCheck(() =>
      makeLikelyTestsResult({ graphLikelyTests: [], testPromoted: false }),
    );

    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("likely_tests_check_failed");
    expect(result.detail).toContain("graphLikelyTests is empty");
  });

  test("fails when expected test path is missing from graphLikelyTests", async () => {
    const result = await runLikelyTestsCheck(() =>
      makeLikelyTestsResult({
        graphLikelyTests: ["tests/utils/test_other.py"],
        testPromoted: false,
      }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("tests/utils/test_string_utils.py not in graphLikelyTests");
  });

  test("fails when test file was not promoted into the graph-aware top-N", async () => {
    const result = await runLikelyTestsCheck(() =>
      makeLikelyTestsResult({
        testPromoted: false,
        graphAwareTopN: ["xbmc/cores/player/player.py", "xbmc/utils/string_utils.py"],
      }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("test file was not promoted");
  });
});

// ── M040-S02-GRAPH-RERANKS-DEPENDENTS ────────────────────────────────

describe("M040-S02-GRAPH-RERANKS-DEPENDENTS", () => {
  test("passes with the real deterministic fixture", async () => {
    const result = await runDependentsCheck();

    expect(result.id).toBe("M040-S02-GRAPH-RERANKS-DEPENDENTS");
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.status_code).toBe("graph_promotes_callers_above_unrelated_files");
    expect(result.detail).toContain("dependentCount=");
    expect(result.detail).toContain("callerPromoted=true");
  });

  test("fails when blast-radius query surfaces no probable dependents", async () => {
    const result = await runDependentsCheck(() =>
      makeDependentsResult({ probableDependents: [], callerPromoted: false }),
    );

    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("dependents_reranking_check_failed");
    expect(result.detail).toContain("probableDependents is empty");
  });

  test("fails when the caller file is not in probable dependents", async () => {
    const result = await runDependentsCheck(() =>
      makeDependentsResult({
        probableDependents: [
          { stableKey: "SomeOther::fn", filePath: "xbmc/other/Other.cpp", score: 0.5 },
        ],
        callerPromoted: false,
      }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("xbmc/filesystem/FileCurl.cpp not in probableDependents");
  });

  test("fails when the caller was not promoted above unrelated files", async () => {
    const result = await runDependentsCheck(() =>
      makeDependentsResult({ callerPromoted: false }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("caller was not promoted");
  });
});

// ── M040-S02-FALLBACK-PRESERVES-ORDER ────────────────────────────────

describe("M040-S02-FALLBACK-PRESERVES-ORDER", () => {
  test("passes with the real deterministic fixture", async () => {
    const result = await runFallbackCheck();

    expect(result.id).toBe("M040-S02-FALLBACK-PRESERVES-ORDER");
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.status_code).toBe("fallback_preserves_risk_order_unchanged");
    expect(result.detail).toContain("usedGraph=false");
    expect(result.detail).toContain("riskOrderPreserved=true");
    expect(result.detail).toContain("riskScoreCount=3");
  });

  test("fails when graph was applied on the null-graph fallback path", async () => {
    const result = await runFallbackCheck(() =>
      makeFallbackResult({ usedGraph: true }),
    );

    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("fallback_order_check_failed");
    expect(result.detail).toContain("usedGraph=true when graph was null");
  });

  test("fails when risk order was mutated on the fallback path", async () => {
    const result = await runFallbackCheck(() =>
      makeFallbackResult({ riskOrderPreserved: false }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("risk order was not preserved");
  });

  test("fails when graphHits is nonzero without a graph", async () => {
    const result = await runFallbackCheck(() =>
      makeFallbackResult({ graphHits: 2 }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("graphHits=2 expected 0");
  });
});

// ── evaluateM040S02 ───────────────────────────────────────────────────

describe("evaluateM040S02", () => {
  test("returns all four check ids and passes with real fixtures", async () => {
    const report = await evaluateM040S02();

    expect(report.check_ids).toStrictEqual(M040_S02_CHECK_IDS);
    expect(report.checks.length).toBe(4);
    expect(report.overallPassed).toBe(true);
    expect(report.checks.every((c) => c.passed && !c.skipped)).toBe(true);
  });

  test("overallPassed is false when one check fails", async () => {
    const report = await evaluateM040S02({
      _fallbackRunFn: () => makeFallbackResult({ usedGraph: true }),
    });

    expect(report.overallPassed).toBe(false);
    const failing = report.checks.filter((c) => !c.passed);
    expect(failing.length).toBe(1);
    expect(failing[0]!.id).toBe("M040-S02-FALLBACK-PRESERVES-ORDER");
  });

  test("overallPassed is false when multiple checks fail", async () => {
    const report = await evaluateM040S02({
      _missedFilesRunFn: () => makeMissedFilesResult({ usedGraph: false, graphHits: 0 }),
      _likelyTestsRunFn: () => makeLikelyTestsResult({ graphLikelyTests: [], testPromoted: false }),
    });

    expect(report.overallPassed).toBe(false);
    const failingIds = report.checks.filter((c) => !c.passed).map((c) => c.id);
    expect(failingIds).toContain("M040-S02-GRAPH-SURFACES-MISSED-FILES");
    expect(failingIds).toContain("M040-S02-GRAPH-SURFACES-LIKELY-TESTS");
  });
});

// ── buildM040S02ProofHarness ──────────────────────────────────────────

describe("buildM040S02ProofHarness", () => {
  test("prints text output containing all four check ids", async () => {
    const chunks: string[] = [];
    const stdout = { write: (s: string) => { chunks.push(s); } };
    const stderr = { write: (_s: string) => {} };

    const { exitCode } = await buildM040S02ProofHarness({ stdout, stderr });
    const output = chunks.join("");

    expect(exitCode).toBe(0);
    expect(output).toContain("M040-S02-GRAPH-SURFACES-MISSED-FILES");
    expect(output).toContain("M040-S02-GRAPH-SURFACES-LIKELY-TESTS");
    expect(output).toContain("M040-S02-GRAPH-RERANKS-DEPENDENTS");
    expect(output).toContain("M040-S02-FALLBACK-PRESERVES-ORDER");
    expect(output).toContain("Final verdict: PASS");
  });

  test("prints valid JSON in json mode", async () => {
    const chunks: string[] = [];
    const stdout = { write: (s: string) => { chunks.push(s); } };
    const stderr = { write: (_s: string) => {} };

    await buildM040S02ProofHarness({ stdout, stderr, json: true });
    const parsed = JSON.parse(chunks.join("")) as EvaluationReport;

    expect(parsed.check_ids).toStrictEqual(Array.from(M040_S02_CHECK_IDS));
    expect(parsed.checks.length).toBe(4);
    expect(typeof parsed.overallPassed).toBe("boolean");
    expect(parsed.overallPassed).toBe(true);
  });

  test("returns exitCode 1 and stderr message when a check fails", async () => {
    const stdout = { write: (_s: string) => {} };
    const stderrChunks: string[] = [];
    const stderr = { write: (s: string) => { stderrChunks.push(s); } };

    const { exitCode } = await buildM040S02ProofHarness({
      stdout,
      stderr,
      _dependentsRunFn: () => makeDependentsResult({ callerPromoted: false }),
    });

    expect(exitCode).toBe(1);
    expect(stderrChunks.join("")).toContain("verify:m040:s02 failed");
    expect(stderrChunks.join("")).toContain("M040-S02-GRAPH-RERANKS-DEPENDENTS");
  });

  test("JSON output has correct shape when a check fails", async () => {
    const chunks: string[] = [];
    const stdout = { write: (s: string) => { chunks.push(s); } };
    const stderr = { write: (_s: string) => {} };

    await buildM040S02ProofHarness({
      stdout,
      stderr,
      json: true,
      _missedFilesRunFn: () => makeMissedFilesResult({ usedGraph: false }),
    });

    const parsed = JSON.parse(chunks.join("")) as EvaluationReport;
    expect(parsed.overallPassed).toBe(false);
    const failing = parsed.checks.filter((c) => !c.passed);
    expect(failing.length).toBeGreaterThan(0);
    expect(failing[0]!.id).toBe("M040-S02-GRAPH-SURFACES-MISSED-FILES");
  });
});
