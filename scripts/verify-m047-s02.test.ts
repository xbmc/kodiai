import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

type Check = {
  id: string;
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail?: string;
};

type RouteScenarioId =
  | "link-generic-continuity"
  | "profile-opt-in-generic-continuity"
  | "link-profile-backed-continuity";

type IdentityScenarioId =
  | "opted-out-linked-profile"
  | "high-confidence-match-dm"
  | "slack-api-failure-warning";

type RouteScenarioReport = {
  scenarioId: RouteScenarioId;
  description: string;
  responseType: string | null;
  text: string;
  passed: boolean;
  statusCode: string;
  detail?: string;
  missingPhrases: string[];
  unexpectedPhrases: string[];
};

type IdentityScenarioReport = {
  scenarioId: IdentityScenarioId;
  description: string;
  fetchUrls: string[];
  dmText: string | null;
  warningLogged: boolean;
  warningMessages: string[];
  passed: boolean;
  statusCode: string;
  detail?: string;
  missingPhrases: string[];
  unexpectedPhrases: string[];
};

type EvaluationReport = {
  command: "verify:m047:s02";
  generatedAt: string;
  check_ids: readonly string[];
  overallPassed: boolean;
  route: {
    scenarios: RouteScenarioReport[];
  };
  identity: {
    scenarios: IdentityScenarioReport[];
  };
  checks: Check[];
};

type RouteFixture = {
  scenarioId: RouteScenarioId;
  description: string;
  body: string;
  requiredPhrases: readonly string[];
  bannedPhrases: readonly string[];
};

type IdentityFixture = {
  scenarioId: IdentityScenarioId;
  description: string;
  requiredPhrases: readonly string[];
  bannedPhrases: readonly string[];
};

type ProofHarnessModule = {
  M047_S02_CHECK_IDS: readonly string[];
  buildM047S02RouteFixtures: () => RouteFixture[];
  buildM047S02IdentityFixtures: () => IdentityFixture[];
  evaluateM047S02: (opts?: {
    generatedAt?: string;
    _routeFixtures?: RouteFixture[];
    _identityFixtures?: IdentityFixture[];
  }) => Promise<EvaluationReport>;
  renderM047S02Report: (report: EvaluationReport) => string;
  buildM047S02ProofHarness: (opts?: {
    stdout?: { write: (chunk: string) => boolean | void };
    stderr?: { write: (chunk: string) => boolean | void };
    json?: boolean;
    _routeFixtures?: RouteFixture[];
    _identityFixtures?: IdentityFixture[];
  }) => Promise<{ exitCode: number }>;
};

async function loadModule(): Promise<ProofHarnessModule | null> {
  try {
    return await import("./verify-m047-s02.ts") as ProofHarnessModule;
  } catch {
    return null;
  }
}

async function requireModule(): Promise<ProofHarnessModule> {
  const mod = await loadModule();
  expect(mod).toBeTruthy();
  return mod as ProofHarnessModule;
}

