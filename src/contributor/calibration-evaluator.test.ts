import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

type SnapshotModule = {
  assertValidXbmcFixtureSnapshot?: (value: unknown) => any;
};

type CalibrationModule = {
  CalibrationEvaluatorError?: new (message: string, code: string) => Error & {
    code: string;
  };
  evaluateCalibrationSnapshot?: (
    snapshot: any,
    options?: { referenceTime?: string | Date; retainedIds?: string[] },
  ) => any;
};

const importModule = new Function(
  "specifier",
  "return import(specifier)",
) as (specifier: string) => Promise<unknown>;

async function loadSnapshotModule(): Promise<SnapshotModule | null> {
  return (await importModule("./xbmc-fixture-snapshot.ts").catch(
    () => null,
  )) as SnapshotModule | null;
}

async function loadCalibrationModule(): Promise<CalibrationModule | null> {
  return (await importModule("./calibration-evaluator.ts").catch(
    () => null,
  )) as CalibrationModule | null;
}

async function readJsonFixture(relativePath: string): Promise<any> {
  const file = new URL(`../../${relativePath}`, import.meta.url);
  return JSON.parse(await readFile(file, "utf8"));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function findRow(report: any, normalizedId: string): any {
  const row = report.rows.find(
    (candidate: { normalizedId: string }) => candidate.normalizedId === normalizedId,
  );
  expect(row).toBeDefined();
  return row;
}

describe("calibration evaluator", () => {
  test("exports a pure evaluation seam and a typed evaluator error", async () => {
    const calibrationModule = await loadCalibrationModule();

    expect(calibrationModule).not.toBeNull();
    if (!calibrationModule) {
      return;
    }

    expect(typeof calibrationModule.evaluateCalibrationSnapshot).toBe("function");
    expect(typeof calibrationModule.CalibrationEvaluatorError).toBe("function");
  });

  test("evaluates the checked-in xbmc cohort with explicit live-vs-intended divergence, instability, freshness, and a replace recommendation", async () => {
    const snapshotModule = await loadSnapshotModule();
    const calibrationModule = await loadCalibrationModule();

    expect(snapshotModule).not.toBeNull();
    expect(calibrationModule).not.toBeNull();
    if (!snapshotModule?.assertValidXbmcFixtureSnapshot || !calibrationModule?.evaluateCalibrationSnapshot) {
      return;
    }

    const snapshot = snapshotModule.assertValidXbmcFixtureSnapshot(
      await readJsonFixture("fixtures/contributor-calibration/xbmc-snapshot.json"),
    );

    const report = calibrationModule.evaluateCalibrationSnapshot(snapshot, {
      referenceTime: "2026-04-10T20:42:03.000Z",
    });

    expect(report.referenceTime).toBe("2026-04-10T20:42:03.000Z");
    expect(report.retainedIds).toEqual(["fuzzard", "koprajs", "fkoemep"]);
    expect(report.rows).toHaveLength(3);
    expect(report.excludedControls).toHaveLength(6);
    expect(report.recommendation).toMatchObject({
      verdict: "replace",
      rationale: expect.arrayContaining([
        expect.stringContaining("live incremental path"),
        expect.stringContaining("full-signal model"),
      ]),
    });

    const fuzzard = findRow(report, "fuzzard");
    expect(fuzzard.fixtureEvidence).toMatchObject({
      commitCounts: { allTime: 2705, since2025: 522 },
      signalAvailability: {
        githubCommit: true,
        githubPull: true,
        githubReview: true,
        localGit: true,
      },
    });
    expect(fuzzard.live).toMatchObject({
      modeledOverallScore: 0,
      contract: {
        state: "profile-backed",
        promptTier: "newcomer",
      },
    });
    expect(fuzzard.live.fidelity.degradationReasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining("changed-file"),
        expect.stringContaining("incremental"),
      ]),
    );
    expect(fuzzard.intended.contract).toMatchObject({
      state: "profile-backed",
      promptTier: "senior",
    });
    expect(fuzzard.intended.modeledOverallScore).toBeGreaterThan(0.99);
    expect(fuzzard.instability.live).toMatchObject({
      hasScoreTie: true,
      possibleRankRange: { min: 1, max: 3 },
      possibleTiers: ["newcomer"],
    });
    expect(fuzzard.instability.intended).toMatchObject({
      hasScoreTie: false,
      possibleRankRange: { min: 1, max: 1 },
      possibleTiers: ["senior"],
    });

    const koprajs = findRow(report, "koprajs");
    expect(koprajs.intended.contract).toMatchObject({
      state: "profile-backed",
      promptTier: "established",
    });
    expect(koprajs.live.contract).toMatchObject({
      state: "profile-backed",
      promptTier: "newcomer",
    });

    const fkoemep = findRow(report, "fkoemep");
    expect(fkoemep.intended.contract).toMatchObject({
      state: "profile-backed",
      promptTier: "newcomer",
    });
    expect(fkoemep.freshness).toMatchObject({
      freshnessBand: "stale",
      linkedProfileState: "linked-but-unscored-default-newcomer",
      hasReviewEvidence: false,
    });
    const freshnessFindings = fkoemep.freshness.findings.join(" ").toLowerCase();
    expect(freshnessFindings).toContain("review evidence");
    expect(freshnessFindings).toContain("linked but unscored");

    expect(report.excludedControls.find((row: { normalizedId: string }) => row.normalizedId === "hosted-weblate")).toMatchObject({
      normalizedId: "hosted-weblate",
      exclusionReason: "bot",
      includedInEvaluation: false,
    });
  });

  test("rejects retained rows when required PR or review provenance records are missing", async () => {
    const snapshotModule = await loadSnapshotModule();
    const calibrationModule = await loadCalibrationModule();

    expect(snapshotModule).not.toBeNull();
    expect(calibrationModule).not.toBeNull();
    if (!snapshotModule?.assertValidXbmcFixtureSnapshot || !calibrationModule?.evaluateCalibrationSnapshot) {
      return;
    }

    const snapshot = clone(
      snapshotModule.assertValidXbmcFixtureSnapshot(
        await readJsonFixture("fixtures/contributor-calibration/xbmc-snapshot.json"),
      ),
    );

    snapshot.retained[0].provenanceRecords = snapshot.retained[0].provenanceRecords.filter(
      (record: { source: string }) => record.source !== "github-review",
    );

    expect(() => calibrationModule.evaluateCalibrationSnapshot!(snapshot)).toThrow(
      /missing retained provenance/i,
    );
  });

  test("rejects malformed commit-count relationships instead of normalizing them away", async () => {
    const snapshotModule = await loadSnapshotModule();
    const calibrationModule = await loadCalibrationModule();

    expect(snapshotModule).not.toBeNull();
    expect(calibrationModule).not.toBeNull();
    if (!snapshotModule?.assertValidXbmcFixtureSnapshot || !calibrationModule?.evaluateCalibrationSnapshot) {
      return;
    }

    const snapshot = clone(
      snapshotModule.assertValidXbmcFixtureSnapshot(
        await readJsonFixture("fixtures/contributor-calibration/xbmc-snapshot.json"),
      ),
    );

    snapshot.retained[2].observedCommitCounts.since2025 = 99;
    snapshot.retained[2].observedCommitCounts.allTime = 10;

    expect(() => calibrationModule.evaluateCalibrationSnapshot!(snapshot)).toThrow(
      /commit-count relationship/i,
    );
  });

  test("rejects cohort drift when an excluded or unexpected identity appears in the retained evaluation set", async () => {
    const snapshotModule = await loadSnapshotModule();
    const calibrationModule = await loadCalibrationModule();

    expect(snapshotModule).not.toBeNull();
    expect(calibrationModule).not.toBeNull();
    if (!snapshotModule?.assertValidXbmcFixtureSnapshot || !calibrationModule?.evaluateCalibrationSnapshot) {
      return;
    }

    const snapshot = clone(
      snapshotModule.assertValidXbmcFixtureSnapshot(
        await readJsonFixture("fixtures/contributor-calibration/xbmc-snapshot.json"),
      ),
    );

    snapshot.retained[1] = {
      ...snapshot.retained[1],
      normalizedId: "hosted-weblate",
      displayName: "Hosted Weblate",
      githubUsername: "hosted-weblate",
    };

    expect(() => calibrationModule.evaluateCalibrationSnapshot!(snapshot)).toThrow(
      /retained cohort/i,
    );
  });

  test("supports two-contributor boundary cohorts and still defaults linked-but-unscored live profiles to newcomer guidance", async () => {
    const snapshotModule = await loadSnapshotModule();
    const calibrationModule = await loadCalibrationModule();

    expect(snapshotModule).not.toBeNull();
    expect(calibrationModule).not.toBeNull();
    if (!snapshotModule?.assertValidXbmcFixtureSnapshot || !calibrationModule?.evaluateCalibrationSnapshot) {
      return;
    }

    const snapshot = clone(
      snapshotModule.assertValidXbmcFixtureSnapshot(
        await readJsonFixture("fixtures/contributor-calibration/xbmc-snapshot.json"),
      ),
    );

    const report = calibrationModule.evaluateCalibrationSnapshot(snapshot, {
      referenceTime: "2026-04-10T20:42:03.000Z",
      retainedIds: ["fuzzard", "fkoemep"],
    });

    expect(report.rows).toHaveLength(2);
    expect(findRow(report, "fuzzard").live.contract.promptTier).toBe("newcomer");
    expect(findRow(report, "fkoemep").live.contract.promptTier).toBe("newcomer");
    expect(findRow(report, "fuzzard").intended.contract.promptTier).toBe("senior");
    expect(findRow(report, "fkoemep").intended.contract.promptTier).toBe("newcomer");
    expect(findRow(report, "fuzzard").instability.live.possibleRankRange).toEqual({
      min: 1,
      max: 2,
    });
  });
});
