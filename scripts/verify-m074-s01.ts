import {
  normalizeFindingLifecycle,
  toFindingLifecyclePublicProjection,
  type ReviewFindingInput,
  type ReviewFindingLifecycleInput,
  type ReviewFindingLifecyclePublicProjection,
  type ReviewFindingLifecycleRecord,
  type ReviewFindingLifecycleResult,
  type ReviewFindingLifecycleStatus,
} from "../src/review-lifecycle/finding-lifecycle.ts";

export const COMMAND_NAME = "verify:m074:s01" as const;
export const EXPECTED_PACKAGE_SCRIPT = "bun scripts/verify-m074-s01.ts" as const;

export type M074S01Check = {
  readonly id: string;
  readonly passed: boolean;
  readonly detail: string;
};

export type M074S01Report = {
  readonly command: typeof COMMAND_NAME;
  readonly generatedAt: string;
  readonly success: boolean;
  readonly statusCode: "m074_s01_ok" | "m074_s01_contract_failed" | "m074_s01_invalid_arg";
  readonly lifecycleRecordCount: number;
  readonly statusCounts: ReviewFindingLifecyclePublicProjection["counts"]["status"];
  readonly severityCounts: ReviewFindingLifecyclePublicProjection["counts"]["severity"];
  readonly actionabilityCounts: ReviewFindingLifecyclePublicProjection["counts"]["actionability"];
  readonly validationNeedCounts: ReviewFindingLifecyclePublicProjection["counts"]["validationNeeds"];
  readonly revalidationStateCounts: ReviewFindingLifecyclePublicProjection["counts"]["revalidationState"];
  readonly redactionFlags: ReviewFindingLifecyclePublicProjection["redaction"];
  readonly stableIdDeterministic: boolean;
  readonly boundedProjection: {
    readonly referenceCount: number;
    readonly omittedReferences: number;
    readonly reasonCodeCount: number;
    readonly omittedReasonCodes: number;
  };
  readonly cappedReasonCodes: readonly string[];
  readonly checks: readonly M074S01Check[];
  readonly issues: readonly string[];
};

export type M074S01Args = {
  readonly json: boolean;
  readonly help: boolean;
};

export type M074S01EvaluationOptions = {
  readonly generatedAt?: string;
  readonly readPackageJsonText?: () => Promise<string>;
  readonly projectPrimary?: (result: ReviewFindingLifecycleResult) => ReviewFindingLifecyclePublicProjection;
  readonly missingCorrelationInput?: ReviewFindingLifecycleInput;
  readonly malformedStatusInput?: ReviewFindingLifecycleInput;
};

const HELP_TEXT = `Usage: bun scripts/verify-m074-s01.ts [--json] [--help]\n\nVerifies the M074/S01 pure review finding lifecycle contract with an in-memory fixture.\n`;

const BASE_UNIT = {
  repo: "acme/widgets",
  pullNumber: 74,
  reviewOutputKey: "m074-s01-review-output",
  deliveryId: "delivery-m074-s01",
  commitSha: "abc123def456",
};

const FORBIDDEN_PUBLIC_CANARIES = [
  "RAW_PROMPT_CANARY",
  "RAW_MODEL_OUTPUT_CANARY",
  "CANDIDATE_BODY_CANARY",
  "TOOL_PAYLOAD_CANARY",
  "SECRET_TOKEN_CANARY",
  "sk-supersecret12345",
  "DIFF_TEXT_CANARY",
  "diff --git",
  "Private safe body omitted",
  "Private fixture body omitted",
] as const;

const STATUS_ORDER: Record<ReviewFindingLifecycleStatus, number> = {
  detected: 0,
  open: 1,
  suggested: 2,
  validated: 3,
  revalidated: 4,
  resolved: 5,
  blocked: 5,
  degraded: 5,
};

function finding(index: number, overrides: Partial<ReviewFindingInput> = {}): ReviewFindingInput {
  return {
    filePath: `src/module-${index}.ts`,
    startLine: index + 1,
    endLine: index + 1,
    severity: index % 5 === 0 ? "critical" : "major",
    category: index % 5 === 0 ? "security" : "correctness",
    title: `Lifecycle fixture finding ${index}`,
    confidence: 85,
    actionability: index % 3 === 0 ? "needs-reproduction" : "actionable",
    validationNeeds: index % 5 === 0 ? ["needs-security-review"] : ["needs-tests"],
    revalidationState: index % 4 === 0 ? "pending" : "not-required",
    reasonCodes: [`reason-${index}`, "fixture-contract"],
    evidenceRefs: [{ kind: "file", ref: `src/module-${index}.ts:${index + 1}` }],
    statusHistory: [
      { status: "detected", reasonCode: "detected", evidenceRefs: [{ kind: "file", ref: `src/module-${index}.ts:${index + 1}` }] },
      { status: index % 4 === 0 ? "validated" : "open", reasonCode: index % 4 === 0 ? "validation-needed" : "awaiting-fix" },
    ],
    body: "Private fixture body omitted from public projection.",
    ...overrides,
  };
}

