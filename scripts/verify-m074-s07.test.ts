import { describe, expect, test } from "bun:test";

import fixture from "./fixtures/m074-s07-repo-doctrine-proof.json" with { type: "json" };
import {
  COMMAND_NAME,
  DEFAULT_FIXTURE_PATH,
  EXPECTED_PACKAGE_SCRIPT,
  evaluateM074S07Contract,
  evaluateM074S07Evidence,
  main,
  parseM074S07Args,
  type M074S07EvidenceSnapshot,
  type M074S07SourceTexts,
} from "./verify-m074-s07.ts";

const VALID_PACKAGE = `{"scripts":{"${COMMAND_NAME}":"${EXPECTED_PACKAGE_SCRIPT}"}}`;
const BASE_ARGS = parseM074S07Args(["--fixture", DEFAULT_FIXTURE_PATH]);
const SOURCE_TEXTS: M074S07SourceTexts = {
  config: "repoDoctrineSchema sanitizeParsedDoctrine review.doctrine using default disabled doctrine",
  contracts: "REPO_DOCTRINE_CONTRACT_TYPES normalizeRepoDoctrineProjection redaction-applied maxContracts",
  reviewPlan: "RepoDoctrinePlanProjection repoDoctrine: normalizeRepoDoctrinePlan doctrine=${formatRepoDoctrinePlan",
  prompt: "buildRepoDoctrinePromptSection Only aggregate contract metadata repoDoctrineSection",
  reducer: "normalizeRepoDoctrineReducerProjection(input.repoDoctrine) doctrine=${formatRepoDoctrineReducerProjection toReviewReducerDetailsSummary detailsSummary doctrine=",
  handler: "normalizeRepoDoctrineProjection(config.review.doctrine Resolved bounded repository doctrine projection gate: \"repo-doctrine\" buildRepoDoctrineLogFields repoDoctrine: repoDoctrineReviewSurface",
};

