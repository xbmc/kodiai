import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

type Check = {
  id: string;
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail?: string;
};

type Counts = {
  retained: number;
  excluded: number;
};

type FixtureReport = {
  command: "verify:m046:s01";
  generatedAt: string;
  check_ids: readonly string[];
  overallPassed: boolean;
  refreshed: boolean;
  counts: Counts | null;
  diagnostics: {
    statusCode: string | null;
  } | null;
  checks: Check[];
};

type CalibrationReport = {
  command: "verify:m046:s02";
  generatedAt: string;
  check_ids: readonly string[];
  overallPassed: boolean;
  prerequisite: {
    command: string;
    overallPassed: boolean;
    statusCode: string | null;
    failingChecks: string[];
    counts: Counts | null;
  } | null;
  snapshot: {
    path: string;
    manifestPath: string;
    isLoadable: boolean;
    isValid: boolean;
    parseError: string | null;
    status: string | null;
    diagnosticsStatusCode: string | null;
    counts: Counts | null;
  };
  calibration: {
    retainedIds: string[];
    excludedControls: Array<{
      normalizedId: string;
      exclusionReason: string;
      includedInEvaluation: boolean;
    }>;
    recommendation: {
      verdict: "keep" | "retune" | "replace";
      rationale: string[];
    } | null;
  } | null;
  checks: Check[];
};

type ChangeContractEntry = {
  mechanism: string;
  summary: string;
  rationale: string;
  evidence: string[];
  impactedSurfaces: string[];
};

type ChangeContract = {
  verdict: "keep" | "retune" | "replace";
  rationale: string[];
  keep: ChangeContractEntry[];
  change: ChangeContractEntry[];
  replace: ChangeContractEntry[];
};

type EvaluationReport = {
  command: "verify:m046";
  generatedAt: string;
  check_ids: readonly string[];
  overallPassed: boolean;
  verdict: {
    value: "keep" | "retune" | "replace" | null;
    rationale: string[];
    statusCode: string | null;
  };
  fixture: FixtureReport | null;
  calibration: CalibrationReport | null;
  m047ChangeContract: ChangeContract | null;
  checks: Check[];
};

type ProofHarnessResult = {
  exitCode: number;
  report: EvaluationReport;
};

type VerifyModule = {
  M046_CHECK_IDS?: readonly string[];
  evaluateM046?: (options?: Record<string, unknown>) => Promise<EvaluationReport>;
  renderM046Report?: (report: EvaluationReport) => string;
  buildM046ProofHarness?: (options?: Record<string, unknown>) => Promise<ProofHarnessResult>;
  parseM046Args?: (args: readonly string[]) => { json: boolean };
};

const EXPECTED_CHECK_IDS = [
  "M046-S03-FIXTURE-REPORT",
  "M046-S03-CALIBRATION-REPORT",
  "M046-S03-COUNT-CONSISTENCY",
  "M046-S03-VERDICT",
  "M046-S03-M047-CHANGE-CONTRACT",
] as const;

const importModule = new Function(
  "specifier",
  "return import(specifier)",
) as (specifier: string) => Promise<unknown>;

async function loadVerifyModule(): Promise<VerifyModule | null> {
  return (await importModule("./verify-m046.ts").catch(
    () => null,
  )) as VerifyModule | null;
}

function findCheck(report: EvaluationReport, id: string): Check {
  const check = report.checks.find((candidate) => candidate.id === id);
  expect(check).toBeDefined();
  return check!;
}

function makeFixtureReport(overrides: Partial<FixtureReport> = {}): FixtureReport {
  const report: FixtureReport = {
    command: "verify:m046:s01",
    generatedAt: "2026-04-10T23:00:00.000Z",
    check_ids: ["M046-S01-SNAPSHOT-STATUS"],
    overallPassed: true,
    refreshed: false,
    counts: { retained: 3, excluded: 6 },
    diagnostics: { statusCode: "snapshot-refreshed" },
    checks: [
      {
        id: "M046-S01-SNAPSHOT-STATUS",
        passed: true,
        skipped: false,
        status_code: "fixture_snapshot_ready",
      },
    ],
  };

  return {
    ...report,
    ...overrides,
    counts: overrides.counts === undefined ? report.counts : overrides.counts,
    diagnostics:
      overrides.diagnostics === undefined ? report.diagnostics : overrides.diagnostics,
    checks: overrides.checks === undefined ? report.checks : overrides.checks,
  };
}

