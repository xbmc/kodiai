import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
import pino from "pino";
import { createGitHubApp } from "../auth/github-app.ts";
import type { AppConfig } from "../config.ts";
import {
  loadFixtureManifest,
  normalizeFixtureIdentity,
  sortFixtureManifest,
  summarizeFixtureManifest,
  type ContributorFixtureManifest,
  type ExcludedContributorFixture,
  type FixtureCohort,
  type FixtureExclusionReason,
  type FixtureProvenance,
  type FixtureProvenanceSource,
  type FixtureSourceStatus,
  type RetainedContributorFixture,
} from "./fixture-set.ts";

const execFileAsync = promisify(execFile);

const DEFAULT_MANIFEST_PATH = "fixtures/contributor-calibration/xbmc-manifest.json";
const DEFAULT_SNAPSHOT_PATH = "fixtures/contributor-calibration/xbmc-snapshot.json";
const DEFAULT_REFRESH_COMMAND = "bun run verify:m046:s01 -- --refresh --json";
const DEFAULT_GITHUB_TIMEOUT_MS = 10_000;

const SUPPORTED_EVIDENCE_SOURCES = [
  "github-identity",
  "github-commit",
  "github-pull",
  "github-review",
  "local-git-shortlog",
] as const;

type EvidenceMetadataValue = string | number | boolean | null;

type SupportedEvidenceSource = (typeof SUPPORTED_EVIDENCE_SOURCES)[number];

type EvidenceStatus = Extract<FixtureSourceStatus, "available" | "unavailable">;

type RefreshFailureSource = "manifest" | "github" | "local-git" | "snapshot";

export type XbmcFixtureProvenanceRecord = {
  source: SupportedEvidenceSource;
  status: EvidenceStatus;
  note: string;
  evidenceUrl: string | null;
  workspacePath: string | null;
  observedAt: string | null;
  identity: string | null;
  metadata: Record<string, EvidenceMetadataValue>;
};

export type XbmcFixtureRefreshFailure = {
  code: string;
  source: RefreshFailureSource;
  message: string;
  contributorNormalizedId?: string | null;
};

export type XbmcRetainedContributorSnapshot = RetainedContributorFixture & {
  provenanceRecords: XbmcFixtureProvenanceRecord[];
};

export type XbmcExcludedContributorSnapshot = ExcludedContributorFixture & {
  provenanceRecords: XbmcFixtureProvenanceRecord[];
};

export type XbmcFixtureSnapshot = {
  fixtureSetVersion: number;
  repository: string;
  curatedAt: string;
  manifestPath: string;
  snapshotPath: string;
  generatedAt: string;
  refreshCommand: string;
  status: "ready" | "degraded";
  retained: XbmcRetainedContributorSnapshot[];
  excluded: XbmcExcludedContributorSnapshot[];
  diagnostics: {
    statusCode: "snapshot-refreshed" | "snapshot-degraded";
    retainedCount: number;
    excludedCount: number;
    cohortCoverage: Record<FixtureCohort, number>;
    exclusionsByReason: Record<FixtureExclusionReason, number>;
    sourceAvailability: {
      github: Record<FixtureSourceStatus, number>;
      localGit: Record<FixtureSourceStatus, number>;
    };
    provenanceCompleteness: {
      retainedWithoutRecords: number;
      excludedWithoutRecords: number;
    };
    aliasCollisionDiagnostics: Array<{
      normalizedId: string;
      exclusionReason: Extract<FixtureExclusionReason, "alias-collision" | "ambiguous-identity">;
      relatedNormalizedIds: string[];
    }>;
    failures: XbmcFixtureRefreshFailure[];
  };
};

export type XbmcFixtureRefreshResult = {
  statusCode: "snapshot-refreshed" | "snapshot-degraded";
  snapshotPath: string;
  retainedCount: number;
  excludedCount: number;
  failures: XbmcFixtureRefreshFailure[];
  snapshot: XbmcFixtureSnapshot;
};

type GitHubEvidenceCollectionResult = {
  sourceStatus: EvidenceStatus;
  note: string;
  records: XbmcFixtureProvenanceRecord[];
  failures?: XbmcFixtureRefreshFailure[];
};

type LocalGitEvidenceCollectionResult = {
  sourceStatus: EvidenceStatus;
  note: string;
  recordsByNormalizedId: Record<string, XbmcFixtureProvenanceRecord[]>;
  failures?: XbmcFixtureRefreshFailure[];
};

type FixtureRecord = RetainedContributorFixture | ExcludedContributorFixture;

type RefreshXbmcFixtureSnapshotOptions = {
  manifestPath?: string;
  snapshotPath?: string;
  generatedAt?: string;
  refreshCommand?: string;
  githubTimeoutMs?: number;
  loadManifest?: typeof loadFixtureManifest;
  collectGitHubEvidence?: (params: {
    repository: string;
    contributor: FixtureRecord;
  }) => Promise<GitHubEvidenceCollectionResult>;
  collectLocalGitEvidence?: (params: {
    manifest: ContributorFixtureManifest;
    workspacePath: string | null;
    aliasMap: Map<string, string>;
  }) => Promise<LocalGitEvidenceCollectionResult>;
  writeSnapshotFile?: (snapshotPath: string, content: string) => Promise<void>;
};

class TimedOutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimedOutError";
  }
}

class XbmcFixtureRefreshError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XbmcFixtureRefreshError";
  }
}

export async function refreshXbmcFixtureSnapshot(
  options: RefreshXbmcFixtureSnapshotOptions = {},
): Promise<XbmcFixtureRefreshResult> {
  const manifestPath = options.manifestPath ?? DEFAULT_MANIFEST_PATH;
  const snapshotPath = options.snapshotPath ?? DEFAULT_SNAPSHOT_PATH;
  const refreshCommand = options.refreshCommand ?? DEFAULT_REFRESH_COMMAND;
  const githubTimeoutMs = options.githubTimeoutMs ?? DEFAULT_GITHUB_TIMEOUT_MS;
  const loadManifest = options.loadManifest ?? loadFixtureManifest;

  const manifest = await loadManifest(manifestPath);
  validateRetainedGithubUsernames(manifest);
  const aliasMap = buildAuthorizedAliasMap(manifest);
  const workspacePath = pickWorkspacePath(manifest);

  const collectLocalGitEvidence =
    options.collectLocalGitEvidence ?? collectLiveLocalGitEvidence;
  const collectGitHubEvidence =
    options.collectGitHubEvidence
    ?? (await createLiveGitHubEvidenceCollector(manifest.repository, githubTimeoutMs));

  const localGitEvidence = await collectLocalGitEvidence({
    manifest,
    workspacePath,
    aliasMap,
  });

  const failures: XbmcFixtureRefreshFailure[] = [
    ...(localGitEvidence.failures ?? []),
  ];

  const retained: XbmcRetainedContributorSnapshot[] = [];
  const excluded: XbmcExcludedContributorSnapshot[] = [];

  for (const contributor of manifest.retained) {
    const snapshotContributor = await buildContributorSnapshot({
      contributor,
      repository: manifest.repository,
      workspacePath,
      collectGitHubEvidence,
      githubTimeoutMs,
      localGitEvidence,
      failures,
    });
    retained.push(snapshotContributor as XbmcRetainedContributorSnapshot);
  }

  for (const contributor of manifest.excluded) {
    const snapshotContributor = await buildContributorSnapshot({
      contributor,
      repository: manifest.repository,
      workspacePath,
      collectGitHubEvidence,
      githubTimeoutMs,
      localGitEvidence,
      failures,
    });
    excluded.push(snapshotContributor as XbmcExcludedContributorSnapshot);
  }

  const generatedAt = options.generatedAt
    ?? deriveDeterministicGeneratedAt({
      curatedAt: manifest.curatedAt,
      retained,
      excluded,
    });

  const sortedSnapshot = sortSnapshot({
    fixtureSetVersion: manifest.fixtureSetVersion,
    repository: manifest.repository,
    curatedAt: manifest.curatedAt,
    manifestPath,
    snapshotPath,
    generatedAt,
    refreshCommand,
    status: failures.length > 0 ? "degraded" : "ready",
    retained,
    excluded,
    diagnostics: {
      statusCode: failures.length > 0 ? "snapshot-degraded" : "snapshot-refreshed",
      retainedCount: retained.length,
      excludedCount: excluded.length,
      cohortCoverage: {
        senior: 0,
        "ambiguous-middle": 0,
        newcomer: 0,
      },
      exclusionsByReason: {
        bot: 0,
        "alias-collision": 0,
        "ambiguous-identity": 0,
      },
      sourceAvailability: {
        github: { pending: 0, available: 0, unavailable: 0 },
        localGit: { pending: 0, available: 0, unavailable: 0 },
      },
      provenanceCompleteness: {
        retainedWithoutRecords: 0,
        excludedWithoutRecords: 0,
      },
      aliasCollisionDiagnostics: [],
      failures: dedupeFailures(failures),
    },
  });

  const summary = summarizeFixtureManifest(sortedSnapshot as unknown as ContributorFixtureManifest);

  sortedSnapshot.diagnostics = {
    statusCode: sortedSnapshot.status === "degraded" ? "snapshot-degraded" : "snapshot-refreshed",
    retainedCount: sortedSnapshot.retained.length,
    excludedCount: sortedSnapshot.excluded.length,
    cohortCoverage: summary.cohortCoverage,
    exclusionsByReason: summary.exclusionsByReason,
    sourceAvailability: summary.provenance.sourceAvailability,
    provenanceCompleteness: {
      retainedWithoutRecords: sortedSnapshot.retained.filter(
        (entry) => entry.provenanceRecords.length === 0,
      ).length,
      excludedWithoutRecords: sortedSnapshot.excluded.filter(
        (entry) => entry.provenanceRecords.length === 0,
      ).length,
    },
    aliasCollisionDiagnostics: summary.aliasCollisionDiagnostics,
    failures: dedupeFailures(failures),
  };

  if (sortedSnapshot.diagnostics.provenanceCompleteness.retainedWithoutRecords > 0) {
    throw new XbmcFixtureRefreshError(
      "Retained contributors must emit at least one machine-readable provenance record.",
    );
  }

  const serialized = `${JSON.stringify(sortedSnapshot, null, 2)}\n`;
  const writeSnapshotFile = options.writeSnapshotFile ?? writeSnapshotFileDefault;
  await writeSnapshotFile(snapshotPath, serialized);

  return {
    statusCode: sortedSnapshot.diagnostics.statusCode,
    snapshotPath,
    retainedCount: sortedSnapshot.retained.length,
    excludedCount: sortedSnapshot.excluded.length,
    failures: sortedSnapshot.diagnostics.failures,
    snapshot: sortedSnapshot,
  };
}

