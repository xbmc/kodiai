import {
  loadFixtureManifest,
  sortFixtureManifest,
  FIXTURE_COHORTS,
  FIXTURE_SOURCE_STATUSES,
  type ContributorFixtureManifest,
  type FixtureCohort,
  type FixtureExclusionReason,
  type FixtureManifestSummary,
} from "../src/contributor/fixture-set.ts";
import {
  loadAndInspectXbmcFixtureSnapshot,
  type XbmcFixtureSnapshot,
  type XbmcFixtureSnapshotInspection,
} from "../src/contributor/xbmc-fixture-snapshot.ts";
import {
  refreshXbmcFixtureSnapshot,
  type XbmcFixtureRefreshResult,
} from "../src/contributor/xbmc-fixture-refresh.ts";

const DEFAULT_MANIFEST_PATH = "fixtures/contributor-calibration/xbmc-manifest.json";
const DEFAULT_SNAPSHOT_PATH = "fixtures/contributor-calibration/xbmc-snapshot.json";
const COMMAND_NAME = "verify:m046:s01" as const;

export const M046_S01_CHECK_IDS = [
  "M046-S01-MANIFEST-VALID",
  "M046-S01-REFRESH-EXECUTED",
  "M046-S01-SNAPSHOT-VALID",
  "M046-S01-CURATED-SYNC",
  "M046-S01-SNAPSHOT-STATUS",
  "M046-S01-COHORT-COVERAGE",
  "M046-S01-PROVENANCE-COMPLETE",
  "M046-S01-SOURCE-AVAILABILITY",
  "M046-S01-ALIAS-DIAGNOSTICS",
] as const;

export type M046S01CheckId = (typeof M046_S01_CHECK_IDS)[number];

export type Check = {
  id: M046S01CheckId;
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail?: string;
};

export type EvaluationReport = {
  command: typeof COMMAND_NAME;
  generatedAt: string;
  check_ids: readonly M046S01CheckId[];
  overallPassed: boolean;
  refreshed: boolean;
  counts: {
    retained: number;
    excluded: number;
  } | null;
  diagnostics: {
    statusCode: string | null;
    cohortCoverage: Record<FixtureCohort, number>;
    sourceAvailability: {
      github: Record<(typeof FIXTURE_SOURCE_STATUSES)[number], number>;
      localGit: Record<(typeof FIXTURE_SOURCE_STATUSES)[number], number>;
    };
    provenanceCompleteness: {
      retainedWithoutRecords: number;
      excludedWithoutRecords: number;
    };
    aliasCollisionDiagnostics: Array<{
      normalizedId: string;
      exclusionReason: Extract<
        FixtureExclusionReason,
        "alias-collision" | "ambiguous-identity"
      >;
      relatedNormalizedIds: string[];
    }>;
    failures: Array<{
      code: string;
      source: string;
      message: string;
      contributorNormalizedId?: string | null;
    }>;
  } | null;
  checks: Check[];
};

type StdWriter = {
  write: (chunk: string) => boolean | void;
};

type EvaluateOptions = {
  manifestPath?: string;
  snapshotPath?: string;
  repository?: string;
  workspacePath?: string;
  refresh?: boolean;
  generatedAt?: string;
  loadManifest?: typeof loadFixtureManifest;
  readSnapshotFile?: (path: string) => Promise<string>;
  _refreshSnapshot?: (
    options?: Parameters<typeof refreshXbmcFixtureSnapshot>[0],
  ) => Promise<XbmcFixtureRefreshResult>;
};

type BuildProofHarnessOptions = EvaluateOptions & {
  json?: boolean;
  stdout?: StdWriter;
  stderr?: StdWriter;
};

type SnapshotDiagnostics = NonNullable<EvaluationReport["diagnostics"]>;
type SnapshotDerived = XbmcFixtureSnapshotInspection;

