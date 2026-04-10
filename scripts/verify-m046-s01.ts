import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  assertValidFixtureManifest,
  loadFixtureManifest,
  sortFixtureManifest,
  summarizeFixtureManifest,
  FIXTURE_COHORTS,
  FIXTURE_EXCLUSION_REASONS,
  FIXTURE_SOURCE_STATUSES,
  type ContributorFixtureManifest,
  type ExcludedContributorFixture,
  type FixtureCohort,
  type FixtureExclusionReason,
  type FixtureManifestSummary,
  type RetainedContributorFixture,
} from "../src/contributor/fixture-set.ts";
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

type SnapshotCore = {
  fixtureSetVersion: number;
  repository: string;
  curatedAt: string;
  retained: RetainedContributorFixture[];
  excluded: ExcludedContributorFixture[];
};

type SnapshotProvenanceInspection = {
  retainedWithoutRecords: number;
  excludedWithoutRecords: number;
  issues: string[];
};

type SnapshotDerived = {
  raw: unknown;
  parseError: string | null;
  fullSnapshot: z.infer<typeof snapshotSchema> | null;
  coreSnapshot: SnapshotCore | null;
  snapshotIssues: string[];
  counts: EvaluationReport["counts"];
  diagnostics: EvaluationReport["diagnostics"];
  summary: FixtureManifestSummary | null;
  provenanceInspection: SnapshotProvenanceInspection;
};

const commitCountsSchema = z.object({
  allTime: z.number().int().nonnegative(),
  since2025: z.number().int().nonnegative(),
});

const provenanceSourceSchema = z.object({
  status: z.enum(FIXTURE_SOURCE_STATUSES),
  note: z.string().trim().min(1),
  evidenceUrl: z.string().trim().url().nullable(),
  workspacePath: z.string().trim().min(1).nullable(),
});

const provenanceSchema = z.object({
  github: provenanceSourceSchema,
  localGit: provenanceSourceSchema,
});

const retainedCoreSchema = z.object({
  kind: z.literal("retained"),
  normalizedId: z.string().trim().min(1),
  displayName: z.string().trim().min(1),
  githubUsername: z.string().trim().min(1).nullable(),
  cohort: z.enum(FIXTURE_COHORTS),
  selectionNotes: z.string().trim().min(1),
  observedCommitCounts: commitCountsSchema,
  provenance: provenanceSchema,
});

const excludedCoreSchema = z.object({
  kind: z.literal("excluded"),
  normalizedId: z.string().trim().min(1),
  displayName: z.string().trim().min(1),
  githubUsername: z.string().trim().min(1).nullable(),
  exclusionReason: z.enum(FIXTURE_EXCLUSION_REASONS),
  exclusionNotes: z.string().trim().min(1),
  relatedNormalizedIds: z.array(z.string().trim().min(1)),
  observedCommitCounts: commitCountsSchema,
  provenance: provenanceSchema,
});

const snapshotCoreSchema = z.object({
  fixtureSetVersion: z.number().int().positive(),
  repository: z.string().trim().min(1),
  curatedAt: z.string().trim().min(1),
  retained: z.array(retainedCoreSchema),
  excluded: z.array(excludedCoreSchema),
});

