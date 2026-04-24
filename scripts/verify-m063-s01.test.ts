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
    continuationStatus: string;
    settlementStatus: string;
    authorityStatus: string;
    reviewOutputKey: string;
    continuationReviewOutputKey: string | null;
    continuationNumber: number | null;
    issues: string[];
  }>;
  issues: string[];
};

async function loadModule() {
  return await import("./verify-m063-s01.ts");
}

describe("verify-m063-s01", () => {
  test("parse args accepts --json and optional --scenario", async () => {
    const { parseVerifyM063S01Args } = await loadModule();

    expect(parseVerifyM063S01Args(["--scenario", "schedule-continuation", "--json"]))
      .toEqual({ help: false, json: true, scenarioId: "schedule-continuation" });
  });

  test("evaluate default matrix reports explicit continuation planning, settlement, and stale-authority suppression", async () => {
    const { evaluateM063S01 } = await loadModule();

    const report = evaluateM063S01({ generatedAt: "2026-04-24T05:00:00.000Z" });

    expect(report.success).toBe(true);
    expect(report.status_code).toBe("m063_s01_ok");
    expect(report.scenario_count).toBe(5);
    expect(report.scenarios.map((scenario) => scenario.scenarioId)).toEqual([
      "schedule-continuation",
      "merge-continuation",
      "settle-no-delta",
      "no-follow-up",
      "stale-authority-suppressed",
    ]);
    expect(report.scenarios.map((scenario) => scenario.statusCode)).toEqual([
      "continuation-scheduled",
      "continuation-merged",
      "continuation-settled-no-delta",
      "continuation-not-needed",
      "continuation-authority-suppressed",
    ]);

    const scheduled = report.scenarios.find((scenario) => scenario.scenarioId === "schedule-continuation");
    expect(scheduled).toMatchObject({
      success: true,
      statusCode: "continuation-scheduled",
      continuationStatus: "scheduled",
      settlementStatus: "not-run",
      authorityStatus: "authoritative",
      continuationReviewOutputKey: expect.stringContaining("-retry-1"),
      continuationNumber: 1,
    });

    const merged = report.scenarios.find((scenario) => scenario.scenarioId === "merge-continuation");
    expect(merged).toMatchObject({
      success: true,
      statusCode: "continuation-merged",
      continuationStatus: "scheduled",
      settlementStatus: "merge-ready",
      authorityStatus: "authoritative",
    });

    const noDelta = report.scenarios.find((scenario) => scenario.scenarioId === "settle-no-delta");
    expect(noDelta).toMatchObject({
      success: true,
      statusCode: "continuation-settled-no-delta",
      continuationStatus: "scheduled",
      settlementStatus: "no-delta",
      authorityStatus: "authoritative",
    });

    const noFollowUp = report.scenarios.find((scenario) => scenario.scenarioId === "no-follow-up");
    expect(noFollowUp).toMatchObject({
      success: true,
      statusCode: "continuation-not-needed",
      continuationStatus: "not-needed",
      settlementStatus: "not-run",
      authorityStatus: "authoritative",
      continuationReviewOutputKey: null,
      continuationNumber: null,
    });

    const staleAuthority = report.scenarios.find((scenario) => scenario.scenarioId === "stale-authority-suppressed");
    expect(staleAuthority).toMatchObject({
      success: true,
      statusCode: "continuation-authority-suppressed",
      continuationStatus: "scheduled",
      settlementStatus: "merge-ready",
      authorityStatus: "suppressed",
    });
  });

  test("evaluate scenario rejects malformed planner output that drops continuation status fields", async () => {
    const { getDefaultScenarioMatrix, evaluateScenario } = await loadModule();

    const definition = getDefaultScenarioMatrix().find((scenario) => scenario.scenarioId === "schedule-continuation");
    expect(definition).toBeDefined();

    const result = evaluateScenario({
      ...definition!,
      mutatePlan: (plan) => ({
        ...plan!,
        continuationReviewOutputKey: "" as never,
      }),
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe("invalid-contract");
    expect(result.issues).toContain("Scheduled continuation is missing a continuation review output key.");
  });

  test("evaluate scenario rejects malformed settlement output when merge cleanup keys drift", async () => {
    const { getDefaultScenarioMatrix, evaluateScenario } = await loadModule();

    const definition = getDefaultScenarioMatrix().find((scenario) => scenario.scenarioId === "merge-continuation");
    expect(definition).toBeDefined();

    const result = evaluateScenario({
      ...definition!,
      mutateSettlement: (settlement) => ({
        ...settlement!,
        cleanupReviewOutputKeys: [settlement!.reviewOutputKey, "bogus-key"],
      }),
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe("invalid-contract");
    expect(result.issues).toContain("Settlement cleanup keys no longer match the base and continuation identities.");
  });

  test("main emits json for the default matrix with compact semantic fields", async () => {
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
    expect(report.command).toBe("verify:m063:s01");
    expect(report.generated_at).toBeString();
    expect(report.status_code).toBe("m063_s01_ok");
    expect(report.scenarios.every((scenario) => typeof scenario.continuationStatus === "string")).toBe(true);
    expect(report.scenarios.every((scenario) => typeof scenario.settlementStatus === "string")).toBe(true);
    expect(report.scenarios.every((scenario) => typeof scenario.authorityStatus === "string")).toBe(true);
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
    expect(report.status_code).toBe("m063_s01_invalid_arg");
    expect(report.issues).toContain("Unknown scenario id: not-real.");
  });

  test("render report keeps deterministic human-readable lifecycle diagnostics", async () => {
    const { evaluateM063S01, renderM063S01Report } = await loadModule();

    const report = evaluateM063S01({ generatedAt: "2026-04-24T05:00:00.000Z" });
    const human = renderM063S01Report(report);

    expect(human).toContain("# M063 S01 — Automatic Continuation Lifecycle Verifier");
    expect(human).toContain("Status: m063_s01_ok");
    expect(human).toContain("schedule-continuation: continuation-scheduled");
    expect(human).toContain("merge-continuation: continuation-merged");
    expect(human).toContain("settle-no-delta: continuation-settled-no-delta");
    expect(human).toContain("stale-authority-suppressed: continuation-authority-suppressed");
    expect(human).toContain("continuation=scheduled settlement=merge-ready authority=suppressed");
  });

  test("package.json wires verify:m063:s01 to the verifier script", async () => {
    const packageJson = await Bun.file(new URL("../package.json", import.meta.url)).json() as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["verify:m063:s01"]).toBe("bun scripts/verify-m063-s01.ts");
  });
});
