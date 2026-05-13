import { formatReviewDetailsSummary } from "../src/lib/review-utils.ts";
import { projectContributorExperienceContract } from "../src/contributor/experience-contract.ts";
import {
  initialCandidateVerificationPublicationEvidenceSummary,
  projectCandidateVerificationPublicationEvidence,
  type CandidateVerificationPublicationEvidenceEvent,
  type CandidateVerificationPublicationEvidenceSummary,
} from "../src/specialists/candidate-verification-publication-evidence.ts";
import type {
  CandidatePublicationPolicyReasonCategory,
  CandidatePublicationPolicyResult,
} from "../src/specialists/candidate-publication-policy.ts";
import type { CandidateVerificationState } from "../src/specialists/candidate-verification.ts";

export const COMMAND_NAME = "verify:m070:s03" as const;
export const EXPECTED_PACKAGE_SCRIPT = "bun scripts/verify-m070-s03.ts" as const;

export const M070_S03_CHECK_IDS = [
  "M070-S03-FIXTURE-COVERAGE",
  "M070-S03-AGGREGATE-PROJECTION",
  "M070-S03-REVIEW-DETAILS-SURFACE",
  "M070-S03-RUNTIME-LOG-SURFACE",
  "M070-S03-REDACTION-BOUNDARY",
  "M070-S03-PACKAGE-WIRING",
] as const;

export type M070S03CheckId = (typeof M070_S03_CHECK_IDS)[number];
export type M070S03StatusCode = "m070_s03_ok" | "m070_s03_contract_failed" | "m070_s03_invalid_arg";
export type M070S03CheckStatusCode =
  | "fixture_coverage_ok"
  | "fixture_coverage_failed"
  | "aggregate_projection_ok"
  | "aggregate_projection_failed"
  | "review_details_surface_ok"
  | "review_details_surface_failed"
  | "runtime_log_surface_ok"
  | "runtime_log_surface_failed"
  | "redaction_boundary_ok"
  | "redaction_boundary_failed"
  | "package_wiring_ok"
  | "package_wiring_failed";

export type M070S03Check = {
  readonly id: M070S03CheckId;
  readonly passed: boolean;
  readonly status: "pass" | "fail";
  readonly status_code: M070S03CheckStatusCode;
  readonly detail: string;
};

export type M070S03Args = {
  readonly json: boolean;
  readonly help: boolean;
};

export type M070S03FixtureName =
  | "verified_allowed_published"
  | "partial_allowed_published"
  | "disputed_denied"
  | "unverified_denied"
  | "unclassifiable_denied"
  | "missing_metadata_unavailable"
  | "malformed_fail_closed";

export type M070S03FixtureSummary = {
  readonly fixture: M070S03FixtureName;
  readonly aggregateStatus: CandidateVerificationPublicationEvidenceSummary["aggregateStatus"];
  readonly counts: CandidateVerificationPublicationEvidenceSummary["counts"];
  readonly publicationDenialCounts: CandidateVerificationPublicationEvidenceSummary["publicationDenialCounts"];
  readonly reasonCategories: readonly CandidatePublicationPolicyReasonCategory[];
  readonly verificationStateCounts: CandidateVerificationPublicationEvidenceSummary["verificationStateCounts"];
  readonly candidateVerificationCounts: CandidateVerificationPublicationEvidenceSummary["candidateVerificationCounts"];
  readonly metadata: CandidateVerificationPublicationEvidenceSummary["metadata"];
  readonly redactionFlags: CandidateVerificationPublicationEvidenceSummary["redactionFlags"];
};

export type M070S03Report = {
  readonly command: typeof COMMAND_NAME;
  readonly generated_at: string;
  readonly proofMode: "local-fixture-in-process";
  readonly proofScope: "s03-aggregate-review-details-and-runtime-log-boundary";
  readonly success: boolean;
  readonly status_code: M070S03StatusCode;
  readonly check_ids: readonly M070S03CheckId[];
  readonly checks: readonly M070S03Check[];
  readonly failing_check_id: M070S03CheckId | null;
  readonly fixtureSummaries: readonly M070S03FixtureSummary[];
  readonly aggregateEvidence: {
    readonly fixtureCount: number;
    readonly aggregateStatus: CandidateVerificationPublicationEvidenceSummary["aggregateStatus"];
    readonly counts: CandidateVerificationPublicationEvidenceSummary["counts"];
    readonly publicationDenialCounts: CandidateVerificationPublicationEvidenceSummary["publicationDenialCounts"];
    readonly reasonCategories: readonly CandidatePublicationPolicyReasonCategory[];
    readonly verificationStateCounts: CandidateVerificationPublicationEvidenceSummary["verificationStateCounts"];
    readonly candidateVerificationCounts: CandidateVerificationPublicationEvidenceSummary["candidateVerificationCounts"];
  };
  readonly correlationMetadata: {
    readonly hasDeliveryId: boolean;
    readonly hasReviewOutputKey: boolean;
    readonly hasCorrelationKey: boolean;
    readonly deliveryIdAvailable: boolean;
    readonly reviewOutputKeyAvailable: boolean;
    readonly correlationKeyAvailable: boolean;
    readonly deliveryIdValue: string | null;
    readonly reviewOutputKeyValue: string | null;
    readonly correlationKeyValue: string | null;
  };
  readonly surfaces: {
    readonly reviewDetailsLineAvailable: boolean;
    readonly reviewDetailsAggregateCountsAvailable: boolean;
    readonly reviewDetailsReasonsAvailable: boolean;
    readonly reviewDetailsMetadataAvailable: boolean;
    readonly reviewDetailsRedactionAvailable: boolean;
    readonly runtimeLogFieldsAvailable: boolean;
    readonly runtimeLogAggregateCountsAvailable: boolean;
    readonly runtimeLogReasonCountsAvailable: boolean;
    readonly runtimeLogMetadataAvailable: boolean;
    readonly runtimeLogRedactionAvailable: boolean;
  };
  readonly redaction: {
    readonly privateOnly: boolean;
    readonly candidateBodiesIncluded: boolean;
    readonly specialistProseIncluded: boolean;
    readonly rawPromptsIncluded: boolean;
    readonly rawModelOutputIncluded: boolean;
    readonly diffsIncluded: boolean;
    readonly evidencePayloadsIncluded: boolean;
    readonly rawFingerprintsIncluded: boolean;
    readonly publicationEvidenceIncluded: boolean;
    readonly candidateAttemptIncluded: boolean;
    readonly candidateKeyIncluded: boolean;
    readonly unsafeInputFieldCount: number;
    readonly discardedRawPayload: boolean;
    readonly discardedPublicationFields: boolean;
    readonly discardedEvidencePayloads: boolean;
    readonly reviewDetailsLeakPresent: boolean;
    readonly runtimeLogLeakPresent: boolean;
    readonly verifierJsonLeakPresent: boolean;
    readonly forbiddenCanaryCount: number;
  };
  readonly malformedFailClosed: {
    readonly deniedCount: number;
    readonly malformedRecordCount: number;
    readonly unavailableVerificationCount: number;
    readonly hasFailClosedReason: boolean;
  };
  readonly targetedTests: readonly string[];
  readonly issues: readonly string[];
};

