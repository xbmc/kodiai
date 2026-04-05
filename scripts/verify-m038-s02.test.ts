import { describe, expect, test } from "bun:test";
import {
  M038_S02_CHECK_IDS,
  buildM038S02ProofHarness,
  createM038S02Fixtures,
  evaluateM038S02Checks,
  renderM038S02Report,
  renderM038S02Scenario,
  type M038S02EvaluationReport,
  type M038S02ScenarioOutput,
} from "./verify-m038-s02.ts";

function makeScenario(
  id: "cpp" | "python",
  overrides: Partial<M038S02ScenarioOutput> = {},
): M038S02ScenarioOutput {
  const language = id === "cpp" ? "C++" : "Python";
  return {
    id,
    language,
    promptIncludesStructuralSection: true,
    reviewDetailsIncludesStructuralSection: true,
    reviewDetailsIncludesChangedSymbol: true,
    reviewDetailsIncludesCaller: true,
    reviewDetailsIncludesImpactedFile: true,
    reviewDetailsIncludesLikelyTest: true,
    reviewDetailsIncludesEvidencePath: true,
    reviewDetailsIncludesRenderedCounts: true,
    promptUsesStructuralBreakingChangeWording: true,
    promptStructuralImpactHeadingCount: 1,
    reviewDetailsStructuralImpactHeadingCount: 1,
    ...overrides,
  };
}

describe("renderM038S02Scenario", () => {
  test("real C++ fixture renders one bounded structural impact section in prompt and Review Details", () => {
    const cppFixture = createM038S02Fixtures().find((fixture) => fixture.id === "cpp");
    expect(cppFixture).toBeDefined();

    const rendered = renderM038S02Scenario(cppFixture!);

    expect(rendered.prompt).toContain("## Structural Impact Evidence");
    expect(rendered.reviewDetails).toContain("### Structural Impact");
    expect(rendered.reviewDetails).toContain(cppFixture!.expected.changedSymbol);
    expect(rendered.reviewDetails).toContain(cppFixture!.expected.callerPath);
    expect(rendered.reviewDetails).toContain(cppFixture!.expected.impactedFilePath);
    expect(rendered.reviewDetails).toContain(cppFixture!.expected.likelyTestPath);
    expect(rendered.reviewDetails).toContain(cppFixture!.expected.evidencePath);
    expect(rendered.reviewDetails).toContain(cppFixture!.expected.renderedCountsLine);
    expect(rendered.output.promptStructuralImpactHeadingCount).toBe(1);
    expect(rendered.output.reviewDetailsStructuralImpactHeadingCount).toBe(1);
  });

  test("real Python fixture strengthens breaking-change wording from structural evidence", () => {
    const pythonFixture = createM038S02Fixtures().find((fixture) => fixture.id === "python");
    expect(pythonFixture).toBeDefined();

    const rendered = renderM038S02Scenario(pythonFixture!);

    expect(rendered.prompt).toContain(pythonFixture!.expected.breakingChangePhrase);
    expect(rendered.reviewDetails).toContain(pythonFixture!.expected.callerPath);
    expect(rendered.reviewDetails).toContain(pythonFixture!.expected.impactedFilePath);
    expect(rendered.reviewDetails).toContain(pythonFixture!.expected.renderedCountsLine);
    expect(rendered.output.promptUsesStructuralBreakingChangeWording).toBe(true);
  });
});

describe("evaluateM038S02Checks", () => {
  test("passes when both C++ and Python scenarios satisfy the proof contract", () => {
    const report = evaluateM038S02Checks([
      makeScenario("cpp"),
      makeScenario("python"),
    ]);

    expect(report.check_ids).toEqual(M038_S02_CHECK_IDS);
    expect(report.overallPassed).toBe(true);
    expect(report.checks.map((check) => check.status_code)).toEqual([
      "cpp_review_details_structural_impact_rendered",
      "python_breaking_change_structural_evidence_rendered",
    ]);
  });

  test("fails the C++ check when Review Details omits the rendered counts line", () => {
    const report = evaluateM038S02Checks([
      makeScenario("cpp", { reviewDetailsIncludesRenderedCounts: false }),
      makeScenario("python"),
    ]);

    expect(report.overallPassed).toBe(false);
    expect(report.checks[0]?.passed).toBe(false);
    expect(report.checks[0]?.status_code).toBe("cpp_review_details_structural_impact_missing");
    expect(report.checks[0]?.detail).toContain("renderedCounts=false");
  });

  test("fails the Python check when prompt breaking-change wording does not use structural evidence", () => {
    const report = evaluateM038S02Checks([
      makeScenario("cpp"),
      makeScenario("python", { promptUsesStructuralBreakingChangeWording: false }),
    ]);

    expect(report.overallPassed).toBe(false);
    expect(report.checks[1]?.passed).toBe(false);
    expect(report.checks[1]?.status_code).toBe("python_breaking_change_structural_evidence_missing");
    expect(report.checks[1]?.detail).toContain("structuralBreakingChangeWording=false");
  });
});

describe("renderM038S02Report", () => {
  test("renders stable JSON that round-trips to the evaluation report", () => {
    const report: M038S02EvaluationReport = evaluateM038S02Checks([
      makeScenario("cpp"),
      makeScenario("python"),
    ]);

    const rendered = renderM038S02Report(report);

    expect(rendered.human).toContain("M038 S02 structural impact rendering verifier");
    expect(JSON.parse(rendered.json)).toEqual(report);
  });
});

describe("buildM038S02ProofHarness", () => {
  test("prints valid JSON in json mode and returns exit code 0 for the real fixtures", async () => {
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    const result = await buildM038S02ProofHarness({
      json: true,
      stdout: { write: (chunk: string) => (stdoutChunks.push(String(chunk)), true) },
      stderr: { write: (chunk: string) => (stderrChunks.push(String(chunk)), true) },
    });

    expect(result.exitCode).toBe(0);
    expect(stderrChunks.join("")).toBe("");
    expect(JSON.parse(stdoutChunks.join(""))).toEqual(result.report);
  });

  test("failure report rendering preserves stable stderr-style status codes", () => {
    const report: M038S02EvaluationReport = {
      check_ids: M038_S02_CHECK_IDS,
      overallPassed: false,
      checks: [
        {
          id: "M038-S02-CPP-REVIEW-DETAILS-STRUCTURAL-IMPACT",
          passed: false,
          skipped: false,
          status_code: "cpp_review_details_structural_impact_missing",
        },
        {
          id: "M038-S02-PYTHON-BREAKING-CHANGE-EVIDENCE",
          passed: true,
          skipped: false,
          status_code: "python_breaking_change_structural_evidence_rendered",
        },
      ],
      scenarios: [makeScenario("cpp"), makeScenario("python")],
    };

    const rendered = renderM038S02Report(report);

    expect(report.overallPassed).toBe(false);
    expect(report.checks.filter((check) => !check.passed).map((check) => check.status_code)).toEqual([
      "cpp_review_details_structural_impact_missing",
    ]);
    expect(rendered.human).toContain("cpp_review_details_structural_impact_missing");
    expect(JSON.parse(rendered.json)).toEqual(report);
  });
});