export function parseM074S01Args(args: readonly string[]): M074S01Args {
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

export async function evaluateM074S01Contract(options: M074S01EvaluationOptions = {}): Promise<M074S01Report> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const readPackageJsonText = options.readPackageJsonText ?? (() => Bun.file("package.json").text());
  const projectPrimary = options.projectPrimary ?? toFindingLifecyclePublicProjection;
  const findings = Array.from({ length: 40 }, (_, index) => finding(index));
  const result = normalizeFindingLifecycle({ ...BASE_UNIT, findings });
  const duplicateA = normalizeFindingLifecycle({ ...BASE_UNIT, findings: [finding(0, { body: "private A" })] });
  const duplicateB = normalizeFindingLifecycle({ ...BASE_UNIT, findings: [finding(0, { body: "private B" })] });
  const unsafeResult = normalizeFindingLifecycle({
    ...BASE_UNIT,
    findings: [
      finding(99, {
        rawPrompt: "RAW_PROMPT_CANARY BEGIN PROMPT",
        rawModelOutput: "RAW_MODEL_OUTPUT_CANARY model output",
        candidateBody: "CANDIDATE_BODY_CANARY candidate body",
        toolPayload: { secret: "TOOL_PAYLOAD_CANARY" },
        body: "SECRET_TOKEN_CANARY token=sk-supersecret12345",
        diffText: "DIFF_TEXT_CANARY diff --git a/file b/file",
      }),
      finding(100, { body: "Private safe body omitted" }),
    ],
  });
  const missingCorrelationResult = normalizeFindingLifecycle(options.missingCorrelationInput ?? {
    ...BASE_UNIT,
    reviewOutputKey: "",
    findings: [finding(200), finding(201)],
  });
  const malformedStatusResult = normalizeFindingLifecycle(options.malformedStatusInput ?? {
    ...BASE_UNIT,
    findings: [
      finding(300, {
        statusHistory: [
          { status: "resolved", reasonCode: "resolved" },
          { status: "detected", reasonCode: "regressed-out-of-order" },
        ],
      }),
    ],
  });
  const projection = projectPrimary(result);
  const unsafeProjectionJson = JSON.stringify(toFindingLifecyclePublicProjection(unsafeResult));
  const primaryProjectionJson = JSON.stringify(projection);
  const packageJsonText = await readPackageJsonText();

  const unsafeFixtureCanariesAbsent = FORBIDDEN_PUBLIC_CANARIES.every((canary) => !unsafeProjectionJson.includes(canary));
  const primaryProjectionSafe = isProjectionStructurallySafe(projection) && FORBIDDEN_PUBLIC_CANARIES.every((canary) => !primaryProjectionJson.includes(canary));
  const stableIdDeterministic = duplicateA.records[0]?.id === duplicateB.records[0]?.id;
  const missingCorrelationFailsClosed = missingCorrelationResult.status === "unavailable"
    && missingCorrelationResult.records.length === 0
    && missingCorrelationResult.rejections.length === (missingCorrelationResult.counts.input || 0)
    && missingCorrelationResult.rejections.every((rejection) => rejection.reason === "missing-correlation");
  const malformedStatusDetected = hasMalformedStatusTransition(malformedStatusResult.records);

  const packageWiringPresent = hasExpectedPackageScript(packageJsonText);

  const checks: M074S01Check[] = [
    {
      id: "lifecycle-record-counts",
      passed: result.counts.input === 40 && result.counts.recorded === 40 && result.records.length === 40,
      detail: `records=${result.records.length} input=${result.counts.input} rejected=${result.counts.rejected}`,
    },
    {
      id: "status-counts-present",
      passed: projection.counts.status.detected === 40 && projection.counts.status.open > 0 && projection.counts.status.validated > 0,
      detail: `detected=${projection.counts.status.detected} open=${projection.counts.status.open} validated=${projection.counts.status.validated}`,
    },
    {
      id: "actionability-validation-present",
      passed: projection.counts.actionability.actionable > 0 && projection.counts.validationNeeds["needs-tests"] > 0 && projection.counts.revalidationState.pending > 0,
      detail: `actionable=${projection.counts.actionability.actionable} needsTests=${projection.counts.validationNeeds["needs-tests"]} pending=${projection.counts.revalidationState.pending}`,
    },
    {
      id: "redaction-flags-and-canaries",
      passed: projection.redaction.privateOnly === true
        && projection.redaction.rawPromptsIncluded === false
        && projection.redaction.rawModelOutputIncluded === false
        && projection.redaction.candidateBodiesIncluded === false
        && projection.redaction.toolPayloadsIncluded === false
        && projection.redaction.secretLikeStringsIncluded === false
        && projection.redaction.diffsIncluded === false
        && primaryProjectionSafe
        && unsafeFixtureCanariesAbsent,
      detail: `redaction=${primaryProjectionSafe && unsafeFixtureCanariesAbsent ? "pass" : "fail"}`,
    },
    {
      id: "stable-id-determinism",
      passed: stableIdDeterministic,
      detail: `stableIds=${stableIdDeterministic ? "pass" : "fail"}`,
    },
    {
      id: "bounded-projection",
      passed: projection.references.length === 5 && projection.omitted.references === 35 && projection.reasonCodes.length <= 8,
      detail: `references=${projection.references.length} omittedReferences=${projection.omitted.references} reasonCodes=${projection.reasonCodes.length}`,
    },
    {
      id: "missing-correlation-negative",
      passed: missingCorrelationFailsClosed,
      detail: `status=${missingCorrelationResult.status} rejected=${missingCorrelationResult.counts.rejected}`,
    },
    {
      id: "malformed-status-transition-negative",
      passed: malformedStatusDetected,
      detail: `malformedTransitionDetected=${malformedStatusDetected}`,
    },
    {
      id: "package-wiring",
      passed: packageWiringPresent,
      detail: `expected=${COMMAND_NAME} -> ${EXPECTED_PACKAGE_SCRIPT}`,
    },
  ];
  const issues = checks.filter((check) => !check.passed).map((check) => `${check.id}: ${check.detail}`);

  return {
    command: COMMAND_NAME,
    generatedAt,
    success: issues.length === 0,
    statusCode: issues.length === 0 ? "m074_s01_ok" : "m074_s01_contract_failed",
    lifecycleRecordCount: result.records.length,
    statusCounts: projection.counts.status,
    severityCounts: projection.counts.severity,
    actionabilityCounts: projection.counts.actionability,
    validationNeedCounts: projection.counts.validationNeeds,
    revalidationStateCounts: projection.counts.revalidationState,
    redactionFlags: projection.redaction,
    stableIdDeterministic,
    boundedProjection: {
      referenceCount: projection.references.length,
      omittedReferences: projection.omitted.references,
      reasonCodeCount: projection.reasonCodes.length,
      omittedReasonCodes: projection.omitted.reasonCodes,
    },
    cappedReasonCodes: projection.reasonCodes,
    checks,
    issues,
  };
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

function isProjectionStructurallySafe(projection: ReviewFindingLifecyclePublicProjection): boolean {
  return projection.schema === "review-finding-lifecycle.v1"
    && projection.references.length <= 5
    && projection.reasonCodes.length <= 8
    && projection.rejectedReasonCodes.length <= 8
    && projection.redaction.privateOnly === true
    && projection.redaction.rawPromptsIncluded === false
    && projection.redaction.rawModelOutputIncluded === false
    && projection.redaction.candidateBodiesIncluded === false
    && projection.redaction.toolPayloadsIncluded === false
    && projection.redaction.secretLikeStringsIncluded === false
    && projection.redaction.diffsIncluded === false
    && projection.redaction.unboundedArraysIncluded === false;
}

function hasMalformedStatusTransition(records: readonly ReviewFindingLifecycleRecord[]): boolean {
  return records.some((record) => {
    let previous = -1;
    for (const entry of record.statusHistory) {
      const current = STATUS_ORDER[entry.status];
      if (current < previous) return true;
      previous = current;
    }
    return false;
  });
}

export async function main(args = Bun.argv.slice(2)): Promise<number> {
  let parsed: M074S01Args;
  try {
    parsed = parseM074S01Args(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid_cli_args";
    process.stderr.write(`${JSON.stringify({ command: COMMAND_NAME, success: false, statusCode: "m074_s01_invalid_arg", issues: [message] }, null, 2)}\n`);
    return 2;
  }

  if (parsed.help) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }

  const report = await evaluateM074S01Contract();
  if (parsed.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write([
      `${COMMAND_NAME}: ${report.success ? "PASS" : "FAIL"}`,
      `lifecycleRecordCount=${report.lifecycleRecordCount}`,
      `statusCounts=${JSON.stringify(report.statusCounts)}`,
      `actionabilityCounts=${JSON.stringify(report.actionabilityCounts)}`,
      `validationNeedCounts=${JSON.stringify(report.validationNeedCounts)}`,
      `revalidationStateCounts=${JSON.stringify(report.revalidationStateCounts)}`,
      `reasonCodes=${JSON.stringify(report.cappedReasonCodes)}`,
      `redaction=${report.checks.find((check) => check.id === "redaction-flags-and-canaries")?.passed ? "pass" : "fail"}`,
      `stableIds=${report.stableIdDeterministic ? "pass" : "fail"}`,
      `boundedProjection=${JSON.stringify(report.boundedProjection)}`,
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
