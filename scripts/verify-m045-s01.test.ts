import { describe, expect, test } from "bun:test";
import {
  M045_S01_CHECK_IDS,
  M045_S01_SCENARIO_IDS,
  buildGitHubReviewContractFixture,
  buildM045S01ProofHarness,
  evaluateM045S01,
  getGitHubReviewContractScenario,
  runScenarioPromptTruthfulCheck,
  runScenarioReviewDetailsTruthfulCheck,
} from "./verify-m045-s01.ts";

type ScenarioId = (typeof M045_S01_SCENARIO_IDS)[number];
type Fixture = ReturnType<typeof buildGitHubReviewContractFixture>;

function makeFixture(scenarioId: ScenarioId, overrides?: Partial<Fixture>): Fixture {
  return {
    ...buildGitHubReviewContractFixture({ scenarioId, prAuthor: "CrystalP" }),
    ...overrides,
  };
}

describe("buildGitHubReviewContractFixture", () => {
  test("renders all five contract scenarios without raw tier leakage in Review Details", () => {
    const fixtures = M045_S01_SCENARIO_IDS.map((scenarioId) =>
      buildGitHubReviewContractFixture({ scenarioId, prAuthor: "octocat" })
    );

    expect(fixtures.map((fixture) => fixture.scenarioId)).toEqual([...M045_S01_SCENARIO_IDS]);
    expect(fixtures.map((fixture) => fixture.contract.state)).toEqual([
      "profile-backed",
      "coarse-fallback",
      "generic-unknown",
      "generic-opt-out",
      "generic-degraded",
    ]);
    expect(fixtures.every((fixture) => fixture.reviewDetailsBody.includes("- Contributor experience:"))).toBe(true);
    expect(fixtures.every((fixture) => !fixture.reviewDetailsBody.includes("- Author tier:"))).toBe(true);

    const degradedFixture = fixtures.find((fixture) => fixture.scenarioId === "generic-degraded");
    expect(degradedFixture?.promptSurfaceText).toContain("## Search API Degradation Context");
    expect(degradedFixture?.promptSurfaceText).toContain("Analysis is partial due to API limits.");
  });
});

describe("runScenarioPromptTruthfulCheck", () => {
  test("passes for the real profile-backed scenario fixture", async () => {
    const result = await runScenarioPromptTruthfulCheck("profile-backed");

    expect(result.id).toBe("M045-S01-PROFILE-BACKED-PROMPT-TRUTHFUL");
    expect(result.passed).toBe(true);
    expect(result.status_code).toBe("profile_backed_prompt_contract_truthful");
  });

  test("fails with scenario-specific diagnostics when the prompt fixture is malformed", async () => {
    const result = await runScenarioPromptTruthfulCheck("profile-backed", (scenarioId) =>
      makeFixture(scenarioId, {
        promptAuthorSection: [
          "## Author Experience Context",
          "",
          "The PR author (CrystalP) is an established contributor.",
        ].join("\n"),
        promptSurfaceText: [
          "## Author Experience Context",
          "",
          "The PR author (CrystalP) is an established contributor.",
        ].join("\n"),
      }),
    );

    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("prompt_contract_truthfulness_failed");
    expect(result.detail).toContain("scenario=profile-backed");
    expect(result.detail).toContain("contractState=profile-backed");
    expect(result.detail).toContain("missing required prompt phrases");
  });
});

describe("runScenarioReviewDetailsTruthfulCheck", () => {
  test("passes for the real opted-out scenario fixture", async () => {
    const result = await runScenarioReviewDetailsTruthfulCheck("generic-opt-out");

    expect(result.id).toBe("M045-S01-GENERIC-OPT-OUT-DETAILS-TRUTHFUL");
    expect(result.passed).toBe(true);
    expect(result.status_code).toBe("generic_opt_out_review_details_contract_truthful");
  });

  test("fails when opted-out review details leak adapted profile-backed guidance", async () => {
    const result = await runScenarioReviewDetailsTruthfulCheck("generic-opt-out", (scenarioId) =>
      makeFixture(scenarioId, {
        reviewDetailsBody: [
          "<details>",
          "<summary>Review Details</summary>",
          "",
          "- Contributor experience: profile-backed (using linked contributor profile guidance)",
          "- Profile ID: profile-17",
          "</details>",
        ].join("\n"),
      }),
    );

    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("review_details_contract_truthfulness_failed");
    expect(result.detail).toContain("scenario=generic-opt-out");
    expect(result.detail).toContain("contractState=generic-opt-out");
    expect(result.detail).toContain("unexpected review-details phrases present");
  });
});

