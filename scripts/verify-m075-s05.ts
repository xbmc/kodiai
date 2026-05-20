export const COMMAND_NAME = "verify:m075:s05" as const;
export const EXPECTED_PACKAGE_SCRIPT = "bun scripts/verify-m075-s05.ts" as const;

export type M075S05Args = { readonly json: boolean; readonly help: boolean };
export type M075S05CheckId =
  | "package-wiring.present"
  | "runtime-log.present"
  | "runtime-classifier-input.bounded"
  | "resilience-types.present"
  | "resilience-store.persisted"
  | "migrations.present"
  | "tests.coverage-present"
  | "redaction.raw-canaries-absent";
export type M075S05CheckStatus = "pass" | "fail";
export type M075S05Check = {
  readonly id: M075S05CheckId;
  readonly status: M075S05CheckStatus;
  readonly message: string;
  readonly issues: readonly string[];
};
export type M075S05Report = {
  readonly command: typeof COMMAND_NAME;
  readonly generatedAt: string;
  readonly success: boolean;
  readonly statusCode: "m075_s05_ok" | "m075_s05_contract_failed" | "m075_s05_invalid_arg";
  readonly failedCheckIds: readonly M075S05CheckId[];
  readonly checks: readonly M075S05Check[];
  readonly issues: readonly string[];
};
export type M075S05EvaluateOptions = {
  readonly generatedAt?: string;
  readonly readTextFile?: (path: string) => Promise<string>;
};
export type M075S05Writer = { readonly write: (chunk: string) => unknown };
export type M075S05MainOptions = {
  readonly stdout?: M075S05Writer;
  readonly stderr?: M075S05Writer;
  readonly evaluate?: () => Promise<M075S05Report>;
};

const HELP_TEXT = `Usage: bun scripts/verify-m075-s05.ts [--json] [--help]\n\nVerifies the M075/S05 timeout classification runtime and telemetry contract from tracked source files.\n`;
const MAX_ISSUES = 24;
const SOURCE_FILES = {
  packageJson: "package.json",
  review: "src/handlers/review.ts",
  reviewTest: "src/handlers/review.test.ts",
  telemetryTypes: "src/telemetry/types.ts",
  telemetryStore: "src/telemetry/store.ts",
  telemetryStoreTest: "src/telemetry/store.test.ts",
  migration: "src/db/migrations/044-review-timeout-classification.sql",
  migrationDown: "src/db/migrations/044-review-timeout-classification.down.sql",
} as const;
const FORBIDDEN_RUNTIME_LOG_CANARIES = [
  "rawPrompt",
  "rawModelOutput",
  "candidateBody",
  "diffContent",
  "githubResponsePayload",
  "rawLogs",
  "SECRET_TOKEN_CANARY",
] as const;

export function parseM075S05Args(args: readonly string[]): M075S05Args {
  const parsed: M075S05Args = { json: false, help: false };
  for (const arg of args) {
    if (arg === "--json") parsed.json = true;
    else if (arg === "--help" || arg === "-h") parsed.help = true;
    else throw new Error(`invalid_cli_args: Unknown argument: ${arg}`);
  }
  return parsed;
}

