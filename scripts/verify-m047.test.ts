import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

type Check = {
  id: string;
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail?: string;
};

type NestedS01Scenario = {
  scenarioId: string;
  trustState: string | null;
  contractState: string | null;
  contractSource: string | null;
  fallbackPath: string | null;
  degradationPath: string | null;
  check: {
    checkId: string;
    passed: boolean;
    statusCode: string;
    detail?: string;
  };
};

type NestedS02Scenario = {
  scenarioId: string;
  trustState: string | null;
  contractState: string | null;
  contractSource: string | null;
  fallbackPath: string | null;
  degradationPath: string | null;
  profile: {
    passed: boolean;
    statusCode: string;
    text: string;
  };
  linkContinuity: {
    passed: boolean;
    statusCode: string;
    text: string;
  } | null;
  optInContinuity: {
    passed: boolean;
    statusCode: string;
    text: string;
  };
  retrievalMultiQuery: {
    passed: boolean;
    statusCode: string;
    query: string;
  };
  retrievalLegacyQuery: {
    passed: boolean;
    statusCode: string;
    query: string;
  };
  identitySuppression: {
    passed: boolean;
    statusCode: string;
    dmText: string | null;
    warningLogged: boolean;
    fetchUrls: string[];
  } | null;
};

type M047S02Report = {
  command: "verify:m047:s02";
  generatedAt: string;
  check_ids: readonly string[];
  overallPassed: boolean;
  storedProfileRuntime: {
    command: "verify:m047:s01";
    overallPassed: boolean;
    scenarios: NestedS01Scenario[];
    checks: Check[];
  } | null;
  scenarios: NestedS02Scenario[];
  checks: Check[];
};

type M045S03Report = {
  command: "verify:m045:s03";
  generatedAt: string;
  check_ids: readonly string[];
  overallPassed: boolean;
  githubReview: {
    command: string;
    overallPassed: boolean;
    scenarios: Array<{ scenarioId: string }>;
    checks: Check[];
  } | null;
  retrieval: {
    scenarios: Array<{
      scenarioId: string;
      contractState: string;
      multiQuery: {
        passed: boolean;
        statusCode: string;
        query: string;
      };
      legacyQuery: {
        passed: boolean;
        statusCode: string;
        query: string;
      };
    }>;
  };
  slack: {
    scenarios: Array<{
      scenarioId: string;
      passed: boolean;
      statusCode: string;
      text: string;
    }>;
  };
  identity: {
    scenarios: Array<{
      scenarioId: string;
      passed: boolean;
      statusCode: string;
      dmText: string | null;
      warningLogged: boolean;
    }>;
  };
  checks: Check[];
};

type M046Report = {
  command: "verify:m046";
  generatedAt: string;
  check_ids: readonly string[];
  overallPassed: boolean;
  verdict: {
    value: "keep" | "retune" | "replace" | null;
    rationale: string[];
    statusCode: string | null;
  };
  calibration: {
    command: "verify:m046:s02";
    overallPassed: boolean;
    calibration: {
      retainedIds: string[];
      rows: Array<{
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
          findings: string[];
        };
      }>;
    } | null;
  } | null;
  m047ChangeContract: {
    verdict: "keep" | "retune" | "replace";
    rationale: string[];
    keep: Array<{ mechanism: string }>;
    change: Array<{ mechanism: string }>;
    replace: Array<{ mechanism: string }>;
  } | null;
  checks: Check[];
};

type MilestoneScenarioId =
  | "linked-unscored"
  | "calibrated-retained"
  | "stale-degraded"
  | "opt-out"
  | "coarse-fallback";