async function buildContributorSnapshot(params: {
  contributor: FixtureRecord;
  repository: string;
  workspacePath: string | null;
  collectGitHubEvidence: (params: {
    repository: string;
    contributor: FixtureRecord;
  }) => Promise<GitHubEvidenceCollectionResult>;
  githubTimeoutMs: number;
  localGitEvidence: LocalGitEvidenceCollectionResult;
  failures: XbmcFixtureRefreshFailure[];
}): Promise<FixtureRecord & { provenanceRecords: XbmcFixtureProvenanceRecord[] }> {
  const {
    contributor,
    repository,
    workspacePath,
    collectGitHubEvidence,
    githubTimeoutMs,
    localGitEvidence,
    failures,
  } = params;

  const githubBundle = await buildGitHubBundle({
    contributor,
    repository,
    collectGitHubEvidence,
    githubTimeoutMs,
  });
  failures.push(...githubBundle.failures);

  const localGitBundle = buildLocalGitBundle({
    contributor,
    workspacePath,
    localGitEvidence,
  });

  const provenanceRecords = sortAndValidateProvenanceRecords([
    ...githubBundle.records,
    ...localGitBundle.records,
  ]);

  const provenance: FixtureProvenance = {
    github: summarizeSourceRecords(
      provenanceRecords.filter((record) => record.source.startsWith("github-")),
      null,
    ),
    localGit: summarizeSourceRecords(
      provenanceRecords.filter((record) => record.source === "local-git-shortlog"),
      workspacePath,
    ),
  };

  return {
    ...contributor,
    provenance,
    provenanceRecords,
  };
}

async function buildGitHubBundle(params: {
  contributor: FixtureRecord;
  repository: string;
  collectGitHubEvidence: (params: {
    repository: string;
    contributor: FixtureRecord;
  }) => Promise<GitHubEvidenceCollectionResult>;
  githubTimeoutMs: number;
}): Promise<{
  records: XbmcFixtureProvenanceRecord[];
  failures: XbmcFixtureRefreshFailure[];
}> {
  const { contributor, repository, collectGitHubEvidence, githubTimeoutMs } = params;

  if (!contributor.githubUsername) {
    if (contributor.kind === "retained") {
      throw new XbmcFixtureRefreshError(
        `Retained contributor ${contributor.normalizedId} is missing a GitHub username.`,
      );
    }

    return {
      records: [
        buildUnavailableIdentityRecord(
          "github",
          "No GitHub username is curated for this excluded contributor.",
          contributor,
        ),
      ],
      failures: [],
    };
  }

  let collected: GitHubEvidenceCollectionResult;
  try {
    collected = await withTimeout(
      collectGitHubEvidence({
        repository,
        contributor,
      }),
      githubTimeoutMs,
      `GitHub evidence collection timed out after ${githubTimeoutMs}ms.`,
    );
  } catch (error) {
    const timedOut = isTimeoutError(error);
    return {
      records: [
        buildUnavailableIdentityRecord(
          "github",
          timedOut
            ? `GitHub evidence collection timed out after ${githubTimeoutMs}ms.`
            : `GitHub evidence collection failed for ${contributor.githubUsername}.`,
          contributor,
        ),
      ],
      failures: [
        {
          code: timedOut ? "github-timeout" : "github-request-failed",
          source: "github",
          message: error instanceof Error ? error.message : String(error),
          contributorNormalizedId: contributor.normalizedId,
        },
      ],
    };
  }

  const validated = sortAndValidateProvenanceRecords(collected.records ?? []);
  const failures = dedupeFailures(collected.failures ?? []);

  if (validated.length > 0) {
    return {
      records: validated,
      failures,
    };
  }

  return {
    records: [
      buildUnavailableIdentityRecord(
        "github",
        collected.note,
        contributor,
      ),
    ],
    failures,
  };
}

