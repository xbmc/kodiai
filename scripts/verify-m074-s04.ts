import { normalizeFindingLifecycle, type ReviewFindingInput, type ReviewFindingLifecycleRecord } from "../src/review-lifecycle/finding-lifecycle.ts";
import {
  reduceValidationTruth,
  type SamePrFixTruthEvidence,
  type ValidationTruthEvidence,
  type ValidationTruthProjection,
  type ValidationTruthReasonCode,
  type ValidationTruthStatus,
} from "../src/review-lifecycle/validation-truth.ts";

export const COMMAND_NAME = "verify:m074:s04" as const;
export const EXPECTED_PACKAGE_SCRIPT = "bun scripts/verify-m074-s04.ts" as const;

type LifecycleExpectation = {
  readonly id: string;
  readonly expectedStatus: ValidationTruthStatus;
  readonly expectedReasons: readonly ValidationTruthReasonCode[];
  readonly shouldResolve: boolean;
};

export type M074S04Check = {
  readonly id: string;
  readonly passed: boolean;
  readonly detail: string;
};

export type M074S04Report = {
  readonly command: typeof COMMAND_NAME;
  readonly generatedAt: string;
  readonly success: boolean;
  readonly statusCode: "m074_s04_ok" | "m074_s04_contract_failed" | "m074_s04_invalid_arg";
  readonly gate: "review-validation-truth";
  readonly reviewOutputKey: string;
  readonly deliveryId: string;
  readonly counts: ValidationTruthProjection["counts"];
  readonly reasonCoverage: Partial<Record<ValidationTruthReasonCode, number>>;
  readonly evidenceFreshness: ValidationTruthProjection["evidenceFreshness"];
  readonly statusByCase: Record<string, ValidationTruthStatus>;
  readonly closureSemantics: {
    readonly suggestedResolved: number;
    readonly validationOnlyResolved: number;
    readonly freshRevalidationResolved: number;
    readonly staleValidationResolved: number;
    readonly failedValidationResolved: number;
    readonly failedRevalidationResolved: number;
    readonly blockedOrDegradedResolved: number;
  };
  readonly boundedPublicSummary: {
    readonly referencesCapped: boolean;
    readonly reasonCodesCapped: boolean;
    readonly omittedReferences: number;
    readonly projectedReferences: number;
    readonly projectedReasonCodes: number;
  };
  readonly redaction: ValidationTruthProjection["redaction"] & {
    readonly canariesAbsent: boolean;
  };
  readonly checks: readonly M074S04Check[];
  readonly issues: readonly string[];
};

export type M074S04Args = {
  readonly json: boolean;
  readonly help: boolean;
};

export type M074S04EvaluationOptions = {
  readonly generatedAt?: string;
  readonly readPackageJsonText?: () => Promise<string>;
  readonly mutateReportForCanaryCheck?: (report: Omit<M074S04Report, "success" | "statusCode" | "checks" | "issues">) => Omit<M074S04Report, "success" | "statusCode" | "checks" | "issues">;
  readonly mutateValidationEvidence?: (evidence: ValidationTruthEvidence[], records: Record<string, ReviewFindingLifecycleRecord>) => ValidationTruthEvidence[];
};

const HELP_TEXT = `Usage: bun scripts/verify-m074-s04.ts [--json] [--help]\n\nVerifies M074/S04 validation-truth lifecycle closure, fail-closed revalidation semantics, bounded public projection, package wiring, and redaction with in-memory fixtures.\n`;

const CORRELATION = {
  repo: "acme/widgets",
  pullNumber: 74,
  reviewOutputKey: "m074-s04-review-output",
  deliveryId: "delivery-m074-s04",
  commitSha: "abc123def456",
} as const;

const FORBIDDEN_CANARIES = [
  "RAW_PROMPT_CANARY",
  "RAW_MODEL_OUTPUT_CANARY",
  "CANDIDATE_BODY_CANARY",
  "TOOL_PAYLOAD_CANARY",
  "RAW_PAYLOAD_CANARY",
  "REPLACEMENT_CANARY",
  "SECRET_TOKEN_CANARY",
  "sk-supersecret12345",
  "DIFF_TEXT_CANARY",
  "diff --git",
  "PRIVATE_CANDIDATE_BODY",
] as const;

