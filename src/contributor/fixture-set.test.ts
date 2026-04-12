import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";

const MANIFEST_PATH = "fixtures/contributor-calibration/xbmc-manifest.json";
const SNAPSHOT_PATH = "fixtures/contributor-calibration/xbmc-snapshot.json";

type FixtureSetModule = typeof import("./fixture-set.ts");

async function loadFixtureSetModule(): Promise<FixtureSetModule | null> {
  return (await import("./fixture-set.ts").catch(() => null)) as FixtureSetModule | null;
}

function buildValidManifest() {
  return {
    fixtureSetVersion: 1,
    repository: "xbmc/xbmc",
    curatedAt: "2026-04-10T00:00:00.000Z",
    snapshotPath: SNAPSHOT_PATH,
    retained: [
      {
        kind: "retained",
        normalizedId: "fuzzard",
        displayName: "fuzzard",
        githubUsername: "fuzzard",
        cohort: "senior",
        selectionNotes: "Clear senior anchor from the xbmc long-run contributor head.",
        observedCommitCounts: {
          allTime: 2705,
          since2025: 522,
        },
        provenance: {
          github: {
            status: "pending",
            note: "GitHub enrichment deferred to refresh.",
            evidenceUrl: null,
            workspacePath: null,
          },
          localGit: {
            status: "available",
            note: "Observed in tmp/xbmc shortlog during fixture curation.",
            evidenceUrl: null,
            workspacePath: "tmp/xbmc",
          },
        },
      },
      {
        kind: "retained",
        normalizedId: "koprajs",
        displayName: "KOPRajs",
        githubUsername: "KOPRajs",
        cohort: "ambiguous-middle",
        selectionNotes:
          "Intentionally ambiguous middle-band sample with enough activity to avoid a one-off newcomer label.",
        observedCommitCounts: {
          allTime: 27,
          since2025: 15,
        },
        provenance: {
          github: {
            status: "pending",
            note: "GitHub enrichment deferred to refresh.",
            evidenceUrl: null,
            workspacePath: null,
          },
          localGit: {
            status: "available",
            note: "Observed in tmp/xbmc shortlog during fixture curation.",
            evidenceUrl: null,
            workspacePath: "tmp/xbmc",
          },
        },
      },
      {
        kind: "retained",
        normalizedId: "fkoemep",
        displayName: "fkoemep",
        githubUsername: "fkoemep",
        cohort: "newcomer",
        selectionNotes: "Single-commit tail sample used as a clear newcomer anchor.",
        observedCommitCounts: {
          allTime: 1,
          since2025: 1,
        },
        provenance: {
          github: {
            status: "pending",
            note: "GitHub enrichment deferred to refresh.",
            evidenceUrl: null,
            workspacePath: null,
          },
          localGit: {
            status: "available",
            note: "Observed in tmp/xbmc shortlog during fixture curation.",
            evidenceUrl: null,
            workspacePath: "tmp/xbmc",
          },
        },
      },
    ],
    excluded: [
      {
        kind: "excluded",
        normalizedId: "hosted-weblate",
        displayName: "Hosted Weblate",
        githubUsername: null,
        exclusionReason: "bot",
        exclusionNotes: "Automation account for localization syncs.",
        relatedNormalizedIds: [],
        observedCommitCounts: {
          allTime: 89,
          since2025: 28,
        },
        provenance: {
          github: {
            status: "pending",
            note: "GitHub enrichment deferred to refresh.",
            evidenceUrl: null,
            workspacePath: null,
          },
          localGit: {
            status: "available",
            note: "Observed in tmp/xbmc shortlog during fixture curation.",
            evidenceUrl: null,
            workspacePath: "tmp/xbmc",
          },
        },
      },
    ],
  };
}

describe("xbmc fixture contract", () => {
  test("ships the checked-in xbmc manifest, snapshot scaffold, and validator module", async () => {
    const fixtureSet = await loadFixtureSetModule();

    expect(fixtureSet).not.toBeNull();
    expect(existsSync(MANIFEST_PATH)).toBe(true);
    expect(existsSync(SNAPSHOT_PATH)).toBe(true);
  });

  test("validates the checked-in xbmc manifest for uniqueness, coverage, and provenance placeholders", async () => {
    const fixtureSet = await loadFixtureSetModule();

    expect(fixtureSet).not.toBeNull();
    if (!fixtureSet) {
      return;
    }

    const manifest = await fixtureSet.loadFixtureManifest(MANIFEST_PATH);
    const summary = fixtureSet.summarizeFixtureManifest(manifest);

    expect(summary.retainedCount).toBeGreaterThanOrEqual(3);
    expect(summary.excludedCount).toBeGreaterThanOrEqual(1);
    expect(summary.duplicateNormalizedIds).toEqual([]);
    expect(summary.cohortCoverage.senior).toBeGreaterThanOrEqual(1);
    expect(summary.cohortCoverage["ambiguous-middle"]).toBeGreaterThanOrEqual(1);
    expect(summary.cohortCoverage.newcomer).toBeGreaterThanOrEqual(1);
    expect(summary.provenance.retainedMissingPlaceholders).toBe(0);
  });

  test("rejects duplicate normalized identities", async () => {
    const fixtureSet = await loadFixtureSetModule();

    expect(fixtureSet).not.toBeNull();
    if (!fixtureSet) {
      return;
    }

    const manifest = buildValidManifest();
    manifest.retained[1]!.normalizedId = "fuzzard";

    expect(() => fixtureSet.assertValidFixtureManifest(manifest)).toThrow(
      /duplicate normalized identit/i,
    );
  });

  test("rejects exclusions without an explicit reason", async () => {
    const fixtureSet = await loadFixtureSetModule();

    expect(fixtureSet).not.toBeNull();
    if (!fixtureSet) {
      return;
    }

    const manifest = buildValidManifest();
    manifest.excluded[0]!.exclusionReason = "";

    expect(() => fixtureSet.assertValidFixtureManifest(manifest)).toThrow(
      /unsupported exclusion reason|exclusion reason/i,
    );
  });

  test("rejects unsupported cohort labels", async () => {
    const fixtureSet = await loadFixtureSetModule();

    expect(fixtureSet).not.toBeNull();
    if (!fixtureSet) {
      return;
    }

    const manifest = buildValidManifest();
    manifest.retained[1]!.cohort = "middle";

    expect(() => fixtureSet.assertValidFixtureManifest(manifest)).toThrow(
      /unsupported cohort|cohort/i,
    );
  });

  test("rejects retained samples without provenance placeholders", async () => {
    const fixtureSet = await loadFixtureSetModule();

    expect(fixtureSet).not.toBeNull();
    if (!fixtureSet) {
      return;
    }

    const manifest = buildValidManifest();
    delete (manifest.retained[0] as { provenance?: unknown }).provenance;

    expect(() => fixtureSet.assertValidFixtureManifest(manifest)).toThrow(
      /provenance|placeholder/i,
    );
  });
});