export async function evaluateM046S01(
  options: EvaluateOptions = {},
): Promise<EvaluationReport> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const manifestPath = options.manifestPath ?? DEFAULT_MANIFEST_PATH;
  const snapshotPath = options.snapshotPath ?? DEFAULT_SNAPSHOT_PATH;
  const loadManifestImpl = options.loadManifest ?? loadFixtureManifest;
  const readSnapshotFile = options.readSnapshotFile;
  const refreshSnapshot = options._refreshSnapshot ?? refreshXbmcFixtureSnapshot;

  let effectiveManifest: ContributorFixtureManifest | null = null;
  let manifestCheck: Check;
  try {
    const loadedManifest = await loadManifestImpl(manifestPath);
    effectiveManifest = applyManifestOverrides(loadedManifest, {
      repository: options.repository,
      workspacePath: options.workspacePath,
      snapshotPath,
    });
    manifestCheck = passCheck("M046-S01-MANIFEST-VALID", "fixture_manifest_valid");
  } catch (error) {
    manifestCheck = failCheck(
      "M046-S01-MANIFEST-VALID",
      "fixture_manifest_invalid",
      error,
    );
  }

  let refreshed = false;
  let refreshCheck: Check;
  if (!options.refresh) {
    refreshCheck = skippedCheck(
      "M046-S01-REFRESH-EXECUTED",
      "refresh_not_requested",
      "Refresh was not requested.",
    );
  } else if (!effectiveManifest) {
    refreshCheck = failCheck(
      "M046-S01-REFRESH-EXECUTED",
      "fixture_refresh_failed",
      "Cannot refresh without a valid manifest.",
    );
  } else {
    try {
      const refreshResult = await refreshSnapshot({
        manifestPath,
        snapshotPath,
        generatedAt: options.generatedAt,
        refreshCommand: buildRefreshCommand({
          repository: options.repository,
          workspacePath: options.workspacePath,
        }),
        loadManifest: async () => effectiveManifest!,
      });

      refreshed = true;
      if (
        refreshResult.statusCode !== "snapshot-refreshed"
        || refreshResult.failures.length > 0
      ) {
        refreshCheck = failCheck(
          "M046-S01-REFRESH-EXECUTED",
          "fixture_refresh_failed",
          [
            `refresh status=${refreshResult.statusCode}`,
            ...refreshResult.failures.map((failure) => `${failure.code}:${failure.message}`),
          ].join("; "),
        );
      } else {
        refreshCheck = passCheck(
          "M046-S01-REFRESH-EXECUTED",
          "snapshot_refreshed_before_verify",
        );
      }
    } catch (error) {
      refreshCheck = failCheck(
        "M046-S01-REFRESH-EXECUTED",
        "fixture_refresh_failed",
        error,
      );
    }
  }

  const snapshotDerived = await loadAndInspectXbmcFixtureSnapshot(snapshotPath, {
    readSnapshotFile,
  });

  const snapshotCheck = snapshotDerived.parseError
    ? failCheck(
        "M046-S01-SNAPSHOT-VALID",
        "fixture_snapshot_malformed_json",
        snapshotDerived.parseError,
      )
    : snapshotDerived.isValid
      ? passCheck("M046-S01-SNAPSHOT-VALID", "fixture_snapshot_valid")
      : failCheck(
          "M046-S01-SNAPSHOT-VALID",
          "fixture_snapshot_invalid",
          snapshotDerived.validationIssues,
        );

  const curatedSyncCheck = buildCuratedSyncCheck({
    manifest: effectiveManifest,
    manifestPath,
    snapshotPath,
    snapshot: snapshotDerived.snapshot,
    snapshotCore: snapshotDerived.coreSnapshot,
  });

  const snapshotStatusCheck = buildSnapshotStatusCheck(snapshotDerived.snapshot);
  const cohortCoverageCheck = buildCohortCoverageCheck(snapshotDerived.summary, snapshotDerived.snapshot);
  const provenanceCheck = buildProvenanceCheck(snapshotDerived);
  const sourceAvailabilityCheck = buildSourceAvailabilityCheck(snapshotDerived.summary, snapshotDerived.snapshot);
  const aliasDiagnosticsCheck = buildAliasDiagnosticsCheck(snapshotDerived.summary, snapshotDerived.snapshot);

  const checks = [
    manifestCheck,
    refreshCheck,
    snapshotCheck,
    curatedSyncCheck,
    snapshotStatusCheck,
    cohortCoverageCheck,
    provenanceCheck,
    sourceAvailabilityCheck,
    aliasDiagnosticsCheck,
  ];

  return {
    command: COMMAND_NAME,
    generatedAt,
    check_ids: M046_S01_CHECK_IDS,
    overallPassed: checks.every((check) => check.passed || check.skipped),
    refreshed,
    counts: snapshotDerived.counts,
    diagnostics: snapshotDerived.diagnostics,
    checks,
  };
}

