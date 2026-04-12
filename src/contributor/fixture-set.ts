import { readFile } from "node:fs/promises";
import { z } from "zod";

export const FIXTURE_COHORTS = [
  "senior",
  "ambiguous-middle",
  "newcomer",
] as const;

export const FIXTURE_EXCLUSION_REASONS = [
  "bot",
  "alias-collision",
  "ambiguous-identity",
] as const;

export const FIXTURE_SOURCE_STATUSES = [
  "pending",
  "available",
  "unavailable",
] as const;

export type FixtureCohort = (typeof FIXTURE_COHORTS)[number];
export type FixtureExclusionReason =
  (typeof FIXTURE_EXCLUSION_REASONS)[number];
export type FixtureSourceStatus = (typeof FIXTURE_SOURCE_STATUSES)[number];

export type FixtureObservedCommitCounts = {
  allTime: number;
  since2025: number;
};

export type FixtureProvenanceSource = {
  status: FixtureSourceStatus;
  note: string;
  evidenceUrl: string | null;
  workspacePath: string | null;
};

export type FixtureProvenance = {
  github: FixtureProvenanceSource;
  localGit: FixtureProvenanceSource;
};

type FixtureRecordBase = {
  normalizedId: string;
  displayName: string;
  githubUsername: string | null;
  observedCommitCounts: FixtureObservedCommitCounts;
  provenance: FixtureProvenance;
};

export type RetainedContributorFixture = FixtureRecordBase & {
  kind: "retained";
  cohort: FixtureCohort;
  selectionNotes: string;
};

export type ExcludedContributorFixture = FixtureRecordBase & {
  kind: "excluded";
  exclusionReason: FixtureExclusionReason;
  exclusionNotes: string;
  relatedNormalizedIds: string[];
};

export type ContributorFixtureManifest = {
  fixtureSetVersion: number;
  repository: string;
  curatedAt: string;
  snapshotPath: string;
  retained: RetainedContributorFixture[];
  excluded: ExcludedContributorFixture[];
};

export type FixtureManifestSummary = {
  retainedCount: number;
  excludedCount: number;
  duplicateNormalizedIds: string[];
  cohortCoverage: Record<FixtureCohort, number>;
  exclusionsByReason: Record<FixtureExclusionReason, number>;
  provenance: {
    retainedMissingPlaceholders: number;
    sourceAvailability: {
      github: Record<FixtureSourceStatus, number>;
      localGit: Record<FixtureSourceStatus, number>;
    };
  };
  aliasCollisionDiagnostics: Array<{
    normalizedId: string;
    exclusionReason: Extract<
      FixtureExclusionReason,
      "alias-collision" | "ambiguous-identity"
    >;
    relatedNormalizedIds: string[];
  }>;
};

const commitCountSchema = z
  .object({
    allTime: z.number().int().nonnegative(),
    since2025: z.number().int().nonnegative(),
  })
  .superRefine((value, ctx) => {
    if (value.since2025 > value.allTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "since2025 commit count cannot exceed allTime count",
      });
    }
  });

const provenanceSourceSchema = z
  .object({
    status: z.enum(FIXTURE_SOURCE_STATUSES),
    note: z.string().trim().min(1, "provenance note is required"),
    evidenceUrl: z.string().trim().url().nullable(),
    workspacePath: z.string().trim().min(1).nullable(),
  })
  .superRefine((value, ctx) => {
    if (
      value.status === "available" &&
      value.evidenceUrl === null &&
      value.workspacePath === null
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "available provenance sources must include an evidenceUrl or workspacePath",
      });
    }
  });

const provenanceSchema = z.object({
  github: provenanceSourceSchema,
  localGit: provenanceSourceSchema,
});

const fixtureCohortSchema = z
  .string()
  .trim()
  .refine(
    (value): value is FixtureCohort =>
      FIXTURE_COHORTS.includes(value as FixtureCohort),
    {
      message: "unsupported cohort label",
    },
  );

const fixtureExclusionReasonSchema = z
  .string()
  .trim()
  .refine(
    (value): value is FixtureExclusionReason =>
      FIXTURE_EXCLUSION_REASONS.includes(value as FixtureExclusionReason),
    {
      message: "unsupported exclusion reason",
    },
  );

