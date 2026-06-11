import { normalizeFindingLifecycle, type ReviewFindingInput, type ReviewFindingLifecycleRecord } from "../src/review-lifecycle/finding-lifecycle.ts";
import {
  reduceSamePrFixEligibility,
  type SamePrFixCandidateInput,
  type SamePrFixEligibilityReasonCode,
} from "../src/review-lifecycle/same-pr-fix-eligibility.ts";
import {
  reduceValidationTruth,
  type SamePrFixTruthEvidence,
  type ValidationTruthEvidence,
  type ValidationTruthProjection,
  type ValidationTruthReasonCode,
  type ValidationTruthStatus,
} from "../src/review-lifecycle/validation-truth.ts";
import { formatReviewDetailsSummary } from "../src/lib/review-utils.ts";
import { projectContributorExperienceContract } from "../src/contributor/experience-contract.ts";

export const COMMAND_NAME = "verify:m074:s05" as const;
export const EXPECTED_PACKAGE_SCRIPT = "bun scripts/verify-m074-s05.ts" as const;

const REPORT_GATE = "review-details-validation-truth" as const;
const RUNTIME_VALIDATION_GATE = "review-validation-truth" as const;

type LifecycleExpectation = {
  readonly id: string;
  readonly expectedStatus: ValidationTruthStatus;
  readonly expectedReasons: readonly ValidationTruthReasonCode[];
  readonly shouldResolve: boolean;
};

export type M074S05Check = {
  readonly id: string;
  readonly passed: boolean;
  readonly detail: string;
};

export type M074S05Counts = Pick<ValidationTruthProjection["counts"],
  | "detected"
  | "suggested"
  | "validated"
  | "revalidated"
  | "resolved"
  | "blocked"
  | "degraded"
  | "open"
  | "uncertain"
>;

export type M074S05Report = {
  readonly command: typeof COMMAND_NAME;
  readonly generatedAt: string;
  readonly success: boolean;
  readonly statusCode: "m074_s05_ok" | "m074_s05_contract_failed" | "m074_s05_invalid_arg";
  readonly gate: typeof REPORT_GATE;
  readonly runtimeGate: typeof RUNTIME_VALIDATION_GATE;
  readonly reviewOutputKey: string;
  readonly deliveryId: string;
  readonly counts: M074S05Counts;
  readonly reasonCoverage: Partial<Record<ValidationTruthReasonCode | SamePrFixEligibilityReasonCode, number>>;
  readonly evidenceFreshness: ValidationTruthProjection["evidenceFreshness"];
  readonly statusByCase: Record<string, ValidationTruthStatus>;
  readonly samePrFixEvidence: {
    readonly eligible: number;
    readonly blocked: number;
    readonly capped: number;
    readonly reasonCoverage: Partial<Record<SamePrFixEligibilityReasonCode, number>>;
  };
  readonly boundedReviewDetails: {
    readonly validationTruthLineCount: number;
    readonly validationTruthLine: string;
    readonly totalLines: number;
    readonly baselineLines: number;
    readonly addedLines: number;
    readonly visibleCharDelta: number;
    readonly referencesCapped: boolean;
    readonly reasonCodesCapped: boolean;
    readonly omittedReferences: number;
    readonly omittedReasonCodes: number;
    readonly projectedReferences: number;
    readonly projectedReasonCodes: number;
    readonly wordingPresent: boolean;
    readonly correlationPresent: boolean;
  };
  readonly visibleVolumeBounds: {
    readonly maxAddedLines: number;
    readonly maxVisibleCharDelta: number;
    readonly withinLineBound: boolean;
    readonly withinCharBound: boolean;
  };
  readonly redaction: ValidationTruthProjection["redaction"] & {
    readonly canariesAbsent: boolean;
  };
  readonly checks: readonly M074S05Check[];
  readonly issues: readonly string[];
};

export type M074S05Args = {
  readonly json: boolean;
  readonly help: boolean;
};

export type M074S05EvaluationOptions = {
  readonly generatedAt?: string;
  readonly readPackageJsonText?: () => Promise<string>;
  readonly mutateValidationEvidence?: (evidence: ValidationTruthEvidence[], records: Record<string, ReviewFindingLifecycleRecord>) => ValidationTruthEvidence[];
  readonly mutateValidationProjection?: (projection: ValidationTruthProjection) => ValidationTruthProjection;
  readonly mutateReviewDetailsBody?: (body: string) => string;
  readonly mutateReportForCanaryCheck?: (report: Omit<M074S05Report, "success" | "statusCode" | "checks" | "issues">) => Omit<M074S05Report, "success" | "statusCode" | "checks" | "issues">;
};

