import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Check = {
  id: string;
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail?: string;
};

type EvaluationReport = {
  command: "verify:m046:s01";
  generatedAt: string;
  check_ids: readonly string[];
  overallPassed: boolean;
  refreshed: boolean;
  counts: {
    retained: number;
    excluded: number;
  } | null;
  diagnostics: {
    statusCode: string | null;
    cohortCoverage: Record<string, number>;
    sourceAvailability: {
      github: Record<string, number>;
      localGit: Record<string, number>;
    };
    provenanceCompleteness: {
      retainedWithoutRecords: number;
      excludedWithoutRecords: number;
    };
    aliasCollisionDiagnostics: Array<{
      normalizedId: string;
      exclusionReason: string;
      relatedNormalizedIds: string[];
    }>;
    failures: Array<{ code: string; source: string; message: string }>;
  } | null;
  checks: Check[];
};

type ProofHarnessResult = {
  exitCode: number;
  report: EvaluationReport;
};

type VerifyModule = {
  evaluateM046S01?: (options?: Record<string, unknown>) => Promise<EvaluationReport>;
  renderM046S01Report?: (report: EvaluationReport) => string;
  buildM046S01ProofHarness?: (options?: Record<string, unknown>) => Promise<ProofHarnessResult>;
};

const EXPECTED_CHECK_IDS = [
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

const importModule = new Function(
  "specifier",
  "return import(specifier)",
) as (specifier: string) => Promise<unknown>;

const tempDirs: string[] = [];

async function loadVerifyModule(): Promise<VerifyModule | null> {
  return (await importModule("./verify-m046-s01.ts").catch(
    () => null,
  )) as VerifyModule | null;
}

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "verify-m046-s01-"));
  tempDirs.push(dir);
  return dir;
}