export async function evaluateM075S05Contract(options: M075S05EvaluateOptions = {}): Promise<M075S05Report> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const readTextFile = options.readTextFile ?? ((path: string) => Bun.file(path).text());
  const files = new Map<string, string>();
  const readIssues: string[] = [];
  for (const filePath of Object.values(SOURCE_FILES)) {
    try {
      files.set(filePath, await readTextFile(filePath));
    } catch (err) {
      readIssues.push(`${filePath}: ${(err as Error).message}`);
      files.set(filePath, "");
    }
  }

  const packageJson = files.get(SOURCE_FILES.packageJson) ?? "";
  const review = files.get(SOURCE_FILES.review) ?? "";
  const reviewTest = files.get(SOURCE_FILES.reviewTest) ?? "";
  const telemetryTypes = files.get(SOURCE_FILES.telemetryTypes) ?? "";
  const telemetryStore = files.get(SOURCE_FILES.telemetryStore) ?? "";
  const telemetryStoreTest = files.get(SOURCE_FILES.telemetryStoreTest) ?? "";
  const migration = files.get(SOURCE_FILES.migration) ?? "";
  const migrationDown = files.get(SOURCE_FILES.migrationDown) ?? "";

  const checks: M075S05Check[] = [
    check(
      "package-wiring.present",
      packageJson.includes(`"${COMMAND_NAME}": "${EXPECTED_PACKAGE_SCRIPT}"`),
      "Package script is wired for the S05 verifier.",
      [`Expected package.json scripts.${COMMAND_NAME} to equal '${EXPECTED_PACKAGE_SCRIPT}'.`],
    ),
    check(
      "runtime-log.present",
      review.includes("classifyReviewTimeoutOutcome")
        && review.includes('gate: timeoutClassification.gate')
        && review.includes('gateResult: timeoutClassification.classification')
        && review.includes('"Review timeout classification"')
        && review.includes("reviewOutputKey")
        && review.includes("deliveryId: event.id"),
      "Review runtime emits structured timeout classification logs with correlation keys.",
      ["Expected review.ts to import/use the classifier and log gate, gateResult, deliveryId, and reviewOutputKey."],
    ),
    check(
      "runtime-classifier-input.bounded",
      review.includes("checkpointFilesReviewed")
        && review.includes("checkpointFilesInspected")
        && review.includes("checkpointFindingCount")
        && review.includes("retryFilesCount")
        && review.includes("recentTimeouts")
        && review.includes("longRunThresholdSeconds")
        && review.includes("redaction: timeoutClassification.redaction"),
      "Runtime classifier input/log projection is bounded to counts and safe state.",
      ["Expected bounded checkpoint/retry/recent-timeout/long-run counts and redaction flags in the log projection."],
    ),
    check(
      "resilience-types.present",
      telemetryTypes.includes("timeoutClassification?: string")
        && telemetryTypes.includes("timeoutClassificationMode?: string")
        && telemetryTypes.includes("timeoutClassificationReasons?: string[]"),
      "Resilience telemetry type exposes safe timeout classification fields.",
      ["Expected ResilienceEventRecord classification, mode, and reason-code fields."],
    ),
    check(
      "resilience-store.persisted",
      telemetryStore.includes("timeout_classification")
        && telemetryStore.includes("timeout_classification_mode")
        && telemetryStore.includes("timeout_classification_reasons")
        && telemetryStore.includes("timeoutClassificationReasons ?? []")
        && telemetryStore.includes("EXCLUDED.timeout_classification_reasons"),
      "Telemetry store inserts and upserts timeout classification fields.",
      ["Expected timeout classification columns in INSERT values and ON CONFLICT update."],
    ),
    check(
      "migrations.present",
      migration.includes("ADD COLUMN IF NOT EXISTS timeout_classification TEXT")
        && migration.includes("ADD COLUMN IF NOT EXISTS timeout_classification_mode TEXT")
        && migration.includes("ADD COLUMN IF NOT EXISTS timeout_classification_reasons TEXT[]")
        && migrationDown.includes("DROP COLUMN IF EXISTS timeout_classification_reasons")
        && migrationDown.includes("DROP COLUMN IF EXISTS timeout_classification_mode")
        && migrationDown.includes("DROP COLUMN IF EXISTS timeout_classification"),
      "Forward and rollback migrations exist for timeout classification telemetry columns.",
      ["Expected 044 forward/down migrations for classification, mode, and reason-code columns."],
    ),
    check(
      "tests.coverage-present",
      reviewTest.includes("logs bounded partial timeout classification")
        && reviewTest.includes("zero-evidence")
        && reviewTest.includes("chronic-timeout")
        && reviewTest.includes("max-turns-continuation")
        && reviewTest.includes("Resilience telemetry write failed (non-blocking)")
        && telemetryStoreTest.includes("writes timeout classification fields without raw payloads"),
      "Focused runtime and telemetry tests cover timeout classifications and fail-open telemetry writes.",
      ["Expected handler/store tests for bounded partial, zero evidence, max turns, chronic timeout, and telemetry failure behavior."],
    ),
    check(
      "redaction.raw-canaries-absent",
      !FORBIDDEN_RUNTIME_LOG_CANARIES.some((canary) => runtimeClassificationLogBlock(review).includes(canary)),
      "Runtime classification log projection excludes raw payload canary names.",
      ["Raw prompt/model/candidate/diff/GitHub payload/log canary key appeared in the runtime classification log block."],
    ),
  ];

  if (readIssues.length > 0) {
    checks.unshift(fail("runtime-log.present", "Required source files could not all be read.", readIssues));
  }
  const failed = checks.filter((entry) => entry.status === "fail");
  return {
    command: COMMAND_NAME,
    generatedAt,
    success: failed.length === 0,
    statusCode: failed.length === 0 ? "m075_s05_ok" : "m075_s05_contract_failed",
    failedCheckIds: Array.from(new Set(failed.map((entry) => entry.id))).sort() as M075S05CheckId[],
    checks,
    issues: failed.flatMap((entry) => entry.issues.map((issue) => `${entry.id}: ${issue}`)).slice(0, MAX_ISSUES),
  };
}

