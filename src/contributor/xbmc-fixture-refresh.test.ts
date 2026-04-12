import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type RefreshModule = {
  refreshXbmcFixtureSnapshot?: (options?: Record<string, unknown>) => Promise<any>;
};

const importModule = new Function(
  "specifier",
  "return import(specifier)",
) as (specifier: string) => Promise<unknown>;

const tempDirs: string[] = [];

async function loadRefreshModule(): Promise<RefreshModule | null> {
  return (await importModule("./xbmc-fixture-refresh.ts").catch(
    () => null,
  )) as RefreshModule | null;
}

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "xbmc-fixture-refresh-"));
  tempDirs.push(dir);
  return dir;
}

function buildManifest(): any {
  return {
    fixtureSetVersion: 1,
    repository: "xbmc/xbmc",
    curatedAt: "2026-04-10T00:00:00.000Z",
    snapshotPath: "fixtures/contributor-calibration/xbmc-snapshot.json",
    retained: [
      {
        kind: "retained",
        normalizedId: "koprajs",
        displayName: "KOPRajs",
        githubUsername: "KOPRajs",
        cohort: "ambiguous-middle",
        selectionNotes: "Ambiguous middle-band sample.",
        observedCommitCounts: {
          allTime: 27,
          since2025: 15,
        },
        provenance: {
          github: {
            status: "pending",
            note: "GitHub enrichment deferred.",
            evidenceUrl: null,
            workspacePath: null,
          },
          localGit: {
            status: "pending",
            note: "Local git enrichment deferred.",
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
        selectionNotes: "Newcomer anchor.",
        observedCommitCounts: {
          allTime: 1,
          since2025: 1,
        },
        provenance: {
          github: {
            status: "pending",
            note: "GitHub enrichment deferred.",
            evidenceUrl: null,
            workspacePath: null,
          },
          localGit: {
            status: "pending",
            note: "Local git enrichment deferred.",
            evidenceUrl: null,
            workspacePath: "tmp/xbmc",
          },
        },
      },
      {
        kind: "retained",
        normalizedId: "fuzzard",
        displayName: "fuzzard",
        githubUsername: "fuzzard",
        cohort: "senior",
        selectionNotes: "Senior anchor.",
        observedCommitCounts: {
          allTime: 2705,
          since2025: 522,
        },
        provenance: {
          github: {
            status: "pending",
            note: "GitHub enrichment deferred.",
            evidenceUrl: null,
            workspacePath: null,
          },
          localGit: {
            status: "pending",
            note: "Local git enrichment deferred.",
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
        exclusionNotes: "Automation account.",
        relatedNormalizedIds: [],
        observedCommitCounts: {
          allTime: 89,
          since2025: 28,
        },
        provenance: {
          github: {
            status: "pending",
            note: "GitHub enrichment deferred.",
            evidenceUrl: null,
            workspacePath: null,
          },
          localGit: {
            status: "pending",
            note: "Local git enrichment deferred.",
            evidenceUrl: null,
            workspacePath: "tmp/xbmc",
          },
        },
      },
    ],
  };
}

async function writeManifest(dir: string, manifest: unknown): Promise<string> {
  const manifestPath = join(dir, "xbmc-manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifestPath;
}

function githubRecord(source: string, evidenceUrl: string, note: string) {
  return {
    source,
    status: "available",
    note,
    evidenceUrl,
    workspacePath: null,
    observedAt: "2026-04-10T12:00:00.000Z",
    identity: null,
    metadata: {},
  };
}

function localGitRecord(identity: string, commitCount: number) {
  return {
    source: "local-git-shortlog",
    status: "available",
    note: `Matched ${identity} in local git shortlog.`,
    evidenceUrl: null,
    workspacePath: "tmp/xbmc",
    observedAt: null,
    identity,
    metadata: {
      commitCount,
    },
  };
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) {
      continue;
    }
    await rm(dir, { recursive: true, force: true });
  }
});

describe("xbmc fixture refresh", () => {
  test("collects GitHub and local git evidence into a stable checked-in snapshot", async () => {
    const refreshModule = await loadRefreshModule();

    expect(refreshModule).not.toBeNull();
    if (!refreshModule?.refreshXbmcFixtureSnapshot) {
      return;
    }

    const dir = await makeTempDir();
    const manifestPath = await writeManifest(dir, buildManifest());
    const snapshotPath = join(dir, "xbmc-snapshot.json");

    const collectGitHubEvidence = async ({ contributor }: { contributor: { githubUsername: string } }) => {
      const login = contributor.githubUsername.toLowerCase();
      return {
        sourceStatus: "available",
        note: "GitHub contributor evidence collected.",
        records: {
          fuzzard: [
            githubRecord(
              "github-commit",
              "https://github.com/xbmc/xbmc/commit/fuzzard-commit",
              "Recent authored commit found.",
            ),
            githubRecord(
              "github-pull",
              "https://github.com/xbmc/xbmc/pull/1001",
              "Recent authored pull request found.",
            ),
          ],
          koprajs: [
            githubRecord(
              "github-review",
              "https://github.com/xbmc/xbmc/pull/1002#pullrequestreview-1",
              "Recent review found.",
            ),
          ],
          fkoemep: [
            githubRecord(
              "github-commit",
              "https://github.com/xbmc/xbmc/commit/fkoemep-commit",
              "Recent authored commit found.",
            ),
          ],
        }[login] ?? [],
        failures: [],
      };
    };

    const collectLocalGitEvidence = async () => ({
      sourceStatus: "available",
      note: "tmp/xbmc shortlog parsed.",
      recordsByNormalizedId: {
        fuzzard: [localGitRecord("fuzzard", 1445)],
        koprajs: [localGitRecord("KOPRajs", 27)],
        fkoemep: [localGitRecord("fkoemep", 1)],
        "hosted-weblate": [localGitRecord("Hosted Weblate", 89)],
      },
      failures: [],
    });

    const first = await refreshModule.refreshXbmcFixtureSnapshot({
      manifestPath,
      snapshotPath,
      generatedAt: "2026-04-10T12:00:00.000Z",
      collectGitHubEvidence,
      collectLocalGitEvidence,
    });

    const firstJson = await readFile(snapshotPath, "utf8");
    const snapshot = JSON.parse(firstJson);

    expect(first.statusCode).toBe("snapshot-refreshed");
    expect(snapshot.generatedAt).toBe("2026-04-10T12:00:00.000Z");
    expect(snapshot.retained.map((entry: { normalizedId: string }) => entry.normalizedId)).toEqual([
      "fkoemep",
      "fuzzard",
      "koprajs",
    ]);
    expect(snapshot.excluded.map((entry: { normalizedId: string }) => entry.normalizedId)).toEqual([
      "hosted-weblate",
    ]);
    expect(snapshot.retained[1].provenance.github.status).toBe("available");
    expect(snapshot.retained[1].provenance.localGit.status).toBe("available");
    expect(snapshot.excluded[0].provenance.github.status).toBe("unavailable");
    expect(snapshot.excluded[0].provenanceRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "local-git-shortlog",
          status: "available",
          workspacePath: "tmp/xbmc",
        }),
        expect.objectContaining({
          source: "github-identity",
          status: "unavailable",
          note: expect.stringMatching(/no github username/i),
        }),
      ]),
    );
    expect(snapshot.diagnostics.statusCode).toBe("snapshot-refreshed");
    expect(snapshot.diagnostics.retainedCount).toBe(3);
    expect(snapshot.diagnostics.excludedCount).toBe(1);
    expect(snapshot.diagnostics.provenanceCompleteness.retainedWithoutRecords).toBe(0);

    const second = await refreshModule.refreshXbmcFixtureSnapshot({
      manifestPath,
      snapshotPath,
      generatedAt: "2026-04-10T12:00:00.000Z",
      collectGitHubEvidence,
      collectLocalGitEvidence,
    });

    const secondJson = await readFile(snapshotPath, "utf8");

    expect(second.statusCode).toBe("snapshot-refreshed");
    expect(secondJson).toBe(firstJson);
  });

  test("derives a deterministic generatedAt when the caller does not provide one", async () => {
    const refreshModule = await loadRefreshModule();

    expect(refreshModule).not.toBeNull();
    if (!refreshModule?.refreshXbmcFixtureSnapshot) {
      return;
    }

    const dir = await makeTempDir();
    const manifestPath = await writeManifest(dir, buildManifest());
    const snapshotPath = join(dir, "xbmc-snapshot.json");

    const collectGitHubEvidence = async ({ contributor }: { contributor: { githubUsername: string } }) => ({
      sourceStatus: "available",
      note: "GitHub contributor evidence collected.",
      records: [
        {
          source: "github-commit",
          status: "available",
          note: "Recent authored commit found.",
          evidenceUrl: `https://github.com/xbmc/xbmc/commit/${contributor.githubUsername}`,
          workspacePath: null,
          observedAt: "2026-04-10T12:00:00.000Z",
          identity: contributor.githubUsername,
          metadata: {},
        },
      ],
      failures: [],
    });

    const collectLocalGitEvidence = async () => ({
      sourceStatus: "available",
      note: "tmp/xbmc shortlog parsed.",
      recordsByNormalizedId: {
        fuzzard: [localGitRecord("fuzzard", 1445)],
        koprajs: [localGitRecord("KOPRajs", 27)],
        fkoemep: [localGitRecord("fkoemep", 1)],
        "hosted-weblate": [localGitRecord("Hosted Weblate", 89)],
      },
      failures: [],
    });

    await refreshModule.refreshXbmcFixtureSnapshot({
      manifestPath,
      snapshotPath,
      collectGitHubEvidence,
      collectLocalGitEvidence,
    });
    const firstJson = await readFile(snapshotPath, "utf8");

    await refreshModule.refreshXbmcFixtureSnapshot({
      manifestPath,
      snapshotPath,
      collectGitHubEvidence,
      collectLocalGitEvidence,
    });
    const secondJson = await readFile(snapshotPath, "utf8");
    const snapshot = JSON.parse(secondJson);

    expect(snapshot.generatedAt).toBe("2026-04-10T12:00:00.000Z");
    expect(secondJson).toBe(firstJson);
  });

  test("fails on unauthorized alias collisions and leaves the last snapshot untouched", async () => {
    const refreshModule = await loadRefreshModule();

    expect(refreshModule).not.toBeNull();
    if (!refreshModule?.refreshXbmcFixtureSnapshot) {
      return;
    }

    const dir = await makeTempDir();
    const manifest = buildManifest();
    manifest.retained[0] = {
      kind: "retained",
      normalizedId: "alpha-person",
      displayName: "Alpha",
      githubUsername: "alpha-person",
      cohort: "ambiguous-middle",
      selectionNotes: "Alias-collision probe.",
      observedCommitCounts: {
        allTime: 12,
        since2025: 3,
      },
      provenance: {
        github: {
          status: "pending",
          note: "GitHub enrichment deferred.",
          evidenceUrl: null,
          workspacePath: null,
        },
        localGit: {
          status: "pending",
          note: "Local git enrichment deferred.",
          evidenceUrl: null,
          workspacePath: "tmp/xbmc",
        },
      },
    };
    manifest.excluded.push({
      kind: "excluded",
      normalizedId: "alpha",
      displayName: "Alpha",
      githubUsername: null,
      exclusionReason: "alias-collision",
      exclusionNotes: "Conflicts with the retained display-name alias.",
      relatedNormalizedIds: ["alpha-person"],
      observedCommitCounts: {
        allTime: 7,
        since2025: 1,
      },
      provenance: {
        github: {
          status: "pending",
          note: "GitHub enrichment deferred.",
          evidenceUrl: null,
          workspacePath: null,
        },
        localGit: {
          status: "pending",
          note: "Local git enrichment deferred.",
          evidenceUrl: null,
          workspacePath: "tmp/xbmc",
        },
      },
    });

    const manifestPath = await writeManifest(dir, manifest);
    const snapshotPath = join(dir, "xbmc-snapshot.json");
    await writeFile(snapshotPath, '{"status":"keep-me"}\n', "utf8");

    await expect(
      refreshModule.refreshXbmcFixtureSnapshot({
        manifestPath,
        snapshotPath,
        generatedAt: "2026-04-10T12:00:00.000Z",
        collectGitHubEvidence: async () => ({
          sourceStatus: "available",
          note: "unused",
          records: [],
          failures: [],
        }),
        collectLocalGitEvidence: async () => ({
          sourceStatus: "available",
          note: "unused",
          recordsByNormalizedId: {},
          failures: [],
        }),
      }),
    ).rejects.toThrow(/alias collision/i);

    expect(await readFile(snapshotPath, "utf8")).toBe('{"status":"keep-me"}\n');
  });

  test("marks GitHub access unavailable without inventing evidence", async () => {
    const refreshModule = await loadRefreshModule();

    expect(refreshModule).not.toBeNull();
    if (!refreshModule?.refreshXbmcFixtureSnapshot) {
      return;
    }

    const dir = await makeTempDir();
    const manifestPath = await writeManifest(dir, buildManifest());
    const snapshotPath = join(dir, "xbmc-snapshot.json");

    const result = await refreshModule.refreshXbmcFixtureSnapshot({
      manifestPath,
      snapshotPath,
      generatedAt: "2026-04-10T12:00:00.000Z",
      collectGitHubEvidence: async () => ({
        sourceStatus: "unavailable",
        note: "GitHub App env is unavailable.",
        records: [],
        failures: [
          {
            code: "github-access-unavailable",
            source: "github",
            message: "GitHub App env is unavailable.",
          },
        ],
      }),
      collectLocalGitEvidence: async () => ({
        sourceStatus: "available",
        note: "tmp/xbmc shortlog parsed.",
        recordsByNormalizedId: {
          fuzzard: [localGitRecord("fuzzard", 1445)],
          koprajs: [localGitRecord("KOPRajs", 27)],
          fkoemep: [localGitRecord("fkoemep", 1)],
          "hosted-weblate": [localGitRecord("Hosted Weblate", 89)],
        },
        failures: [],
      }),
    });

    const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));

    expect(result.statusCode).toBe("snapshot-degraded");
    expect(snapshot.diagnostics.statusCode).toBe("snapshot-degraded");
    expect(snapshot.diagnostics.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "github-access-unavailable",
          source: "github",
        }),
      ]),
    );
    expect(snapshot.retained.every((entry: { provenance: { github: { status: string } } }) => entry.provenance.github.status === "unavailable")).toBe(true);
    expect(snapshot.retained.every((entry: { provenanceRecords: Array<{ source: string; status: string }> }) =>
      entry.provenanceRecords.some(
        (record) => record.source === "github-identity" && record.status === "unavailable",
      ),
    )).toBe(true);
  });

  test("marks local git enrichment unavailable when the workspace is absent", async () => {
    const refreshModule = await loadRefreshModule();

    expect(refreshModule).not.toBeNull();
    if (!refreshModule?.refreshXbmcFixtureSnapshot) {
      return;
    }

    const dir = await makeTempDir();
    const manifestPath = await writeManifest(dir, buildManifest());
    const snapshotPath = join(dir, "xbmc-snapshot.json");

    const result = await refreshModule.refreshXbmcFixtureSnapshot({
      manifestPath,
      snapshotPath,
      generatedAt: "2026-04-10T12:00:00.000Z",
      collectGitHubEvidence: async ({ contributor }: { contributor: { githubUsername: string } }) => ({
        sourceStatus: "available",
        note: "GitHub contributor evidence collected.",
        records: [
          githubRecord(
            "github-commit",
            `https://github.com/xbmc/xbmc/commit/${contributor.githubUsername}`,
            "Recent authored commit found.",
          ),
        ],
        failures: [],
      }),
      collectLocalGitEvidence: async () => ({
        sourceStatus: "unavailable",
        note: "tmp/xbmc is absent.",
        recordsByNormalizedId: {},
        failures: [
          {
            code: "local-git-workspace-missing",
            source: "local-git",
            message: "tmp/xbmc is absent.",
          },
        ],
      }),
    });

    const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));

    expect(result.statusCode).toBe("snapshot-degraded");
    expect(snapshot.diagnostics.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "local-git-workspace-missing" }),
      ]),
    );
    expect(snapshot.retained.every((entry: { provenance: { localGit: { status: string; note: string } } }) => entry.provenance.localGit.status === "unavailable" && /tmp\/xbmc is absent/i.test(entry.provenance.localGit.note))).toBe(true);
  });

  test("times out slow GitHub evidence collection and degrades explicitly", async () => {
    const refreshModule = await loadRefreshModule();

    expect(refreshModule).not.toBeNull();
    if (!refreshModule?.refreshXbmcFixtureSnapshot) {
      return;
    }

    const dir = await makeTempDir();
    const manifestPath = await writeManifest(dir, buildManifest());
    const snapshotPath = join(dir, "xbmc-snapshot.json");

    const result = await refreshModule.refreshXbmcFixtureSnapshot({
      manifestPath,
      snapshotPath,
      generatedAt: "2026-04-10T12:00:00.000Z",
      githubTimeoutMs: 5,
      collectGitHubEvidence: async () => {
        await Bun.sleep(50);
        return {
          sourceStatus: "available",
          note: "arrived too late",
          records: [
            githubRecord(
              "github-commit",
              "https://github.com/xbmc/xbmc/commit/late",
              "Late commit evidence.",
            ),
          ],
          failures: [],
        };
      },
      collectLocalGitEvidence: async () => ({
        sourceStatus: "available",
        note: "tmp/xbmc shortlog parsed.",
        recordsByNormalizedId: {
          fuzzard: [localGitRecord("fuzzard", 1445)],
          koprajs: [localGitRecord("KOPRajs", 27)],
          fkoemep: [localGitRecord("fkoemep", 1)],
          "hosted-weblate": [localGitRecord("Hosted Weblate", 89)],
        },
        failures: [],
      }),
    });

    const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));

    expect(result.statusCode).toBe("snapshot-degraded");
    expect(snapshot.diagnostics.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "github-timeout",
          source: "github",
        }),
      ]),
    );
    expect(snapshot.retained.every((entry: { provenance: { github: { status: string; note: string } } }) => entry.provenance.github.status === "unavailable" && /timed out/i.test(entry.provenance.github.note))).toBe(true);
  });

  test("fails when a retained contributor is missing a GitHub username", async () => {
    const refreshModule = await loadRefreshModule();

    expect(refreshModule).not.toBeNull();
    if (!refreshModule?.refreshXbmcFixtureSnapshot) {
      return;
    }

    const dir = await makeTempDir();
    const manifest = buildManifest();
    manifest.retained[0]!.githubUsername = null;
    const manifestPath = await writeManifest(dir, manifest);
    const snapshotPath = join(dir, "xbmc-snapshot.json");

    await expect(
      refreshModule.refreshXbmcFixtureSnapshot({
        manifestPath,
        snapshotPath,
        generatedAt: "2026-04-10T12:00:00.000Z",
      }),
    ).rejects.toThrow(/retained contributor .* github username/i);
  });

  test("rejects unsupported provenance sources returned by collectors", async () => {
    const refreshModule = await loadRefreshModule();

    expect(refreshModule).not.toBeNull();
    if (!refreshModule?.refreshXbmcFixtureSnapshot) {
      return;
    }

    const dir = await makeTempDir();
    const manifestPath = await writeManifest(dir, buildManifest());
    const snapshotPath = join(dir, "xbmc-snapshot.json");

    await expect(
      refreshModule.refreshXbmcFixtureSnapshot({
        manifestPath,
        snapshotPath,
        generatedAt: "2026-04-10T12:00:00.000Z",
        collectGitHubEvidence: async () => ({
          sourceStatus: "available",
          note: "GitHub contributor evidence collected.",
          records: [
            {
              source: "svn-log",
              status: "available",
              note: "unexpected",
              evidenceUrl: "https://example.com/svn-log",
              workspacePath: null,
              observedAt: null,
              identity: null,
              metadata: {},
            },
          ],
          failures: [],
        }),
        collectLocalGitEvidence: async () => ({
          sourceStatus: "available",
          note: "tmp/xbmc shortlog parsed.",
          recordsByNormalizedId: {},
          failures: [],
        }),
      }),
    ).rejects.toThrow(/unsupported evidence source/i);
  });
});
