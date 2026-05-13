import type {
  CandidateVerificationPublicationEvidenceCounts,
  CandidateVerificationPublicationEvidenceMetadataSummary,
  CandidateVerificationPublicationEvidenceRedactionFlags,
  CandidateVerificationPublicationEvidenceSummary,
  CandidateVerificationPublicationVerificationStateCounts,
} from "../src/specialists/candidate-verification-publication-evidence.ts";
import type {
  CandidatePublicationPolicyCounts,
  CandidatePublicationPolicyReasonCategory,
} from "../src/specialists/candidate-publication-policy.ts";

export const COMMAND_NAME = "verify:m070" as const;

export const EXPECTED_PACKAGE_SCRIPT = "bun scripts/verify-m070.ts" as const;

export const M070_CHECK_IDS = [
  "M070-FIXTURE-CONTRACT",
  "M070-CANDIDATE-APPROVED-PUBLICATION",
  "M070-CORRELATION-METADATA",
  "M070-SAFETY-BLOCKERS",
  "M070-REDACTION-BOUNDARY",
  "M070-PACKAGE-WIRING",
] as const;

export const M070_STATUS_CODES = [
  "m070_fixture_contract_ok",
  "m070_contract_failed",
  "m070_invalid_arg",
  "m070_candidate_approved_verified_ok",
  "m070_candidate_approved_partial_ok",
  "m070_dispute_blocked",
  "m070_unclassifiable_blocked",
  "m070_missing_correlation_blocked",
  "m070_malformed_evidence_blocked",
  "m070_direct_fallback_only_rejected",
] as const;

const M070_SCENARIO_CHECK_IDS = [
  "M070-CANDIDATE-APPROVED-PUBLICATION",
  "M070-CORRELATION-METADATA",
  "M070-SAFETY-BLOCKERS",
  "M070-REDACTION-BOUNDARY",
] as const;

export const M070_SCENARIO_NAMES = [
  "candidate_approved_verified",
  "candidate_approved_partial_undisputed",
  "dispute_blocked",
  "unclassifiable_blocked",
  "missing_correlation",
  "malformed_evidence",
  "direct_fallback_only",
] as const;

const REASON_CATEGORY_LIMIT = 12;

const FORBIDDEN_RAW_FIELD_NAMES = new Set([
  "body",
  "candidateBody",
  "rawCandidate",
  "rawCandidateBody",
  "specialistProse",
  "prompt",
  "rawPrompt",
  "systemPrompt",
  "model",
  "modelOutput",
  "rawModelOutput",
  "tool",
  "toolPayload",
  "diff",
  "patch",
  "fingerprint",
  "rawFingerprint",
  "candidateKey",
  "candidateRef",
  "evidencePayload",
  "payload",
]);

export type M070CheckId = (typeof M070_CHECK_IDS)[number];
export type M070StatusCode = (typeof M070_STATUS_CODES)[number];
export type M070ScenarioName = (typeof M070_SCENARIO_NAMES)[number];

export type M070PublicationMode = {
  readonly candidateApprovedNonFallback: boolean;
  readonly directFallbackEvidence: boolean;
};

export type M070VerifierScenarioInput = {
  readonly scenario: M070ScenarioName;
  readonly aggregateEvidence: unknown;
  readonly publicationMode: M070PublicationMode;
};

export type M070Args = {
  readonly json: boolean;
  readonly help: boolean;
  readonly scenario: M070ScenarioName | null;
};

export type M070VerifierCheck = {
  readonly id: M070CheckId;
  readonly passed: boolean;
  readonly status: "pass" | "fail";
  readonly status_code: M070StatusCode;
  readonly detail: string;
};

export type M070BoundedAggregateEvidence = {
  readonly aggregateStatus: CandidateVerificationPublicationEvidenceSummary["aggregateStatus"] | "malformed";
  readonly counts: CandidateVerificationPublicationEvidenceCounts | null;
  readonly publicationDenialCounts: Partial<Record<CandidatePublicationPolicyReasonCategory, number>>;
  readonly reasonCategories: readonly CandidatePublicationPolicyReasonCategory[];
  readonly verificationStateCounts: CandidateVerificationPublicationVerificationStateCounts | null;
  readonly candidateVerificationCounts: CandidatePublicationPolicyCounts | null;
};

export type M070VerifierReport = {
  readonly command: typeof COMMAND_NAME;
  readonly generated_at: string;
  readonly proofMode: "local-fixture-pure-evaluator";
  readonly proofScope: "s04-verifier-success-semantics";
  readonly scenario: M070ScenarioName;
  readonly success: boolean;
  readonly status_code: M070StatusCode;
  readonly check_ids: readonly M070CheckId[];
  readonly checks: readonly M070VerifierCheck[];
  readonly failing_check_id: M070CheckId | null;
  readonly publicationMode: M070PublicationMode;
  readonly aggregateEvidence: M070BoundedAggregateEvidence;
  readonly correlationMetadata: {
    readonly hasDeliveryId: boolean;
    readonly hasReviewOutputKey: boolean;
    readonly hasCorrelationKey: boolean;
    readonly deliveryIdAvailable: boolean;
    readonly reviewOutputKeyAvailable: boolean;
    readonly correlationKeyAvailable: boolean;
  };
  readonly safety: {
    readonly disputed: boolean;
    readonly unclassifiableOrBlocked: boolean;
    readonly malformed: boolean;
    readonly missingCorrelation: boolean;
    readonly directFallbackOnly: boolean;
    readonly undisputedPartial: boolean;
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
    readonly forbiddenInputFieldPresent: boolean;
  };
  readonly issue_categories: readonly string[];
  readonly issues: readonly string[];
};

