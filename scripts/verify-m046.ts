import {
  buildCalibrationChangeContract,
  type CalibrationChangeContract,
  type CalibrationChangeContractEntry,
} from "../src/contributor/calibration-change-contract.ts";
import type { CalibrationRecommendationVerdict } from "../src/contributor/calibration-evaluator.ts";
import type { ContributorFixtureManifest } from "../src/contributor/fixture-set.ts";
import {
  evaluateM046S01,
  type EvaluationReport as M046S01EvaluationReport,
} from "./verify-m046-s01.ts";
import {
  evaluateM046S02,
  type EvaluationReport as M046S02EvaluationReport,
} from "./verify-m046-s02.ts";

const COMMAND_NAME = "verify:m046" as const;

export const M046_CHECK_IDS = [
  "M046-S03-FIXTURE-REPORT",
  "M046-S03-CALIBRATION-REPORT",
  "M046-S03-COUNT-CONSISTENCY",
  "M046-S03-VERDICT",
  "M046-S03-M047-CHANGE-CONTRACT",
] as const;

export type M046CheckId = (typeof M046_CHECK_IDS)[number];

export type Check = {
  id: M046CheckId;
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail?: string;
};

export type VerdictSummary = {
  value: CalibrationRecommendationVerdict | null;
  rationale: string[];
  statusCode: string | null;
};

export type EvaluationReport = {
  command: typeof COMMAND_NAME;
  generatedAt: string;
  check_ids: readonly M046CheckId[];
  overallPassed: boolean;
  verdict: VerdictSummary;
  fixture: M046S01EvaluationReport | null;
  calibration: M046S02EvaluationReport | null;
  m047ChangeContract: CalibrationChangeContract | null;
  checks: Check[];
};

type StdWriter = {
  write: (chunk: string) => boolean | void;
};

export type EvaluateM046Options = {
  manifestPath?: string;
  snapshotPath?: string;
  generatedAt?: string;
  referenceTime?: string | Date;
  readSnapshotFile?: (path: string) => Promise<string>;
  loadManifest?: (path: string) => Promise<ContributorFixtureManifest>;
  _evaluateS01?: (options?: Record<string, unknown>) => Promise<unknown>;
  _evaluateS02?: (options?: Record<string, unknown>) => Promise<unknown>;
  _buildChangeContract?: (
    recommendation: {
      verdict?: unknown;
      rationale?: unknown;
    },
  ) => unknown;
};

type BuildProofHarnessOptions = EvaluateM046Options & {
  json?: boolean;
  stdout?: StdWriter;
  stderr?: StdWriter;
};

type ValidationResult<T> = {
  report: T | null;
  problem: string | null;
};

type Counts = {
  retained: number;
  excluded: number;
};

type RecommendationSummary = {
  verdict: CalibrationRecommendationVerdict;
  rationale: string[];
};

type ContractValidationResult = {
  contract: CalibrationChangeContract | null;
  statusCode: string | null;
  detail: string | null;
};

