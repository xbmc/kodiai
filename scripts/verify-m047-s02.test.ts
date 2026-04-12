import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

type ScenarioId =
  | "linked-unscored"
  | "legacy"
  | "stale"
  | "calibrated"
  | "malformed"
  | "opt-out";

type Check = {
  id: string;
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail?: string;
};

type TextSurfaceReport = {
  passed: boolean;
  statusCode: string;
  detail?: string;
  text: string;
  missingPhrases: string[];
  unexpectedPhrases: string[];
};

type RetrievalSurfaceReport = {
  passed: boolean;
  statusCode: string;
  detail?: string;
  query: string;
  missingPhrases: string[];
  unexpectedPhrases: string[];
};

type IdentitySurfaceReport = {
  passed: boolean;
  statusCode: string;
  detail?: string;
  fetchUrls: string[];
  dmText: string | null;
  warningLogged: boolean;
  warningMessages: string[];
  missingPhrases: string[];
  unexpectedPhrases: string[];
};

type ScenarioReport = {
  scenarioId: ScenarioId;
  description: string;
  trustState: string | null;
  contractState: string | null;
  contractSource: string | null;
  fallbackPath: string | null;
  degradationPath: string | null;
  profile: TextSurfaceReport;
  linkContinuity: TextSurfaceReport | null;
  optInContinuity: TextSurfaceReport;
  retrievalMultiQuery: RetrievalSurfaceReport;
  retrievalLegacyQuery: RetrievalSurfaceReport;
  identitySuppression: IdentitySurfaceReport | null;
};

type EmbeddedS01Report = {
  command: "verify:m047:s01";
  overallPassed: boolean;
  scenarios: Array<{ scenarioId: string }>;
  checks: Array<{ id: string; passed: boolean; skipped: boolean; status_code: string }>;
};

type EvaluationReport = {
  command: "verify:m047:s02";
  generatedAt: string;
  check_ids: readonly string[];
  overallPassed: boolean;
  storedProfileRuntime: EmbeddedS01Report | null;
  scenarios: ScenarioReport[];
  checks: Check[];
};

type ScenarioFixture = {
  scenarioId: ScenarioId;
  description: string;
  profile: {
    requiredPhrases: readonly string[];
    bannedPhrases: readonly string[];
  };
  linkContinuity: {
    requiredPhrases: readonly string[];
    bannedPhrases: readonly string[];
  } | null;
  optInContinuity: {
    requiredPhrases: readonly string[];
    bannedPhrases: readonly string[];
  };
  retrieval: {
    requiredMultiQueryPhrases: readonly string[];
    bannedMultiQueryPhrases: readonly string[];
    requiredLegacyPhrases: readonly string[];
    bannedLegacyPhrases: readonly string[];
  };
  identitySuppression?: {
    requiredPhrases: readonly string[];
    bannedPhrases: readonly string[];
  } | null;
};

