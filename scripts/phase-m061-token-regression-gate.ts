import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

export const CHECK_PREFIX = "M061-REG";

type CliValues = {
  help?: boolean;
};

export type SuiteDefinition = {
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
    id: `${CHECK_PREFIX}-MENTION-01`,
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
    id: `${CHECK_PREFIX}-REVIEW-01`,
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
    id: `${CHECK_PREFIX}-RETRIEVAL-01`,
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
    id: `${CHECK_PREFIX}-REPORTING-01`,
    title: "Usage report regression suite passes",
    command: ["bun", "test", "./scripts/usage-report.test.ts", "--timeout", "30000"],
  },
  {
    id: `${CHECK_PREFIX}-VERIFIERS-01`,
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
  console.log(`M061 token regression gate

Runs pinned mention, review, retrieval, reporting, and verifier suites with stable ${CHECK_PREFIX}-* check IDs.

Usage:
  bun scripts/phase-m061-token-regression-gate.ts [options]

Options:
  -h, --help   show this help

Pinned suites:
  - mention: ./src/execution/mention-context.test.ts ./src/execution/mention-prompt.test.ts ./src/handlers/mention.test.ts
  - review: ./src/execution/review-prompt.test.ts ./src/handlers/review.test.ts
  - retrieval: ./src/knowledge/retrieval.test.ts ./src/knowledge/retrieval.e2e.test.ts ./src/knowledge/multi-query-retrieval.test.ts
  - reporting: ./scripts/usage-report.test.ts
  - verifiers: ./scripts/verify-m061-s01.test.ts ./scripts/verify-m061-s02.test.ts ./scripts/verify-m061-s03.test.ts ./scripts/verify-m061-s04.test.ts ./scripts/verify-m061-s05.test.ts

Blocking rule:
  Exit code is non-zero when any ${CHECK_PREFIX}-* check fails.`);
}

function normalizeOutput(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function createMalformedCommandResult(reason: string): SuiteCommandResult {
  return {
    status: null,
    stdout: "",
    stderr: "",
    error: reason,
  };
}

function validateSuiteCommand(command: string[]): SuiteCommandResult | null {
  const [executable] = command;
  if (command.length === 0 || !executable || executable.trim().length === 0) {
    return createMalformedCommandResult("missing executable");
  }

  return null;
}

function runSuiteCommand(command: string[]): SuiteCommandResult {
  const malformed = validateSuiteCommand(command);
  if (malformed) {
    return malformed;
  }

  const [executable, ...args] = command;
  const result = spawnSync(executable!, args, {
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

function normalizeMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }

  const text = String(error ?? "").trim();
  return text.length > 0 ? text : "Unknown error";
}

export function evaluateRegressionGateChecks(
  suites: SuiteDefinition[] = PINNED_SUITES,
  runCommand: (command: string[]) => SuiteCommandResult = runSuiteCommand,
): RegressionGateReport {
  const checks = suites.map((suite) => {
    const malformed = validateSuiteCommand(suite.command);
    if (malformed) {
      return {
        id: suite.id,
        title: suite.title,
        passed: false,
        details: buildFailureDetails(malformed),
      };
    }

    try {
      const result = runCommand(suite.command);
      const passed = result.status === 0;
      return {
        id: suite.id,
        title: suite.title,
        passed,
        details: passed ? "suite passed" : buildFailureDetails(result),
      };
    } catch (error) {
      const failure = createMalformedCommandResult(normalizeMessage(error));
      return {
        id: suite.id,
        title: suite.title,
        passed: false,
        details: buildFailureDetails(failure),
      };
    }
  });

  return {
    overallPassed: checks.every((check) => check.passed),
    checks,
  };
}

export function renderRegressionGateReport(report: RegressionGateReport): string {
  const failedIds = report.checks.filter((check) => !check.passed).map((check) => check.id);

  return [
    "M061 token regression gate",
    "",
    ...report.checks.map((check) => `${check.id} ${check.passed ? "PASS" : "FAIL"} - ${check.title}. ${check.details}`),
    "",
    report.overallPassed
      ? `Final verdict: PASS - all ${CHECK_PREFIX}-* checks passed.`
      : `Final verdict: FAIL - blocking checks failed [${failedIds.join(", ")}].`,
  ].join("\n");
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
    console.error(`M061 token regression gate failed: ${normalizeMessage(error)}`);
    process.exit(1);
  }
}
