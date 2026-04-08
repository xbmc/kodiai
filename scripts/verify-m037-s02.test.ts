import { describe, test, expect } from "bun:test";
import {
  M037_S02_CHECK_IDS,
  evaluateM037S02,
  buildM037S02ProofHarness,
  runScoringChangesCheck,
  runSafetyGuardCheck,
  runFailOpenCheck,
} from "./verify-m037-s02.ts";
import type {
  EvaluationReport,
  ScoringChangesFixtureResult,
  SafetyGuardFixtureResult,
  FailOpenFixtureResult,
} from "./verify-m037-s02.ts";
import {
  SUPPRESSION_THRESHOLD,
  BOOST_THRESHOLD,
  CONFIDENCE_BOOST_DELTA,
} from "../src/knowledge/suggestion-cluster-scoring.ts";

// ── Shared fixture helpers ────────────────────────────────────────────

function makeScoringChangesResult(
  overrides?: Partial<ScoringChangesFixtureResult>,
): ScoringChangesFixtureResult {
  return {
    naiveSuppressed: false,
    scoredSuppressed: true,
    originalConfidence: 55,
    scoredConfidence: Math.min(100, 55 + CONFIDENCE_BOOST_DELTA),
    modelUsed: true,
    ...overrides,
  };
}

function makeSafetyGuardResult(
  overrides?: Partial<SafetyGuardFixtureResult>,
): SafetyGuardFixtureResult {
  return {
    criticalSuppressed: false,
    criticalBoosted: false,
    criticalNegativeScore: 1.0, // colinear → above SUPPRESSION_THRESHOLD
    criticalPositiveScore: 1.0, // colinear → above BOOST_THRESHOLD
    ...overrides,
  };
}

function makeFailOpenResult(
  overrides?: Partial<FailOpenFixtureResult>,
): FailOpenFixtureResult {
  return {
    modelUsed: false,
    allUnsuppressed: true,
    confidenceUnchanged: true,
    findingCount: 3,
    ...overrides,
  };
}

// ── M037-S02-SCORING-CHANGES-FINDINGS ────────────────────────────────