type ProofHarnessModule = {
  M047_S02_SCENARIO_IDS: readonly ScenarioId[];
  M047_S02_CHECK_IDS: readonly string[];
  buildM047S02ScenarioFixtures: () => ScenarioFixture[];
  evaluateM047S02: (opts?: {
    generatedAt?: string;
    _evaluateS01?: () => Promise<unknown>;
    _scenarioFixtures?: ScenarioFixture[];
  }) => Promise<EvaluationReport>;
  renderM047S02Report: (report: EvaluationReport) => string;
  buildM047S02ProofHarness: (opts?: {
    stdout?: { write: (chunk: string) => boolean | void };
    stderr?: { write: (chunk: string) => boolean | void };
    json?: boolean;
    _evaluateS01?: () => Promise<unknown>;
    _scenarioFixtures?: ScenarioFixture[];
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

describe("buildM047S02ScenarioFixtures", () => {
  test("defines the stored-profile state matrix with explicit local expectations for Slack, continuity, retrieval, and opt-out suppression", async () => {
    const mod = await requireModule();
    const fixtures = mod.buildM047S02ScenarioFixtures();

    expect(fixtures.map((fixture) => fixture.scenarioId)).toEqual([
      ...mod.M047_S02_SCENARIO_IDS,
    ]);
    expect(fixtures.find((fixture) => fixture.scenarioId === "calibrated")?.retrieval.requiredMultiQueryPhrases).toContain(
      "author: established contributor",
    );
    expect(fixtures.find((fixture) => fixture.scenarioId === "legacy")?.retrieval.requiredMultiQueryPhrases).toContain(
      "author: returning contributor",
    );
    expect(fixtures.find((fixture) => fixture.scenarioId === "opt-out")?.identitySuppression).not.toBeNull();
    expect(fixtures.find((fixture) => fixture.scenarioId === "opt-out")?.linkContinuity).toBeNull();
  });
});

describe("evaluateM047S02", () => {
  test("composes the M047 S01 runtime truth report with stored-profile Slack, continuity, retrieval, and opt-out suppression surfaces", async () => {
    const mod = await requireModule();
    const report = await mod.evaluateM047S02({
      generatedAt: "2026-04-10T00:00:00.000Z",
    });

    expect(report.command).toBe("verify:m047:s02");
    expect(report.generatedAt).toBe("2026-04-10T00:00:00.000Z");
    expect(report.check_ids).toEqual([...mod.M047_S02_CHECK_IDS]);
    expect(report.overallPassed).toBe(true);
    expect(report.storedProfileRuntime?.command).toBe("verify:m047:s01");
    expect(report.storedProfileRuntime?.overallPassed).toBe(true);

    expect(report.scenarios.map((scenario) => scenario.scenarioId)).toEqual([
      "linked-unscored",
      "legacy",
      "stale",
      "calibrated",
      "malformed",
      "opt-out",
    ]);

    const linkedUnscored = report.scenarios.find((scenario) => scenario.scenarioId === "linked-unscored");
    expect(linkedUnscored).toMatchObject({
      trustState: "linked-unscored",
      contractState: "coarse-fallback",
      contractSource: "github-search",
      fallbackPath: "stored-profile-linked-unscored->github-search",
    });
    expect(linkedUnscored?.profile.text).toContain(
      "Kodiai does not have a reliable contributor signal for this profile yet, so reviews stay generic.",
    );
    expect(linkedUnscored?.linkContinuity?.text).toContain(
      "Kodiai will keep your reviews generic until your linked profile has current contributor signals.",
    );
    expect(linkedUnscored?.optInContinuity.text).toContain(
      "Kodiai will keep reviews generic until current contributor signals are available.",
    );
    expect(linkedUnscored?.retrievalMultiQuery.query).toContain("author: returning contributor");
    expect(linkedUnscored?.retrievalLegacyQuery.query).toContain("Author: returning contributor");

    const legacy = report.scenarios.find((scenario) => scenario.scenarioId === "legacy");
    expect(legacy).toMatchObject({
      trustState: "legacy",
      contractState: "coarse-fallback",
      contractSource: "author-cache",
      fallbackPath: "stored-profile-legacy->author-cache",
    });
    expect(legacy?.retrievalMultiQuery.query).toContain("author: returning contributor");

    const stale = report.scenarios.find((scenario) => scenario.scenarioId === "stale");
    expect(stale).toMatchObject({
      trustState: "stale",
      contractState: "generic-degraded",
      contractSource: "github-search",
      fallbackPath: "stored-profile-stale->generic-degraded",
      degradationPath: "search-api-rate-limit",
    });
    expect(stale?.retrievalMultiQuery.query).not.toContain("author:");
    expect(stale?.retrievalLegacyQuery.query).not.toContain("Author:");

    const calibrated = report.scenarios.find((scenario) => scenario.scenarioId === "calibrated");
    expect(calibrated).toMatchObject({
      trustState: "calibrated",
      contractState: "profile-backed",
      contractSource: "contributor-profile",
      fallbackPath: "trusted-stored-profile",
    });
    expect(calibrated?.profile.text).toContain("Status: Linked contributor guidance is active.");
    expect(calibrated?.profile.text).toContain("language/typescript: 0.90");
    expect(calibrated?.linkContinuity?.text).toContain(
      "Linked contributor guidance is active for your profile.",
    );
    expect(calibrated?.optInContinuity.text).toContain(
      "Contributor-specific guidance is now on for your linked profile.",
    );
    expect(calibrated?.retrievalMultiQuery.query).toContain("author: established contributor");
    expect(calibrated?.retrievalLegacyQuery.query).toContain("Author: established contributor");

    const malformed = report.scenarios.find((scenario) => scenario.scenarioId === "malformed");
    expect(malformed).toMatchObject({
      trustState: "malformed",
      contractState: "coarse-fallback",
      contractSource: "github-search",
      fallbackPath: "stored-profile-malformed->github-search",
    });
    expect(malformed?.profile.text).toContain(
      "Kodiai does not have a reliable contributor signal for this profile yet, so reviews stay generic.",
    );
    expect(malformed?.retrievalMultiQuery.query).toContain("author: returning contributor");
    expect(malformed?.retrievalLegacyQuery.query).toContain("Author: returning contributor");

    const optOut = report.scenarios.find((scenario) => scenario.scenarioId === "opt-out");
    expect(optOut).toMatchObject({
      trustState: "calibrated",
      contractState: "generic-opt-out",
      contractSource: "contributor-profile",
      fallbackPath: "opted-out-stored-profile",
    });
    expect(optOut?.profile.text).toContain(
      "You opted out of contributor-specific guidance. Kodiai will keep reviews generic until you opt back in.",
    );
    expect(optOut?.optInContinuity.text).toContain(
      "Contributor-specific guidance is now on for your linked profile.",
    );
    expect(optOut?.retrievalMultiQuery.query).not.toContain("author:");
    expect(optOut?.retrievalLegacyQuery.query).not.toContain("Author:");
    expect(optOut?.identitySuppression?.fetchUrls).toEqual([]);
    expect(optOut?.identitySuppression?.dmText).toBeNull();
    expect(optOut?.identitySuppression?.warningLogged).toBe(false);

    expect(report.checks.map((check) => check.id)).toEqual([...mod.M047_S02_CHECK_IDS]);
    expect(report.checks.every((check) => check.passed)).toBe(true);
  });

  test("fails with named prerequisite and scenario diagnostics when the embedded S01 report drifts or a stored-profile expectation is missing", async () => {
    const mod = await requireModule();
    const report = await mod.evaluateM047S02({
      _evaluateS01: async () => ({
        command: "verify:m047:s01",
        check_ids: [],
        checks: [],
        scenarios: [],
      }),
      _scenarioFixtures: mod.buildM047S02ScenarioFixtures().map((fixture) =>
        fixture.scenarioId === "malformed"
          ? {
              ...fixture,
              retrieval: {
                ...fixture.retrieval,
                requiredMultiQueryPhrases: [
                  ...fixture.retrieval.requiredMultiQueryPhrases,
                  "missing malformed retrieval proof",
                ],
              },
            }
          : fixture,
      ),
    });

    expect(report.overallPassed).toBe(false);
    expect(report.storedProfileRuntime).toBeNull();
    expect(
      report.checks.find((check) => check.id === "M047-S02-S01-REPORT-COMPOSED")?.status_code,
    ).toBe("embedded_s01_report_drift");
    expect(
      report.checks.find((check) => check.id === "M047-S02-RETRIEVAL-MULTI-QUERY-CONTRACT")?.status_code,
    ).toBe("retrieval_multi_query_contract_drift");
    expect(
      report.scenarios.find((scenario) => scenario.scenarioId === "malformed")?.retrievalMultiQuery.missingPhrases,
    ).toContain("missing malformed retrieval proof");
  });

  test("renders the embedded S01, stored-profile scenario, retrieval, and identity sections in the human-readable report", async () => {
    const mod = await requireModule();
    const report = await mod.evaluateM047S02({
      generatedAt: "2026-04-10T00:00:00.000Z",
    });

    const rendered = mod.renderM047S02Report(report);
    expect(rendered).toContain("Embedded S01 runtime truth:");
    expect(rendered).toContain("Stored-profile scenarios:");
    expect(rendered).toContain("linked-unscored");
    expect(rendered).toContain("opt-out");
    expect(rendered).toContain("retrieval-multi-query");
    expect(rendered).toContain("identity=pass");
  });
});

describe("buildM047S02ProofHarness", () => {
  test("emits json output, keeps the package script wired, and exits non-zero when prerequisite or scenario checks drift", async () => {
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
      _evaluateS01: async () => ({
        command: "verify:m047:s01",
        check_ids: [],
        checks: [],
        scenarios: [],
      }),
      _scenarioFixtures: mod.buildM047S02ScenarioFixtures().map((fixture) =>
        fixture.scenarioId === "calibrated"
          ? {
              ...fixture,
              profile: {
                ...fixture.profile,
                requiredPhrases: [...fixture.profile.requiredPhrases, "missing profile proof phrase"],
              },
            }
          : fixture,
      ),
    });

    const parsed = JSON.parse(stdout.join("")) as EvaluationReport;
    expect(parsed.command).toBe("verify:m047:s02");
    expect(
      parsed.scenarios.find((scenario) => scenario.scenarioId === "calibrated")?.profile.missingPhrases,
    ).toContain("missing profile proof phrase");
    expect(stderr.join("")).toContain(
      "M047-S02-S01-REPORT-COMPOSED:embedded_s01_report_drift",
    );
    expect(stderr.join("")).toContain(
      "M047-S02-SLACK-PROFILE-CONTRACT:slack_profile_contract_drift",
    );
    expect(exitCode).toBe(1);
  });
});