export function renderM046S01Report(report: EvaluationReport): string {
  const lines = [
    "M046 S01 proof harness: xbmc fixture refresh and verification",
    `Generated at: ${report.generatedAt}`,
    `Final verdict: ${report.overallPassed ? "PASS" : "FAIL"}`,
    `Refreshed: ${report.refreshed ? "yes" : "no"}`,
  ];

  if (report.counts) {
    lines.push(`Counts: retained=${report.counts.retained} excluded=${report.counts.excluded}`);
  }

  if (report.diagnostics) {
    lines.push(
      `Diagnostics: status=${report.diagnostics.statusCode ?? "unknown"} github=${formatCounts(report.diagnostics.sourceAvailability.github)} localGit=${formatCounts(report.diagnostics.sourceAvailability.localGit)} provenanceMissing=${report.diagnostics.provenanceCompleteness.retainedWithoutRecords + report.diagnostics.provenanceCompleteness.excludedWithoutRecords} aliasDiagnostics=${report.diagnostics.aliasCollisionDiagnostics.length}`,
    );
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

export async function buildM046S01ProofHarness(
  options: BuildProofHarnessOptions = {},
): Promise<{ exitCode: number; report: EvaluationReport }> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const report = await evaluateM046S01(options);

  if (options.json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    stdout.write(renderM046S01Report(report));
  }

  if (!report.overallPassed) {
    const failingCodes = report.checks
      .filter((check) => !check.passed && !check.skipped)
      .map((check) => `${check.id}:${check.status_code}`)
      .join(", ");
    stderr.write(`verify:m046:s01 failed: ${failingCodes}\n`);
  }

  return {
    exitCode: report.overallPassed ? 0 : 1,
    report,
  };
}

export function parseM046S01Args(args: readonly string[]): {
  json: boolean;
  refresh: boolean;
  repository?: string;
  workspacePath?: string;
} {
  let json = false;
  let refresh = false;
  let repository: string | undefined;
  let workspacePath: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--refresh") {
      refresh = true;
      continue;
    }
    if (arg === "--repo") {
      repository = args[index + 1];
      if (!repository) {
        throw new Error("--repo requires a value");
      }
      index += 1;
      continue;
    }
    if (arg === "--workspace") {
      workspacePath = args[index + 1];
      if (!workspacePath) {
        throw new Error("--workspace requires a value");
      }
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { json, refresh, repository, workspacePath };
}

function applyManifestOverrides(
  manifest: ContributorFixtureManifest,
  options: {
    repository?: string;
    workspacePath?: string;
    snapshotPath: string;
  },
): ContributorFixtureManifest {
  const overrideWorkspacePath = options.workspacePath;

  return sortFixtureManifest({
    ...manifest,
    repository: options.repository ?? manifest.repository,
    snapshotPath: options.snapshotPath,
    retained: manifest.retained.map((entry) => ({
      ...entry,
      provenance: {
        ...entry.provenance,
        localGit: {
          ...entry.provenance.localGit,
          workspacePath:
            overrideWorkspacePath ?? entry.provenance.localGit.workspacePath,
        },
      },
    })),
    excluded: manifest.excluded.map((entry) => ({
      ...entry,
      provenance: {
        ...entry.provenance,
        localGit: {
          ...entry.provenance.localGit,
          workspacePath:
            overrideWorkspacePath ?? entry.provenance.localGit.workspacePath,
        },
      },
    })),
  });
}


function buildCuratedSyncCheck(params: {
  manifest: ContributorFixtureManifest | null;
  manifestPath: string;
  snapshotPath: string;
  snapshot: XbmcFixtureSnapshot | null;
  snapshotCore: SnapshotDerived["coreSnapshot"];
}): Check {
  const { manifest, manifestPath, snapshotPath, snapshot, snapshotCore } = params;

  if (!manifest || !snapshotCore) {
    return skippedCheck(
      "M046-S01-CURATED-SYNC",
      "fixture_snapshot_drift_unchecked",
      "Curated sync prerequisites were unavailable.",
    );
  }

  const drift: string[] = [];
  if (snapshot && snapshot.manifestPath !== manifestPath) {
    drift.push(`snapshot manifestPath=${snapshot.manifestPath} did not match ${manifestPath}`);
  }
  if (snapshot && snapshot.snapshotPath !== snapshotPath) {
    drift.push(`snapshot snapshotPath=${snapshot.snapshotPath} did not match ${snapshotPath}`);
  }

  const expected = comparableManifest(manifest);
  const actual = comparableManifest({
    ...manifest,
    fixtureSetVersion: snapshotCore.fixtureSetVersion,
    repository: snapshotCore.repository,
    curatedAt: snapshotCore.curatedAt,
    retained: snapshotCore.retained,
    excluded: snapshotCore.excluded,
  });

  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    drift.push("manifest and snapshot curated identities/counts diverged");
  }

  return drift.length === 0
    ? passCheck("M046-S01-CURATED-SYNC", "fixture_snapshot_in_sync")
    : failCheck("M046-S01-CURATED-SYNC", "fixture_snapshot_drift", drift);
}

