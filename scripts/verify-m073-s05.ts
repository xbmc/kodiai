import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  aggregateVisibleBudgetProjections,
  evaluateVisibleBudgetFixture,
  type VisibleBudgetCheck,
  type VisibleBudgetCheckId,
  type VisibleBudgetProjection,
  type VisibleBudgetSummary,
} from "../src/review-visible-budget/visible-budget-behavior.ts";

export const COMMAND_NAME = "verify:m073:s05" as const;
export const DEFAULT_FIXTURE_PATH = "scripts/fixtures/m073-s05-visible-budget.json";

export type M073S05StatusCode =
  | "m073_s05_ok"
  | "m073_s05_visible_budget_failed"
  | "m073_s05_invalid_json"
  | "m073_s05_fixture_read_failed"
  | "m073_s05_invalid_arg";

export type M073S05Report = {
  readonly command: typeof COMMAND_NAME;
  readonly generatedAt: string;
  readonly fixturePath: string;
  readonly overallPassed: boolean;
  readonly statusCode: M073S05StatusCode;
  readonly failedCheckIds: readonly VisibleBudgetCheckId[];
  readonly checks: readonly VisibleBudgetCheck[];
  readonly observedTotals: VisibleBudgetSummary;
  readonly issues: readonly string[];
};

export type M073S05Args = {
  readonly fixturePath: string;
  readonly json: boolean;
  readonly help: boolean;
};

export type M073S05Writer = {
  readonly write: (chunk: string) => unknown;
};

export type M073S05MainOptions = {
  readonly stdout?: M073S05Writer;
  readonly stderr?: M073S05Writer;
  readonly evaluate?: (fixturePath: string) => Promise<M073S05Report>;
};

export type EvaluateM073S05Options = {
  readonly generatedAt?: string;
  readonly readFixtureText?: (fixturePath: string) => Promise<string>;
};

const HELP_TEXT = `Usage: bun scripts/verify-m073-s05.ts [--fixture <path>] [--json] [--help]\n\nVerifies the M073/S05 bounded visible budget behavior fixture without live services.\n\nOptions:\n  --fixture <path>  Local JSON fixture path (default: ${DEFAULT_FIXTURE_PATH})\n  --json            Emit machine-readable JSON only\n  --help, -h        Show this help\n`;
const MAX_ISSUES = 20;
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = dirname(SCRIPT_DIR);

export function parseM073S05Args(args: readonly string[]): M073S05Args {
  let fixturePath = DEFAULT_FIXTURE_PATH;
  let json = false;
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--fixture") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("invalid_cli_args: --fixture requires a path value");
      }
      fixturePath = value;
      index += 1;
      continue;
    }
    throw new Error(`invalid_cli_args: Unknown argument: ${arg}`);
  }

  return { fixturePath, json, help };
}

export async function evaluateM073S05Fixture(fixturePath = DEFAULT_FIXTURE_PATH, options: EvaluateM073S05Options = {}): Promise<M073S05Report> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const readFixtureText = options.readFixtureText ?? ((path: string) => Bun.file(path).text());

  let fixtureText: string;
  try {
    fixtureText = await readFixtureText(resolveFixtureReadPath(fixturePath));
  } catch {
    return buildFailureReport({
      generatedAt,
      fixturePath,
      statusCode: "m073_s05_fixture_read_failed",
      checkId: "fixture.shape",
      message: "Fixture could not be read.",
      issues: ["Fixture path is missing or unreadable."],
    });
  }

  let fixture: unknown;
  try {
    fixture = JSON.parse(fixtureText);
  } catch {
    return buildFailureReport({
      generatedAt,
      fixturePath,
      statusCode: "m073_s05_invalid_json",
      checkId: "fixture.shape",
      message: "Fixture JSON could not be parsed.",
      issues: ["Fixture must be valid JSON."],
    });
  }

  const evaluation = evaluateVisibleBudgetFixture(fixture);
  const failedChecks = evaluation.checks.filter((check) => check.status === "fail");
  const issues = boundIssues(failedChecks.flatMap((check) => check.issues.length > 0 ? check.issues : [check.message]));

  return {
    command: COMMAND_NAME,
    generatedAt,
    fixturePath,
    overallPassed: failedChecks.length === 0,
    statusCode: failedChecks.length === 0 ? "m073_s05_ok" : "m073_s05_visible_budget_failed",
    failedCheckIds: uniqueSorted(failedChecks.map((check) => check.id)),
    checks: evaluation.checks,
    observedTotals: evaluation.totals,
    issues,
  };
}