export async function evaluateM046(
  options: EvaluateM046Options = {},
): Promise<EvaluationReport> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const evaluateS01Impl = options._evaluateS01 ?? evaluateM046S01;
  const evaluateS02Impl = options._evaluateS02 ?? evaluateM046S02;
  const buildChangeContractImpl =
    options._buildChangeContract ?? buildCalibrationChangeContract;

  let fixtureRaw: unknown = null;
  let fixtureError: unknown = null;
  try {
    fixtureRaw = await evaluateS01Impl({
      manifestPath: options.manifestPath,
      snapshotPath: options.snapshotPath,
      generatedAt,
      readSnapshotFile: options.readSnapshotFile,
    });
  } catch (error) {
    fixtureError = error;
  }

  let calibrationRaw: unknown = null;
  let calibrationError: unknown = null;
  try {
    calibrationRaw = await evaluateS02Impl({
      manifestPath: options.manifestPath,
      snapshotPath: options.snapshotPath,
      generatedAt,
      referenceTime: options.referenceTime,
      readSnapshotFile: options.readSnapshotFile,
      loadManifest: options.loadManifest,
      _evaluateS01: async () => {
        if (fixtureError) {
          throw fixtureError;
        }
        return fixtureRaw;
      },
    });
  } catch (error) {
    calibrationError = error;
  }

  const fixtureValidation = fixtureError
    ? { report: null, problem: normalizeDetail(fixtureError) }
    : normalizeFixtureReport(fixtureRaw);
  const calibrationValidation = calibrationError
    ? { report: null, problem: normalizeDetail(calibrationError) }
    : normalizeCalibrationReport(calibrationRaw);

  const fixtureCheck = buildFixtureCheck({
    validation: fixtureValidation,
    evaluationError: fixtureError,
  });
  const calibrationCheck = buildCalibrationCheck({
    validation: calibrationValidation,
    evaluationError: calibrationError,
  });

  const countCheck = buildCountConsistencyCheck({
    fixture: fixtureValidation.report,
    calibration: calibrationValidation.report,
  });

  const verdictResult = buildVerdictSummary({
    calibration: calibrationValidation.report,
  });

  const contractResult = buildChangeContractCheck({
    calibration: calibrationValidation.report,
    verdict: verdictResult.summary,
    buildChangeContract: buildChangeContractImpl,
  });

  const checks: Check[] = [
    fixtureCheck,
    calibrationCheck,
    countCheck,
    verdictResult.check,
    contractResult.check,
  ];

  return {
    command: COMMAND_NAME,
    generatedAt,
    check_ids: M046_CHECK_IDS,
    overallPassed: checks.every((check) => check.passed || check.skipped),
    verdict: verdictResult.summary,
    fixture: fixtureValidation.report,
    calibration: calibrationValidation.report,
    m047ChangeContract: contractResult.contract,
    checks,
  };
}