const REQUIRED_REASONS: readonly ValidationTruthReasonCode[] = [
  "suggested-but-open",
  "validation-missing",
  "validation-passed",
  "validation-failed",
  "validation-stale",
  "revalidation-missing",
  "revalidation-passed",
  "revalidation-failed",
  "degraded",
  "blocked",
  "resolved",
];

const CASES: readonly LifecycleExpectation[] = [
  { id: "detected-open", expectedStatus: "open", expectedReasons: ["validation-missing"], shouldResolve: false },
  { id: "suggested-unresolved", expectedStatus: "suggested", expectedReasons: ["suggested-but-open", "validation-missing"], shouldResolve: false },
  { id: "validation-without-revalidation", expectedStatus: "uncertain", expectedReasons: ["validation-passed", "revalidation-missing"], shouldResolve: false },
  { id: "fresh-revalidation", expectedStatus: "resolved", expectedReasons: ["validation-passed", "revalidation-passed", "resolved"], shouldResolve: true },
  { id: "failed-validation", expectedStatus: "open", expectedReasons: ["validation-failed"], shouldResolve: false },
  { id: "stale-validation", expectedStatus: "uncertain", expectedReasons: ["validation-stale"], shouldResolve: false },
  { id: "failed-revalidation", expectedStatus: "open", expectedReasons: ["validation-passed", "revalidation-failed"], shouldResolve: false },
  { id: "blocked-evidence", expectedStatus: "blocked", expectedReasons: ["blocked"], shouldResolve: false },
  { id: "degraded-evidence", expectedStatus: "degraded", expectedReasons: ["degraded"], shouldResolve: false },
] as const;

export function parseM074S04Args(args: readonly string[]): M074S04Args {
  let json = false;
  let help = false;
  for (const arg of args) {
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    throw new Error(`invalid_cli_args: Unknown argument: ${arg}`);
  }
  return { json, help };
}