const HELP_TEXT = `Usage: bun scripts/verify-m074-s05.ts [--json] [--help]\n\nVerifies M074/S05 Review Details validation-truth operator evidence, same-PR fix lifecycle counts, bounded visible output, package wiring, and redaction with in-memory fixtures.\n`;

const CORRELATION = {
  repo: "acme/widgets",
  pullNumber: 74,
  reviewOutputKey: "m074-s05-review-output",
  deliveryId: "delivery-m074-s05",
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

const REQUIRED_FIX_REASONS: readonly SamePrFixEligibilityReasonCode[] = [
  "eligible",
  "missing-replacement",
  "duplicate-fix",
  "max-fixes-exceeded",
  "secret-detected",
  "candidate-denied",
  "line-not-commentable",
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

const REVIEW_DETAILS_VOLUME_LIMITS = {
  maxAddedLines: 1,
  maxVisibleCharDelta: 1_400,
} as const;

const PR_DIFF = [
  "diff --git a/src/eligible.ts b/src/eligible.ts",
  "--- a/src/eligible.ts",
  "+++ b/src/eligible.ts",
  "@@ -10,1 +10,1 @@",
  "+eligible line",
  "diff --git a/src/duplicate.ts b/src/duplicate.ts",
  "--- a/src/duplicate.ts",
  "+++ b/src/duplicate.ts",
  "@@ -20,1 +20,1 @@",
  "+duplicate line",
  "diff --git a/src/cap.ts b/src/cap.ts",
  "--- a/src/cap.ts",
  "+++ b/src/cap.ts",
  "@@ -30,1 +30,1 @@",
  "+cap line",
  "diff --git a/src/secret.ts b/src/secret.ts",
  "--- a/src/secret.ts",
  "+++ b/src/secret.ts",
  "@@ -40,1 +40,1 @@",
  "+secret line",
].join("\n");

export function parseM074S05Args(args: readonly string[]): M074S05Args {
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

export async function evaluateM074S05Contract(options: M074S05EvaluationOptions = {}): Promise<M074S05Report> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const readPackageJsonText = options.readPackageJsonText ?? (() => Bun.file("package.json").text());
  const packageJsonText = await readPackageJsonText();
  const records = buildLifecycleRecords();
  const samePrFixes = buildSamePrFixEvidence(records);
  const samePrEligibility = buildSamePrFixEligibility();
  const validations = options.mutateValidationEvidence?.(buildValidationEvidence(records), records) ?? buildValidationEvidence(records);
  const revalidations = buildRevalidationEvidence(records);
  const oversized = buildOversizedRecords(18);

  const validationTruth = reduceValidationTruth({
    ...CORRELATION,
    requireRevalidation: true,
    findings: [...CASES.map((item) => records[item.id]), ...oversized],
    samePrFixes,
    validations,
    revalidations,
  });
  const validationProjection = options.mutateValidationProjection?.(validationTruth.projection) ?? validationTruth.projection;
  const baselineReviewDetails = buildReviewDetailsBody(null);
  const reviewDetailsBody = options.mutateReviewDetailsBody?.(buildReviewDetailsBody(validationProjection)) ?? buildReviewDetailsBody(validationProjection);
  const validationTruthLines = reviewDetailsBody.split("\n").filter((line) => line.includes("Review validation truth:"));
  const validationTruthLine = validationTruthLines[0] ?? "";
  const statusByCase = Object.fromEntries(
    CASES.map((item) => [item.id, validationTruth.records.find((record) => record.id === records[item.id]?.id)?.status ?? "degraded"]),
  ) as Record<string, ValidationTruthStatus>;
  const validationReasonCoverage = aggregateReasonCoverage(validationTruth.records);
  const fixReasonCoverage = samePrEligibility.summary.reasonCounts;
  const projectedJson = JSON.stringify({ validationProjection, reviewDetailsBody });
  const baseReport = {
    command: COMMAND_NAME,
    generatedAt,
    gate: REPORT_GATE,
    runtimeGate: validationProjection.gate,
    reviewOutputKey: validationProjection.reviewOutputKey ?? "",
    deliveryId: validationProjection.deliveryId ?? "",
    counts: {
      detected: validationProjection.counts.detected,
      suggested: validationProjection.counts.suggested,
      validated: validationProjection.counts.validated,
      revalidated: validationProjection.counts.revalidated,
      resolved: validationProjection.counts.resolved,
      blocked: validationProjection.counts.blocked,
      degraded: validationProjection.counts.degraded,
      open: validationProjection.counts.open,
      uncertain: validationProjection.counts.uncertain,
    },
    reasonCoverage: { ...fixReasonCoverage, ...validationReasonCoverage },
    evidenceFreshness: validationProjection.evidenceFreshness,
    statusByCase,
    samePrFixEvidence: {
      eligible: samePrEligibility.summary.counts.eligible,
      blocked: samePrEligibility.summary.counts.blocked,
      capped: samePrEligibility.summary.counts.capped,
      reasonCoverage: fixReasonCoverage,
    },
    boundedReviewDetails: {
      validationTruthLineCount: validationTruthLines.length,
      validationTruthLine,
      totalLines: reviewDetailsBody.split("\n").length,
      baselineLines: baselineReviewDetails.split("\n").length,
      addedLines: reviewDetailsBody.split("\n").length - baselineReviewDetails.split("\n").length,
      visibleCharDelta: reviewDetailsBody.length - baselineReviewDetails.length,
      referencesCapped: validationProjection.references.length <= 5 && validationProjection.omitted.references > 0 && validationTruthLine.includes("omitted"),
      reasonCodesCapped: Object.keys(validationProjection.reasonCounts).length <= 8 && validationProjection.omitted.reasonCodes > 0 && validationTruthLine.includes("omitted"),
      omittedReferences: validationProjection.omitted.references,
      omittedReasonCodes: validationProjection.omitted.reasonCodes,
      projectedReferences: validationProjection.references.length,
      projectedReasonCodes: Object.keys(validationProjection.reasonCounts).length,
      wordingPresent: validationTruthLine.startsWith("- Review validation truth: status=")
        && validationTruthLine.includes("counts=detected:")
        && validationTruthLine.includes("evidence=fresh:")
        && validationTruthLine.includes("reasons=")
        && validationTruthLine.includes("refs="),
      correlationPresent: validationTruthLine.includes("correlation=reviewOutputKey:y,deliveryId:y"),
    },
    visibleVolumeBounds: {
      maxAddedLines: REVIEW_DETAILS_VOLUME_LIMITS.maxAddedLines,
      maxVisibleCharDelta: REVIEW_DETAILS_VOLUME_LIMITS.maxVisibleCharDelta,
      withinLineBound: reviewDetailsBody.split("\n").length - baselineReviewDetails.split("\n").length <= REVIEW_DETAILS_VOLUME_LIMITS.maxAddedLines,
      withinCharBound: reviewDetailsBody.length - baselineReviewDetails.length <= REVIEW_DETAILS_VOLUME_LIMITS.maxVisibleCharDelta,
    },
    redaction: {
      ...validationProjection.redaction,
      canariesAbsent: FORBIDDEN_CANARIES.every((canary) => !projectedJson.includes(canary)),
    },
  } satisfies Omit<M074S05Report, "success" | "statusCode" | "checks" | "issues">;

  const reportForChecks = options.mutateReportForCanaryCheck?.(baseReport) ?? baseReport;
  const reportJson = JSON.stringify(reportForChecks);
  const canariesAbsent = FORBIDDEN_CANARIES.every((canary) => !reportJson.includes(canary));
  const packageWiringPresent = hasExpectedPackageScript(packageJsonText);
  const expectedCasesPass = CASES.every((expected) => {
    const actual = validationTruth.records.find((record) => record.id === records[expected.id]?.id);
    return actual?.status === expected.expectedStatus
      && expected.expectedReasons.every((reason) => actual.reasonCodes.includes(reason))
      && (actual.status === "resolved") === expected.shouldResolve;
  });

  const checks: M074S05Check[] = [
    {
      id: "validation-truth-lifecycle-counts",
      passed: expectedCasesPass
        && reportForChecks.counts.detected >= CASES.length
        && reportForChecks.counts.suggested >= 2
        && reportForChecks.counts.validated >= 3
        && reportForChecks.counts.revalidated === 1
        && reportForChecks.counts.resolved === 1
        && reportForChecks.counts.blocked === 1
        && reportForChecks.counts.degraded === 1
        && reportForChecks.counts.open >= 2
        && reportForChecks.counts.uncertain >= 2,
      detail: `counts=${JSON.stringify(reportForChecks.counts)} statuses=${JSON.stringify(reportForChecks.statusByCase)}`,
    },
    {
      id: "reason-code-coverage",
      passed: REQUIRED_REASONS.every((reason) => (reportForChecks.reasonCoverage[reason] ?? 0) > 0)
        && REQUIRED_FIX_REASONS.every((reason) => (reportForChecks.samePrFixEvidence.reasonCoverage[reason] ?? 0) > 0),
      detail: `validationReasons=${REQUIRED_REASONS.filter((reason) => (reportForChecks.reasonCoverage[reason] ?? 0) > 0).join(",")} fixReasons=${REQUIRED_FIX_REASONS.filter((reason) => (reportForChecks.samePrFixEvidence.reasonCoverage[reason] ?? 0) > 0).join(",")}`,
    },
    {
      id: "review-details-wording-and-caps",
      passed: reportForChecks.boundedReviewDetails.validationTruthLineCount === 1
        && reportForChecks.boundedReviewDetails.wordingPresent
        && reportForChecks.boundedReviewDetails.correlationPresent
        && reportForChecks.boundedReviewDetails.referencesCapped
        && reportForChecks.boundedReviewDetails.reasonCodesCapped,
      detail: `lineCount=${reportForChecks.boundedReviewDetails.validationTruthLineCount} refs=${reportForChecks.boundedReviewDetails.projectedReferences}+${reportForChecks.boundedReviewDetails.omittedReferences} reasons=${reportForChecks.boundedReviewDetails.projectedReasonCodes}+${reportForChecks.boundedReviewDetails.omittedReasonCodes}`,
    },
    {
      id: "visible-volume-bounds",
      passed: reportForChecks.visibleVolumeBounds.withinLineBound && reportForChecks.visibleVolumeBounds.withinCharBound,
      detail: `addedLines=${reportForChecks.boundedReviewDetails.addedLines}/${reportForChecks.visibleVolumeBounds.maxAddedLines} charDelta=${reportForChecks.boundedReviewDetails.visibleCharDelta}/${reportForChecks.visibleVolumeBounds.maxVisibleCharDelta}`,
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
        && reportForChecks.redaction.unboundedArraysIncluded === false
        && reportForChecks.redaction.unsafeInputFieldCount > 0
        && canariesAbsent,
      detail: `redaction=${canariesAbsent ? "pass" : "fail"} unsafe=${reportForChecks.redaction.unsafeInputFieldCount}`,
    },
    {
      id: "diagnostic-correlation",
      passed: reportForChecks.gate === REPORT_GATE
        && reportForChecks.runtimeGate === RUNTIME_VALIDATION_GATE
        && reportForChecks.reviewOutputKey === CORRELATION.reviewOutputKey
        && reportForChecks.deliveryId === CORRELATION.deliveryId,
      detail: `gate=${reportForChecks.gate} runtimeGate=${reportForChecks.runtimeGate} reviewOutputKey=${reportForChecks.reviewOutputKey} deliveryId=${reportForChecks.deliveryId}`,
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
    statusCode: issues.length === 0 ? "m074_s05_ok" : "m074_s05_contract_failed",
    checks,
    issues,
  };
}

function buildReviewDetailsBody(validationTruth: ValidationTruthProjection | null): string {
  return formatReviewDetailsSummary({
    reviewOutputKey: CORRELATION.reviewOutputKey,
    filesReviewed: 4,
    linesAdded: 80,
    linesRemoved: 12,
    findingCounts: { critical: 0, major: 2, medium: 2, minor: 0 },
    profileSelection: {
      selectedProfile: "balanced",
      source: "auto",
      linesChanged: 92,
      autoBand: null,
    },
    contributorExperience: projectContributorExperienceContract({
      source: "author-cache",
      tier: "regular",
    }).reviewDetails,
    reviewValidationTruth: validationTruth,
    completedAt: "2026-05-18T18:00:00.000Z",
  });
}

function buildLifecycleRecords(): Record<string, ReviewFindingLifecycleRecord> {
  const normalized = normalizeFindingLifecycle({
    ...CORRELATION,
    findings: CASES.map((item, index) => finding(item.id, index)),
  });
  if (normalized.records.length !== CASES.length) {
    throw new Error(`fixture_setup_failed: expected ${CASES.length} records, got ${normalized.records.length}`);
  }
  return Object.fromEntries(CASES.map((item, index) => [item.id, normalized.records[index]!]));
}

function finding(caseId: string, index: number): ReviewFindingInput {
  return {
    filePath: `src/m074-s05/${caseId}.ts`,
    startLine: index + 10,
    endLine: index + 10,
    severity: index % 2 === 0 ? "major" : "medium",
    category: "correctness",
    title: `S05 ${caseId} lifecycle finding`,
    confidence: 90,
    actionability: "actionable",
    validationNeeds: ["needs-tests"],
    revalidationState: "pending",
    evidenceRefs: [{ kind: "file", ref: `src/m074-s05/${caseId}.ts:${index + 10}` }],
    reasonCodes: [caseId],
    statusHistory: [{ status: "detected", reasonCode: "review-detected" }],
  };
}

function buildSamePrFixEligibility() {
  const duplicateSeed = fixCandidate({ filePath: "src/duplicate.ts", startLine: 20, endLine: 20, findingIdentity: "duplicate", replacementText: "const duplicate = true;" });
  const duplicateIdentity = reduceSamePrFixEligibility({
    reviewOutputKey: CORRELATION.reviewOutputKey,
    deliveryId: CORRELATION.deliveryId,
    prDiffText: PR_DIFF,
    maxSuggestions: 10,
    candidates: [duplicateSeed],
  }).drafts[0]?.identity;

  return reduceSamePrFixEligibility({
    reviewOutputKey: CORRELATION.reviewOutputKey,
    deliveryId: CORRELATION.deliveryId,
    prDiffText: PR_DIFF,
    maxSuggestions: 1,
    seenIdentities: duplicateIdentity ? [duplicateIdentity] : [],
    candidates: [
      fixCandidate({ findingIdentity: "eligible" }),
      fixCandidate({ findingIdentity: "missing", replacementText: "" }),
      duplicateSeed,
      fixCandidate({ filePath: "src/cap.ts", startLine: 30, endLine: 30, findingIdentity: "cap", replacementText: "const capped = true;" }),
      fixCandidate({ filePath: "src/secret.ts", startLine: 40, endLine: 40, findingIdentity: "secret", replacementText: "const token = 'ghp_123456789012345678901234567890123456';" }),
      fixCandidate({ filePath: "src/eligible.ts", startLine: 10, endLine: 10, findingIdentity: "candidate-denied", candidateApproved: false, replacementText: "const denied = true;" }),
      fixCandidate({ filePath: "src/missing-from-diff.ts", startLine: 99, endLine: 99, findingIdentity: "line", replacementText: "const line = true;" }),
    ],
  });
}

function fixCandidate(overrides: Partial<SamePrFixCandidateInput> = {}): SamePrFixCandidateInput {
  return {
    filePath: "src/eligible.ts",
    startLine: 10,
    endLine: 10,
    title: "Use the safe replacement",
    severity: "major",
    category: "correctness",
    replacementText: "const value = computeSafely();",
    candidateApproved: true,
    reducerApproved: true,
    findingIdentity: "eligible-finding",
    rawPrompt: "RAW_PROMPT_CANARY hidden prompt",
    rawModelOutput: "RAW_MODEL_OUTPUT_CANARY hidden model output",
    rawCandidateBody: "CANDIDATE_BODY_CANARY hidden candidate body",
    rawToolPayload: { private: "TOOL_PAYLOAD_CANARY" },
    rawDiffText: "DIFF_TEXT_CANARY diff --git a/private b/private",
    ...overrides,
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
  let parsed: M074S05Args;
  try {
    parsed = parseM074S05Args(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid_cli_args";
    process.stderr.write(`${JSON.stringify({ command: COMMAND_NAME, success: false, statusCode: "m074_s05_invalid_arg", issues: [message] }, null, 2)}\n`);
    return 2;
  }

  if (parsed.help) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }

  const report = await evaluateM074S05Contract();
  if (parsed.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write([
      `${COMMAND_NAME}: ${report.success ? "PASS" : "FAIL"}`,
      `gate=${report.gate} runtimeGate=${report.runtimeGate} reviewOutputKey=${report.reviewOutputKey} deliveryId=${report.deliveryId}`,
      `detected=${report.counts.detected} suggested=${report.counts.suggested} validated=${report.counts.validated} revalidated=${report.counts.revalidated} resolved=${report.counts.resolved} blocked=${report.counts.blocked} degraded=${report.counts.degraded} open=${report.counts.open} uncertain=${report.counts.uncertain}`,
      `evidenceFreshness=${JSON.stringify(report.evidenceFreshness)}`,
      `reasonCoverage=${JSON.stringify(report.reasonCoverage)}`,
      `samePrFix=${JSON.stringify(report.samePrFixEvidence)}`,
      `reviewDetails=line:${report.boundedReviewDetails.validationTruthLineCount} refs:${report.boundedReviewDetails.projectedReferences}+${report.boundedReviewDetails.omittedReferences} reasons:${report.boundedReviewDetails.projectedReasonCodes}+${report.boundedReviewDetails.omittedReasonCodes} addedLines:${report.boundedReviewDetails.addedLines} charDelta:${report.boundedReviewDetails.visibleCharDelta}`,
      `visibleVolume=${report.visibleVolumeBounds.withinLineBound && report.visibleVolumeBounds.withinCharBound ? "pass" : "fail"}`,
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
