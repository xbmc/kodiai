import { describe, expect, test } from "bun:test";

import {
  DEFAULT_FIXTURE_PATH,
  evaluateM073S07Fixture,
  main,
  parseM073S07Args,
} from "./verify-m073-s07.ts";

const S01_PATH = "scripts/fixtures/m073-s01-baseline-scorecard.json";
const S02_PATH = "scripts/fixtures/m073-s02-prompt-budget.json";
const S06_PATH = "scripts/fixtures/m073-s06-live-proof.json";

const S01_FIXTURE_TEXT = await Bun.file(S01_PATH).text();
const S02_FIXTURE_TEXT = await Bun.file(S02_PATH).text();
const S06_FIXTURE_TEXT = await Bun.file(S06_PATH).text();

const PASSING_FIXTURE_OBJECT = {
  generatedAt: "2026-05-18T16:20:00.000Z",
  evidencePaths: {
    s01FixturePath: S01_PATH,
    s02FixturePath: S02_PATH,
    s06FixturePath: S06_PATH,
  },
  remediationScope: {
    sliceId: "S07",
    milestoneId: "M073",
    linkageExpectation: "S02 bounded baselineSource rows must match S01 section ids and bounded counts.",
    dispositionExpectation: "R131 must be explicit and not inferred from token-first evidence.",
  },
  r131Disposition: {
    requirementId: "R131",
    status: "formally-rescoped",
    owner: "specialist-lane-follow-up",
    followUp: "Track private specialist lane ownership in a dedicated follow-up outside M073 token-efficiency validation.",
    rationale: "M073 proves token-budget behavior and safe visible projection, not private specialist lane ownership.",
    nonCompletionWording: "R131 is not complete in M073; it is formally rescoped to a bounded specialist-lane follow-up.",
    m073PublishesSpecialistLaneOutputs: false,
  },
  negativeCoverage: [
    {
      caseId: "mismatched-s01-source-id",
      description: "A S02 baselineSource sourceId that does not match any S01 section row fails linkage.",
      expectedFailedCheckIds: ["s01-s02-linkage.cross-checked"],
    },
    {
      caseId: "source-token-count-mismatch",
      description: "A S02 baselineSource bounded token count that differs from S01 fails linkage.",
      expectedFailedCheckIds: ["s01-s02-linkage.cross-checked"],
    },
    {
      caseId: "missing-r131-owner-follow-up",
      description: "A disposition without owner or follow-up fails explicit disposition.",
      expectedFailedCheckIds: ["r131-disposition.explicit"],
    },
    {
      caseId: "false-r131-completion-wording",
      description: "A disposition that claims R131 is done without bounded specialist evidence fails explicit disposition.",
      expectedFailedCheckIds: ["r131-disposition.explicit"],
    },
    {
      caseId: "unsafe-raw-payload-field",
      description: "A fixture containing raw payload field names or secret-like values fails redaction.",
      expectedFailedCheckIds: ["redaction.safe"],
    },
  ],
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function createReader(overrides: Record<string, string> = {}) {
  const files: Record<string, string> = {
    "inline-s07.json": JSON.stringify(PASSING_FIXTURE_OBJECT),
    [DEFAULT_FIXTURE_PATH]: JSON.stringify(PASSING_FIXTURE_OBJECT),
    [S01_PATH]: S01_FIXTURE_TEXT,
    [S02_PATH]: S02_FIXTURE_TEXT,
    [S06_PATH]: S06_FIXTURE_TEXT,
    ...overrides,
  };
  return async (path: string) => {
    if (!(path in files)) throw new Error(`missing fixture ${path}`);
    return files[path];
  };
}

function mutateS02(mutator: (fixture: any) => void): string {
  const fixture = JSON.parse(S02_FIXTURE_TEXT);
  mutator(fixture);
  return JSON.stringify(fixture);
}

describe("verify-m073-s07", () => {
  test("parses CLI arguments with default fixture and rejects unknown flags", () => {
    expect(parseM073S07Args([])).toEqual({ fixturePath: DEFAULT_FIXTURE_PATH, json: false, help: false });
    expect(parseM073S07Args(["--json"])).toEqual({ fixturePath: DEFAULT_FIXTURE_PATH, json: true, help: false });
    expect(parseM073S07Args(["--fixture", "custom.json", "--json"])).toEqual({ fixturePath: "custom.json", json: true, help: false });
    expect(parseM073S07Args(["--help"])).toEqual({ fixturePath: DEFAULT_FIXTURE_PATH, json: false, help: true });
    expect(() => parseM073S07Args(["--fixture"])).toThrow(/invalid_cli_args/);
    expect(() => parseM073S07Args(["--bogus"])).toThrow(/invalid_cli_args/);
  });

  test("emits a passing compact report for S01/S02 linkage and formal R131 rescope", async () => {
    const report = await evaluateM073S07Fixture("inline-s07.json", {
      generatedAt: "2026-05-18T16:30:00.000Z",
      readFixtureText: createReader(),
    });

    expect(report).toMatchObject({
      command: "verify:m073:s07",
      generatedAt: "2026-05-18T16:30:00.000Z",
      fixturePath: "inline-s07.json",
      overallPassed: true,
      statusCode: "m073_s07_ok",
      failedCheckIds: [],
      observedTotals: {
        s01BaselineRowCount: 8,
        s02SectionCount: 5,
        s02LinkedSectionCount: 3,
        s02NewSectionCount: 2,
        s02BypassedSectionCount: 1,
        matchedLinkCount: 3,
        unmatchedLinkCount: 0,
        s06S02SectionCount: 5,
        negativeCaseCount: 5,
        r131DispositionStatus: "formally-rescoped",
        m073PublishesSpecialistLaneOutputs: false,
      },
    });
    expect(report.checks.map((check) => check.id)).toEqual([
      "fixture.shape",
      "s01-s02-linkage.cross-checked",
      "r131-disposition.explicit",
      "s06-proof-compatible",
      "redaction.safe",
      "negative-cases.covered",
    ]);
  });

  test("fails broken linkage with source id, case, delivery, section, and token mismatches localized", async () => {
    const badSourceIdS02 = mutateS02((fixture) => {
      fixture.promptBudgetEvidence[1].sections[1].baselineSource.sourceId = "normal-full-review:delivery-normal-001:user:missing-section";
    });

    const badSourceIdReport = await evaluateM073S07Fixture("inline-s07.json", {
      generatedAt: "2026-05-18T16:30:00.000Z",
      readFixtureText: createReader({ [S02_PATH]: badSourceIdS02 }),
    });

    expect(badSourceIdReport.overallPassed).toBe(false);
    expect(badSourceIdReport.failedCheckIds).toContain("s01-s02-linkage.cross-checked");
    expect(badSourceIdReport.issues.join("\n")).toContain("sourceId does not match an S01 prompt section row");

    const mismatchedFieldsS02 = mutateS02((fixture) => {
      const source = fixture.promptBudgetEvidence[1].sections[1].baselineSource;
      source.caseId = "wrong-case";
      source.deliveryId = "wrong-delivery";
      source.sectionName = "wrong-section";
      source.baselineEstimatedTokens = 599;
    });

    const mismatchedFieldsReport = await evaluateM073S07Fixture("inline-s07.json", {
      generatedAt: "2026-05-18T16:30:00.000Z",
      readFixtureText: createReader({ [S02_PATH]: mismatchedFieldsS02 }),
    });

    expect(mismatchedFieldsReport.overallPassed).toBe(false);
    expect(mismatchedFieldsReport.failedCheckIds).toContain("s01-s02-linkage.cross-checked");
    const issues = mismatchedFieldsReport.issues.join("\n");
    expect(issues).toContain("caseId must match S02 caseId normal-full-review");
    expect(issues).toContain("sectionName must match S02 sectionName changed-files-summary");
    expect(issues).toContain("deliveryId does not match S01 row");
    expect(issues).toContain("baselineEstimatedTokens does not match S01 row");
  });

  test("fails missing disposition owner and follow-up fields", async () => {
    const fixture = clone(PASSING_FIXTURE_OBJECT);
    delete (fixture as any).r131Disposition.owner;
    delete (fixture as any).r131Disposition.followUp;

    const report = await evaluateM073S07Fixture("inline-s07.json", {
      generatedAt: "2026-05-18T16:30:00.000Z",
      readFixtureText: createReader({ "inline-s07.json": JSON.stringify(fixture) }),
    });

    expect(report.overallPassed).toBe(false);
    expect(report.failedCheckIds).toContain("r131-disposition.explicit");
    expect(report.issues.join("\n")).toContain("r131Disposition.owner is required");
    expect(report.issues.join("\n")).toContain("r131Disposition.followUp is required");
  });

  test("fails false R131 completion wording without bounded specialist aggregate proof", async () => {
    const fixture = clone(PASSING_FIXTURE_OBJECT);
    fixture.r131Disposition.nonCompletionWording = "R131 is complete in M073.";
    fixture.r131Disposition.rationale = "R131 completed through token evidence.";

    const report = await evaluateM073S07Fixture("inline-s07.json", {
      generatedAt: "2026-05-18T16:30:00.000Z",
      readFixtureText: createReader({ "inline-s07.json": JSON.stringify(fixture) }),
    });

    expect(report.overallPassed).toBe(false);
    expect(report.failedCheckIds).toContain("r131-disposition.explicit");
    expect(report.issues.join("\n")).toContain("nonCompletionWording must explicitly say R131 is not complete");
    expect(report.issues.join("\n")).toContain("appears to claim completion without bounded specialist proof");
  });

  test("fails raw leak keys and secret-like values without echoing raw values", async () => {
    const fixture = clone(PASSING_FIXTURE_OBJECT) as any;
    fixture.candidatePayload = "PRIVATE CANDIDATE BODY SHOULD NOT APPEAR";
    fixture.safeContainer = { apiKey: "sk-abc123 SHOULD NOT APPEAR" };

    const report = await evaluateM073S07Fixture("inline-s07.json", {
      generatedAt: "2026-05-18T16:30:00.000Z",
      readFixtureText: createReader({ "inline-s07.json": JSON.stringify(fixture) }),
    });

    const serialized = JSON.stringify(report);
    expect(report.overallPassed).toBe(false);
    expect(report.failedCheckIds).toContain("redaction.safe");
    expect(serialized).toContain("candidatePayload uses a forbidden raw payload field name");
    expect(serialized).toContain("apiKey uses a forbidden raw payload field name");
    expect(serialized).not.toContain("PRIVATE CANDIDATE BODY SHOULD NOT APPEAR");
    expect(serialized).not.toContain("sk-abc123 SHOULD NOT APPEAR");
  });

  test("fails closed for missing declared S06 fixture path with bounded path-specific issues", async () => {
    const fixture = clone(PASSING_FIXTURE_OBJECT);
    fixture.evidencePaths.s06FixturePath = "scripts/fixtures/missing-s06.json";

    const report = await evaluateM073S07Fixture("inline-s07.json", {
      generatedAt: "2026-05-18T16:30:00.000Z",
      readFixtureText: createReader({ "inline-s07.json": JSON.stringify(fixture) }),
    });

    expect(report.overallPassed).toBe(false);
    expect(report.failedCheckIds).toContain("fixture.shape");
    expect(report.failedCheckIds).toContain("s06-proof-compatible");
    expect(report.issues.join("\n")).toContain("S06 fixture path is missing or unreadable: scripts/fixtures/missing-s06.json");
  });

  test("fails invalid primary JSON with invalid-json status and without payload echo", async () => {
    const report = await evaluateM073S07Fixture("bad-s07.json", {
      generatedAt: "2026-05-18T16:30:00.000Z",
      readFixtureText: async () => "{ not-json PRIVATE BODY SHOULD NOT APPEAR }",
    });

    expect(report.overallPassed).toBe(false);
    expect(report.statusCode).toBe("m073_s07_invalid_json");
    expect(report.failedCheckIds).toEqual(["fixture.shape"]);
    expect(JSON.stringify(report)).not.toContain("PRIVATE BODY SHOULD NOT APPEAR");
  });

  test("main emits parseable JSON for pass and invalid CLI", async () => {
    const passingStdout: string[] = [];
    const passExitCode = await main(["--fixture", "inline-s07.json", "--json"], {
      stdout: { write: (chunk: string) => void passingStdout.push(chunk) },
      stderr: { write: () => undefined },
      evaluate: async () => await evaluateM073S07Fixture("inline-s07.json", {
        generatedAt: "2026-05-18T16:30:00.000Z",
        readFixtureText: createReader(),
      }),
    });
    expect(passExitCode).toBe(0);
    expect(JSON.parse(passingStdout.join(""))).toMatchObject({
      command: "verify:m073:s07",
      overallPassed: true,
      observedTotals: { matchedLinkCount: 3, r131DispositionStatus: "formally-rescoped" },
    });

    const invalidArgStdout: string[] = [];
    const invalidArgExitCode = await main(["--bad", "--json"], {
      stdout: { write: (chunk: string) => void invalidArgStdout.push(chunk) },
      stderr: { write: () => undefined },
    });
    expect(invalidArgExitCode).toBe(2);
    expect(JSON.parse(invalidArgStdout.join(""))).toMatchObject({
      command: "verify:m073:s07",
      overallPassed: false,
      statusCode: "m073_s07_invalid_arg",
    });
  });
});
