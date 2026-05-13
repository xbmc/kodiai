import {
  classifyCandidateVerification,
  type CandidateVerificationClassifierInput,
  type CandidateVerificationCounts,
  type CandidateVerificationFailClosedStatus,
  type CandidateVerificationReasonCategory,
  type CandidateVerificationResult,
  type CandidateVerificationState,
} from "../src/specialists/candidate-verification.ts";

export const COMMAND_NAME = "verify:m070:s01" as const;
export const EXPECTED_PACKAGE_SCRIPT = "bun scripts/verify-m070-s01.ts" as const;

export const M070_S01_CHECK_IDS = [
  "M070-S01-TAXONOMY-CONTRACT",
  "M070-S01-CONFLICT-CONTRACT",
  "M070-S01-FAIL-CLOSED-CONTRACT",
  "M070-S01-PRIVACY-CONTRACT",
  "M070-S01-PACKAGE-WIRING",
] as const;

export type M070S01CheckId = (typeof M070_S01_CHECK_IDS)[number];
export type M070S01StatusCode = "m070_s01_ok" | "m070_s01_contract_failed" | "m070_s01_invalid_arg";
export type M070S01CheckStatus = "pass" | "fail";
export type M070S01CheckStatusCode =
  | "taxonomy_contract_ok"
  | "taxonomy_contract_failed"
  | "conflict_contract_ok"
  | "conflict_contract_failed"
  | "fail_closed_contract_ok"
  | "fail_closed_contract_failed"
  | "privacy_contract_ok"
  | "privacy_contract_failed"
  | "package_wiring_ok"
  | "package_wiring_failed";

export type M070S01Check = {
  readonly id: M070S01CheckId;
  readonly passed: boolean;
  readonly status: M070S01CheckStatus;
  readonly status_code: M070S01CheckStatusCode;
  readonly detail: string;
};

export type M070S01Args = {
  readonly json: boolean;
  readonly help: boolean;
};

export type M070S01FixtureName =
  | "verified"
  | "partially_verified"
  | "unverified"
  | "disproven"
  | "duplicate"
  | "disagreement"
  | "unclassifiable"
  | "malformed"
  | "privacy";

export type M070S01FixtureSummary = {
  readonly fixture: M070S01FixtureName;
  readonly status: CandidateVerificationFailClosedStatus;
  readonly stateCounts: M070S01StateCounts;
  readonly candidateCount: number;
  readonly evidenceCount: number;
  readonly duplicateCount: number;
  readonly disagreementCount: number;
  readonly unclassifiableCount: number;
  readonly malformedRecordCount: number;
  readonly deniedPublicationCount: number;
  readonly reasonCategories: readonly CandidateVerificationReasonCategory[];
  readonly hasDeliveryId: boolean;
  readonly hasReviewOutputKey: boolean;
  readonly hasCorrelationKey: boolean;
  readonly privateOnly: true;
  readonly publishesFindings: false;
};

export type M070S01StateCounts = {
  readonly verified: number;
  readonly partially_verified: number;
  readonly unverified: number;
  readonly disproven: number;
};

export type M070S01AggregateSummary = {
  readonly fixtureCount: number;
  readonly statusCounts: Record<CandidateVerificationFailClosedStatus, number>;
  readonly stateCounts: M070S01StateCounts;
  readonly duplicateCount: number;
  readonly disagreementCount: number;
  readonly unclassifiableCount: number;
  readonly malformedRecordCount: number;
  readonly deniedPublicationCount: number;
  readonly reasonCategories: readonly CandidateVerificationReasonCategory[];
  readonly allDeliveryIdsPresent: boolean;
  readonly allReviewOutputKeysPresent: boolean;
  readonly allCorrelationKeysPresent: boolean;
  readonly privateOnly: true;
  readonly publishesFindings: false;
};