describe("evaluateM047S02", () => {
  test("passes the default signed-route and identity-suppression proof matrix", async () => {
    const mod = await requireModule();
    const report = await mod.evaluateM047S02({
      generatedAt: "2026-04-10T00:00:00.000Z",
    });

    expect(report.command).toBe("verify:m047:s02");
    expect(report.generatedAt).toBe("2026-04-10T00:00:00.000Z");
    expect(report.check_ids).toEqual([...mod.M047_S02_CHECK_IDS]);
    expect(report.overallPassed).toBe(true);

    expect(report.route.scenarios.map((scenario) => scenario.scenarioId)).toEqual([
      "link-generic-continuity",
      "profile-opt-in-generic-continuity",
      "link-profile-backed-continuity",
    ]);
    expect(
      report.route.scenarios.find((scenario) => scenario.scenarioId === "link-generic-continuity")?.text,
    ).toContain("Kodiai will keep your reviews generic until your linked profile has current contributor signals.");
    expect(
      report.route.scenarios.find((scenario) => scenario.scenarioId === "profile-opt-in-generic-continuity")?.text,
    ).toContain("Kodiai will keep reviews generic until current contributor signals are available.");
    expect(
      report.route.scenarios.find((scenario) => scenario.scenarioId === "link-profile-backed-continuity")?.text,
    ).toContain("Linked contributor guidance is active for your profile.");

    expect(report.identity.scenarios.map((scenario) => scenario.scenarioId)).toEqual([
      "opted-out-linked-profile",
      "high-confidence-match-dm",
      "slack-api-failure-warning",
    ]);
    expect(
      report.identity.scenarios.find((scenario) => scenario.scenarioId === "opted-out-linked-profile")?.fetchUrls,
    ).toEqual([]);
    expect(
      report.identity.scenarios.find((scenario) => scenario.scenarioId === "high-confidence-match-dm")?.dmText,
    ).toContain("Kodiai can use your linked contributor profile when available.");
    expect(
      report.identity.scenarios.find((scenario) => scenario.scenarioId === "high-confidence-match-dm")?.dmText,
    ).toContain("`/kodiai profile opt-out`");
    expect(
      report.identity.scenarios.find((scenario) => scenario.scenarioId === "slack-api-failure-warning")?.warningLogged,
    ).toBe(true);

    expect(report.checks.map((check) => check.id)).toEqual([...mod.M047_S02_CHECK_IDS]);
    expect(report.checks.every((check) => check.passed)).toBe(true);
  });

  test("renders signed route and identity sections in the human-readable report", async () => {
    const mod = await requireModule();
    const report = await mod.evaluateM047S02({
      generatedAt: "2026-04-10T00:00:00.000Z",
    });

    expect(mod.renderM047S02Report(report)).toContain("Signed slash route:");
    expect(mod.renderM047S02Report(report)).toContain("Identity suggestions:");
    expect(mod.renderM047S02Report(report)).toContain("link-generic-continuity");
    expect(mod.renderM047S02Report(report)).toContain("opted-out-linked-profile");
  });
});

describe("buildM047S02ProofHarness", () => {
  test("emits json output, wires the package script, and exits non-zero when route and identity fixtures drift", async () => {
    const mod = await requireModule();
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["verify:m047:s02"]).toBe("bun scripts/verify-m047-s02.ts");

    const stdout: string[] = [];
    const stderr: string[] = [];

    const { exitCode } = await mod.buildM047S02ProofHarness({
      stdout: { write: (chunk) => void stdout.push(chunk) },
      stderr: { write: (chunk) => void stderr.push(chunk) },
      json: true,
      _routeFixtures: mod.buildM047S02RouteFixtures().map((fixture) =>
        fixture.scenarioId === "profile-opt-in-generic-continuity"
          ? {
              ...fixture,
              requiredPhrases: [...fixture.requiredPhrases, "missing continuity proof phrase"],
            }
          : fixture,
      ),
      _identityFixtures: mod.buildM047S02IdentityFixtures().map((fixture) =>
        fixture.scenarioId === "high-confidence-match-dm"
          ? {
              ...fixture,
              bannedPhrases: [...fixture.bannedPhrases, "linked contributor profile"],
            }
          : fixture,
      ),
    });

    const parsed = JSON.parse(stdout.join("")) as EvaluationReport;
    expect(parsed.command).toBe("verify:m047:s02");
    expect(
      parsed.route.scenarios.find((scenario) => scenario.scenarioId === "profile-opt-in-generic-continuity")
        ?.missingPhrases,
    ).toContain("missing continuity proof phrase");
    expect(
      parsed.identity.scenarios.find((scenario) => scenario.scenarioId === "high-confidence-match-dm")
        ?.unexpectedPhrases,
    ).toContain("linked contributor profile");
    expect(stderr.join("")).toContain(
      "M047-S02-SIGNED-SLASH-CONTINUITY-CONTRACT:signed_slash_continuity_drift",
    );
    expect(stderr.join("")).toContain(
      "M047-S02-IDENTITY-SUGGESTION-CONTRACT:identity_suggestion_contract_drift",
    );
    expect(exitCode).toBe(1);
  });
});
