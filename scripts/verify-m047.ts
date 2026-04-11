import {
  evaluateM047S02,
  type EvaluationReport as M047S02EvaluationReport,
} from "./verify-m047-s02.ts";
import {
  evaluateM045S03,
  type EvaluationReport as M045S03EvaluationReport,
} from "./verify-m045-s03.ts";
import {
  evaluateM046,
  type EvaluationReport as M046EvaluationReport,
} from "./verify-m046.ts";

const COMMAND_NAME = "verify:m047" as const;

export const M047_CHECK_IDS = [
  "M047-S03-S02-REPORT-COMPOSED",
  "M047-S03-M045-REPORT-COMPOSED",
  "M047-S03-M046-REPORT-COMPOSED",
  "M047-S03-MILESTONE-SCENARIOS",
] as const;

export const M047_SCENARIO_IDS = [
  "linked-unscored",
  "calibrated-retained",
  "stale-degraded",
  "opt-out",
  "coarse-fallback",
] as const;

export type M047CheckId = (typeof M047_CHECK_IDS)[number];
export type MilestoneScenarioId = (typeof M047_SCENARIO_IDS)[number];

type RuntimeScenario = NonNullable<M047S02EvaluationReport["storedProfileRuntime"]>["scenarios"][number];
type DownstreamScenario = M047S02EvaluationReport["scenarios"][number];
type RetrievalScenario = M045S03EvaluationReport["retrieval"]["scenarios"][number];
type CalibrationRow = NonNullable<
  NonNullable<NonNullable<M046EvaluationReport["calibration"]>["calibration"]>
>["rows"][number];

type StdWriter = {
  write: (chunk: string) => boolean | void;
};

type ValidationResult<T> = {
  report: T | null;
  problem: string | null;
};

export type Check = {
  id: M047CheckId;
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail?: string;
};

export type ReviewRuntimeEvidence = {
  passed: boolean;
  statusCode: string;
  detail?: string;
  source: "m047-s01";
  sourceScenarioId: string;
  trustState: string | null;
  contractState: string | null;
  contractSource: string | null;
  fallbackPath: string | null;
  degradationPath: string | null;
  promptStatusCode: string;
  reviewDetailsStatusCode: string;
};

export type RetrievalEvidence = {
  passed: boolean;
  statusCode: string;
  detail?: string;
  source: "m047-s02" | "m045-s03";
  sourceScenarioId: string;
  multiQueryStatusCode: string;
  legacyQueryStatusCode: string;
  multiQuery: string;
  legacyQuery: string;
};

export type SlackProfileEvidence = {
  applicable: boolean;
  passed: boolean;
  statusCode: string;
  detail?: string;
  source: "m047-s02" | null;
  sourceScenarioId: string | null;
  profileStatusCode: string | null;
  continuityStatusCode: string | null;
  optInStatusCode: string | null;
};

export type IdentityEvidence = {
  applicable: boolean;
  passed: boolean;
  statusCode: string;
  detail?: string;
  source: "m047-s02" | "m045-s03" | null;
  sourceScenarioId: string | null;
};

export type ContributorModelEvidence = {
  applicable: boolean;
  passed: boolean;
  statusCode: string;
  detail?: string;
  source: "m046" | null;
  contributorNormalizedId: string | null;
  verdict: "keep" | "retune" | "replace" | null;
  changeContractVerdict: "keep" | "retune" | "replace" | null;
  liveContractState: string | null;
  livePromptTier: string | null;
  intendedContractState: string | null;
  intendedPromptTier: string | null;
  freshnessBand: string | null;
  linkedProfileState: string | null;
};

export type MilestoneScenarioReport = {
  scenarioId: MilestoneScenarioId;
  description: string;
  passed: boolean;
  statusCode: string;
  detail?: string;
  reviewRuntime: ReviewRuntimeEvidence;
  retrieval: RetrievalEvidence;
  slackProfile: SlackProfileEvidence;
  identity: IdentityEvidence;
  contributorModel: ContributorModelEvidence;
};

export type EvaluationReport = {
  command: typeof COMMAND_NAME;
  generatedAt: string;
  check_ids: readonly M047CheckId[];
  overallPassed: boolean;
  scenarios: MilestoneScenarioReport[];
  m047S02: M047S02EvaluationReport | null;
  m045S03: M045S03EvaluationReport | null;
  m046: M046EvaluationReport | null;
  checks: Check[];
};

export type EvaluateM047Options = {
  generatedAt?: string;
  referenceTime?: string | Date;
  _evaluateM047S02?: (options?: Record<string, unknown>) => Promise<unknown>;
  _evaluateM045S03?: (options?: Record<string, unknown>) => Promise<unknown>;
  _evaluateM046?: (options?: Record<string, unknown>) => Promise<unknown>;
};

type BuildProofHarnessOptions = EvaluateM047Options & {
  json?: boolean;
  stdout?: StdWriter;
  stderr?: StdWriter;
};

function toStatusPrefix(value: string): string {
  return value.replace(/-/g, "_");
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isNamedCheckArray(value: unknown): value is Array<{
  id: string;
  passed: boolean;
  skipped: boolean;
  status_code: string;
}> {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.id === "string" &&
        typeof entry.passed === "boolean" &&
        typeof entry.skipped === "boolean" &&
        typeof entry.status_code === "string",
    )
  );
}

function readScenarioCheckStatusCode(value: unknown): string | null {
  if (!isRecord(value) || !isRecord(value.check) || typeof value.check.statusCode !== "string") {
    return null;
  }
  return value.check.statusCode;
}

function isRuntimeScenarioArray(value: unknown): value is RuntimeScenario[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.scenarioId === "string" &&
        readScenarioCheckStatusCode(entry) !== null,
    )
  );
}