export type EvaluateM070S03Options = {
  readonly generatedAt?: string;
  readonly readPackageJsonText?: () => Promise<string>;
  readonly formatReviewDetails?: typeof formatReviewDetailsSummary;
  readonly buildRuntimeLogFields?: (evidence: CandidateVerificationPublicationEvidenceSummary) => Record<string, unknown>;
};

const TARGETED_TEST_COMMANDS = [
  "bun test ./scripts/verify-m070-s03.test.ts && bun run verify:m070:s03 --json",
  "bun test ./src/specialists/candidate-verification-publication-evidence.test.ts ./src/lib/review-utils.test.ts ./src/handlers/review-candidate-verification-evidence.test.ts",
  "bun test ./src/specialists/candidate-publication-policy.test.ts ./src/handlers/review-candidate-verification-publication.test.ts",
] as const;

const FORBIDDEN_CANARIES = [
  "M070_RAW_CANDIDATE_BODY_SHOULD_NOT_LEAK",
  "M070_SPECIALIST_PROSE_SHOULD_NOT_LEAK",
  "M070_PROMPT_SHOULD_NOT_LEAK",
  "M070_RAW_MODEL_OUTPUT_SHOULD_NOT_LEAK",
  "M070_TOOL_PAYLOAD_SHOULD_NOT_LEAK",
  "M070_DIFF_SHOULD_NOT_LEAK",
  "M070_FINGERPRINT_SHOULD_NOT_LEAK",
  "M070_EVIDENCE_PAYLOAD_SHOULD_NOT_LEAK",
] as const;

const ZERO_COUNTS: CandidatePublicationPolicyResult["counts"] = {
  candidateCount: 1,
  evidenceCount: 1,
  verifiedCount: 0,
  partiallyVerifiedCount: 0,
  unverifiedCount: 0,
  disprovenCount: 0,
  publicationEligibleCount: 0,
  duplicateCount: 0,
  disagreementCount: 0,
  unclassifiableCount: 0,
  malformedRecordCount: 0,
  truncatedCandidateCount: 0,
  truncatedEvidenceCount: 0,
  policyCandidateCount: 1,
};

function policyResult(params: {
  readonly allowed: boolean;
  readonly verificationState: CandidateVerificationState | null;
  readonly reasonCategories: readonly CandidatePublicationPolicyReasonCategory[];
  readonly counts?: Partial<CandidatePublicationPolicyResult["counts"]>;
  readonly unsafeInputFieldCount?: number;
  readonly hasMetadata?: boolean;
}): CandidatePublicationPolicyResult {
  return {
    allowed: params.allowed,
    status: params.allowed ? "allow" : "deny",
    candidateRef: "candidate-fixture-ref",
    verificationState: params.verificationState,
    reasonCategories: params.reasonCategories,
    counts: {
      ...ZERO_COUNTS,
      verifiedCount: params.verificationState === "verified" ? 1 : 0,
      partiallyVerifiedCount: params.verificationState === "partially_verified" ? 1 : 0,
      unverifiedCount: params.verificationState === "unverified" ? 1 : 0,
      disprovenCount: params.verificationState === "disproven" ? 1 : 0,
      publicationEligibleCount: params.allowed ? 1 : 0,
      ...params.counts,
    },
    hasDeliveryId: params.hasMetadata !== false,
    hasReviewOutputKey: params.hasMetadata !== false,
    hasCorrelationKey: params.hasMetadata !== false,
    redactionFlags: {
      privateOnly: true,
      candidateBodiesIncluded: false,
      specialistProseIncluded: false,
      rawPromptsIncluded: false,
      rawModelOutputIncluded: false,
      diffsIncluded: false,
      evidencePayloadsIncluded: false,
      rawFingerprintsIncluded: false,
      unsafeInputFieldCount: params.unsafeInputFieldCount ?? 0,
      discardedRawPayload: (params.unsafeInputFieldCount ?? 0) > 0,
      discardedPublicationFields: (params.unsafeInputFieldCount ?? 0) > 0,
      discardedEvidencePayloads: (params.unsafeInputFieldCount ?? 0) > 0,
      candidateAttemptIncluded: false,
      candidateKeyIncluded: false,
    },
  };
}