export function renderM046Report(report: EvaluationReport): string {
  const lines = [
    "M046 integrated proof harness: explicit calibration verdict and M047 contract",
    `Generated at: ${report.generatedAt}`,
    `Proof surface: ${report.overallPassed ? "PASS" : "FAIL"}`,
    `Verdict: ${report.verdict.value ?? "missing"}`,
    `Verdict status: ${report.verdict.statusCode ?? "unknown"}`,
  ];

  if (report.verdict.rationale.length > 0) {
    lines.push("Verdict rationale:");
    for (const rationale of report.verdict.rationale) {
      lines.push(`- ${rationale}`);
    }
  }

  if (!report.fixture) {
    lines.push("Fixture: unavailable");
  } else {
    lines.push(
      `Fixture: ${report.fixture.overallPassed ? "PASS" : "FAIL"} status=${report.fixture.diagnostics?.statusCode ?? "unknown"} retained=${report.fixture.counts?.retained ?? "unknown"} excluded=${report.fixture.counts?.excluded ?? "unknown"}`,
    );
  }

  if (!report.calibration) {
    lines.push("Calibration: unavailable");
  } else {
    lines.push(
      `Calibration: ${report.calibration.overallPassed ? "PASS" : "FAIL"} recommendation=${report.calibration.calibration?.recommendation?.verdict ?? "missing"} retained=${report.calibration.calibration?.retainedIds.length ?? "unknown"} excluded=${report.calibration.calibration?.excludedControls.length ?? "unknown"}`,
    );
    lines.push(
      `Calibration prerequisite counts: retained=${report.calibration.prerequisite?.counts?.retained ?? "unknown"} excluded=${report.calibration.prerequisite?.counts?.excluded ?? "unknown"}`,
    );
  }

  if (!report.m047ChangeContract) {
    lines.push("M047 change contract: unavailable");
  } else {
    lines.push(
      `M047 change contract: verdict=${report.m047ChangeContract.verdict} keep=${report.m047ChangeContract.keep.length} change=${report.m047ChangeContract.change.length} replace=${report.m047ChangeContract.replace.length}`,
    );
    renderContractBucket(lines, "keep", report.m047ChangeContract.keep);
    renderContractBucket(lines, "change", report.m047ChangeContract.change);
    renderContractBucket(lines, "replace", report.m047ChangeContract.replace);
  }

  lines.push("Checks:");
  for (const check of report.checks) {
    const verdict = check.skipped ? "SKIP" : check.passed ? "PASS" : "FAIL";
    lines.push(
      `- ${check.id} ${verdict} status_code=${check.status_code}${check.detail ? ` ${check.detail}` : ""}`,
    );
  }

  if (report.fixture) {
    lines.push("Fixture checks:");
    for (const check of report.fixture.checks) {
      const verdict = check.skipped ? "SKIP" : check.passed ? "PASS" : "FAIL";
      lines.push(
        `- ${check.id} ${verdict} status_code=${check.status_code}${check.detail ? ` ${check.detail}` : ""}`,
      );
    }
  }

  if (report.calibration) {
    lines.push("Calibration checks:");
    for (const check of report.calibration.checks) {
      const verdict = check.skipped ? "SKIP" : check.passed ? "PASS" : "FAIL";
      lines.push(
        `- ${check.id} ${verdict} status_code=${check.status_code}${check.detail ? ` ${check.detail}` : ""}`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

export async function buildM046ProofHarness(
  options: BuildProofHarnessOptions = {},
): Promise<{ exitCode: number; report: EvaluationReport }> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const report = await evaluateM046(options);

  if (options.json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    stdout.write(renderM046Report(report));
  }

  if (!report.overallPassed) {
    const failingCodes = report.checks
      .filter((check) => !check.passed && !check.skipped)
      .map((check) => `${check.id}:${check.status_code}`)
      .join(", ");
    stderr.write(`verify:m046 failed: ${failingCodes}\n`);
  }

  return {
    exitCode: report.overallPassed ? 0 : 1,
    report,
  };
}

export function parseM046Args(args: readonly string[]): { json: boolean } {
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

function buildFixtureCheck(params: {
  validation: ValidationResult<M046S01EvaluationReport>;
  evaluationError: unknown;
}): Check {
  if (params.evaluationError) {
    return failCheck(
      "M046-S03-FIXTURE-REPORT",
      "fixture_report_failed",
      params.validation.problem,
    );
  }

  if (params.validation.problem || !params.validation.report) {
    return failCheck(
      "M046-S03-FIXTURE-REPORT",
      "fixture_report_malformed",
      params.validation.problem,
    );
  }

  if (!params.validation.report.overallPassed) {
    const failingChecks = collectFailingChecks(params.validation.report.checks);
    return failCheck(
      "M046-S03-FIXTURE-REPORT",
      "fixture_report_failed",
      failingChecks.length > 0
        ? `embedded fixture report failed: ${failingChecks.join(", ")}`
        : "embedded fixture report failed without named failing checks.",
    );
  }

  return passCheck(
    "M046-S03-FIXTURE-REPORT",
    "fixture_report_preserved",
    `embedded ${params.validation.report.checks.length} fixture checks`,
  );
}

function buildCalibrationCheck(params: {
  validation: ValidationResult<M046S02EvaluationReport>;
  evaluationError: unknown;
}): Check {
  if (params.evaluationError) {
    return failCheck(
      "M046-S03-CALIBRATION-REPORT",
      "calibration_report_failed",
      params.validation.problem,
    );
  }

  if (params.validation.problem || !params.validation.report) {
    return failCheck(
      "M046-S03-CALIBRATION-REPORT",
      "calibration_report_malformed",
      params.validation.problem,
    );
  }

  if (!params.validation.report.overallPassed) {
    const failingChecks = collectFailingChecks(params.validation.report.checks);
    return failCheck(
      "M046-S03-CALIBRATION-REPORT",
      "calibration_report_failed",
      failingChecks.length > 0
        ? `embedded calibration report failed: ${failingChecks.join(", ")}`
        : "embedded calibration report failed without named failing checks.",
    );
  }

  return passCheck(
    "M046-S03-CALIBRATION-REPORT",
    "calibration_report_preserved",
    `embedded ${params.validation.report.checks.length} calibration checks`,
  );
}

function buildCountConsistencyCheck(params: {
  fixture: M046S01EvaluationReport | null;
  calibration: M046S02EvaluationReport | null;
}): Check {
  const fixtureCounts = params.fixture?.counts;
  const prerequisiteCounts = params.calibration?.prerequisite?.counts ?? null;
  const snapshotCounts = params.calibration?.snapshot.counts ?? null;
  const retainedCount = params.calibration?.calibration?.retainedIds.length ?? null;
  const excludedCount = params.calibration?.calibration?.excludedControls.length ?? null;

  if (
    !fixtureCounts ||
    !prerequisiteCounts ||
    !snapshotCounts ||
    retainedCount == null ||
    excludedCount == null
  ) {
    return skippedCheck(
      "M046-S03-COUNT-CONSISTENCY",
      "nested_count_consistency_skipped",
      "Retained/excluded counts were unavailable from one or more nested reports.",
    );
  }

  const problems: string[] = [];
  const retainedValues = [
    `fixture.retained=${fixtureCounts.retained}`,
    `calibration.prerequisite.retained=${prerequisiteCounts.retained}`,
    `calibration.snapshot.retained=${snapshotCounts.retained}`,
    `calibration.rows.retained=${retainedCount}`,
  ];
  const excludedValues = [
    `fixture.excluded=${fixtureCounts.excluded}`,
    `calibration.prerequisite.excluded=${prerequisiteCounts.excluded}`,
    `calibration.snapshot.excluded=${snapshotCounts.excluded}`,
    `calibration.controls.excluded=${excludedCount}`,
  ];

  if (
    fixtureCounts.retained !== prerequisiteCounts.retained ||
    fixtureCounts.retained !== snapshotCounts.retained ||
    fixtureCounts.retained !== retainedCount
  ) {
    problems.push(`retained drift: ${retainedValues.join(", ")}`);
  }
  if (
    fixtureCounts.excluded !== prerequisiteCounts.excluded ||
    fixtureCounts.excluded !== snapshotCounts.excluded ||
    fixtureCounts.excluded !== excludedCount
  ) {
    problems.push(`excluded drift: ${excludedValues.join(", ")}`);
  }

  return problems.length === 0
    ? passCheck(
        "M046-S03-COUNT-CONSISTENCY",
        "nested_counts_consistent",
        `retained=${fixtureCounts.retained} excluded=${fixtureCounts.excluded}`,
      )
    : failCheck(
        "M046-S03-COUNT-CONSISTENCY",
        "nested_count_drift",
        problems,
      );
}

function buildVerdictSummary(params: {
  calibration: M046S02EvaluationReport | null;
}): {
  summary: VerdictSummary;
  check: Check;
} {
  if (!params.calibration) {
    return {
      summary: {
        value: null,
        rationale: [],
        statusCode: null,
      },
      check: skippedCheck(
        "M046-S03-VERDICT",
        "final_verdict_unchecked",
        "Calibration report was unavailable.",
      ),
    };
  }

  const recommendation = normalizeRecommendationSummary(
    params.calibration.calibration?.recommendation,
  );

  if (!recommendation) {
    return {
      summary: {
        value: null,
        rationale: [],
        statusCode: "final_verdict_missing",
      },
      check: failCheck(
        "M046-S03-VERDICT",
        "final_verdict_missing",
        "Calibration report completed without a keep/retune/replace recommendation.",
      ),
    };
  }

  if (!params.calibration.overallPassed) {
    return {
      summary: {
        value: recommendation.verdict,
        rationale: recommendation.rationale,
        statusCode: "final_verdict_untrusted",
      },
      check: failCheck(
        "M046-S03-VERDICT",
        "final_verdict_untrusted",
        "Calibration proof did not pass, so the recommendation cannot be treated as the final verdict.",
      ),
    };
  }

  return {
    summary: {
      value: recommendation.verdict,
      rationale: recommendation.rationale,
      statusCode: `${recommendation.verdict}_recommended`,
    },
    check: passCheck(
      "M046-S03-VERDICT",
      `${recommendation.verdict}_recommended`,
      `rationale_lines=${recommendation.rationale.length}`,
    ),
  };
}

function buildChangeContractCheck(params: {
  calibration: M046S02EvaluationReport | null;
  verdict: VerdictSummary;
  buildChangeContract: (
    recommendation: {
      verdict?: unknown;
      rationale?: unknown;
    },
  ) => unknown;
}): {
  contract: CalibrationChangeContract | null;
  check: Check;
} {
  if (!params.calibration) {
    return {
      contract: null,
      check: skippedCheck(
        "M046-S03-M047-CHANGE-CONTRACT",
        "m047_change_contract_skipped",
        "Calibration report was unavailable.",
      ),
    };
  }

  if (params.verdict.statusCode === "final_verdict_missing") {
    return {
      contract: null,
      check: skippedCheck(
        "M046-S03-M047-CHANGE-CONTRACT",
        "m047_change_contract_skipped",
        "Final verdict was unavailable, so the change contract was not derived.",
      ),
    };
  }

  if (params.verdict.statusCode === "final_verdict_untrusted") {
    return {
      contract: null,
      check: skippedCheck(
        "M046-S03-M047-CHANGE-CONTRACT",
        "m047_change_contract_skipped",
        "Calibration proof did not pass, so the M047 contract was not trusted.",
      ),
    };
  }

  const recommendation = normalizeRecommendationSummary(
    params.calibration.calibration?.recommendation,
  );
  if (!recommendation) {
    return {
      contract: null,
      check: skippedCheck(
        "M046-S03-M047-CHANGE-CONTRACT",
        "m047_change_contract_skipped",
        "Final verdict was unavailable, so the change contract was not derived.",
      ),
    };
  }

  try {
    const rawContract = params.buildChangeContract(recommendation);
    const normalizedContract = normalizeChangeContract(
      rawContract,
      recommendation.verdict,
    );

    if (!normalizedContract.contract || !normalizedContract.statusCode) {
      return {
        contract: null,
        check: failCheck(
          "M046-S03-M047-CHANGE-CONTRACT",
          normalizedContract.statusCode ?? "m047_change_contract_malformed",
          normalizedContract.detail,
        ),
      };
    }

    return {
      contract: normalizedContract.contract,
      check: passCheck(
        "M046-S03-M047-CHANGE-CONTRACT",
        normalizedContract.statusCode,
        `keep=${normalizedContract.contract.keep.length} change=${normalizedContract.contract.change.length} replace=${normalizedContract.contract.replace.length}`,
      ),
    };
  } catch (error) {
    const statusCode = readErrorCode(error) ?? "m047_change_contract_failed";
    return {
      contract: null,
      check: failCheck(
        "M046-S03-M047-CHANGE-CONTRACT",
        statusCode,
        normalizeDetail(error),
      ),
    };
  }
}

function normalizeFixtureReport(raw: unknown): ValidationResult<M046S01EvaluationReport> {
  if (!isRecord(raw)) {
    return {
      report: null,
      problem: "embedded verify:m046:s01 result was missing or malformed.",
    };
  }

  if (
    raw.command !== "verify:m046:s01" ||
    typeof raw.generatedAt !== "string" ||
    typeof raw.overallPassed !== "boolean" ||
    !isStringArray(raw.check_ids) ||
    !isCheckArray(raw.checks)
  ) {
    return {
      report: null,
      problem:
        "embedded verify:m046:s01 result omitted command, generatedAt, overallPassed, check_ids, or checks.",
    };
  }

  if (raw.counts !== null && raw.counts !== undefined && !isCounts(raw.counts)) {
    return {
      report: null,
      problem: "embedded verify:m046:s01 result carried malformed retained/excluded counts.",
    };
  }

  if (
    raw.diagnostics !== null &&
    raw.diagnostics !== undefined &&
    (!isRecord(raw.diagnostics) ||
      (raw.diagnostics.statusCode != null && typeof raw.diagnostics.statusCode !== "string"))
  ) {
    return {
      report: null,
      problem: "embedded verify:m046:s01 result carried malformed diagnostics.",
    };
  }

  return {
    report: raw as M046S01EvaluationReport,
    problem: null,
  };
}

function normalizeCalibrationReport(
  raw: unknown,
): ValidationResult<M046S02EvaluationReport> {
  if (!isRecord(raw)) {
    return {
      report: null,
      problem: "embedded verify:m046:s02 result was missing or malformed.",
    };
  }

  if (
    raw.command !== "verify:m046:s02" ||
    typeof raw.generatedAt !== "string" ||
    typeof raw.overallPassed !== "boolean" ||
    !isStringArray(raw.check_ids) ||
    !isCheckArray(raw.checks) ||
    !isSnapshotSummary(raw.snapshot)
  ) {
    return {
      report: null,
      problem:
        "embedded verify:m046:s02 result omitted command, generatedAt, overallPassed, check_ids, checks, or snapshot.",
    };
  }

  if (raw.prerequisite !== null && raw.prerequisite !== undefined && !isPrerequisiteSummary(raw.prerequisite)) {
    return {
      report: null,
      problem: "embedded verify:m046:s02 result carried malformed prerequisite diagnostics.",
    };
  }

  if (raw.calibration !== null && raw.calibration !== undefined && !isCalibrationSummary(raw.calibration)) {
    return {
      report: null,
      problem: "embedded verify:m046:s02 result carried malformed calibration diagnostics.",
    };
  }

  return {
    report: raw as M046S02EvaluationReport,
    problem: null,
  };
}

function normalizeRecommendationSummary(
  raw: unknown,
): RecommendationSummary | null {
  if (!isRecord(raw)) {
    return null;
  }
  if (!isSupportedVerdict(raw.verdict) || !isStringArray(raw.rationale) || raw.rationale.length === 0) {
    return null;
  }

  return {
    verdict: raw.verdict,
    rationale: [...raw.rationale],
  };
}

function normalizeChangeContract(
  raw: unknown,
  expectedVerdict: CalibrationRecommendationVerdict,
): ContractValidationResult {
  if (!isRecord(raw)) {
    return {
      contract: null,
      statusCode: "m047_change_contract_malformed",
      detail: "Change contract was missing or non-object.",
    };
  }

  if (!isSupportedVerdict(raw.verdict)) {
    return {
      contract: null,
      statusCode: "m047_change_contract_malformed",
      detail: "Change contract omitted a supported verdict.",
    };
  }
  if (raw.verdict !== expectedVerdict) {
    return {
      contract: null,
      statusCode: "contract_verdict_mismatch",
      detail: `Contract verdict=${raw.verdict} did not match recommendation verdict=${expectedVerdict}.`,
    };
  }

  if (!isStringArray(raw.rationale) || raw.rationale.length === 0) {
    return {
      contract: null,
      statusCode: "missing-recommendation-rationale",
      detail: "Change contract omitted rationale lines.",
    };
  }

  if (!Array.isArray(raw.keep) || !Array.isArray(raw.change) || !Array.isArray(raw.replace)) {
    return {
      contract: null,
      statusCode: "m047_change_contract_malformed",
      detail: "Change contract omitted keep/change/replace buckets.",
    };
  }

  const keep = normalizeContractBucketEntries(raw.keep, "keep");
  if (!keep.entries || keep.problem) {
    return {
      contract: null,
      statusCode: keep.problemCode,
      detail: keep.problem,
    };
  }
  const change = normalizeContractBucketEntries(raw.change, "change");
  if (!change.entries || change.problem) {
    return {
      contract: null,
      statusCode: change.problemCode,
      detail: change.problem,
    };
  }
  const replace = normalizeContractBucketEntries(raw.replace, "replace");
  if (!replace.entries || replace.problem) {
    return {
      contract: null,
      statusCode: replace.problemCode,
      detail: replace.problem,
    };
  }

  const duplicate = findDuplicateMechanism({
    keep: keep.entries,
    change: change.entries,
    replace: replace.entries,
  });
  if (duplicate) {
    return {
      contract: null,
      statusCode: duplicate.statusCode,
      detail: duplicate.detail,
    };
  }

  const missingBucket = findMissingRequiredBucket({
    verdict: raw.verdict,
    keep: keep.entries,
    change: change.entries,
    replace: replace.entries,
  });
  if (missingBucket) {
    return {
      contract: null,
      statusCode: missingBucket.statusCode,
      detail: missingBucket.detail,
    };
  }

  return {
    contract: {
      verdict: raw.verdict,
      rationale: [...raw.rationale],
      keep: keep.entries,
      change: change.entries,
      replace: replace.entries,
    },
    statusCode: "m047_change_contract_complete",
    detail: null,
  };
}

function normalizeContractBucketEntries(
  raw: unknown[],
  bucket: "keep" | "change" | "replace",
): {
  entries: CalibrationChangeContractEntry[] | null;
  problemCode: string;
  problem: string | null;
} {
  const entries: CalibrationChangeContractEntry[] = [];

  for (const candidate of raw) {
    if (!isRecord(candidate)) {
      return {
        entries: null,
        problemCode: "m047_change_contract_malformed",
        problem: `${bucket} bucket contained a non-object entry.`,
      };
    }

    if (
      typeof candidate.mechanism !== "string" ||
      candidate.mechanism.trim().length === 0
    ) {
      return {
        entries: null,
        problemCode: "missing-mechanism",
        problem: `${bucket} bucket contained an entry without a mechanism id.`,
      };
    }

    if (
      typeof candidate.summary !== "string" ||
      candidate.summary.trim().length === 0 ||
      typeof candidate.rationale !== "string" ||
      candidate.rationale.trim().length === 0
    ) {
      return {
        entries: null,
        problemCode: "missing-contract-text",
        problem: `${candidate.mechanism} omitted summary or rationale text.`,
      };
    }

    if (!isStringArray(candidate.evidence) || candidate.evidence.length === 0) {
      return {
        entries: null,
        problemCode: "missing-evidence",
        problem: `${candidate.mechanism} omitted evidence strings.`,
      };
    }

    if (!isStringArray(candidate.impactedSurfaces) || candidate.impactedSurfaces.length === 0) {
      return {
        entries: null,
        problemCode: "missing-impacted-surface",
        problem: `${candidate.mechanism} omitted impacted surfaces.`,
      };
    }

    entries.push({
      mechanism: candidate.mechanism,
      summary: candidate.summary,
      rationale: candidate.rationale,
      evidence: [...candidate.evidence],
      impactedSurfaces: [...candidate.impactedSurfaces],
    });
  }

  return {
    entries,
    problemCode: "m047_change_contract_malformed",
    problem: null,
  };
}

function findDuplicateMechanism(buckets: {
  keep: CalibrationChangeContractEntry[];
  change: CalibrationChangeContractEntry[];
  replace: CalibrationChangeContractEntry[];
}): { statusCode: string; detail: string } | null {
  const seen = new Map<string, "keep" | "change" | "replace">();

  for (const [bucket, entries] of Object.entries(buckets) as Array<[
    "keep" | "change" | "replace",
    CalibrationChangeContractEntry[],
  ]>) {
    for (const entry of entries) {
      const priorBucket = seen.get(entry.mechanism);
      if (!priorBucket) {
        seen.set(entry.mechanism, bucket);
        continue;
      }

      return priorBucket === bucket
        ? {
            statusCode: "duplicate-mechanism",
            detail: `Contract mechanism ${entry.mechanism} appeared multiple times in ${bucket}.`,
          }
        : {
            statusCode: "contradictory-mechanism-bucket",
            detail: `Contract mechanism ${entry.mechanism} cannot appear in both ${priorBucket} and ${bucket}.`,
          };
    }
  }

  return null;
}

function findMissingRequiredBucket(params: {
  verdict: CalibrationRecommendationVerdict;
  keep: CalibrationChangeContractEntry[];
  change: CalibrationChangeContractEntry[];
  replace: CalibrationChangeContractEntry[];
}): { statusCode: string; detail: string } | null {
  if (params.keep.length === 0) {
    return {
      statusCode: "empty-keep-bucket",
      detail: `Contract verdict ${params.verdict} must include at least one keep mechanism.`,
    };
  }

  if (params.verdict !== "keep" && params.change.length === 0) {
    return {
      statusCode: "empty-change-bucket",
      detail: `Contract verdict ${params.verdict} must include at least one change mechanism.`,
    };
  }

  if (params.verdict === "replace" && params.replace.length === 0) {
    return {
      statusCode: "empty-replace-bucket",
      detail: "Replace verdict must include at least one replace mechanism.",
    };
  }

  return null;
}

function renderContractBucket(
  lines: string[],
  bucket: "keep" | "change" | "replace",
  entries: readonly CalibrationChangeContractEntry[],
): void {
  lines.push(`${bucket}:`);
  if (entries.length === 0) {
    lines.push("- none");
    return;
  }

  for (const entry of entries) {
    lines.push(`- ${entry.mechanism}: ${entry.summary}`);
  }
}

function collectFailingChecks(checks: readonly { id: string; passed: boolean; skipped: boolean; status_code: string }[]): string[] {
  return checks
    .filter((check) => !check.passed && !check.skipped)
    .map((check) => `${check.id}:${check.status_code}`);
}

function passCheck(id: M046CheckId, status_code: string, detail?: unknown): Check {
  return {
    id,
    passed: true,
    skipped: false,
    status_code,
    detail: detail == null ? undefined : normalizeDetail(detail),
  };
}

function skippedCheck(id: M046CheckId, status_code: string, detail?: unknown): Check {
  return {
    id,
    passed: true,
    skipped: true,
    status_code,
    detail: detail == null ? undefined : normalizeDetail(detail),
  };
}

function failCheck(id: M046CheckId, status_code: string, detail?: unknown): Check {
  return {
    id,
    passed: false,
    skipped: false,
    status_code,
    detail: detail == null ? undefined : normalizeDetail(detail),
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

function readErrorCode(error: unknown): string | null {
  if (!isRecord(error) || typeof error.code !== "string") {
    return null;
  }
  return error.code;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isCounts(value: unknown): value is Counts {
  return (
    isRecord(value) &&
    typeof value.retained === "number" &&
    typeof value.excluded === "number"
  );
}

function isCheckArray(value: unknown): value is Check[] {
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

function isPrerequisiteSummary(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.command === "string" &&
    typeof value.overallPassed === "boolean" &&
    (value.statusCode == null || typeof value.statusCode === "string") &&
    isStringArray(value.failingChecks) &&
    (value.counts == null || isCounts(value.counts))
  );
}

function isSnapshotSummary(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.path === "string" &&
    typeof value.manifestPath === "string" &&
    typeof value.isLoadable === "boolean" &&
    typeof value.isValid === "boolean" &&
    (value.parseError == null || typeof value.parseError === "string") &&
    (value.status == null || typeof value.status === "string") &&
    (value.diagnosticsStatusCode == null || typeof value.diagnosticsStatusCode === "string") &&
    (value.counts == null || isCounts(value.counts))
  );
}

function isCalibrationSummary(value: unknown): boolean {
  if (!isRecord(value) || !isStringArray(value.retainedIds) || !Array.isArray(value.excludedControls)) {
    return false;
  }

  if (
    value.excludedControls.some(
      (entry) =>
        !isRecord(entry) ||
        typeof entry.normalizedId !== "string" ||
        typeof entry.exclusionReason !== "string" ||
        typeof entry.includedInEvaluation !== "boolean",
    )
  ) {
    return false;
  }

  return value.recommendation == null || normalizeRecommendationSummary(value.recommendation) !== null;
}

function isSupportedVerdict(
  verdict: unknown,
): verdict is CalibrationRecommendationVerdict {
  return verdict === "keep" || verdict === "retune" || verdict === "replace";
}

if (import.meta.main) {
  try {
    const args = parseM046Args(process.argv.slice(2));
    const { exitCode } = await buildM046ProofHarness(args);
    process.exit(exitCode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`verify:m046 failed: ${message}\n`);
    process.exit(1);
  }
}
