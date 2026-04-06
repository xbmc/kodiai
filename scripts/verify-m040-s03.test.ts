/**
 * Tests for the M040 S03 proof harness.
 *
 * Covers all four check functions with:
 * - Real deterministic fixture runs (happy path)
 * - Synthetic fixture overrides verifying each failure condition
 * - Full evaluateM040S03() and buildM040S03ProofHarness() integration
 */

import { describe, test, expect } from "bun:test";
import {
  M040_S03_CHECK_IDS,
  evaluateM040S03,
  buildM040S03ProofHarness,
  runBoundednessCheck,
  runTrivialBypassCheck,
  runFailOpenCheck,
  runAnnotatesCheck,
  runBoundednessFixture,
  runTrivialBypassFixture,
  runFailOpenFixture,
  runAnnotatesFixture,
  type EvaluationReport,
  type BoundednessFixtureResult,
  type TrivialBypassFixtureResult,
  type FailOpenFixtureResult,
  type AnnotatesFixtureResult,
} from "./verify-m040-s03.ts";

// ── Shared fixture helpers ────────────────────────────────────────────

function makeBoundednessResult(
  overrides?: Partial<BoundednessFixtureResult>,
): BoundednessFixtureResult {
  return {
    charCount: 1800,
    maxChars: 2500,
    truncated: false,
    impactedFilesIncluded: 10,
    likelyTestsIncluded: 5,
    dependentsIncluded: 5,
    withinBudget: true,
    ...overrides,
  };
}

function makeTrivialBypassResult(
  overrides?: Partial<TrivialBypassFixtureResult>,
): TrivialBypassFixtureResult {
  return {
    smallPRBypass: true,
    smallPRReason: "file-count-1-lte-threshold-3",
    largePRBypass: false,
    largePRReason: "non-trivial",
    zeroPRBypass: false,
    zeroPRReason: "no-files",
    ...overrides,
  };
}

function makeFailOpenResult(
  overrides?: Partial<FailOpenFixtureResult>,
): FailOpenFixtureResult {
  return {
    succeeded: false,
    findingsCount: 2,
    validatedCount: 0,
    originalFindingsPreserved: true,
    neverThrew: true,
    ...overrides,
  };
}

function makeAnnotatesResult(
  overrides?: Partial<AnnotatesFixtureResult>,
): AnnotatesFixtureResult {
  return {
    validatedCount: 2,
    confirmedCount: 1,
    uncertainCount: 1,
    allAmplifiedAnnotated: true,
    directFindingSkipped: true,
    succeeded: true,
    ...overrides,
  };
}

// ── M040-S03-PROMPT-BOUNDED ───────────────────────────────────────────