function buildSnapshotStatusCheck(
  snapshot: XbmcFixtureSnapshot | null,
): Check {
  if (!snapshot) {
    return skippedCheck(
      "M046-S01-SNAPSHOT-STATUS",
      "fixture_snapshot_status_unchecked",
      "Snapshot status could not be inspected.",
    );
  }

  const issues: string[] = [];
  if (snapshot.status === "ready" && snapshot.diagnostics.statusCode !== "snapshot-refreshed") {
    issues.push(
      `ready snapshot reported diagnostics.statusCode=${snapshot.diagnostics.statusCode}`,
    );
  }
  if (snapshot.status === "degraded" && snapshot.diagnostics.statusCode !== "snapshot-degraded") {
    issues.push(
      `degraded snapshot reported diagnostics.statusCode=${snapshot.diagnostics.statusCode}`,
    );
  }
  if (snapshot.status === "ready" && snapshot.diagnostics.failures.length > 0) {
    issues.push(
      `ready snapshot carried failures: ${snapshot.diagnostics.failures.map((failure) => failure.code).join(", ")}`,
    );
  }

  if (snapshot.status === "degraded" || snapshot.diagnostics.failures.length > 0) {
    return failCheck(
      "M046-S01-SNAPSHOT-STATUS",
      "fixture_snapshot_degraded",
      snapshot.diagnostics.failures.length > 0
        ? snapshot.diagnostics.failures.map((failure) => `${failure.code}:${failure.message}`)
        : `snapshot status=${snapshot.status}`,
    );
  }

  return issues.length === 0
    ? passCheck("M046-S01-SNAPSHOT-STATUS", "fixture_snapshot_ready")
    : failCheck("M046-S01-SNAPSHOT-STATUS", "fixture_snapshot_status_invalid", issues);
}

function buildCohortCoverageCheck(
  summary: FixtureManifestSummary | null,
  snapshot: XbmcFixtureSnapshot | null,
): Check {
  if (!summary) {
    return skippedCheck(
      "M046-S01-COHORT-COVERAGE",
      "fixture_cohort_coverage_unchecked",
      "Cohort coverage could not be recomputed.",
    );
  }

  const issues: string[] = [];
  const missing = FIXTURE_COHORTS.filter((cohort) => summary.cohortCoverage[cohort] === 0);
  if (missing.length > 0) {
    issues.push(`missing cohort coverage for ${missing.join(", ")}`);
  }

  if (!snapshot) {
    issues.push("snapshot diagnostics were unavailable");
  } else if (
    JSON.stringify(summary.cohortCoverage) !== JSON.stringify(snapshot.diagnostics.cohortCoverage)
  ) {
    issues.push(
      `snapshot diagnostics cohort coverage drifted from recomputed summary`,
    );
  }

  return issues.length === 0
    ? passCheck("M046-S01-COHORT-COVERAGE", "fixture_cohort_coverage_complete")
    : failCheck("M046-S01-COHORT-COVERAGE", "fixture_cohort_coverage_missing", issues);
}

function buildProvenanceCheck(snapshotDerived: SnapshotDerived): Check {
  if (!snapshotDerived.coreSnapshot) {
    return skippedCheck(
      "M046-S01-PROVENANCE-COMPLETE",
      "fixture_provenance_unchecked",
      "Provenance completeness could not be recomputed.",
    );
  }

  const issues = [...snapshotDerived.provenanceInspection.issues];

  if (!snapshotDerived.snapshot) {
    issues.push("snapshot diagnostics were unavailable");
  } else {
    if (
      snapshotDerived.snapshot.diagnostics.provenanceCompleteness.retainedWithoutRecords
      !== snapshotDerived.provenanceInspection.retainedWithoutRecords
    ) {
      issues.push("retained provenance completeness drifted from diagnostics");
    }
    if (
      snapshotDerived.snapshot.diagnostics.provenanceCompleteness.excludedWithoutRecords
      !== snapshotDerived.provenanceInspection.excludedWithoutRecords
    ) {
      issues.push("excluded provenance completeness drifted from diagnostics");
    }
  }

  return issues.length === 0
    ? passCheck("M046-S01-PROVENANCE-COMPLETE", "fixture_provenance_complete")
    : failCheck("M046-S01-PROVENANCE-COMPLETE", "fixture_provenance_incomplete", issues);
}

