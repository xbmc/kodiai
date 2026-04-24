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
    boundedButSufficient: boolean;
    truthfulBoundedness: boolean;
    preservedRequiredSections: boolean;
    narrowingSections: string[];
    omittedFirstPassOnlySections: string[];
    issues: string[];
    checks: Array<{
      key: string;
      status: "pass" | "fail" | "expected-negative";
      detail: string;
    }>;
  }>;
  issues: string[];
};

async function loadModule() {
  return await import("./verify-m063-s03.ts");
}

describe("verify-m063-s03", () => {
  test("parse args accepts --json and optional --scenario", async () => {
    const { parseVerifyM063S03Args } = await loadModule();

    expect(parseVerifyM063S03Args(["--scenario", "large-pr-continuation", "--json"]))
      .toEqual({ help: false, json: true, scenarioId: "large-pr-continuation" });
  });

  test("evaluate default matrix reports bounded continuation without exaggerating coverage", async () => {
    const { evaluateM063S03 } = await loadModule();

    const report = evaluateM063S03({ generatedAt: "2026-04-24T07:00:00.000Z" });

    expect(report.success).toBe(true);
    expect(report.status_code).toBe("m063_s03_ok");
    expect(report.scenario_count).toBe(2);
    expect(report.scenarios.map((scenario) => scenario.scenarioId)).toEqual([
      "large-pr-continuation",
      "quiet-no-delta-bounded",
    ]);
    expect(report.scenarios.map((scenario) => scenario.statusCode)).toEqual([
      "bounded-continuation-proved",
      "bounded-continuation-no-delta",
    ]);

    const continuation = report.scenarios.find((scenario) => scenario.scenarioId === "large-pr-continuation");
    expect(continuation).toMatchObject({
      success: true,
      statusCode: "bounded-continuation-proved",
      boundedButSufficient: true,
      truthfulBoundedness: true,
      preservedRequiredSections: true,
    });
    expect(continuation?.narrowingSections).toEqual([
      "review-change-context",
      "review-size-context",
    ]);
    expect(continuation?.omittedFirstPassOnlySections).toEqual([
      "review-size-context",
    ]);
    expect(continuation?.checks.find((check) => check.key === "boundedness-wording")).toMatchObject({
      status: "pass",
    });

    const quiet = report.scenarios.find((scenario) => scenario.scenarioId === "quiet-no-delta-bounded");
    expect(quiet).toMatchObject({
      success: true,
      statusCode: "bounded-continuation-no-delta",
      boundedButSufficient: true,
      truthfulBoundedness: true,
      preservedRequiredSections: true,
    });
    expect(quiet?.checks.find((check) => check.key === "exhaustive-claim-absent")).toMatchObject({
      status: "pass",
    });
    expect(quiet?.checks.find((check) => check.key === "no-delta-truthfulness")).toMatchObject({
      status: "pass",
    });
  });

  test("evaluate scenario rejects widened continuation metrics when retry replays first-pass breadth", async () => {
    const { getDefaultScenarioMatrix, evaluateScenario } = await loadModule();

    const definition = getDefaultScenarioMatrix().find((scenario) => scenario.scenarioId === "large-pr-continuation");
    expect(definition).toBeDefined();

    const result = evaluateScenario({
      ...definition!,
      mutatePromptDetails: ({ firstPass, continuation }) => ({
        firstPass,
        continuation: {
          ...continuation,
          sections: firstPass.sections,
          text: firstPass.text,
        },
      }),
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe("contract-failed");
    expect(result.issues).toContain("Continuation replayed first-pass breadth instead of narrowing required sections.");
  });

  test("evaluate scenario rejects missing required continuation sections", async () => {
    const { getDefaultScenarioMatrix, evaluateScenario } = await loadModule();

    const definition = getDefaultScenarioMatrix().find((scenario) => scenario.scenarioId === "large-pr-continuation");
    expect(definition).toBeDefined();

    const result = evaluateScenario({
      ...definition!,
      mutatePromptDetails: ({ firstPass, continuation }) => ({
        firstPass,
        continuation: {
          ...continuation,
          sections: continuation.sections.filter((section) => section.sectionName !== "review-knowledge-context"),
        },
      }),
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe("contract-failed");
    expect(result.issues).toContain("Continuation lost required section(s): review-knowledge-context.");
  });

  test("evaluate scenario rejects empty continuation file subsets", async () => {
    const { getDefaultScenarioMatrix, evaluateScenario } = await loadModule();

    const definition = getDefaultScenarioMatrix().find((scenario) => scenario.scenarioId === "large-pr-continuation");
    expect(definition).toBeDefined();

    const result = evaluateScenario({
      ...definition!,
      continuationFiles: [],
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe("contract-failed");
    expect(result.issues).toContain("Continuation file subset must stay non-empty and narrower than the first pass.");
  });

  test("main emits json for the default matrix with boundedness diagnostics", async () => {
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
    expect(report.command).toBe("verify:m063:s03");
    expect(report.generated_at).toBeString();
    expect(report.status_code).toBe("m063_s03_ok");
    expect(report.scenarios.every((scenario) => typeof scenario.boundedButSufficient === "boolean")).toBe(true);
    expect(report.scenarios.every((scenario) => typeof scenario.truthfulBoundedness === "boolean")).toBe(true);
    expect(report.scenarios.every((scenario) => typeof scenario.preservedRequiredSections === "boolean")).toBe(true);
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
    expect(report.status_code).toBe("m063_s03_invalid_arg");
    expect(report.issues).toContain("Unknown scenario id: not-real.");
  });

  test("render report keeps truthful boundedness wording", async () => {
    const { evaluateM063S03, renderM063S03Report } = await loadModule();

    const report = evaluateM063S03({ generatedAt: "2026-04-24T07:00:00.000Z" });
    const human = renderM063S03Report(report);

    expect(human).toContain("# M063 S03 — Bounded Continuation Verifier");
    expect(human).toContain("Status: m063_s03_ok");
    expect(human).toContain("large-pr-continuation: bounded-continuation-proved");
    expect(human).toContain("quiet-no-delta-bounded: bounded-continuation-no-delta");
    expect(human).toContain("bounded-but-sufficient=true truthful-boundedness=true preserved-required-sections=true");
    expect(human).toContain("This verifier proves bounded continuation stayed materially narrower than the first pass and remained sufficient for the shipped retry scope.");
    expect(human).not.toContain("exhaustive review completion");
  });

  test("package.json wires verify:m063:s03 to the verifier script", async () => {
    const packageJson = await Bun.file(new URL("../package.json", import.meta.url)).json() as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["verify:m063:s03"]).toBe("bun scripts/verify-m063-s03.ts");
  });
});
