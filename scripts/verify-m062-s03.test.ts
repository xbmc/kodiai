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
  test("evaluate default matrix reports bounded parity and zero-evidence rejection", async () => {
    const { evaluateM062S03 } = await loadModule();

    const report = evaluateM062S03({ generatedAt: "2026-04-24T04:00:00.000Z" });

    expect(report.success).toBe(true);
    expect(report.status_code).toBe("m062_s03_ok");
    expect(report.scenario_count).toBe(4);

    const bounded = report.scenarios.find((scenario) => scenario.scenarioId === "large-pr-bounded");
    expect(bounded).toBeDefined();
    expect(bounded).toMatchObject({
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

    const zeroEvidence = report.scenarios.find((scenario) => scenario.scenarioId === "zero-evidence-failure");
    expect(zeroEvidence).toBeDefined();
    expect(zeroEvidence).toMatchObject({
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

  test("main emits json and supports single-scenario targeting", async () => {
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

  test("render report keeps deterministic human-readable scenario diagnostics", async () => {
    const { evaluateM062S03, renderM062S03Report } = await loadModule();

    const report = evaluateM062S03({ generatedAt: "2026-04-24T04:00:00.000Z" });
    const human = renderM062S03Report(report);

    expect(human).toContain("# M062 S03 — Large-PR Baseline Proof Harness");
    expect(human).toContain("Status: m062_s03_ok");
    expect(human).toContain("large-pr-bounded: bounded-parity-ok");
    expect(human).toContain("zero-evidence-failure: dead-end-rejected");
    expect(human).toContain("bounded-comment-rejection: expected-negative");
  });
});
