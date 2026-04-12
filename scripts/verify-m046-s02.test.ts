import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Check = {
  id: string;
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail?: string;
};

type CalibrationRow = {
  normalizedId: string;
  live: {
    contract: {
      state: string;
      promptTier: string;
    };
  };
  intended: {
    contract: {
      state: string;
      promptTier: string;
    };
  };
  freshness: {
    freshnessBand: string;
    linkedProfileState: string;
  };
};

type EvaluationReport = {
  command: "verify:m046:s02";
  generatedAt: string;
  check_ids: readonly string[];
  overallPassed: boolean;
  prerequisite: {
    command: string;
    overallPassed: boolean;
    statusCode: string | null;
    failingChecks: string[];
    counts: {
      retained: number;
      excluded: number;
    } | null;
  } | null;
  snapshot: {
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
  calibration: {
    retainedIds: string[];
    rows: CalibrationRow[];
    excludedControls: Array<{
      normalizedId: string;
      exclusionReason: string;
      includedInEvaluation: boolean;
    }>;
    findings: {
      liveScoreCompression: boolean;
      divergentContributorIds: string[];
      staleContributorIds: string[];
    };
    recommendation: {
      verdict: "keep" | "retune" | "replace";
      rationale: string[];
    } | null;
  } | null;
  checks: Check[];
};

type ProofHarnessResult = {
  exitCode: number;
  report: EvaluationReport;
};

type VerifyModule = {
  M046_S02_CHECK_IDS?: readonly string[];
  evaluateM046S02?: (options?: Record<string, unknown>) => Promise<EvaluationReport>;
  renderM046S02Report?: (report: EvaluationReport) => string;
  buildM046S02ProofHarness?: (options?: Record<string, unknown>) => Promise<ProofHarnessResult>;
  parseM046S02Args?: (args: readonly string[]) => { json: boolean };
};

const EXPECTED_CHECK_IDS = [
  "M046-S02-S01-PREREQUISITE",
  "M046-S02-SNAPSHOT-VALID",
  "M046-S02-RETAINED-COHORT-TRUTH",
  "M046-S02-EXCLUDED-CONTROLS-TRUTH",
  "M046-S02-EVALUATOR-REPORT",
  "M046-S02-RECOMMENDATION",
] as const;

const importModule = new Function(
  "specifier",
  "return import(specifier)",
) as (specifier: string) => Promise<unknown>;

const tempDirs: string[] = [];

async function loadVerifyModule(): Promise<VerifyModule | null> {
  return (await importModule("./verify-m046-s02.ts").catch(
    () => null,
  )) as VerifyModule | null;
}

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "verify-m046-s02-"));
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

  nextSnapshot.manifestPath = manifestPath;
  nextSnapshot.snapshotPath = snapshotPath;

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