function isDownstreamScenarioArray(value: unknown): value is DownstreamScenario[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => {
      if (!isRecord(entry) || typeof entry.scenarioId !== "string") {
        return false;
      }

      return (
        isRecord(entry.profile) &&
        typeof entry.profile.statusCode === "string" &&
        isRecord(entry.optInContinuity) &&
        typeof entry.optInContinuity.statusCode === "string" &&
        isRecord(entry.retrievalMultiQuery) &&
        typeof entry.retrievalMultiQuery.statusCode === "string" &&
        typeof entry.retrievalMultiQuery.query === "string" &&
        isRecord(entry.retrievalLegacyQuery) &&
        typeof entry.retrievalLegacyQuery.statusCode === "string" &&
        typeof entry.retrievalLegacyQuery.query === "string" &&
        (entry.linkContinuity === null ||
          (isRecord(entry.linkContinuity) && typeof entry.linkContinuity.statusCode === "string")) &&
        (entry.identitySuppression === null ||
          (isRecord(entry.identitySuppression) && typeof entry.identitySuppression.statusCode === "string"))
      );
    })
  );
}

function isRuntimeReport(value: unknown): value is NonNullable<M047S02EvaluationReport["storedProfileRuntime"]> {
  return (
    isRecord(value) &&
    value.command === "verify:m047:s01" &&
    typeof value.overallPassed === "boolean" &&
    isRuntimeScenarioArray(value.scenarios) &&
    isNamedCheckArray(value.checks)
  );
}

function isRetrievalScenarioArray(value: unknown): value is RetrievalScenario[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.scenarioId === "string" &&
        isRecord(entry.multiQuery) &&
        typeof entry.multiQuery.statusCode === "string" &&
        typeof entry.multiQuery.query === "string" &&
        isRecord(entry.legacyQuery) &&
        typeof entry.legacyQuery.statusCode === "string" &&
        typeof entry.legacyQuery.query === "string",
    )
  );
}

function isSlackScenarioArray(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.scenarioId === "string" &&
        typeof entry.statusCode === "string" &&
        typeof entry.text === "string",
    )
  );
}

function isIdentityScenarioArray(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.scenarioId === "string" &&
        typeof entry.statusCode === "string" &&
        typeof entry.warningLogged === "boolean" &&
        (entry.dmText === null || typeof entry.dmText === "string"),
    )
  );
}

function isCalibrationRows(value: unknown): value is CalibrationRow[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => {
      const liveContract = isRecord(entry) ? entry.live?.contract : null;
      const intendedContract = isRecord(entry) ? entry.intended?.contract : null;
      const freshness = isRecord(entry) ? entry.freshness : null;
      return (
        isRecord(entry) &&
        typeof entry.normalizedId === "string" &&
        isRecord(liveContract) &&
        typeof liveContract.state === "string" &&
        typeof liveContract.promptTier === "string" &&
        isRecord(intendedContract) &&
        typeof intendedContract.state === "string" &&
        typeof intendedContract.promptTier === "string" &&
        isRecord(freshness) &&
        typeof freshness.freshnessBand === "string" &&
        typeof freshness.linkedProfileState === "string" &&
        isStringArray(freshness.findings)
      );
    })
  );
}

function normalizeS02Report(raw: unknown): ValidationResult<M047S02EvaluationReport> {
  if (!isRecord(raw)) {
    return {
      report: null,
      problem: "nested verify:m047:s02 result was missing or malformed.",
    };
  }

  if (
    raw.command !== "verify:m047:s02" ||
    typeof raw.generatedAt !== "string" ||
    typeof raw.overallPassed !== "boolean" ||
    !isStringArray(raw.check_ids) ||
    !isNamedCheckArray(raw.checks) ||
    !isDownstreamScenarioArray(raw.scenarios)
  ) {
    return {
      report: null,
      problem:
        "nested verify:m047:s02 result omitted command, generatedAt, overallPassed, check_ids, checks, or downstream scenarios.",
    };
  }

  if (raw.storedProfileRuntime !== null && raw.storedProfileRuntime !== undefined && !isRuntimeReport(raw.storedProfileRuntime)) {
    return {
      report: null,
      problem: "nested verify:m047:s02 result carried malformed embedded runtime evidence.",
    };
  }

  return {
    report: raw as M047S02EvaluationReport,
    problem: null,
  };
}

function normalizeM045Report(raw: unknown): ValidationResult<M045S03EvaluationReport> {
  if (!isRecord(raw)) {
    return {
      report: null,
      problem: "nested verify:m045:s03 result was missing or malformed.",
    };
  }

  if (
    raw.command !== "verify:m045:s03" ||
    typeof raw.generatedAt !== "string" ||
    typeof raw.overallPassed !== "boolean" ||
    !isStringArray(raw.check_ids) ||
    !isNamedCheckArray(raw.checks) ||
    !isRecord(raw.retrieval) ||
    !isRetrievalScenarioArray(raw.retrieval.scenarios) ||
    !isRecord(raw.slack) ||
    !isSlackScenarioArray(raw.slack.scenarios) ||
    !isRecord(raw.identity) ||
    !isIdentityScenarioArray(raw.identity.scenarios)
  ) {
    return {
      report: null,
      problem:
        "nested verify:m045:s03 result omitted command, generatedAt, overallPassed, check_ids, checks, retrieval, slack, or identity sections.",
    };
  }

  if (raw.githubReview !== null && raw.githubReview !== undefined) {
    const review = raw.githubReview;
    if (
      !isRecord(review) ||
      typeof review.command !== "string" ||
      typeof review.overallPassed !== "boolean" ||
      !Array.isArray(review.scenarios) ||
      !isNamedCheckArray(review.checks)
    ) {
      return {
        report: null,
        problem: "nested verify:m045:s03 result carried malformed embedded GitHub review evidence.",
      };
    }
  }

  return {
    report: raw as M045S03EvaluationReport,
    problem: null,
  };
}

