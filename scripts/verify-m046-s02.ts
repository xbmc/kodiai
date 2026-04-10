import { loadFixtureManifest } from "../src/contributor/fixture-set.ts";
import {
  DEFAULT_XBMC_CALIBRATION_RETAINED_IDS,
  evaluateCalibrationSnapshot,
  type CalibrationRecommendationVerdict,
} from "../src/contributor/calibration-evaluator.ts";
import {
  loadAndInspectXbmcFixtureSnapshot,
  type XbmcFixtureSnapshot,
} from "../src/contributor/xbmc-fixture-snapshot.ts";
import { evaluateM046S01 } from "./verify-m046-s01.ts";

const DEFAULT_MANIFEST_PATH = "fixtures/contributor-calibration/xbmc-manifest.json";
const DEFAULT_SNAPSHOT_PATH = "fixtures/contributor-calibration/xbmc-snapshot.json";
const COMMAND_NAME = "verify:m046:s02" as const;

export const M046_S02_CHECK_IDS = [
  "M046-S02-S01-PREREQUISITE",
  "M046-S02-SNAPSHOT-VALID",
  "M046-S02-RETAINED-COHORT-TRUTH",
  "M046-S02-EXCLUDED-CONTROLS-TRUTH",
  "M046-S02-EVALUATOR-REPORT",
  "M046-S02-RECOMMENDATION",
] as const;

export type M046S02CheckId = (typeof M046_S02_CHECK_IDS)[number];

export type Check = {
  id: M046S02CheckId;
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail?: string;
};

export type PrerequisiteSummary = {
  command: string;
  overallPassed: boolean;
  statusCode: string | null;
  failingChecks: string[];
  counts: {
    retained: number;
    excluded: number;
  } | null;
};

export type SnapshotSummary = {
  path: string;
  manifestPath: string;
  isLoadable: boolean;
  isValid: boolean;
  parseError: string | null;
  status: string | null;
  diagnosticsStatusCode: string | null;
  counts: {
    retained: number;
    excluded: number;
  } | null;
};

export type CalibrationContributorSummary = {
  normalizedId: string;
  displayName: string | null;
  cohort: string | null;
  fixtureEvidence: {
    commitCounts: {
      allTime: number;
      since2025: number;
    } | null;
    latestEvidenceAt: string | null;
    signalAvailability: {
      githubCommit: boolean;
      githubPull: boolean;
      githubReview: boolean;
      localGit: boolean;
    } | null;
  };
  live: {
    contract: {
      state: string;
      promptTier: string;
    };
    rank: number | null;
    percentile: number | null;
  };
  intended: {
    contract: {
      state: string;
      promptTier: string;
    };
    rank: number | null;
    percentile: number | null;
  };
  instability: {
    live: {
      hasScoreTie: boolean;
      possibleRankRange: {
        min: number;
        max: number;
      } | null;
    };
    intended: {
      hasScoreTie: boolean;
      possibleRankRange: {
        min: number;
        max: number;
      } | null;
    };
  };
  freshness: {
    freshnessBand: string;
    linkedProfileState: string;
    findings: string[];
  };
};

export type CalibrationControlSummary = {
  normalizedId: string;
  exclusionReason: string;
  includedInEvaluation: boolean;
};

export type CalibrationSummary = {
  referenceTime: string | null;
  retainedIds: string[];
  assumptions: string[];
  rows: CalibrationContributorSummary[];
  excludedControls: CalibrationControlSummary[];
  findings: {
    liveScoreCompression: boolean;
    divergentContributorIds: string[];
    staleContributorIds: string[];
  };
  recommendation: {
    verdict: CalibrationRecommendationVerdict;
    rationale: string[];
  } | null;
};

export type EvaluationReport = {
  command: typeof COMMAND_NAME;
  generatedAt: string;
  check_ids: readonly M046S02CheckId[];
  overallPassed: boolean;
  prerequisite: PrerequisiteSummary | null;
  snapshot: SnapshotSummary;
  calibration: CalibrationSummary | null;
  checks: Check[];
};