function buildLocalGitBundle(params: {
  contributor: FixtureRecord;
  workspacePath: string | null;
  localGitEvidence: LocalGitEvidenceCollectionResult;
}): {
  records: XbmcFixtureProvenanceRecord[];
} {
  const { contributor, workspacePath, localGitEvidence } = params;
  const records = sortAndValidateProvenanceRecords(
    localGitEvidence.recordsByNormalizedId[contributor.normalizedId] ?? [],
  );

  if (records.length > 0) {
    return { records };
  }

  return {
    records: [
      {
        source: "local-git-shortlog",
        status: "unavailable",
        note:
          localGitEvidence.sourceStatus === "unavailable"
            ? localGitEvidence.note
            : `No local git shortlog match found for ${contributor.normalizedId}.`,
        evidenceUrl: null,
        workspacePath,
        observedAt: null,
        identity: null,
        metadata: {},
      },
    ],
  };
}

function summarizeSourceRecords(
  records: XbmcFixtureProvenanceRecord[],
  fallbackWorkspacePath: string | null,
): FixtureProvenanceSource {
  const available = records.filter((record) => record.status === "available");
  const firstAvailable = available[0];
  const firstRecord = records[0];

  if (firstAvailable) {
    return {
      status: "available",
      note:
        available.length === 1
          ? firstAvailable.note
          : `Collected ${available.length} provenance records.`,
      evidenceUrl: firstAvailable.evidenceUrl,
      workspacePath: firstAvailable.workspacePath ?? fallbackWorkspacePath,
    };
  }

  return {
    status: "unavailable",
    note: firstRecord?.note ?? "No provenance available.",
    evidenceUrl: null,
    workspacePath: firstRecord?.workspacePath ?? fallbackWorkspacePath,
  };
}

function sortAndValidateProvenanceRecords(
  records: XbmcFixtureProvenanceRecord[],
): XbmcFixtureProvenanceRecord[] {
  const seen = new Set<string>();
  const validated: XbmcFixtureProvenanceRecord[] = [];

  for (const record of records) {
    validateProvenanceRecord(record);
    const normalized = {
      ...record,
      metadata: sortObject(record.metadata),
    };
    const key = JSON.stringify(normalized);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    validated.push(normalized);
  }

  return validated.sort((left, right) =>
    [
      left.source,
      left.status,
      left.evidenceUrl ?? "",
      left.workspacePath ?? "",
      left.identity ?? "",
      left.note,
      JSON.stringify(left.metadata),
    ]
      .join("\u0000")
      .localeCompare(
        [
          right.source,
          right.status,
          right.evidenceUrl ?? "",
          right.workspacePath ?? "",
          right.identity ?? "",
          right.note,
          JSON.stringify(right.metadata),
        ].join("\u0000"),
      ),
  );
}

function validateProvenanceRecord(record: XbmcFixtureProvenanceRecord): void {
  if (!SUPPORTED_EVIDENCE_SOURCES.includes(record.source)) {
    throw new XbmcFixtureRefreshError(
      `Unsupported evidence source: ${String(record.source)}`,
    );
  }

  if (record.status !== "available" && record.status !== "unavailable") {
    throw new XbmcFixtureRefreshError(
      `Unsupported evidence status for ${record.source}: ${String(record.status)}`,
    );
  }

  if (typeof record.note !== "string" || record.note.trim().length === 0) {
    throw new XbmcFixtureRefreshError(
      `Evidence source ${record.source} is missing a note.`,
    );
  }

  if (
    record.status === "available" &&
    record.evidenceUrl === null &&
    record.workspacePath === null
  ) {
    throw new XbmcFixtureRefreshError(
      `Available evidence source ${record.source} must include an evidenceUrl or workspacePath.`,
    );
  }
}

function buildAuthorizedAliasMap(
  manifest: ContributorFixtureManifest,
): Map<string, string> {
  const aliasMap = new Map<string, string>();

  for (const contributor of [...manifest.retained, ...manifest.excluded]) {
    for (const alias of collectAuthorizedAliases(contributor)) {
      const existing = aliasMap.get(alias);
      if (existing && existing !== contributor.normalizedId) {
        throw new XbmcFixtureRefreshError(
          `Alias collision for alias '${alias}' between ${existing} and ${contributor.normalizedId}.`,
        );
      }
      aliasMap.set(alias, contributor.normalizedId);
    }
  }

  return aliasMap;
}

function collectAuthorizedAliases(contributor: FixtureRecord): string[] {
  const aliases = new Set<string>();
  aliases.add(contributor.normalizedId);
  aliases.add(normalizeFixtureIdentity(contributor.displayName));
  if (contributor.githubUsername) {
    aliases.add(normalizeFixtureIdentity(contributor.githubUsername));
  }
  return [...aliases].filter((alias) => alias.length > 0);
}

function validateRetainedGithubUsernames(
  manifest: ContributorFixtureManifest,
): void {
  for (const retained of manifest.retained) {
    if (!retained.githubUsername) {
      throw new XbmcFixtureRefreshError(
        `Retained contributor ${retained.normalizedId} is missing a GitHub username.`,
      );
    }
  }
}

