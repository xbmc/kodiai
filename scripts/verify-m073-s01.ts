import { evaluateReviewCostBaselineScorecard, type ReviewCostBaselineCheck, type ReviewCostBaselineScorecard } from "../src/review-cost-baseline/scorecard.ts";

export const COMMAND_NAME = "verify:m073:s01" as const;
export const DEFAULT_FIXTURE_PATH: string = "scripts/fixtures/m073-s01-baseline-scorecard.json";

export type M073S01Args = {
  readonly fixturePath: string;
  readonly json: boolean;
  readonly help: boolean;
};

export type M073S01StatusCode =
  | "m073_s01_ok"
  | "m073_s01_scorecard_failed"
  | "m073_s01_invalid_json"
  | "m073_s01_fixture_read_failed"
  | "m073_s01_invalid_arg";

export type M073S01ObservedCaseTotals = {
  readonly caseId: string;
  readonly scenario: string;
  readonly deliveryCount: number;
  readonly promptSectionCount: number;
  readonly promptEstimatedTokens: number;
  readonly promptCharCount: number;
  readonly retrievalExecutionCount: number;
  readonly retrievalStatuses: readonly string[];
  readonly continuationDeliveries: number;
  readonly retryDeliveries: number;
  readonly attributedChildDeliveries: number;
  readonly runtimeExecutions: number;
  readonly runtimeInputTokens: number;
  readonly runtimeOutputTokens: number;
  readonly runtimeCacheReadTokens: number;
  readonly runtimeCacheWriteTokens: number;
  readonly runtimeTotalTokens: number;
  readonly runtimeEstimatedCostUsd: number;
  readonly runtimeDurationMs: number;
  readonly phaseLatencyExecutions: number;
  readonly phaseLatencyMs: number;
};

export type M073S01Report = {
  readonly command: typeof COMMAND_NAME;
  readonly generatedAt: string;
  readonly fixturePath: string;
  readonly overallPassed: boolean;
  readonly statusCode: M073S01StatusCode;
  readonly failedCheckIds: readonly string[];
  readonly checks: readonly ReviewCostBaselineCheck[];
  readonly observedTotals: ReviewCostBaselineScorecard["totals"];
  readonly observedCases: readonly M073S01ObservedCaseTotals[];
  readonly issues: readonly string[];
};

export type M073S01Writer = {
  readonly write: (chunk: string) => unknown;
};

export type M073S01MainOptions = {
  readonly stdout?: M073S01Writer;
  readonly stderr?: M073S01Writer;
  readonly evaluate?: (fixturePath: string) => Promise<M073S01Report>;
};

export type EvaluateM073S01Options = {
  readonly generatedAt?: string;
  readonly readFixtureText?: (fixturePath: string) => Promise<string>;
};

const HELP_TEXT = `Usage: bun scripts/verify-m073-s01.ts [--fixture <path>] [--json] [--help]\n\nVerifies the M073/S01 review cost baseline scorecard fixture without live services.\n\nOptions:\n  --fixture <path>  Local JSON fixture path (default: ${DEFAULT_FIXTURE_PATH})\n  --json            Emit machine-readable JSON only\n  --help, -h        Show this help\n`;

const MAX_ISSUES = 20;