describe("verify-m074-s07", () => {
  test("parses CLI args and rejects unsafe fixture paths", () => {
    expect(parseM074S07Args([])).toEqual({ json: false, help: false });
    expect(parseM074S07Args(["--json"])).toEqual({ json: true, help: false });
    expect(parseM074S07Args(["--fixture", DEFAULT_FIXTURE_PATH]).fixturePath).toBe(DEFAULT_FIXTURE_PATH);
    expect(() => parseM074S07Args(["--fixture", "../secret.json"])).toThrow(/must not traverse/);
    expect(() => parseM074S07Args(["--fixture", ".gsd/private.json"])).toThrow(/must not read ignored/);
    expect(() => parseM074S07Args(["--fixture", "scripts/not-json.txt"])).toThrow(/must be a JSON file/);
    expect(() => parseM074S07Args(["--bogus"])).toThrow(/invalid_cli_args/);
  });

  test("passes on checked-in repo doctrine proof fixture with compact aggregate output", async () => {
    const report = await evaluateM074S07Contract(BASE_ARGS, {
      generatedAt: "2026-05-18T19:20:00.000Z",
      readPackageJsonText: async () => VALID_PACKAGE,
      readSourceTexts: async () => SOURCE_TEXTS,
    });

    expect(report).toMatchObject({
      command: "verify:m074:s07",
      generatedAt: "2026-05-18T19:20:00.000Z",
      success: true,
      statusCode: "m074_s07_ok",
      fixturePath: DEFAULT_FIXTURE_PATH,
      failedCheckIds: [],
      observed: {
        sourceAvailable: true,
        contractCount: 7,
        consumedContractCount: 7,
        matchedPathCandidateCount: 3,
        typeCoverageCount: 7,
        expectedTypeCount: 7,
        redactionPass: true,
      },
    });
    expect(report.checks.map((check) => check.id)).toEqual([
      "fixture.shape",
      "source.available",
      "config.schema.supported",
      "contract-types.covered",
      "review-plan.consumed",
      "prompt.consumed",
      "reducer.consumed",
      "review-details.aggregate",
      "handler.correlation",
      "redaction.safe",
      "caps.enforced",
      "side-effects.absent",
      "package-wiring.present",
    ]);
    expect(JSON.stringify(report).length).toBeLessThan(10_000);
    for (const forbidden of [
      "RAW_DOCTRINE_CANARY",
      "RAW_PROMPT_CANARY",
      "RAW_MODEL_OUTPUT_CANARY",
      "TOOL_PAYLOAD_CANARY",
      "SECRET_TOKEN_CANARY",
      "DIFF_TEXT_CANARY",
      "PRIVATE_DOCTRINE_TEXT",
      "diff --git",
      "sk-supersecret12345",
    ]) {
      expect(JSON.stringify(report)).not.toContain(forbidden);
    }
  });

  test("fails closed on config-only evidence without ReviewPlan consumption", () => {
    const configOnly = mutateFixture({
      reviewPlan: { ...fixture.reviewPlan, consumed: false, status: "skipped", reasonCodes: ["unconsumed-contract"] },
    });

    const evaluation = evaluateM074S07Evidence(configOnly, { packageWiringPresent: true, sourceTexts: SOURCE_TEXTS });

    expect(failedIds(evaluation)).toContain("review-plan.consumed");
  });

  test("fails closed without reducer or prompt consumption", () => {
    const noConsumption = mutateFixture({
      prompt: { ...fixture.prompt, consumed: false, boundedContractLines: 0, reasonCodes: ["unconsumed-contract"] },
      reducer: { ...fixture.reducer, consumed: false, detailsSummaryContainsDoctrine: false, reasonCodes: ["unconsumed-contract"] },
    });

    const evaluation = evaluateM074S07Evidence(noConsumption, { packageWiringPresent: true, sourceTexts: SOURCE_TEXTS });

    expect(failedIds(evaluation)).toEqual(expect.arrayContaining(["prompt.consumed", "reducer.consumed"]));
  });

  test("fails closed when Review Details leaks raw doctrine or omits aggregate correlation", () => {
    const leakyDetails = mutateFixture({
      reviewDetails: {
        ...fixture.reviewDetails,
        aggregateOnly: false,
        correlationPresent: false,
        rawDoctrineTextIncluded: true,
      },
      redaction: { ...fixture.redaction, rawDoctrineTextIncluded: true, canariesAbsent: false },
    });

    const evaluation = evaluateM074S07Evidence(leakyDetails, { packageWiringPresent: true, sourceTexts: SOURCE_TEXTS });

    expect(failedIds(evaluation)).toEqual(expect.arrayContaining(["review-details.aggregate", "redaction.safe"]));
  });

  test("fails closed when a contract type is missing", () => {
    const missingType = mutateFixture({
      doctrine: {
        ...fixture.doctrine,
        contractTypes: fixture.doctrine.contractTypes.filter((type) => type !== "docs-update"),
      },
    });

    const evaluation = evaluateM074S07Evidence(missingType, { packageWiringPresent: true, sourceTexts: SOURCE_TEXTS });

    expect(failedIds(evaluation)).toContain("contract-types.covered");
  });

  test("fails closed on over-cap contract, prompt, reason-code, and Review Details output", () => {
    const overCap = mutateFixture({
      doctrine: {
        ...fixture.doctrine,
        contractCount: 26,
        maxContracts: 26,
        maxPromptContracts: 9,
        maxReasonCodes: 26,
        reasonCodes: Array.from({ length: 26 }, () => "bounded"),
      },
      prompt: { ...fixture.prompt, boundedContractLines: 9 },
      reviewDetails: { ...fixture.reviewDetails, statusLineCount: 5, maxStatusLineCount: 4 },
    });

    const evaluation = evaluateM074S07Evidence(overCap, { packageWiringPresent: true, sourceTexts: SOURCE_TEXTS });

    expect(failedIds(evaluation)).toContain("caps.enforced");
  });

  test("fails closed on side-effect counters", () => {
    const sideEffecting = mutateFixture({
      sideEffects: { ...fixture.sideEffects, botBranchCreated: 1, directPushCount: 1, publicCommentCreated: 1 },
    });

    const evaluation = evaluateM074S07Evidence(sideEffecting, { packageWiringPresent: true, sourceTexts: SOURCE_TEXTS });

    expect(failedIds(evaluation)).toContain("side-effects.absent");
  });

  test("fails closed on malformed fixture and invalid JSON", async () => {
    const malformed = evaluateM074S07Evidence({ schema: "wrong" }, { packageWiringPresent: true, sourceTexts: SOURCE_TEXTS });
    expect(failedIds(malformed)).toContain("fixture.shape");

    const invalidJson = await evaluateM074S07Contract(BASE_ARGS, {
      generatedAt: "2026-05-18T19:20:00.000Z",
      readPackageJsonText: async () => VALID_PACKAGE,
      readSourceTexts: async () => SOURCE_TEXTS,
      source: { load: async () => ({ available: true, text: "{not-json", fixturePath: DEFAULT_FIXTURE_PATH }) },
    });
    expect(invalidJson.success).toBe(false);
    expect(invalidJson.statusCode).toBe("m074_s07_invalid_json");
  });

  test("fails closed on raw canary values without echoing canary text", async () => {
    const leaky = mutateFixture({
      redaction: { ...fixture.redaction, canariesAbsent: false },
      leakedAggregateForTest: "RAW_DOCTRINE_CANARY PRIVATE_DOCTRINE_TEXT diff --git sk-supersecret12345",
    } as Partial<M074S07EvidenceSnapshot> & { leakedAggregateForTest: string });

    const report = await evaluateM074S07Contract(BASE_ARGS, {
      generatedAt: "2026-05-18T19:20:00.000Z",
      readPackageJsonText: async () => VALID_PACKAGE,
      readSourceTexts: async () => SOURCE_TEXTS,
      source: { load: async () => ({ available: true, text: JSON.stringify(leaky), fixturePath: DEFAULT_FIXTURE_PATH }) },
    });

    expect(report.success).toBe(false);
    expect(report.statusCode).toBe("m074_s07_contract_failed");
    expect(report.failedCheckIds).toContain("redaction.safe");
    expect(JSON.stringify(report)).not.toContain("RAW_DOCTRINE_CANARY");
    expect(JSON.stringify(report)).not.toContain("PRIVATE_DOCTRINE_TEXT");
  });

  test("fails closed when source probes show config support but no downstream consumption", () => {
    const sourceTexts = { ...SOURCE_TEXTS, reviewPlan: "", prompt: "", reducer: "", handler: "" };
    const evaluation = evaluateM074S07Evidence(fixture as M074S07EvidenceSnapshot, { packageWiringPresent: true, sourceTexts });

    expect(failedIds(evaluation)).toEqual(expect.arrayContaining([
      "review-plan.consumed",
      "prompt.consumed",
      "reducer.consumed",
      "review-details.aggregate",
      "handler.correlation",
    ]));
  });

  test("fails closed on package wiring drift", async () => {
    const report = await evaluateM074S07Contract(BASE_ARGS, {
      generatedAt: "2026-05-18T19:20:00.000Z",
      readPackageJsonText: async () => "{\"scripts\":{}}",
      readSourceTexts: async () => SOURCE_TEXTS,
    });

    expect(report.success).toBe(false);
    expect(report.statusCode).toBe("m074_s07_contract_failed");
    expect(report.failedCheckIds).toContain("package-wiring.present");
  });

  test("supports expect-status for negative verification and handles help/invalid CLI", async () => {
    const exitCode = await main(["--expect-status", "m074_s07_contract_failed"], {
      stdout: { write: () => undefined },
      stderr: { write: () => undefined },
      evaluate: async (received) => ({
        command: COMMAND_NAME,
        generatedAt: "2026-05-18T19:20:00.000Z",
        success: true,
        statusCode: received.expectStatus ?? "m074_s07_contract_failed",
        expectedStatus: received.expectStatus,
        failedCheckIds: ["package-wiring.present"],
        checks: [],
        observed: {
          sourceAvailable: true,
          statusCounts: { applied: 6 },
          contractCount: 7,
          consumedContractCount: 7,
          matchedPathCandidateCount: 3,
          omittedCount: 0,
          typeCoverageCount: 7,
          expectedTypeCount: 7,
          reasonCodes: ["none"],
          sideEffects: fixture.sideEffects,
          redactionPass: true,
        },
        issues: [],
      }),
    });

    expect(exitCode).toBe(0);
    expect(await main(["--help"], { stdout: { write: () => undefined }, stderr: { write: () => undefined } })).toBe(0);
    expect(await main(["--invalid"], { stdout: { write: () => undefined }, stderr: { write: () => undefined } })).toBe(2);
  });
});

function mutateFixture(overrides: Record<string, unknown> = {}): M074S07EvidenceSnapshot {
  return structuredClone({ ...fixture, ...overrides }) as M074S07EvidenceSnapshot;
}

function failedIds(evaluation: ReturnType<typeof evaluateM074S07Evidence>) {
  return evaluation.checks.filter((check) => check.status !== "pass").map((check) => check.id);
}