function pickWorkspacePath(manifest: ContributorFixtureManifest): string | null {
  const candidates = new Set<string>();
  for (const contributor of [...manifest.retained, ...manifest.excluded]) {
    if (contributor.provenance.localGit.workspacePath) {
      candidates.add(contributor.provenance.localGit.workspacePath);
    }
  }

  const sorted = [...candidates].sort((left, right) => left.localeCompare(right));
  return sorted[0] ?? "tmp/xbmc";
}

function buildUnavailableIdentityRecord(
  source: "github",
  note: string,
  contributor: FixtureRecord,
): XbmcFixtureProvenanceRecord {
  return {
    source: "github-identity",
    status: "unavailable",
    note,
    evidenceUrl: null,
    workspacePath: null,
    observedAt: null,
    identity: contributor.githubUsername,
    metadata: {
      normalizedId: contributor.normalizedId,
      kind: contributor.kind,
    },
  };
}

async function writeSnapshotFileDefault(
  snapshotPath: string,
  content: string,
): Promise<void> {
  await mkdir(dirname(snapshotPath), { recursive: true });
  await writeFile(snapshotPath, content, "utf8");
}

function sortSnapshot(snapshot: XbmcFixtureSnapshot): XbmcFixtureSnapshot {
  const sortedManifest = sortFixtureManifest(snapshot as unknown as ContributorFixtureManifest);

  return {
    ...snapshot,
    retained: sortedManifest.retained.map((entry) => {
      const source = snapshot.retained.find(
        (candidate) => candidate.normalizedId === entry.normalizedId,
      );
      return {
        ...(source ?? (entry as XbmcRetainedContributorSnapshot)),
        provenanceRecords: sortAndValidateProvenanceRecords(
          source?.provenanceRecords ?? [],
        ),
      };
    }),
    excluded: sortedManifest.excluded.map((entry) => {
      const source = snapshot.excluded.find(
        (candidate) => candidate.normalizedId === entry.normalizedId,
      );
      return {
        ...(source ?? (entry as XbmcExcludedContributorSnapshot)),
        relatedNormalizedIds: [...entry.relatedNormalizedIds].sort((left, right) =>
          left.localeCompare(right),
        ),
        provenanceRecords: sortAndValidateProvenanceRecords(
          source?.provenanceRecords ?? [],
        ),
      };
    }),
  };
}

function deriveDeterministicGeneratedAt(params: {
  curatedAt: string;
  retained: XbmcRetainedContributorSnapshot[];
  excluded: XbmcExcludedContributorSnapshot[];
}): string {
  const observedTimestamps = [...params.retained, ...params.excluded]
    .flatMap((entry) => entry.provenanceRecords)
    .map((record) => record.observedAt)
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value));

  if (observedTimestamps.length === 0) {
    return params.curatedAt;
  }

  return new Date(Math.max(...observedTimestamps)).toISOString();
}

function dedupeFailures(
  failures: XbmcFixtureRefreshFailure[],
): XbmcFixtureRefreshFailure[] {
  const seen = new Set<string>();
  const deduped: XbmcFixtureRefreshFailure[] = [];

  for (const failure of failures) {
    const normalized = {
      ...failure,
      contributorNormalizedId: failure.contributorNormalizedId ?? null,
    };
    const key = JSON.stringify(normalized);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(normalized);
  }

  return deduped.sort((left, right) =>
    [
      left.source,
      left.code,
      left.contributorNormalizedId ?? "",
      left.message,
    ]
      .join("\u0000")
      .localeCompare(
        [
          right.source,
          right.code,
          right.contributorNormalizedId ?? "",
          right.message,
        ].join("\u0000"),
      ),
  );
}