export type M070S01Report = {
  readonly command: typeof COMMAND_NAME;
  readonly generated_at: string;
  readonly success: boolean;
  readonly status_code: M070S01StatusCode;
  readonly check_ids: readonly M070S01CheckId[];
  readonly checks: readonly M070S01Check[];
  readonly failing_check_id: M070S01CheckId | null;
  readonly fixtureSummaries: readonly M070S01FixtureSummary[];
  readonly summary: M070S01AggregateSummary;
  readonly redaction: {
    readonly unsafeInputFieldCount: number;
    readonly discardedRawPayload: boolean;
    readonly discardedPublicationFields: boolean;
    readonly discardedEvidencePayloads: boolean;
    readonly candidateBodiesIncluded: false;
    readonly specialistProseIncluded: false;
    readonly rawPromptsIncluded: false;
    readonly rawModelOutputIncluded: false;
    readonly diffsIncluded: false;
    readonly evidencePayloadsIncluded: false;
    readonly rawFingerprintsIncluded: false;
  };
  readonly issues: readonly string[];
};

export type EvaluateM070S01Options = {
  readonly generatedAt?: string;
  readonly classify?: (input: CandidateVerificationClassifierInput | null | undefined) => CandidateVerificationResult;
  readonly readPackageJsonText?: () => Promise<string>;
};

type NamedFixture = {
  readonly name: M070S01FixtureName;
  readonly input: CandidateVerificationClassifierInput | null;
};

const FIXTURES: readonly NamedFixture[] = [
  {
    name: "verified",
    input: {
      normalReview: {
        deliveryId: "delivery-verified",
        reviewOutputKey: "review-output-verified",
        correlationKey: "corr-verified",
        candidates: [{ candidateKey: "verified-key", body: "RAW_CANDIDATE_BODY_SHOULD_NOT_LEAK" }],
      },
      docsConfigTruth: {
        evidence: [{ candidateKey: "verified-key", decision: "verified", specialistProse: "SPECIALIST_PROSE_SHOULD_NOT_LEAK" }],
      },
    },
  },
  {
    name: "partially_verified",
    input: {
      normalReview: {
        deliveryId: "delivery-partial",
        reviewOutputKey: "review-output-partial",
        correlationKey: "corr-partial",
        candidates: [{ candidateKey: "partial-key" }],
      },
      docsConfigTruth: {
        evidence: [{ candidateKey: "partial-key", decision: "partial" }],
      },
    },
  },
  {
    name: "unverified",
    input: {
      normalReview: {
        deliveryId: "delivery-unverified",
        reviewOutputKey: "review-output-unverified",
        correlationKey: "corr-unverified",
        candidates: [{ candidateKey: "unverified-key" }],
      },
      docsConfigTruth: {
        evidence: [{ candidateKey: "unverified-key", decision: "unverified" }],
      },
    },
  },
  {
    name: "disproven",
    input: {
      normalReview: {
        deliveryId: "delivery-disproven",
        reviewOutputKey: "review-output-disproven",
        correlationKey: "corr-disproven",
        candidates: [{ candidateKey: "disproven-key" }],
      },
      docsConfigTruth: {
        evidence: [{ candidateKey: "disproven-key", decision: "disproven" }],
      },
    },
  },
  {
    name: "duplicate",
    input: {
      normalReview: {
        deliveryId: "delivery-duplicate",
        reviewOutputKey: "review-output-duplicate",
        correlationKey: "corr-duplicate",
        candidates: [{ candidateKey: "duplicate-key" }, { candidateKey: "duplicate-key" }],
      },
      docsConfigTruth: {
        evidence: [{ candidateKey: "duplicate-key", decision: "verified", evidenceId: "dupe-e1" }],
      },
    },
  },
  {
    name: "disagreement",
    input: {
      normalReview: {
        deliveryId: "delivery-disagreement",
        reviewOutputKey: "review-output-disagreement",
        correlationKey: "corr-disagreement",
        candidates: [{ candidateKey: "disagreement-key" }],
      },
      docsConfigTruth: {
        evidence: [
          { candidateKey: "disagreement-key", decision: "verified", evidenceId: "agree-e1" },
          { candidateKey: "disagreement-key", decision: "disagreement", evidenceId: "disagree-e2" },
        ],
      },
    },
  },
  {
    name: "unclassifiable",
    input: {
      normalReview: {
        deliveryId: "delivery-unclassifiable",
        reviewOutputKey: "review-output-unclassifiable",
        correlationKey: "corr-unclassifiable",
        candidates: [{ candidateKey: "unclassifiable-key" }],
      },
      docsConfigTruth: {
        evidence: [{ candidateKey: "unclassifiable-key", decision: "ambiguous" }],
      },
    },
  },
  {
    name: "malformed",
    input: null,
  },
  {
    name: "privacy",
    input: {
      normalReview: {
        deliveryId: "delivery-privacy",
        reviewOutputKey: "review-output-privacy",
        correlationKey: "corr-privacy",
        prompt: "RAW_PROMPT_SHOULD_NOT_LEAK",
        toolPayload: { content: "TOOL_PAYLOAD_SHOULD_NOT_LEAK" },
        candidates: [{ fingerprint: "RAW_FINGERPRINT_SHOULD_NOT_LEAK", commentBody: "COMMENT_BODY_SHOULD_NOT_LEAK" }],
      },
      docsConfigTruth: {
        evidence: [{ fingerprint: "RAW_EVIDENCE_FINGERPRINT_SHOULD_NOT_LEAK", decision: "verified", diff: "DIFF_SHOULD_NOT_LEAK", payload: "EVIDENCE_PAYLOAD_SHOULD_NOT_LEAK" }],
      },
    },
  },
] as const;