function normalizeM046Report(raw: unknown): ValidationResult<M046EvaluationReport> {
  if (!isRecord(raw)) {
    return {
      report: null,
      problem: "nested verify:m046 result was missing or malformed.",
    };
  }

  if (
    raw.command !== "verify:m046" ||
    typeof raw.generatedAt !== "string" ||
    typeof raw.overallPassed !== "boolean" ||
    !isStringArray(raw.check_ids) ||
    !isNamedCheckArray(raw.checks) ||
    !isRecord(raw.verdict) ||
    !isStringArray(raw.verdict.rationale) ||
    (raw.verdict.value !== null && raw.verdict.value !== "keep" && raw.verdict.value !== "retune" && raw.verdict.value !== "replace") ||
    (raw.verdict.statusCode !== null && typeof raw.verdict.statusCode !== "string") ||
    !isRecord(raw.m047ChangeContract) ||
    (raw.m047ChangeContract.verdict !== "keep" &&
      raw.m047ChangeContract.verdict !== "retune" &&
      raw.m047ChangeContract.verdict !== "replace") ||
    !Array.isArray(raw.m047ChangeContract.keep) ||
    !Array.isArray(raw.m047ChangeContract.change) ||
    !Array.isArray(raw.m047ChangeContract.replace) ||
    !isStringArray(raw.m047ChangeContract.rationale) ||
    !isRecord(raw.calibration) ||
    raw.calibration.command !== "verify:m046:s02" ||
    typeof raw.calibration.overallPassed !== "boolean" ||
    !isRecord(raw.calibration.calibration) ||
    !isStringArray(raw.calibration.calibration.retainedIds) ||
    !isCalibrationRows(raw.calibration.calibration.rows)
  ) {
    return {
      report: null,
      problem:
        "nested verify:m046 result omitted command, generatedAt, overallPassed, verdict, m047ChangeContract, or calibration contributor-model evidence.",
    };
  }

  return {
    report: raw as M046EvaluationReport,
    problem: null,
  };
}

function normalizeDetail(detail: unknown): string {
  if (Array.isArray(detail)) {
    return detail.map((entry) => normalizeDetail(entry)).join("; ");
  }
  if (detail instanceof Error) {
    return detail.message;
  }
  if (typeof detail === "string") {
    return detail;
  }
  return String(detail);
}

function collectFailingChecks(checks: readonly { id: string; passed: boolean; skipped: boolean; status_code: string }[]): string[] {
  return checks
    .filter((check) => !check.passed && !check.skipped)
    .map((check) => `${check.id}:${check.status_code}`);
}

function passCheck(id: M047CheckId, status_code: string, detail?: unknown): Check {
  return {
    id,
    passed: true,
    skipped: false,
    status_code,
    detail: detail == null ? undefined : normalizeDetail(detail),
  };
}

function failCheck(id: M047CheckId, status_code: string, detail?: unknown): Check {
  return {
    id,
    passed: false,
    skipped: false,
    status_code,
    detail: detail == null ? undefined : normalizeDetail(detail),
  };
}

function buildNestedCheck<T extends { checks: readonly { id: string; passed: boolean; skipped: boolean; status_code: string }[]; overallPassed: boolean }>(params: {
  id: M047CheckId;
  validation: ValidationResult<T>;
  evaluationError: unknown;
  malformedStatus: string;
  failedStatus: string;
  passStatus: string;
  label: string;
}): Check {
  if (params.evaluationError) {
    return failCheck(params.id, params.failedStatus, params.validation.problem);
  }

  if (params.validation.problem || !params.validation.report) {
    return failCheck(params.id, params.malformedStatus, params.validation.problem);
  }

  if (!params.validation.report.overallPassed) {
    const failingChecks = collectFailingChecks(params.validation.report.checks);
    return failCheck(
      params.id,
      params.failedStatus,
      failingChecks.length > 0
        ? `embedded ${params.label} report failed: ${failingChecks.join(", ")}`
        : `embedded ${params.label} report failed without named failing checks.`,
    );
  }

  return passCheck(
    params.id,
    params.passStatus,
    `embedded ${params.validation.report.checks.length} ${params.label} checks`,
  );
}

function findRuntimeScenario(report: M047S02EvaluationReport | null, scenarioId: string): RuntimeScenario | null {
  return report?.storedProfileRuntime?.scenarios.find((scenario) => scenario.scenarioId === scenarioId) ?? null;
}

function findDownstreamScenario(report: M047S02EvaluationReport | null, scenarioId: string): DownstreamScenario | null {
  return report?.scenarios.find((scenario) => scenario.scenarioId === scenarioId) ?? null;
}

function findRetrievalScenario(report: M045S03EvaluationReport | null, scenarioId: string): RetrievalScenario | null {
  return report?.retrieval.scenarios.find((scenario) => scenario.scenarioId === scenarioId) ?? null;
}

function findCalibrationRow(report: M046EvaluationReport | null, normalizedId: string): CalibrationRow | null {
  return report?.calibration?.calibration?.rows.find((row) => row.normalizedId === normalizedId) ?? null;
}

function buildNotApplicableIdentity(detail: string): IdentityEvidence {
  return {
    applicable: false,
    passed: true,
    statusCode: "not_applicable",
    detail,
    source: null,
    sourceScenarioId: null,
  };
}

function buildNotApplicableContributorModel(detail: string): ContributorModelEvidence {
  return {
    applicable: false,
    passed: true,
    statusCode: "not_applicable",
    detail,
    source: null,
    contributorNormalizedId: null,
    verdict: null,
    changeContractVerdict: null,
    liveContractState: null,
    livePromptTier: null,
    intendedContractState: null,
    intendedPromptTier: null,
    freshnessBand: null,
    linkedProfileState: null,
  };
}

