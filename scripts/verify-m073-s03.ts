import {
  evaluateReviewCacheTelemetryFixture,
  type ReviewCacheTelemetryCheck,
  type ReviewCacheTelemetryCheckId,
  type ReviewCacheTelemetrySummary,
} from "../src/review-cache-telemetry/cache-telemetry.ts";

export const COMMAND_NAME = "verify:m073:s03" as const;
export const DEFAULT_FIXTURE_PATH = "scripts/fixtures/m073-s03-cache-telemetry.json";

export type M073S03StatusCode =
  | "m073_s03_ok"
  | "m073_s03_cache_telemetry_failed"
  | "m073_s03_invalid_json"
  | "m073_s03_fixture_read_failed"
  | "m073_s03_invalid_arg";

export type M073S03Report = {
  readonly command: typeof COMMAND_NAME;
  readonly generatedAt: string;
  readonly fixturePath: string;
  readonly overallPassed: boolean;
  readonly statusCode: M073S03StatusCode;
  readonly failedCheckIds: readonly ReviewCacheTelemetryCheckId[];
  readonly checks: readonly ReviewCacheTelemetryCheck[];
  readonly observedTotals: ReviewCacheTelemetrySummary;
  readonly issues: readonly string[];
};

export type M073S03Args = {
  readonly fixturePath: string;
  readonly json: boolean;
  readonly help: boolean;
};

export type M073S03Writer = {
  readonly write: (chunk: string) => unknown;
};

export type M073S03MainOptions = {
  readonly stdout?: M073S03Writer;
  readonly stderr?: M073S03Writer;
  readonly evaluate?: (fixturePath: string) => Promise<M073S03Report>;
};

export type EvaluateM073S03Options = {
  readonly generatedAt?: string;
  readonly readFixtureText?: (fixturePath: string) => Promise<string>;
};

const HELP_TEXT = `Usage: bun scripts/verify-m073-s03.ts [--fixture <path>] [--json] [--help]\n\nVerifies the M073/S03 text-free review cache telemetry fixture without live services.\n\nOptions:\n  --fixture <path>  Local JSON fixture path (default: ${DEFAULT_FIXTURE_PATH})\n  --json            Emit machine-readable JSON only\n  --help, -h        Show this help\n`;
const MAX_ISSUES = 20;

export function parseM073S03Args(args: readonly string[]): M073S03Args {
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

export async function evaluateM073S03Fixture(fixturePath = DEFAULT_FIXTURE_PATH, options: EvaluateM073S03Options = {}): Promise<M073S03Report> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const readFixtureText = options.readFixtureText ?? ((path: string) => Bun.file(path).text());

  let fixtureText: string;
  try {
    fixtureText = await readFixtureText(fixturePath);
  } catch {
    return buildFailureReport({
      generatedAt,
      fixturePath,
      statusCode: "m073_s03_fixture_read_failed",
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
      statusCode: "m073_s03_invalid_json",
      checkId: "fixture.shape",
      message: "Fixture JSON could not be parsed.",
      issues: ["Fixture must be valid JSON."],
    });
  }

  const evaluation = evaluateReviewCacheTelemetryFixture(fixture);
  const failedChecks = evaluation.checks.filter((check) => check.status === "fail");
  const issues = boundIssues(failedChecks.flatMap((check) => check.issues.length > 0 ? check.issues : [check.message]));

  return {
    command: COMMAND_NAME,
    generatedAt,
    fixturePath,
    overallPassed: failedChecks.length === 0,
    statusCode: failedChecks.length === 0 ? "m073_s03_ok" : "m073_s03_cache_telemetry_failed",
    failedCheckIds: uniqueSorted(failedChecks.map((check) => check.id)),
    checks: evaluation.checks,
    observedTotals: evaluation.totals,
    issues,
  };
}

export async function main(args = Bun.argv.slice(2), options: M073S03MainOptions = {}): Promise<number> {
  const stdout = options.stdout ?? { write: (chunk: string) => process.stdout.write(chunk) };
  const stderr = options.stderr ?? { write: (chunk: string) => process.stderr.write(chunk) };

  let parsed: M073S03Args;
  try {
    parsed = parseM073S03Args(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid_cli_args";
    const report = buildFailureReport({
      generatedAt: new Date().toISOString(),
      fixturePath: DEFAULT_FIXTURE_PATH,
      statusCode: "m073_s03_invalid_arg",
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

  const evaluate = options.evaluate ?? ((fixturePath: string) => evaluateM073S03Fixture(fixturePath));
  const report = await evaluate(parsed.fixturePath);
  writeReport(report, { json: parsed.json, stdout, stderr });
  return report.overallPassed ? 0 : 1;
}

function buildFailureReport(params: {
  readonly generatedAt: string;
  readonly fixturePath: string;
  readonly statusCode: M073S03StatusCode;
  readonly checkId: ReviewCacheTelemetryCheckId;
  readonly message: string;
  readonly issues: readonly string[];
}): M073S03Report {
  const check: ReviewCacheTelemetryCheck = {
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

function emptyObservedTotals(): ReviewCacheTelemetrySummary {
  return {
    observationCount: 0,
    deliveryCount: 0,
    surfaceCounts: { "review-derived-prompt": 0, "retrieval-query-embedding": 0 },
    statusCounts: { hit: 0, miss: 0, degraded: 0, bypass: 0 },
    reasonCounts: {
      "safe-reuse": 0,
      "cache-miss": 0,
      "bookkeeping-failure": 0,
      "incomplete-fingerprint": 0,
      "expired-stale-entry": 0,
      "disabled-cache": 0,
      "unavailable-retrieval": 0,
    },
    surfaceStatusCounts: {
      "review-derived-prompt": { hit: 0, miss: 0, degraded: 0, bypass: 0 },
      "retrieval-query-embedding": { hit: 0, miss: 0, degraded: 0, bypass: 0 },
    },
    surfaceReasonCounts: {
      "review-derived-prompt": {
        "safe-reuse": 0,
        "cache-miss": 0,
        "bookkeeping-failure": 0,
        "incomplete-fingerprint": 0,
        "expired-stale-entry": 0,
        "disabled-cache": 0,
        "unavailable-retrieval": 0,
      },
      "retrieval-query-embedding": {
        "safe-reuse": 0,
        "cache-miss": 0,
        "bookkeeping-failure": 0,
        "incomplete-fingerprint": 0,
        "expired-stale-entry": 0,
        "disabled-cache": 0,
        "unavailable-retrieval": 0,
      },
    },
    bookkeepingErrorCount: 0,
    missingSignalNames: [],
    invalidationSignalNames: [],
  };
}

function writeReport(report: M073S03Report, options: {
  readonly json: boolean;
  readonly stdout: M073S03Writer;
  readonly stderr: M073S03Writer;
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
    `observations: ${report.observedTotals.observationCount}`,
    `deliveries: ${report.observedTotals.deliveryCount}`,
    `hits: ${report.observedTotals.statusCounts.hit}`,
    `misses: ${report.observedTotals.statusCounts.miss}`,
    `degraded: ${report.observedTotals.statusCounts.degraded}`,
    `bypass: ${report.observedTotals.statusCounts.bypass}`,
    `bookkeepingErrors: ${report.observedTotals.bookkeepingErrorCount}`,
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
