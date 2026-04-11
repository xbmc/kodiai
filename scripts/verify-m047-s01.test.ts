import { describe, expect, test } from "bun:test";

type ScenarioId =
  | "linked-unscored"
  | "legacy"
  | "stale"
  | "calibrated"
  | "opt-out"
  | "coarse-fallback-cache";

type Check = {
  id: string;
  scenarioId: ScenarioId;
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail?: string;
};

type ScenarioReport = {
  scenarioId: ScenarioId;
  description: string;
  trustState: string | null;
  trustReason: string | null;
  calibrationMarker: string | null;
  calibrationVersion: string | null;
  contractState: string | null;
  contractSource: string | null;
  fallbackPath: string | null;
  degradationPath: string | null;
  promptSurfaceText: string;
  reviewDetailsBody: string;
  check: {
    checkId: string;
    passed: boolean;
    statusCode: string;
    detail?: string;
  };
};

type EvaluationReport = {
  command: "verify:m047:s01";
  generatedAt: string;
  check_ids: readonly string[];
  overallPassed: boolean;
  scenarios: ScenarioReport[];
  checks: Check[];
};

type ScenarioFixture = Omit<ScenarioReport, "check">;

type ProofHarnessModule = {
  M047_S01_SCENARIO_IDS: readonly ScenarioId[];
  M047_S01_CHECK_IDS: readonly string[];
  buildM047S01ScenarioFixture: (params: { scenarioId: ScenarioId }) => Promise<ScenarioFixture>;
  runScenarioTruthfulCheck: (
    scenarioId: ScenarioId,
    runFixture?: (scenarioId: ScenarioId) => Promise<ScenarioFixture> | ScenarioFixture,
  ) => Promise<Check>;
  evaluateM047S01: (opts?: {
    runFixture?: (scenarioId: ScenarioId) => Promise<ScenarioFixture> | ScenarioFixture;
    generatedAt?: string;
  }) => Promise<EvaluationReport>;
  buildM047S01ProofHarness: (opts?: {
    runFixture?: (scenarioId: ScenarioId) => Promise<ScenarioFixture> | ScenarioFixture;
    stdout?: { write: (chunk: string) => boolean | void };
    stderr?: { write: (chunk: string) => boolean | void };
    json?: boolean;
  }) => Promise<{ exitCode: number }>;
};

async function loadModule(): Promise<ProofHarnessModule | null> {
  try {
    return await import("./verify-m047-s01.ts") as ProofHarnessModule;
  } catch {
    return null;
  }
}

async function requireModule(): Promise<ProofHarnessModule> {
  const mod = await loadModule();
  expect(mod).toBeTruthy();
  return mod as ProofHarnessModule;
}

describe("buildM047S01ScenarioFixture", () => {
  test("renders the stored-profile runtime scenario matrix with truthful trust and contract states", async () => {
    const mod = await requireModule();
    const fixtures = await Promise.all(
      mod.M047_S01_SCENARIO_IDS.map((scenarioId) =>
        mod.buildM047S01ScenarioFixture({ scenarioId })
      ),
    );

    expect(fixtures.map((fixture) => fixture.scenarioId)).toEqual([
      "linked-unscored",
      "legacy",
      "stale",
      "calibrated",
      "opt-out",
      "coarse-fallback-cache",
    ]);
    expect(fixtures.map((fixture) => fixture.trustState)).toEqual([
      "linked-unscored",
      "legacy",
      "stale",
      "calibrated",
      "calibrated",
      null,
    ]);
    expect(fixtures.map((fixture) => fixture.contractState)).toEqual([
      "coarse-fallback",
      "coarse-fallback",
      "generic-degraded",
      "profile-backed",
      "generic-opt-out",
      "coarse-fallback",
    ]);
    expect(fixtures.map((fixture) => fixture.contractSource)).toEqual([
      "github-search",
      "author-cache",
      "github-search",
      "contributor-profile",
      "contributor-profile",
      "author-cache",
    ]);
    expect(fixtures.map((fixture) => fixture.fallbackPath)).toEqual([
      "stored-profile-linked-unscored->github-search",
      "stored-profile-legacy->author-cache",
      "stored-profile-stale->generic-degraded",
      "trusted-stored-profile",
      "opted-out-stored-profile",
      "no-stored-profile->author-cache",
    ]);
    expect(fixtures.every((fixture) => fixture.promptSurfaceText.includes("Contributor-experience contract:"))).toBe(true);
    expect(fixtures.every((fixture) => fixture.reviewDetailsBody.includes("- Contributor experience:"))).toBe(true);
    expect(fixtures.every((fixture) => !fixture.reviewDetailsBody.includes("Profile ID:"))).toBe(true);
    expect(fixtures.every((fixture) => !fixture.reviewDetailsBody.includes("Slack ID:"))).toBe(true);
    expect(fixtures.every((fixture) => !fixture.reviewDetailsBody.includes("expertise score"))).toBe(true);

    const calibrated = fixtures.find((fixture) => fixture.scenarioId === "calibrated");
    expect(calibrated?.calibrationMarker).toBe("m047-calibrated-v1");
    expect(calibrated?.calibrationVersion).toBe("v1");
    expect(calibrated?.promptSurfaceText).toContain("established contributor");

    const stale = fixtures.find((fixture) => fixture.scenarioId === "stale");
    expect(stale?.degradationPath).toBe("search-api-rate-limit");
    expect(stale?.promptSurfaceText).toContain("## Search API Degradation Context");
  });
});