function buildReviewRuntimeEvidence(params: {
  milestoneScenarioId: MilestoneScenarioId;
  sourceScenarioId: string;
  scenario: RuntimeScenario | null;
  expectedTrustState?: string | null;
  expectedContractState?: string | null;
  expectedContractSource?: string | null;
  expectedDegradationPath?: string | null;
}): ReviewRuntimeEvidence {
  const problems: string[] = [];
  const scenario = params.scenario;

  if (!scenario) {
    problems.push(`missing runtime scenario ${params.sourceScenarioId}`);
  } else {
    if (scenario.check.passed !== true) {
      problems.push(`runtime check failed: ${scenario.check.statusCode}`);
    }
    if (params.expectedTrustState !== undefined && scenario.trustState !== params.expectedTrustState) {
      problems.push(`trustState=${scenario.trustState ?? "null"} expected=${params.expectedTrustState ?? "null"}`);
    }
    if (params.expectedContractState !== undefined && scenario.contractState !== params.expectedContractState) {
      problems.push(`contractState=${scenario.contractState ?? "null"} expected=${params.expectedContractState ?? "null"}`);
    }
    if (params.expectedContractSource !== undefined && scenario.contractSource !== params.expectedContractSource) {
      problems.push(`contractSource=${scenario.contractSource ?? "null"} expected=${params.expectedContractSource ?? "null"}`);
    }
    if (params.expectedDegradationPath !== undefined && scenario.degradationPath !== params.expectedDegradationPath) {
      problems.push(`degradationPath=${scenario.degradationPath ?? "null"} expected=${params.expectedDegradationPath ?? "null"}`);
    }
  }

  const passed = problems.length === 0;
  return {
    passed,
    statusCode: passed
      ? scenario?.check.statusCode ?? `${toStatusPrefix(params.milestoneScenarioId)}_runtime_truthful`
      : "runtime_evidence_drift",
    detail: passed ? undefined : normalizeDetail(problems),
    source: "m047-s01",
    sourceScenarioId: params.sourceScenarioId,
    trustState: scenario?.trustState ?? null,
    contractState: scenario?.contractState ?? null,
    contractSource: scenario?.contractSource ?? null,
    fallbackPath: scenario?.fallbackPath ?? null,
    degradationPath: scenario?.degradationPath ?? null,
    promptStatusCode: scenario?.check.statusCode ?? "missing",
    reviewDetailsStatusCode: scenario?.check.statusCode ?? "missing",
  };
}

function buildRetrievalEvidence(params: {
  milestoneScenarioId: MilestoneScenarioId;
  source: "m047-s02" | "m045-s03";
  sourceScenarioId: string;
  scenario:
    | Pick<DownstreamScenario, "retrievalMultiQuery" | "retrievalLegacyQuery">
    | Pick<RetrievalScenario, "multiQuery" | "legacyQuery">
    | null;
  expectedAuthorHint: string | null;
}): RetrievalEvidence {
  const problems: string[] = [];
  const scenario = params.scenario;
  const multiQuery = scenario
    ? "retrievalMultiQuery" in scenario
      ? scenario.retrievalMultiQuery
      : scenario.multiQuery
    : null;
  const legacyQuery = scenario
    ? "retrievalLegacyQuery" in scenario
      ? scenario.retrievalLegacyQuery
      : scenario.legacyQuery
    : null;

  if (!scenario || !multiQuery || !legacyQuery) {
    problems.push(`missing retrieval scenario ${params.sourceScenarioId}`);
  } else {
    if (multiQuery.passed !== true) {
      problems.push(`multi-query failed: ${multiQuery.statusCode}`);
    }
    if (legacyQuery.passed !== true) {
      problems.push(`legacy-query failed: ${legacyQuery.statusCode}`);
    }

    if (params.expectedAuthorHint) {
      if (!multiQuery.query.includes(`author: ${params.expectedAuthorHint}`)) {
        problems.push(`multiQuery missing author hint ${params.expectedAuthorHint}`);
      }
      if (!legacyQuery.query.includes(`Author: ${params.expectedAuthorHint}`)) {
        problems.push(`legacyQuery missing author hint ${params.expectedAuthorHint}`);
      }
    } else {
      if (multiQuery.query.includes("author:")) {
        problems.push("multiQuery unexpectedly included author hint");
      }
      if (legacyQuery.query.includes("Author:")) {
        problems.push("legacyQuery unexpectedly included author hint");
      }
    }
  }

  const passed = problems.length === 0;
  return {
    passed,
    statusCode: passed ? `${toStatusPrefix(params.milestoneScenarioId)}_retrieval_truthful` : "retrieval_evidence_drift",
    detail: passed ? undefined : normalizeDetail(problems),
    source: params.source,
    sourceScenarioId: params.sourceScenarioId,
    multiQueryStatusCode: multiQuery?.statusCode ?? "missing",
    legacyQueryStatusCode: legacyQuery?.statusCode ?? "missing",
    multiQuery: multiQuery?.query ?? "",
    legacyQuery: legacyQuery?.query ?? "",
  };
}

