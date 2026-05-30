import {
  prepareLearningMemoryRecordForSql,
} from "../src/knowledge/memory-store.ts";
import type { LearningMemoryRecord } from "../src/knowledge/types.ts";
import {
  buildReviewLearningMemoryRecord,
  isReviewLearningMemorySkip,
  type BuildReviewLearningMemoryRecordInput,
  type ReviewLearningMemoryDecision,
} from "../src/handlers/review-learning-memory.ts";

export const COMMAND_NAME = "verify:m075:s02" as const;
export const EXPECTED_PACKAGE_SCRIPT = "bun scripts/verify-m075-s02.ts" as const;

export const M075_S02_CHECK_IDS = [
  "memory-store-required-fields",
  "memory-store-optional-fields",
  "review-helper-missing-comment-id",
  "review-helper-invalid-embedding-metadata",
  "package-wiring",
] as const;

export type M075S02CheckId = typeof M075_S02_CHECK_IDS[number];

export type M075S02Check = {
  readonly id: M075S02CheckId;
  readonly passed: boolean;
  readonly detail: string;
};

export type M075S02Report = {
  readonly command: typeof COMMAND_NAME;
  readonly generatedAt: string;
  readonly success: boolean;
  readonly statusCode: "m075_s02_ok" | "m075_s02_contract_failed" | "m075_s02_invalid_arg";
  readonly checks: readonly M075S02Check[];
  readonly failedCheckIds: readonly M075S02CheckId[];
};

export type M075S02Args = {
  readonly json: boolean;
  readonly help: boolean;
  readonly simulateUnsafeBoundary: boolean;
};

export type M075S02EvaluationOptions = {
  readonly generatedAt?: string;
  readonly readPackageJsonText?: () => Promise<string>;
  readonly prepareRecordForSql?: typeof prepareLearningMemoryRecordForSql;
  readonly buildReviewRecord?: (input: BuildReviewLearningMemoryRecordInput) => ReviewLearningMemoryDecision;
};

const HELP_TEXT = `Usage: bun scripts/verify-m075-s02.ts [--json] [--simulate-unsafe-boundary] [--help]\n\nVerifies the M075/S02 learning-memory undefined-write hardening contract with safe inline fixtures.\n`;

function makeLearningMemoryRecord(overrides: Partial<LearningMemoryRecord> = {}): LearningMemoryRecord {
  return {
    repo: "acme/widgets",
    owner: "acme",
    findingId: 3164871419,
    reviewId: 42,
    sourceRepo: "acme/widgets",
    findingText: "Avoid dereferencing maybe-null pointer",
    severity: "major",
    category: "correctness",
    filePath: "src/widget.ts",
    outcome: "accepted",
    embeddingModel: "voyage-code-3",
    embeddingDim: 1024,
    stale: false,
    ...overrides,
  };
}

function makeReviewInput(overrides: Partial<BuildReviewLearningMemoryRecordInput> = {}): BuildReviewLearningMemoryRecordInput {
  const { finding: findingOverrides, ...contextOverrides } = overrides;
  return {
    repo: "acme/widgets",
    owner: "acme",
    reviewId: 42,
    prNumber: 75,
    language: "typescript",
    ...contextOverrides,
    finding: {
      commentId: 3164871419,
      suppressed: false,
      title: "Avoid dereferencing maybe-null pointer",
      severity: "major",
      category: "correctness",
      filePath: "src/widget.ts",
      ...findingOverrides,
    },
  };
}

export function parseM075S02Args(args: readonly string[]): M075S02Args {
  let json = false;
  let help = false;
  let simulateUnsafeBoundary = false;

  for (const arg of args) {
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--simulate-unsafe-boundary") {
      simulateUnsafeBoundary = true;
      continue;
    }
    throw new Error(`invalid_cli_args: Unknown argument: ${arg}`);
  }

  return { json, help, simulateUnsafeBoundary };
}

function checkRequiredFields(prepareRecordForSql: typeof prepareLearningMemoryRecordForSql): M075S02Check {
  const unsafeRecord = makeLearningMemoryRecord({ repo: undefined as unknown as string });
  try {
    const prepared = prepareRecordForSql(unsafeRecord);
    const hasUndefined = Object.values(prepared).includes(undefined);
    return {
      id: "memory-store-required-fields",
      passed: false,
      detail: `expected required undefined repo to throw before SQL binding; returned=${hasUndefined ? "contains-undefined" : "no-throw"}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const passed = message === "LearningMemoryRecord.repo is undefined before SQL binding";
    return {
      id: "memory-store-required-fields",
      passed,
      detail: passed ? "required undefined repo rejected locally" : `unexpected error=${message}`,
    };
  }
}

function checkOptionalFields(prepareRecordForSql: typeof prepareLearningMemoryRecordForSql): M075S02Check {
  try {
    const prepared = prepareRecordForSql(makeLearningMemoryRecord({
      id: undefined,
      language: undefined,
      createdAt: undefined,
    }));
    const passed = prepared.id === null
      && prepared.language === null
      && prepared.createdAt === null
      && !Object.values(prepared).includes(undefined);
    return {
      id: "memory-store-optional-fields",
      passed,
      detail: `id=${String(prepared.id)} language=${String(prepared.language)} createdAt=${String(prepared.createdAt)} undefinedValues=${Object.values(prepared).filter((value) => value === undefined).length}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      id: "memory-store-optional-fields",
      passed: false,
      detail: `optional undefined normalization threw=${message}`,
    };
  }
}

