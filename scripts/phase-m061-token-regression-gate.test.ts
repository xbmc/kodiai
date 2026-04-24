import { describe, expect, test } from "bun:test";
import {
  CHECK_PREFIX,
  evaluateRegressionGateChecks,
  main,
  parseRegressionGateCliArgs,
  PINNED_SUITES,
  renderRegressionGateReport,
  type SuiteDefinition,
} from "./phase-m061-token-regression-gate.ts";

describe("m061 token regression gate cli args", () => {
  test("parses --help flag", () => {
    expect(parseRegressionGateCliArgs(["--help"]).help).toBe(true);
    expect(parseRegressionGateCliArgs(["-h"]).help).toBe(true);
  });
});

describe("m061 token regression gate pinned suites", () => {
  test("pins stable suite groups for mention, review, retrieval, reporting, and verifier coverage", () => {
    expect(CHECK_PREFIX).toBe("M061-REG");
    expect(PINNED_SUITES).toEqual([
      {
        id: "M061-REG-MENTION-01",
        title: "Mention path regression suites pass",
        command: [
          "bun",
          "test",
          "./src/execution/mention-context.test.ts",
          "./src/execution/mention-prompt.test.ts",
          "./src/handlers/mention.test.ts",
          "--timeout",
          "30000",
        ],
      },
      {
        id: "M061-REG-REVIEW-01",
        title: "Review path regression suites pass",
        command: [
          "bun",
          "test",
          "./src/execution/review-prompt.test.ts",
          "./src/handlers/review.test.ts",
          "--timeout",
          "30000",
        ],
      },
      {
        id: "M061-REG-RETRIEVAL-01",
        title: "Retrieval regression suites pass",
        command: [
          "bun",
          "test",
          "./src/knowledge/retrieval.test.ts",
          "./src/knowledge/retrieval.e2e.test.ts",
          "./src/knowledge/multi-query-retrieval.test.ts",
          "--timeout",
          "30000",
        ],
      },
      {
        id: "M061-REG-REPORTING-01",
        title: "Usage report regression suite passes",
        command: ["bun", "test", "./scripts/usage-report.test.ts", "--timeout", "30000"],
      },
      {
        id: "M061-REG-VERIFIERS-01",
        title: "M061 verifier regression suites pass",
        command: [
          "bun",
          "test",
          "./scripts/verify-m061-s01.test.ts",
          "./scripts/verify-m061-s02.test.ts",
          "./scripts/verify-m061-s03.test.ts",
          "./scripts/verify-m061-s04.test.ts",
          "./scripts/verify-m061-s05.test.ts",
          "--timeout",
          "30000",
        ],
      },
    ] satisfies SuiteDefinition[]);
  });
});

describe("m061 token regression gate evaluation", () => {
  test("passes when all pinned suites pass", () => {
    const invocations: string[][] = [];
    const report = evaluateRegressionGateChecks(PINNED_SUITES, (command) => {
      invocations.push(command);
      return {
        status: 0,
        stdout: "ok",
        stderr: "",
      };
    });

    expect(report.overallPassed).toBe(true);
    expect(report.checks.every((check) => check.passed)).toBe(true);
    expect(invocations).toEqual(PINNED_SUITES.map((suite) => suite.command));
  });

  test("fails with stable check IDs when one suite fails among many", () => {
    const report = evaluateRegressionGateChecks(PINNED_SUITES, (command) => {
      if (command.includes("./src/handlers/review.test.ts")) {
        return {
          status: 1,
          stdout: "",
          stderr: "review publication semantics regressed",
        };
      }

      return {
        status: 0,
        stdout: "ok",
        stderr: "",
      };
    });

    expect(report.overallPassed).toBe(false);
    expect(report.checks.find((check) => check.id === "M061-REG-REVIEW-01")?.passed).toBe(false);
    expect(report.checks.filter((check) => !check.passed)).toHaveLength(1);
    const rendered = renderRegressionGateReport(report);
    expect(rendered).toContain("Final verdict: FAIL");
    expect(rendered).toContain("M061-REG-REVIEW-01");
  });

  test("captures missing executable as a blocking malformed suite failure", () => {
    const report = evaluateRegressionGateChecks(
      [
        {
          id: "M061-REG-BAD-01",
          title: "Broken suite",
          command: [],
        },
      ],
      () => ({
        status: 0,
        stdout: "should not run",
        stderr: "",
      }),
    );

    expect(report.overallPassed).toBe(false);
    expect(report.checks[0]).toMatchObject({
      id: "M061-REG-BAD-01",
      passed: false,
    });
    expect(report.checks[0]?.details).toContain("error=missing executable");
  });

  test("captures thrown spawn errors as failing check details", () => {
    const report = evaluateRegressionGateChecks(PINNED_SUITES, (command) => {
      if (command.includes("./scripts/usage-report.test.ts")) {
        throw new Error("spawn bun ENOENT");
      }

      return {
        status: 0,
        stdout: "ok",
        stderr: "",
      };
    });

    expect(report.overallPassed).toBe(false);
    const failed = report.checks.find((check) => check.id === "M061-REG-REPORTING-01");
    expect(failed?.passed).toBe(false);
    expect(failed?.details).toContain("error=spawn bun ENOENT");
  });

  test("treats empty executable strings as malformed command definitions", () => {
    const report = evaluateRegressionGateChecks(
      [
        {
          id: "M061-REG-BAD-02",
          title: "Blank executable suite",
          command: ["", "test", "./scripts/verify-m061-s01.test.ts"],
        },
      ],
      () => ({
        status: 0,
        stdout: "should not run",
        stderr: "",
      }),
    );

    expect(report.overallPassed).toBe(false);
    expect(report.checks[0]?.details).toContain("error=missing executable");
  });
});

describe("m061 token regression gate rendering", () => {
  test("renders concise stable failing check IDs", () => {
    const rendered = renderRegressionGateReport({
      overallPassed: false,
      checks: [
        {
          id: "M061-REG-MENTION-01",
          title: "Mention path regression suites pass",
          passed: false,
          details: "status=1; stderr=mention regression",
        },
        {
          id: "M061-REG-REVIEW-01",
          title: "Review path regression suites pass",
          passed: true,
          details: "suite passed",
        },
      ],
    });

    expect(rendered).toContain("M061 token regression gate");
    expect(rendered).toContain("M061-REG-MENTION-01 FAIL");
    expect(rendered).toContain("blocking checks failed [M061-REG-MENTION-01]");
  });
});

describe("m061 token regression gate main", () => {
  test("returns success code for --help", () => {
    expect(main(["--help"])).toBe(0);
  });
});