function buildSlackProfileEvidence(params: {
  milestoneScenarioId: MilestoneScenarioId;
  sourceScenarioId: string;
  scenario: DownstreamScenario | null;
  expectLinkContinuity: boolean;
  detailWhenNotApplicable?: string;
}): SlackProfileEvidence {
  if (!params.scenario) {
    return {
      applicable: false,
      passed: false,
      statusCode: "slack_profile_evidence_drift",
      detail: `missing downstream scenario ${params.sourceScenarioId}`,
      source: null,
      sourceScenarioId: null,
      profileStatusCode: null,
      continuityStatusCode: null,
      optInStatusCode: null,
    };
  }

  const problems: string[] = [];
  if (params.scenario.profile.passed !== true) {
    problems.push(`profile failed: ${params.scenario.profile.statusCode}`);
  }
  if (params.scenario.optInContinuity.passed !== true) {
    problems.push(`opt-in continuity failed: ${params.scenario.optInContinuity.statusCode}`);
  }

  if (params.expectLinkContinuity) {
    if (!params.scenario.linkContinuity) {
      problems.push("link continuity was missing");
    } else if (params.scenario.linkContinuity.passed !== true) {
      problems.push(`link continuity failed: ${params.scenario.linkContinuity.statusCode}`);
    }
  }

  const passed = problems.length === 0;
  return {
    applicable: true,
    passed,
    statusCode: passed ? `${toStatusPrefix(params.milestoneScenarioId)}_slack_profile_truthful` : "slack_profile_evidence_drift",
    detail: passed ? params.detailWhenNotApplicable : normalizeDetail(problems),
    source: "m047-s02",
    sourceScenarioId: params.sourceScenarioId,
    profileStatusCode: params.scenario.profile.statusCode,
    continuityStatusCode: params.scenario.linkContinuity?.statusCode ?? null,
    optInStatusCode: params.scenario.optInContinuity.statusCode,
  };
}

function buildNotApplicableSlackProfile(detail: string): SlackProfileEvidence {
  return {
    applicable: false,
    passed: true,
    statusCode: "not_applicable",
    detail,
    source: null,
    sourceScenarioId: null,
    profileStatusCode: null,
    continuityStatusCode: null,
    optInStatusCode: null,
  };
}

function buildIdentityEvidence(params: {
  milestoneScenarioId: MilestoneScenarioId;
  sourceScenarioId: string;
  scenario: DownstreamScenario | null;
}): IdentityEvidence {
  const identity = params.scenario?.identitySuppression ?? null;
  const problems: string[] = [];

  if (!params.scenario) {
    problems.push(`missing downstream scenario ${params.sourceScenarioId}`);
  }
  if (!identity) {
    problems.push("identity suppression evidence was missing");
  } else if (identity.passed !== true) {
    problems.push(`identity suppression failed: ${identity.statusCode}`);
  }

  const passed = problems.length === 0;
  return {
    applicable: true,
    passed,
    statusCode: passed
      ? `${toStatusPrefix(params.milestoneScenarioId)}_identity_suppression_truthful`
      : "identity_evidence_drift",
    detail: passed ? undefined : normalizeDetail(problems),
    source: "m047-s02",
    sourceScenarioId: params.sourceScenarioId,
  };
}

function buildContributorModelEvidence(params: {
  milestoneScenarioId: MilestoneScenarioId;
  contributorNormalizedId: string;
  report: M046EvaluationReport | null;
  expectedLiveContractState: string;
  expectedLivePromptTier: string;
  expectedIntendedContractState: string;
  expectedIntendedPromptTier: string;
  expectedFreshnessBand: string;
}): ContributorModelEvidence {
  const problems: string[] = [];
  const report = params.report;
  const row = findCalibrationRow(report, params.contributorNormalizedId);
  const retainedIds = report?.calibration?.calibration?.retainedIds ?? [];

  if (!report) {
    problems.push("missing nested M046 report");
  }
  if (report?.overallPassed !== true) {
    problems.push(`m046 report failed: ${collectFailingChecks(report?.checks ?? []).join(", ") || "overallPassed=false"}`);
  }
  if (!row) {
    problems.push(`missing contributor row ${params.contributorNormalizedId}`);
  }
  if (!retainedIds.includes(params.contributorNormalizedId)) {
    problems.push(`retainedIds missing ${params.contributorNormalizedId}`);
  }
  if (!report?.verdict.value) {
    problems.push("missing M046 verdict");
  }
  if (!report?.m047ChangeContract) {
    problems.push("missing M047 change contract");
  }

  if (row) {
    if (row.live.contract.state !== params.expectedLiveContractState) {
      problems.push(`live.contract.state=${row.live.contract.state} expected=${params.expectedLiveContractState}`);
    }
    if (row.live.contract.promptTier !== params.expectedLivePromptTier) {
      problems.push(`live.contract.promptTier=${row.live.contract.promptTier} expected=${params.expectedLivePromptTier}`);
    }
    if (row.intended.contract.state !== params.expectedIntendedContractState) {
      problems.push(`intended.contract.state=${row.intended.contract.state} expected=${params.expectedIntendedContractState}`);
    }
    if (row.intended.contract.promptTier !== params.expectedIntendedPromptTier) {
      problems.push(`intended.contract.promptTier=${row.intended.contract.promptTier} expected=${params.expectedIntendedPromptTier}`);
    }
    if (row.freshness.freshnessBand !== params.expectedFreshnessBand) {
      problems.push(`freshnessBand=${row.freshness.freshnessBand} expected=${params.expectedFreshnessBand}`);
    }
  }

  const passed = problems.length === 0;
  return {
    applicable: true,
    passed,
    statusCode: passed
      ? `${toStatusPrefix(params.milestoneScenarioId)}_contributor_model_truthful`
      : "contributor_model_evidence_drift",
    detail: passed ? undefined : normalizeDetail(problems),
    source: "m046",
    contributorNormalizedId: row?.normalizedId ?? null,
    verdict: report?.verdict.value ?? null,
    changeContractVerdict: report?.m047ChangeContract?.verdict ?? null,
    liveContractState: row?.live.contract.state ?? null,
    livePromptTier: row?.live.contract.promptTier ?? null,
    intendedContractState: row?.intended.contract.state ?? null,
    intendedPromptTier: row?.intended.contract.promptTier ?? null,
    freshnessBand: row?.freshness.freshnessBand ?? null,
    linkedProfileState: row?.freshness.linkedProfileState ?? null,
  };
}

