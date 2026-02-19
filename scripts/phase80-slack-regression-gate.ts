import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

const CHECK_PREFIX = "SLK80-REG";

type CliValues = {
  help?: boolean;
};

type SuiteDefinition = {
  id: string;
  title: string;
  command: string[];
};

type SuiteCommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: string;
};

type SuiteCheck = {
  id: string;
  title: string;
  passed: boolean;
  details: string;
};

export type RegressionGateReport = {
  overallPassed: boolean;
  checks: SuiteCheck[];
};

export const PINNED_SUITES: SuiteDefinition[] = [
  {
    id: `${CHECK_PREFIX}-RAILS-01`,
    title: "Slack v1 cross-module safety contract suite passes",
    command: ["bun", "test", "./src/slack/v1-safety-contract.test.ts", "--timeout", "30000"],
  },
  {
    id: `${CHECK_PREFIX}-RAILS-02`,
    title: "Slack safety rails unit suite passes",
    command: ["bun", "test", "./src/slack/safety-rails.test.ts", "--timeout", "30000"],
  },
  {
    id: `${CHECK_PREFIX}-ROUTE-01`,
    title: "Slack event route regression suite passes",
    command: ["bun", "test", "./src/routes/slack-events.test.ts", "--timeout", "30000"],
  },
];

export function parseRegressionGateCliArgs(args: string[]): CliValues {
  const parsed = parseArgs({
    args,
    options: {
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
    allowPositionals: false,
  });

  return parsed.values as CliValues;
}

function printUsage(): void {
  console.log(`Phase 80 Slack v1 regression gate

Runs pinned Slack v1 contract suites and prints stable ${CHECK_PREFIX}-* check IDs.

Usage:
  bun scripts/phase80-slack-regression-gate.ts [options]

Options:
  -h, --help   show this help

Pinned suites:
  - ./src/slack/v1-safety-contract.test.ts
  - ./src/slack/safety-rails.test.ts
  - ./src/routes/slack-events.test.ts

Blocking rule:
  Exit code is non-zero when any ${CHECK_PREFIX}-* check fails.`);
}

function normalizeOutput(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function runSuiteCommand(command: string[]): SuiteCommandResult {
  const [executable, ...args] = command;
  if (!executable) {
    return {
      status: null,
      stdout: "",
      stderr: "",
      error: "missing executable",
    };
  }

  const result = spawnSync(executable, args, {
    encoding: "utf8",
  });

  return {
    status: result.status,
    stdout: normalizeOutput(result.stdout),
    stderr: normalizeOutput(result.stderr),
    error: result.error ? normalizeOutput(result.error.message) : undefined,
  };
}

function buildFailureDetails(result: SuiteCommandResult): string {
  const errorPart = result.error ? `error=${result.error}` : "";
  const statusPart = `status=${result.status === null ? "null" : result.status}`;
  const stderrPart = result.stderr.length > 0 ? `stderr=${result.stderr}` : "";
  const stdoutPart = result.stdout.length > 0 ? `stdout=${result.stdout}` : "";
  return [statusPart, errorPart, stderrPart, stdoutPart].filter((part) => part.length > 0).join("; ");
}

export function evaluateRegressionGateChecks(
  runCommand: (command: string[]) => SuiteCommandResult = runSuiteCommand,
): RegressionGateReport {
  const checks = PINNED_SUITES.map((suite) => {
    const result = runCommand(suite.command);
    const passed = result.status === 0;
    return {
      id: suite.id,
      title: suite.title,
      passed,
      details: passed ? "suite passed" : buildFailureDetails(result),
    };
  });

  return {
    overallPassed: checks.every((check) => check.passed),
    checks,
  };
}

export function renderRegressionGateReport(report: RegressionGateReport): string {
  const failedIds = report.checks.filter((check) => !check.passed).map((check) => check.id);

  return [
    "Phase 80 Slack v1 regression gate",
    "",
    ...report.checks.map((check) => `${check.id} ${check.passed ? "PASS" : "FAIL"} - ${check.title}. ${check.details}`),
    "",
    report.overallPassed
      ? `Final verdict: PASS - all ${CHECK_PREFIX}-* checks passed.`
      : `Final verdict: FAIL - blocking checks failed [${failedIds.join(", ")}].`,
  ].join("\n");
}

function normalizeMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }

  const text = String(error ?? "").trim();
  return text.length > 0 ? text : "Unknown error";
}

export function main(args: string[] = process.argv.slice(2)): number {
  const values = parseRegressionGateCliArgs(args);
  if (values.help) {
    printUsage();
    return 0;
  }

  const report = evaluateRegressionGateChecks();
  console.log(renderRegressionGateReport(report));
  return report.overallPassed ? 0 : 1;
}

if (import.meta.main) {
  try {
    process.exit(main());
  } catch (error) {
    console.error(`Phase 80 Slack regression gate failed: ${normalizeMessage(error)}`);
    process.exit(1);
  }
}