type StdWriter = {
  write: (chunk: string) => boolean | void;
};

export type EvaluateM046S02Options = {
  manifestPath?: string;
  snapshotPath?: string;
  generatedAt?: string;
  referenceTime?: string | Date;
  readSnapshotFile?: (path: string) => Promise<string>;
  loadManifest?: typeof loadFixtureManifest;
  _evaluateS01?: (options?: Record<string, unknown>) => Promise<unknown>;
  _evaluateCalibration?: (
    snapshot: XbmcFixtureSnapshot,
    options?: { referenceTime?: string | Date },
  ) => unknown | Promise<unknown>;
};

type BuildProofHarnessOptions = EvaluateM046S02Options & {
  json?: boolean;
  stdout?: StdWriter;
  stderr?: StdWriter;
};

export async function evaluateM046S02(
  options: EvaluateM046S02Options = {},
): Promise<EvaluationReport> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const manifestPath = options.manifestPath ?? DEFAULT_MANIFEST_PATH;
  const snapshotPath = options.snapshotPath ?? DEFAULT_SNAPSHOT_PATH;
  const loadManifestImpl = options.loadManifest ?? loadFixtureManifest;
  const evaluateS01Impl = options._evaluateS01 ?? evaluateM046S01;
  const evaluateCalibrationImpl =
    options._evaluateCalibration ?? evaluateCalibrationSnapshot;

  let prerequisite: PrerequisiteSummary | null = null;
  let prerequisiteCheck: Check;
  try {
    const raw = await evaluateS01Impl({
      manifestPath,
      snapshotPath,
      generatedAt,
      readSnapshotFile: options.readSnapshotFile,
    });
    const normalized = normalizePrerequisiteSummary(raw);
    prerequisite = normalized.summary;
    prerequisiteCheck = normalized.problem
      ? failCheck(
          "M046-S02-S01-PREREQUISITE",
          "prerequisite_fixture_verifier_malformed",
          normalized.problem,
        )
      : prerequisite?.overallPassed
        ? passCheck(
            "M046-S02-S01-PREREQUISITE",
            "prerequisite_fixture_verifier_passed",
          )
        : failCheck(
            "M046-S02-S01-PREREQUISITE",
            "prerequisite_fixture_verifier_failed",
            prerequisite?.failingChecks.join(", ") || "embedded verify:m046:s01 reported failure.",
          );
  } catch (error) {
    prerequisiteCheck = failCheck(
      "M046-S02-S01-PREREQUISITE",
      "prerequisite_fixture_verifier_failed",
      error,
    );
  }

  const snapshotInspection = await loadAndInspectXbmcFixtureSnapshot(snapshotPath, {
    readSnapshotFile: options.readSnapshotFile,
  });
  const snapshot: SnapshotSummary = {
    path: snapshotPath,
    manifestPath,
    isLoadable: snapshotInspection.parseError === null,
    isValid: snapshotInspection.isValid,
    parseError: snapshotInspection.parseError,
    status: snapshotInspection.snapshot?.status ?? null,
    diagnosticsStatusCode: snapshotInspection.snapshot?.diagnostics.statusCode ?? null,
    counts: snapshotInspection.counts,
  };

  const snapshotCheck = snapshotInspection.parseError
    ? failCheck(
        "M046-S02-SNAPSHOT-VALID",
        "fixture_snapshot_malformed_json",
        snapshotInspection.parseError,
      )
    : snapshotInspection.isValid
      ? passCheck("M046-S02-SNAPSHOT-VALID", "fixture_snapshot_valid")
      : failCheck(
          "M046-S02-SNAPSHOT-VALID",
          "fixture_snapshot_invalid",
          snapshotInspection.validationIssues,
        );

  let manifestRetainedIds: string[] | null = null;
  let manifestExcludedIds: string[] | null = null;
  let manifestProblem: string | null = null;
  try {
    const manifest = await loadManifestImpl(manifestPath);
    manifestRetainedIds = manifest.retained.map((entry) => entry.normalizedId).sort(compareText);
    manifestExcludedIds = manifest.excluded.map((entry) => entry.normalizedId).sort(compareText);
  } catch (error) {
    manifestProblem = error instanceof Error ? error.message : String(error);
  }

  let calibration: CalibrationSummary | null = null;
  let evaluationCheck: Check;
  if (
    prerequisiteCheck.passed &&
    !prerequisiteCheck.skipped &&
    snapshotCheck.passed &&
    !snapshotCheck.skipped &&
    snapshotInspection.snapshot
  ) {
    try {
      const raw = await Promise.resolve(
        evaluateCalibrationImpl(snapshotInspection.snapshot, {
          referenceTime: options.referenceTime,
        }),
      );
      const normalized = normalizeCalibrationSummary(raw);
      calibration = normalized.summary;
      evaluationCheck = normalized.problem
        ? failCheck(
            "M046-S02-EVALUATOR-REPORT",
            "calibration_report_invalid",
            normalized.problem,
          )
        : passCheck(
            "M046-S02-EVALUATOR-REPORT",
            "calibration_report_complete",
          );
    } catch (error) {
      evaluationCheck = failCheck(
        "M046-S02-EVALUATOR-REPORT",
        "calibration_evaluation_failed",
        error,
      );
    }
  } else {
    evaluationCheck = skippedCheck(
      "M046-S02-EVALUATOR-REPORT",
      "calibration_evaluation_skipped",
      "Calibration evaluation was skipped because prerequisite verification or snapshot validation failed.",
    );
  }

  const retainedTruthCheck = buildRetainedTruthCheck({
    manifestRetainedIds,
    manifestExcludedIds,
    manifestProblem,
    snapshotRetainedIds: snapshotInspection.coreSnapshot?.retained.map((entry) => entry.normalizedId) ?? null,
    evaluationRetainedIds: calibration?.rows.map((row) => row.normalizedId) ?? null,
  });

  const excludedControlsCheck = buildExcludedControlsCheck({
    manifestExcludedIds,
    manifestProblem,
    snapshotExcludedIds: snapshotInspection.coreSnapshot?.excluded.map((entry) => entry.normalizedId) ?? null,
    evaluationExcludedIds: calibration?.excludedControls.map((row) => row.normalizedId) ?? null,
    includedControlFlags: calibration?.excludedControls.map((row) => row.includedInEvaluation) ?? null,
    evaluationRetainedIds: calibration?.rows.map((row) => row.normalizedId) ?? null,
  });

  const recommendationCheck = buildRecommendationCheck({
    calibration,
    evaluationCheck,
  });

  const checks = [
    prerequisiteCheck,
    snapshotCheck,
    retainedTruthCheck,
    excludedControlsCheck,
    evaluationCheck,
    recommendationCheck,
  ];

  return {
    command: COMMAND_NAME,
    generatedAt,
    check_ids: M046_S02_CHECK_IDS,
    overallPassed: checks.every((check) => check.passed || check.skipped),
    prerequisite,
    snapshot,
    calibration,
    checks,
  };
}

