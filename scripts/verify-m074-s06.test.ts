import { describe, expect, test } from "bun:test";

import fixture from "./fixtures/m074-s06-production-like-proof.json" with { type: "json" };
import {
  COMMAND_NAME,
  DEFAULT_FIXTURE_PATH,
  EXPECTED_PACKAGE_SCRIPT,
  evaluateM074S06Contract,
  evaluateM074S06Evidence,
  main,
  parseM074S06Args,
  type M074S06Args,
  type M074S06EvidenceSnapshot,
} from "./verify-m074-s06.ts";

const VALID_PACKAGE = `{"scripts":{"${COMMAND_NAME}":"${EXPECTED_PACKAGE_SCRIPT}"}}`;
const BASE_ARGS = parseM074S06Args([
  "--fixture",
  DEFAULT_FIXTURE_PATH,
  "--owner",
  "acme",
  "--repo",
  "widgets",
  "--pr",
  "74",
  "--review-output-key",
  "m074-s06-review-output",
  "--delivery-id",
  "delivery-m074-s06",
]);

describe("verify-m074-s06", () => {
  test("parses CLI args and rejects unsafe fixture paths", () => {
    expect(parseM074S06Args([])).toEqual({ json: false, help: false, allowBlocked: false });
    expect(parseM074S06Args(["--json", "--allow-blocked"])).toEqual({ json: true, help: false, allowBlocked: true });
    expect(parseM074S06Args(["--fixture", DEFAULT_FIXTURE_PATH]).fixturePath).toBe(DEFAULT_FIXTURE_PATH);
    expect(parseM074S06Args(["--pr", "74"]).pr).toBe(74);
    expect(() => parseM074S06Args(["--fixture", "../secret.json"])).toThrow(/must not traverse/);
    expect(() => parseM074S06Args(["--fixture", ".gsd/private.json"])).toThrow(/must not read ignored/);
    expect(() => parseM074S06Args(["--pr", "nope"])).toThrow(/positive integer/);
    expect(() => parseM074S06Args(["--bogus"])).toThrow(/invalid_cli_args/);
  });

  test("passes on the checked-in production-like proof fixture", async () => {
    const report = await evaluateM074S06Contract(BASE_ARGS, {
      generatedAt: "2026-05-18T18:45:00.000Z",
      readPackageJsonText: async () => VALID_PACKAGE,
    });

    expect(report).toMatchObject({
      command: "verify:m074:s06",
      generatedAt: "2026-05-18T18:45:00.000Z",
      success: true,
      statusCode: "m074_s06_ok",
      fixturePath: DEFAULT_FIXTURE_PATH,
      failedCheckIds: [],
      observed: {
        sourceAvailable: true,
        target: "acme/widgets#74",
        reviewOutputKeyPresent: true,
        deliveryIdPresent: true,
        samePrSuggestionCount: 1,
        lifecycleStatusCode: "m074_s02_ok",
        fixEligibilityStatusCode: "m074_s03_ok",
        validationTruthStatusCode: "m074_s04_ok",
        reviewDetailsStatusCode: "m074_s05_ok",
      },
    });
    expect(report.checks.map((check) => check.id)).toEqual([
      "fixture.shape",
      "source.available",
      "correlation.exact",
      "same-pr-inline-suggestion.present",
      "lifecycle.rows.passed",
      "fix-eligibility.rows.passed",
      "validation-truth.rows.passed",
      "review-details.validation-truth.passed",
      "validation-truth.not-suggested-only",
      "visible-volume.bounded",
      "side-effects.absent",
      "redaction.safe",
      "package-wiring.present",
    ]);
    expect(JSON.stringify(report).length).toBeLessThan(10_000);
    for (const forbidden of [
      "RAW_PROMPT_CANARY",
      "RAW_MODEL_OUTPUT_CANARY",
      "CANDIDATE_BODY_CANARY",
      "TOOL_PAYLOAD_CANARY",
      "RAW_PAYLOAD_CANARY",
      "REPLACEMENT_CANARY",
      "SECRET_TOKEN_CANARY",
      "DIFF_TEXT_CANARY",
      "PRIVATE_CANDIDATE_BODY",
      "diff --git",
      "sk-supersecret12345",
    ]) {
      expect(JSON.stringify(report)).not.toContain(forbidden);
    }
  });

  test("fails closed on missing or stale reviewOutputKey and deliveryId", () => {
    const stale = mutateFixture({ reviewOutputKey: "stale-key", deliveryId: "stale-delivery" });
    const evaluation = evaluateM074S06Evidence(stale, BASE_ARGS, true);

    expect(failedIds(evaluation)).toContain("correlation.exact");
    expect(evaluation.checks.find((check) => check.id === "correlation.exact")?.issues).toEqual(expect.arrayContaining([
      "reviewOutputKey missing or does not match expected value.",
      "deliveryId missing or does not match expected value.",
    ]));
  });

  test("fails closed when same-PR suggestion evidence is absent", () => {
    const missingSuggestion = mutateFixture({
      samePrInlineSuggestion: {
        ...fixture.samePrInlineSuggestion,
        attempted: false,
        publishedOnSamePr: false,
        suggestionCount: 0,
      },
    });
    const evaluation = evaluateM074S06Evidence(missingSuggestion, BASE_ARGS, true);

    expect(failedIds(evaluation)).toContain("same-pr-inline-suggestion.present");
  });

  test("fails closed when validation truth resolves suggested-only fixes", () => {
    const falseResolution = mutateFixture({
      validationTruth: {
        ...fixture.validationTruth,
        suggestedOnlyResolvedCount: 1,
      },
    });
    const evaluation = evaluateM074S06Evidence(falseResolution, BASE_ARGS, true);

    expect(failedIds(evaluation)).toContain("validation-truth.not-suggested-only");
  });

  test("accepts truthful open validation state from production-like handler evidence", () => {
    const openValidation = mutateFixture({
      validationTruth: {
        ...fixture.validationTruth,
        freshRevalidationResolvedCount: 0,
      },
      gates: {
        ...fixture.gates,
        validationTruth: {
          ...fixture.gates.validationTruth,
          counts: {
            ...fixture.gates.validationTruth.counts,
            resolved: 0,
            open: fixture.gates.validationTruth.counts.open + 1,
          },
        },
      },
    });

    const evaluation = evaluateM074S06Evidence(openValidation, BASE_ARGS, true);

    expect(failedIds(evaluation)).not.toContain("validation-truth.not-suggested-only");
  });

  test("fails closed on duplicate or expanded visible output", () => {
    const expanded = mutateFixture({
      reviewDetails: {
        ...fixture.reviewDetails,
        validationTruthLineCount: 2,
        addedLines: 2,
      },
      visibleVolume: {
        ...fixture.visibleVolume,
        publicCommentCount: 3,
        reviewDetailsValidationTruthLineCount: 2,
      },
    });
    const evaluation = evaluateM074S06Evidence(expanded, BASE_ARGS, true);

    expect(failedIds(evaluation)).toEqual(expect.arrayContaining(["review-details.validation-truth.passed", "visible-volume.bounded"]));
  });

  test("fails closed on raw payload canaries without echoing canary values", async () => {
    const leaky = mutateFixture({
      redaction: {
        ...fixture.redaction,
        canariesAbsent: false,
      },
      leakedAggregateOnlyForTest: "RAW_PROMPT_CANARY hidden candidate body",
    } as Partial<M074S06EvidenceSnapshot> & { leakedAggregateOnlyForTest: string });
    const report = await evaluateM074S06Contract(BASE_ARGS, {
      generatedAt: "2026-05-18T18:45:00.000Z",
      readPackageJsonText: async () => VALID_PACKAGE,
      source: {
        load: async () => ({ available: true, text: JSON.stringify(leaky), fixturePath: DEFAULT_FIXTURE_PATH }),
      },
    });

    expect(report.success).toBe(false);
    expect(report.statusCode).toBe("m074_s06_contract_failed");
    expect(report.failedCheckIds).toContain("redaction.safe");
    expect(JSON.stringify(report)).not.toContain("RAW_PROMPT_CANARY");
  });

  test("fails closed on forbidden side effects", () => {
    const sideEffecting = mutateFixture({
      sideEffects: {
        ...fixture.sideEffects,
        botBranchCreated: 1,
        directPushCount: 1,
      },
    });
    const evaluation = evaluateM074S06Evidence(sideEffecting, BASE_ARGS, true);

    expect(failedIds(evaluation)).toContain("side-effects.absent");
  });

  test("fails closed on package wiring drift", async () => {
    const report = await evaluateM074S06Contract(BASE_ARGS, {
      generatedAt: "2026-05-18T18:45:00.000Z",
      readPackageJsonText: async () => "{\"scripts\":{}}",
    });

    expect(report.success).toBe(false);
    expect(report.statusCode).toBe("m074_s06_contract_failed");
    expect(report.failedCheckIds).toContain("package-wiring.present");
  });

  test("returns blocked without fixture unless an injected source supplies evidence", async () => {
    const report = await evaluateM074S06Contract(parseM074S06Args([]), {
      generatedAt: "2026-05-18T18:45:00.000Z",
      readPackageJsonText: async () => VALID_PACKAGE,
    });

    expect(report.success).toBe(false);
    expect(report.statusCode).toBe("m074_s06_source_blocked");
    expect(report.failedCheckIds).toContain("source.available");
  });

  test("supports expect-status for negative verification", async () => {
    const args = parseM074S06Args(["--expect-status", "m074_s06_contract_failed"]);
    const exitCode = await main(["--expect-status", "m074_s06_contract_failed"], {
      stdout: { write: () => undefined },
      stderr: { write: () => undefined },
      evaluate: async (received: M074S06Args) => ({
        command: COMMAND_NAME,
        generatedAt: "2026-05-18T18:45:00.000Z",
        success: true,
        statusCode: received.expectStatus ?? args.expectStatus!,
        expectedStatus: received.expectStatus,
        failedCheckIds: ["package-wiring.present"],
        checks: [],
        observed: {
          sourceAvailable: true,
          target: "acme/widgets#74",
          reviewOutputKeyPresent: true,
          deliveryIdPresent: true,
          samePrSuggestionCount: 1,
          lifecycleStatusCode: "ok",
          fixEligibilityStatusCode: "ok",
          validationTruthStatusCode: "ok",
          reviewDetailsStatusCode: "ok",
          visibleVolume: fixture.visibleVolume,
          sideEffects: fixture.sideEffects,
          redaction: { ...fixture.redaction, forbiddenCanariesAbsent: true },
        },
        issues: [],
      }),
    });

    expect(exitCode).toBe(0);
  });

  test("main handles help and invalid CLI without throwing", async () => {
    expect(await main(["--help"], { stdout: { write: () => undefined }, stderr: { write: () => undefined } })).toBe(0);
    expect(await main(["--invalid"], { stdout: { write: () => undefined }, stderr: { write: () => undefined } })).toBe(2);
  });
});

function mutateFixture(overrides: Partial<M074S06EvidenceSnapshot> & Record<string, unknown> = {}): M074S06EvidenceSnapshot {
  return structuredClone({ ...fixture, ...overrides }) as M074S06EvidenceSnapshot;
}

function failedIds(evaluation: ReturnType<typeof evaluateM074S06Evidence>) {
  return evaluation.checks.filter((check) => check.status !== "pass").map((check) => check.id);
}