type NamedFixture = {
  readonly name: M070S03FixtureName;
  readonly events: readonly CandidateVerificationPublicationEvidenceEvent[];
};

const FIXTURES: readonly NamedFixture[] = [
  {
    name: "verified_allowed_published",
    events: [
      {
        outcome: "allowed",
        policyResult: policyResult({ allowed: true, verificationState: "verified", reasonCategories: ["full-support"], unsafeInputFieldCount: 2 }),
        metadata: { deliveryId: "delivery-m070-verified", reviewOutputKey: "review-output-m070-verified", correlationKey: "corr-m070-verified" },
      },
      { outcome: "published", metadata: { deliveryId: "delivery-m070-verified", reviewOutputKey: "review-output-m070-verified", correlationKey: "corr-m070-verified" } },
    ],
  },
  {
    name: "partial_allowed_published",
    events: [
      {
        outcome: "allowed",
        policyResult: policyResult({ allowed: true, verificationState: "partially_verified", reasonCategories: ["partial-support"], unsafeInputFieldCount: 1 }),
        metadata: { deliveryId: "delivery-m070-partial", reviewOutputKey: "review-output-m070-partial", correlationKey: "corr-m070-partial" },
      },
      { outcome: "published", metadata: { deliveryId: "delivery-m070-partial", reviewOutputKey: "review-output-m070-partial", correlationKey: "corr-m070-partial" } },
    ],
  },
  {
    name: "disputed_denied",
    events: [
      {
        outcome: "denied",
        policyResult: policyResult({ allowed: false, verificationState: "disproven", reasonCategories: ["evidence-conflict", "evidence-contradiction", "publication-ineligible"], counts: { disagreementCount: 1 }, unsafeInputFieldCount: 1 }),
        metadata: { deliveryId: "delivery-m070-disputed", reviewOutputKey: "review-output-m070-disputed", correlationKey: "corr-m070-disputed" },
      },
    ],
  },
  {
    name: "unverified_denied",
    events: [
      {
        outcome: "denied",
        policyResult: policyResult({ allowed: false, verificationState: "unverified", reasonCategories: ["no-evidence", "publication-ineligible"] }),
        metadata: { deliveryId: "delivery-m070-unverified", reviewOutputKey: "review-output-m070-unverified", correlationKey: "corr-m070-unverified" },
      },
    ],
  },
  {
    name: "unclassifiable_denied",
    events: [
      {
        outcome: "denied",
        policyResult: policyResult({ allowed: false, verificationState: null, reasonCategories: ["evidence-unrecognized", "publication-ineligible"], counts: { unclassifiableCount: 1 } }),
        metadata: { deliveryId: "delivery-m070-unclassifiable", reviewOutputKey: "review-output-m070-unclassifiable", correlationKey: "corr-m070-unclassifiable" },
      },
    ],
  },
  {
    name: "missing_metadata_unavailable",
    events: [
      { outcome: "failed", reason: "local-fixture-unavailable" },
      { outcome: "skipped", reason: "metadata-unavailable" },
    ],
  },
  {
    name: "malformed_fail_closed",
    events: [
      {
        outcome: "denied",
        reason: FORBIDDEN_CANARIES[0],
        policyResult: {
          rawCandidateBody: FORBIDDEN_CANARIES[0],
          specialistProse: FORBIDDEN_CANARIES[1],
          prompt: FORBIDDEN_CANARIES[2],
          rawModelOutput: FORBIDDEN_CANARIES[3],
          toolPayload: FORBIDDEN_CANARIES[4],
          diff: FORBIDDEN_CANARIES[5],
          fingerprint: FORBIDDEN_CANARIES[6],
          evidencePayload: FORBIDDEN_CANARIES[7],
        } as never,
        metadata: { deliveryId: "delivery-m070-malformed", reviewOutputKey: "review-output-m070-malformed", correlationKey: "corr-m070-malformed" },
      },
    ],
  },
] as const;