function buildMilestoneScenario(params: {
  scenarioId: MilestoneScenarioId;
  description: string;
  reviewRuntime: ReviewRuntimeEvidence;
  retrieval: RetrievalEvidence;
  slackProfile: SlackProfileEvidence;
  identity: IdentityEvidence;
  contributorModel: ContributorModelEvidence;
}): MilestoneScenarioReport {
  const facets = [
    params.reviewRuntime,
    params.retrieval,
    params.slackProfile,
    params.identity,
    params.contributorModel,
  ];
  const problems = facets
    .filter((facet) => !facet.passed)
    .map((facet) => normalizeDetail(facet.detail ?? facet.statusCode));
  const passed = problems.length === 0;

  return {
    scenarioId: params.scenarioId,
    description: params.description,
    passed,
    statusCode: passed ? `${toStatusPrefix(params.scenarioId)}_coherent` : "scenario_evidence_drift",
    detail: passed ? undefined : normalizeDetail(problems),
    reviewRuntime: params.reviewRuntime,
    retrieval: params.retrieval,
    slackProfile: params.slackProfile,
    identity: params.identity,
    contributorModel: params.contributorModel,
  };
}

function buildScenarioReports(params: {
  s02: M047S02EvaluationReport | null;
  m045: M045S03EvaluationReport | null;
  m046: M046EvaluationReport | null;
}): MilestoneScenarioReport[] {
  const linkedUnscoredDownstream = findDownstreamScenario(params.s02, "linked-unscored");
  const calibratedDownstream = findDownstreamScenario(params.s02, "calibrated");
  const staleDownstream = findDownstreamScenario(params.s02, "stale");
  const optOutDownstream = findDownstreamScenario(params.s02, "opt-out");

  return [
    buildMilestoneScenario({
      scenarioId: "linked-unscored",
      description:
        "Linked-but-unscored runtime and downstream surfaces stay coarse-fallback without claiming active linked guidance.",
      reviewRuntime: buildReviewRuntimeEvidence({
        milestoneScenarioId: "linked-unscored",
        sourceScenarioId: "linked-unscored",
        scenario: findRuntimeScenario(params.s02, "linked-unscored"),
        expectedTrustState: "linked-unscored",
        expectedContractState: "coarse-fallback",
        expectedContractSource: "github-search",
      }),
      retrieval: buildRetrievalEvidence({
        milestoneScenarioId: "linked-unscored",
        source: "m047-s02",
        sourceScenarioId: "linked-unscored",
        scenario: linkedUnscoredDownstream,
        expectedAuthorHint: "returning contributor",
      }),
      slackProfile: buildSlackProfileEvidence({
        milestoneScenarioId: "linked-unscored",
        sourceScenarioId: "linked-unscored",
        scenario: linkedUnscoredDownstream,
        expectLinkContinuity: true,
      }),
      identity: buildNotApplicableIdentity("linked-unscored does not rely on identity-suppression evidence."),
      contributorModel: buildNotApplicableContributorModel("linked-unscored is outside the retained calibration cohort."),
    }),
    buildMilestoneScenario({
      scenarioId: "calibrated-retained",
      description:
        "Trusted calibrated runtime/downstream surfaces remain profile-backed while retained-contributor calibration evidence anchors on koprajs.",
      reviewRuntime: buildReviewRuntimeEvidence({
        milestoneScenarioId: "calibrated-retained",
        sourceScenarioId: "calibrated",
        scenario: findRuntimeScenario(params.s02, "calibrated"),
        expectedTrustState: "calibrated",
        expectedContractState: "profile-backed",
        expectedContractSource: "contributor-profile",
      }),
      retrieval: buildRetrievalEvidence({
        milestoneScenarioId: "calibrated-retained",
        source: "m047-s02",
        sourceScenarioId: "calibrated",
        scenario: calibratedDownstream,
        expectedAuthorHint: "established contributor",
      }),
      slackProfile: buildSlackProfileEvidence({
        milestoneScenarioId: "calibrated-retained",
        sourceScenarioId: "calibrated",
        scenario: calibratedDownstream,
        expectLinkContinuity: true,
      }),
      identity: buildNotApplicableIdentity("calibrated-retained does not depend on identity-suppression evidence."),
      contributorModel: buildContributorModelEvidence({
        milestoneScenarioId: "calibrated-retained",
        contributorNormalizedId: "koprajs",
        report: params.m046,
        expectedLiveContractState: "profile-backed",
        expectedLivePromptTier: "newcomer",
        expectedIntendedContractState: "profile-backed",
        expectedIntendedPromptTier: "established",
        expectedFreshnessBand: "fresh",
      }),
    }),
    buildMilestoneScenario({
      scenarioId: "stale-degraded",
      description:
        "Stale stored-profile runtime/downstream surfaces stay degraded while calibration freshness evidence anchors on fkoemep.",
      reviewRuntime: buildReviewRuntimeEvidence({
        milestoneScenarioId: "stale-degraded",
        sourceScenarioId: "stale",
        scenario: findRuntimeScenario(params.s02, "stale"),
        expectedTrustState: "stale",
        expectedContractState: "generic-degraded",
        expectedContractSource: "github-search",
        expectedDegradationPath: "search-api-rate-limit",
      }),
      retrieval: buildRetrievalEvidence({
        milestoneScenarioId: "stale-degraded",
        source: "m047-s02",
        sourceScenarioId: "stale",
        scenario: staleDownstream,
        expectedAuthorHint: null,
      }),
      slackProfile: buildSlackProfileEvidence({
        milestoneScenarioId: "stale-degraded",
        sourceScenarioId: "stale",
        scenario: staleDownstream,
        expectLinkContinuity: true,
      }),
      identity: buildNotApplicableIdentity("stale-degraded does not rely on identity-suppression evidence."),
      contributorModel: buildContributorModelEvidence({
        milestoneScenarioId: "stale-degraded",
        contributorNormalizedId: "fkoemep",
        report: params.m046,
        expectedLiveContractState: "profile-backed",
        expectedLivePromptTier: "newcomer",
        expectedIntendedContractState: "profile-backed",
        expectedIntendedPromptTier: "newcomer",
        expectedFreshnessBand: "stale",
      }),
    }),
    buildMilestoneScenario({
      scenarioId: "opt-out",
      description:
        "Opted-out runtime/downstream surfaces stay generic while preserving explicit identity-suppression evidence.",
      reviewRuntime: buildReviewRuntimeEvidence({
        milestoneScenarioId: "opt-out",
        sourceScenarioId: "opt-out",
        scenario: findRuntimeScenario(params.s02, "opt-out"),
        expectedTrustState: "calibrated",
        expectedContractState: "generic-opt-out",
        expectedContractSource: "contributor-profile",
      }),
      retrieval: buildRetrievalEvidence({
        milestoneScenarioId: "opt-out",
        source: "m047-s02",
        sourceScenarioId: "opt-out",
        scenario: optOutDownstream,
        expectedAuthorHint: null,
      }),
      slackProfile: buildSlackProfileEvidence({
        milestoneScenarioId: "opt-out",
        sourceScenarioId: "opt-out",
        scenario: optOutDownstream,
        expectLinkContinuity: false,
      }),
      identity: buildIdentityEvidence({
        milestoneScenarioId: "opt-out",
        sourceScenarioId: "opt-out",
        scenario: optOutDownstream,
      }),
      contributorModel: buildNotApplicableContributorModel("opt-out does not depend on retained contributor-model anchoring."),
    }),
    buildMilestoneScenario({
      scenarioId: "coarse-fallback",
      description:
        "Cache-only coarse fallback reuses retrieval contract evidence but keeps Slack/profile continuity explicitly not applicable.",
      reviewRuntime: buildReviewRuntimeEvidence({
        milestoneScenarioId: "coarse-fallback",
        sourceScenarioId: "coarse-fallback-cache",
        scenario: findRuntimeScenario(params.s02, "coarse-fallback-cache"),
        expectedTrustState: null,
        expectedContractState: "coarse-fallback",
        expectedContractSource: "author-cache",
      }),
      retrieval: buildRetrievalEvidence({
        milestoneScenarioId: "coarse-fallback",
        source: "m045-s03",
        sourceScenarioId: "coarse-fallback",
        scenario: findRetrievalScenario(params.m045, "coarse-fallback"),
        expectedAuthorHint: "returning contributor",
      }),
      slackProfile: buildNotApplicableSlackProfile(
        "coarse-fallback has no truthful linked-profile Slack or continuity surface.",
      ),
      identity: buildNotApplicableIdentity("coarse-fallback does not rely on identity-suppression evidence."),
      contributorModel: buildNotApplicableContributorModel("coarse-fallback is outside the retained calibration cohort."),
    }),
  ];
}