export function parseM073S01Args(args: readonly string[]): M073S01Args {
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

export async function evaluateM073S01Fixture(fixturePath = DEFAULT_FIXTURE_PATH, options: EvaluateM073S01Options = {}): Promise<M073S01Report> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const readFixtureText = options.readFixtureText ?? ((path: string) => Bun.file(path).text());

  let fixtureText: string;
  try {
    fixtureText = await readFixtureText(fixturePath);
  } catch {
    return buildFailureReport({
      generatedAt,
      fixturePath,
      statusCode: "m073_s01_fixture_read_failed",
      checkId: "cases.present",
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
      statusCode: "m073_s01_invalid_json",
      checkId: "cases.present",
      message: "Fixture JSON could not be parsed.",
      issues: ["Fixture must be valid JSON."],
    });
  }

  const scorecard = evaluateReviewCostBaselineScorecard(fixture);
  const failedChecks = scorecard.checks.filter((check) => check.status === "fail");
  const issues = boundIssues(failedChecks.flatMap((check) => check.issues.length > 0 ? check.issues : [check.message]));

  return {
    command: COMMAND_NAME,
    generatedAt,
    fixturePath,
    overallPassed: scorecard.status === "pass",
    statusCode: scorecard.status === "pass" ? "m073_s01_ok" : "m073_s01_scorecard_failed",
    failedCheckIds: uniqueSorted(failedChecks.map((check) => check.id)),
    checks: scorecard.checks,
    observedTotals: scorecard.totals,
    observedCases: scorecard.cases.map((reviewCase) => ({
      caseId: reviewCase.caseId,
      scenario: reviewCase.scenario,
      deliveryCount: reviewCase.deliveryIds.length,
      promptSectionCount: reviewCase.promptSections.reduce((sum, row) => sum + row.executions, 0),
      promptEstimatedTokens: reviewCase.promptSections.reduce((sum, row) => sum + row.totalEstimatedTokens, 0),
      promptCharCount: reviewCase.promptSections.reduce((sum, row) => sum + row.totalCharCount, 0),
      retrievalExecutionCount: reviewCase.retrievalCache.reduce((sum, row) => sum + row.executions, 0),
      retrievalStatuses: uniqueSorted(reviewCase.retrievalCache.flatMap((row) => row.statuses)),
      continuationDeliveries: reviewCase.continuationRetry.continuationDeliveries,
      retryDeliveries: reviewCase.continuationRetry.retryDeliveries,
      attributedChildDeliveries: reviewCase.continuationRetry.attributedChildDeliveries,
      runtimeExecutions: reviewCase.runtimeUsage.executions,
      runtimeInputTokens: reviewCase.runtimeUsage.inputTokens,
      runtimeOutputTokens: reviewCase.runtimeUsage.outputTokens,
      runtimeCacheReadTokens: reviewCase.runtimeUsage.cacheReadTokens,
      runtimeCacheWriteTokens: reviewCase.runtimeUsage.cacheWriteTokens,
      runtimeTotalTokens: reviewCase.runtimeUsage.totalTokens,
      runtimeEstimatedCostUsd: reviewCase.runtimeUsage.estimatedCostUsd,
      runtimeDurationMs: reviewCase.runtimeUsage.durationMs,
      phaseLatencyExecutions: reviewCase.phaseLatencies.reduce((sum, row) => sum + row.executions, 0),
      phaseLatencyMs: reviewCase.phaseLatencies.reduce((sum, row) => sum + row.totalDurationMs, 0),
    })),
    issues,
  };
}

export async function main(args = Bun.argv.slice(2), options: M073S01MainOptions = {}): Promise<number> {
  const stdout = options.stdout ?? { write: (chunk: string) => process.stdout.write(chunk) };
  const stderr = options.stderr ?? { write: (chunk: string) => process.stderr.write(chunk) };

  let parsed: M073S01Args;
  try {
    parsed = parseM073S01Args(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid_cli_args";
    const report = buildFailureReport({
      generatedAt: new Date().toISOString(),
      fixturePath: DEFAULT_FIXTURE_PATH,
      statusCode: "m073_s01_invalid_arg",
      checkId: "cases.present",
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

  const evaluate = options.evaluate ?? ((fixturePath: string) => evaluateM073S01Fixture(fixturePath));
  const report = await evaluate(parsed.fixturePath);
  writeReport(report, { json: parsed.json, stdout, stderr });
  return report.overallPassed ? 0 : 1;
}

function buildFailureReport(params: {
  readonly generatedAt: string;
  readonly fixturePath: string;
  readonly statusCode: M073S01StatusCode;
  readonly checkId: ReviewCostBaselineCheck["id"];
  readonly message: string;
  readonly issues: readonly string[];
}): M073S01Report {
  const check: ReviewCostBaselineCheck = {
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
    observedTotals: {
      caseCount: 0,
      deliveryCount: 0,
      promptEstimatedTokens: 0,
      promptCharCount: 0,
      runtimeInputTokens: 0,
      runtimeOutputTokens: 0,
      runtimeCacheReadTokens: 0,
      runtimeCacheWriteTokens: 0,
      runtimeTotalTokens: 0,
      runtimeEstimatedCostUsd: 0,
      runtimeDurationMs: 0,
      phaseLatencyMs: 0,
    },
    observedCases: [],
    issues: check.issues,
  };
}

function writeReport(report: M073S01Report, options: {
  readonly json: boolean;
  readonly stdout: M073S01Writer;
  readonly stderr: M073S01Writer;
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
    `caseCount: ${report.observedTotals.caseCount}`,
    `runtimeTotalTokens: ${report.observedTotals.runtimeTotalTokens}`,
    `phaseLatencyMs: ${report.observedTotals.phaseLatencyMs}`,
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

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