describe("verify m046 s02", () => {
  test("exports stable check ids, evaluator, renderer, proof harness, and arg parser", async () => {
    const verifyModule = await loadVerifyModule();

    expect(verifyModule).not.toBeNull();
    if (!verifyModule) {
      return;
    }

    expect(verifyModule.M046_S02_CHECK_IDS).toEqual(EXPECTED_CHECK_IDS);
    expect(typeof verifyModule.evaluateM046S02).toBe("function");
    expect(typeof verifyModule.renderM046S02Report).toBe("function");
    expect(typeof verifyModule.buildM046S02ProofHarness).toBe("function");
    expect(typeof verifyModule.parseM046S02Args).toBe("function");
    expect(verifyModule.parseM046S02Args?.([])).toEqual({ json: false });
    expect(verifyModule.parseM046S02Args?.(["--json"])).toEqual({ json: true });
  });

  test("verifies the checked-in xbmc calibration snapshot with stable json shape, per-contributor diagnostics, and a replace recommendation", async () => {
    const verifyModule = await loadVerifyModule();

    expect(verifyModule).not.toBeNull();
    if (!verifyModule?.evaluateM046S02 || !verifyModule.renderM046S02Report) {
      return;
    }

    const report = await verifyModule.evaluateM046S02({
      generatedAt: "2026-04-10T22:20:00.000Z",
      referenceTime: "2026-04-10T20:42:03.000Z",
    });
    const rendered = verifyModule.renderM046S02Report(report);

    expect(report.command).toBe("verify:m046:s02");
    expect(report.check_ids).toEqual(EXPECTED_CHECK_IDS);
    expect(report.overallPassed).toBe(true);
    expect(report.prerequisite).toMatchObject({
      command: "verify:m046:s01",
      overallPassed: true,
      statusCode: "snapshot-refreshed",
      counts: { retained: 3, excluded: 6 },
    });
    expect(report.snapshot).toMatchObject({
      isLoadable: true,
      isValid: true,
      status: "ready",
      diagnosticsStatusCode: "snapshot-refreshed",
      counts: { retained: 3, excluded: 6 },
    });
    expect(report.calibration?.retainedIds).toEqual(["fuzzard", "koprajs", "fkoemep"]);
    expect(report.calibration?.rows.map((row) => row.normalizedId)).toEqual([
      "fuzzard",
      "koprajs",
      "fkoemep",
    ]);
    expect(report.calibration?.excludedControls).toHaveLength(6);
    expect(report.calibration?.recommendation).toMatchObject({
      verdict: "replace",
      rationale: expect.arrayContaining([
        expect.stringContaining("live incremental path"),
        expect.stringContaining("full-signal model"),
      ]),
    });
    expect(findCheck(report, "M046-S02-S01-PREREQUISITE")).toMatchObject({
      passed: true,
      status_code: "prerequisite_fixture_verifier_passed",
    });
    expect(findCheck(report, "M046-S02-RETAINED-COHORT-TRUTH")).toMatchObject({
      passed: true,
      status_code: "retained_cohort_truth_preserved",
    });
    expect(findCheck(report, "M046-S02-EXCLUDED-CONTROLS-TRUTH")).toMatchObject({
      passed: true,
      status_code: "excluded_controls_truth_preserved",
    });
    expect(findCheck(report, "M046-S02-EVALUATOR-REPORT")).toMatchObject({
      passed: true,
      status_code: "calibration_report_complete",
    });
    expect(findCheck(report, "M046-S02-RECOMMENDATION")).toMatchObject({
      passed: true,
      status_code: "calibration_recommendation_present",
    });
    expect(rendered).toContain("M046 S02 proof harness: xbmc live-vs-intended calibration verifier");
    expect(rendered).toContain("Recommendation: replace");
    expect(rendered).toContain("fuzzard");
    expect(rendered).toContain("live=profile-backed/newcomer");
    expect(rendered).toContain("intended=profile-backed/senior");
    expect(rendered).toContain("freshness=stale linked=linked-but-unscored-default-newcomer");
    expect(rendered).toContain("Excluded controls:");
    expect(rendered).toContain("hosted-weblate (bot)");
    expect(rendered).toContain("M046-S02-RECOMMENDATION PASS status_code=calibration_recommendation_present");
  });

  test("fails non-zero with a named prerequisite status code when the embedded s01 verifier fails, while still surfacing loadable snapshot diagnostics", async () => {
    const verifyModule = await loadVerifyModule();

    expect(verifyModule).not.toBeNull();
    if (!verifyModule?.buildM046S02ProofHarness) {
      return;
    }

    const dir = await makeTempDir();
    const { manifestPath, snapshotPath } = await writeFixturePair(dir, {
      snapshot: (snapshot) => {
        const next = clone(snapshot);
        next.status = "degraded";
        next.diagnostics.statusCode = "snapshot-degraded";
        next.diagnostics.failures = [
          {
            code: "missing-review-data",
            source: "github-review",
            message: "review history was unavailable during refresh",
            contributorNormalizedId: "fkoemep",
          },
        ];
        return next;
      },
    });

    const stdout: string[] = [];
    const stderr: string[] = [];

    const result = await verifyModule.buildM046S02ProofHarness({
      manifestPath,
      snapshotPath,
      stdout: { write: (chunk: string) => void stdout.push(chunk) },
      stderr: { write: (chunk: string) => void stderr.push(chunk) },
      json: true,
      _evaluateS01: async () => ({
        command: "verify:m046:s01",
        overallPassed: false,
        counts: { retained: 3, excluded: 6 },
        diagnostics: {
          statusCode: "snapshot-degraded",
        },
        checks: [
          {
            id: "M046-S01-SNAPSHOT-STATUS",
            passed: false,
            skipped: false,
            status_code: "fixture_snapshot_degraded",
          },
        ],
      }),
    });

    const report = JSON.parse(stdout.join("")) as EvaluationReport;

    expect(result.exitCode).toBe(1);
    expect(report.overallPassed).toBe(false);
    expect(report.snapshot).toMatchObject({
      isLoadable: true,
      isValid: true,
      status: "degraded",
      diagnosticsStatusCode: "snapshot-degraded",
      counts: { retained: 3, excluded: 6 },
    });
    expect(report.calibration).toBeNull();
    expect(findCheck(report, "M046-S02-S01-PREREQUISITE")).toMatchObject({
      passed: false,
      status_code: "prerequisite_fixture_verifier_failed",
    });
    expect(findCheck(report, "M046-S02-EVALUATOR-REPORT")).toMatchObject({
      passed: true,
      skipped: true,
      status_code: "calibration_evaluation_skipped",
    });
    expect(stderr.join("")).toContain("M046-S02-S01-PREREQUISITE:prerequisite_fixture_verifier_failed");
  });

  test("fails non-zero with named evaluator and recommendation status codes when retained rows drift or the evaluator returns no recommendation", async () => {
    const verifyModule = await loadVerifyModule();

    expect(verifyModule).not.toBeNull();
    if (!verifyModule?.buildM046S02ProofHarness) {
      return;
    }

    const dir = await makeTempDir();
    const { manifestPath, snapshotPath } = await writeFixturePair(dir);
    const stdout: string[] = [];
    const stderr: string[] = [];

    const result = await verifyModule.buildM046S02ProofHarness({
      manifestPath,
      snapshotPath,
      stdout: { write: (chunk: string) => void stdout.push(chunk) },
      stderr: { write: (chunk: string) => void stderr.push(chunk) },
      json: true,
      _evaluateCalibration: async () => ({
        retainedIds: ["fuzzard", "koprajs", "fkoemep"],
        rows: [
          {
            normalizedId: "fuzzard",
            live: { contract: { state: "profile-backed", promptTier: "newcomer" } },
            intended: { contract: { state: "profile-backed", promptTier: "senior" } },
            freshness: {
              freshnessBand: "fresh",
              linkedProfileState: "linked-but-unscored-default-newcomer",
            },
          },
          {
            normalizedId: "hosted-weblate",
            live: { contract: { state: "profile-backed", promptTier: "newcomer" } },
            intended: { contract: { state: "profile-backed", promptTier: "newcomer" } },
            freshness: {
              freshnessBand: "fresh",
              linkedProfileState: "linked-but-unscored-default-newcomer",
            },
          },
        ],
        excludedControls: [
          {
            normalizedId: "jenkins4kodi",
            exclusionReason: "bot",
            includedInEvaluation: false,
          },
        ],
        findings: {
          liveScoreCompression: true,
          divergentContributorIds: ["fuzzard"],
          staleContributorIds: [],
        },
        recommendation: null,
      }),
    });

    const report = JSON.parse(stdout.join("")) as EvaluationReport;

    expect(result.exitCode).toBe(1);
    expect(findCheck(report, "M046-S02-RETAINED-COHORT-TRUTH")).toMatchObject({
      passed: false,
      status_code: "retained_cohort_truth_drift",
    });
    expect(findCheck(report, "M046-S02-EXCLUDED-CONTROLS-TRUTH")).toMatchObject({
      passed: false,
      status_code: "excluded_controls_truth_drift",
    });
    expect(findCheck(report, "M046-S02-RECOMMENDATION")).toMatchObject({
      passed: false,
      status_code: "calibration_recommendation_missing",
    });
    expect(stderr.join("")).toContain("retained_cohort_truth_drift");
    expect(stderr.join("")).toContain("excluded_controls_truth_drift");
    expect(stderr.join("")).toContain("calibration_recommendation_missing");
  });

  test("keeps human and json output aligned and wires the canonical package script", async () => {
    const verifyModule = await loadVerifyModule();
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["verify:m046:s02"]).toBe("bun scripts/verify-m046-s02.ts");
    expect(verifyModule).not.toBeNull();
    if (!verifyModule?.buildM046S02ProofHarness) {
      return;
    }

    const humanStdout: string[] = [];
    const jsonStdout: string[] = [];

    const human = await verifyModule.buildM046S02ProofHarness({
      generatedAt: "2026-04-10T22:20:00.000Z",
      referenceTime: "2026-04-10T20:42:03.000Z",
      stdout: { write: (chunk: string) => void humanStdout.push(chunk) },
      stderr: { write: () => {} },
    });
    const json = await verifyModule.buildM046S02ProofHarness({
      generatedAt: "2026-04-10T22:20:00.000Z",
      referenceTime: "2026-04-10T20:42:03.000Z",
      json: true,
      stdout: { write: (chunk: string) => void jsonStdout.push(chunk) },
      stderr: { write: () => {} },
    });

    const parsed = JSON.parse(jsonStdout.join("")) as EvaluationReport;

    expect(human.exitCode).toBe(0);
    expect(json.exitCode).toBe(0);
    expect(parsed.check_ids).toEqual(EXPECTED_CHECK_IDS);
    expect(parsed.calibration?.recommendation?.verdict).toBe("replace");
    expect(humanStdout.join("")).toContain("Recommendation: replace");
    expect(humanStdout.join("")).toContain("fuzzard");
    expect(humanStdout.join("")).toContain("hosted-weblate (bot)");
  });
});