function makeCalibrationReport(
  overrides: Partial<CalibrationReport> = {},
): CalibrationReport {
  const report: CalibrationReport = {
    command: "verify:m046:s02",
    generatedAt: "2026-04-10T23:00:00.000Z",
    check_ids: ["M046-S02-RECOMMENDATION"],
    overallPassed: true,
    prerequisite: {
      command: "verify:m046:s01",
      overallPassed: true,
      statusCode: "snapshot-refreshed",
      failingChecks: [],
      counts: { retained: 3, excluded: 6 },
    },
    snapshot: {
      path: "fixtures/contributor-calibration/xbmc-snapshot.json",
      manifestPath: "fixtures/contributor-calibration/xbmc-manifest.json",
      isLoadable: true,
      isValid: true,
      parseError: null,
      status: "ready",
      diagnosticsStatusCode: "snapshot-refreshed",
      counts: { retained: 3, excluded: 6 },
    },
    calibration: {
      retainedIds: ["fuzzard", "koprajs", "fkoemep"],
      excludedControls: [
        {
          normalizedId: "hosted-weblate",
          exclusionReason: "bot",
          includedInEvaluation: false,
        },
        {
          normalizedId: "jenkins4kodi",
          exclusionReason: "bot",
          includedInEvaluation: false,
        },
        {
          normalizedId: "kai-sommerfeld",
          exclusionReason: "alias-collision",
          includedInEvaluation: false,
        },
        {
          normalizedId: "keith",
          exclusionReason: "ambiguous-identity",
          includedInEvaluation: false,
        },
        {
          normalizedId: "keith-herrington",
          exclusionReason: "ambiguous-identity",
          includedInEvaluation: false,
        },
        {
          normalizedId: "ksooo",
          exclusionReason: "alias-collision",
          includedInEvaluation: false,
        },
      ],
      recommendation: {
        verdict: "replace",
        rationale: [
          "The live incremental path compresses the retained cohort into the same unscored outcome because the snapshot cannot replay changed-file arrays honestly.",
          "The full-signal model differentiates fuzzard, koprajs from the live incremental path instead of leaving them all at the newcomer default.",
          "Freshness caveats remain for fkoemep, so snapshot-based calibration still needs explicit degradation reporting.",
        ],
      },
    },
    checks: [
      {
        id: "M046-S02-RECOMMENDATION",
        passed: true,
        skipped: false,
        status_code: "calibration_recommendation_present",
      },
    ],
  };

  return {
    ...report,
    ...overrides,
    prerequisite:
      overrides.prerequisite === undefined ? report.prerequisite : overrides.prerequisite,
    snapshot: overrides.snapshot === undefined ? report.snapshot : overrides.snapshot,
    calibration:
      overrides.calibration === undefined ? report.calibration : overrides.calibration,
    checks: overrides.checks === undefined ? report.checks : overrides.checks,
  };
}

function makeChangeContract(
  overrides: Partial<ChangeContract> = {},
): ChangeContract {
  const contract: ChangeContract = {
    verdict: "replace",
    rationale: [
      "The live incremental path compresses the retained cohort into the same unscored outcome because the snapshot cannot replay changed-file arrays honestly.",
      "The full-signal model differentiates fuzzard, koprajs from the live incremental path instead of leaving them all at the newcomer default.",
    ],
    keep: [
      {
        mechanism: "m045-contributor-experience-contract-vocabulary",
        summary: "Keep the M045 contributor-experience contract vocabulary.",
        rationale: "The public contributor-experience vocabulary already survives the calibration swap.",
        evidence: ["src/contributor/experience-contract.ts keeps the stable public vocabulary."],
        impactedSurfaces: [
          "src/contributor/experience-contract.ts::projectContributorExperienceContract",
        ],
      },
    ],
    change: [
      {
        mechanism: "stored-tier-consumer-surfaces",
        summary: "Change stored-tier consumers to read the future M047 contract.",
        rationale: "Review and Slack surfaces should stop trusting stored tiers as the source of truth.",
        evidence: ["src/handlers/review.ts and src/slack/slash-command-handler.ts still read stored tiers."],
        impactedSurfaces: [
          "src/handlers/review.ts::resolveAuthorTier",
          "src/slack/slash-command-handler.ts::formatProfileCard",
        ],
      },
    ],
    replace: [
      {
        mechanism: "live-incremental-pr-authored-scoring",
        summary: "Replace the live incremental pr_authored-only scoring path.",
        rationale: "The live path collapses retained contributors into the newcomer default.",
        evidence: ["src/handlers/review.ts still only emits incremental expertise updates for type=pr_authored."],
        impactedSurfaces: [
          "src/handlers/review.ts::updateExpertiseIncremental(type=pr_authored)",
        ],
      },
    ],
  };

  return {
    ...contract,
    ...overrides,
    rationale: overrides.rationale === undefined ? contract.rationale : overrides.rationale,
    keep: overrides.keep === undefined ? contract.keep : overrides.keep,
    change: overrides.change === undefined ? contract.change : overrides.change,
    replace: overrides.replace === undefined ? contract.replace : overrides.replace,
  };
}