const retainedFixtureSchema = z.object({
  kind: z.literal("retained"),
  normalizedId: z.string().trim().min(1),
  displayName: z.string().trim().min(1),
  githubUsername: z.string().trim().min(1).nullable(),
  cohort: fixtureCohortSchema,
  selectionNotes: z.string().trim().min(1),
  observedCommitCounts: commitCountSchema,
  provenance: provenanceSchema,
});

const excludedFixtureSchema = z.object({
  kind: z.literal("excluded"),
  normalizedId: z.string().trim().min(1),
  displayName: z.string().trim().min(1),
  githubUsername: z.string().trim().min(1).nullable(),
  exclusionReason: fixtureExclusionReasonSchema,
  exclusionNotes: z.string().trim().min(1),
  relatedNormalizedIds: z.array(z.string().trim().min(1)),
  observedCommitCounts: commitCountSchema,
  provenance: provenanceSchema,
});

const contributorFixtureManifestSchema = z
  .object({
    fixtureSetVersion: z.number().int().positive(),
    repository: z.string().trim().min(1),
    curatedAt: z.string().datetime({ offset: true }),
    snapshotPath: z.string().trim().min(1),
    retained: z.array(retainedFixtureSchema).min(1),
    excluded: z.array(excludedFixtureSchema),
  })
  .superRefine((manifest, ctx) => {
    const allRecords = [...manifest.retained, ...manifest.excluded];
    const seenIds = new Map<string, number>();

    for (const [index, record] of allRecords.entries()) {
      const pathPrefix =
        index < manifest.retained.length
          ? (["retained", index] as (string | number)[])
          : (["excluded", index - manifest.retained.length] as (string | number)[]);

      const expectedNormalizedId = normalizeFixtureIdentity(
        record.githubUsername ?? record.displayName,
      );

      if (record.normalizedId !== expectedNormalizedId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [...pathPrefix, "normalizedId"],
          message: `normalizedId must equal ${expectedNormalizedId}`,
        });
      }

      seenIds.set(record.normalizedId, (seenIds.get(record.normalizedId) ?? 0) + 1);
    }

    for (const [normalizedId, count] of seenIds.entries()) {
      if (count > 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate normalized identity: ${normalizedId}`,
        });
      }
    }

    const cohortCoverage = buildZeroedCoverageCounts();
    for (const retained of manifest.retained) {
      cohortCoverage[retained.cohort] += 1;
    }

    for (const cohort of FIXTURE_COHORTS) {
      if (cohortCoverage[cohort] === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["retained"],
          message: `missing retained cohort coverage for ${cohort}`,
        });
      }
    }

    if (manifest.excluded.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["excluded"],
        message: "at least one explicit exclusion is required",
      });
    }

    for (const [index, excluded] of manifest.excluded.entries()) {
      if (
        (excluded.exclusionReason === "alias-collision" ||
          excluded.exclusionReason === "ambiguous-identity") &&
        excluded.relatedNormalizedIds.length === 0
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["excluded", index, "relatedNormalizedIds"],
          message:
            "alias/ambiguous exclusions must name the related normalized identities",
        });
      }
    }

    for (const [index, retained] of manifest.retained.entries()) {
      if (!hasRequiredProvenancePlaceholders(retained.provenance)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["retained", index, "provenance"],
          message:
            "retained contributors must include github and localGit provenance placeholders",
        });
      }
    }
  });

export function normalizeFixtureIdentity(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function hasRequiredProvenancePlaceholders(
  provenance: FixtureProvenance,
): boolean {
  const githubReady =
    typeof provenance.github.note === "string" && provenance.github.note.trim().length > 0;
  const localGitReady =
    typeof provenance.localGit.note === "string" &&
    provenance.localGit.note.trim().length > 0;

  return githubReady && localGitReady;
}

export function assertValidFixtureManifest(
  manifest: unknown,
): ContributorFixtureManifest {
  const parsed = contributorFixtureManifestSchema.safeParse(manifest);

  if (!parsed.success) {
    throw new Error(formatFixtureIssues(parsed.error.issues));
  }

  return sortFixtureManifest(parsed.data);
}

export async function loadFixtureManifest(
  manifestPath: string,
): Promise<ContributorFixtureManifest> {
  const raw = await readFile(manifestPath, "utf8");
  const parsedJson = JSON.parse(raw) as unknown;
  return assertValidFixtureManifest(parsedJson);
}

export function sortFixtureManifest(
  manifest: ContributorFixtureManifest,
): ContributorFixtureManifest {
  return {
    ...manifest,
    retained: [...manifest.retained].sort((left, right) =>
      left.normalizedId.localeCompare(right.normalizedId),
    ),
    excluded: [...manifest.excluded]
      .map((entry) => ({
        ...entry,
        relatedNormalizedIds: [...entry.relatedNormalizedIds].sort((left, right) =>
          left.localeCompare(right),
        ),
      }))
      .sort((left, right) => left.normalizedId.localeCompare(right.normalizedId)),
  };
}

export function summarizeFixtureManifest(
  manifest: ContributorFixtureManifest,
): FixtureManifestSummary {
  const duplicateNormalizedIds = collectDuplicateNormalizedIds(manifest);
  const cohortCoverage = buildZeroedCoverageCounts();
  const exclusionsByReason = buildZeroedExclusionCounts();
  const githubAvailability = buildZeroedSourceStatusCounts();
  const localGitAvailability = buildZeroedSourceStatusCounts();
  let retainedMissingPlaceholders = 0;

  for (const retained of manifest.retained) {
    cohortCoverage[retained.cohort] += 1;
    githubAvailability[retained.provenance.github.status] += 1;
    localGitAvailability[retained.provenance.localGit.status] += 1;
    if (!hasRequiredProvenancePlaceholders(retained.provenance)) {
      retainedMissingPlaceholders += 1;
    }
  }

  for (const excluded of manifest.excluded) {
    exclusionsByReason[excluded.exclusionReason] += 1;
    githubAvailability[excluded.provenance.github.status] += 1;
    localGitAvailability[excluded.provenance.localGit.status] += 1;
  }

  return {
    retainedCount: manifest.retained.length,
    excludedCount: manifest.excluded.length,
    duplicateNormalizedIds,
    cohortCoverage,
    exclusionsByReason,
    provenance: {
      retainedMissingPlaceholders,
      sourceAvailability: {
        github: githubAvailability,
        localGit: localGitAvailability,
      },
    },
    aliasCollisionDiagnostics: manifest.excluded
      .filter(
        (
          entry,
        ): entry is ExcludedContributorFixture & {
          exclusionReason: "alias-collision" | "ambiguous-identity";
        } =>
          entry.exclusionReason === "alias-collision" ||
          entry.exclusionReason === "ambiguous-identity",
      )
      .map((entry) => ({
        normalizedId: entry.normalizedId,
        exclusionReason: entry.exclusionReason,
        relatedNormalizedIds: [...entry.relatedNormalizedIds],
      })),
  };
}

function collectDuplicateNormalizedIds(
  manifest: ContributorFixtureManifest,
): string[] {
  const counts = new Map<string, number>();
  for (const record of [...manifest.retained, ...manifest.excluded]) {
    counts.set(record.normalizedId, (counts.get(record.normalizedId) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([normalizedId]) => normalizedId)
    .sort((left, right) => left.localeCompare(right));
}

function buildZeroedCoverageCounts(): Record<FixtureCohort, number> {
  return {
    senior: 0,
    "ambiguous-middle": 0,
    newcomer: 0,
  };
}

function buildZeroedExclusionCounts(): Record<FixtureExclusionReason, number> {
  return {
    bot: 0,
    "alias-collision": 0,
    "ambiguous-identity": 0,
  };
}

function buildZeroedSourceStatusCounts(): Record<FixtureSourceStatus, number> {
  return {
    pending: 0,
    available: 0,
    unavailable: 0,
  };
}

function formatFixtureIssues(issues: z.ZodIssue[]): string {
  return issues
    .map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
      return `${path}${issue.message}`;
    })
    .join("; ");
}
