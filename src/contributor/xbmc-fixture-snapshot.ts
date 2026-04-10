import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  assertValidFixtureManifest,
  FIXTURE_COHORTS,
  FIXTURE_EXCLUSION_REASONS,
  FIXTURE_SOURCE_STATUSES,
  sortFixtureManifest,
  summarizeFixtureManifest,
  type ContributorFixtureManifest,
  type FixtureManifestSummary,
} from "./fixture-set.ts";
import type {
  XbmcExcludedContributorSnapshot,
  XbmcFixtureProvenanceRecord,
  XbmcFixtureRefreshFailure,
  XbmcFixtureSnapshot,
  XbmcRetainedContributorSnapshot,
} from "./xbmc-fixture-refresh.ts";

const DEFAULT_SNAPSHOT_PATH = "fixtures/contributor-calibration/xbmc-snapshot.json";

type EvidenceMetadataValue = string | number | boolean | null;

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
  metadata: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean(), z.null()]),
  ),
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
  aliasCollisionDiagnostics: z.array(
    z.object({
      normalizedId: z.string().trim().min(1),
      exclusionReason: z.enum(["alias-collision", "ambiguous-identity"]),
      relatedNormalizedIds: z.array(z.string().trim().min(1)),
    }),
  ),
  failures: z.array(
    z.object({
      code: z.string().trim().min(1),
      source: z.string().trim().min(1),
      message: z.string().trim().min(1),
      contributorNormalizedId: z.string().trim().min(1).nullable().optional(),
    }),
  ),
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
  retained: z.array(
    retainedCoreSchema.extend({
      provenanceRecords: z.array(provenanceRecordSchema),
    }),
  ),
  excluded: z.array(
    excludedCoreSchema.extend({
      provenanceRecords: z.array(provenanceRecordSchema),
    }),
  ),
  diagnostics: snapshotDiagnosticsSchema,
});

type SnapshotCore = {
  fixtureSetVersion: number;
  repository: string;
  curatedAt: string;
  retained: ContributorFixtureManifest["retained"];
  excluded: ContributorFixtureManifest["excluded"];
};

export type XbmcFixtureSnapshotCounts = {
  retained: number;
  excluded: number;
};

export type XbmcFixtureSnapshotProvenanceInspection = {
  retainedWithoutRecords: number;
  excludedWithoutRecords: number;
  issues: string[];
};

export type XbmcFixtureSnapshotInspection = {
  raw: unknown;
  parseError: string | null;
  snapshot: XbmcFixtureSnapshot | null;
  isValid: boolean;
  validationIssues: string[];
  projectedFixtureManifest: ContributorFixtureManifest | null;
  coreSnapshot: SnapshotCore | null;
  counts: XbmcFixtureSnapshotCounts | null;
  diagnostics: XbmcFixtureSnapshot["diagnostics"] | null;
  summary: FixtureManifestSummary | null;
  provenanceInspection: XbmcFixtureSnapshotProvenanceInspection;
};

export type LoadXbmcFixtureSnapshotOptions = {
  readSnapshotFile?: (path: string) => Promise<string>;
};

export type {
  XbmcExcludedContributorSnapshot,
  XbmcFixtureProvenanceRecord,
  XbmcFixtureRefreshFailure,
  XbmcFixtureSnapshot,
  XbmcRetainedContributorSnapshot,
};

export function assertValidXbmcFixtureSnapshot(
  value: unknown,
): XbmcFixtureSnapshot {
  const inspection = inspectXbmcFixtureSnapshot(value);

  if (inspection.parseError) {
    throw new Error(inspection.parseError);
  }
  if (!inspection.snapshot || !inspection.isValid) {
    throw new Error(
      inspection.validationIssues.length > 0
        ? inspection.validationIssues.join("; ")
        : "xbmc fixture snapshot failed validation.",
    );
  }

  return inspection.snapshot;
}

export async function loadXbmcFixtureSnapshot(
  snapshotPath: string,
  options: LoadXbmcFixtureSnapshotOptions = {},
): Promise<XbmcFixtureSnapshot> {
  const inspection = await loadAndInspectXbmcFixtureSnapshot(snapshotPath, options);

  if (inspection.parseError) {
    throw new Error(
      `Malformed xbmc fixture snapshot JSON at ${snapshotPath}: ${inspection.parseError}`,
    );
  }
  if (!inspection.snapshot || !inspection.isValid) {
    throw new Error(
      `Invalid xbmc fixture snapshot at ${snapshotPath}: ${inspection.validationIssues.join("; ")}`,
    );
  }

  return inspection.snapshot;
}