export function parseM070S03Args(args: readonly string[]): M070S03Args {
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

export async function evaluateM070S03Contract(options: EvaluateM070S03Options = {}): Promise<M070S03Report> {
  const readPackageJsonText = options.readPackageJsonText ?? (() => Bun.file("package.json").text());
  const formatDetails = options.formatReviewDetails ?? formatReviewDetailsSummary;
  const buildLogFields = options.buildRuntimeLogFields ?? buildCandidateVerificationPublicationEvidenceLogFields;
  const fixtureSummaries = FIXTURES.map((fixture) => summarizeFixture(fixture));
  const aggregateEvidence = summarizeAggregate(fixtureSummaries);
  const reviewDetails = buildReviewDetails(formatDetails, aggregateEvidence);
  const reviewDetailsLine = reviewDetails.split("\n").find((line) => line.includes("M070 candidate verification publication")) ?? "";
  const runtimeLogFields = buildLogFields(aggregateEvidence);
  const surfaces = summarizeSurfaces(reviewDetailsLine, runtimeLogFields);
  const packageJsonText = await readPackageJsonText();
  const redaction = summarizeRedaction(aggregateEvidence, reviewDetails, runtimeLogFields);
  const malformedFailClosed = summarizeMalformed(fixtureSummaries);

  const reportWithoutChecks = {
    command: COMMAND_NAME,
    generated_at: options.generatedAt ?? new Date().toISOString(),
    proofMode: "local-fixture-in-process" as const,
    proofScope: "s03-aggregate-review-details-and-runtime-log-boundary" as const,
    success: false,
    status_code: "m070_s03_contract_failed" as M070S03StatusCode,
    check_ids: [...M070_S03_CHECK_IDS],
    checks: [] as readonly M070S03Check[],
    failing_check_id: null as M070S03CheckId | null,
    fixtureSummaries,
    aggregateEvidence: {
      fixtureCount: fixtureSummaries.length,
      aggregateStatus: aggregateEvidence.aggregateStatus,
      counts: aggregateEvidence.counts,
      publicationDenialCounts: aggregateEvidence.publicationDenialCounts,
      reasonCategories: aggregateEvidence.reasonCategories,
      verificationStateCounts: aggregateEvidence.verificationStateCounts,
      candidateVerificationCounts: aggregateEvidence.candidateVerificationCounts,
    },
    correlationMetadata: {
      hasDeliveryId: aggregateEvidence.metadata.hasDeliveryId,
      hasReviewOutputKey: aggregateEvidence.metadata.hasReviewOutputKey,
      hasCorrelationKey: aggregateEvidence.metadata.hasCorrelationKey,
      deliveryIdAvailable: typeof aggregateEvidence.metadata.deliveryId === "string",
      reviewOutputKeyAvailable: typeof aggregateEvidence.metadata.reviewOutputKey === "string",
      correlationKeyAvailable: typeof aggregateEvidence.metadata.correlationKey === "string",
      deliveryIdValue: aggregateEvidence.metadata.deliveryId ?? null,
      reviewOutputKeyValue: aggregateEvidence.metadata.reviewOutputKey ?? null,
      correlationKeyValue: aggregateEvidence.metadata.correlationKey ?? null,
    },
    surfaces,
    redaction,
    malformedFailClosed,
    targetedTests: [...TARGETED_TEST_COMMANDS],
    issues: [] as readonly string[],
  } satisfies M070S03Report;

  const checks = [
    buildFixtureCoverageCheck(fixtureSummaries),
    buildAggregateProjectionCheck(aggregateEvidence),
    buildReviewDetailsSurfaceCheck(surfaces),
    buildRuntimeLogSurfaceCheck(surfaces),
    buildRedactionBoundaryCheck(reportWithoutChecks),
    buildPackageWiringCheck(packageJsonText),
  ];
  const issues = checks.filter((check) => !check.passed).map((check) => check.detail);
  const failingCheck = checks.find((check) => !check.passed) ?? null;

  const report = {
    ...reportWithoutChecks,
    checks,
    success: issues.length === 0,
    status_code: issues.length === 0 ? "m070_s03_ok" : "m070_s03_contract_failed",
    failing_check_id: failingCheck?.id ?? null,
    issues,
  } satisfies M070S03Report;

  const jsonLeakPresent = containsForbiddenCanary(JSON.stringify(report));
  if (!jsonLeakPresent) return report;

  const redactionWithJsonLeak = { ...report.redaction, verifierJsonLeakPresent: true };
  const redactionCheck = makeCheck({
    id: "M070-S03-REDACTION-BOUNDARY",
    okCode: "redaction_boundary_ok",
    failCode: "redaction_boundary_failed",
    okDetail: "Review Details, runtime log fields, and verifier JSON contain redaction booleans but no raw candidate, specialist, prompt, model, tool, diff, fingerprint, or evidence payload canaries.",
    failures: ["Verifier JSON contains forbidden private canary content."],
  });
  const patchedChecks = checks.map((check) => check.id === redactionCheck.id ? redactionCheck : check);
  return {
    ...report,
    success: false,
    status_code: "m070_s03_contract_failed",
    checks: patchedChecks,
    failing_check_id: patchedChecks.find((check) => !check.passed)?.id ?? "M070-S03-REDACTION-BOUNDARY",
    redaction: redactionWithJsonLeak,
    issues: patchedChecks.filter((check) => !check.passed).map((check) => check.detail),
  };
}

function summarizeFixture(fixture: NamedFixture): M070S03FixtureSummary {
  let summary = initialCandidateVerificationPublicationEvidenceSummary();
  for (const event of fixture.events) {
    summary = projectCandidateVerificationPublicationEvidence(summary, event);
  }
  return {
    fixture: fixture.name,
    aggregateStatus: summary.aggregateStatus,
    counts: summary.counts,
    publicationDenialCounts: summary.publicationDenialCounts,
    reasonCategories: summary.reasonCategories,
    verificationStateCounts: summary.verificationStateCounts,
    candidateVerificationCounts: summary.candidateVerificationCounts,
    metadata: summary.metadata,
    redactionFlags: summary.redactionFlags,
  };
}

function summarizeAggregate(summaries: readonly M070S03FixtureSummary[]): CandidateVerificationPublicationEvidenceSummary {
  let aggregate = initialCandidateVerificationPublicationEvidenceSummary();
  for (const fixture of FIXTURES) {
    for (const event of fixture.events) {
      aggregate = projectCandidateVerificationPublicationEvidence(aggregate, event);
    }
  }
  return aggregate;
}

function buildReviewDetails(
  formatter: typeof formatReviewDetailsSummary,
  evidence: CandidateVerificationPublicationEvidenceSummary,
): string {
  return formatter({
    reviewOutputKey: "m070-s03-review-output-key",
    filesReviewed: 1,
    linesAdded: 1,
    linesRemoved: 0,
    findingCounts: { critical: 0, major: 0, medium: 0, minor: 0 },
    profileSelection: { selectedProfile: "balanced", source: "auto", linesChanged: 1, autoBand: null },
    contributorExperience: projectContributorExperienceContract({ source: "none", tier: null }).reviewDetails,
    candidateVerificationPublicationEvidence: evidence,
    completedAt: "2026-05-10T00:00:00.000Z",
  });
}

function buildCandidateVerificationPublicationEvidenceLogFields(evidence: CandidateVerificationPublicationEvidenceSummary): Record<string, unknown> {
  return {
    gate: "m070-candidate-verification-evidence",
    aggregateStatus: evidence.aggregateStatus,
    attemptedCount: evidence.counts.attempted,
    allowedCount: evidence.counts.allowed,
    deniedCount: evidence.counts.denied,
    publishedCount: evidence.counts.published,
    skippedCount: evidence.counts.skipped,
    failedCount: evidence.counts.failed,
    publicationDenialCounts: evidence.publicationDenialCounts,
    reasonCategories: evidence.reasonCategories,
    verificationStateCounts: evidence.verificationStateCounts,
    candidateVerificationCounts: evidence.candidateVerificationCounts,
    hasDeliveryId: evidence.metadata.hasDeliveryId,
    hasReviewOutputKey: evidence.metadata.hasReviewOutputKey,
    hasCorrelationKey: evidence.metadata.hasCorrelationKey,
    deliveryId: evidence.metadata.deliveryId,
    reviewOutputKey: evidence.metadata.reviewOutputKey,
    correlationKey: evidence.metadata.correlationKey,
    privateOnly: evidence.redactionFlags.privateOnly,
    candidateBodiesIncluded: evidence.redactionFlags.candidateBodiesIncluded,
    specialistProseIncluded: evidence.redactionFlags.specialistProseIncluded,
    rawPromptsIncluded: evidence.redactionFlags.rawPromptsIncluded,
    rawModelOutputIncluded: evidence.redactionFlags.rawModelOutputIncluded,
    diffsIncluded: evidence.redactionFlags.diffsIncluded,
    evidencePayloadsIncluded: evidence.redactionFlags.evidencePayloadsIncluded,
    rawFingerprintsIncluded: evidence.redactionFlags.rawFingerprintsIncluded,
    publicationEvidenceIncluded: evidence.redactionFlags.publicationEvidenceIncluded,
    unsafeInputFieldCount: evidence.redactionFlags.unsafeInputFieldCount,
    discardedRawPayload: evidence.redactionFlags.discardedRawPayload,
    discardedPublicationFields: evidence.redactionFlags.discardedPublicationFields,
    discardedEvidencePayloads: evidence.redactionFlags.discardedEvidencePayloads,
    candidateAttemptIncluded: evidence.redactionFlags.candidateAttemptIncluded,
    candidateKeyIncluded: evidence.redactionFlags.candidateKeyIncluded,
    boundedness: "aggregate-only",
  };
}

function summarizeSurfaces(reviewDetailsLine: string, logFields: Record<string, unknown>): M070S03Report["surfaces"] {
  const logText = JSON.stringify(logFields);
  return {
    reviewDetailsLineAvailable: reviewDetailsLine.includes("M070 candidate verification publication"),
    reviewDetailsAggregateCountsAvailable: reviewDetailsLine.includes("counts=attempted:") && reviewDetailsLine.includes("verification=verified:"),
    reviewDetailsReasonsAvailable: reviewDetailsLine.includes("denialCounts=") && reviewDetailsLine.includes("reasons="),
    reviewDetailsMetadataAvailable: reviewDetailsLine.includes("deliveryId:y") && reviewDetailsLine.includes("reviewOutputKey:y") && reviewDetailsLine.includes("correlationKey:y"),
    reviewDetailsRedactionAvailable: reviewDetailsLine.includes("redaction=privateOnly:y") && reviewDetailsLine.includes("publicationEvidence:n"),
    runtimeLogFieldsAvailable: logFields.gate === "m070-candidate-verification-evidence" && logFields.boundedness === "aggregate-only",
    runtimeLogAggregateCountsAvailable: ["attemptedCount", "allowedCount", "deniedCount", "publishedCount", "skippedCount", "failedCount"].every((key) => typeof logFields[key] === "number"),
    runtimeLogReasonCountsAvailable: logText.includes("publicationDenialCounts") && logText.includes("reasonCategories"),
    runtimeLogMetadataAvailable: logFields.hasDeliveryId === true && logFields.hasReviewOutputKey === true && logFields.hasCorrelationKey === true,
    runtimeLogRedactionAvailable: logFields.privateOnly === true && logFields.publicationEvidenceIncluded === false && logFields.candidateBodiesIncluded === false,
  };
}

function summarizeRedaction(
  evidence: CandidateVerificationPublicationEvidenceSummary,
  reviewDetails: string,
  logFields: Record<string, unknown>,
): M070S03Report["redaction"] {
  const logText = JSON.stringify(logFields);
  return {
    privateOnly: evidence.redactionFlags.privateOnly,
    candidateBodiesIncluded: evidence.redactionFlags.candidateBodiesIncluded,
    specialistProseIncluded: evidence.redactionFlags.specialistProseIncluded,
    rawPromptsIncluded: evidence.redactionFlags.rawPromptsIncluded,
    rawModelOutputIncluded: evidence.redactionFlags.rawModelOutputIncluded,
    diffsIncluded: evidence.redactionFlags.diffsIncluded,
    evidencePayloadsIncluded: evidence.redactionFlags.evidencePayloadsIncluded,
    rawFingerprintsIncluded: evidence.redactionFlags.rawFingerprintsIncluded,
    publicationEvidenceIncluded: evidence.redactionFlags.publicationEvidenceIncluded,
    candidateAttemptIncluded: evidence.redactionFlags.candidateAttemptIncluded,
    candidateKeyIncluded: evidence.redactionFlags.candidateKeyIncluded,
    unsafeInputFieldCount: evidence.redactionFlags.unsafeInputFieldCount,
    discardedRawPayload: evidence.redactionFlags.discardedRawPayload,
    discardedPublicationFields: evidence.redactionFlags.discardedPublicationFields,
    discardedEvidencePayloads: evidence.redactionFlags.discardedEvidencePayloads,
    reviewDetailsLeakPresent: containsForbiddenCanary(reviewDetails),
    runtimeLogLeakPresent: containsForbiddenCanary(logText),
    verifierJsonLeakPresent: false,
    forbiddenCanaryCount: FORBIDDEN_CANARIES.length,
  };
}

function summarizeMalformed(summaries: readonly M070S03FixtureSummary[]): M070S03Report["malformedFailClosed"] {
  const malformed = summaries.find((summary) => summary.fixture === "malformed_fail_closed");
  return {
    deniedCount: malformed?.counts.denied ?? 0,
    malformedRecordCount: malformed?.candidateVerificationCounts.malformedRecordCount ?? 0,
    unavailableVerificationCount: malformed?.verificationStateCounts.unavailable ?? 0,
    hasFailClosedReason: malformed?.reasonCategories.includes("classifier-fail-closed") === true,
  };
}

function buildFixtureCoverageCheck(summaries: readonly M070S03FixtureSummary[]): M070S03Check {
  const failures: string[] = [];
  for (const fixture of FIXTURES) {
    if (!summaries.some((summary) => summary.fixture === fixture.name)) failures.push(`Missing ${fixture.name} fixture.`);
  }
  for (const fixture of ["verified_allowed_published", "partial_allowed_published"] as const) {
    const summary = summaries.find((entry) => entry.fixture === fixture);
    if (!summary || summary.counts.allowed < 1 || summary.counts.published < 1) failures.push(`Expected ${fixture} to be allowed and published.`);
  }
  for (const fixture of ["disputed_denied", "unverified_denied", "unclassifiable_denied", "malformed_fail_closed"] as const) {
    const summary = summaries.find((entry) => entry.fixture === fixture);
    if (!summary || summary.counts.denied < 1) failures.push(`Expected ${fixture} to be denied.`);
  }
  const unavailable = summaries.find((entry) => entry.fixture === "missing_metadata_unavailable");
  if (!unavailable || unavailable.counts.failed < 1 || unavailable.counts.skipped < 1 || unavailable.metadata.hasDeliveryId) {
    failures.push("Expected missing_metadata_unavailable to expose failed/skipped counts without metadata presence.");
  }
  return makeCheck({
    id: "M070-S03-FIXTURE-COVERAGE",
    okCode: "fixture_coverage_ok",
    failCode: "fixture_coverage_failed",
    okDetail: "Verifier covers verified allowed/published, partial allowed/published, disputed/unverified/unclassifiable denied, unavailable metadata, and malformed fail-closed fixtures.",
    failures,
  });
}

function buildAggregateProjectionCheck(evidence: CandidateVerificationPublicationEvidenceSummary): M070S03Check {
  const failures: string[] = [];
  if (evidence.aggregateStatus !== "mixed") failures.push("Expected mixed aggregate status across publication fixture outcomes.");
  if (evidence.counts.attempted < 6 || evidence.counts.allowed !== 2 || evidence.counts.denied !== 4 || evidence.counts.published !== 2) {
    failures.push("Expected aggregate attempted/allowed/denied/published counts for all S03 fixture cases.");
  }
  for (const reason of ["publication-ineligible", "classifier-fail-closed", "no-evidence", "evidence-conflict"] as const) {
    if (!evidence.reasonCategories.includes(reason)) failures.push(`Expected bounded reason category ${reason}.`);
  }
  if ((evidence.publicationDenialCounts["publication-ineligible"] ?? 0) < 4) failures.push("Expected publication-denial counts for denied fixtures.");
  if (evidence.verificationStateCounts.verified < 1 || evidence.verificationStateCounts.partially_verified < 1 || evidence.verificationStateCounts.unverified < 1 || evidence.verificationStateCounts.disproven < 1 || evidence.verificationStateCounts.unavailable < 1) {
    failures.push("Expected verification state counts to include verified, partial, unverified, disproven, and unavailable evidence.");
  }
  return makeCheck({
    id: "M070-S03-AGGREGATE-PROJECTION",
    okCode: "aggregate_projection_ok",
    failCode: "aggregate_projection_failed",
    okDetail: "Projection emits aggregate counts, bounded reason categories, publication-denial counts, metadata, and redaction flags only.",
    failures,
  });
}

function buildReviewDetailsSurfaceCheck(surfaces: M070S03Report["surfaces"]): M070S03Check {
  const failures = booleanFailures(surfaces, [
    "reviewDetailsLineAvailable",
    "reviewDetailsAggregateCountsAvailable",
    "reviewDetailsReasonsAvailable",
    "reviewDetailsMetadataAvailable",
    "reviewDetailsRedactionAvailable",
  ]);
  return makeCheck({
    id: "M070-S03-REVIEW-DETAILS-SURFACE",
    okCode: "review_details_surface_ok",
    failCode: "review_details_surface_failed",
    okDetail: "Review Details exposes the M070 aggregate line with counts, bounded reasons, correlation metadata, and redaction flags.",
    failures,
  });
}

function buildRuntimeLogSurfaceCheck(surfaces: M070S03Report["surfaces"]): M070S03Check {
  const failures = booleanFailures(surfaces, [
    "runtimeLogFieldsAvailable",
    "runtimeLogAggregateCountsAvailable",
    "runtimeLogReasonCountsAvailable",
    "runtimeLogMetadataAvailable",
    "runtimeLogRedactionAvailable",
  ]);
  return makeCheck({
    id: "M070-S03-RUNTIME-LOG-SURFACE",
    okCode: "runtime_log_surface_ok",
    failCode: "runtime_log_surface_failed",
    okDetail: "Runtime log fields expose aggregate counts, bounded reasons, correlation metadata, and redaction booleans.",
    failures,
  });
}

function buildRedactionBoundaryCheck(report: M070S03Report): M070S03Check {
  const failures: string[] = [];
  const redaction = report.redaction;
  if (!redaction.privateOnly) failures.push("Expected privateOnly redaction flag.");
  for (const key of ["candidateBodiesIncluded", "specialistProseIncluded", "rawPromptsIncluded", "rawModelOutputIncluded", "diffsIncluded", "evidencePayloadsIncluded", "rawFingerprintsIncluded", "publicationEvidenceIncluded", "candidateAttemptIncluded", "candidateKeyIncluded"] as const) {
    if (redaction[key]) failures.push(`Expected ${key} to remain false.`);
  }
  if (redaction.unsafeInputFieldCount < 4 || !redaction.discardedRawPayload || !redaction.discardedPublicationFields || !redaction.discardedEvidencePayloads) {
    failures.push("Expected unsafe private fields to be counted and discarded without content emission.");
  }
  if (redaction.reviewDetailsLeakPresent) failures.push("Review Details contains forbidden private canary content.");
  if (redaction.runtimeLogLeakPresent) failures.push("Runtime log fields contain forbidden private canary content.");
  if (redaction.verifierJsonLeakPresent) failures.push("Verifier JSON contains forbidden private canary content.");
  if (report.malformedFailClosed.deniedCount < 1 || report.malformedFailClosed.malformedRecordCount < 1 || !report.malformedFailClosed.hasFailClosedReason) {
    failures.push("Malformed fixture must fail closed with denied count, malformed count, and classifier-fail-closed reason.");
  }
  return makeCheck({
    id: "M070-S03-REDACTION-BOUNDARY",
    okCode: "redaction_boundary_ok",
    failCode: "redaction_boundary_failed",
    okDetail: "Review Details, runtime log fields, and verifier JSON contain redaction booleans but no raw candidate, specialist, prompt, model, tool, diff, fingerprint, or evidence payload canaries.",
    failures,
  });
}

function buildPackageWiringCheck(packageJsonText: string): M070S03Check {
  const failures: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(packageJsonText);
  } catch {
    failures.push("package.json must be parseable JSON.");
  }
  const scripts = isRecord(parsed) && isRecord(parsed.scripts) ? parsed.scripts : {};
  if (scripts[COMMAND_NAME] !== EXPECTED_PACKAGE_SCRIPT) {
    failures.push(`package.json scripts.${COMMAND_NAME} must equal ${EXPECTED_PACKAGE_SCRIPT}.`);
  }
  return makeCheck({
    id: "M070-S03-PACKAGE-WIRING",
    okCode: "package_wiring_ok",
    failCode: "package_wiring_failed",
    okDetail: "package.json exposes verify:m070:s03 as the local S03 aggregate evidence verifier.",
    failures,
  });
}