export type M070VerifierContractReport = {
  readonly command: typeof COMMAND_NAME;
  readonly generated_at: string;
  readonly proofMode: "local-fixture-contract";
  readonly proofScope: "s04-verifier-success-semantics";
  readonly success: boolean;
  readonly status_code: M070StatusCode;
  readonly check_ids: readonly M070CheckId[];
  readonly checks: readonly M070VerifierCheck[];
  readonly failing_check_id: M070CheckId | null;
  readonly scenarioReports: readonly M070VerifierReport[];
  readonly expectedScenarioStatuses: Readonly<Record<M070ScenarioName, M070StatusCode>>;
  readonly packageWiring: {
    readonly scriptName: typeof COMMAND_NAME;
    readonly expected: typeof EXPECTED_PACKAGE_SCRIPT;
    readonly present: boolean;
    readonly matches: boolean;
  };
  readonly targetedTests: readonly string[];
  readonly issue_categories: readonly string[];
  readonly issues: readonly string[];
};

export type M070CliReport = M070VerifierReport | M070VerifierContractReport;

export type EvaluateM070VerifierContractOptions = {
  readonly generatedAt?: string;
  readonly readPackageJsonText?: () => Promise<string>;
  readonly evaluate?: typeof evaluateM070VerifierScenario;
};

export type EvaluateM070VerifierScenarioOptions = {
  readonly generatedAt?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function hasForbiddenRawField(value: unknown, depth = 0): boolean {
  if (depth > 4 || !isRecord(value)) return false;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_RAW_FIELD_NAMES.has(key)) return true;
    if (isRecord(child) && hasForbiddenRawField(child, depth + 1)) return true;
  }
  return false;
}

function numberOrZero(value: unknown): number {
  return isNonNegativeNumber(value) ? value : 0;
}

function parseCounts(value: unknown): CandidateVerificationPublicationEvidenceCounts | null {
  if (!isRecord(value)) return null;
  const keys = ["attempted", "allowed", "denied", "published", "skipped", "failed"] as const;
  for (const key of keys) {
    if (!isNonNegativeNumber(value[key])) return null;
  }
  return {
    attempted: value.attempted,
    allowed: value.allowed,
    denied: value.denied,
    published: value.published,
    skipped: value.skipped,
    failed: value.failed,
  };
}

function parseVerificationStateCounts(value: unknown): CandidateVerificationPublicationVerificationStateCounts | null {
  if (!isRecord(value)) return null;
  const keys = ["verified", "partially_verified", "unverified", "disproven", "unavailable"] as const;
  for (const key of keys) {
    if (!isNonNegativeNumber(value[key])) return null;
  }
  return {
    verified: value.verified,
    partially_verified: value.partially_verified,
    unverified: value.unverified,
    disproven: value.disproven,
    unavailable: value.unavailable,
  };
}

function parseCandidateVerificationCounts(value: unknown): CandidatePublicationPolicyCounts | null {
  if (!isRecord(value)) return null;
  const keys = [
    "candidateCount",
    "evidenceCount",
    "verifiedCount",
    "partiallyVerifiedCount",
    "unverifiedCount",
    "disprovenCount",
    "publicationEligibleCount",
    "duplicateCount",
    "disagreementCount",
    "unclassifiableCount",
    "malformedRecordCount",
    "truncatedCandidateCount",
    "truncatedEvidenceCount",
    "policyCandidateCount",
  ] as const;
  for (const key of keys) {
    if (!isNonNegativeNumber(value[key])) return null;
  }
  return {
    candidateCount: value.candidateCount,
    evidenceCount: value.evidenceCount,
    verifiedCount: value.verifiedCount,
    partiallyVerifiedCount: value.partiallyVerifiedCount,
    unverifiedCount: value.unverifiedCount,
    disprovenCount: value.disprovenCount,
    publicationEligibleCount: value.publicationEligibleCount,
    duplicateCount: value.duplicateCount,
    disagreementCount: value.disagreementCount,
    unclassifiableCount: value.unclassifiableCount,
    malformedRecordCount: value.malformedRecordCount,
    truncatedCandidateCount: value.truncatedCandidateCount,
    truncatedEvidenceCount: value.truncatedEvidenceCount,
    policyCandidateCount: value.policyCandidateCount,
  };
}