function buildScenarioCheck(scenarios: MilestoneScenarioReport[]): Check {
  const failingScenarios = scenarios.filter((scenario) => !scenario.passed);

  if (failingScenarios.length === 0) {
    return passCheck(
      "M047-S03-MILESTONE-SCENARIOS",
      "milestone_scenarios_truthful",
      `checked ${scenarios.length} milestone scenarios`,
    );
  }

  return failCheck(
    "M047-S03-MILESTONE-SCENARIOS",
    "milestone_scenario_drift",
    failingScenarios.map((scenario) => `${scenario.scenarioId}:${scenario.statusCode}${scenario.detail ? ` (${scenario.detail})` : ""}`),
  );
}

export async function evaluateM047(options: EvaluateM047Options = {}): Promise<EvaluationReport> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const evaluateS02Impl = options._evaluateM047S02 ?? evaluateM047S02;
  const evaluateM045Impl = options._evaluateM045S03 ?? evaluateM045S03;
  const evaluateM046Impl = options._evaluateM046 ?? evaluateM046;

  let s02Raw: unknown = null;
  let s02Error: unknown = null;
  try {
    s02Raw = await evaluateS02Impl({ generatedAt });
  } catch (error) {
    s02Error = error;
  }

  let m045Raw: unknown = null;
  let m045Error: unknown = null;
  try {
    m045Raw = await evaluateM045Impl({ generatedAt });
  } catch (error) {
    m045Error = error;
  }

  let m046Raw: unknown = null;
  let m046Error: unknown = null;
  try {
    m046Raw = await evaluateM046Impl({
      generatedAt,
      referenceTime: options.referenceTime,
    });
  } catch (error) {
    m046Error = error;
  }

  const s02Validation = s02Error
    ? { report: null, problem: normalizeDetail(s02Error) }
    : normalizeS02Report(s02Raw);
  const m045Validation = m045Error
    ? { report: null, problem: normalizeDetail(m045Error) }
    : normalizeM045Report(m045Raw);
  const m046Validation = m046Error
    ? { report: null, problem: normalizeDetail(m046Error) }
    : normalizeM046Report(m046Raw);

  const scenarios = buildScenarioReports({
    s02: s02Validation.report,
    m045: m045Validation.report,
    m046: m046Validation.report,
  });

  const checks: Check[] = [
    buildNestedCheck({
      id: "M047-S03-S02-REPORT-COMPOSED",
      validation: s02Validation,
      evaluationError: s02Error,
      malformedStatus: "nested_s02_report_malformed",
      failedStatus: "nested_s02_report_failed",
      passStatus: "nested_s02_report_preserved",
      label: "S02",
    }),
    buildNestedCheck({
      id: "M047-S03-M045-REPORT-COMPOSED",
      validation: m045Validation,
      evaluationError: m045Error,
      malformedStatus: "nested_m045_report_malformed",
      failedStatus: "nested_m045_report_failed",
      passStatus: "nested_m045_report_preserved",
      label: "M045",
    }),
    buildNestedCheck({
      id: "M047-S03-M046-REPORT-COMPOSED",
      validation: m046Validation,
      evaluationError: m046Error,
      malformedStatus: "nested_m046_report_malformed",
      failedStatus: "nested_m046_report_failed",
      passStatus: "nested_m046_report_preserved",
      label: "M046",
    }),
    buildScenarioCheck(scenarios),
  ];

  return {
    command: COMMAND_NAME,
    generatedAt,
    check_ids: M047_CHECK_IDS,
    overallPassed: checks.every((check) => check.passed || check.skipped),
    scenarios,
    m047S02: s02Validation.report,
    m045S03: m045Validation.report,
    m046: m046Validation.report,
    checks,
  };
}