type MilestoneScenarioReport = {
  scenarioId: MilestoneScenarioId;
  description: string;
  passed: boolean;
  statusCode: string;
  detail?: string;
  reviewRuntime: {
    passed: boolean;
    statusCode: string;
    source: "m047-s01";
    sourceScenarioId: string;
    trustState: string | null;
    contractState: string | null;
    contractSource: string | null;
    fallbackPath: string | null;
    degradationPath: string | null;
    promptStatusCode: string;
    reviewDetailsStatusCode: string;
  };
  retrieval: {
    passed: boolean;
    statusCode: string;
    source: "m047-s02" | "m045-s03";
    sourceScenarioId: string;
    multiQueryStatusCode: string;
    legacyQueryStatusCode: string;
    multiQuery: string;
    legacyQuery: string;
  };
  slackProfile: {
    applicable: boolean;
    passed: boolean;
    statusCode: string;
    source: "m047-s02" | null;
    sourceScenarioId: string | null;
    profileStatusCode: string | null;
    continuityStatusCode: string | null;
    optInStatusCode: string | null;
    detail?: string;
  };
  identity: {
    applicable: boolean;
    passed: boolean;
    statusCode: string;
    source: "m047-s02" | "m045-s03" | null;
    sourceScenarioId: string | null;
    detail?: string;
  };
  contributorModel: {
    applicable: boolean;
    passed: boolean;
    statusCode: string;
    source: "m046" | null;
    contributorNormalizedId: string | null;
    verdict: "keep" | "retune" | "replace" | null;
    changeContractVerdict: "keep" | "retune" | "replace" | null;
    liveContractState: string | null;
    livePromptTier: string | null;
    intendedContractState: string | null;
    intendedPromptTier: string | null;
    freshnessBand: string | null;
    linkedProfileState: string | null;
    detail?: string;
  };
};

type EvaluationReport = {
  command: "verify:m047";
  generatedAt: string;
  check_ids: readonly string[];
  overallPassed: boolean;
  scenarios: MilestoneScenarioReport[];
  m047S02: M047S02Report | null;
  m045S03: M045S03Report | null;
  m046: M046Report | null;
  checks: Check[];
};

type ProofHarnessResult = {
  exitCode: number;
  report: EvaluationReport;
};

type VerifyModule = {
  M047_CHECK_IDS?: readonly string[];
  M047_SCENARIO_IDS?: readonly MilestoneScenarioId[];
  evaluateM047?: (options?: Record<string, unknown>) => Promise<EvaluationReport>;
  renderM047Report?: (report: EvaluationReport) => string;
  buildM047ProofHarness?: (options?: Record<string, unknown>) => Promise<ProofHarnessResult>;
  parseM047Args?: (args: readonly string[]) => { json: boolean };
};

const EXPECTED_CHECK_IDS = [
  "M047-S03-S02-REPORT-COMPOSED",
  "M047-S03-M045-REPORT-COMPOSED",
  "M047-S03-M046-REPORT-COMPOSED",
  "M047-S03-MILESTONE-SCENARIOS",
] as const;

const EXPECTED_SCENARIO_IDS = [
  "linked-unscored",
  "calibrated-retained",
  "stale-degraded",
  "opt-out",
  "coarse-fallback",
] as const;

const importModule = new Function(
  "specifier",
  "return import(specifier)",
) as (specifier: string) => Promise<unknown>;

async function loadVerifyModule(): Promise<VerifyModule | null> {
  return (await importModule("./verify-m047.ts").catch(
    () => null,
  )) as VerifyModule | null;
}

async function loadNestedModules(): Promise<{
  evaluateM047S02: (options?: Record<string, unknown>) => Promise<M047S02Report>;
  evaluateM045S03: (options?: Record<string, unknown>) => Promise<M045S03Report>;
  evaluateM046: (options?: Record<string, unknown>) => Promise<M046Report>;
}> {
  const [s02Module, m045Module, m046Module] = await Promise.all([
    importModule("./verify-m047-s02.ts"),
    importModule("./verify-m045-s03.ts"),
    importModule("./verify-m046.ts"),
  ]);

  return {
    evaluateM047S02: (s02Module as { evaluateM047S02: (options?: Record<string, unknown>) => Promise<M047S02Report> }).evaluateM047S02,
    evaluateM045S03: (m045Module as { evaluateM045S03: (options?: Record<string, unknown>) => Promise<M045S03Report> }).evaluateM045S03,
    evaluateM046: (m046Module as { evaluateM046: (options?: Record<string, unknown>) => Promise<M046Report> }).evaluateM046,
  };
}

