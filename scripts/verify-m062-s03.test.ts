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
    boundedCommentEligible: boolean;
    boundedCommentRendered: boolean;
    reviewDetailsRendered: boolean;
    commentError: string | null;
    parityChecks: Array<{
      key: string;
      status: "pass" | "fail" | "expected-negative";
      detail: string;
    }>;
    issues: string[];
  }>;
  issues: string[];
};

async function loadModule() {
  return await import("./verify-m062-s03.ts");
}

describe("verify-m062-s03", () => {
  test("parse args accepts --json and optional --scenario", async () => {
    const { parseVerifyM062S03Args } = await loadModule();

    expect(parseVerifyM062S03Args(["--scenario", "large-pr-bounded", "--json"]))
      .toEqual({ help: false, json: true, scenarioId: "large-pr-bounded" });
  });

  test("evaluate default matrix reports bounded parity and zero-evidence rejection with stable scenario classifications", async () => {
    const { evaluateM062S03 } = await loadModule();

    const report = evaluateM062S03({ generatedAt: "2026-04-24T04:00:00.000Z" });

    expect(report.success).toBe(true);
    expect(report.status_code).toBe("m062_s03_ok");
    expect(report.scenario_count).toBe(4);
    expect(report.scenarios.map((scenario) => scenario.scenarioId)).toEqual([
      "timeout-checkpoint",
      "max-turns-checkpoint",
      "large-pr-bounded",
      "zero-evidence-failure",
    ]);
    expect(report.scenarios.map((scenario) => scenario.statusCode)).toEqual([
      "bounded-parity-ok",
      "bounded-parity-ok",
      "bounded-parity-ok",
      "dead-end-rejected",
    ]);

    const bounded = report.scenarios.find((scenario) => scenario.scenarioId === "large-pr-bounded");
    expect(bounded).toBeDefined();
    expect(bounded).toMatchObject({
      success: true,
      statusCode: "bounded-parity-ok",
      boundedCommentEligible: true,
      boundedCommentRendered: true,
      reviewDetailsRendered: true,
      commentError: null,
    });
    expect(bounded?.parityChecks.map((check) => check.key)).toEqual([
      "bounded-reason",
      "covered-scope",
      "remaining-scope",
      "continuation-state",
    ]);
    expect(bounded?.parityChecks.every((check) => check.status === "pass")).toBe(true);
    expect(bounded?.parityChecks.find((check) => check.key === "bounded-reason")?.detail)
      .toContain("large-PR triage");
    expect(bounded?.parityChecks.find((check) => check.key === "covered-scope")?.detail)
      .toContain("2/5");
    expect(bounded?.parityChecks.find((check) => check.key === "continuation-state")?.detail)
      .toContain("pending");

    const zeroEvidence = report.scenarios.find((scenario) => scenario.scenarioId === "zero-evidence-failure");
    expect(zeroEvidence).toBeDefined();
    expect(zeroEvidence).toMatchObject({
      success: true,
      statusCode: "dead-end-rejected",
      boundedCommentEligible: false,
      boundedCommentRendered: false,
      reviewDetailsRendered: true,
    });
    expect(zeroEvidence?.commentError).toContain("publishable bounded-first-pass payload");
    expect(zeroEvidence?.parityChecks).toEqual([
      {
        key: "bounded-comment-rejection",
        status: "expected-negative",
        detail: "Zero-evidence failure stayed ineligible for bounded public comment.",
      },
    ]);
  });

  test("evaluate scenario surfaces invalid contract issues for malformed normalized payloads", async () => {
    const { getDefaultScenarioMatrix, evaluateScenario } = await loadModule();

    const definition = getDefaultScenarioMatrix().find((scenario) => scenario.scenarioId === "large-pr-bounded");
    expect(definition).toBeDefined();

    const result = evaluateScenario({
      ...definition!,
      mutateNormalizedPayload: (payload) => ({
        ...payload!,
        publication: undefined as never,
      }),
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe("invalid-contract");
    expect(result.issues).toContain("Missing normalized publication state.");
  });

  test("evaluate scenario degrades missing remaining scope to truthful uncertainty instead of exhaustive wording", async () => {
    const { getDefaultScenarioMatrix, evaluateScenario } = await loadModule();

    const definition = getDefaultScenarioMatrix().find((scenario) => scenario.scenarioId === "large-pr-bounded");
    expect(definition).toBeDefined();

    const result = evaluateScenario({
      ...definition!,
      mutateNormalizedPayload: (payload) => ({
        ...payload!,
        remainingScope: undefined,
      }),
    });

    expect(result.success).toBe(true);
    expect(result.statusCode).toBe("bounded-parity-ok");
    const remainingScopeCheck = result.parityChecks.find((check) => check.key === "remaining-scope");
    expect(remainingScopeCheck).toMatchObject({
      status: "pass",
    });
    expect(remainingScopeCheck?.detail).toContain("uncertainty");
  });

  test("main emits json for the default matrix with scenario-level semantic fields", async () => {
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
    expect(report.command).toBe("verify:m062:s03");
    expect(report.generated_at).toBeString();
    expect(report.status_code).toBe("m062_s03_ok");
    expect(report.scenario_count).toBe(4);
    expect(report.scenarios.every((scenario) => typeof scenario.boundedCommentEligible === "boolean")).toBe(true);
    expect(report.scenarios.every((scenario) => Array.isArray(scenario.parityChecks))).toBe(true);
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
    expect(report.status_code).toBe("m062_s03_invalid_arg");
    expect(report.issues).toContain("Unknown scenario id: not-real.");
  });

  test("main supports single-scenario targeting for deterministic drift checks", async () => {
    const { main } = await loadModule();
    const stdoutChunks: string[] = [];

    const exitCode = await main(["--scenario", "large-pr-bounded", "--json"], {
      stdout: { write: (chunk: string) => void stdoutChunks.push(chunk) },
      stderr: { write: () => undefined },
    });

    const report = JSON.parse(stdoutChunks.join("")) as JsonReport;
    expect(exitCode).toBe(0);
    expect(report.status_code).toBe("m062_s03_ok");
    expect(report.scenario_count).toBe(1);
    expect(report.scenarios[0]?.scenarioId).toBe("large-pr-bounded");
    expect(report.scenarios[0]?.statusCode).toBe("bounded-parity-ok");
  });

  test("render report keeps deterministic human-readable scenario diagnostics and parity wording", async () => {
    const { evaluateM062S03, renderM062S03Report } = await loadModule();

    const report = evaluateM062S03({ generatedAt: "2026-04-24T04:00:00.000Z" });
    const human = renderM062S03Report(report);

    expect(human).toContain("# M062 S03 — Large-PR Baseline Proof Harness");
    expect(human).toContain("Status: m062_s03_ok");
    expect(human).toContain("large-pr-bounded: bounded-parity-ok");
    expect(human).toContain("zero-evidence-failure: dead-end-rejected");
    expect(human).toContain("bounded-reason: pass — Both surfaces describe large-PR triage.");
    expect(human).toContain("covered-scope: pass — Both surfaces preserve covered scope 2/5.");
    expect(human).toContain("continuation-state: pass — Both surfaces preserve continuation state: pending.");
    expect(human).toContain("bounded-comment-rejection: expected-negative");
  });

  test("package.json wires verify:m062:s03 to the verifier script", async () => {
    const packageJson = await Bun.file(new URL("../package.json", import.meta.url)).json() as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["verify:m062:s03"]).toBe("bun scripts/verify-m062-s03.ts");
  });
});