export async function main(argv: readonly string[] = Bun.argv.slice(2), options: M075S05MainOptions = {}): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  let args: M075S05Args;
  try {
    args = parseM075S05Args(argv);
  } catch (err) {
    const report: M075S05Report = {
      command: COMMAND_NAME,
      generatedAt: new Date().toISOString(),
      success: false,
      statusCode: "m075_s05_invalid_arg",
      failedCheckIds: [],
      checks: [],
      issues: [(err as Error).message],
    };
    stdout.write(JSON.stringify(report, null, 2) + "\n");
    return 1;
  }
  if (args.help) {
    stdout.write(HELP_TEXT);
    return 0;
  }
  const report = await (options.evaluate ?? (() => evaluateM075S05Contract()))();
  if (args.json) stdout.write(JSON.stringify(report, null, 2) + "\n");
  else stdout.write(renderM075S05Report(report));
  if (!report.success) stderr.write(`${report.statusCode}: ${report.issues.join("; ")}\n`);
  return report.success ? 0 : 1;
}

export function renderM075S05Report(report: M075S05Report): string {
  const lines = [
    `M075/S05 timeout classification verifier: ${report.success ? "PASS" : "FAIL"}`,
    `status=${report.statusCode}`,
  ];
  for (const check of report.checks) {
    lines.push(`${check.id} ${check.status.toUpperCase()} - ${check.message}`);
    for (const issue of check.issues) lines.push(`  - ${issue}`);
  }
  return `${lines.join("\n")}\n`;
}

function check(id: M075S05CheckId, passed: boolean, message: string, issues: readonly string[]): M075S05Check {
  return passed ? { id, status: "pass", message, issues: [] } : fail(id, message, issues);
}

function fail(id: M075S05CheckId, message: string, issues: readonly string[]): M075S05Check {
  return { id, status: "fail", message, issues };
}

function runtimeClassificationLogBlock(reviewSource: string): string {
  const gate = reviewSource.indexOf("gate: timeoutClassification.gate");
  if (gate < 0) return "";
  const start = Math.max(0, reviewSource.lastIndexOf("logger.info(", gate));
  const end = reviewSource.indexOf('"Review timeout classification"', gate);
  return end < 0 ? reviewSource.slice(start, gate + 2_000) : reviewSource.slice(start, end + 80);
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
