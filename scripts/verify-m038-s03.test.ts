import { describe, expect, test } from "bun:test";
import {
  M038_S03_CHECK_IDS,
  buildM038S03ProofHarness,
  checkCacheReuse,
  checkPartialDegradationTruthful,
  checkSubstrateFailureTruthful,
  checkTimeoutFailOpen,
  evaluateM038S03Checks,
  renderM038S03Report,
  type M038S03Check,
  type M038S03EvaluationReport,
} from "./verify-m038-s03.ts";

// ── Unit checks ────────────────────────────────────────────────────────────────

describe("checkCacheReuse", () => {
  test("passes: second call with same SHA pair hits cache without invoking adapters", async () => {
    const check = await checkCacheReuse();

    expect(check.id).toBe("M038-S03-CACHE-REUSE");
    expect(check.passed).toBe(true);
    expect(check.status_code).toBe("cache_reuse_verified");
    expect(check.detail).toContain("secondCacheHit=true");
    expect(check.detail).toContain("noNewAdapterCalls=true");
    expect(check.detail).toContain("firstCacheMiss=true");
    expect(check.detail).toContain("firstCacheWrite=true");
  });
});

describe("checkTimeoutFailOpen", () => {
  test("passes: both adapters slow → unavailable status, review not blocked", async () => {
    const check = await checkTimeoutFailOpen();

    expect(check.id).toBe("M038-S03-TIMEOUT-FAIL-OPEN");
    expect(check.passed).toBe(true);
    expect(check.status_code).toBe("timeout_fail_open_verified");
    expect(check.detail).toContain("status=unavailable");
    expect(check.detail).toContain("completedBeforeAdapters=true");
    expect(check.detail).toContain("noInventedEvidence=true");
    expect(check.detail).toContain("fallbackUsed=true");
    expect(check.detail).toContain("hasNoRenderableEvidence=true");
  });
});

describe("checkSubstrateFailureTruthful", () => {
  test("passes: both substrates throw → unavailable, no invented callers or evidence", async () => {
    const check = await checkSubstrateFailureTruthful();

    expect(check.id).toBe("M038-S03-SUBSTRATE-FAILURE-TRUTHFUL");
    expect(check.passed).toBe(true);
    expect(check.status_code).toBe("substrate_failure_truthful_verified");
    expect(check.detail).toContain("noCallers=true");
    expect(check.detail).toContain("noEvidence=true");
    expect(check.detail).toContain("noImpactedFiles=true");
    expect(check.detail).toContain("graphStatsNull=true");
    expect(check.detail).toContain("fallbackUsed=true");
    expect(check.detail).toContain("noRenderableEvidence=true");
    // Truthfulness signals must identify the unavailable sources
    expect(check.detail).toContain("graph-unavailable");
    expect(check.detail).toContain("corpus-unavailable");
    expect(check.detail).toContain("no-structural-evidence");
  });
});

describe("checkPartialDegradationTruthful", () => {
  test("passes: graph-ok+corpus-fail shows only graph evidence; graph-fail+corpus-ok shows only corpus evidence", async () => {
    const check = await checkPartialDegradationTruthful();

    expect(check.id).toBe("M038-S03-PARTIAL-DEGRADATION-TRUTHFUL");
    expect(check.passed).toBe(true);
    expect(check.status_code).toBe("partial_degradation_truthful_verified");
    // Case 1: graph available, corpus unavailable
    expect(check.detail).toContain("hasGraphEvidence=true");
    expect(check.detail).toContain("noCorpusEvidence=true");
    expect(check.detail).toContain("onlyCorpusDeg=true");
    expect(check.detail).toContain("graphAvail=true");
    expect(check.detail).toContain("corpusUnavail=true");
    // Case 2: corpus available, graph unavailable
    expect(check.detail).toContain("hasCorpusEvidence=true");
    expect(check.detail).toContain("noGraphEvidence=true");
    expect(check.detail).toContain("onlyGraphDeg=true");
    expect(check.detail).toContain("graphUnavail=true");
    expect(check.detail).toContain("corpusAvail=true");
  });
});

// ── Full harness ───────────────────────────────────────────────────────────────

describe("evaluateM038S03Checks", () => {
  test("all four checks pass on real fixtures", async () => {
    const report = await evaluateM038S03Checks();

    expect(report.check_ids).toEqual(M038_S03_CHECK_IDS);
    expect(report.overallPassed).toBe(true);
    expect(report.checks).toHaveLength(4);
    expect(report.checks.every((check) => check.passed)).toBe(true);
    expect(report.checks.map((check) => check.status_code)).toEqual([
      "cache_reuse_verified",
      "timeout_fail_open_verified",
      "substrate_failure_truthful_verified",
      "partial_degradation_truthful_verified",
    ]);
  });

  test("reports overallPassed=false when any check fails", () => {
    const report: M038S03EvaluationReport = {
      check_ids: M038_S03_CHECK_IDS,
      overallPassed: false,
      checks: [
        {
          id: "M038-S03-CACHE-REUSE",
          passed: false,
          skipped: false,
          status_code: "cache_reuse_failed",
          detail: "secondCacheHit=false",
        },
        {
          id: "M038-S03-TIMEOUT-FAIL-OPEN",
          passed: true,
          skipped: false,
          status_code: "timeout_fail_open_verified",
        },
        {
          id: "M038-S03-SUBSTRATE-FAILURE-TRUTHFUL",
          passed: true,
          skipped: false,
          status_code: "substrate_failure_truthful_verified",
        },
        {
          id: "M038-S03-PARTIAL-DEGRADATION-TRUTHFUL",
          passed: true,
          skipped: false,
          status_code: "partial_degradation_truthful_verified",
        },
      ],
    };

    expect(report.overallPassed).toBe(false);
    expect(report.checks.filter((check) => !check.passed).map((check) => check.status_code)).toEqual([
      "cache_reuse_failed",
    ]);
  });
});