const REDACTION_SENTINELS = [
  "RAW_CANDIDATE_BODY_SHOULD_NOT_LEAK",
  "SPECIALIST_PROSE_SHOULD_NOT_LEAK",
  "RAW_PROMPT_SHOULD_NOT_LEAK",
  "TOOL_PAYLOAD_SHOULD_NOT_LEAK",
  "RAW_FINGERPRINT_SHOULD_NOT_LEAK",
  "COMMENT_BODY_SHOULD_NOT_LEAK",
  "RAW_EVIDENCE_FINGERPRINT_SHOULD_NOT_LEAK",
  "DIFF_SHOULD_NOT_LEAK",
  "EVIDENCE_PAYLOAD_SHOULD_NOT_LEAK",
] as const;

export function parseM070S01Args(args: readonly string[]): M070S01Args {
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

export async function evaluateM070S01Contract(options: EvaluateM070S01Options = {}): Promise<M070S01Report> {
  const classifyFn = options.classify ?? classifyCandidateVerification;
  const readPackageJsonText = options.readPackageJsonText ?? (() => Bun.file("package.json").text());
  const results = FIXTURES.map((fixture) => ({ fixture: fixture.name, result: classifyFn(fixture.input) }));
  const fixtureSummaries = results.map(({ fixture, result }) => summarizeFixture(fixture, result));
  const summary = summarizeAll(fixtureSummaries);
  const privacyResult = results.find((entry) => entry.fixture === "privacy")?.result ?? classifyCandidateVerification(null);
  const redaction = summarizeRedaction(privacyResult);
  const packageJsonText = await readPackageJsonText();

  const reportWithoutChecks = {
    command: COMMAND_NAME,
    generated_at: options.generatedAt ?? new Date().toISOString(),
    success: false,
    status_code: "m070_s01_contract_failed" as M070S01StatusCode,
    check_ids: [...M070_S01_CHECK_IDS],
    checks: [] as readonly M070S01Check[],
    failing_check_id: null as M070S01CheckId | null,
    fixtureSummaries,
    summary,
    redaction,
    issues: [] as readonly string[],
  } satisfies M070S01Report;

  const checks = [
    buildTaxonomyCheck(fixtureSummaries),
    buildConflictCheck(fixtureSummaries),
    buildFailClosedCheck(fixtureSummaries),
    buildPrivacyCheck(reportWithoutChecks, privacyResult),
    buildPackageWiringCheck(packageJsonText),
  ];
  const issues = checks.filter((check) => !check.passed).map((check) => check.detail);
  const failingCheck = checks.find((check) => !check.passed) ?? null;

  return {
    ...reportWithoutChecks,
    success: issues.length === 0,
    status_code: issues.length === 0 ? "m070_s01_ok" : "m070_s01_contract_failed",
    checks,
    failing_check_id: failingCheck?.id ?? null,
    issues,
  };
}

function summarizeFixture(fixture: M070S01FixtureName, result: CandidateVerificationResult): M070S01FixtureSummary {
  return {
    fixture,
    status: result.status,
    stateCounts: stateCounts(result.counts),
    candidateCount: result.counts.candidateCount,
    evidenceCount: result.counts.evidenceCount,
    duplicateCount: result.counts.duplicateCount,
    disagreementCount: result.counts.disagreementCount,
    unclassifiableCount: result.counts.unclassifiableCount,
    malformedRecordCount: result.counts.malformedRecordCount,
    deniedPublicationCount: result.counts.candidateCount - result.counts.publicationEligibleCount,
    reasonCategories: [...result.reasonCategories].sort(),
    hasDeliveryId: result.hasDeliveryId,
    hasReviewOutputKey: result.hasReviewOutputKey,
    hasCorrelationKey: result.hasCorrelationKey,
    privateOnly: result.privateOnly,
    publishesFindings: result.publishesFindings,
  };
}

function stateCounts(counts: CandidateVerificationCounts): M070S01StateCounts {
  return {
    verified: counts.verifiedCount,
    partially_verified: counts.partiallyVerifiedCount,
    unverified: counts.unverifiedCount,
    disproven: counts.disprovenCount,
  };
}

function summarizeAll(summaries: readonly M070S01FixtureSummary[]): M070S01AggregateSummary {
  const reasonCategories: CandidateVerificationReasonCategory[] = [];
  const totals: M070S01AggregateSummary = {
    fixtureCount: summaries.length,
    statusCounts: {
      pass: summaries.filter((summary) => summary.status === "pass").length,
      fail_closed: summaries.filter((summary) => summary.status === "fail_closed").length,
    },
    stateCounts: {
      verified: sum(summaries, (summary) => summary.stateCounts.verified),
      partially_verified: sum(summaries, (summary) => summary.stateCounts.partially_verified),
      unverified: sum(summaries, (summary) => summary.stateCounts.unverified),
      disproven: sum(summaries, (summary) => summary.stateCounts.disproven),
    },
    duplicateCount: sum(summaries, (summary) => summary.duplicateCount),
    disagreementCount: sum(summaries, (summary) => summary.disagreementCount),
    unclassifiableCount: sum(summaries, (summary) => summary.unclassifiableCount),
    malformedRecordCount: sum(summaries, (summary) => summary.malformedRecordCount),
    deniedPublicationCount: sum(summaries, (summary) => summary.deniedPublicationCount),
    reasonCategories,
    allDeliveryIdsPresent: summaries.filter((summary) => summary.candidateCount > 0).every((summary) => summary.hasDeliveryId),
    allReviewOutputKeysPresent: summaries.filter((summary) => summary.candidateCount > 0).every((summary) => summary.hasReviewOutputKey),
    allCorrelationKeysPresent: summaries.filter((summary) => summary.candidateCount > 0).every((summary) => summary.hasCorrelationKey),
    privateOnly: true,
    publishesFindings: false,
  };

  for (const summary of summaries) {
    for (const reason of summary.reasonCategories) {
      if (!reasonCategories.includes(reason)) {
        reasonCategories.push(reason);
      }
    }
  }
  reasonCategories.sort();
  return totals;
}

function summarizeRedaction(result: CandidateVerificationResult): M070S01Report["redaction"] {
  return {
    unsafeInputFieldCount: result.redactionFlags.unsafeInputFieldCount,
    discardedRawPayload: result.redactionFlags.discardedRawPayload,
    discardedPublicationFields: result.redactionFlags.discardedPublicationFields,
    discardedEvidencePayloads: result.redactionFlags.discardedEvidencePayloads,
    candidateBodiesIncluded: result.redactionFlags.candidateBodiesIncluded,
    specialistProseIncluded: result.redactionFlags.specialistProseIncluded,
    rawPromptsIncluded: result.redactionFlags.rawPromptsIncluded,
    rawModelOutputIncluded: result.redactionFlags.rawModelOutputIncluded,
    diffsIncluded: result.redactionFlags.diffsIncluded,
    evidencePayloadsIncluded: result.redactionFlags.evidencePayloadsIncluded,
    rawFingerprintsIncluded: result.redactionFlags.rawFingerprintsIncluded,
  };
}

function buildTaxonomyCheck(summaries: readonly M070S01FixtureSummary[]): M070S01Check {
  const failures: string[] = [];
  expectFixtureState(summaries, "verified", "verified", failures);
  expectFixtureState(summaries, "partially_verified", "partially_verified", failures);
  expectFixtureState(summaries, "unverified", "unverified", failures);
  expectFixtureState(summaries, "disproven", "disproven", failures);
  if (summaries.length !== FIXTURES.length) failures.push("Expected every synthetic fixture to be evaluated exactly once.");

  return makeCheck({
    id: "M070-S01-TAXONOMY-CONTRACT",
    okCode: "taxonomy_contract_ok",
    failCode: "taxonomy_contract_failed",
    okDetail: "Classifier fixtures cover verified, partially verified, unverified, and disproven aggregate states.",
    failures,
  });
}

function buildConflictCheck(summaries: readonly M070S01FixtureSummary[]): M070S01Check {
  const failures: string[] = [];
  expectAtLeast(summaries, "duplicate", "duplicateCount", 1, failures);
  expectAtLeast(summaries, "disagreement", "disagreementCount", 1, failures);
  expectAtLeast(summaries, "unclassifiable", "unclassifiableCount", 1, failures);
  expectAtLeast(summaries, "malformed", "malformedRecordCount", 1, failures);
  expectFixtureStatus(summaries, "duplicate", "fail_closed", failures);
  expectFixtureStatus(summaries, "disagreement", "fail_closed", failures);
  expectFixtureStatus(summaries, "unclassifiable", "fail_closed", failures);

  return makeCheck({
    id: "M070-S01-CONFLICT-CONTRACT",
    okCode: "conflict_contract_ok",
    failCode: "conflict_contract_failed",
    okDetail: "Duplicate, disagreement, unclassifiable, and malformed evidence produce bounded conflict counts.",
    failures,
  });
}

function buildFailClosedCheck(summaries: readonly M070S01FixtureSummary[]): M070S01Check {
  const failures: string[] = [];
  expectFixtureStatus(summaries, "verified", "pass", failures);
  expectFixtureStatus(summaries, "partially_verified", "pass", failures);
  for (const fixture of ["unverified", "disproven", "duplicate", "disagreement", "unclassifiable", "malformed", "privacy"] as const) {
    expectFixtureStatus(summaries, fixture, "fail_closed", failures);
  }
  const deniedPublicationCount = sum(summaries, (summary) => summary.deniedPublicationCount);
  if (deniedPublicationCount < 6) failures.push("Expected denied-publication count to include all unsafe or unsupported fixtures.");

  return makeCheck({
    id: "M070-S01-FAIL-CLOSED-CONTRACT",
    okCode: "fail_closed_contract_ok",
    failCode: "fail_closed_contract_failed",
    okDetail: "Unsafe, unsupported, malformed, duplicate, and conflicting aggregates fail closed with denied-publication counts.",
    failures,
  });
}

function buildPrivacyCheck(report: M070S01Report, privacyResult: CandidateVerificationResult): M070S01Check {
  const failures: string[] = [];
  const serialized = JSON.stringify(report);
  for (const sentinel of REDACTION_SENTINELS) {
    if (serialized.includes(sentinel)) {
      failures.push("Serialized report leaked raw synthetic input content.");
      break;
    }
  }
  if (!privacyResult.redactionFlags.discardedRawPayload) failures.push("Expected raw payload fields to be discarded.");
  if (!privacyResult.redactionFlags.discardedPublicationFields) failures.push("Expected publication-looking fields to be discarded.");
  if (!privacyResult.redactionFlags.discardedEvidencePayloads) failures.push("Expected evidence payload fields to be discarded.");
  if (privacyResult.redactionFlags.unsafeInputFieldCount < 5) failures.push("Expected unsafe input fields to be counted without emitting their contents.");
  if (!report.summary.allDeliveryIdsPresent || !report.summary.allReviewOutputKeysPresent || !report.summary.allCorrelationKeysPresent) {
    failures.push("Expected positive fixture aggregates to expose only key/correlation presence booleans.");
  }
  if (report.summary.privateOnly !== true || report.summary.publishesFindings !== false) {
    failures.push("Expected verifier summary to remain private-only and non-publishing.");
  }

  return makeCheck({
    id: "M070-S01-PRIVACY-CONTRACT",
    okCode: "privacy_contract_ok",
    failCode: "privacy_contract_failed",
    okDetail: "Verifier emits aggregate-only JSON with redaction flags and no raw candidate, specialist, prompt, diff, fingerprint, or evidence content.",
    failures,
  });
}

function buildPackageWiringCheck(packageJsonText: string): M070S01Check {
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
    id: "M070-S01-PACKAGE-WIRING",
    okCode: "package_wiring_ok",
    failCode: "package_wiring_failed",
    okDetail: "package.json exposes verify:m070:s01 as the local pure classifier verifier.",
    failures,
  });
}

