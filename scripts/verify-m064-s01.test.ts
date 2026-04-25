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
  return await import("./verify-m064-s01.ts");
}

describe("verify-m064-s01", () => {
  test("parse args accepts --json and optional --scenario", async () => {
    const { parseVerifyM064S01Args } = await loadModule();

    expect(parseVerifyM064S01Args(["--scenario", "merge-authority", "--json"]))
      .toEqual({ help: false, json: true, scenarioId: "merge-authority" });
  });

  test("evaluate default matrix reports canonical authoritative outcomes from durable-state queries", async () => {
    const { evaluateM064S01 } = await loadModule();

    const report = await evaluateM064S01({ generatedAt: "2026-04-24T07:30:00.000Z" });

    expect(report.success).toBe(true);
    expect(report.status_code).toBe("m064_s01_ok");
    expect(report.scenario_count).toBe(4);
    expect(report.scenarios.map((scenario) => scenario.scenarioId)).toEqual([
      "merge-authority",
      "quiet-settlement",
      "blocked-no-follow-up",
      "superseded-stale-attempt",
    ]);
    expect(report.scenarios.map((scenario) => scenario.statusCode)).toEqual([
      "canonical-merged",
      "canonical-quiet-settled",
      "canonical-blocked",
      "canonical-superseded",
    ]);

    const merged = report.scenarios.find((scenario) => scenario.scenarioId === "merge-authority");
    expect(merged).toMatchObject({
      success: true,
      authoritativeAttemptId: "review-work-2",
      authoritativeAttemptOrdinal: 2,
      authoritativeOutcome: "merged",
      finalStopReason: "merged-continuation-results",
      projectionStatus: "canonical",
      supersededByAttemptId: null,
    });

    const quiet = report.scenarios.find((scenario) => scenario.scenarioId === "quiet-settlement");
    expect(quiet).toMatchObject({
      success: true,
      authoritativeAttemptId: "review-work-2",
      authoritativeAttemptOrdinal: 2,
      authoritativeOutcome: "quiet-settled",
      finalStopReason: "settled-without-update",
      projectionStatus: "canonical",
      supersededByAttemptId: null,
    });

    const blocked = report.scenarios.find((scenario) => scenario.scenarioId === "blocked-no-follow-up");
    expect(blocked).toMatchObject({
      success: true,
      authoritativeAttemptId: "review-work-1",
      authoritativeAttemptOrdinal: 1,
      authoritativeOutcome: "blocked",
      finalStopReason: "no-follow-up",
      projectionStatus: "canonical",
      supersededByAttemptId: null,
    });

    const superseded = report.scenarios.find((scenario) => scenario.scenarioId === "superseded-stale-attempt");
    expect(superseded).toMatchObject({
      success: true,
      authoritativeAttemptId: "review-work-3",
      authoritativeAttemptOrdinal: 3,
      authoritativeOutcome: "superseded",
      finalStopReason: "superseded-by-newer-attempt",
      projectionStatus: "degraded",
      supersededByAttemptId: "review-work-3",
    });
  });

  test("evaluate scenario rejects malformed canonical state that loses the authoritative attempt", async () => {
    const { getDefaultScenarioMatrix, evaluateScenario } = await loadModule();

    const definition = getDefaultScenarioMatrix().find((scenario) => scenario.scenarioId === "merge-authority");
    expect(definition).toBeDefined();

    const result = await evaluateScenario({
      ...definition!,
      mutateState: (state) => ({
        ...state!,
        authoritativeAttemptId: "review-work-1",
      }),
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe("invalid-contract");
    expect(result.issues).toContain(
      "Expected authoritative attempt review-work-2 (#2) but received review-work-1 (#2).",
    );
  });

  test("evaluate scenario rejects malformed canonical state that drifts the projection status", async () => {
    const { getDefaultScenarioMatrix, evaluateScenario } = await loadModule();

    const definition = getDefaultScenarioMatrix().find((scenario) => scenario.scenarioId === "superseded-stale-attempt");
    expect(definition).toBeDefined();

    const result = await evaluateScenario({
      ...definition!,
      mutateState: (state) => ({
        ...state!,
        projectionStatus: "canonical",
      }),
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe("invalid-contract");
    expect(result.issues).toContain(
      "Expected projection status degraded but received canonical.",
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
    expect(report.command).toBe("verify:m064:s01");
    expect(report.generated_at).toBeString();
    expect(report.status_code).toBe("m064_s01_ok");
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
    expect(report.status_code).toBe("m064_s01_invalid_arg");
    expect(report.issues).toContain("Unknown scenario id: not-real.");
  });

  test("render report keeps deterministic human-readable canonical diagnostics", async () => {
    const { evaluateM064S01, renderM064S01Report } = await loadModule();

    const report = await evaluateM064S01({ generatedAt: "2026-04-24T07:30:00.000Z" });
    const human = renderM064S01Report(report);

    expect(human).toContain("# M064 S01 — Canonical Continuation Authority Verifier");
    expect(human).toContain("Status: m064_s01_ok");
    expect(human).toContain("merge-authority: canonical-merged");
    expect(human).toContain("quiet-settlement: canonical-quiet-settled");
    expect(human).toContain("blocked-no-follow-up: canonical-blocked");
    expect(human).toContain("superseded-stale-attempt: canonical-superseded");
    expect(human).toContain("finalStopReason=superseded-by-newer-attempt projectionStatus=degraded supersededByAttemptId=review-work-3");
  });

  test("package.json wires verify:m064:s01 to the verifier script", async () => {
    const packageJson = await Bun.file(new URL("../package.json", import.meta.url)).json() as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["verify:m064:s01"]).toBe("bun scripts/verify-m064-s01.ts");
  });
});