describe("runScenarioTruthfulCheck", () => {
  test("passes for the real linked-unscored fail-open runtime fixture", async () => {
    const mod = await requireModule();
    const result = await mod.runScenarioTruthfulCheck("linked-unscored");

    expect(result.id).toBe("M047-S01-LINKED-UNSCORED-RUNTIME-TRUTHFUL");
    expect(result.passed).toBe(true);
    expect(result.status_code).toBe("linked_unscored_runtime_truthful");
  });

  test("fails with a named status code when trust or contract diagnostics drift out of the scenario output", async () => {
    const mod = await requireModule();
    const result = await mod.runScenarioTruthfulCheck("legacy", async (scenarioId) => {
      const fixture = await mod.buildM047S01ScenarioFixture({ scenarioId });
      return {
        ...fixture,
        trustState: null,
        contractState: null,
      };
    });

    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("runtime_surface_truthfulness_failed");
    expect(result.detail).toContain("scenario=legacy");
    expect(result.detail).toContain("trustState missing");
    expect(result.detail).toContain("contractState missing");
  });
});

describe("evaluateM047S01", () => {
  test("covers all six runtime scenarios and emits stable scenario-level check ids", async () => {
    const mod = await requireModule();
    const report = await mod.evaluateM047S01({
      generatedAt: "2026-04-10T00:00:00.000Z",
    });

    expect(report.command).toBe("verify:m047:s01");
    expect(report.generatedAt).toBe("2026-04-10T00:00:00.000Z");
    expect(report.check_ids).toEqual(mod.M047_S01_CHECK_IDS);
    expect(report.checks).toHaveLength(mod.M047_S01_CHECK_IDS.length);
    expect(report.overallPassed).toBe(true);
    expect(report.scenarios.map((scenario) => scenario.scenarioId)).toEqual([
      ...mod.M047_S01_SCENARIO_IDS,
    ]);
    expect(report.scenarios.every((scenario) => scenario.check.passed)).toBe(true);
  });

  test("turns resolver execution errors into a named failing check instead of crashing the verifier", async () => {
    const mod = await requireModule();
    const report = await mod.evaluateM047S01({
      runFixture: async (scenarioId) => {
        if (scenarioId === "stale") {
          throw new Error("resolver exploded");
        }
        return mod.buildM047S01ScenarioFixture({ scenarioId });
      },
    });

    expect(report.overallPassed).toBe(false);
    const staleCheck = report.checks.find((check) => check.scenarioId === "stale");
    expect(staleCheck?.passed).toBe(false);
    expect(staleCheck?.status_code).toBe("runtime_scenario_execution_failed");
    expect(staleCheck?.detail).toContain("scenario=stale");
    expect(staleCheck?.detail).toContain("resolver exploded");
  });
});

describe("buildM047S01ProofHarness", () => {
  test("returns exitCode=0 and a human report with trust, contract, source, and fallback diagnostics", async () => {
    const mod = await requireModule();
    const stdout: string[] = [];
    const stderr: string[] = [];

    const { exitCode } = await mod.buildM047S01ProofHarness({
      stdout: { write: (chunk) => void stdout.push(chunk) },
      stderr: { write: (chunk) => void stderr.push(chunk) },
    });

    expect(exitCode).toBe(0);
    expect(stderr.join("")).toBe("");
    expect(stdout.join("")).toContain("Final verdict: PASS");
    expect(stdout.join("")).toContain("linked-unscored");
    expect(stdout.join("")).toContain("trust=linked-unscored");
    expect(stdout.join("")).toContain("contract=profile-backed");
    expect(stdout.join("")).toContain("source=author-cache");
    expect(stdout.join("")).toContain("fallback=stored-profile-stale->generic-degraded");
  });

  test("emits JSON with scenario details that mirror the operator-facing human report", async () => {
    const mod = await requireModule();
    const stdout: string[] = [];

    await mod.buildM047S01ProofHarness({
      stdout: { write: (chunk) => void stdout.push(chunk) },
      stderr: { write: () => {} },
      json: true,
    });

    const parsed = JSON.parse(stdout.join("")) as EvaluationReport;
    expect(parsed.command).toBe("verify:m047:s01");
    expect(parsed.check_ids).toEqual(mod.M047_S01_CHECK_IDS);
    expect(parsed.scenarios.map((scenario) => scenario.scenarioId)).toEqual([
      ...mod.M047_S01_SCENARIO_IDS,
    ]);
    expect(parsed.scenarios[0]).toHaveProperty("trustState");
    expect(parsed.scenarios[0]).toHaveProperty("contractState");
    expect(parsed.scenarios[0]).toHaveProperty("contractSource");
    expect(parsed.scenarios[0]).toHaveProperty("fallbackPath");
    expect(parsed.scenarios[0]?.check).toHaveProperty("statusCode");
  });
});

describe("package script wiring", () => {
  test("keeps the M045 proof script and adds the M047 runtime proof script", async () => {
    const packageJson = JSON.parse(
      await Bun.file(new URL("../package.json", import.meta.url)).text(),
    ) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["verify:m045:s01"]).toBe("bun scripts/verify-m045-s01.ts");
    expect(packageJson.scripts?.["verify:m047:s01"]).toBe("bun scripts/verify-m047-s01.ts");
  });
});