function expectFixtureState(
  summaries: readonly M070S01FixtureSummary[],
  fixture: M070S01FixtureName,
  state: CandidateVerificationState,
  failures: string[],
): void {
  const summary = summaries.find((entry) => entry.fixture === fixture);
  if (!summary) {
    failures.push(`Missing ${fixture} fixture summary.`);
    return;
  }
  if (summary.stateCounts[state] !== 1) {
    failures.push(`Expected ${fixture} fixture to produce exactly one ${state} candidate.`);
  }
}

function expectFixtureStatus(
  summaries: readonly M070S01FixtureSummary[],
  fixture: M070S01FixtureName,
  status: CandidateVerificationFailClosedStatus,
  failures: string[],
): void {
  const summary = summaries.find((entry) => entry.fixture === fixture);
  if (!summary) {
    failures.push(`Missing ${fixture} fixture summary.`);
    return;
  }
  if (summary.status !== status) {
    failures.push(`Expected ${fixture} fixture status to be ${status}.`);
  }
}

function expectAtLeast(
  summaries: readonly M070S01FixtureSummary[],
  fixture: M070S01FixtureName,
  field: "duplicateCount" | "disagreementCount" | "unclassifiableCount" | "malformedRecordCount",
  minimum: number,
  failures: string[],
): void {
  const summary = summaries.find((entry) => entry.fixture === fixture);
  if (!summary) {
    failures.push(`Missing ${fixture} fixture summary.`);
    return;
  }
  if (summary[field] < minimum) {
    failures.push(`Expected ${fixture} fixture ${field} to be at least ${minimum}.`);
  }
}