function parseReasonCategories(value: unknown): CandidatePublicationPolicyReasonCategory[] {
  if (!Array.isArray(value)) return [];
  const reasons: CandidatePublicationPolicyReasonCategory[] = [];
  for (const item of value) {
    if (typeof item === "string" && !reasons.includes(item as CandidatePublicationPolicyReasonCategory) && reasons.length < REASON_CATEGORY_LIMIT) {
      reasons.push(item as CandidatePublicationPolicyReasonCategory);
    }
  }
  return reasons;
}

function parsePublicationDenialCounts(value: unknown): Partial<Record<CandidatePublicationPolicyReasonCategory, number>> {
  if (!isRecord(value)) return {};
  const result: Partial<Record<CandidatePublicationPolicyReasonCategory, number>> = {};
  for (const [key, count] of Object.entries(value).slice(0, REASON_CATEGORY_LIMIT)) {
    if (isNonNegativeNumber(count)) {
      result[key as CandidatePublicationPolicyReasonCategory] = count;
    }
  }
  return result;
}

function parseMetadata(value: unknown): CandidateVerificationPublicationEvidenceMetadataSummary {
  if (!isRecord(value)) {
    return { hasDeliveryId: false, hasReviewOutputKey: false, hasCorrelationKey: false };
  }
  return {
    hasDeliveryId: value.hasDeliveryId === true,
    hasReviewOutputKey: value.hasReviewOutputKey === true,
    hasCorrelationKey: value.hasCorrelationKey === true,
  };
}

function parseRedactionFlags(value: unknown): CandidateVerificationPublicationEvidenceRedactionFlags {
  const record = isRecord(value) ? value : {};
  return {
    privateOnly: record.privateOnly !== false,
    candidateBodiesIncluded: record.candidateBodiesIncluded === true,
    specialistProseIncluded: record.specialistProseIncluded === true,
    rawPromptsIncluded: record.rawPromptsIncluded === true,
    rawModelOutputIncluded: record.rawModelOutputIncluded === true,
    diffsIncluded: record.diffsIncluded === true,
    evidencePayloadsIncluded: record.evidencePayloadsIncluded === true,
    rawFingerprintsIncluded: record.rawFingerprintsIncluded === true,
    unsafeInputFieldCount: numberOrZero(record.unsafeInputFieldCount),
    discardedRawPayload: record.discardedRawPayload === true,
    discardedPublicationFields: record.discardedPublicationFields === true,
    discardedEvidencePayloads: record.discardedEvidencePayloads === true,
    candidateAttemptIncluded: record.candidateAttemptIncluded === true,
    candidateKeyIncluded: record.candidateKeyIncluded === true,
    publicationEvidenceIncluded: false,
  };
}

export function parseM070Args(argv: readonly string[]): M070Args {
  let json = false;
  let help = false;
  let scenario: M070ScenarioName | null = null;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--scenario") {
      const value = argv[index + 1];
      if (!M070_SCENARIO_NAMES.includes(value as M070ScenarioName)) {
        throw new Error(`invalid_cli_args: --scenario must be one of ${M070_SCENARIO_NAMES.join(",")}`);
      }
      scenario = value as M070ScenarioName;
      index++;
    } else {
      throw new Error(`invalid_cli_args: unsupported argument ${arg}`);
    }
  }

  return { json, help, scenario };
}

function makeCheck(id: M070CheckId, passed: boolean, statusCode: M070StatusCode, detail: string): M070VerifierCheck {
  return { id, passed, status: passed ? "pass" : "fail", status_code: statusCode, detail };
}

function zeroBoundedAggregate(): M070BoundedAggregateEvidence {
  return {
    aggregateStatus: "malformed",
    counts: null,
    publicationDenialCounts: {},
    reasonCategories: [],
    verificationStateCounts: null,
    candidateVerificationCounts: null,
  };
}

