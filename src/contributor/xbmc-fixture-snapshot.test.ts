import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type SnapshotModule = {
  assertValidXbmcFixtureSnapshot?: (value: unknown) => any;
  loadXbmcFixtureSnapshot?: (
    snapshotPath: string,
    options?: { readSnapshotFile?: (path: string) => Promise<string> },
  ) => Promise<any>;
  inspectXbmcFixtureSnapshot?: (value: unknown) => any;
};

const importModule = new Function(
  "specifier",
  "return import(specifier)",
) as (specifier: string) => Promise<unknown>;

const tempDirs: string[] = [];

async function loadSnapshotModule(): Promise<SnapshotModule | null> {
  return (await importModule("./xbmc-fixture-snapshot.ts").catch(
    () => null,
  )) as SnapshotModule | null;
}

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "xbmc-fixture-snapshot-"));
  tempDirs.push(dir);
  return dir;
}

async function readJsonFixture(relativePath: string): Promise<any> {
  const file = new URL(`../../${relativePath}`, import.meta.url);
  return JSON.parse(await readFile(file, "utf8"));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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

describe("xbmc fixture snapshot loader", () => {
  test("loads the checked-in snapshot with retained, excluded, and diagnostics data intact", async () => {
    const snapshotModule = await loadSnapshotModule();

    expect(snapshotModule).not.toBeNull();
    if (!snapshotModule?.loadXbmcFixtureSnapshot) {
      return;
    }

    const snapshot = await snapshotModule.loadXbmcFixtureSnapshot(
      "fixtures/contributor-calibration/xbmc-snapshot.json",
    );

    expect(snapshot.status).toBe("ready");
    expect(snapshot.retained).toHaveLength(3);
    expect(snapshot.excluded).toHaveLength(6);
    expect(snapshot.diagnostics.statusCode).toBe("snapshot-refreshed");
    expect(
      snapshot.excluded.find((entry: { normalizedId: string }) => entry.normalizedId === "hosted-weblate"),
    ).toMatchObject({
      exclusionReason: "bot",
      provenanceRecords: expect.any(Array),
    });
    expect(
      snapshot.excluded.find((entry: { normalizedId: string }) => entry.normalizedId === "keith"),
    ).toMatchObject({
      exclusionReason: "ambiguous-identity",
      relatedNormalizedIds: ["keith-herrington"],
    });
  });

  test("throws an actionable error when the snapshot JSON is malformed", async () => {
    const snapshotModule = await loadSnapshotModule();

    expect(snapshotModule).not.toBeNull();
    if (!snapshotModule?.loadXbmcFixtureSnapshot) {
      return;
    }

    const dir = await makeTempDir();
    const snapshotPath = join(dir, "xbmc-snapshot.json");
    await writeFile(snapshotPath, '{"retained": [\n', "utf8");

    await expect(
      snapshotModule.loadXbmcFixtureSnapshot(snapshotPath),
    ).rejects.toThrow(/Malformed xbmc fixture snapshot JSON/);
  });

  test("rejects missing diagnostics and missing provenance records instead of auto-healing them", async () => {
    const snapshotModule = await loadSnapshotModule();

    expect(snapshotModule).not.toBeNull();
    if (!snapshotModule?.assertValidXbmcFixtureSnapshot) {
      return;
    }

    const snapshot = clone(
      await readJsonFixture("fixtures/contributor-calibration/xbmc-snapshot.json"),
    );

    const withoutDiagnostics = clone(snapshot);
    delete withoutDiagnostics.diagnostics;
    expect(() => snapshotModule.assertValidXbmcFixtureSnapshot!(withoutDiagnostics)).toThrow(
      /diagnostics/i,
    );

    const withoutProvenanceRecords = clone(snapshot);
    delete withoutProvenanceRecords.retained[0].provenanceRecords;
    expect(() =>
      snapshotModule.assertValidXbmcFixtureSnapshot!(withoutProvenanceRecords)
    ).toThrow(/provenanceRecords/i);
  });

  test("rejects duplicate contributor identities across retained and excluded rows", async () => {
    const snapshotModule = await loadSnapshotModule();

    expect(snapshotModule).not.toBeNull();
    if (!snapshotModule?.assertValidXbmcFixtureSnapshot) {
      return;
    }

    const snapshot = clone(
      await readJsonFixture("fixtures/contributor-calibration/xbmc-snapshot.json"),
    );

    snapshot.excluded[0].normalizedId = snapshot.retained[0].normalizedId;

    expect(() => snapshotModule.assertValidXbmcFixtureSnapshot!(snapshot)).toThrow(
      /duplicate normalized identity/i,
    );
  });

  test("preserves degraded diagnostics and excluded alias rows for downstream evaluators", async () => {
    const snapshotModule = await loadSnapshotModule();

    expect(snapshotModule).not.toBeNull();
    if (!snapshotModule?.assertValidXbmcFixtureSnapshot || !snapshotModule?.inspectXbmcFixtureSnapshot) {
      return;
    }

    const snapshot = clone(
      await readJsonFixture("fixtures/contributor-calibration/xbmc-snapshot.json"),
    );

    snapshot.status = "degraded";
    snapshot.diagnostics.statusCode = "snapshot-degraded";
    snapshot.diagnostics.failures = [
      {
        code: "github-access-unavailable",
        source: "github",
        message: "GitHub App env is unavailable.",
        contributorNormalizedId: "fuzzard",
      },
    ];

    const parsed = snapshotModule.assertValidXbmcFixtureSnapshot(snapshot);
    const inspected = snapshotModule.inspectXbmcFixtureSnapshot(snapshot);

    expect(parsed.status).toBe("degraded");
    expect(parsed.diagnostics.statusCode).toBe("snapshot-degraded");
    expect(parsed.diagnostics.failures).toHaveLength(1);
    expect(
      parsed.excluded.filter((entry: { exclusionReason: string }) => entry.exclusionReason === "alias-collision"),
    ).toHaveLength(2);
    expect(inspected.snapshot?.diagnostics.failures).toHaveLength(1);
    expect(inspected.provenanceInspection.retainedWithoutRecords).toBe(0);
    expect(inspected.validationIssues).toEqual([]);
  });
});