function findCheck(report: EvaluationReport, id: string): Check {
  const check = report.checks.find((candidate) => candidate.id === id);
  expect(check).toBeDefined();
  return check!;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("verify m047 integrated milestone proof harness", () => {
  test("exports stable check ids, milestone scenario ids, evaluator, renderer, proof harness, and arg parser", async () => {
    const verifyModule = await loadVerifyModule();

    expect(verifyModule).not.toBeNull();
    if (!verifyModule) {
      return;
    }

    expect(verifyModule.M047_CHECK_IDS).toEqual(EXPECTED_CHECK_IDS);
    expect(verifyModule.M047_SCENARIO_IDS).toEqual(EXPECTED_SCENARIO_IDS);
    expect(typeof verifyModule.evaluateM047).toBe("function");
    expect(typeof verifyModule.renderM047Report).toBe("function");
    expect(typeof verifyModule.buildM047ProofHarness).toBe("function");
    expect(typeof verifyModule.parseM047Args).toBe("function");
    expect(verifyModule.parseM047Args?.([])).toEqual({ json: false });
    expect(verifyModule.parseM047Args?.(["--json"])).toEqual({ json: true });
    expect(() => verifyModule.parseM047Args?.(["--wat"])).toThrow(/invalid_cli_args/i);
  });

  test("calls the three nested evaluators once, preserves their exact reports, anchors milestone scenarios, and keeps the M046 replace verdict as data", async () => {
    const verifyModule = await loadVerifyModule();

    expect(verifyModule).not.toBeNull();
    if (!verifyModule?.evaluateM047 || !verifyModule.renderM047Report) {
      return;
    }

    const nested = await loadNestedModules();
    const [s02Report, m045Report, m046Report] = await Promise.all([
      nested.evaluateM047S02({ generatedAt: "2026-04-10T23:20:00.000Z" }),
      nested.evaluateM045S03({ generatedAt: "2026-04-10T23:20:00.000Z" }),
      nested.evaluateM046({
        generatedAt: "2026-04-10T23:20:00.000Z",
        referenceTime: "2026-04-10T20:42:03.000Z",
      }),
    ]);

    const calls = { s02: 0, m045: 0, m046: 0 };
    const report = await verifyModule.evaluateM047({
      generatedAt: "2026-04-10T23:25:00.000Z",
      _evaluateM047S02: async () => {
        calls.s02 += 1;
        return s02Report;
      },
      _evaluateM045S03: async () => {
        calls.m045 += 1;
        return m045Report;
      },
      _evaluateM046: async () => {
        calls.m046 += 1;
        return m046Report;
      },
    });

    const rendered = verifyModule.renderM047Report(report);

    expect(calls).toEqual({ s02: 1, m045: 1, m046: 1 });
    expect(report.command).toBe("verify:m047");
    expect(report.generatedAt).toBe("2026-04-10T23:25:00.000Z");
    expect(report.check_ids).toEqual(EXPECTED_CHECK_IDS);
    expect(report.overallPassed).toBe(true);
    expect(report.m047S02).toBe(s02Report);
    expect(report.m045S03).toBe(m045Report);
    expect(report.m046).toBe(m046Report);
    expect(report.m046?.verdict).toMatchObject({
      value: "replace",
      statusCode: "replace_recommended",
    });
    expect(report.scenarios.map((scenario) => scenario.scenarioId)).toEqual(
      [...EXPECTED_SCENARIO_IDS],
    );

    const linkedUnscored = report.scenarios.find((scenario) => scenario.scenarioId === "linked-unscored");
    expect(linkedUnscored).toMatchObject({
      passed: true,
      reviewRuntime: {
        source: "m047-s01",
        sourceScenarioId: "linked-unscored",
        trustState: "linked-unscored",
        contractState: "coarse-fallback",
        contractSource: "github-search",
      },
      retrieval: {
        source: "m047-s02",
        sourceScenarioId: "linked-unscored",
      },
      slackProfile: {
        applicable: true,
        source: "m047-s02",
        sourceScenarioId: "linked-unscored",
      },
      identity: {
        applicable: false,
        source: null,
      },
      contributorModel: {
        applicable: false,
        source: null,
      },
    });
    expect(linkedUnscored?.retrieval.multiQuery).toContain("author: returning contributor");
    expect(linkedUnscored?.retrieval.legacyQuery).toContain("Author: returning contributor");

    const calibratedRetained = report.scenarios.find((scenario) => scenario.scenarioId === "calibrated-retained");
    expect(calibratedRetained).toMatchObject({
      passed: true,
      reviewRuntime: {
        sourceScenarioId: "calibrated",
        trustState: "calibrated",
        contractState: "profile-backed",
      },
      slackProfile: {
        applicable: true,
        sourceScenarioId: "calibrated",
      },
      contributorModel: {
        applicable: true,
        source: "m046",
        contributorNormalizedId: "koprajs",
        verdict: "replace",
        changeContractVerdict: "replace",
        liveContractState: "profile-backed",
        livePromptTier: "newcomer",
        intendedContractState: "profile-backed",
        intendedPromptTier: "established",
        freshnessBand: "fresh",
      },
    });

    const staleDegraded = report.scenarios.find((scenario) => scenario.scenarioId === "stale-degraded");
    expect(staleDegraded).toMatchObject({
      passed: true,
      reviewRuntime: {
        sourceScenarioId: "stale",
        trustState: "stale",
        contractState: "generic-degraded",
        degradationPath: "search-api-rate-limit",
      },
      contributorModel: {
        applicable: true,
        source: "m046",
        contributorNormalizedId: "fkoemep",
        freshnessBand: "stale",
        linkedProfileState: expect.any(String),
      },
    });
    expect(staleDegraded?.retrieval.multiQuery).not.toContain("author:");
    expect(staleDegraded?.retrieval.legacyQuery).not.toContain("Author:");

    const optOut = report.scenarios.find((scenario) => scenario.scenarioId === "opt-out");
    expect(optOut).toMatchObject({
      passed: true,
      reviewRuntime: {
        sourceScenarioId: "opt-out",
        contractState: "generic-opt-out",
      },
      identity: {
        applicable: true,
        source: "m047-s02",
        sourceScenarioId: "opt-out",
        statusCode: "opt_out_identity_suppression_truthful",
      },
    });
    expect(optOut?.retrieval.multiQuery).not.toContain("author:");
    expect(optOut?.retrieval.legacyQuery).not.toContain("Author:");

    const coarseFallback = report.scenarios.find((scenario) => scenario.scenarioId === "coarse-fallback");
    expect(coarseFallback).toMatchObject({
      passed: true,
      reviewRuntime: {
        sourceScenarioId: "coarse-fallback-cache",
        trustState: null,
        contractState: "coarse-fallback",
        contractSource: "author-cache",
      },
      retrieval: {
        source: "m045-s03",
        sourceScenarioId: "coarse-fallback",
      },
      slackProfile: {
        applicable: false,
        source: null,
        sourceScenarioId: null,
        statusCode: "not_applicable",
      },
      identity: {
        applicable: false,
        source: null,
      },
      contributorModel: {
        applicable: false,
        source: null,
      },
    });
    expect(coarseFallback?.retrieval.multiQuery).toContain("author: returning contributor");
    expect(coarseFallback?.retrieval.legacyQuery).toContain("Author: returning contributor");

    expect(findCheck(report, "M047-S03-S02-REPORT-COMPOSED")).toMatchObject({
      passed: true,
      status_code: "nested_s02_report_preserved",
    });
    expect(findCheck(report, "M047-S03-M045-REPORT-COMPOSED")).toMatchObject({
      passed: true,
      status_code: "nested_m045_report_preserved",
    });
    expect(findCheck(report, "M047-S03-M046-REPORT-COMPOSED")).toMatchObject({
      passed: true,
      status_code: "nested_m046_report_preserved",
    });
    expect(findCheck(report, "M047-S03-MILESTONE-SCENARIOS")).toMatchObject({
      passed: true,
      status_code: "milestone_scenarios_truthful",
    });
    expect(rendered).toContain("Verdict: replace");
    expect(rendered).toContain("calibrated-retained");
    expect(rendered).toContain("koprajs");
    expect(rendered).toContain("coarse-fallback");
    expect(rendered).toContain("slack/profile=n/a");
  });

  test("fails non-zero with named diagnostics when nested reports are malformed, fail, or lose milestone anchors", async () => {
    const verifyModule = await loadVerifyModule();

    expect(verifyModule).not.toBeNull();
    if (!verifyModule?.buildM047ProofHarness) {
      return;
    }

    const malformedStdout: string[] = [];
    const malformedStderr: string[] = [];
    const malformed = await verifyModule.buildM047ProofHarness({
      json: true,
      stdout: { write: (chunk: string) => void malformedStdout.push(chunk) },
      stderr: { write: (chunk: string) => void malformedStderr.push(chunk) },
      _evaluateM047S02: async () => ({ command: "verify:m047:s02" }),
      _evaluateM045S03: async () => ({ command: "verify:m045:s03" }),
      _evaluateM046: async () => ({ command: "verify:m046" }),
    });

    const malformedReport = JSON.parse(malformedStdout.join("")) as EvaluationReport;
    expect(malformed.exitCode).toBe(1);
    expect(malformedReport.overallPassed).toBe(false);
    expect(findCheck(malformedReport, "M047-S03-S02-REPORT-COMPOSED")).toMatchObject({
      passed: false,
      status_code: "nested_s02_report_malformed",
    });
    expect(findCheck(malformedReport, "M047-S03-M045-REPORT-COMPOSED")).toMatchObject({
      passed: false,
      status_code: "nested_m045_report_malformed",
    });
    expect(findCheck(malformedReport, "M047-S03-M046-REPORT-COMPOSED")).toMatchObject({
      passed: false,
      status_code: "nested_m046_report_malformed",
    });
    expect(malformedStderr.join(" ")).toContain("nested_s02_report_malformed");
    expect(malformedStderr.join(" ")).toContain("nested_m045_report_malformed");
    expect(malformedStderr.join(" ")).toContain("nested_m046_report_malformed");

    const nested = await loadNestedModules();
    const [s02Report, m045Report, m046Report] = await Promise.all([
      nested.evaluateM047S02({ generatedAt: "2026-04-10T23:30:00.000Z" }),
      nested.evaluateM045S03({ generatedAt: "2026-04-10T23:30:00.000Z" }),
      nested.evaluateM046({
        generatedAt: "2026-04-10T23:30:00.000Z",
        referenceTime: "2026-04-10T20:42:03.000Z",
      }),
    ]);

    const failedStdout: string[] = [];
    const failedStderr: string[] = [];
    const failed = await verifyModule.buildM047ProofHarness({
      json: true,
      stdout: { write: (chunk: string) => void failedStdout.push(chunk) },
      stderr: { write: (chunk: string) => void failedStderr.push(chunk) },
      _evaluateM047S02: async () => ({
        ...clone(s02Report),
        overallPassed: false,
      }),
      _evaluateM045S03: async () => m045Report,
      _evaluateM046: async () => m046Report,
    });

    const failedReport = JSON.parse(failedStdout.join("")) as EvaluationReport;
    expect(failed.exitCode).toBe(1);
    expect(findCheck(failedReport, "M047-S03-S02-REPORT-COMPOSED")).toMatchObject({
      passed: false,
      status_code: "nested_s02_report_failed",
    });
    expect(failedStderr.join(" ")).toContain("nested_s02_report_failed");

    const anchorStdout: string[] = [];
    const anchorStderr: string[] = [];
    const anchorDrift = clone(m046Report);
    if (anchorDrift.calibration?.calibration) {
      anchorDrift.calibration.calibration.rows = anchorDrift.calibration.calibration.rows.filter(
        (row) => row.normalizedId !== "koprajs",
      );
      anchorDrift.calibration.calibration.retainedIds = anchorDrift.calibration.calibration.retainedIds.filter(
        (id) => id !== "koprajs",
      );
    }

    const anchor = await verifyModule.buildM047ProofHarness({
      json: true,
      stdout: { write: (chunk: string) => void anchorStdout.push(chunk) },
      stderr: { write: (chunk: string) => void anchorStderr.push(chunk) },
      _evaluateM047S02: async () => s02Report,
      _evaluateM045S03: async () => m045Report,
      _evaluateM046: async () => anchorDrift,
    });

    const anchorReport = JSON.parse(anchorStdout.join("")) as EvaluationReport;
    expect(anchor.exitCode).toBe(1);
    expect(findCheck(anchorReport, "M047-S03-MILESTONE-SCENARIOS")).toMatchObject({
      passed: false,
      status_code: "milestone_scenario_drift",
    });
    expect(findCheck(anchorReport, "M047-S03-MILESTONE-SCENARIOS").detail).toContain(
      "calibrated-retained",
    );
    expect(anchorStderr.join(" ")).toContain("milestone_scenario_drift");
  });

  test("keeps human and json output aligned and wires the canonical package script", async () => {
    const verifyModule = await loadVerifyModule();
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["verify:m047"]).toBe("bun scripts/verify-m047.ts");
    expect(verifyModule).not.toBeNull();
    if (!verifyModule?.buildM047ProofHarness) {
      return;
    }

    const humanStdout: string[] = [];
    const jsonStdout: string[] = [];

    const human = await verifyModule.buildM047ProofHarness({
      generatedAt: "2026-04-10T23:35:00.000Z",
      referenceTime: "2026-04-10T20:42:03.000Z",
      stdout: { write: (chunk: string) => void humanStdout.push(chunk) },
      stderr: { write: () => {} },
    });
    const json = await verifyModule.buildM047ProofHarness({
      generatedAt: "2026-04-10T23:35:00.000Z",
      referenceTime: "2026-04-10T20:42:03.000Z",
      json: true,
      stdout: { write: (chunk: string) => void jsonStdout.push(chunk) },
      stderr: { write: () => {} },
    });

    const parsed = JSON.parse(jsonStdout.join("")) as EvaluationReport;

    expect(human.exitCode).toBe(0);
    expect(json.exitCode).toBe(0);
    expect(parsed.check_ids).toEqual(EXPECTED_CHECK_IDS);
    expect(parsed.scenarios.map((scenario) => scenario.scenarioId)).toEqual(
      [...EXPECTED_SCENARIO_IDS],
    );
    expect(parsed.m047S02?.command).toBe("verify:m047:s02");
    expect(parsed.m045S03?.command).toBe("verify:m045:s03");
    expect(parsed.m046?.command).toBe("verify:m046");
    expect(parsed.m046?.verdict.value).toBe("replace");
    expect(parsed.scenarios.find((scenario) => scenario.scenarioId === "coarse-fallback")?.slackProfile).toMatchObject({
      applicable: false,
      statusCode: "not_applicable",
    });
    expect(humanStdout.join(" ")).toContain("Verdict: replace");
    expect(humanStdout.join(" ")).toContain("linked-unscored");
    expect(humanStdout.join(" ")).toContain("calibrated-retained");
    expect(humanStdout.join(" ")).toContain("coarse-fallback");
    expect(humanStdout.join(" ")).toContain("slack/profile=n/a");
    expect(humanStdout.join(" ")).toContain(
      "M047-S03-MILESTONE-SCENARIOS PASS status_code=milestone_scenarios_truthful",
    );
  });
});