function booleanFailures<T extends Record<string, unknown>>(record: T, keys: readonly (keyof T)[]): string[] {
  return keys.filter((key) => record[key] !== true).map((key) => `Expected ${String(key)} to be true.`);
}

function makeCheck(params: {
  readonly id: M070S03CheckId;
  readonly okCode: M070S03CheckStatusCode;
  readonly failCode: M070S03CheckStatusCode;
  readonly okDetail: string;
  readonly failures: readonly string[];
}): M070S03Check {
  const passed = params.failures.length === 0;
  return {
    id: params.id,
    passed,
    status: passed ? "pass" : "fail",
    status_code: passed ? params.okCode : params.failCode,
    detail: passed ? params.okDetail : params.failures.join(" "),
  };
}

function containsForbiddenCanary(text: string): boolean {
  return FORBIDDEN_CANARIES.some((canary) => text.includes(canary));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function renderM070S03Report(report: M070S03Report): string {
  return [
    "M070 S03 aggregate evidence/privacy verifier",
    `status: ${report.status_code}`,
    `success: ${report.success ? "yes" : "no"}`,
    `proof: ${report.proofMode} / ${report.proofScope}`,
    "",
    "checks:",
    ...report.checks.map((check) => `- [${check.passed ? "x" : " "}] ${check.id}: ${check.detail}`),
    "",
    "aggregate evidence:",
    `- fixtures: ${report.aggregateEvidence.fixtureCount}`,
    `- counts: attempted=${report.aggregateEvidence.counts.attempted} allowed=${report.aggregateEvidence.counts.allowed} denied=${report.aggregateEvidence.counts.denied} published=${report.aggregateEvidence.counts.published} skipped=${report.aggregateEvidence.counts.skipped} failed=${report.aggregateEvidence.counts.failed}`,
    `- reasons: ${report.aggregateEvidence.reasonCategories.join(",")}`,
    `- review_details_line_available: ${report.surfaces.reviewDetailsLineAvailable}`,
    `- runtime_log_fields_available: ${report.surfaces.runtimeLogFieldsAvailable}`,
    `- redaction_leaks: review_details=${report.redaction.reviewDetailsLeakPresent} runtime_log=${report.redaction.runtimeLogLeakPresent} json=${report.redaction.verifierJsonLeakPresent}`,
    "",
    "targeted tests:",
    ...report.targetedTests.map((command) => `- ${command}`),
    ...(report.issues.length > 0 ? ["", "issues:", ...report.issues.map((issue) => `- ${issue}`)] : []),
    "",
  ].join("\n");
}

export function renderHelp(): string {
  return [
    "M070 S03 aggregate evidence/privacy verifier",
    "",
    "Usage:",
    "  bun run verify:m070:s03 [--json]",
    "",
    "Notes:",
    "  - Uses deterministic in-process fixtures through S03 projection and Review Details formatting helpers.",
    "  - Does not read .gsd, .planning, .audits, .env, GitHub, Azure, databases, or credentials.",
    "  - Emits aggregate counts, bounded reason categories, publication-denial counts, correlation metadata, and redaction booleans only.",
    "  - Does not emit raw candidate bodies, specialist prose, prompts, diffs, fingerprints, model/tool payloads, or evidence payloads.",
    "",
  ].join("\n");
}

export async function main(
  args: readonly string[] = process.argv.slice(2),
  io?: {
    stdout?: { write: (chunk: string) => void };
    stderr?: { write: (chunk: string) => void };
    evaluate?: typeof evaluateM070S03Contract;
  },
): Promise<number> {
  const stdout = io?.stdout ?? process.stdout;
  const stderr = io?.stderr ?? process.stderr;
  const evaluate = io?.evaluate ?? evaluateM070S03Contract;

  let parsed: M070S03Args;
  try {
    parsed = parseM070S03Args(args);
  } catch (error) {
    const report = buildInvalidArgReport(error instanceof Error ? error.message : String(error));
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 2;
  }

  if (parsed.help) {
    stdout.write(renderHelp());
    return 0;
  }

  const report = await evaluate({ generatedAt: new Date().toISOString() });
  if (parsed.json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    stdout.write(renderM070S03Report(report));
  }

  if (!report.success) {
    stderr.write(`${COMMAND_NAME} failed: ${report.failing_check_id ?? "unknown"}\n`);
  }
  return report.success ? 0 : 1;
}

function buildInvalidArgReport(issue: string): M070S03Report {
  const empty = initialCandidateVerificationPublicationEvidenceSummary();
  return {
    command: COMMAND_NAME,
    generated_at: new Date().toISOString(),
    proofMode: "local-fixture-in-process",
    proofScope: "s03-aggregate-review-details-and-runtime-log-boundary",
    success: false,
    status_code: "m070_s03_invalid_arg",
    check_ids: [...M070_S03_CHECK_IDS],
    checks: [],
    failing_check_id: null,
    fixtureSummaries: [],
    aggregateEvidence: {
      fixtureCount: 0,
      aggregateStatus: empty.aggregateStatus,
      counts: empty.counts,
      publicationDenialCounts: empty.publicationDenialCounts,
      reasonCategories: empty.reasonCategories,
      verificationStateCounts: empty.verificationStateCounts,
      candidateVerificationCounts: empty.candidateVerificationCounts,
    },
    correlationMetadata: {
      hasDeliveryId: false,
      hasReviewOutputKey: false,
      hasCorrelationKey: false,
      deliveryIdAvailable: false,
      reviewOutputKeyAvailable: false,
      correlationKeyAvailable: false,
      deliveryIdValue: null,
      reviewOutputKeyValue: null,
      correlationKeyValue: null,
    },
    surfaces: {
      reviewDetailsLineAvailable: false,
      reviewDetailsAggregateCountsAvailable: false,
      reviewDetailsReasonsAvailable: false,
      reviewDetailsMetadataAvailable: false,
      reviewDetailsRedactionAvailable: false,
      runtimeLogFieldsAvailable: false,
      runtimeLogAggregateCountsAvailable: false,
      runtimeLogReasonCountsAvailable: false,
      runtimeLogMetadataAvailable: false,
      runtimeLogRedactionAvailable: false,
    },
    redaction: {
      privateOnly: true,
      candidateBodiesIncluded: false,
      specialistProseIncluded: false,
      rawPromptsIncluded: false,
      rawModelOutputIncluded: false,
      diffsIncluded: false,
      evidencePayloadsIncluded: false,
      rawFingerprintsIncluded: false,
      publicationEvidenceIncluded: false,
      candidateAttemptIncluded: false,
      candidateKeyIncluded: false,
      unsafeInputFieldCount: 0,
      discardedRawPayload: false,
      discardedPublicationFields: false,
      discardedEvidencePayloads: false,
      reviewDetailsLeakPresent: false,
      runtimeLogLeakPresent: false,
      verifierJsonLeakPresent: false,
      forbiddenCanaryCount: FORBIDDEN_CANARIES.length,
    },
    malformedFailClosed: {
      deniedCount: 0,
      malformedRecordCount: 0,
      unavailableVerificationCount: 0,
      hasFailClosedReason: false,
    },
    targetedTests: [...TARGETED_TEST_COMMANDS],
    issues: [issue],
  };
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