export function renderM046S02Report(report: EvaluationReport): string {
  const lines = [
    "M046 S02 proof harness: xbmc live-vs-intended calibration verifier",
    `Generated at: ${report.generatedAt}`,
    `Final verdict: ${report.overallPassed ? "PASS" : "FAIL"}`,
  ];

  if (!report.prerequisite) {
    lines.push("Prerequisite: unavailable");
  } else {
    lines.push(
      `Prerequisite: ${report.prerequisite.overallPassed ? "PASS" : "FAIL"} command=${report.prerequisite.command} status=${report.prerequisite.statusCode ?? "unknown"}`,
    );
    if (report.prerequisite.counts) {
      lines.push(
        `Prerequisite counts: retained=${report.prerequisite.counts.retained} excluded=${report.prerequisite.counts.excluded}`,
      );
    }
    if (report.prerequisite.failingChecks.length > 0) {
      lines.push(`Prerequisite failing checks: ${report.prerequisite.failingChecks.join(", ")}`);
    }
  }

  lines.push(
    `Snapshot: loadable=${report.snapshot.isLoadable ? "yes" : "no"} valid=${report.snapshot.isValid ? "yes" : "no"} status=${report.snapshot.status ?? "unknown"} diagnostics=${report.snapshot.diagnosticsStatusCode ?? "unknown"}`,
  );
  if (report.snapshot.counts) {
    lines.push(
      `Snapshot counts: retained=${report.snapshot.counts.retained} excluded=${report.snapshot.counts.excluded}`,
    );
  }
  if (report.snapshot.parseError) {
    lines.push(`Snapshot parse error: ${report.snapshot.parseError}`);
  }

  if (!report.calibration) {
    lines.push("Calibration: unavailable");
  } else {
    lines.push(`Reference time: ${report.calibration.referenceTime ?? "unknown"}`);
    lines.push(
      `Recommendation: ${report.calibration.recommendation?.verdict ?? "missing"}`,
    );
    if (report.calibration.recommendation?.rationale.length) {
      lines.push("Recommendation rationale:");
      for (const rationale of report.calibration.recommendation.rationale) {
        lines.push(`- ${rationale}`);
      }
    }
    if (report.calibration.assumptions.length > 0) {
      lines.push("Assumptions:");
      for (const assumption of report.calibration.assumptions) {
        lines.push(`- ${assumption}`);
      }
    }
    lines.push(
      `Findings: liveCompression=${report.calibration.findings.liveScoreCompression ? "yes" : "no"} divergent=${formatList(report.calibration.findings.divergentContributorIds)} stale=${formatList(report.calibration.findings.staleContributorIds)}`,
    );
    lines.push("Retained contributors:");
    for (const row of report.calibration.rows) {
      lines.push(
        `- ${row.normalizedId} cohort=${row.cohort ?? "unknown"} live=${row.live.contract.state}/${row.live.contract.promptTier} intended=${row.intended.contract.state}/${row.intended.contract.promptTier} live_percentile=${formatPercentile(row.live.percentile)} intended_percentile=${formatPercentile(row.intended.percentile)} live_tie=${row.instability.live.hasScoreTie ? "yes" : "no"} intended_tie=${row.instability.intended.hasScoreTie ? "yes" : "no"}`,
      );
      lines.push(
        `  evidence: commits_since2025=${row.fixtureEvidence.commitCounts?.since2025 ?? "unknown"} commits_all=${row.fixtureEvidence.commitCounts?.allTime ?? "unknown"} latest=${row.fixtureEvidence.latestEvidenceAt ?? "unknown"} signals=${formatSignals(row.fixtureEvidence.signalAvailability)}`,
      );
      lines.push(
        `  freshness: freshness=${row.freshness.freshnessBand} linked=${row.freshness.linkedProfileState} findings=${formatList(row.freshness.findings)}`,
      );
      lines.push(
        `  instability: live_rank=${formatRankRange(row.instability.live.possibleRankRange)} intended_rank=${formatRankRange(row.instability.intended.possibleRankRange)}`,
      );
    }
    lines.push("Excluded controls:");
    for (const control of report.calibration.excludedControls) {
      lines.push(`- ${control.normalizedId} (${control.exclusionReason})`);
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

export async function buildM046S02ProofHarness(
  options: BuildProofHarnessOptions = {},
): Promise<{ exitCode: number; report: EvaluationReport }> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const report = await evaluateM046S02(options);

  if (options.json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    stdout.write(renderM046S02Report(report));
  }

  if (!report.overallPassed) {
    const failingCodes = report.checks
      .filter((check) => !check.passed && !check.skipped)
      .map((check) => `${check.id}:${check.status_code}`)
      .join(", ");
    stderr.write(`verify:m046:s02 failed: ${failingCodes}\n`);
  }

  return {
    exitCode: report.overallPassed ? 0 : 1,
    report,
  };
}

export function parseM046S02Args(args: readonly string[]): { json: boolean } {
  let json = false;

  for (const arg of args) {
    if (arg === "--json") {
      json = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { json };
}

function normalizePrerequisiteSummary(raw: unknown): {
  summary: PrerequisiteSummary | null;
  problem: string | null;
} {
  if (!isRecord(raw)) {
    return {
      summary: null,
      problem: "embedded verify:m046:s01 result was missing or malformed.",
    };
  }

  if (typeof raw.command !== "string" || typeof raw.overallPassed !== "boolean") {
    return {
      summary: null,
      problem: "embedded verify:m046:s01 result omitted command or overallPassed.",
    };
  }

  const checks = Array.isArray(raw.checks)
    ? raw.checks
        .filter(isRecord)
        .map((check) => ({
          id: typeof check.id === "string" ? check.id : "unknown-check",
          passed: check.passed === true,
          skipped: check.skipped === true,
          status_code:
            typeof check.status_code === "string"
              ? check.status_code
              : "unknown-status-code",
        }))
    : [];

  const failingChecks = checks
    .filter((check) => !check.passed && !check.skipped)
    .map((check) => `${check.id}:${check.status_code}`);

  return {
    summary: {
      command: raw.command,
      overallPassed: raw.overallPassed,
      statusCode: readNestedString(raw, ["diagnostics", "statusCode"]),
      failingChecks,
      counts: normalizeCounts(raw.counts),
    },
    problem: null,
  };
}

function normalizeCalibrationSummary(raw: unknown): {
  summary: CalibrationSummary | null;
  problem: string | null;
} {
  if (!isRecord(raw)) {
    return {
      summary: null,
      problem: "calibration evaluator returned a non-object report.",
    };
  }

  const retainedIds = toStringArray(raw.retainedIds);
  const assumptions = toStringArray(raw.assumptions) ?? [];
  const rowsRaw = Array.isArray(raw.rows) ? raw.rows : null;
  const excludedControlsRaw = Array.isArray(raw.excludedControls)
    ? raw.excludedControls
    : null;
  const findingsRaw = isRecord(raw.findings) ? raw.findings : null;

  if (!retainedIds || retainedIds.length === 0) {
    return {
      summary: null,
      problem: "calibration evaluator omitted retainedIds.",
    };
  }
  if (!rowsRaw || rowsRaw.length === 0) {
    return {
      summary: null,
      problem: "calibration evaluator omitted retained contributor rows.",
    };
  }
  if (!excludedControlsRaw) {
    return {
      summary: null,
      problem: "calibration evaluator omitted excluded control rows.",
    };
  }
  if (
    !findingsRaw ||
    typeof findingsRaw.liveScoreCompression !== "boolean" ||
    !toStringArray(findingsRaw.divergentContributorIds) ||
    !toStringArray(findingsRaw.staleContributorIds)
  ) {
    return {
      summary: null,
      problem: "calibration evaluator omitted findings diagnostics.",
    };
  }

  const rows: CalibrationContributorSummary[] = [];
  for (const row of rowsRaw) {
    if (!isRecord(row)) {
      return {
        summary: null,
        problem: "calibration evaluator returned a non-object contributor row.",
      };
    }

    const liveContract = normalizeContract(readRecord(row.live)?.contract);
    const intendedContract = normalizeContract(readRecord(row.intended)?.contract);
    const freshness = readRecord(row.freshness);
    if (!liveContract || !intendedContract || !freshness) {
      return {
        summary: null,
        problem: `calibration row ${String(row.normalizedId ?? "unknown")} omitted contract or freshness diagnostics.`,
      };
    }
    if (
      typeof row.normalizedId !== "string" ||
      typeof freshness.freshnessBand !== "string" ||
      typeof freshness.linkedProfileState !== "string"
    ) {
      return {
        summary: null,
        problem: "calibration row omitted normalizedId or freshness fields.",
      };
    }

    rows.push({
      normalizedId: row.normalizedId,
      displayName: typeof row.displayName === "string" ? row.displayName : null,
      cohort: typeof row.cohort === "string" ? row.cohort : null,
      fixtureEvidence: {
        commitCounts: normalizeCommitCounts(readRecord(row.fixtureEvidence)?.commitCounts),
        latestEvidenceAt: readNestedString(row, ["fixtureEvidence", "latestEvidenceAt"]),
        signalAvailability: normalizeSignalAvailability(
          readRecord(readRecord(row.fixtureEvidence)?.signalAvailability),
        ),
      },
      live: {
        contract: liveContract,
        rank: toOptionalNumber(readRecord(row.live)?.rank),
        percentile: toOptionalNumber(readRecord(row.live)?.percentile),
      },
      intended: {
        contract: intendedContract,
        rank: toOptionalNumber(readRecord(row.intended)?.rank),
        percentile: toOptionalNumber(readRecord(row.intended)?.percentile),
      },
      instability: {
        live: {
          hasScoreTie:
            readRecord(readRecord(row.instability)?.live)?.hasScoreTie === true,
          possibleRankRange: normalizeRankRange(
            readRecord(readRecord(row.instability)?.live)?.possibleRankRange,
          ),
        },
        intended: {
          hasScoreTie:
            readRecord(readRecord(row.instability)?.intended)?.hasScoreTie === true,
          possibleRankRange: normalizeRankRange(
            readRecord(readRecord(row.instability)?.intended)?.possibleRankRange,
          ),
        },
      },
      freshness: {
        freshnessBand: freshness.freshnessBand,
        linkedProfileState: freshness.linkedProfileState,
        findings: toStringArray(freshness.findings) ?? [],
      },
    });
  }

  const excludedControls: CalibrationControlSummary[] = [];
  for (const control of excludedControlsRaw) {
    if (
      !isRecord(control) ||
      typeof control.normalizedId !== "string" ||
      typeof control.exclusionReason !== "string" ||
      typeof control.includedInEvaluation !== "boolean"
    ) {
      return {
        summary: null,
        problem: "calibration evaluator returned malformed excluded control diagnostics.",
      };
    }

    excludedControls.push({
      normalizedId: control.normalizedId,
      exclusionReason: control.exclusionReason,
      includedInEvaluation: control.includedInEvaluation,
    });
  }

  const recommendation = normalizeRecommendation(raw.recommendation);
  if (isRecord(raw.recommendation) && !recommendation) {
    return {
      summary: null,
      problem: "calibration evaluator returned a malformed recommendation.",
    };
  }

  return {
    summary: {
      referenceTime: typeof raw.referenceTime === "string" ? raw.referenceTime : null,
      retainedIds,
      assumptions,
      rows,
      excludedControls,
      findings: {
        liveScoreCompression: findingsRaw.liveScoreCompression,
        divergentContributorIds: toStringArray(findingsRaw.divergentContributorIds) ?? [],
        staleContributorIds: toStringArray(findingsRaw.staleContributorIds) ?? [],
      },
      recommendation,
    },
    problem: null,
  };
}

function buildRetainedTruthCheck(params: {
  manifestRetainedIds: string[] | null;
  manifestExcludedIds: string[] | null;
  manifestProblem: string | null;
  snapshotRetainedIds: string[] | null;
  evaluationRetainedIds: string[] | null;
}): Check {
  if (params.manifestProblem) {
    return failCheck(
      "M046-S02-RETAINED-COHORT-TRUTH",
      "retained_cohort_truth_drift",
      params.manifestProblem,
    );
  }

  const expected = params.manifestRetainedIds;
  const actual = params.evaluationRetainedIds ?? params.snapshotRetainedIds;
  if (!expected || !actual) {
    return skippedCheck(
      "M046-S02-RETAINED-COHORT-TRUTH",
      "retained_cohort_truth_unchecked",
      "Retained cohort truth could not be compared because manifest or snapshot identities were unavailable.",
    );
  }

  const expectedSorted = [...expected].sort(compareText);
  const actualSorted = [...actual].sort(compareText);
  const excludedOverlap = params.manifestExcludedIds
    ? actualSorted.filter((id) => params.manifestExcludedIds!.includes(id))
    : [];
  const problems: string[] = [];
  if (!arrayEquals(expectedSorted, actualSorted)) {
    problems.push(
      `expected retained ids ${expectedSorted.join(", ")} but found ${actualSorted.join(", ")}`,
    );
  }
  if (excludedOverlap.length > 0) {
    problems.push(`retained set included excluded identities: ${excludedOverlap.join(", ")}`);
  }

  return problems.length === 0
    ? passCheck(
        "M046-S02-RETAINED-COHORT-TRUTH",
        "retained_cohort_truth_preserved",
      )
    : failCheck(
        "M046-S02-RETAINED-COHORT-TRUTH",
        "retained_cohort_truth_drift",
        problems,
      );
}

function buildExcludedControlsCheck(params: {
  manifestExcludedIds: string[] | null;
  manifestProblem: string | null;
  snapshotExcludedIds: string[] | null;
  evaluationExcludedIds: string[] | null;
  includedControlFlags: boolean[] | null;
  evaluationRetainedIds: string[] | null;
}): Check {
  if (params.manifestProblem) {
    return failCheck(
      "M046-S02-EXCLUDED-CONTROLS-TRUTH",
      "excluded_controls_truth_drift",
      params.manifestProblem,
    );
  }

  const expected = params.manifestExcludedIds;
  const actual = params.evaluationExcludedIds ?? params.snapshotExcludedIds;
  if (!expected || !actual) {
    return skippedCheck(
      "M046-S02-EXCLUDED-CONTROLS-TRUTH",
      "excluded_controls_truth_unchecked",
      "Excluded control truth could not be compared because manifest or snapshot identities were unavailable.",
    );
  }

  const expectedSorted = [...expected].sort(compareText);
  const actualSorted = [...actual].sort(compareText);
  const problems: string[] = [];
  if (!arrayEquals(expectedSorted, actualSorted)) {
    problems.push(
      `expected excluded ids ${expectedSorted.join(", ")} but found ${actualSorted.join(", ")}`,
    );
  }
  if (params.includedControlFlags?.some((flag) => flag !== false)) {
    problems.push("excluded controls were marked as includedInEvaluation=true");
  }
  if (params.evaluationRetainedIds) {
    const overlap = params.evaluationRetainedIds.filter((id) => expectedSorted.includes(id));
    if (overlap.length > 0) {
      problems.push(`excluded identities leaked into evaluated rows: ${overlap.join(", ")}`);
    }
  }

  return problems.length === 0
    ? passCheck(
        "M046-S02-EXCLUDED-CONTROLS-TRUTH",
        "excluded_controls_truth_preserved",
      )
    : failCheck(
        "M046-S02-EXCLUDED-CONTROLS-TRUTH",
        "excluded_controls_truth_drift",
        problems,
      );
}

function buildRecommendationCheck(params: {
  calibration: CalibrationSummary | null;
  evaluationCheck: Check;
}): Check {
  if (!params.calibration) {
    return params.evaluationCheck.passed && !params.evaluationCheck.skipped
      ? failCheck(
          "M046-S02-RECOMMENDATION",
          "calibration_recommendation_missing",
          "Calibration evaluation completed without a recommendation payload.",
        )
      : skippedCheck(
          "M046-S02-RECOMMENDATION",
          "calibration_recommendation_skipped",
          "Recommendation generation was skipped because calibration evaluation did not complete.",
        );
  }

  return params.calibration.recommendation
    ? passCheck(
        "M046-S02-RECOMMENDATION",
        "calibration_recommendation_present",
      )
    : failCheck(
        "M046-S02-RECOMMENDATION",
        "calibration_recommendation_missing",
        "Calibration evaluation completed without a keep/retune/replace recommendation.",
      );
}

function normalizeRecommendation(value: unknown): CalibrationSummary["recommendation"] {
  if (!isRecord(value)) {
    return null;
  }
  if (
    (value.verdict !== "keep" && value.verdict !== "retune" && value.verdict !== "replace") ||
    !toStringArray(value.rationale)
  ) {
    return null;
  }

  return {
    verdict: value.verdict,
    rationale: toStringArray(value.rationale) ?? [],
  };
}

function normalizeContract(value: unknown): {
  state: string;
  promptTier: string;
} | null {
  if (!isRecord(value) || typeof value.state !== "string" || typeof value.promptTier !== "string") {
    return null;
  }

  return {
    state: value.state,
    promptTier: value.promptTier,
  };
}

function normalizeCommitCounts(value: unknown): {
  allTime: number;
  since2025: number;
} | null {
  if (!isRecord(value) || typeof value.allTime !== "number" || typeof value.since2025 !== "number") {
    return null;
  }

  return {
    allTime: value.allTime,
    since2025: value.since2025,
  };
}

function normalizeSignalAvailability(value: unknown): {
  githubCommit: boolean;
  githubPull: boolean;
  githubReview: boolean;
  localGit: boolean;
} | null {
  if (
    !isRecord(value) ||
    typeof value.githubCommit !== "boolean" ||
    typeof value.githubPull !== "boolean" ||
    typeof value.githubReview !== "boolean" ||
    typeof value.localGit !== "boolean"
  ) {
    return null;
  }

  return {
    githubCommit: value.githubCommit,
    githubPull: value.githubPull,
    githubReview: value.githubReview,
    localGit: value.localGit,
  };
}

function normalizeRankRange(value: unknown): { min: number; max: number } | null {
  if (!isRecord(value) || typeof value.min !== "number" || typeof value.max !== "number") {
    return null;
  }

  return {
    min: value.min,
    max: value.max,
  };
}

function normalizeCounts(value: unknown): { retained: number; excluded: number } | null {
  if (!isRecord(value) || typeof value.retained !== "number" || typeof value.excluded !== "number") {
    return null;
  }

  return {
    retained: value.retained,
    excluded: value.excluded,
  };
}

function formatSignals(value: CalibrationContributorSummary["fixtureEvidence"]["signalAvailability"]): string {
  if (!value) {
    return "unknown";
  }

  const enabled = [
    value.githubCommit ? "commit" : null,
    value.githubPull ? "pull" : null,
    value.githubReview ? "review" : null,
    value.localGit ? "local-git" : null,
  ].filter((entry): entry is string => entry !== null);

  return enabled.length > 0 ? enabled.join(",") : "none";
}

function formatPercentile(value: number | null): string {
  return typeof value === "number" ? value.toFixed(3) : "unknown";
}

function formatRankRange(value: { min: number; max: number } | null): string {
  if (!value) {
    return "unknown";
  }
  return value.min === value.max ? String(value.min) : `${value.min}-${value.max}`;
}

function formatList(values: readonly string[]): string {
  return values.length > 0 ? values.join(", ") : "none";
}

function passCheck(id: M046S02CheckId, status_code: string): Check {
  return {
    id,
    passed: true,
    skipped: false,
    status_code,
  };
}

function skippedCheck(
  id: M046S02CheckId,
  status_code: string,
  detail?: unknown,
): Check {
  return {
    id,
    passed: true,
    skipped: true,
    status_code,
    detail: detail == null ? undefined : normalizeDetail(detail),
  };
}

function failCheck(
  id: M046S02CheckId,
  status_code: string,
  detail?: unknown,
): Check {
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

function toStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    return null;
  }
  return [...value];
}

function toOptionalNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function readNestedString(value: unknown, path: readonly string[]): string | null {
  let current: unknown = value;
  for (const segment of path) {
    if (!isRecord(current)) {
      return null;
    }
    current = current[segment];
  }
  return typeof current === "string" ? current : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function arrayEquals(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

if (import.meta.main) {
  try {
    const args = parseM046S02Args(process.argv.slice(2));
    const { exitCode } = await buildM046S02ProofHarness(args);
    process.exit(exitCode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`verify:m046:s02 failed: ${message}\n`);
    process.exit(1);
  }
}