export function evaluateM070VerifierScenario(
  input: M070VerifierScenarioInput,
  options: EvaluateM070VerifierScenarioOptions = {},
): M070VerifierReport {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const source = isRecord(input.aggregateEvidence) ? input.aggregateEvidence : null;
  const rawFieldPresent = hasForbiddenRawField(input.aggregateEvidence);
  const counts = parseCounts(source?.counts);
  const verificationStateCounts = parseVerificationStateCounts(source?.verificationStateCounts);
  const candidateVerificationCounts = parseCandidateVerificationCounts(source?.candidateVerificationCounts);
  const metadata = parseMetadata(source?.metadata);
  const redactionFlags = parseRedactionFlags(source?.redactionFlags);
  const aggregateStatus = typeof source?.aggregateStatus === "string" && ["none", "allowed", "denied", "published", "skipped", "failed", "mixed"].includes(source.aggregateStatus)
    ? source.aggregateStatus as CandidateVerificationPublicationEvidenceSummary["aggregateStatus"]
    : "malformed";
  const aggregateEvidence: M070BoundedAggregateEvidence = source === null
    ? zeroBoundedAggregate()
    : {
      aggregateStatus,
      counts,
      publicationDenialCounts: parsePublicationDenialCounts(source.publicationDenialCounts),
      reasonCategories: parseReasonCategories(source.reasonCategories),
      verificationStateCounts,
      candidateVerificationCounts,
    };

  const issues: string[] = [];
  const issueCategories: string[] = [];
  const redactionLeakPresent = rawFieldPresent
    || redactionFlags.candidateBodiesIncluded
    || redactionFlags.specialistProseIncluded
    || redactionFlags.rawPromptsIncluded
    || redactionFlags.rawModelOutputIncluded
    || redactionFlags.diffsIncluded
    || redactionFlags.evidencePayloadsIncluded
    || redactionFlags.rawFingerprintsIncluded
    || redactionFlags.candidateAttemptIncluded
    || redactionFlags.candidateKeyIncluded;
  const malformed = source === null
    || aggregateStatus === "malformed"
    || counts === null
    || verificationStateCounts === null
    || candidateVerificationCounts === null
    || redactionLeakPresent;
  const missingCorrelation = !metadata.hasDeliveryId || !metadata.hasReviewOutputKey || !metadata.hasCorrelationKey;
  const directFallbackOnly = input.publicationMode.directFallbackEvidence && !input.publicationMode.candidateApprovedNonFallback;
  const deniedReasons = aggregateEvidence.publicationDenialCounts;
  const disputed = (deniedReasons["evidence-conflict"] ?? 0) > 0
    || (deniedReasons["publication-ineligible"] ?? 0) > 0 && (candidateVerificationCounts?.disagreementCount ?? 0) > 0
    || (candidateVerificationCounts?.disagreementCount ?? 0) > 0
    || (candidateVerificationCounts?.disprovenCount ?? 0) > 0
    || aggregateEvidence.reasonCategories.includes("evidence-conflict");
  const unclassifiableOrBlocked = (candidateVerificationCounts?.unclassifiableCount ?? 0) > 0
    || (candidateVerificationCounts?.malformedRecordCount ?? 0) > 0
    || (verificationStateCounts?.unavailable ?? 0) > 0
    || aggregateEvidence.reasonCategories.includes("classifier-fail-closed")
    || aggregateEvidence.reasonCategories.includes("no-evidence");
  const hasPublishedCandidateApproved = input.publicationMode.candidateApprovedNonFallback === true
    && input.publicationMode.directFallbackEvidence === false
    && (counts?.allowed ?? 0) > 0
    && (counts?.published ?? 0) > 0
    && (candidateVerificationCounts?.publicationEligibleCount ?? 0) > 0;
  const verifiedCandidateApproved = hasPublishedCandidateApproved
    && (verificationStateCounts?.verified ?? 0) > 0
    && (candidateVerificationCounts?.verifiedCount ?? 0) > 0;
  const partialCandidateApproved = hasPublishedCandidateApproved
    && (verificationStateCounts?.partially_verified ?? 0) > 0
    && (candidateVerificationCounts?.partiallyVerifiedCount ?? 0) > 0;
  const undisputedPartial = partialCandidateApproved && !disputed && !unclassifiableOrBlocked;

  let statusCode: M070StatusCode;
  if (malformed) {
    statusCode = "m070_malformed_evidence_blocked";
    issues.push("Aggregate evidence is missing or malformed; verifier failed closed without echoing raw payloads.");
    issueCategories.push("malformed-evidence");
  } else if (missingCorrelation) {
    statusCode = "m070_missing_correlation_blocked";
    issues.push("Required deliveryId, reviewOutputKey, and correlationKey metadata booleans must all be present.");
    issueCategories.push("missing-correlation");
  } else if (directFallbackOnly) {
    statusCode = "m070_direct_fallback_only_rejected";
    issues.push("Direct fallback-only evidence is safety behavior, not verifier success proof.");
    issueCategories.push("direct-fallback-only");
  } else if (disputed) {
    statusCode = "m070_dispute_blocked";
    issues.push("Disputed or disproven candidate verification evidence blocks verifier success.");
    issueCategories.push("dispute-blocked");
  } else if (unclassifiableOrBlocked) {
    statusCode = "m070_unclassifiable_blocked";
    issues.push("Unclassifiable, unavailable, or fail-closed evidence blocks verifier success.");
    issueCategories.push("unclassifiable-blocked");
  } else if (verifiedCandidateApproved) {
    statusCode = "m070_candidate_approved_verified_ok";
  } else if (undisputedPartial) {
    statusCode = "m070_candidate_approved_partial_ok";
  } else {
    statusCode = "m070_malformed_evidence_blocked";
    issues.push("Aggregate evidence does not prove candidate-approved non-fallback publication.");
    issueCategories.push("malformed-evidence");
  }

  const success = statusCode === "m070_candidate_approved_verified_ok" || statusCode === "m070_candidate_approved_partial_ok";
  const checks: M070VerifierCheck[] = [
    makeCheck(
      "M070-CANDIDATE-APPROVED-PUBLICATION",
      success || statusCode !== "m070_direct_fallback_only_rejected",
      statusCode,
      success ? "Candidate-approved non-fallback publication evidence accepted." : "Publication proof is not an accepted success state.",
    ),
    makeCheck(
      "M070-CORRELATION-METADATA",
      !missingCorrelation && !malformed,
      statusCode,
      !missingCorrelation && !malformed ? "Required correlation metadata booleans are present." : "Required correlation metadata is missing or unavailable.",
    ),
    makeCheck(
      "M070-SAFETY-BLOCKERS",
      !malformed && !disputed && !unclassifiableOrBlocked,
      statusCode,
      !malformed && !disputed && !unclassifiableOrBlocked ? "No dispute, unclassifiable, or malformed blockers detected." : "Safety blocker detected; verifier failed closed.",
    ),
    makeCheck(
      "M070-REDACTION-BOUNDARY",
      !redactionLeakPresent,
      statusCode,
      !redactionLeakPresent ? "Report remains aggregate-only." : "Forbidden raw input fields or redaction flags were observed and discarded from report output.",
    ),
  ];
  const failingCheck = checks.find((check) => !check.passed) ?? null;

  return {
    command: COMMAND_NAME,
    generated_at: generatedAt,
    proofMode: "local-fixture-pure-evaluator",
    proofScope: "s04-verifier-success-semantics",
    scenario: input.scenario,
    success,
    status_code: statusCode,
    check_ids: M070_SCENARIO_CHECK_IDS,
    checks,
    failing_check_id: failingCheck?.id ?? null,
    publicationMode: { ...input.publicationMode },
    aggregateEvidence,
    correlationMetadata: {
      hasDeliveryId: metadata.hasDeliveryId,
      hasReviewOutputKey: metadata.hasReviewOutputKey,
      hasCorrelationKey: metadata.hasCorrelationKey,
      deliveryIdAvailable: metadata.hasDeliveryId,
      reviewOutputKeyAvailable: metadata.hasReviewOutputKey,
      correlationKeyAvailable: metadata.hasCorrelationKey,
    },
    safety: {
      disputed,
      unclassifiableOrBlocked,
      malformed,
      missingCorrelation,
      directFallbackOnly,
      undisputedPartial,
    },
    redaction: {
      privateOnly: redactionFlags.privateOnly,
      candidateBodiesIncluded: redactionFlags.candidateBodiesIncluded,
      specialistProseIncluded: redactionFlags.specialistProseIncluded,
      rawPromptsIncluded: redactionFlags.rawPromptsIncluded,
      rawModelOutputIncluded: redactionFlags.rawModelOutputIncluded,
      diffsIncluded: redactionFlags.diffsIncluded,
      evidencePayloadsIncluded: redactionFlags.evidencePayloadsIncluded,
      rawFingerprintsIncluded: redactionFlags.rawFingerprintsIncluded,
      publicationEvidenceIncluded: false,
      candidateAttemptIncluded: redactionFlags.candidateAttemptIncluded,
      candidateKeyIncluded: redactionFlags.candidateKeyIncluded,
      unsafeInputFieldCount: redactionFlags.unsafeInputFieldCount,
      discardedRawPayload: redactionFlags.discardedRawPayload || rawFieldPresent,
      discardedPublicationFields: redactionFlags.discardedPublicationFields || rawFieldPresent,
      discardedEvidencePayloads: redactionFlags.discardedEvidencePayloads || rawFieldPresent,
      forbiddenInputFieldPresent: rawFieldPresent,
    },
    issue_categories: issueCategories,
    issues,
  };
}

