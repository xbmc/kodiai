import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  evaluateSmokeChecks,
  main,
  parseSmokeCliArgs,
  renderSmokeReport,
} from "./phase81-slack-write-smoke.ts";

describe("phase81 write smoke CLI args", () => {
  test("parses --help flag", () => {
    expect(parseSmokeCliArgs(["--help"]).help).toBe(true);
    expect(parseSmokeCliArgs(["-h"]).help).toBe(true);
  });
});

describe("phase81 write smoke checks", () => {
  test("passes deterministic baseline matrix", async () => {
    const report = await evaluateSmokeChecks();
    expect(report.overallPassed).toBe(true);
    expect(report.checks.map((check) => check.id)).toEqual([
      "SLK81-SMOKE-01",
      "SLK81-SMOKE-02",
      "SLK81-SMOKE-03",
      "SLK81-SMOKE-04",
    ]);
    expect(report.checks.every((check) => check.passed)).toBe(true);
  });

  test("fails ambiguous fallback check when request is no longer ambiguous", async () => {
    const report = await evaluateSmokeChecks({
      ambiguousRequest: "Please update src/slack/assistant-handler.ts and open a PR",
    });

    expect(report.overallPassed).toBe(false);
    expect(report.checks.find((check) => check.id === "SLK81-SMOKE-02")?.passed).toBe(false);
  });

  test("renderer prints failing check IDs in final verdict", async () => {
    const report = await evaluateSmokeChecks({
      ambiguousRequest: "Please update src/slack/assistant-handler.ts and open a PR",
    });

    const rendered = renderSmokeReport(report);
    expect(rendered).toContain("Final verdict: FAIL");
    expect(rendered).toContain("SLK81-SMOKE-02");
  });
});

describe("phase81 write smoke CLI", () => {
  test("main returns success code for --help", async () => {
    expect((await main(["--help"])).toString()).toBe("0");
  });

  test("script exits successfully for baseline smoke", () => {
    const scriptPath = join(import.meta.dir, "phase81-slack-write-smoke.ts");
    const result = Bun.spawnSync({
      cmd: ["bun", scriptPath],
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = result.stdout.toString();
    expect(result.exitCode).toBe(0);
    expect(stdout).toContain("SLK81-SMOKE-01 PASS");
    expect(stdout).toContain("Final verdict: PASS");
  });

  test("script exits non-zero for unknown arguments", () => {
    const scriptPath = join(import.meta.dir, "phase81-slack-write-smoke.ts");
    const result = Bun.spawnSync({
      cmd: ["bun", scriptPath, "--bad-flag"],
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderr = result.stderr.toString();
    expect(result.exitCode).toBe(1);
    expect(stderr).toContain("Phase 81 Slack write smoke failed");
  });
});