const provenanceRecordSchema = z.object({
  source: z.string().trim().min(1),
  status: z.enum(["available", "unavailable"]),
  note: z.string().trim().min(1),
  evidenceUrl: z.string().trim().url().nullable(),
  workspacePath: z.string().trim().min(1).nullable(),
  observedAt: z.string().trim().min(1).nullable(),
  identity: z.string().trim().min(1).nullable(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
});

const snapshotDiagnosticsSchema = z.object({
  statusCode: z.enum(["snapshot-refreshed", "snapshot-degraded"]),
  retainedCount: z.number().int().nonnegative(),
  excludedCount: z.number().int().nonnegative(),
  cohortCoverage: z.object({
    senior: z.number().int().nonnegative(),
    "ambiguous-middle": z.number().int().nonnegative(),
    newcomer: z.number().int().nonnegative(),
  }),
  exclusionsByReason: z.object({
    bot: z.number().int().nonnegative(),
    "alias-collision": z.number().int().nonnegative(),
    "ambiguous-identity": z.number().int().nonnegative(),
  }),
  sourceAvailability: z.object({
    github: z.object({
      pending: z.number().int().nonnegative(),
      available: z.number().int().nonnegative(),
      unavailable: z.number().int().nonnegative(),
    }),
    localGit: z.object({
      pending: z.number().int().nonnegative(),
      available: z.number().int().nonnegative(),
      unavailable: z.number().int().nonnegative(),
    }),
  }),
  provenanceCompleteness: z.object({
    retainedWithoutRecords: z.number().int().nonnegative(),
    excludedWithoutRecords: z.number().int().nonnegative(),
  }),
  aliasCollisionDiagnostics: z.array(z.object({
    normalizedId: z.string().trim().min(1),
    exclusionReason: z.enum(["alias-collision", "ambiguous-identity"]),
    relatedNormalizedIds: z.array(z.string().trim().min(1)),
  })),
  failures: z.array(z.object({
    code: z.string().trim().min(1),
    source: z.string().trim().min(1),
    message: z.string().trim().min(1),
    contributorNormalizedId: z.string().trim().min(1).nullable().optional(),
  })),
});

const snapshotSchema = z.object({
  fixtureSetVersion: z.number().int().positive(),
  repository: z.string().trim().min(1),
  curatedAt: z.string().trim().min(1),
  manifestPath: z.string().trim().min(1),
  snapshotPath: z.string().trim().min(1),
  generatedAt: z.string().trim().min(1),
  refreshCommand: z.string().trim().min(1),
  status: z.enum(["ready", "degraded"]),
  retained: z.array(retainedCoreSchema.extend({
    provenanceRecords: z.array(provenanceRecordSchema),
  })),
  excluded: z.array(excludedCoreSchema.extend({
    provenanceRecords: z.array(provenanceRecordSchema),
  })),
  diagnostics: snapshotDiagnosticsSchema,
});

export async function evaluateM046S01(
  options: EvaluateOptions = {},
): Promise<EvaluationReport> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const manifestPath = options.manifestPath ?? DEFAULT_MANIFEST_PATH;
  const snapshotPath = options.snapshotPath ?? DEFAULT_SNAPSHOT_PATH;
  const loadManifestImpl = options.loadManifest ?? loadFixtureManifest;
  const readSnapshotFile = options.readSnapshotFile ?? readFileUtf8;
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

  const snapshotDerived = await readAndInspectSnapshot(snapshotPath, readSnapshotFile);

  const snapshotCheck = snapshotDerived.parseError
    ? failCheck(
        "M046-S01-SNAPSHOT-VALID",
        "fixture_snapshot_malformed_json",
        snapshotDerived.parseError,
      )
    : snapshotDerived.fullSnapshot
      ? passCheck("M046-S01-SNAPSHOT-VALID", "fixture_snapshot_valid")
      : failCheck(
          "M046-S01-SNAPSHOT-VALID",
          "fixture_snapshot_invalid",
          snapshotDerived.snapshotIssues,
        );

  const curatedSyncCheck = buildCuratedSyncCheck({
    manifest: effectiveManifest,
    manifestPath,
    snapshotPath,
    snapshot: snapshotDerived.fullSnapshot,
    snapshotCore: snapshotDerived.coreSnapshot,
  });

  const snapshotStatusCheck = buildSnapshotStatusCheck(snapshotDerived.fullSnapshot);
  const cohortCoverageCheck = buildCohortCoverageCheck(snapshotDerived.summary, snapshotDerived.fullSnapshot);
  const provenanceCheck = buildProvenanceCheck(snapshotDerived);
  const sourceAvailabilityCheck = buildSourceAvailabilityCheck(snapshotDerived.summary, snapshotDerived.fullSnapshot);
  const aliasDiagnosticsCheck = buildAliasDiagnosticsCheck(snapshotDerived.summary, snapshotDerived.fullSnapshot);

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

async function readAndInspectSnapshot(
  snapshotPath: string,
  readSnapshotFile: (path: string) => Promise<string>,
): Promise<SnapshotDerived> {
  let raw: unknown = null;
  let parseError: string | null = null;

  try {
    raw = JSON.parse(await readSnapshotFile(snapshotPath));
  } catch (error) {
    return {
      raw: null,
      parseError: error instanceof Error ? error.message : String(error),
      fullSnapshot: null,
      coreSnapshot: null,
      snapshotIssues: [],
      counts: null,
      diagnostics: null,
      summary: null,
      provenanceInspection: {
        retainedWithoutRecords: 0,
        excludedWithoutRecords: 0,
        issues: [error instanceof Error ? error.message : String(error)],
      },
    };
  }

  const fullParsed = snapshotSchema.safeParse(raw);
  const coreParsed = snapshotCoreSchema.safeParse(raw);
  const snapshotIssues = fullParsed.success
    ? []
    : fullParsed.error.issues.map(formatZodIssue);

  let coreSnapshot: SnapshotCore | null = null;
  let summary: FixtureManifestSummary | null = null;
  if (coreParsed.success) {
    const projectedManifest = sortFixtureManifest({
      fixtureSetVersion: coreParsed.data.fixtureSetVersion,
      repository: coreParsed.data.repository,
      curatedAt: coreParsed.data.curatedAt,
      snapshotPath: inferSnapshotPath(raw),
      retained: coreParsed.data.retained,
      excluded: coreParsed.data.excluded,
    });

    coreSnapshot = {
      fixtureSetVersion: projectedManifest.fixtureSetVersion,
      repository: projectedManifest.repository,
      curatedAt: projectedManifest.curatedAt,
      retained: projectedManifest.retained,
      excluded: projectedManifest.excluded,
    };
    summary = summarizeFixtureManifest(projectedManifest);

    try {
      assertValidFixtureManifest(projectedManifest);
    } catch (error) {
      snapshotIssues.push(error instanceof Error ? error.message : String(error));
    }
  } else {
    snapshotIssues.push(...coreParsed.error.issues.map(formatZodIssue));
  }

  const provenanceInspection = inspectProvenanceRecords(raw);
  const counts = coreSnapshot
    ? {
        retained: coreSnapshot.retained.length,
        excluded: coreSnapshot.excluded.length,
      }
    : null;
  const diagnostics = fullParsed.success
    ? {
        statusCode: fullParsed.data.diagnostics.statusCode,
        cohortCoverage: fullParsed.data.diagnostics.cohortCoverage,
        sourceAvailability: fullParsed.data.diagnostics.sourceAvailability,
        provenanceCompleteness: fullParsed.data.diagnostics.provenanceCompleteness,
        aliasCollisionDiagnostics: fullParsed.data.diagnostics.aliasCollisionDiagnostics,
        failures: fullParsed.data.diagnostics.failures.map((failure) => ({
          ...failure,
          contributorNormalizedId: failure.contributorNormalizedId ?? null,
        })),
      }
    : null;

  return {
    raw,
    parseError,
    fullSnapshot: fullParsed.success ? fullParsed.data : null,
    coreSnapshot,
    snapshotIssues,
    counts,
    diagnostics,
    summary,
    provenanceInspection,
  };
}

function inferSnapshotPath(raw: unknown): string {
  if (!isRecord(raw) || typeof raw.snapshotPath !== "string" || raw.snapshotPath.trim().length === 0) {
    return DEFAULT_SNAPSHOT_PATH;
  }
  return raw.snapshotPath;
}

function inspectProvenanceRecords(raw: unknown): SnapshotProvenanceInspection {
  const issues: string[] = [];
  let retainedWithoutRecords = 0;
  let excludedWithoutRecords = 0;

  if (!isRecord(raw)) {
    return { retainedWithoutRecords, excludedWithoutRecords, issues };
  }

  const retained = Array.isArray(raw.retained) ? raw.retained : [];
  const excluded = Array.isArray(raw.excluded) ? raw.excluded : [];

  for (const entry of retained) {
    const normalizedId = readNormalizedId(entry);
    if (!hasUsableProvenanceRecords(entry)) {
      retainedWithoutRecords += 1;
      issues.push(`${normalizedId} is missing retained provenanceRecords.`);
    }
  }

  for (const entry of excluded) {
    const normalizedId = readNormalizedId(entry);
    if (!hasUsableProvenanceRecords(entry)) {
      excludedWithoutRecords += 1;
      issues.push(`${normalizedId} is missing excluded provenanceRecords.`);
    }
  }

  return {
    retainedWithoutRecords,
    excludedWithoutRecords,
    issues,
  };
}

function hasUsableProvenanceRecords(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.provenanceRecords)) {
    return false;
  }
  return value.provenanceRecords.length > 0;
}