const BASE_COUNTS: CandidateVerificationPublicationEvidenceCounts = {
  attempted: 1,
  allowed: 1,
  denied: 0,
  published: 1,
  skipped: 0,
  failed: 0,
};

const BASE_VERIFICATION_COUNTS: CandidateVerificationPublicationVerificationStateCounts = {
  verified: 1,
  partially_verified: 0,
  unverified: 0,
  disproven: 0,
  unavailable: 0,
};

const BASE_POLICY_COUNTS: CandidatePublicationPolicyCounts = {
  candidateCount: 1,
  evidenceCount: 1,
  verifiedCount: 1,
  partiallyVerifiedCount: 0,
  unverifiedCount: 0,
  disprovenCount: 0,
  publicationEligibleCount: 1,
  duplicateCount: 0,
  disagreementCount: 0,
  unclassifiableCount: 0,
  malformedRecordCount: 0,
  truncatedCandidateCount: 0,
  truncatedEvidenceCount: 0,
  policyCandidateCount: 1,
};

const BASE_METADATA: CandidateVerificationPublicationEvidenceMetadataSummary = {
  hasDeliveryId: true,
  hasReviewOutputKey: true,
  hasCorrelationKey: true,
};

const BASE_REDACTION: CandidateVerificationPublicationEvidenceRedactionFlags = {
  privateOnly: true,
  candidateBodiesIncluded: false,
  specialistProseIncluded: false,
  rawPromptsIncluded: false,
  rawModelOutputIncluded: false,
  diffsIncluded: false,
  evidencePayloadsIncluded: false,
  rawFingerprintsIncluded: false,
  unsafeInputFieldCount: 0,
  discardedRawPayload: false,
  discardedPublicationFields: false,
  discardedEvidencePayloads: false,
  candidateAttemptIncluded: false,
  candidateKeyIncluded: false,
  publicationEvidenceIncluded: false,
};