describe("verify m046 integrated proof harness", () => {
  test("exports stable check ids, evaluator, renderer, proof harness, and arg parser", async () => {
    const verifyModule = await loadVerifyModule();

    expect(verifyModule).not.toBeNull();
    if (!verifyModule) {
      return;
    }

    expect(verifyModule.M046_CHECK_IDS).toEqual(EXPECTED_CHECK_IDS);
    expect(typeof verifyModule.evaluateM046).toBe("function");
    expect(typeof verifyModule.renderM046Report).toBe("function");
    expect(typeof verifyModule.buildM046ProofHarness).toBe("function");
    expect(typeof verifyModule.parseM046Args).toBe("function");
    expect(verifyModule.parseM046Args?.([])).toEqual({ json: false });
    expect(verifyModule.parseM046Args?.(["--json"])).toEqual({ json: true });
    expect(() => verifyModule.parseM046Args?.(["--wat"])).toThrow(/invalid_cli_args/i);
  });

  test("evaluates s01 once, reuses the exact fixture report in s02, and preserves the current replace verdict plus M047 change contract", async () => {
    const verifyModule = await loadVerifyModule();

    expect(verifyModule).not.toBeNull();
    if (!verifyModule?.evaluateM046 || !verifyModule.renderM046Report) {
      return;
    }

    const fixtureReport = makeFixtureReport();
    let evaluateS01Calls = 0;

    const report = await verifyModule.evaluateM046({
      generatedAt: "2026-04-10T23:05:00.000Z",
      _evaluateS01: async () => {
        evaluateS01Calls += 1;
        return fixtureReport;
      },
      _evaluateS02: async (options: Record<string, unknown> = {}) => {
        const reusedFixture = await (options._evaluateS01 as () => Promise<unknown>)();
        expect(reusedFixture).toBe(fixtureReport);
        return makeCalibrationReport();
      },
      _buildChangeContract: () => makeChangeContract(),
    });

    const rendered = verifyModule.renderM046Report(report);

    expect(evaluateS01Calls).toBe(1);
    expect(report.command).toBe("verify:m046");
    expect(report.check_ids).toEqual(EXPECTED_CHECK_IDS);
    expect(report.overallPassed).toBe(true);
    expect(report.verdict).toEqual({
      value: "replace",
      rationale: expect.arrayContaining([
        expect.stringContaining("live incremental path"),
        expect.stringContaining("full-signal model"),
      ]),
      statusCode: "replace_recommended",
    });
    expect(report.fixture?.command).toBe("verify:m046:s01");
    expect(report.fixture?.counts).toEqual({ retained: 3, excluded: 6 });
    expect(report.calibration?.command).toBe("verify:m046:s02");
    expect(report.calibration?.prerequisite?.counts).toEqual({ retained: 3, excluded: 6 });
    expect(report.m047ChangeContract).toEqual(makeChangeContract());
    expect(findCheck(report, "M046-S03-FIXTURE-REPORT")).toMatchObject({
      passed: true,
      status_code: "fixture_report_preserved",
    });
    expect(findCheck(report, "M046-S03-CALIBRATION-REPORT")).toMatchObject({
      passed: true,
      status_code: "calibration_report_preserved",
    });
    expect(findCheck(report, "M046-S03-COUNT-CONSISTENCY")).toMatchObject({
      passed: true,
      status_code: "nested_counts_consistent",
    });
    expect(findCheck(report, "M046-S03-VERDICT")).toMatchObject({
      passed: true,
      status_code: "replace_recommended",
    });
    expect(findCheck(report, "M046-S03-M047-CHANGE-CONTRACT")).toMatchObject({
      passed: true,
      status_code: "m047_change_contract_complete",
    });
    expect(rendered).toContain("Verdict: replace");
    expect(rendered).toContain("live-incremental-pr-authored-scoring");
    expect(rendered).toContain("stored-tier-consumer-surfaces");
  });

  test("fails non-zero with named top-level status codes when nested reports are malformed or retained/excluded counts drift", async () => {
    const verifyModule = await loadVerifyModule();

    expect(verifyModule).not.toBeNull();
    if (!verifyModule?.buildM046ProofHarness) {
      return;
    }

    const malformedStdout: string[] = [];
    const malformedStderr: string[] = [];
    const malformed = await verifyModule.buildM046ProofHarness({
      json: true,
      stdout: { write: (chunk: string) => void malformedStdout.push(chunk) },
      stderr: { write: (chunk: string) => void malformedStderr.push(chunk) },
      _evaluateS01: async () => ({ command: "verify:m046:s01" }),
      _evaluateS02: async () => ({ command: "verify:m046:s02" }),
    });

    const malformedReport = JSON.parse(malformedStdout.join("")) as EvaluationReport;
    expect(malformed.exitCode).toBe(1);
    expect(malformedReport.overallPassed).toBe(false);
    expect(findCheck(malformedReport, "M046-S03-FIXTURE-REPORT")).toMatchObject({
      passed: false,
      status_code: "fixture_report_malformed",
    });
    expect(findCheck(malformedReport, "M046-S03-CALIBRATION-REPORT")).toMatchObject({
      passed: false,
      status_code: "calibration_report_malformed",
    });
    expect(malformedStderr.join(" ")).toContain("fixture_report_malformed");
    expect(malformedStderr.join(" ")).toContain("calibration_report_malformed");

    const driftStdout: string[] = [];
    const driftStderr: string[] = [];
    const drift = await verifyModule.buildM046ProofHarness({
      json: true,
      stdout: { write: (chunk: string) => void driftStdout.push(chunk) },
      stderr: { write: (chunk: string) => void driftStderr.push(chunk) },
      _evaluateS01: async () => makeFixtureReport({ counts: { retained: 3, excluded: 6 } }),
      _evaluateS02: async () =>
        makeCalibrationReport({
          prerequisite: {
            command: "verify:m046:s01",
            overallPassed: true,
            statusCode: "snapshot-refreshed",
            failingChecks: [],
            counts: { retained: 2, excluded: 7 },
          },
          snapshot: {
            path: "fixtures/contributor-calibration/xbmc-snapshot.json",
            manifestPath: "fixtures/contributor-calibration/xbmc-manifest.json",
            isLoadable: true,
            isValid: true,
            parseError: null,
            status: "ready",
            diagnosticsStatusCode: "snapshot-refreshed",
            counts: { retained: 2, excluded: 7 },
          },
          calibration: {
            retainedIds: ["fuzzard", "koprajs"],
            excludedControls: [
              { normalizedId: "hosted-weblate", exclusionReason: "bot", includedInEvaluation: false },
              { normalizedId: "jenkins4kodi", exclusionReason: "bot", includedInEvaluation: false },
              { normalizedId: "kai-sommerfeld", exclusionReason: "alias-collision", includedInEvaluation: false },
              { normalizedId: "keith", exclusionReason: "ambiguous-identity", includedInEvaluation: false },
              { normalizedId: "keith-herrington", exclusionReason: "ambiguous-identity", includedInEvaluation: false },
              { normalizedId: "ksooo", exclusionReason: "alias-collision", includedInEvaluation: false },
              { normalizedId: "ghost-user", exclusionReason: "ambiguous-identity", includedInEvaluation: false },
            ],
            recommendation: {
              verdict: "replace",
              rationale: ["Retained/excluded counts drifted from the nested prerequisite evidence."],
            },
          },
        }),
      _buildChangeContract: () => makeChangeContract(),
    });

    const driftReport = JSON.parse(driftStdout.join("")) as EvaluationReport;
    expect(drift.exitCode).toBe(1);
    expect(findCheck(driftReport, "M046-S03-COUNT-CONSISTENCY")).toMatchObject({
      passed: false,
      status_code: "nested_count_drift",
    });
    expect(findCheck(driftReport, "M046-S03-COUNT-CONSISTENCY").detail).toContain("retained");
    expect(findCheck(driftReport, "M046-S03-COUNT-CONSISTENCY").detail).toContain("excluded");
    expect(driftStderr.join(" ")).toContain("nested_count_drift");
  });

  test("fails non-zero when the final recommendation is missing or the M047 contract contradicts itself", async () => {
    const verifyModule = await loadVerifyModule();

    expect(verifyModule).not.toBeNull();
    if (!verifyModule?.buildM046ProofHarness) {
      return;
    }

    const missingVerdictStdout: string[] = [];
    const missingVerdictStderr: string[] = [];
    const missingVerdict = await verifyModule.buildM046ProofHarness({
      json: true,
      stdout: { write: (chunk: string) => void missingVerdictStdout.push(chunk) },
      stderr: { write: (chunk: string) => void missingVerdictStderr.push(chunk) },
      _evaluateS01: async () => makeFixtureReport(),
      _evaluateS02: async () => makeCalibrationReport({
        calibration: {
          retainedIds: ["fuzzard", "koprajs", "fkoemep"],
          excludedControls: makeCalibrationReport().calibration!.excludedControls,
          recommendation: null,
        },
      }),
    });

    const missingVerdictReport = JSON.parse(missingVerdictStdout.join("")) as EvaluationReport;
    expect(missingVerdict.exitCode).toBe(1);
    expect(findCheck(missingVerdictReport, "M046-S03-VERDICT")).toMatchObject({
      passed: false,
      status_code: "final_verdict_missing",
    });
    expect(missingVerdictStderr.join(" ")).toContain("final_verdict_missing");

    const contradictionStdout: string[] = [];
    const contradictionStderr: string[] = [];
    const contradiction = await verifyModule.buildM046ProofHarness({
      json: true,
      stdout: { write: (chunk: string) => void contradictionStdout.push(chunk) },
      stderr: { write: (chunk: string) => void contradictionStderr.push(chunk) },
      _evaluateS01: async () => makeFixtureReport(),
      _evaluateS02: async () => makeCalibrationReport(),
      _buildChangeContract: () => ({
        verdict: "replace",
        rationale: ["Replace the live incremental path."],
        keep: [
          {
            mechanism: "live-incremental-pr-authored-scoring",
            summary: "Keep the current scoring path.",
            rationale: "Contradiction for test coverage.",
            evidence: ["contradictory keep evidence"],
            impactedSurfaces: ["src/handlers/review.ts::updateExpertiseIncremental(type=pr_authored)"],
          },
        ],
        change: [],
        replace: [
          {
            mechanism: "live-incremental-pr-authored-scoring",
            summary: "Replace the current scoring path.",
            rationale: "The same mechanism cannot be kept and replaced.",
            evidence: ["contradictory replace evidence"],
            impactedSurfaces: ["src/handlers/review.ts::updateExpertiseIncremental(type=pr_authored)"],
          },
        ],
      }),
    });

    const contradictionReport = JSON.parse(contradictionStdout.join("")) as EvaluationReport;
    expect(contradiction.exitCode).toBe(1);
    expect(findCheck(contradictionReport, "M046-S03-M047-CHANGE-CONTRACT")).toMatchObject({
      passed: false,
      status_code: "contradictory-mechanism-bucket",
    });
    expect(contradictionStderr.join(" ")).toContain("contradictory-mechanism-bucket");
  });

  test("keeps human and json output aligned and wires the canonical package script", async () => {
    const verifyModule = await loadVerifyModule();
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["verify:m046"]).toBe("bun scripts/verify-m046.ts");
    expect(verifyModule).not.toBeNull();
    if (!verifyModule?.buildM046ProofHarness) {
      return;
    }

    const humanStdout: string[] = [];
    const jsonStdout: string[] = [];

    const human = await verifyModule.buildM046ProofHarness({
      generatedAt: "2026-04-10T23:10:00.000Z",
      referenceTime: "2026-04-10T20:42:03.000Z",
      stdout: { write: (chunk: string) => void humanStdout.push(chunk) },
      stderr: { write: () => {} },
    });
    const json = await verifyModule.buildM046ProofHarness({
      generatedAt: "2026-04-10T23:10:00.000Z",
      referenceTime: "2026-04-10T20:42:03.000Z",
      json: true,
      stdout: { write: (chunk: string) => void jsonStdout.push(chunk) },
      stderr: { write: () => {} },
    });

    const parsed = JSON.parse(jsonStdout.join("")) as EvaluationReport;

    expect(human.exitCode).toBe(0);
    expect(json.exitCode).toBe(0);
    expect(parsed.check_ids).toEqual(EXPECTED_CHECK_IDS);
    expect(parsed.verdict.value).toBe("replace");
    expect(parsed.m047ChangeContract?.replace.map((entry) => entry.mechanism)).toContain(
      "live-incremental-pr-authored-scoring",
    );
    expect(humanStdout.join(" ")).toContain("Verdict: replace");
    expect(humanStdout.join(" ")).toContain("m045-contributor-experience-contract-vocabulary");
    expect(humanStdout.join(" ")).toContain("M046-S03-M047-CHANGE-CONTRACT PASS status_code=m047_change_contract_complete");
  });
});