export async function evaluateM074S04Contract(options: M074S04EvaluationOptions = {}): Promise<M074S04Report> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const readPackageJsonText = options.readPackageJsonText ?? (() => Bun.file("package.json").text());
  const packageJsonText = await readPackageJsonText();
  const records = buildLifecycleRecords();
  const samePrFixes = buildSamePrFixEvidence(records);
  const baseValidations = buildValidationEvidence(records);
  const validations = options.mutateValidationEvidence?.(baseValidations, records) ?? baseValidations;
  const revalidations = buildRevalidationEvidence(records);
  const oversized = buildOversizedRecords(18);

  const result = reduceValidationTruth({
    ...CORRELATION,
    requireRevalidation: true,
    findings: [...CASES.map((item) => records[item.id]), ...oversized],
    samePrFixes,
    validations,
    revalidations,
  });

  const statusByCase = Object.fromEntries(
    CASES.map((item) => [item.id, result.records.find((record) => record.id === records[item.id]?.id)?.status ?? "degraded"]),
  ) as Record<string, ValidationTruthStatus>;
  const reasonCoverage = aggregateReasonCoverage(result.records);
  const projectedJson = JSON.stringify(result.projection);
  const baseReport = {
    command: COMMAND_NAME,
    generatedAt,
    gate: result.projection.gate,
    reviewOutputKey: result.projection.reviewOutputKey ?? "",
    deliveryId: result.projection.deliveryId ?? "",
    counts: result.projection.counts,
    reasonCoverage,
    evidenceFreshness: result.projection.evidenceFreshness,
    statusByCase,
    closureSemantics: {
      suggestedResolved: Number(statusByCase["suggested-unresolved"] === "resolved"),
      validationOnlyResolved: Number(statusByCase["validation-without-revalidation"] === "resolved"),
      freshRevalidationResolved: Number(statusByCase["fresh-revalidation"] === "resolved"),
      staleValidationResolved: Number(statusByCase["stale-validation"] === "resolved"),
      failedValidationResolved: Number(statusByCase["failed-validation"] === "resolved"),
      failedRevalidationResolved: Number(statusByCase["failed-revalidation"] === "resolved"),
      blockedOrDegradedResolved: Number(statusByCase["blocked-evidence"] === "resolved") + Number(statusByCase["degraded-evidence"] === "resolved"),
    },
    boundedPublicSummary: {
      referencesCapped: result.projection.references.length <= 5 && result.projection.omitted.references > 0,
      reasonCodesCapped: Object.keys(result.projection.reasonCounts).length <= 8,
      omittedReferences: result.projection.omitted.references,
      projectedReferences: result.projection.references.length,
      projectedReasonCodes: Object.keys(result.projection.reasonCounts).length,
    },
    redaction: {
      ...result.projection.redaction,
      canariesAbsent: FORBIDDEN_CANARIES.every((canary) => !projectedJson.includes(canary)),
    },
  } satisfies Omit<M074S04Report, "success" | "statusCode" | "checks" | "issues">;

  const reportForChecks = options.mutateReportForCanaryCheck?.(baseReport) ?? baseReport;
  const reportJson = JSON.stringify(reportForChecks);
  const canariesAbsent = FORBIDDEN_CANARIES.every((canary) => !reportJson.includes(canary));
  const packageWiringPresent = hasExpectedPackageScript(packageJsonText);
  const expectedCasesPass = CASES.every((expected) => {
    const actual = result.records.find((record) => record.id === records[expected.id]?.id);
    return actual?.status === expected.expectedStatus
      && expected.expectedReasons.every((reason) => actual.reasonCodes.includes(reason))
      && (actual.status === "resolved") === expected.shouldResolve;
  });

  const checks: M074S04Check[] = [
    {
      id: "lifecycle-closure-semantics",
      passed: expectedCasesPass
        && reportForChecks.closureSemantics.suggestedResolved === 0
        && reportForChecks.closureSemantics.validationOnlyResolved === 0
        && reportForChecks.closureSemantics.freshRevalidationResolved === 1
        && reportForChecks.closureSemantics.staleValidationResolved === 0
        && reportForChecks.closureSemantics.failedValidationResolved === 0
        && reportForChecks.closureSemantics.failedRevalidationResolved === 0
        && reportForChecks.closureSemantics.blockedOrDegradedResolved === 0,
      detail: `resolved=${reportForChecks.counts.resolved} statuses=${JSON.stringify(reportForChecks.statusByCase)}`,
    },
    {
      id: "reason-code-coverage",
      passed: REQUIRED_REASONS.every((reason) => (reportForChecks.reasonCoverage[reason] ?? 0) > 0),
      detail: `reasons=${REQUIRED_REASONS.filter((reason) => (reportForChecks.reasonCoverage[reason] ?? 0) > 0).join(",")}`,
    },
    {
      id: "bounded-public-summary",
      passed: reportForChecks.boundedPublicSummary.referencesCapped
        && reportForChecks.boundedPublicSummary.reasonCodesCapped
        && reportForChecks.redaction.unboundedArraysIncluded === false,
      detail: `references=${reportForChecks.boundedPublicSummary.projectedReferences} omitted=${reportForChecks.boundedPublicSummary.omittedReferences} reasons=${reportForChecks.boundedPublicSummary.projectedReasonCodes}`,
    },
    {
      id: "redaction-flags-and-canaries",
      passed: reportForChecks.redaction.privateOnly === true
        && reportForChecks.redaction.rawPromptsIncluded === false
        && reportForChecks.redaction.rawModelOutputIncluded === false
        && reportForChecks.redaction.candidateBodiesIncluded === false
        && reportForChecks.redaction.replacementTextIncluded === false
        && reportForChecks.redaction.toolPayloadsIncluded === false
        && reportForChecks.redaction.secretLikeStringsIncluded === false
        && reportForChecks.redaction.diffsIncluded === false
        && reportForChecks.redaction.unsafeInputFieldCount > 0
        && canariesAbsent,
      detail: `redaction=${canariesAbsent ? "pass" : "fail"} unsafe=${reportForChecks.redaction.unsafeInputFieldCount}`,
    },
    {
      id: "diagnostic-correlation",
      passed: reportForChecks.gate === "review-validation-truth"
        && reportForChecks.reviewOutputKey === CORRELATION.reviewOutputKey
        && reportForChecks.deliveryId === CORRELATION.deliveryId,
      detail: `gate=${reportForChecks.gate} reviewOutputKey=${reportForChecks.reviewOutputKey} deliveryId=${reportForChecks.deliveryId}`,
    },
    {
      id: "package-wiring",
      passed: packageWiringPresent,
      detail: `expected=${COMMAND_NAME} -> ${EXPECTED_PACKAGE_SCRIPT}`,
    },
  ];
  const issues = checks.filter((check) => !check.passed).map((check) => `${check.id}: ${check.detail}`);

  return {
    ...reportForChecks,
    redaction: { ...reportForChecks.redaction, canariesAbsent },
    success: issues.length === 0,
    statusCode: issues.length === 0 ? "m074_s04_ok" : "m074_s04_contract_failed",
    checks,
    issues,
  };
}