function sortObject(
  value: Record<string, EvidenceMetadataValue>,
): Record<string, EvidenceMetadataValue> {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof TimedOutError
    || (error instanceof Error && /timed out/i.test(error.message));
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new TimedOutError(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function createLiveGitHubEvidenceCollector(repository: string, githubTimeoutMs: number) {
  const environment = loadGitHubEnvironment();
  if (!environment.available) {
    return async ({ contributor }: { repository: string; contributor: FixtureRecord }) => ({
      sourceStatus: "unavailable" as const,
      note: environment.note,
      records: [],
      failures: contributor.githubUsername
        ? [
            {
              code: "github-access-unavailable",
              source: "github" as const,
              message: environment.note,
              contributorNormalizedId: contributor.normalizedId,
            },
          ]
        : [],
    });
  }

  const logger = pino({ level: "silent" });
  const { owner, repoName } = parseRepository(repository);

  try {
    const githubApp = createGitHubApp(
      buildGitHubAppConfig(repository, environment.privateKey) as AppConfig,
      logger,
    );
    await withTimeout(
      githubApp.initialize({ requestTimeoutMs: githubTimeoutMs }),
      githubTimeoutMs,
      `GitHub app initialization timed out after ${githubTimeoutMs}ms.`,
    );
    const installationContext = await withTimeout(
      githubApp.getRepoInstallationContext(owner, repoName, {
        requestTimeoutMs: githubTimeoutMs,
      }),
      githubTimeoutMs,
      `GitHub installation lookup timed out after ${githubTimeoutMs}ms.`,
    );
    if (!installationContext) {
      const note = `GitHub App is not installed on ${repository}.`;
      return async ({ contributor }: { repository: string; contributor: FixtureRecord }) => ({
        sourceStatus: "unavailable" as const,
        note,
        records: [],
        failures: contributor.githubUsername
          ? [
              {
                code: "github-access-unavailable",
                source: "github" as const,
                message: note,
                contributorNormalizedId: contributor.normalizedId,
              },
            ]
          : [],
      });
    }

    const octokit = await withTimeout(
      githubApp.getInstallationOctokit(installationContext.installationId, {
        requestTimeoutMs: githubTimeoutMs,
      }),
      githubTimeoutMs,
      `GitHub installation client creation timed out after ${githubTimeoutMs}ms.`,
    );

    return async ({ contributor }: { repository: string; contributor: FixtureRecord }) => {
      if (!contributor.githubUsername) {
        return {
          sourceStatus: "unavailable" as const,
          note: "No GitHub username is curated for this contributor.",
          records: [],
          failures: [],
        };
      }

      const username = contributor.githubUsername;
      const failures: XbmcFixtureRefreshFailure[] = [];
      const records = [
        await probeGitHubCommitEvidence({
          octokit,
          owner,
          repoName,
          username,
          contributor,
          githubTimeoutMs,
        }),
        await probeGitHubPullEvidence({
          octokit,
          owner,
          repoName,
          username,
          contributor,
          githubTimeoutMs,
        }),
        await probeGitHubReviewEvidence({
          octokit,
          owner,
          repoName,
          username,
          contributor,
          githubTimeoutMs,
        }),
      ].flatMap((result) => {
        failures.push(...result.failures);
        return result.records;
      });

      return {
        sourceStatus: records.some((record) => record.status === "available")
          ? ("available" as const)
          : ("unavailable" as const),
        note:
          records.some((record) => record.status === "available")
            ? "GitHub contributor evidence collected."
            : `No GitHub evidence matched ${username}.`,
        records,
        failures,
      };
    };
  } catch (error) {
    const note = error instanceof Error ? error.message : String(error);
    const failureCode = isTimeoutError(error)
      ? "github-timeout"
      : "github-access-unavailable";
    return async ({ contributor }: { repository: string; contributor: FixtureRecord }) => ({
      sourceStatus: "unavailable" as const,
      note,
      records: [],
      failures: contributor.githubUsername
        ? [
            {
              code: failureCode,
              source: "github" as const,
              message: note,
              contributorNormalizedId: contributor.normalizedId,
            },
          ]
        : [],
    });
  }
}

function loadGitHubEnvironment():
  | { available: false; note: string }
  | { available: true; privateKey: string } {
  if (!process.env.GITHUB_APP_ID?.trim()) {
    return {
      available: false,
      note: "GitHub App env is unavailable.",
    };
  }

  const keyEnv = process.env.GITHUB_PRIVATE_KEY ?? process.env.GITHUB_PRIVATE_KEY_BASE64;
  if (!keyEnv?.trim()) {
    return {
      available: false,
      note: "GitHub App env is unavailable.",
    };
  }

  if (keyEnv.startsWith("-----BEGIN")) {
    return { available: true, privateKey: keyEnv };
  }

  if (keyEnv.startsWith("/") || keyEnv.startsWith("./")) {
    if (!existsSync(keyEnv)) {
      return {
        available: false,
        note: `GitHub private key path is unavailable: ${keyEnv}`,
      };
    }
    return {
      available: true,
      privateKey: readFileSync(keyEnv, "utf8"),
    };
  }

  try {
    return {
      available: true,
      privateKey: atob(keyEnv),
    };
  } catch {
    return {
      available: false,
      note: "GitHub App env is unavailable.",
    };
  }
}

function parseRepository(repository: string): { owner: string; repoName: string } {
  const [owner, repoName, ...rest] = repository.split("/");
  if (!owner || !repoName || rest.length > 0) {
    throw new XbmcFixtureRefreshError(
      `Invalid repository '${repository}'. Expected owner/repo.`,
    );
  }
  return { owner, repoName };
}

function buildGitHubAppConfig(repository: string, privateKey: string) {
  return {
    githubAppId: process.env.GITHUB_APP_ID!,
    githubPrivateKey: privateKey,
    webhookSecret: "unused",
    slackSigningSecret: "unused",
    slackBotToken: "unused",
    slackBotUserId: "unused",
    slackKodiaiChannelId: "unused",
    slackDefaultRepo: repository,
    slackAssistantModel: "unused",
    port: 0,
    logLevel: "info",
    botAllowList: [],
    slackWikiChannelId: "",
    wikiStalenessThresholdDays: 30,
    wikiGithubOwner: "",
    wikiGithubRepo: "",
    botUserPat: "",
    botUserLogin: "",
    addonRepos: [],
    mcpInternalBaseUrl: "",
    acaJobImage: "",
    acaResourceGroup: "rg-kodiai",
    acaJobName: "caj-kodiai-agent",
  };
}

async function probeGitHubCommitEvidence(params: {
  octokit: Awaited<ReturnType<ReturnType<typeof createGitHubApp>["getInstallationOctokit"]>>;
  owner: string;
  repoName: string;
  username: string;
  contributor: FixtureRecord;
  githubTimeoutMs: number;
}): Promise<{
  records: XbmcFixtureProvenanceRecord[];
  failures: XbmcFixtureRefreshFailure[];
}> {
  const {
    octokit,
    owner,
    repoName,
    username,
    contributor,
    githubTimeoutMs,
  } = params;

  try {
    const response = await octokit.rest.repos.listCommits({
      owner,
      repo: repoName,
      author: username,
      per_page: 1,
      request: { timeout: githubTimeoutMs },
    });
    const commit = response.data[0];
    if (!commit || typeof commit.html_url !== "string" || commit.html_url.length === 0) {
      return {
        records: [
          {
            source: "github-commit",
            status: "unavailable",
            note: `No authored commit evidence found for ${username}.`,
            evidenceUrl: null,
            workspacePath: null,
            observedAt: null,
            identity: username,
            metadata: {},
          },
        ],
        failures: [],
      };
    }

    return {
      records: [
        {
          source: "github-commit",
          status: "available",
          note: "Recent authored commit found.",
          evidenceUrl: commit.html_url,
          workspacePath: null,
          observedAt: commit.commit.author?.date ?? null,
          identity: username,
          metadata: {
            sha: commit.sha,
          },
        },
      ],
      failures: [],
    };
  } catch (error) {
    return {
      records: [
        {
          source: "github-commit",
          status: "unavailable",
          note: `Failed to collect commit evidence for ${username}.`,
          evidenceUrl: null,
          workspacePath: null,
          observedAt: null,
          identity: username,
          metadata: {},
        },
      ],
      failures: [
        {
          code: "github-request-failed",
          source: "github",
          message: error instanceof Error ? error.message : String(error),
          contributorNormalizedId: contributor.normalizedId,
        },
      ],
    };
  }
}

async function probeGitHubPullEvidence(params: {
  octokit: Awaited<ReturnType<ReturnType<typeof createGitHubApp>["getInstallationOctokit"]>>;
  owner: string;
  repoName: string;
  username: string;
  contributor: FixtureRecord;
  githubTimeoutMs: number;
}): Promise<{
  records: XbmcFixtureProvenanceRecord[];
  failures: XbmcFixtureRefreshFailure[];
}> {
  const {
    octokit,
    owner,
    repoName,
    username,
    contributor,
    githubTimeoutMs,
  } = params;

  try {
    const response = await octokit.rest.search.issuesAndPullRequests({
      q: `repo:${owner}/${repoName} is:pr author:${username}`,
      sort: "updated",
      order: "desc",
      per_page: 1,
      request: { timeout: githubTimeoutMs },
    });
    const pull = response.data.items?.[0];
    if (!pull || typeof pull.html_url !== "string" || pull.html_url.length === 0) {
      return {
        records: [
          {
            source: "github-pull",
            status: "unavailable",
            note: `No authored pull request evidence found for ${username}.`,
            evidenceUrl: null,
            workspacePath: null,
            observedAt: null,
            identity: username,
            metadata: {},
          },
        ],
        failures: [],
      };
    }

    return {
      records: [
        {
          source: "github-pull",
          status: "available",
          note: "Recent authored pull request found.",
          evidenceUrl: pull.html_url,
          workspacePath: null,
          observedAt: ("updated_at" in pull && typeof pull.updated_at === "string") ? pull.updated_at : null,
          identity: username,
          metadata: {
            number: typeof pull.number === "number" ? pull.number : null,
          },
        },
      ],
      failures: [],
    };
  } catch (error) {
    return {
      records: [
        {
          source: "github-pull",
          status: "unavailable",
          note: `Failed to collect pull request evidence for ${username}.`,
          evidenceUrl: null,
          workspacePath: null,
          observedAt: null,
          identity: username,
          metadata: {},
        },
      ],
      failures: [
        {
          code: "github-request-failed",
          source: "github",
          message: error instanceof Error ? error.message : String(error),
          contributorNormalizedId: contributor.normalizedId,
        },
      ],
    };
  }
}

async function probeGitHubReviewEvidence(params: {
  octokit: Awaited<ReturnType<ReturnType<typeof createGitHubApp>["getInstallationOctokit"]>>;
  owner: string;
  repoName: string;
  username: string;
  contributor: FixtureRecord;
  githubTimeoutMs: number;
}): Promise<{
  records: XbmcFixtureProvenanceRecord[];
  failures: XbmcFixtureRefreshFailure[];
}> {
  const {
    octokit,
    owner,
    repoName,
    username,
    contributor,
    githubTimeoutMs,
  } = params;

  try {
    const response = await octokit.rest.search.issuesAndPullRequests({
      q: `repo:${owner}/${repoName} is:pr reviewed-by:${username}`,
      sort: "updated",
      order: "desc",
      per_page: 1,
      request: { timeout: githubTimeoutMs },
    });
    const pull = response.data.items?.[0];
    if (!pull || typeof pull.html_url !== "string" || pull.html_url.length === 0) {
      return {
        records: [
          {
            source: "github-review",
            status: "unavailable",
            note: `No review evidence found for ${username}.`,
            evidenceUrl: null,
            workspacePath: null,
            observedAt: null,
            identity: username,
            metadata: {},
          },
        ],
        failures: [],
      };
    }

    return {
      records: [
        {
          source: "github-review",
          status: "available",
          note: "Recent review found.",
          evidenceUrl: pull.html_url,
          workspacePath: null,
          observedAt: ("updated_at" in pull && typeof pull.updated_at === "string") ? pull.updated_at : null,
          identity: username,
          metadata: {
            number: typeof pull.number === "number" ? pull.number : null,
          },
        },
      ],
      failures: [],
    };
  } catch (error) {
    return {
      records: [
        {
          source: "github-review",
          status: "unavailable",
          note: `Failed to collect review evidence for ${username}.`,
          evidenceUrl: null,
          workspacePath: null,
          observedAt: null,
          identity: username,
          metadata: {},
        },
      ],
      failures: [
        {
          code: "github-request-failed",
          source: "github",
          message: error instanceof Error ? error.message : String(error),
          contributorNormalizedId: contributor.normalizedId,
        },
      ],
    };
  }
}

async function collectLiveLocalGitEvidence(params: {
  manifest: ContributorFixtureManifest;
  workspacePath: string | null;
  aliasMap: Map<string, string>;
}): Promise<LocalGitEvidenceCollectionResult> {
  const { workspacePath, aliasMap } = params;

  if (!workspacePath || !existsSync(workspacePath)) {
    return {
      sourceStatus: "unavailable",
      note: `${workspacePath ?? "tmp/xbmc"} is absent.`,
      recordsByNormalizedId: {},
      failures: [
        {
          code: "local-git-workspace-missing",
          source: "local-git",
          message: `${workspacePath ?? "tmp/xbmc"} is absent.`,
        },
      ],
    };
  }

  try {
    const { stdout } = await execFileAsync("git", [
      "-C",
      workspacePath,
      "shortlog",
      "-sne",
      "--all",
    ]);

    const recordsByNormalizedId: Record<string, XbmcFixtureProvenanceRecord[]> = {};
    const failures: XbmcFixtureRefreshFailure[] = [];
    const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    let parsedEntryCount = 0;

    for (const line of lines) {
      const parsed = parseShortlogLine(line);
      if (!parsed) {
        continue;
      }

      parsedEntryCount += 1;
      const canonicalId = aliasMap.get(normalizeFixtureIdentity(parsed.name));
      if (!canonicalId) {
        continue;
      }

      const record: XbmcFixtureProvenanceRecord = {
        source: "local-git-shortlog",
        status: "available",
        note: `Matched ${parsed.name} in local git shortlog.`,
        evidenceUrl: null,
        workspacePath,
        observedAt: null,
        identity: parsed.name,
        metadata: {
          authorEmail: parsed.email,
          commitCount: parsed.commitCount,
        },
      };

      recordsByNormalizedId[canonicalId] ??= [];
      recordsByNormalizedId[canonicalId]!.push(record);
    }

    if (lines.length > 0 && parsedEntryCount === 0) {
      failures.push({
        code: "local-git-shortlog-unparseable",
        source: "local-git",
        message: `No parseable local git shortlog entries were found in ${workspacePath}.`,
      });
      return {
        sourceStatus: "unavailable",
        note: `No parseable local git shortlog entries were found in ${workspacePath}.`,
        recordsByNormalizedId: {},
        failures,
      };
    }

    return {
      sourceStatus: "available",
      note: `${workspacePath} shortlog parsed.`,
      recordsByNormalizedId,
      failures,
    };
  } catch (error) {
    return {
      sourceStatus: "unavailable",
      note: `Failed to read local git shortlog from ${workspacePath}.`,
      recordsByNormalizedId: {},
      failures: [
        {
          code: "local-git-command-failed",
          source: "local-git",
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}

function parseShortlogLine(line: string):
  | { commitCount: number; name: string; email: string }
  | null {
  const match = line.match(/^(\d+)\s+(.+?)\s+<([^>]+)>$/);
  if (!match) {
    return null;
  }

  const commitCount = Number.parseInt(match[1] ?? "", 10);
  const name = match[2]?.trim() ?? "";
  const email = match[3]?.trim() ?? "";
  if (!Number.isFinite(commitCount) || commitCount < 0 || name.length === 0 || email.length === 0) {
    return null;
  }

  return {
    commitCount,
    name,
    email,
  };
}