describe("evaluateM045S01", () => {
  test("covers all five contract scenarios and emits one prompt/details check per scenario", async () => {
    const report = await evaluateM045S01();

    expect(report.check_ids).toEqual(M045_S01_CHECK_IDS);
    expect(report.checks).toHaveLength(M045_S01_CHECK_IDS.length);
    expect(report.overallPassed).toBe(true);
    expect(report.scenarios.map((scenario) => scenario.scenarioId)).toEqual([...M045_S01_SCENARIO_IDS]);
    expect(report.scenarios.map((scenario) => scenario.contractState)).toEqual(
      M045_S01_SCENARIO_IDS.map((scenarioId) => getGitHubReviewContractScenario(scenarioId).contract.state),
    );
    expect(report.scenarios.every((scenario) => scenario.prompt.passed && scenario.reviewDetails.passed)).toBe(true);
  });

  test("surfaces degraded overclaim drift as named prompt and review-details failures", async () => {
    const report = await evaluateM045S01({
      _runFixture: (scenarioId) => {
        if (scenarioId !== "generic-degraded") {
          return buildGitHubReviewContractFixture({ scenarioId, prAuthor: "CrystalP" });
        }

        return makeFixture(scenarioId, {
          promptAuthorSection: [
            "## Author Experience Context",
            "",
            "Contributor-experience contract: generic-degraded.",
            "The PR author (CrystalP) is an established contributor.",
          ].join("\n"),
          promptSurfaceText: [
            "## Author Experience Context",
            "",
            "Contributor-experience contract: generic-degraded.",
            "The PR author (CrystalP) is an established contributor.",
          ].join("\n"),
          reviewDetailsBody: [
            "<details>",
            "<summary>Review Details</summary>",
            "",
            "- Contributor experience: profile-backed (using linked contributor profile guidance)",
            "</details>",
          ].join("\n"),
        });
      },
    });

    expect(report.overallPassed).toBe(false);
    expect(
      report.checks.find((check) => check.id === "M045-S01-GENERIC-DEGRADED-PROMPT-TRUTHFUL")?.detail,
    ).toContain("unexpected prompt phrases present");
    expect(
      report.checks.find((check) => check.id === "M045-S01-GENERIC-DEGRADED-DETAILS-TRUTHFUL")?.detail,
    ).toContain("unexpected review-details phrases present");
  });
});

describe("buildM045S01ProofHarness", () => {
  test("returns exitCode=0 and human-readable scenario output when the matrix passes", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const { exitCode } = await buildM045S01ProofHarness({
      stdout: { write: (chunk) => void stdout.push(chunk) },
      stderr: { write: (chunk) => void stderr.push(chunk) },
    });

    expect(exitCode).toBe(0);
    expect(stderr.join("")).toBe("");
    expect(stdout.join("")).toContain("Final verdict: PASS");
    expect(stdout.join("")).toContain("profile-backed");
    expect(stdout.join("")).toContain("generic-degraded");
  });

  test("emits JSON with scenario names, contract states, and phrase mismatch detail", async () => {
    const stdout: string[] = [];

    await buildM045S01ProofHarness({
      stdout: { write: (chunk) => void stdout.push(chunk) },
      stderr: { write: () => {} },
      json: true,
    });

    const parsed = JSON.parse(stdout.join(""));
    expect(parsed.check_ids).toEqual(M045_S01_CHECK_IDS);
    expect(parsed.scenarios.map((scenario: { scenarioId: string }) => scenario.scenarioId)).toEqual(
      [...M045_S01_SCENARIO_IDS],
    );
    expect(parsed.scenarios[0]).toHaveProperty("contractState");
    expect(parsed.scenarios[0]?.prompt).toHaveProperty("missingPhrases");
    expect(parsed.scenarios[0]?.reviewDetails).toHaveProperty("unexpectedPhrases");
  });
});