function buildLifecycleRecords(): Record<string, ReviewFindingLifecycleRecord> {
  const normalized = normalizeFindingLifecycle({
    ...CORRELATION,
    findings: CASES.map((item, index) => finding(item.id, index)),
  });
  if (normalized.records.length !== CASES.length) {
    throw new Error(`fixture_setup_failed: expected ${CASES.length} records, got ${normalized.records.length}`);
  }
  return Object.fromEntries(CASES.map((item, index) => [item.id, normalized.records[index]]));
}

function finding(caseId: string, index: number): ReviewFindingInput {
  return {
    filePath: `src/m074-s04/${caseId}.ts`,
    startLine: index + 10,
    endLine: index + 10,
    severity: index % 2 === 0 ? "major" : "medium",
    category: "correctness",
    title: `S04 ${caseId} lifecycle finding`,
    confidence: 90,
    actionability: "actionable",
    validationNeeds: ["needs-tests"],
    revalidationState: "pending",
    evidenceRefs: [{ kind: "file", ref: `src/m074-s04/${caseId}.ts:${index + 10}` }],
    reasonCodes: [caseId],
    statusHistory: [{ status: "detected", reasonCode: "review-detected" }],
  };
}

function buildSamePrFixEvidence(records: Record<string, ReviewFindingLifecycleRecord>): SamePrFixTruthEvidence[] {
  return [
    fixFor(records["suggested-unresolved"]),
    fixFor(records["fresh-revalidation"], {
      rawPrompt: "RAW_PROMPT_CANARY BEGIN PROMPT hidden instructions",
      rawModelOutput: "RAW_MODEL_OUTPUT_CANARY raw model output",
      candidateBody: "PRIVATE_CANDIDATE_BODY CANDIDATE_BODY_CANARY",
      replacementText: "REPLACEMENT_CANARY token=sk-supersecret12345",
      toolPayload: { private: "TOOL_PAYLOAD_CANARY" },
      diffText: "DIFF_TEXT_CANARY diff --git a/private b/private",
    }),
  ];
}

function buildValidationEvidence(records: Record<string, ReviewFindingLifecycleRecord>): ValidationTruthEvidence[] {
  return [
    validationFor(records["validation-without-revalidation"]),
    validationFor(records["fresh-revalidation"]),
    validationFor(records["failed-validation"], { status: "failed" }),
    validationFor(records["stale-validation"], { evidenceFresh: false }),
    validationFor(records["failed-revalidation"]),
    validationFor(records["blocked-evidence"], { status: "blocked" }),
    validationFor(records["degraded-evidence"], { status: "degraded", rawPayload: { private: "RAW_PAYLOAD_CANARY" } }),
  ];
}

function buildRevalidationEvidence(records: Record<string, ReviewFindingLifecycleRecord>): ValidationTruthEvidence[] {
  return [
    validationFor(records["fresh-revalidation"]),
    validationFor(records["failed-revalidation"], { status: "failed" }),
  ];
}