async function readJsonFixture(relativePath: string): Promise<any> {
  const file = new URL(`../${relativePath}`, import.meta.url);
  return JSON.parse(await readFile(file, "utf8"));
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function findCheck(report: EvaluationReport, id: string): Check {
  const check = report.checks.find((candidate) => candidate.id === id);
  expect(check).toBeDefined();
  return check!;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function writeFixturePair(dir: string, overrides?: {
  manifest?: (manifest: any) => any;
  snapshot?: (snapshot: any) => any;
}): Promise<{ manifestPath: string; snapshotPath: string; manifest: any; snapshot: any }> {
  const manifest = clone(await readJsonFixture("fixtures/contributor-calibration/xbmc-manifest.json"));
  const snapshot = clone(await readJsonFixture("fixtures/contributor-calibration/xbmc-snapshot.json"));

  const nextManifest = overrides?.manifest ? overrides.manifest(manifest) : manifest;
  const nextSnapshot = overrides?.snapshot ? overrides.snapshot(snapshot) : snapshot;

  const manifestPath = join(dir, "xbmc-manifest.json");
  const snapshotPath = join(dir, "xbmc-snapshot.json");

  await writeJson(manifestPath, nextManifest);
  await writeJson(snapshotPath, nextSnapshot);

  return { manifestPath, snapshotPath, manifest: nextManifest, snapshot: nextSnapshot };
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

describe("verify m046 s01", () => {
  test("exposes the evaluator, report renderer, and proof harness", async () => {
    const verifyModule = await loadVerifyModule();

    expect(verifyModule).not.toBeNull();
    if (!verifyModule) {
      return;
    }

    expect(typeof verifyModule.evaluateM046S01).toBe("function");
    expect(typeof verifyModule.renderM046S01Report).toBe("function");
    expect(typeof verifyModule.buildM046S01ProofHarness).toBe("function");
  });

  test("verifies the checked-in xbmc fixture pack with stable check ids, counts, and status codes", async () => {
    const verifyModule = await loadVerifyModule();

    expect(verifyModule).not.toBeNull();
    if (!verifyModule?.evaluateM046S01 || !verifyModule.renderM046S01Report) {
      return;
    }

    const report = await verifyModule.evaluateM046S01();
    const rendered = verifyModule.renderM046S01Report(report);

    expect(report.command).toBe("verify:m046:s01");
    expect(report.check_ids).toEqual(EXPECTED_CHECK_IDS);
    expect(report.overallPassed).toBe(true);
    expect(report.refreshed).toBe(false);
    expect(report.counts).toEqual({ retained: 3, excluded: 6 });
    expect(report.diagnostics?.statusCode).toBe("snapshot-refreshed");
    expect(findCheck(report, "M046-S01-MANIFEST-VALID")).toMatchObject({
      passed: true,
      status_code: "fixture_manifest_valid",
    });
    expect(findCheck(report, "M046-S01-REFRESH-EXECUTED")).toMatchObject({
      passed: true,
      skipped: true,
      status_code: "refresh_not_requested",
    });
    expect(findCheck(report, "M046-S01-SNAPSHOT-STATUS")).toMatchObject({
      passed: true,
      status_code: "fixture_snapshot_ready",
    });
    expect(findCheck(report, "M046-S01-COHORT-COVERAGE")).toMatchObject({
      passed: true,
      status_code: "fixture_cohort_coverage_complete",
    });
    expect(findCheck(report, "M046-S01-PROVENANCE-COMPLETE")).toMatchObject({
      passed: true,
      status_code: "fixture_provenance_complete",
    });
    expect(findCheck(report, "M046-S01-SOURCE-AVAILABILITY")).toMatchObject({
      passed: true,
      status_code: "fixture_source_availability_recorded",
    });
    expect(findCheck(report, "M046-S01-ALIAS-DIAGNOSTICS")).toMatchObject({
      passed: true,
      status_code: "fixture_alias_diagnostics_recorded",
    });
    expect(rendered).toContain("Final verdict: PASS");
    expect(rendered).toContain("retained=3 excluded=6");
    expect(rendered).toContain("M046-S01-SNAPSHOT-STATUS PASS status_code=fixture_snapshot_ready");
  });

  test("keeps report output structurally valid when the snapshot JSON is malformed", async () => {
    const verifyModule = await loadVerifyModule();

    expect(verifyModule).not.toBeNull();
    if (!verifyModule?.evaluateM046S01 || !verifyModule.renderM046S01Report) {
      return;
    }

    const dir = await makeTempDir();
    const { manifestPath, snapshotPath } = await writeFixturePair(dir);
    await writeFile(snapshotPath, '{"retained": [\n', "utf8");

    const report = await verifyModule.evaluateM046S01({
      manifestPath,
      snapshotPath,
    });

    expect(report.overallPassed).toBe(false);
    expect(report.counts).toBeNull();
    expect(report.diagnostics).toBeNull();
    expect(findCheck(report, "M046-S01-SNAPSHOT-VALID")).toMatchObject({
      passed: false,
      status_code: "fixture_snapshot_malformed_json",
    });
    expect(findCheck(report, "M046-S01-SNAPSHOT-VALID").detail).toContain("JSON");
    expect(verifyModule.renderM046S01Report(report)).toContain("fixture_snapshot_malformed_json");
  });

  test("fails with named drift checks when cohort coverage drops, curated counts diverge, or provenance arrays disappear", async () => {
    const verifyModule = await loadVerifyModule();

    expect(verifyModule).not.toBeNull();
    if (!verifyModule?.evaluateM046S01) {
      return;
    }

    const dir = await makeTempDir();
    const { manifestPath, snapshotPath } = await writeFixturePair(dir, {
      snapshot: (snapshot) => {
        const next = clone(snapshot);
        next.retained = next.retained.filter((entry: { cohort: string }) => entry.cohort !== "newcomer");
        delete next.excluded[0].provenanceRecords;
        next.diagnostics.retainedCount = next.retained.length;
        next.diagnostics.cohortCoverage = {
          senior: 1,
          "ambiguous-middle": 1,
          newcomer: 0,
        };
        next.diagnostics.provenanceCompleteness = {
          retainedWithoutRecords: 0,
          excludedWithoutRecords: 0,
        };
        return next;
      },
    });

    const report = await verifyModule.evaluateM046S01({
      manifestPath,
      snapshotPath,
    });

    expect(report.overallPassed).toBe(false);
    expect(findCheck(report, "M046-S01-SNAPSHOT-VALID")).toMatchObject({
      passed: false,
      status_code: "fixture_snapshot_invalid",
    });
    expect(findCheck(report, "M046-S01-CURATED-SYNC")).toMatchObject({
      passed: false,
      status_code: "fixture_snapshot_drift",
    });
    expect(findCheck(report, "M046-S01-COHORT-COVERAGE")).toMatchObject({
      passed: false,
      status_code: "fixture_cohort_coverage_missing",
    });
    expect(findCheck(report, "M046-S01-PROVENANCE-COMPLETE")).toMatchObject({
      passed: false,
      status_code: "fixture_provenance_incomplete",
    });
  });

  test("keeps human and JSON output aligned on verdicts and status codes", async () => {
    const verifyModule = await loadVerifyModule();

    expect(verifyModule).not.toBeNull();
    if (!verifyModule?.buildM046S01ProofHarness) {
      return;
    }

    const humanStdout: string[] = [];
    const jsonStdout: string[] = [];

    const human = await verifyModule.buildM046S01ProofHarness({
      stdout: { write: (chunk: string) => void humanStdout.push(chunk) },
      stderr: { write: () => {} },
    });
    const json = await verifyModule.buildM046S01ProofHarness({
      stdout: { write: (chunk: string) => void jsonStdout.push(chunk) },
      stderr: { write: () => {} },
      json: true,
    });

    const parsed = JSON.parse(jsonStdout.join("")) as EvaluationReport;

    expect(human.exitCode).toBe(0);
    expect(json.exitCode).toBe(0);
    expect(parsed.overallPassed).toBe(true);
    expect(parsed.check_ids).toEqual(EXPECTED_CHECK_IDS);
    expect(findCheck(parsed, "M046-S01-SNAPSHOT-STATUS")).toMatchObject({
      passed: true,
      status_code: "fixture_snapshot_ready",
    });
    expect(humanStdout.join("")).toContain("Final verdict: PASS");
    expect(humanStdout.join("")).toContain("M046-S01-SNAPSHOT-STATUS PASS status_code=fixture_snapshot_ready");
  });

  test("refresh mode rewrites the snapshot before verifying and applies repo/workspace overrides", async () => {
    const verifyModule = await loadVerifyModule();

    expect(verifyModule).not.toBeNull();
    if (!verifyModule?.buildM046S01ProofHarness) {
      return;
    }

    const dir = await makeTempDir();
    const { manifestPath, snapshotPath } = await writeFixturePair(dir);
    const refreshedSnapshot = clone(await readJsonFixture("fixtures/contributor-calibration/xbmc-snapshot.json"));
    await writeFile(snapshotPath, '{"status":"stale"}\n', "utf8");

    let overriddenRepository: string | null = null;
    let overriddenWorkspace: string | null = null;

    const stdout: string[] = [];
    const result = await verifyModule.buildM046S01ProofHarness({
      manifestPath,
      snapshotPath,
      refresh: true,
      json: true,
      repository: "mirror/xbmc",
      workspacePath: "tmp/xbmc-mirror",
      stdout: { write: (chunk: string) => void stdout.push(chunk) },
      stderr: { write: () => {} },
      _refreshSnapshot: async (options: {
        snapshotPath: string;
        loadManifest: (path: string) => Promise<any>;
      }) => {
        const manifest = await options.loadManifest(manifestPath);
        overriddenRepository = manifest.repository;
        overriddenWorkspace = manifest.retained[0].provenance.localGit.workspacePath;

        const nextSnapshot = clone(refreshedSnapshot);
        nextSnapshot.repository = manifest.repository;
        nextSnapshot.manifestPath = manifestPath;
        nextSnapshot.snapshotPath = snapshotPath;
        nextSnapshot.refreshCommand = "bun run verify:m046:s01 -- --refresh --json --repo mirror/xbmc --workspace tmp/xbmc-mirror";
        nextSnapshot.retained = nextSnapshot.retained.map((entry: any) => ({
          ...entry,
          provenance: {
            ...entry.provenance,
            localGit: {
              ...entry.provenance.localGit,
              workspacePath: "tmp/xbmc-mirror",
            },
          },
          provenanceRecords: entry.provenanceRecords.map((record: any) =>
            record.source === "local-git-shortlog"
              ? { ...record, workspacePath: "tmp/xbmc-mirror" }
              : record,
          ),
        }));
        nextSnapshot.excluded = nextSnapshot.excluded.map((entry: any) => ({
          ...entry,
          provenance: {
            ...entry.provenance,
            localGit: {
              ...entry.provenance.localGit,
              workspacePath: "tmp/xbmc-mirror",
            },
          },
          provenanceRecords: entry.provenanceRecords.map((record: any) =>
            record.source === "local-git-shortlog"
              ? { ...record, workspacePath: "tmp/xbmc-mirror" }
              : record,
          ),
        }));
        nextSnapshot.diagnostics.failures = [];
        await writeJson(options.snapshotPath, nextSnapshot);
        return {
          statusCode: "snapshot-refreshed",
          snapshotPath: options.snapshotPath,
          retainedCount: nextSnapshot.retained.length,
          excludedCount: nextSnapshot.excluded.length,
          failures: [],
          snapshot: nextSnapshot,
        };
      },
    });

    const parsed = JSON.parse(stdout.join("")) as EvaluationReport;
    const rewritten = JSON.parse(await readFile(snapshotPath, "utf8"));

    expect(result.exitCode).toBe(0);
    expect(parsed.refreshed).toBe(true);
    expect(overriddenRepository).not.toBeNull();
    expect(overriddenWorkspace).not.toBeNull();
    expect(overriddenRepository!).toBe("mirror/xbmc");
    expect(overriddenWorkspace!).toBe("tmp/xbmc-mirror");
    expect(rewritten.refreshCommand).toContain("--repo mirror/xbmc");
    expect(rewritten.retained[0].provenance.localGit.workspacePath).toBe("tmp/xbmc-mirror");
  });

  test("returns a named non-zero refresh failure when the refresh module reports alias collisions", async () => {
    const verifyModule = await loadVerifyModule();

    expect(verifyModule).not.toBeNull();
    if (!verifyModule?.buildM046S01ProofHarness) {
      return;
    }

    const stdout: string[] = [];
    const stderr: string[] = [];

    const result = await verifyModule.buildM046S01ProofHarness({
      json: true,
      stdout: { write: (chunk: string) => void stdout.push(chunk) },
      stderr: { write: (chunk: string) => void stderr.push(chunk) },
      _refreshSnapshot: async () => {
        throw new Error("Alias collision for alias 'alpha' between alpha-person and alpha.");
      },
      refresh: true,
    });

    const report = JSON.parse(stdout.join("")) as EvaluationReport;

    expect(result.exitCode).toBe(1);
    expect(report.overallPassed).toBe(false);
    expect(findCheck(report, "M046-S01-REFRESH-EXECUTED")).toMatchObject({
      passed: false,
      status_code: "fixture_refresh_failed",
    });
    expect(findCheck(report, "M046-S01-REFRESH-EXECUTED").detail).toContain("Alias collision");
    expect(stderr.join("")).toContain("fixture_refresh_failed");
  });
});