function fixtureSummary(overrides: Partial<CandidateVerificationPublicationEvidenceSummary> = {}): CandidateVerificationPublicationEvidenceSummary {
  return {
    aggregateStatus: "mixed",
    counts: { ...BASE_COUNTS, ...overrides.counts },
    publicationDenialCounts: { ...overrides.publicationDenialCounts },
    reasonCategories: [...(overrides.reasonCategories ?? ["full-support"])],
    verificationStateCounts: { ...BASE_VERIFICATION_COUNTS, ...overrides.verificationStateCounts },
    candidateVerificationCounts: { ...BASE_POLICY_COUNTS, ...overrides.candidateVerificationCounts },
    metadata: { ...BASE_METADATA, ...overrides.metadata },
    redactionFlags: { ...BASE_REDACTION, ...overrides.redactionFlags },
  };
}

export function buildM070FixtureScenario(name: M070ScenarioName): M070VerifierScenarioInput {
  switch (name) {
    case "candidate_approved_verified":
      return { scenario: name, aggregateEvidence: fixtureSummary(), publicationMode: { candidateApprovedNonFallback: true, directFallbackEvidence: false } };
    case "candidate_approved_partial_undisputed":
      return {
        scenario: name,
        aggregateEvidence: fixtureSummary({
          reasonCategories: ["partial-support"],
          verificationStateCounts: { verified: 0, partially_verified: 1, unverified: 0, disproven: 0, unavailable: 0 },
          candidateVerificationCounts: { ...BASE_POLICY_COUNTS, verifiedCount: 0, partiallyVerifiedCount: 1 },
        }),
        publicationMode: { candidateApprovedNonFallback: true, directFallbackEvidence: false },
      };
    case "dispute_blocked":
      return {
        scenario: name,
        aggregateEvidence: fixtureSummary({
          counts: { ...BASE_COUNTS, allowed: 0, denied: 1, published: 0 },
          publicationDenialCounts: { "evidence-conflict": 1 },
          reasonCategories: ["evidence-conflict", "publication-ineligible"],
          verificationStateCounts: { verified: 0, partially_verified: 0, unverified: 0, disproven: 1, unavailable: 0 },
          candidateVerificationCounts: { ...BASE_POLICY_COUNTS, verifiedCount: 0, publicationEligibleCount: 0, disagreementCount: 1, disprovenCount: 1 },
        }),
        publicationMode: { candidateApprovedNonFallback: false, directFallbackEvidence: false },
      };
    case "unclassifiable_blocked":
      return {
        scenario: name,
        aggregateEvidence: fixtureSummary({
          counts: { ...BASE_COUNTS, allowed: 0, denied: 1, published: 0 },
          publicationDenialCounts: { "classifier-fail-closed": 1, "publication-ineligible": 1 },
          reasonCategories: ["classifier-fail-closed", "publication-ineligible"],
          verificationStateCounts: { verified: 0, partially_verified: 0, unverified: 0, disproven: 0, unavailable: 1 },
          candidateVerificationCounts: { ...BASE_POLICY_COUNTS, verifiedCount: 0, publicationEligibleCount: 0, unclassifiableCount: 1 },
        }),
        publicationMode: { candidateApprovedNonFallback: false, directFallbackEvidence: false },
      };
    case "missing_correlation":
      return {
        scenario: name,
        aggregateEvidence: fixtureSummary({ metadata: { hasDeliveryId: true, hasReviewOutputKey: false, hasCorrelationKey: true } }),
        publicationMode: { candidateApprovedNonFallback: true, directFallbackEvidence: false },
      };
    case "malformed_evidence":
      return { scenario: name, aggregateEvidence: { aggregateStatus: "wrong-status", counts: null }, publicationMode: { candidateApprovedNonFallback: true, directFallbackEvidence: false } };
    case "direct_fallback_only":
      return { scenario: name, aggregateEvidence: fixtureSummary(), publicationMode: { candidateApprovedNonFallback: false, directFallbackEvidence: true } };
  }
}

const EXPECTED_SCENARIO_STATUSES: Readonly<Record<M070ScenarioName, M070StatusCode>> = {
  candidate_approved_verified: "m070_candidate_approved_verified_ok",
  candidate_approved_partial_undisputed: "m070_candidate_approved_partial_ok",
  dispute_blocked: "m070_dispute_blocked",
  unclassifiable_blocked: "m070_unclassifiable_blocked",
  missing_correlation: "m070_missing_correlation_blocked",
  malformed_evidence: "m070_malformed_evidence_blocked",
  direct_fallback_only: "m070_direct_fallback_only_rejected",
};

const TARGETED_TEST_COMMANDS = [
  "bun test ./scripts/verify-m070.test.ts && bun run verify:m070 --json",
  "bun test ./scripts/verify-m070-s03.test.ts ./src/specialists/candidate-verification-publication-evidence.test.ts ./src/specialists/candidate-publication-policy.test.ts ./src/specialists/candidate-verification.test.ts",
] as const;