describe("M037-S02-SCORING-CHANGES-FINDINGS", () => {
  test("passes with the real deterministic fixture", async () => {
    const result = await runScoringChangesCheck();

    expect(result.id).toBe("M037-S02-SCORING-CHANGES-FINDINGS");
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.status_code).toBe("scoring_suppressed_and_boosted");
    expect(result.detail).toContain("naiveSuppressed=false");
    expect(result.detail).toContain("scoredSuppressed=true");
  });

  test("fails when naive path incorrectly suppresses finding", async () => {
    const result = await runScoringChangesCheck(
      async (): Promise<ScoringChangesFixtureResult> =>
        makeScoringChangesResult({ naiveSuppressed: true }),
    );

    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("scoring_mismatch");
    expect(result.detail).toContain("naive path (no model) suppressed finding");
  });

  test("fails when scored path did not suppress the matching finding", async () => {
    const result = await runScoringChangesCheck(
      async (): Promise<ScoringChangesFixtureResult> =>
        makeScoringChangesResult({ scoredSuppressed: false }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("scored path did not suppress finding");
  });

  test("fails when modelUsed=false in scored path", async () => {
    const result = await runScoringChangesCheck(
      async (): Promise<ScoringChangesFixtureResult> =>
        makeScoringChangesResult({ modelUsed: false }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("modelUsed=false");
  });

  test("fails when confidence was not boosted", async () => {
    const original = 55;
    const result = await runScoringChangesCheck(
      async (): Promise<ScoringChangesFixtureResult> =>
        makeScoringChangesResult({
          originalConfidence: original,
          scoredConfidence: original, // no boost applied
        }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("boost candidate confidence=");
  });

  test("passes when confidence is correctly clamped to 100", async () => {
    // original=95, delta=15 → clamped to 100
    const result = await runScoringChangesCheck(
      async (): Promise<ScoringChangesFixtureResult> =>
        makeScoringChangesResult({
          originalConfidence: 95,
          scoredConfidence: 100,
        }),
    );

    expect(result.passed).toBe(true);
  });
});

// ── M037-S02-SAFETY-GUARD-CRITICAL ────────────────────────────────────

describe("M037-S02-SAFETY-GUARD-CRITICAL", () => {
  test("passes with the real deterministic fixture", async () => {
    const result = await runSafetyGuardCheck();

    expect(result.id).toBe("M037-S02-SAFETY-GUARD-CRITICAL");
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.status_code).toBe("critical_findings_protected");
    // Verify the detail proves the guard was actually exercised
    expect(result.detail).toContain("suppressed=false");
    expect(result.detail).toContain("boosted=false");
  });

  test("fails when CRITICAL finding was suppressed", async () => {
    const result = await runSafetyGuardCheck(
      async (): Promise<SafetyGuardFixtureResult> =>
        makeSafetyGuardResult({ criticalSuppressed: true }),
    );

    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("safety_guard_failed");
    expect(result.detail).toContain("CRITICAL finding was suppressed");
  });

  test("fails when CRITICAL finding confidence was boosted", async () => {
    const result = await runSafetyGuardCheck(
      async (): Promise<SafetyGuardFixtureResult> =>
        makeSafetyGuardResult({ criticalBoosted: true }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("CRITICAL finding confidence was boosted");
  });

  test("fails when criticalNegativeScore was null (guard not exercised)", async () => {
    const result = await runSafetyGuardCheck(
      async (): Promise<SafetyGuardFixtureResult> =>
        makeSafetyGuardResult({ criticalNegativeScore: null }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("criticalNegativeScore=null");
  });

  test("fails when criticalNegativeScore is below SUPPRESSION_THRESHOLD", async () => {
    const result = await runSafetyGuardCheck(
      async (): Promise<SafetyGuardFixtureResult> =>
        makeSafetyGuardResult({ criticalNegativeScore: SUPPRESSION_THRESHOLD - 0.1 }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("guard condition not exercised");
  });

  test("fails when criticalPositiveScore is below BOOST_THRESHOLD", async () => {
    const result = await runSafetyGuardCheck(
      async (): Promise<SafetyGuardFixtureResult> =>
        makeSafetyGuardResult({ criticalPositiveScore: BOOST_THRESHOLD - 0.1 }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("guard condition not exercised");
  });
});

// ── M037-S02-FAIL-OPEN ────────────────────────────────────────────────

describe("M037-S02-FAIL-OPEN", () => {
  test("passes with the real deterministic fixture", async () => {
    const result = await runFailOpenCheck();

    expect(result.id).toBe("M037-S02-FAIL-OPEN");
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.status_code).toBe("fail_open_preserved_all_findings");
    expect(result.detail).toContain("modelUsed=false");
    expect(result.detail).toContain("allUnsuppressed=true");
    expect(result.detail).toContain("findingCount=3");
  });

  test("fails when modelUsed=true for null model path", async () => {
    const result = await runFailOpenCheck(
      async (): Promise<FailOpenFixtureResult> =>
        makeFailOpenResult({ modelUsed: true }),
    );

    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("fail_open_mutated_findings");
    expect(result.detail).toContain("modelUsed=true for null model");
  });

  test("fails when findings were suppressed in fail-open path", async () => {
    const result = await runFailOpenCheck(
      async (): Promise<FailOpenFixtureResult> =>
        makeFailOpenResult({ allUnsuppressed: false }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("some findings were suppressed");
  });

  test("fails when confidence changed in fail-open path", async () => {
    const result = await runFailOpenCheck(
      async (): Promise<FailOpenFixtureResult> =>
        makeFailOpenResult({ confidenceUnchanged: false }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("finding confidence changed");
  });

  test("fails when findingCount does not match expected", async () => {
    const result = await runFailOpenCheck(
      async (): Promise<FailOpenFixtureResult> =>
        makeFailOpenResult({ findingCount: 2 }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("findingCount=2 expected 3");
  });
});

// ── evaluateM037S02 ───────────────────────────────────────────────────

describe("evaluateM037S02", () => {
  test("returns all three check ids and passes with real fixtures", async () => {
    const report = await evaluateM037S02();

    expect(report.check_ids).toStrictEqual(M037_S02_CHECK_IDS);
    expect(report.checks.length).toBe(3);
    expect(report.overallPassed).toBe(true);
    expect(report.checks.every((c) => c.passed && !c.skipped)).toBe(true);
  });

  test("overallPassed is false when one check fails", async () => {
    const report = await evaluateM037S02({
      _safetyGuardRunFn: async (): Promise<SafetyGuardFixtureResult> =>
        makeSafetyGuardResult({ criticalSuppressed: true }),
    });

    expect(report.overallPassed).toBe(false);
    const failing = report.checks.filter((c) => !c.passed);
    expect(failing.length).toBe(1);
    expect(failing[0]!.id).toBe("M037-S02-SAFETY-GUARD-CRITICAL");
  });

  test("overallPassed is false when multiple checks fail", async () => {
    const report = await evaluateM037S02({
      _scoringChangesRunFn: async (): Promise<ScoringChangesFixtureResult> =>
        makeScoringChangesResult({ scoredSuppressed: false }),
      _failOpenRunFn: async (): Promise<FailOpenFixtureResult> =>
        makeFailOpenResult({ modelUsed: true }),
    });

    expect(report.overallPassed).toBe(false);
    const failingIds = report.checks.filter((c) => !c.passed).map((c) => c.id);
    expect(failingIds).toContain("M037-S02-SCORING-CHANGES-FINDINGS");
    expect(failingIds).toContain("M037-S02-FAIL-OPEN");
  });
});

// ── buildM037S02ProofHarness ──────────────────────────────────────────

describe("buildM037S02ProofHarness", () => {
  test("prints text output containing all three check ids", async () => {
    const chunks: string[] = [];
    const stdout = { write: (s: string) => { chunks.push(s); } };
    const stderr = { write: (_s: string) => {} };

    const { exitCode } = await buildM037S02ProofHarness({ stdout, stderr });
    const output = chunks.join("");

    expect(exitCode).toBe(0);
    expect(output).toContain("M037-S02-SCORING-CHANGES-FINDINGS");
    expect(output).toContain("M037-S02-SAFETY-GUARD-CRITICAL");
    expect(output).toContain("M037-S02-FAIL-OPEN");
    expect(output).toContain("Final verdict: PASS");
  });

  test("prints valid JSON in json mode", async () => {
    const chunks: string[] = [];
    const stdout = { write: (s: string) => { chunks.push(s); } };
    const stderr = { write: (_s: string) => {} };

    await buildM037S02ProofHarness({ stdout, stderr, json: true });
    const parsed = JSON.parse(chunks.join("")) as EvaluationReport;

    expect(parsed.check_ids).toStrictEqual(Array.from(M037_S02_CHECK_IDS));
    expect(parsed.checks.length).toBe(3);
    expect(typeof parsed.overallPassed).toBe("boolean");
    expect(parsed.overallPassed).toBe(true);
  });

  test("returns exitCode 1 and stderr message when a check fails", async () => {
    const stdout = { write: (_s: string) => {} };
    const stderrChunks: string[] = [];
    const stderr = { write: (s: string) => { stderrChunks.push(s); } };

    const { exitCode } = await buildM037S02ProofHarness({
      stdout,
      stderr,
      _failOpenRunFn: async (): Promise<FailOpenFixtureResult> =>
        makeFailOpenResult({ allUnsuppressed: false }),
    });

    expect(exitCode).toBe(1);
    expect(stderrChunks.join("")).toContain("verify:m037:s02 failed");
    expect(stderrChunks.join("")).toContain("M037-S02-FAIL-OPEN");
  });

  test("JSON output has correct shape when a check fails", async () => {
    const chunks: string[] = [];
    const stdout = { write: (s: string) => { chunks.push(s); } };
    const stderr = { write: (_s: string) => {} };

    await buildM037S02ProofHarness({
      stdout,
      stderr,
      json: true,
      _safetyGuardRunFn: async (): Promise<SafetyGuardFixtureResult> =>
        makeSafetyGuardResult({ criticalSuppressed: true, criticalBoosted: true }),
    });

    const parsed = JSON.parse(chunks.join("")) as EvaluationReport;
    expect(parsed.overallPassed).toBe(false);
    const failing = parsed.checks.filter((c) => !c.passed);
    expect(failing.length).toBeGreaterThan(0);
    expect(failing[0]!.id).toBe("M037-S02-SAFETY-GUARD-CRITICAL");
  });
});
