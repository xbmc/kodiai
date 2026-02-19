import { describe, expect, test } from "bun:test";
import {
  evaluateRegressionGateChecks,
  main,
  parseRegressionGateCliArgs,
  PINNED_SUITES,
  renderRegressionGateReport,
} from "./phase81-slack-write-regression-gate.ts";

describe("phase81 regression gate CLI args", () => {
  test("parses --help flag", () => {
    expect(parseRegressionGateCliArgs(["--help"]).help).toBe(true);
    expect(parseRegressionGateCliArgs(["-h"]).help).toBe(true);
  });
});

describe("phase81 regression gate evaluation", () => {
  test("passes when all pinned suites pass", () => {
    const invocations: string[] = [];
    const report = evaluateRegressionGateChecks((command) => {
      invocations.push(command[2] ?? "unknown");
      return {
        status: 0,
        stdout: "ok",
        stderr: "",
      };
    });

    expect(report.overallPassed).toBe(true);
    expect(report.checks.every((check) => check.passed)).toBe(true);
    expect(invocations).toEqual(PINNED_SUITES.map((suite) => suite.command[2] ?? "unknown"));
  });

  test("fails with actionable check ID when one suite fails", () => {
    const report = evaluateRegressionGateChecks((command) => {
      const testFile = command[2] ?? "";
      if (testFile.includes("assistant-handler")) {
        return {
          status: 1,
          stdout: "",
          stderr: "expected write route mismatch",
        };
      }

      return {
        status: 0,
        stdout: "ok",
        stderr: "",
      };
    });

    expect(report.overallPassed).toBe(false);
    expect(report.checks.find((check) => check.id === "SLK81-REG-HANDLER-01")?.passed).toBe(false);
    const rendered = renderRegressionGateReport(report);
    expect(rendered).toContain("Final verdict: FAIL");
    expect(rendered).toContain("SLK81-REG-HANDLER-01");
  });

  test("captures subprocess error path as failing check details", () => {
    const report = evaluateRegressionGateChecks((command) => {
      const testFile = command[2] ?? "";
      if (testFile.includes("write-confirmation-store")) {
        return {
          status: null,
          stdout: "",
          stderr: "",
          error: "spawn bun ENOENT",
        };
      }

      return {
        status: 0,
        stdout: "ok",
        stderr: "",
      };
    });

    expect(report.overallPassed).toBe(false);
    const failed = report.checks.find((check) => check.id === "SLK81-REG-CONFIRM-01");
    expect(failed?.passed).toBe(false);
    expect(failed?.details).toContain("error=spawn bun ENOENT");
  });
});

describe("phase81 regression gate main", () => {
  test("returns success code for --help", () => {
    expect(main(["--help"])).toBe(0);
  });
});