function checkMissingCommentId(
  buildReviewRecord: (input: BuildReviewLearningMemoryRecordInput) => ReviewLearningMemoryDecision,
): M075S02Check {
  const decision = buildReviewRecord(makeReviewInput({ finding: { commentId: undefined } }));
  const passed = isReviewLearningMemorySkip(decision)
    && decision.gate === "learning-memory-write"
    && decision.gateResult === "skipped"
    && decision.reason === "missing-finding-id"
    && decision.repo === "acme/widgets"
    && decision.prNumber === 75
    && !("embeddingText" in decision);

  return {
    id: "review-helper-missing-comment-id",
    passed,
    detail: isReviewLearningMemorySkip(decision)
      ? `gateResult=${decision.gateResult} reason=${decision.reason}`
      : "missing comment id produced candidate instead of bounded skip",
  };
}

function checkInvalidEmbeddingMetadata(
  buildReviewRecord: (input: BuildReviewLearningMemoryRecordInput) => ReviewLearningMemoryDecision,
): M075S02Check {
  const decision = buildReviewRecord(makeReviewInput());
  if (decision.kind !== "candidate") {
    return {
      id: "review-helper-invalid-embedding-metadata",
      passed: false,
      detail: `valid finding unexpectedly skipped reason=${decision.reason}`,
    };
  }

  const record = decision.toRecord({ model: undefined, dimensions: undefined });
  const passed = isReviewLearningMemorySkip(record)
    && record.gate === "learning-memory-write"
    && record.gateResult === "skipped"
    && record.reason === "invalid-embedding-metadata";

  return {
    id: "review-helper-invalid-embedding-metadata",
    passed,
    detail: isReviewLearningMemorySkip(record)
      ? `gateResult=${record.gateResult} reason=${record.reason}`
      : "invalid embedding metadata produced a persistable record",
  };
}

function hasExpectedPackageScript(packageJsonText: string): boolean {
  try {
    const packageJson = JSON.parse(packageJsonText) as { scripts?: Record<string, string> };
    return packageJson.scripts?.[COMMAND_NAME] === EXPECTED_PACKAGE_SCRIPT;
  } catch {
    return false;
  }
}

function checkPackageWiring(packageJsonText: string): M075S02Check {
  const passed = hasExpectedPackageScript(packageJsonText);
  return {
    id: "package-wiring",
    passed,
    detail: passed
      ? `${COMMAND_NAME} -> ${EXPECTED_PACKAGE_SCRIPT}`
      : `missing expected package script ${COMMAND_NAME} -> ${EXPECTED_PACKAGE_SCRIPT}`,
  };
}

function unsafePrepareLearningMemoryRecordForSql(record: LearningMemoryRecord): ReturnType<typeof prepareLearningMemoryRecordForSql> {
  return {
    repo: record.repo,
    owner: record.owner,
    findingId: record.findingId,
    reviewId: record.reviewId,
    sourceRepo: record.sourceRepo,
    findingText: record.findingText,
    severity: record.severity,
    category: record.category,
    filePath: record.filePath,
    language: record.language as string | null,
    outcome: record.outcome,
    embeddingModel: record.embeddingModel,
    embeddingDim: record.embeddingDim,
    stale: record.stale,
    id: record.id as number | null,
    createdAt: record.createdAt as string | null,
  };
}

export async function evaluateM075S02Contract(options: M075S02EvaluationOptions = {}): Promise<M075S02Report> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const readPackageJsonText = options.readPackageJsonText ?? (() => Bun.file("package.json").text());
  const prepareRecordForSql = options.prepareRecordForSql ?? prepareLearningMemoryRecordForSql;
  const buildReviewRecord = options.buildReviewRecord ?? buildReviewLearningMemoryRecord;
  const packageJsonText = await readPackageJsonText();

  const checks: M075S02Check[] = [
    checkRequiredFields(prepareRecordForSql),
    checkOptionalFields(prepareRecordForSql),
    checkMissingCommentId(buildReviewRecord),
    checkInvalidEmbeddingMetadata(buildReviewRecord),
    checkPackageWiring(packageJsonText),
  ];
  const failedCheckIds = checks.filter((check) => !check.passed).map((check) => check.id);

  return {
    command: COMMAND_NAME,
    generatedAt,
    success: failedCheckIds.length === 0,
    statusCode: failedCheckIds.length === 0 ? "m075_s02_ok" : "m075_s02_contract_failed",
    checks,
    failedCheckIds,
  };
}

function printTextReport(report: M075S02Report): void {
  console.log(`${report.command}: ${report.success ? "PASS" : "FAIL"}`);
  for (const check of report.checks) {
    console.log(`${check.passed ? "PASS" : "FAIL"} ${check.id}: ${check.detail}`);
  }
  if (report.failedCheckIds.length > 0) {
    console.log(`failedCheckIds=${report.failedCheckIds.join(",")}`);
  }
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  try {
    const args = parseM075S02Args(argv);
    if (args.help) {
      console.log(HELP_TEXT);
      return 0;
    }

    const report = await evaluateM075S02Contract({
      prepareRecordForSql: args.simulateUnsafeBoundary ? unsafePrepareLearningMemoryRecordForSql : undefined,
    });

    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printTextReport(report);
    }
    return report.success ? 0 : 1;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const report: M075S02Report = {
      command: COMMAND_NAME,
      generatedAt: new Date().toISOString(),
      success: false,
      statusCode: "m075_s02_invalid_arg",
      checks: [],
      failedCheckIds: [],
    };
    console.error(JSON.stringify({ ...report, error: message }, null, 2));
    return 2;
  }
}

if (import.meta.main) {
  process.exit(await main());
}