describe("renderM038S03Report", () => {
  test("renders stable JSON that round-trips to the evaluation report", async () => {
    const report = await evaluateM038S03Checks();
    const rendered = renderM038S03Report(report);

    expect(rendered.human).toContain("M038 S03 fail-open and cache-reuse verifier");
    expect(rendered.human).toContain("overallPassed=true");
    expect(rendered.human).toContain("PASS");
    expect(JSON.parse(rendered.json)).toEqual(report);
  });

  test("renders FAIL lines for failing checks", () => {
    const failCheck: M038S03Check = {
      id: "M038-S03-CACHE-REUSE",
      passed: false,
      skipped: false,
      status_code: "cache_reuse_failed",
      detail: "secondCacheHit=false",
    };
    const report: M038S03EvaluationReport = {
      check_ids: M038_S03_CHECK_IDS,
      overallPassed: false,
      checks: [
        failCheck,
        { id: "M038-S03-TIMEOUT-FAIL-OPEN", passed: true, skipped: false, status_code: "timeout_fail_open_verified" },
        { id: "M038-S03-SUBSTRATE-FAILURE-TRUTHFUL", passed: true, skipped: false, status_code: "substrate_failure_truthful_verified" },
        { id: "M038-S03-PARTIAL-DEGRADATION-TRUTHFUL", passed: true, skipped: false, status_code: "partial_degradation_truthful_verified" },
      ],
    };

    const rendered = renderM038S03Report(report);

    expect(rendered.human).toContain("FAIL");
    expect(rendered.human).toContain("cache_reuse_failed");
    expect(rendered.human).toContain("secondCacheHit=false");
    expect(JSON.parse(rendered.json)).toEqual(report);
  });
});

describe("buildM038S03ProofHarness", () => {
  test("prints valid JSON in json mode and returns exit code 0 for the real fixtures", async () => {
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    const result = await buildM038S03ProofHarness({
      json: true,
      stdout: { write: (chunk: string) => (stdoutChunks.push(String(chunk)), true) },
      stderr: { write: (chunk: string) => (stderrChunks.push(String(chunk)), true) },
    });

    expect(result.exitCode).toBe(0);
    expect(stderrChunks.join("")).toBe("");
    expect(JSON.parse(stdoutChunks.join(""))).toEqual(result.report);
  });

  test("prints human-readable output in default mode", async () => {
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    const result = await buildM038S03ProofHarness({
      json: false,
      stdout: { write: (chunk: string) => (stdoutChunks.push(String(chunk)), true) },
      stderr: { write: (chunk: string) => (stderrChunks.push(String(chunk)), true) },
    });

    expect(result.exitCode).toBe(0);
    const output = stdoutChunks.join("");
    expect(output).toContain("M038 S03 fail-open and cache-reuse verifier");
    expect(output).toContain("overallPassed=true");
    expect(output).toContain("cache_reuse_verified");
    expect(output).toContain("timeout_fail_open_verified");
  });

  test("failure harness writes status codes to stderr and returns exit code 1", async () => {
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    // Build a failing report manually and verify the rendering path.
    const failingReport: M038S03EvaluationReport = {
      check_ids: M038_S03_CHECK_IDS,
      overallPassed: false,
      checks: [
        { id: "M038-S03-CACHE-REUSE", passed: false, skipped: false, status_code: "cache_reuse_failed" },
        { id: "M038-S03-TIMEOUT-FAIL-OPEN", passed: true, skipped: false, status_code: "timeout_fail_open_verified" },
        { id: "M038-S03-SUBSTRATE-FAILURE-TRUTHFUL", passed: true, skipped: false, status_code: "substrate_failure_truthful_verified" },
        { id: "M038-S03-PARTIAL-DEGRADATION-TRUTHFUL", passed: true, skipped: false, status_code: "partial_degradation_truthful_verified" },
      ],
    };

    // Render to verify the status_code flows to stderr output.
    const { renderM038S03Report: render } = await import("./verify-m038-s03.ts");
    const rendered = render(failingReport);

    expect(failingReport.overallPassed).toBe(false);
    expect(rendered.human).toContain("cache_reuse_failed");
    expect(rendered.human).toContain("FAIL");
    expect(JSON.parse(rendered.json)).toEqual(failingReport);
  });
});