function buildCuratedSyncCheck(params: {
  manifest: ContributorFixtureManifest | null;
  manifestPath: string;
  snapshotPath: string;
  snapshot: z.infer<typeof snapshotSchema> | null;
  snapshotCore: SnapshotCore | null;
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
  snapshot: z.infer<typeof snapshotSchema> | null,
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
  snapshot: z.infer<typeof snapshotSchema> | null,
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

  if (!snapshotDerived.fullSnapshot) {
    issues.push("snapshot diagnostics were unavailable");
  } else {
    if (
      snapshotDerived.fullSnapshot.diagnostics.provenanceCompleteness.retainedWithoutRecords
      !== snapshotDerived.provenanceInspection.retainedWithoutRecords
    ) {
      issues.push("retained provenance completeness drifted from diagnostics");
    }
    if (
      snapshotDerived.fullSnapshot.diagnostics.provenanceCompleteness.excludedWithoutRecords
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
  snapshot: z.infer<typeof snapshotSchema> | null,
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
  snapshot: z.infer<typeof snapshotSchema> | null,
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

function formatZodIssue(issue: z.ZodIssue): string {
  const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
  return `${path}${issue.message}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readNormalizedId(value: unknown): string {
  if (!isRecord(value) || typeof value.normalizedId !== "string" || value.normalizedId.trim().length === 0) {
    return "unknown-record";
  }
  return value.normalizedId;
}

async function readFileUtf8(path: string): Promise<string> {
  return readFile(path, "utf8");
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
