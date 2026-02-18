import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  evaluateSmokeChecks,
  main,
  parseSmokeCliArgs,
  renderSmokeReport,
} from "./phase80-slack-smoke.ts";

describe("phase80 smoke CLI args", () => {
  test("parses --help flag", () => {
    expect(parseSmokeCliArgs(["--help"]).help).toBe(true);
    expect(parseSmokeCliArgs(["-h"]).help).toBe(true);
  });
});

describe("phase80 smoke check evaluation", () => {
  test("passes deterministic baseline matrix", () => {
    const report = evaluateSmokeChecks();
    expect(report.overallPassed).toBe(true);
    expect(report.checks.map((check) => check.id)).toEqual([
      "SLK80-SMOKE-01",
      "SLK80-SMOKE-02",
      "SLK80-SMOKE-03",
      "SLK80-SMOKE-04",
    ]);
    expect(report.checks.every((check) => check.passed)).toBe(true);
  });

  test("fails started-thread follow-up check when session transition is skipped", () => {
    const report = evaluateSmokeChecks({ markSessionBeforeFollowUpCheck: false });
    expect(report.overallPassed).toBe(false);
    expect(report.checks.find((check) => check.id === "SLK80-SMOKE-04")?.passed).toBe(false);
  });

  test("report renderer prints failing check IDs in final verdict", () => {
    const report = evaluateSmokeChecks({ markSessionBeforeFollowUpCheck: false });
    const rendered = renderSmokeReport(report);
    expect(rendered).toContain("Final verdict: FAIL");
    expect(rendered).toContain("SLK80-SMOKE-04");
  });
});

describe("phase80 CLI exit behavior", () => {
  test("main returns success code for --help", () => {
    expect(main(["--help"]).toString()).toBe("0");
  });

  test("script exits successfully for baseline smoke", () => {
    const scriptPath = join(import.meta.dir, "phase80-slack-smoke.ts");
    const result = Bun.spawnSync({
      cmd: ["bun", scriptPath],
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = result.stdout.toString();
    expect(result.exitCode).toBe(0);
    expect(stdout).toContain("SLK80-SMOKE-01 PASS");
    expect(stdout).toContain("Final verdict: PASS");
  });

  test("script exits non-zero for unknown arguments", () => {
    const scriptPath = join(import.meta.dir, "phase80-slack-smoke.ts");
    const result = Bun.spawnSync({
      cmd: ["bun", scriptPath, "--bad-flag"],
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderr = result.stderr.toString();
    expect(result.exitCode).toBe(1);
    expect(stderr).toContain("Phase 80 Slack smoke failed");
  });
});