function makeCheck(params: {
  id: M070S01CheckId;
  okCode: M070S01CheckStatusCode;
  failCode: M070S01CheckStatusCode;
  okDetail: string;
  failures: readonly string[];
}): M070S01Check {
  const passed = params.failures.length === 0;
  return {
    id: params.id,
    passed,
    status: passed ? "pass" : "fail",
    status_code: passed ? params.okCode : params.failCode,
    detail: passed ? params.okDetail : params.failures.join(" "),
  };
}

function sum<T>(values: readonly T[], read: (value: T) => number): number {
  return values.reduce((total, value) => total + read(value), 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function renderM070S01Report(report: M070S01Report): string {
  return [
    "M070 S01 candidate verification classifier verifier",
    `status: ${report.status_code}`,
    `success: ${report.success ? "yes" : "no"}`,
    "",
    "checks:",
    ...report.checks.map((check) => `- [${check.passed ? "x" : " "}] ${check.id}: ${check.detail}`),
    "",
    "summary:",
    `- fixtures: ${report.summary.fixtureCount}`,
    `- verified: ${report.summary.stateCounts.verified}`,
    `- partially_verified: ${report.summary.stateCounts.partially_verified}`,
    `- unverified: ${report.summary.stateCounts.unverified}`,
    `- disproven: ${report.summary.stateCounts.disproven}`,
    `- duplicate_count: ${report.summary.duplicateCount}`,
    `- disagreement_count: ${report.summary.disagreementCount}`,
    `- unclassifiable_count: ${report.summary.unclassifiableCount}`,
    `- denied_publication_count: ${report.summary.deniedPublicationCount}`,
    ...(report.issues.length > 0 ? ["", "issues:", ...report.issues.map((issue) => `- ${issue}`)] : []),
    "",
  ].join("\n");
}

export function renderHelp(): string {
  return [
    "M070 S01 candidate verification classifier verifier",
    "",
    "Usage:",
    "  bun run verify:m070:s01 [--json]",
    "",
    "Notes:",
    "  - Uses synthetic in-memory fixtures plus package.json wiring only.",
    "  - Does not read .gsd, .planning, .audits, .env, GitHub, Azure, DB, or credentials.",
    "  - Emits aggregate states, conflict counts, bounded reason categories, and key-presence booleans only.",
    "  - Does not emit raw candidate bodies, specialist prose, prompts, diffs, fingerprints, model/tool payloads, or evidence payloads.",
    "",
  ].join("\n");
}

export async function main(
  args: readonly string[] = process.argv.slice(2),
  io?: {
    stdout?: { write: (chunk: string) => void };
    stderr?: { write: (chunk: string) => void };
    evaluate?: typeof evaluateM070S01Contract;
  },
): Promise<number> {
  const stdout = io?.stdout ?? process.stdout;
  const stderr = io?.stderr ?? process.stderr;
  const evaluate = io?.evaluate ?? evaluateM070S01Contract;

  let parsed: M070S01Args;
  try {
    parsed = parseM070S01Args(args);
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
    stdout.write(renderM070S01Report(report));
  }

  if (!report.success) {
    stderr.write(`${COMMAND_NAME} failed: ${report.failing_check_id ?? "unknown"}\n`);
  }

  return report.success ? 0 : 1;
}

function buildInvalidArgReport(issue: string): M070S01Report {
  return {
    command: COMMAND_NAME,
    generated_at: new Date().toISOString(),
    success: false,
    status_code: "m070_s01_invalid_arg",
    check_ids: [...M070_S01_CHECK_IDS],
    checks: [],
    failing_check_id: null,
    fixtureSummaries: [],
    summary: {
      fixtureCount: 0,
      statusCounts: { pass: 0, fail_closed: 0 },
      stateCounts: { verified: 0, partially_verified: 0, unverified: 0, disproven: 0 },
      duplicateCount: 0,
      disagreementCount: 0,
      unclassifiableCount: 0,
      malformedRecordCount: 0,
      deniedPublicationCount: 0,
      reasonCategories: [],
      allDeliveryIdsPresent: false,
      allReviewOutputKeysPresent: false,
      allCorrelationKeysPresent: false,
      privateOnly: true,
      publishesFindings: false,
    },
    redaction: {
      unsafeInputFieldCount: 0,
      discardedRawPayload: false,
      discardedPublicationFields: false,
      discardedEvidencePayloads: false,
      candidateBodiesIncluded: false,
      specialistProseIncluded: false,
      rawPromptsIncluded: false,
      rawModelOutputIncluded: false,
      diffsIncluded: false,
      evidencePayloadsIncluded: false,
      rawFingerprintsIncluded: false,
    },
    issues: [issue],
  };
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
