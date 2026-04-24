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
    sameSurface: boolean;
    revisionVisible: boolean;
    quietNoDelta: boolean;
    baseReviewOutputKey: string;
    visibleSurfaceCount: number;
    continuationSurfaceCount: number;
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
  return await import("./verify-m063-s02.ts");
}

describe("verify-m063-s02", () => {
  test("parse args accepts --json and optional --scenario", async () => {
    const { parseVerifyM063S02Args } = await loadModule();

    expect(parseVerifyM063S02Args(["--scenario", "merge-revisions", "--json"]))
      .toEqual({ help: false, json: true, scenarioId: "merge-revisions" });
  });

  test("evaluate default matrix reports same-surface continuation ownership, explicit revisions, and quiet no-delta settlement", async () => {
    const { evaluateM063S02 } = await loadModule();

    const report = evaluateM063S02({ generatedAt: "2026-04-24T06:00:00.000Z" });

    expect(report.success).toBe(true);
    expect(report.status_code).toBe("m063_s02_ok");
    expect(report.scenario_count).toBe(3);
    expect(report.scenarios.map((scenario) => scenario.scenarioId)).toEqual([
      "timeout-first-pass",
      "merge-revisions",
      "settle-no-delta",
    ]);
    expect(report.scenarios.map((scenario) => scenario.statusCode)).toEqual([
      "same-surface-pending",
      "same-surface-revised",
      "same-surface-quiet-settlement",
    ]);

    const firstPass = report.scenarios.find((scenario) => scenario.scenarioId === "timeout-first-pass");
    expect(firstPass).toMatchObject({
      success: true,
      statusCode: "same-surface-pending",
      sameSurface: true,
      revisionVisible: false,
      quietNoDelta: false,
      visibleSurfaceCount: 1,
      continuationSurfaceCount: 0,
    });
    expect(firstPass?.checks.find((check) => check.key === "marker-continuity")?.status).toBe("pass");
    expect(firstPass?.checks.find((check) => check.key === "review-details-attached")?.status).toBe("pass");

    const revised = report.scenarios.find((scenario) => scenario.scenarioId === "merge-revisions");
    expect(revised).toMatchObject({
      success: true,
      statusCode: "same-surface-revised",
      sameSurface: true,
      revisionVisible: true,
      quietNoDelta: false,
      visibleSurfaceCount: 1,
      continuationSurfaceCount: 0,
    });
    expect(revised?.checks.find((check) => check.key === "revision-visibility")).toMatchObject({
      status: "pass",
    });
    expect(revised?.checks.find((check) => check.key === "revision-visibility")?.detail)
      .toContain("Continuation revisions");

    const noDelta = report.scenarios.find((scenario) => scenario.scenarioId === "settle-no-delta");
    expect(noDelta).toMatchObject({
      success: true,
      statusCode: "same-surface-quiet-settlement",
      sameSurface: true,
      revisionVisible: false,
      quietNoDelta: true,
      visibleSurfaceCount: 1,
      continuationSurfaceCount: 0,
    });
    expect(noDelta?.checks.find((check) => check.key === "quiet-settlement")).toMatchObject({
      status: "pass",
    });
  });

  test("evaluate scenario rejects marker continuity regressions when the canonical surface loses the base reviewOutputKey", async () => {
    const { getDefaultScenarioMatrix, evaluateScenario } = await loadModule();

    const definition = getDefaultScenarioMatrix().find((scenario) => scenario.scenarioId === "merge-revisions");
    expect(definition).toBeDefined();

    const result = evaluateScenario({
      ...definition!,
      mutateBodies: (bodies, helpers) => ({
        ...bodies,
        canonicalBody: bodies.canonicalBody.replace(helpers.baseMarker, helpers.retryMarker),
      }),
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe("contract-failed");
    expect(result.issues).toContain("Canonical surface lost the base review-output marker.");
  });

  test("evaluate scenario rejects duplicate public lifecycle comments when continuation publishes a second visible surface", async () => {
    const { getDefaultScenarioMatrix, evaluateScenario } = await loadModule();

    const definition = getDefaultScenarioMatrix().find((scenario) => scenario.scenarioId === "merge-revisions");
    expect(definition).toBeDefined();

    const result = evaluateScenario({
      ...definition!,
      mutateBodies: (bodies, helpers) => ({
        ...bodies,
        visibleBodies: [...bodies.visibleBodies, `Continuation follow-up\n\n${helpers.baseMarker}`],
      }),
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe("contract-failed");
    expect(result.issues).toContain("Expected exactly one visible review surface for the base reviewOutputKey.");
  });

  test("main emits json for the default matrix with same-surface semantic fields", async () => {
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
    expect(report.command).toBe("verify:m063:s02");
    expect(report.generated_at).toBeString();
    expect(report.status_code).toBe("m063_s02_ok");
    expect(report.scenarios.every((scenario) => typeof scenario.sameSurface === "boolean")).toBe(true);
    expect(report.scenarios.every((scenario) => typeof scenario.revisionVisible === "boolean")).toBe(true);
    expect(report.scenarios.every((scenario) => typeof scenario.quietNoDelta === "boolean")).toBe(true);
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
    expect(report.status_code).toBe("m063_s02_invalid_arg");
    expect(report.issues).toContain("Unknown scenario id: not-real.");
  });

  test("render report keeps deterministic human-readable same-surface diagnostics", async () => {
    const { evaluateM063S02, renderM063S02Report } = await loadModule();

    const report = evaluateM063S02({ generatedAt: "2026-04-24T06:00:00.000Z" });
    const human = renderM063S02Report(report);

    expect(human).toContain("# M063 S02 — Same-Surface Continuation Verifier");
    expect(human).toContain("Status: m063_s02_ok");
    expect(human).toContain("timeout-first-pass: same-surface-pending");
    expect(human).toContain("merge-revisions: same-surface-revised");
    expect(human).toContain("settle-no-delta: same-surface-quiet-settlement");
    expect(human).toContain("same-surface=true revisions=false quiet-no-delta=false");
    expect(human).toContain("same-surface=true revisions=true quiet-no-delta=false");
    expect(human).toContain("same-surface=true revisions=false quiet-no-delta=true");
  });

  test("package.json wires verify:m063:s02 to the verifier script", async () => {
    const packageJson = await Bun.file(new URL("../package.json", import.meta.url)).json() as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["verify:m063:s02"]).toBe("bun scripts/verify-m063-s02.ts");
  });
});