export async function main(args = Bun.argv.slice(2), options: M073S05MainOptions = {}): Promise<number> {
  const stdout = options.stdout ?? { write: (chunk: string) => process.stdout.write(chunk) };
  const stderr = options.stderr ?? { write: (chunk: string) => process.stderr.write(chunk) };

  let parsed: M073S05Args;
  try {
    parsed = parseM073S05Args(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid_cli_args";
    const report = buildFailureReport({
      generatedAt: new Date().toISOString(),
      fixturePath: DEFAULT_FIXTURE_PATH,
      statusCode: "m073_s05_invalid_arg",
      checkId: "fixture.shape",
      message: "CLI arguments are invalid.",
      issues: [message],
    });
    writeReport(report, { json: args.includes("--json"), stdout, stderr });
    return 2;
  }

  if (parsed.help) {
    stdout.write(HELP_TEXT);
    return 0;
  }

  const evaluate = options.evaluate ?? ((fixturePath: string) => evaluateM073S05Fixture(fixturePath));
  const report = await evaluate(parsed.fixturePath);
  writeReport(report, { json: parsed.json, stdout, stderr });
  return report.overallPassed ? 0 : 1;
}

function resolveFixtureReadPath(fixturePath: string): string {
  if (fixturePath !== DEFAULT_FIXTURE_PATH) return fixturePath;
  if (existsSync(fixturePath)) return fixturePath;
  return join(PROJECT_ROOT, fixturePath);
}

function buildFailureReport(params: {
  readonly generatedAt: string;
  readonly fixturePath: string;
  readonly statusCode: M073S05StatusCode;
  readonly checkId: VisibleBudgetCheckId;
  readonly message: string;
  readonly issues: readonly string[];
}): M073S05Report {
  const check: VisibleBudgetCheck = {
    id: params.checkId,
    status: "fail",
    message: params.message,
    issues: boundIssues(params.issues),
  };
  return {
    command: COMMAND_NAME,
    generatedAt: params.generatedAt,
    fixturePath: params.fixturePath,
    overallPassed: false,
    statusCode: params.statusCode,
    failedCheckIds: [params.checkId],
    checks: [check],
    observedTotals: emptyObservedTotals(),
    issues: check.issues,
  };
}

function emptyObservedTotals(): VisibleBudgetSummary {
  return aggregateVisibleBudgetProjections([] as VisibleBudgetProjection[]);
}

function writeReport(report: M073S05Report, options: {
  readonly json: boolean;
  readonly stdout: M073S05Writer;
  readonly stderr: M073S05Writer;
}): void {
  if (options.json) {
    options.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  const lines = [
    `${report.command}: ${report.overallPassed ? "PASS" : "FAIL"}`,
    `fixture: ${report.fixturePath}`,
    `statusCode: ${report.statusCode}`,
    `failedCheckIds: ${report.failedCheckIds.length > 0 ? report.failedCheckIds.join(",") : "none"}`,
    `projections: ${report.observedTotals.projectionCount}`,
    `promptSections: ${report.observedTotals.promptSectionCount}`,
    `promptTrimmedSections: ${report.observedTotals.promptTrimmedSectionCount}`,
    `promptBypassedSections: ${report.observedTotals.promptBypassedSectionCount}`,
    `promptTrimmedTokens: ${report.observedTotals.promptTrimmedTokenCount}`,
    `cacheObservations: ${report.observedTotals.cacheObservationCount}`,
    `continuationObservations: ${report.observedTotals.continuationObservationCount}`,
    `continuationFallbacks: ${report.observedTotals.continuationFallbackCount}`,
  ];
  if (!report.overallPassed && report.issues.length > 0) {
    lines.push("issues:", ...report.issues.map((issue) => `- ${issue}`));
  }
  const stream = report.overallPassed ? options.stdout : options.stderr;
  stream.write(`${lines.join("\n")}\n`);
}

function boundIssues(issues: readonly string[]): string[] {
  return issues.slice(0, MAX_ISSUES).map((issue) => issue.length > 220 ? `${issue.slice(0, 217)}...` : issue);
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