function formatPassFail(value: boolean): string {
  return value ? "pass" : "fail";
}

function renderScenarioLine(scenario: MilestoneScenarioReport): string {
  const slack = scenario.slackProfile.applicable ? formatPassFail(scenario.slackProfile.passed) : "n/a";
  const identity = scenario.identity.applicable ? formatPassFail(scenario.identity.passed) : "n/a";
  const model = scenario.contributorModel.applicable
    ? `${scenario.contributorModel.contributorNormalizedId ?? "missing"}/${formatPassFail(scenario.contributorModel.passed)}`
    : "n/a";

  return `- ${scenario.scenarioId} runtime=${scenario.reviewRuntime.contractState ?? "missing"}/${scenario.reviewRuntime.contractSource ?? "missing"} retrieval=${scenario.retrieval.source}:${scenario.retrieval.sourceScenarioId} slack/profile=${slack} identity=${identity} contributor-model=${model} ${formatPassFail(scenario.passed)}`;
}

export function renderM047Report(report: EvaluationReport): string {
  const lines = [
    "M047 integrated proof harness: milestone coherence verifier",
    `Generated at: ${report.generatedAt}`,
    `Final verdict: ${report.overallPassed ? "PASS" : "FAIL"}`,
    `Verdict: ${report.m046?.verdict.value ?? "missing"}`,
    `Verdict status: ${report.m046?.verdict.statusCode ?? "missing"}`,
    "Nested reports:",
  ];

  if (!report.m047S02) {
    lines.push("- verify:m047:s02 unavailable");
  } else {
    lines.push(
      `- verify:m047:s02 ${report.m047S02.overallPassed ? "PASS" : "FAIL"} scenarios=${report.m047S02.scenarios.length} checks=${report.m047S02.checks.length}`,
    );
  }

  if (!report.m045S03) {
    lines.push("- verify:m045:s03 unavailable");
  } else {
    lines.push(
      `- verify:m045:s03 ${report.m045S03.overallPassed ? "PASS" : "FAIL"} retrieval=${report.m045S03.retrieval.scenarios.length} slack=${report.m045S03.slack.scenarios.length} identity=${report.m045S03.identity.scenarios.length}`,
    );
  }

  if (!report.m046) {
    lines.push("- verify:m046 unavailable");
  } else {
    lines.push(
      `- verify:m046 ${report.m046.overallPassed ? "PASS" : "FAIL"} verdict=${report.m046.verdict.value ?? "missing"} keep=${report.m046.m047ChangeContract?.keep.length ?? "missing"} change=${report.m046.m047ChangeContract?.change.length ?? "missing"} replace=${report.m046.m047ChangeContract?.replace.length ?? "missing"}`,
    );
  }

  lines.push("Milestone scenarios:");
  for (const scenario of report.scenarios) {
    lines.push(renderScenarioLine(scenario));
    if (!scenario.passed && scenario.detail) {
      lines.push(`  detail: ${scenario.detail}`);
    }
    if (!scenario.slackProfile.applicable) {
      lines.push(`  slack/profile=n/a ${scenario.slackProfile.detail ?? ""}`.trim());
    }
  }

  lines.push("Checks:");
  for (const check of report.checks) {
    const verdict = check.skipped ? "SKIP" : check.passed ? "PASS" : "FAIL";
    lines.push(
      `- ${check.id} ${verdict} status_code=${check.status_code}${check.detail ? ` ${check.detail}` : ""}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

export async function buildM047ProofHarness(
  options: BuildProofHarnessOptions = {},
): Promise<{ exitCode: number; report: EvaluationReport }> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const report = await evaluateM047(options);

  if (options.json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    stdout.write(renderM047Report(report));
  }

  if (!report.overallPassed) {
    const failingCodes = report.checks
      .filter((check) => !check.passed && !check.skipped)
      .map((check) => `${check.id}:${check.status_code}`)
      .join(", ");
    stderr.write(`verify:m047 failed: ${failingCodes}\n`);
  }

  return {
    exitCode: report.overallPassed ? 0 : 1,
    report,
  };
}

export function parseM047Args(args: readonly string[]): { json: boolean } {
  let json = false;

  for (const arg of args) {
    if (arg === "--json") {
      json = true;
      continue;
    }

    throw new Error(`invalid_cli_args: Unknown argument: ${arg}`);
  }

  return { json };
}

if (import.meta.main) {
  try {
    const args = parseM047Args(process.argv.slice(2));
    const { exitCode } = await buildM047ProofHarness(args);
    process.exit(exitCode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`verify:m047 failed: ${message}\n`);
    process.exit(1);
  }
}