function buildSourceAvailabilityCheck(
  summary: FixtureManifestSummary | null,
  snapshot: XbmcFixtureSnapshot | null,
): Check {
  if (!summary) {
    return skippedCheck(
      "M046-S01-SOURCE-AVAILABILITY",
      "fixture_source_availability_unchecked",
      "Source availability could not be recomputed.",
    );
  }

  const issues: string[] = [];
  if (!snapshot) {
    issues.push("snapshot diagnostics were unavailable");
  } else if (
    JSON.stringify(summary.provenance.sourceAvailability)
    !== JSON.stringify(snapshot.diagnostics.sourceAvailability)
  ) {
    issues.push("source availability counts drifted from recomputed summary");
  }

  return issues.length === 0
    ? passCheck("M046-S01-SOURCE-AVAILABILITY", "fixture_source_availability_recorded")
    : failCheck("M046-S01-SOURCE-AVAILABILITY", "fixture_source_availability_missing", issues);
}

function buildAliasDiagnosticsCheck(
  summary: FixtureManifestSummary | null,
  snapshot: XbmcFixtureSnapshot | null,
): Check {
  if (!summary) {
    return skippedCheck(
      "M046-S01-ALIAS-DIAGNOSTICS",
      "fixture_alias_diagnostics_unchecked",
      "Alias diagnostics could not be recomputed.",
    );
  }

  const issues: string[] = [];
  if (!snapshot) {
    issues.push("snapshot diagnostics were unavailable");
  } else if (
    JSON.stringify(summary.aliasCollisionDiagnostics)
    !== JSON.stringify(snapshot.diagnostics.aliasCollisionDiagnostics)
  ) {
    issues.push("alias collision diagnostics drifted from recomputed summary");
  }

  return issues.length === 0
    ? passCheck("M046-S01-ALIAS-DIAGNOSTICS", "fixture_alias_diagnostics_recorded")
    : failCheck("M046-S01-ALIAS-DIAGNOSTICS", "fixture_alias_diagnostics_missing", issues);
}

function comparableManifest(manifest: ContributorFixtureManifest) {
  return {
    fixtureSetVersion: manifest.fixtureSetVersion,
    repository: manifest.repository,
    curatedAt: manifest.curatedAt,
    snapshotPath: manifest.snapshotPath,
    retained: manifest.retained.map((entry) => ({
      kind: entry.kind,
      normalizedId: entry.normalizedId,
      displayName: entry.displayName,
      githubUsername: entry.githubUsername,
      cohort: entry.cohort,
      selectionNotes: entry.selectionNotes,
      observedCommitCounts: entry.observedCommitCounts,
    })),
    excluded: manifest.excluded.map((entry) => ({
      kind: entry.kind,
      normalizedId: entry.normalizedId,
      displayName: entry.displayName,
      githubUsername: entry.githubUsername,
      exclusionReason: entry.exclusionReason,
      exclusionNotes: entry.exclusionNotes,
      relatedNormalizedIds: [...entry.relatedNormalizedIds].sort((left, right) =>
        left.localeCompare(right),
      ),
      observedCommitCounts: entry.observedCommitCounts,
    })),
  };
}

function buildRefreshCommand(options: {
  repository?: string;
  workspacePath?: string;
}): string {
  const args = ["bun run verify:m046:s01 -- --refresh --json"];
  if (options.repository) {
    args.push(`--repo ${options.repository}`);
  }
  if (options.workspacePath) {
    args.push(`--workspace ${options.workspacePath}`);
  }
  return args.join(" ");
}

function formatCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
}

function passCheck(id: M046S01CheckId, status_code: string): Check {
  return {
    id,
    passed: true,
    skipped: false,
    status_code,
  };
}

function skippedCheck(
  id: M046S01CheckId,
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
  id: M046S01CheckId,
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

if (import.meta.main) {
  try {
    const args = parseM046S01Args(process.argv.slice(2));
    const { exitCode } = await buildM046S01ProofHarness(args);
    process.exit(exitCode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`verify:m046:s01 failed: ${message}\n`);
    process.exit(1);
  }
}