function buildOversizedRecords(count: number): ReviewFindingLifecycleRecord[] {
  const normalized = normalizeFindingLifecycle({
    ...CORRELATION,
    findings: Array.from({ length: count }, (_, index) => ({
      ...finding(`oversized-${index}`, index + 100),
      title: `Oversized projection finding ${index}`,
      reasonCodes: [`oversized-${index}`],
    })),
  });
  return normalized.records;
}

function fixFor(record: ReviewFindingLifecycleRecord | undefined, overrides: Partial<SamePrFixTruthEvidence> = {}): SamePrFixTruthEvidence {
  if (!record) throw new Error("fixture_setup_failed: missing record for fix");
  return {
    reviewOutputKey: record.reviewOutputKey,
    deliveryId: record.deliveryId,
    repo: record.repo,
    pullNumber: record.pullNumber,
    findingId: record.id,
    status: "suggested",
    suggested: true,
    ...overrides,
  };
}

function validationFor(record: ReviewFindingLifecycleRecord | undefined, overrides: Partial<ValidationTruthEvidence> = {}): ValidationTruthEvidence {
  if (!record) throw new Error("fixture_setup_failed: missing record for validation");
  return {
    reviewOutputKey: record.reviewOutputKey,
    deliveryId: record.deliveryId,
    repo: record.repo,
    pullNumber: record.pullNumber,
    findingId: record.id,
    status: "passed",
    evidenceFresh: true,
    ...overrides,
  };
}

function aggregateReasonCoverage(records: readonly { reasonCodes: readonly ValidationTruthReasonCode[] }[]): Partial<Record<ValidationTruthReasonCode, number>> {
  const counts = new Map<ValidationTruthReasonCode, number>();
  for (const record of records) {
    for (const reason of record.reasonCodes) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
  }
  return Object.fromEntries(counts) as Partial<Record<ValidationTruthReasonCode, number>>;
}

function hasExpectedPackageScript(packageJsonText: string): boolean {
  try {
    const parsed = JSON.parse(packageJsonText) as { scripts?: Record<string, unknown> };
    return parsed.scripts?.[COMMAND_NAME] === EXPECTED_PACKAGE_SCRIPT;
  } catch {
    return packageJsonText.includes(`"${COMMAND_NAME}": "${EXPECTED_PACKAGE_SCRIPT}"`)
      || packageJsonText.includes(`"${COMMAND_NAME}":"${EXPECTED_PACKAGE_SCRIPT}"`);
  }
}

export async function main(args = Bun.argv.slice(2)): Promise<number> {
  let parsed: M074S04Args;
  try {
    parsed = parseM074S04Args(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid_cli_args";
    process.stderr.write(`${JSON.stringify({ command: COMMAND_NAME, success: false, statusCode: "m074_s04_invalid_arg", issues: [message] }, null, 2)}\n`);
    return 2;
  }

  if (parsed.help) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }

  const report = await evaluateM074S04Contract();
  if (parsed.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write([
      `${COMMAND_NAME}: ${report.success ? "PASS" : "FAIL"}`,
      `gate=${report.gate} reviewOutputKey=${report.reviewOutputKey} deliveryId=${report.deliveryId}`,
      `detected=${report.counts.detected} suggested=${report.counts.suggested} validated=${report.counts.validated} revalidated=${report.counts.revalidated} resolved=${report.counts.resolved} blocked=${report.counts.blocked} degraded=${report.counts.degraded}`,
      `evidenceFreshness=${JSON.stringify(report.evidenceFreshness)}`,
      `reasonCoverage=${JSON.stringify(report.reasonCoverage)}`,
      `closure=${JSON.stringify(report.closureSemantics)}`,
      `bounded=refs:${report.boundedPublicSummary.projectedReferences}/${report.boundedPublicSummary.omittedReferences} reasons:${report.boundedPublicSummary.projectedReasonCodes}`,
      `redaction=${report.redaction.canariesAbsent ? "pass" : "fail"}`,
      ...(report.issues.length > 0 ? [`issues=${report.issues.join("; ")}`] : []),
      "",
    ].join("\n"));
  }
  return report.success ? 0 : 1;
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