export type M070MainDeps = {
  readonly stdout?: Pick<WritableStreamDefaultWriter<string>, "write"> | { write(chunk: string): void };
  readonly stderr?: Pick<WritableStreamDefaultWriter<string>, "write"> | { write(chunk: string): void };
  readonly evaluateScenario?: typeof evaluateM070VerifierScenario;
  readonly evaluateContract?: typeof evaluateM070VerifierContract;
  readonly readPackageJsonText?: () => Promise<string>;
};

function writeLine(writer: { write(chunk: string): void } | undefined, chunk: string): void {
  writer?.write(chunk);
}

function boundedIssue(message: string): string {
  if (message.startsWith("invalid_cli_args:")) return message;
  if (message.includes("package.json")) return message.slice(0, 240);
  return "m070 verifier contract dependency failed.";
}

function parsePackageWiring(packageJsonText: string): M070VerifierContractReport["packageWiring"] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(packageJsonText);
  } catch {
    return { scriptName: COMMAND_NAME, expected: EXPECTED_PACKAGE_SCRIPT, present: false, matches: false };
  }
  const scripts = isRecord(parsed) && isRecord(parsed.scripts) ? parsed.scripts : {};
  const script = scripts[COMMAND_NAME];
  return {
    scriptName: COMMAND_NAME,
    expected: EXPECTED_PACKAGE_SCRIPT,
    present: typeof script === "string",
    matches: script === EXPECTED_PACKAGE_SCRIPT,
  };
}

export async function evaluateM070VerifierContract(options: EvaluateM070VerifierContractOptions = {}): Promise<M070VerifierContractReport> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const evaluate = options.evaluate ?? evaluateM070VerifierScenario;
  const readPackageJsonText = options.readPackageJsonText ?? (() => Bun.file("package.json").text());
  const scenarioReports = M070_SCENARIO_NAMES.map((name) => evaluate(buildM070FixtureScenario(name), { generatedAt }));
  const packageWiring = parsePackageWiring(await readPackageJsonText());
  const issues: string[] = [];
  const issueCategories: string[] = [];

  for (const report of scenarioReports) {
    const expected = EXPECTED_SCENARIO_STATUSES[report.scenario];
    if (report.status_code !== expected) {
      issues.push(`${report.scenario} expected ${expected} but got ${report.status_code}.`);
      issueCategories.push("scenario-status-drift");
    }
  }

  const positiveReports = scenarioReports.filter((report) => report.scenario === "candidate_approved_verified" || report.scenario === "candidate_approved_partial_undisputed");
  const negativeReports = scenarioReports.filter((report) => !positiveReports.includes(report));
  if (!positiveReports.every((report) => report.success)) {
    issues.push("Candidate-approved verified and undisputed partial scenarios must be successful.");
    issueCategories.push("positive-scenario-drift");
  }
  if (!negativeReports.every((report) => !report.success)) {
    issues.push("Expected negative scenarios must be rejected with success:false.");
    issueCategories.push("negative-scenario-drift");
  }
  if (!packageWiring.matches) {
    issues.push(`package.json scripts.${COMMAND_NAME} must equal ${EXPECTED_PACKAGE_SCRIPT}.`);
    issueCategories.push("package-wiring");
  }

  const scenarioMatrixPassed = issues.filter((issue) => !issue.includes("package.json scripts.")).length === 0;
  const checks: M070VerifierCheck[] = [
    makeCheck("M070-FIXTURE-CONTRACT", scenarioMatrixPassed, scenarioMatrixPassed ? "m070_fixture_contract_ok" : "m070_contract_failed", scenarioMatrixPassed ? "All required M070 fixture scenarios have expected success/status semantics." : "Fixture scenario contract drift detected."),
    makeCheck("M070-CANDIDATE-APPROVED-PUBLICATION", positiveReports.every((report) => report.success) && negativeReports.every((report) => !report.success), scenarioMatrixPassed ? "m070_fixture_contract_ok" : "m070_contract_failed", "Candidate-approved success states and fallback/blocker rejection states are distinguished."),
    makeCheck("M070-CORRELATION-METADATA", scenarioReports.find((report) => report.scenario === "missing_correlation")?.status_code === "m070_missing_correlation_blocked", scenarioMatrixPassed ? "m070_fixture_contract_ok" : "m070_contract_failed", "Missing correlation metadata is rejected explicitly."),
    makeCheck("M070-SAFETY-BLOCKERS", ["dispute_blocked", "unclassifiable_blocked", "malformed_evidence"].every((name) => scenarioReports.find((report) => report.scenario === name)?.success === false), scenarioMatrixPassed ? "m070_fixture_contract_ok" : "m070_contract_failed", "Dispute, unclassifiable, and malformed safety blockers fail closed."),
    makeCheck("M070-REDACTION-BOUNDARY", scenarioReports.every((report) => !report.redaction.candidateBodiesIncluded && !report.redaction.specialistProseIncluded && !report.redaction.rawPromptsIncluded && !report.redaction.rawModelOutputIncluded && !report.redaction.diffsIncluded && !report.redaction.evidencePayloadsIncluded && !report.redaction.rawFingerprintsIncluded && !report.redaction.publicationEvidenceIncluded && !report.redaction.candidateAttemptIncluded && !report.redaction.candidateKeyIncluded), scenarioMatrixPassed ? "m070_fixture_contract_ok" : "m070_contract_failed", "Scenario reports remain aggregate-only redaction-boolean output."),
    makeCheck("M070-PACKAGE-WIRING", packageWiring.matches, packageWiring.matches ? "m070_fixture_contract_ok" : "m070_contract_failed", packageWiring.matches ? "package.json exposes verify:m070 as the local fixture verifier." : `package.json scripts.${COMMAND_NAME} must equal ${EXPECTED_PACKAGE_SCRIPT}.`),
  ];
  const failingCheck = checks.find((check) => !check.passed) ?? null;
  const success = failingCheck === null;

  return {
    command: COMMAND_NAME,
    generated_at: generatedAt,
    proofMode: "local-fixture-contract",
    proofScope: "s04-verifier-success-semantics",
    success,
    status_code: success ? "m070_fixture_contract_ok" : "m070_contract_failed",
    check_ids: M070_CHECK_IDS,
    checks,
    failing_check_id: failingCheck?.id ?? null,
    scenarioReports,
    expectedScenarioStatuses: EXPECTED_SCENARIO_STATUSES,
    packageWiring,
    targetedTests: TARGETED_TEST_COMMANDS,
    issue_categories: [...new Set(issueCategories)],
    issues,
  };
}