export function inspectXbmcFixtureSnapshot(
  raw: unknown,
): XbmcFixtureSnapshotInspection {
  const fullParsed = snapshotSchema.safeParse(raw);
  const validationIssues = fullParsed.success
    ? []
    : fullParsed.error.issues.map(formatZodIssue);

  const coreParsed = snapshotCoreSchema.safeParse(raw);
  let projectedFixtureManifest: ContributorFixtureManifest | null = null;
  let coreSnapshot: SnapshotCore | null = null;
  let summary: FixtureManifestSummary | null = null;

  if (coreParsed.success) {
    projectedFixtureManifest = sortFixtureManifest({
      fixtureSetVersion: coreParsed.data.fixtureSetVersion,
      repository: coreParsed.data.repository,
      curatedAt: coreParsed.data.curatedAt,
      snapshotPath: inferSnapshotPath(raw),
      retained: coreParsed.data.retained,
      excluded: coreParsed.data.excluded,
    });

    coreSnapshot = {
      fixtureSetVersion: projectedFixtureManifest.fixtureSetVersion,
      repository: projectedFixtureManifest.repository,
      curatedAt: projectedFixtureManifest.curatedAt,
      retained: projectedFixtureManifest.retained,
      excluded: projectedFixtureManifest.excluded,
    };
    summary = summarizeFixtureManifest(projectedFixtureManifest);

    try {
      assertValidFixtureManifest(projectedFixtureManifest);
    } catch (error) {
      validationIssues.push(error instanceof Error ? error.message : String(error));
    }
  } else {
    validationIssues.push(...coreParsed.error.issues.map(formatZodIssue));
  }

  const provenanceInspection = inspectProvenanceRecords(raw);
  const counts = coreSnapshot
    ? {
        retained: coreSnapshot.retained.length,
        excluded: coreSnapshot.excluded.length,
      }
    : null;

  return {
    raw,
    parseError: null,
    snapshot: fullParsed.success ? normalizeSnapshot(fullParsed.data) : null,
    isValid: fullParsed.success && validationIssues.length === 0,
    validationIssues,
    projectedFixtureManifest,
    coreSnapshot,
    counts,
    diagnostics: fullParsed.success ? normalizeDiagnostics(fullParsed.data.diagnostics) : null,
    summary,
    provenanceInspection,
  };
}

export async function loadAndInspectXbmcFixtureSnapshot(
  snapshotPath: string,
  options: LoadXbmcFixtureSnapshotOptions = {},
): Promise<XbmcFixtureSnapshotInspection> {
  const readSnapshotFile = options.readSnapshotFile ?? readFileUtf8;

  try {
    const raw = JSON.parse(await readSnapshotFile(snapshotPath));
    return inspectXbmcFixtureSnapshot(raw);
  } catch (error) {
    return {
      raw: null,
      parseError: error instanceof Error ? error.message : String(error),
      snapshot: null,
      isValid: false,
      validationIssues: [],
      projectedFixtureManifest: null,
      coreSnapshot: null,
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
}

function normalizeSnapshot(
  snapshot: z.infer<typeof snapshotSchema>,
): XbmcFixtureSnapshot {
  return {
    ...snapshot,
    retained: snapshot.retained.map(normalizeRetainedSnapshot),
    excluded: snapshot.excluded.map(normalizeExcludedSnapshot),
    diagnostics: normalizeDiagnostics(snapshot.diagnostics),
  };
}

function normalizeRetainedSnapshot(
  entry: z.infer<typeof snapshotSchema.shape.retained.element>,
): XbmcRetainedContributorSnapshot {
  return {
    ...entry,
    provenanceRecords: entry.provenanceRecords.map(normalizeProvenanceRecord),
  };
}

function normalizeExcludedSnapshot(
  entry: z.infer<typeof snapshotSchema.shape.excluded.element>,
): XbmcExcludedContributorSnapshot {
  return {
    ...entry,
    relatedNormalizedIds: [...entry.relatedNormalizedIds],
    provenanceRecords: entry.provenanceRecords.map(normalizeProvenanceRecord),
  };
}

function normalizeProvenanceRecord(
  record: z.infer<typeof provenanceRecordSchema>,
): XbmcFixtureProvenanceRecord {
  return {
    ...record,
    metadata: { ...record.metadata } as Record<string, EvidenceMetadataValue>,
  };
}

function normalizeDiagnostics(
  diagnostics: z.infer<typeof snapshotDiagnosticsSchema>,
): XbmcFixtureSnapshot["diagnostics"] {
  return {
    ...diagnostics,
    aliasCollisionDiagnostics: diagnostics.aliasCollisionDiagnostics.map((entry) => ({
      ...entry,
      relatedNormalizedIds: [...entry.relatedNormalizedIds],
    })),
    failures: diagnostics.failures.map((failure) => ({
      ...failure,
      contributorNormalizedId: failure.contributorNormalizedId ?? null,
    })) as XbmcFixtureRefreshFailure[],
  };
}

function inferSnapshotPath(raw: unknown): string {
  if (
    !isRecord(raw)
    || typeof raw.snapshotPath !== "string"
    || raw.snapshotPath.trim().length === 0
  ) {
    return DEFAULT_SNAPSHOT_PATH;
  }

  return raw.snapshotPath;
}

function inspectProvenanceRecords(
  raw: unknown,
): XbmcFixtureSnapshotProvenanceInspection {
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

function readNormalizedId(value: unknown): string {
  if (
    !isRecord(value)
    || typeof value.normalizedId !== "string"
    || value.normalizedId.trim().length === 0
  ) {
    return "unknown-record";
  }

  return value.normalizedId;
}

function formatZodIssue(issue: z.ZodIssue): string {
  const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
  return `${path}${issue.message}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function readFileUtf8(path: string): Promise<string> {
  return readFile(path, "utf8");
}
