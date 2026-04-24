import { describe, expect, test } from "bun:test";

type JsonReport = {
  command: string;
  generated_at: string;
  scenario_count: number;
  success: boolean;
  status_code: string;
  scenarios: Array<{
    scenarioId: string;
    success: boolean;
    statusCode: string;
    familyKey: string;
    baseReviewOutputKey: string;
    authoritativeAttemptId: string | null;
    authoritativeAttemptOrdinal: number | null;
    authoritativeOutcome: string | null;
    finalStopReason: string | null;
    projectionStatus: string | null;
    supersededByAttemptId: string | null;
    checks: Array<{
      key: string;
      status: string;
      detail: string;
    }>;
    issues: string[];
  }>;
  issues: string[];
};

async function loadModule() {
  return await import("./verify-m064-s02.ts");
}

describe("verify-m064-s02", () => {
  test("parse args accepts --json and optional --scenario", async () => {
    const { parseVerifyM064S02Args } = await loadModule();

    expect(parseVerifyM064S02Args(["--scenario", "retry-enqueue-failure", "--json"]))
      .toEqual({ help: false, json: true, scenarioId: "retry-enqueue-failure" });
  });

  test("evaluate default matrix reports truthful canonical outcomes for failure and supersession scenarios", async () => {
    const { evaluateM064S02 } = await loadModule();

    const report = await evaluateM064S02({ generatedAt: "2026-04-24T07:45:00.000Z" });

    expect(report.success).toBe(true);
    expect(report.status_code).toBe("m064_s02_ok");
    expect(report.scenario_count).toBe(4);
    expect(report.scenarios.map((scenario) => scenario.scenarioId)).toEqual([
      "retry-enqueue-failure",
      "retry-execution-failure",
      "telemetry-projection-degraded",
      "superseded-stale-retry",
    ]);
    expect(report.scenarios.map((scenario) => scenario.statusCode)).toEqual([
      "canonical-blocked",
      "canonical-blocked",
      "canonical-blocked-degraded",
      "canonical-superseded",
    ]);

    expect(report.scenarios.find((scenario) => scenario.scenarioId === "retry-enqueue-failure"))
      .toMatchObject({
        success: true,
        authoritativeAttemptId: "review-work-2",
        authoritativeAttemptOrdinal: 2,
        authoritativeOutcome: "blocked",
        finalStopReason: "no-follow-up",
        projectionStatus: "canonical",
        supersededByAttemptId: null,
      });

    expect(report.scenarios.find((scenario) => scenario.scenarioId === "retry-execution-failure"))
      .toMatchObject({
        success: true,
        authoritativeAttemptId: "review-work-2",
        authoritativeAttemptOrdinal: 2,
        authoritativeOutcome: "blocked",
        finalStopReason: "no-follow-up",
        projectionStatus: "canonical",
        supersededByAttemptId: null,
      });

    expect(report.scenarios.find((scenario) => scenario.scenarioId === "telemetry-projection-degraded"))
      .toMatchObject({
        success: true,
        authoritativeAttemptId: "review-work-1",
        authoritativeAttemptOrdinal: 1,
        authoritativeOutcome: "blocked",
        finalStopReason: "no-follow-up",
        projectionStatus: "degraded",
        supersededByAttemptId: null,
      });

    expect(report.scenarios.find((scenario) => scenario.scenarioId === "superseded-stale-retry"))
      .toMatchObject({
        success: true,
        authoritativeAttemptId: "review-work-3",
        authoritativeAttemptOrdinal: 3,
        authoritativeOutcome: "superseded",
        finalStopReason: "superseded-by-newer-attempt",
        projectionStatus: "canonical",
        supersededByAttemptId: "review-work-3",
      });
  });

  test("evaluate scenario rejects malformed canonical state that loses final stop reason truth", async () => {
    const { getDefaultScenarioMatrix, evaluateScenario } = await loadModule();

    const definition = getDefaultScenarioMatrix().find((scenario) => scenario.scenarioId === "retry-execution-failure");
    expect(definition).toBeDefined();

    const result = await evaluateScenario({
      ...definition!,
      mutateState: (state) => ({
        ...state!,
        finalStopReason: "awaiting-continuation",
      }),
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe("invalid-contract");
    expect(result.issues).toContain(
      "Expected outcome=blocked stopReason=no-follow-up but received outcome=blocked stopReason=awaiting-continuation.",
    );
  });

  test("evaluate scenario rejects malformed canonical state that loses supersession shielding", async () => {
    const { getDefaultScenarioMatrix, evaluateScenario } = await loadModule();

    const definition = getDefaultScenarioMatrix().find((scenario) => scenario.scenarioId === "superseded-stale-retry");
    expect(definition).toBeDefined();

    const result = await evaluateScenario({
      ...definition!,
      mutateState: (state) => ({
        ...state!,
        supersededByAttemptId: null,
      }),
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe("invalid-contract");
    expect(result.issues).toContain(
      "Expected supersededByAttemptId=review-work-3 but received missing.",
    );
  });

  test("main emits json for the default matrix with canonical authority fields", async () => {
    const { main } = await loadModule();
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    const exitCode = await main(["--json"], {
      stdout: { write: (chunk: string) => void stdoutChunks.push(chunk) },
      stderr: { write: (chunk: string) => void stderrChunks.push(chunk) },
    });

    const report = JSON.parse(stdoutChunks.join("")) as JsonReport;
    expect(exitCode).toBe(0);
    expect(stderrChunks).toEqual([]);
    expect(report.command).toBe("verify:m064:s02");
    expect(report.generated_at).toBeString();
    expect(report.status_code).toBe("m064_s02_ok");
    expect(report.scenarios.every((scenario) => typeof scenario.familyKey === "string")).toBe(true);
    expect(report.scenarios.every((scenario) => typeof scenario.baseReviewOutputKey === "string")).toBe(true);
    expect(report.scenarios.every((scenario) => typeof scenario.authoritativeAttemptId === "string")).toBe(true);
    expect(report.scenarios.every((scenario) => typeof scenario.finalStopReason === "string")).toBe(true);
    expect(report.scenarios.every((scenario) => typeof scenario.projectionStatus === "string")).toBe(true);
  });

  test("main rejects unknown scenario ids with a named invalid-arg status", async () => {
    const { main } = await loadModule();
    const stdoutChunks: string[] = [];

    const exitCode = await main(["--scenario", "not-real", "--json"], {
      stdout: { write: (chunk: string) => void stdoutChunks.push(chunk) },
      stderr: { write: () => undefined },
    });

    const report = JSON.parse(stdoutChunks.join("")) as JsonReport;
    expect(exitCode).toBe(1);
    expect(report.status_code).toBe("m064_s02_invalid_arg");
    expect(report.issues).toContain("Unknown scenario id: not-real.");
  });

  test("render report keeps deterministic human-readable canonical diagnostics", async () => {
    const { evaluateM064S02, renderM064S02Report } = await loadModule();

    const report = await evaluateM064S02({ generatedAt: "2026-04-24T07:45:00.000Z" });
    const human = renderM064S02Report(report);

    expect(human).toContain("# M064 S02 — Canonical Orchestration Failure Verifier");
    expect(human).toContain("Status: m064_s02_ok");
    expect(human).toContain("retry-enqueue-failure: canonical-blocked");
    expect(human).toContain("retry-execution-failure: canonical-blocked");
    expect(human).toContain("telemetry-projection-degraded: canonical-blocked-degraded");
    expect(human).toContain("superseded-stale-retry: canonical-superseded");
    expect(human).toContain("finalStopReason=superseded-by-newer-attempt projectionStatus=canonical supersededByAttemptId=review-work-3");
  });

  test("package.json wires verify:m064:s02 to the verifier script", async () => {
    const packageJson = await Bun.file(new URL("../package.json", import.meta.url)).json() as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["verify:m064:s02"]).toBe("bun scripts/verify-m064-s02.ts");
  });
});