describe("M040-S03-PROMPT-BOUNDED", () => {
  test("passes with the real deterministic fixture", async () => {
    const result = await runBoundednessCheck();

    expect(result.id).toBe("M040-S03-PROMPT-BOUNDED");
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.status_code).toBe("graph_context_section_within_char_budget");
    expect(result.detail).toContain("charCount=");
    expect(result.detail).toContain("maxChars=");
    expect(result.detail).toContain("withinBudget=true");
  });

  test("the real fixture section is within the default 2500-char budget", () => {
    const fixture = runBoundednessFixture();
    expect(fixture.charCount).toBeGreaterThan(0);
    expect(fixture.charCount).toBeLessThanOrEqual(fixture.maxChars);
    expect(fixture.withinBudget).toBe(true);
  });

  test("the real fixture includes rows from all three sub-lists or budget-truncated", () => {
    const fixture = runBoundednessFixture();
    const total =
      fixture.impactedFilesIncluded + fixture.likelyTestsIncluded + fixture.dependentsIncluded;
    expect(total).toBeGreaterThan(0);
  });

  test("boundedness: charCount is always within declared maxChars even at very tight budget", () => {
    // At 500 chars the header alone may consume most of the budget, leaving zero
    // rows included — but the section is still strictly within the budget.
    // The check function requires at least one row included to pass (non-vacuous),
    // so we test the invariant directly on the fixture output here.
    const fixture = runBoundednessFixture(500);
    expect(fixture.charCount).toBeLessThanOrEqual(fixture.maxChars);
    expect(fixture.withinBudget).toBe(true);
    // At 500 chars the blast-radius header consumes the budget so rows can be 0.
    // This is correct bounded behaviour (truncated=true signals the capping).
    expect(fixture.truncated).toBe(true);
  });

  test("fails when charCount exceeds maxChars", async () => {
    const result = await runBoundednessCheck(() =>
      makeBoundednessResult({ charCount: 3000, maxChars: 2500, withinBudget: false }),
    );

    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("prompt_bounded_check_failed");
    expect(result.detail).toContain("charCount=3000 exceeds maxChars=2500");
  });

  test("fails when section is completely empty despite non-empty blast radius", async () => {
    const result = await runBoundednessCheck(() =>
      makeBoundednessResult({
        charCount: 0,
        withinBudget: true,
        impactedFilesIncluded: 0,
        likelyTestsIncluded: 0,
        dependentsIncluded: 0,
      }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("no rows included");
  });
});

// ── M040-S03-TRIVIAL-BYPASS ───────────────────────────────────────────

describe("M040-S03-TRIVIAL-BYPASS", () => {
  test("passes with the real deterministic fixture", async () => {
    const result = await runTrivialBypassCheck();

    expect(result.id).toBe("M040-S03-TRIVIAL-BYPASS");
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.status_code).toBe("trivial_bypass_correctly_classifies_pr_size");
    expect(result.detail).toContain("smallPR bypass=true");
    expect(result.detail).toContain("largePR bypass=false");
    expect(result.detail).toContain("zeroPR bypass=false");
  });

  test("the real fixture bypasses small PRs", () => {
    const fixture = runTrivialBypassFixture();
    expect(fixture.smallPRBypass).toBe(true);
    expect(fixture.smallPRReason).toMatch(/file-count-1-lte-threshold/);
  });

  test("the real fixture does not bypass large PRs", () => {
    const fixture = runTrivialBypassFixture();
    expect(fixture.largePRBypass).toBe(false);
    expect(fixture.largePRReason).toBe("non-trivial");
  });

  test("the real fixture is fail-closed on zero-file PRs", () => {
    const fixture = runTrivialBypassFixture();
    expect(fixture.zeroPRBypass).toBe(false);
    expect(fixture.zeroPRReason).toBe("no-files");
  });

  test("custom threshold correctly classifies boundary files", () => {
    const fixture = runTrivialBypassFixture({ trivialFileThreshold: 5 });
    // 1 file ≤ 5 → bypass
    expect(fixture.smallPRBypass).toBe(true);
    // 10 files > 5 → no bypass
    expect(fixture.largePRBypass).toBe(false);
  });

  test("fails when small PR is not bypassed", async () => {
    const result = await runTrivialBypassCheck(() =>
      makeTrivialBypassResult({ smallPRBypass: false }),
    );

    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("trivial_bypass_check_failed");
    expect(result.detail).toContain("smallPR (1 file) should bypass");
  });

  test("fails when large PR is bypassed (false positive)", async () => {
    const result = await runTrivialBypassCheck(() =>
      makeTrivialBypassResult({ largePRBypass: true }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("largePR (10 files) should NOT bypass");
  });

  test("fails when zero-file PR is bypassed (fail-open violation)", async () => {
    const result = await runTrivialBypassCheck(() =>
      makeTrivialBypassResult({ zeroPRBypass: true }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("zeroPR (0 files) should be fail-closed");
  });
});

// ── M040-S03-FAIL-OPEN-VALIDATION ─────────────────────────────────────

describe("M040-S03-FAIL-OPEN-VALIDATION", () => {
  test("passes with the real deterministic fixture", async () => {
    const result = await runFailOpenCheck();

    expect(result.id).toBe("M040-S03-FAIL-OPEN-VALIDATION");
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.status_code).toBe("validation_fail_open_preserves_findings_on_llm_error");
    expect(result.detail).toContain("neverThrew=true");
    expect(result.detail).toContain("succeeded=false");
    expect(result.detail).toContain("originalFindingsPreserved=true");
    expect(result.detail).toContain("validatedCount=0");
  });

  test("the real fixture does not throw when LLM throws", async () => {
    const fixture = await runFailOpenFixture();
    expect(fixture.neverThrew).toBe(true);
  });

  test("the real fixture returns succeeded=false on LLM error", async () => {
    const fixture = await runFailOpenFixture();
    expect(fixture.succeeded).toBe(false);
  });

  test("the real fixture preserves original findings", async () => {
    const fixture = await runFailOpenFixture();
    expect(fixture.originalFindingsPreserved).toBe(true);
    expect(fixture.findingsCount).toBe(2);
    expect(fixture.validatedCount).toBe(0);
  });

  test("fails when validateGraphAmplifiedFindings throws instead of being fail-open", async () => {
    const result = await runFailOpenCheck(async () =>
      makeFailOpenResult({ neverThrew: false }),
    );

    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("fail_open_check_failed");
    expect(result.detail).toContain("threw an exception");
  });

  test("fails when succeeded=true after LLM error (should signal degraded path)", async () => {
    const result = await runFailOpenCheck(async () =>
      makeFailOpenResult({ succeeded: true }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("succeeded=true after LLM throw");
  });

  test("fails when original findings are not preserved after LLM error", async () => {
    const result = await runFailOpenCheck(async () =>
      makeFailOpenResult({ originalFindingsPreserved: false }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("original findings were not preserved");
  });

  test("fails when validatedCount is non-zero after LLM error", async () => {
    const result = await runFailOpenCheck(async () =>
      makeFailOpenResult({ validatedCount: 3 }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("validatedCount=3 expected 0");
  });
});

// ── M040-S03-VALIDATION-ANNOTATES ─────────────────────────────────────

describe("M040-S03-VALIDATION-ANNOTATES", () => {
  test("passes with the real deterministic fixture", async () => {
    const result = await runAnnotatesCheck();

    expect(result.id).toBe("M040-S03-VALIDATION-ANNOTATES");
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.status_code).toBe("validation_annotates_amplified_findings_correctly");
    expect(result.detail).toContain("succeeded=true");
    expect(result.detail).toContain("allAmplifiedAnnotated=true");
    expect(result.detail).toContain("directFindingSkipped=true");
  });

  test("the real fixture annotates both graph-amplified findings", async () => {
    const fixture = await runAnnotatesFixture();
    expect(fixture.allAmplifiedAnnotated).toBe(true);
    expect(fixture.validatedCount).toBe(2);
  });

  test("the real fixture skips directly-changed-file findings", async () => {
    const fixture = await runAnnotatesFixture();
    expect(fixture.directFindingSkipped).toBe(true);
  });

  test("the real fixture reports correct confirmed and uncertain counts", async () => {
    const fixture = await runAnnotatesFixture();
    // LLM returns "1: CONFIRMED\n2: UNCERTAIN"
    expect(fixture.confirmedCount).toBe(1);
    expect(fixture.uncertainCount).toBe(1);
    expect(fixture.confirmedCount + fixture.uncertainCount).toBe(fixture.validatedCount);
  });

  test("the real fixture returns succeeded=true", async () => {
    const fixture = await runAnnotatesFixture();
    expect(fixture.succeeded).toBe(true);
  });

  test("fails when validation did not succeed", async () => {
    const result = await runAnnotatesCheck(async () =>
      makeAnnotatesResult({ succeeded: false }),
    );

    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("validation_annotates_check_failed");
    expect(result.detail).toContain("validation did not succeed");
  });

  test("fails when amplified findings are not annotated", async () => {
    const result = await runAnnotatesCheck(async () =>
      makeAnnotatesResult({ allAmplifiedAnnotated: false }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("not all graph-amplified findings were annotated");
  });

  test("fails when directly-changed-file finding is not skipped", async () => {
    const result = await runAnnotatesCheck(async () =>
      makeAnnotatesResult({ directFindingSkipped: false }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("directly-changed-file finding was not skipped");
  });

  test("fails when validatedCount is 0", async () => {
    const result = await runAnnotatesCheck(async () =>
      makeAnnotatesResult({ validatedCount: 0 }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("validatedCount=0");
  });

  test("fails when confirmed + uncertain counts mismatch validatedCount", async () => {
    const result = await runAnnotatesCheck(async () =>
      makeAnnotatesResult({ validatedCount: 2, confirmedCount: 2, uncertainCount: 2 }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("confirmedCount=2 + uncertainCount=2 !== validatedCount=2");
  });
});

// ── evaluateM040S03 integration ───────────────────────────────────────

describe("evaluateM040S03", () => {
  test("returns check_ids matching the exported constant", async () => {
    const report = await evaluateM040S03({
      _boundednessRunFn: () => makeBoundednessResult(),
      _trivialBypassRunFn: () => makeTrivialBypassResult(),
      _failOpenRunFn: async () => makeFailOpenResult(),
      _annotatesRunFn: async () => makeAnnotatesResult(),
    });

    expect(report.check_ids).toEqual(M040_S03_CHECK_IDS);
    expect(report.checks).toHaveLength(4);
    expect(report.overallPassed).toBe(true);
  });

  test("overallPassed is false when any check fails", async () => {
    const report = await evaluateM040S03({
      _boundednessRunFn: () => makeBoundednessResult({ withinBudget: false, charCount: 3000 }),
      _trivialBypassRunFn: () => makeTrivialBypassResult(),
      _failOpenRunFn: async () => makeFailOpenResult(),
      _annotatesRunFn: async () => makeAnnotatesResult(),
    });

    expect(report.overallPassed).toBe(false);
    const failedCheck = report.checks.find((c) => !c.passed);
    expect(failedCheck?.id).toBe("M040-S03-PROMPT-BOUNDED");
  });

  test("passes with all real deterministic fixtures end-to-end", async () => {
    const report = await evaluateM040S03();

    expect(report.overallPassed).toBe(true);
    expect(report.checks.every((c) => c.passed)).toBe(true);
  });
});

// ── buildM040S03ProofHarness ─────────────────────────────────────────

describe("buildM040S03ProofHarness", () => {
  test("returns exitCode=0 when all checks pass", async () => {
    const output: string[] = [];
    const { exitCode } = await buildM040S03ProofHarness({
      _boundednessRunFn: () => makeBoundednessResult(),
      _trivialBypassRunFn: () => makeTrivialBypassResult(),
      _failOpenRunFn: async () => makeFailOpenResult(),
      _annotatesRunFn: async () => makeAnnotatesResult(),
      stdout: { write: (s) => void output.push(s) },
      stderr: { write: () => {} },
    });

    expect(exitCode).toBe(0);
    expect(output.join("")).toContain("PASS");
  });

  test("returns exitCode=1 when any check fails", async () => {
    const stderrLines: string[] = [];
    const { exitCode } = await buildM040S03ProofHarness({
      _boundednessRunFn: () => makeBoundednessResult({ withinBudget: false, charCount: 3000 }),
      _trivialBypassRunFn: () => makeTrivialBypassResult(),
      _failOpenRunFn: async () => makeFailOpenResult(),
      _annotatesRunFn: async () => makeAnnotatesResult(),
      stdout: { write: () => {} },
      stderr: { write: (s) => void stderrLines.push(s) },
    });

    expect(exitCode).toBe(1);
    expect(stderrLines.join("")).toContain("verify:m040:s03 failed");
  });

  test("emits JSON when --json flag is used via opts.json=true", async () => {
    const output: string[] = [];
    await buildM040S03ProofHarness({
      _boundednessRunFn: () => makeBoundednessResult(),
      _trivialBypassRunFn: () => makeTrivialBypassResult(),
      _failOpenRunFn: async () => makeFailOpenResult(),
      _annotatesRunFn: async () => makeAnnotatesResult(),
      stdout: { write: (s) => void output.push(s) },
      stderr: { write: () => {} },
      json: true,
    });

    const combined = output.join("");
    const parsed: EvaluationReport = JSON.parse(combined);
    expect(parsed.check_ids).toEqual(M040_S03_CHECK_IDS);
    expect(parsed.overallPassed).toBe(true);
    expect(parsed.checks).toHaveLength(4);
  });

  test("JSON output has all expected check IDs", async () => {
    const output: string[] = [];
    await buildM040S03ProofHarness({
      stdout: { write: (s) => void output.push(s) },
      stderr: { write: () => {} },
      json: true,
    });

    const parsed: EvaluationReport = JSON.parse(output.join(""));
    const ids = parsed.checks.map((c) => c.id);
    for (const expectedId of M040_S03_CHECK_IDS) {
      expect(ids).toContain(expectedId);
    }
  });

  test("text output contains Final verdict and check status lines", async () => {
    const output: string[] = [];
    await buildM040S03ProofHarness({
      _boundednessRunFn: () => makeBoundednessResult(),
      _trivialBypassRunFn: () => makeTrivialBypassResult(),
      _failOpenRunFn: async () => makeFailOpenResult(),
      _annotatesRunFn: async () => makeAnnotatesResult(),
      stdout: { write: (s) => void output.push(s) },
      stderr: { write: () => {} },
    });

    const text = output.join("");
    expect(text).toContain("Final verdict: PASS");
    expect(text).toContain("M040-S03-PROMPT-BOUNDED PASS");
    expect(text).toContain("M040-S03-TRIVIAL-BYPASS PASS");
    expect(text).toContain("M040-S03-FAIL-OPEN-VALIDATION PASS");
    expect(text).toContain("M040-S03-VALIDATION-ANNOTATES PASS");
  });
});