function helpText(): string {
  return `Usage: bun run verify:m070 [--json] [--scenario ${M070_SCENARIO_NAMES.join("|")}]

Runs the deterministic local M070 fixture contract by default.
Use --scenario to inspect one scenario. Output is aggregate-only and never reads private evidence paths.
`;
}

function renderHuman(report: M070CliReport): string {
  if ("scenarioReports" in report) {
    return [
      `${COMMAND_NAME} ${report.status_code} success=${report.success}`,
      "scenarios:",
      ...report.scenarioReports.map((scenario) => `- ${scenario.scenario}: ${scenario.status_code} success=${scenario.success}`),
      "targeted tests:",
      ...report.targetedTests.map((command) => `- ${command}`),
      ...(report.issues.length > 0 ? ["issues:", ...report.issues.map((issue) => `- ${issue}`)] : []),
      "",
    ].join("\n");
  }
  return `${COMMAND_NAME} ${report.scenario} ${report.status_code} success=${report.success}\n`;
}

function buildInvalidArgReport(issue: string): M070VerifierContractReport {
  const detail = boundedIssue(issue);
  const check = makeCheck("M070-FIXTURE-CONTRACT", false, "m070_invalid_arg", "CLI argument parsing failed.");
  return {
    command: COMMAND_NAME,
    generated_at: new Date().toISOString(),
    proofMode: "local-fixture-contract",
    proofScope: "s04-verifier-success-semantics",
    success: false,
    status_code: "m070_invalid_arg",
    check_ids: M070_CHECK_IDS,
    checks: [check],
    failing_check_id: "M070-FIXTURE-CONTRACT",
    scenarioReports: [],
    expectedScenarioStatuses: EXPECTED_SCENARIO_STATUSES,
    packageWiring: { scriptName: COMMAND_NAME, expected: EXPECTED_PACKAGE_SCRIPT, present: false, matches: false },
    targetedTests: TARGETED_TEST_COMMANDS,
    issue_categories: ["invalid-arg"],
    issues: [detail],
  };
}

export async function main(argv: readonly string[] = process.argv.slice(2), deps: M070MainDeps = {}): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  let args: M070Args;
  try {
    args = parseM070Args(argv);
  } catch (error) {
    const report = buildInvalidArgReport(error instanceof Error ? error.message : String(error));
    writeLine(stdout, `${JSON.stringify(report, null, 2)}\n`);
    writeLine(stderr, `${report.issues[0]}\n`);
    return 2;
  }

  if (args.help) {
    writeLine(stdout, helpText());
    return 0;
  }

  const evaluateScenario = deps.evaluateScenario ?? evaluateM070VerifierScenario;
  const report: M070CliReport = args.scenario === null
    ? await (deps.evaluateContract ?? evaluateM070VerifierContract)({ evaluate: evaluateScenario, readPackageJsonText: deps.readPackageJsonText })
    : evaluateScenario(buildM070FixtureScenario(args.scenario));

  if (args.json) {
    writeLine(stdout, `${JSON.stringify(report, null, 2)}\n`);
  } else {
    writeLine(stdout, renderHuman(report));
  }

  if (!report.success) {
    writeLine(stderr, `${COMMAND_NAME} failed: ${report.failing_check_id ?? "unknown"}\n`);
  }
  return report.success ? 0 : 1;
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
