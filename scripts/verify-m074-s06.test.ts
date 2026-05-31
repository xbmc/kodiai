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
import { buildApprovedReviewBody, buildReviewOutputKey } from "../src/review-orchestration/review-idempotency.ts";

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

const LIVE_REVIEW_OUTPUT_KEY = buildReviewOutputKey({
  installationId: 42,
  owner: "acme",
  repo: "widgets",
  prNumber: 74,
  action: "mention-review",
  deliveryId: "delivery-live-s06",
  headSha: "abc123",
});
const LIVE_ARGS = parseM074S06Args([
  "--owner",
  "acme",
  "--repo",
  "widgets",
  "--pr",
  "74",
  "--review-output-key",
  LIVE_REVIEW_OUTPUT_KEY,
  "--delivery-id",
  "delivery-live-s06",
]);

function liveCollection(overrides: Partial<{ total: number; source: "review" | "issue-comment" | "review-comment"; reviewState: string | null; body: string | null }> = {}) {
  const total = overrides.total ?? 1;
  const artifact = {
    prNumber: 74,
    prUrl: "https://github.com/acme/widgets/pull/74",
    source: overrides.source ?? "review",
    sourceUrl: "https://github.com/acme/widgets/pull/74#pullrequestreview-1",
    updatedAt: "2026-05-18T18:45:00Z",
    reviewOutputKey: LIVE_REVIEW_OUTPUT_KEY,
    lane: "explicit",
    action: "mention-review",
    body: overrides.body ?? buildApprovedReviewBody({ reviewOutputKey: LIVE_REVIEW_OUTPUT_KEY }),
    reviewState: overrides.reviewState ?? "APPROVED",
  } as const;
  return {
    requestedReviewOutputKey: LIVE_REVIEW_OUTPUT_KEY,
    prUrl: "https://github.com/acme/widgets/pull/74",
    artifactCounts: {
      reviewComments: overrides.source === "review-comment" ? total : 0,
      issueComments: overrides.source === "issue-comment" ? total : 0,
      reviews: overrides.source === "review" || !overrides.source ? total : 0,
      total,
    },
    artifacts: Array.from({ length: total }, () => artifact),
  };
}

const LIVE_RUNTIME_ROW = {
  timeGenerated: "2026-05-18T18:45:00Z",
  rawLog: JSON.stringify({ reviewOutputKey: LIVE_REVIEW_OUTPUT_KEY, deliveryId: "delivery-live-s06", msg: "review-validation-truth" }),
  malformed: false,
  deliveryId: "delivery-live-s06",
  reviewOutputKey: LIVE_REVIEW_OUTPUT_KEY,
  message: "review-validation-truth",
  revisionName: "kodiai--live",
  containerAppName: "kodiai",
  parsedLog: { reviewOutputKey: LIVE_REVIEW_OUTPUT_KEY, deliveryId: "delivery-live-s06", msg: "review-validation-truth" },
};

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
    expect(report.statusCode).toBe("m074_s06_live_source_blocked");
    expect(report.failedCheckIds).toContain("correlation.exact");
  });


  test("matches injected live exact-key GitHub artifacts and runtime correlation without exposing raw bodies", async () => {
    const rawCanary = "RAW_PROMPT_CANARY diff --git SECRET_TOKEN_CANARY";
    const report = await evaluateM074S06Contract(LIVE_ARGS, {
      generatedAt: "2026-05-18T18:45:00.000Z",
      readPackageJsonText: async () => VALID_PACKAGE,
      liveCollectors: {
        collectGithubArtifacts: async () => ({ availability: "matched", collection: liveCollection({ body: `${buildApprovedReviewBody({ reviewOutputKey: LIVE_REVIEW_OUTPUT_KEY })}\n${rawCanary}` }) }),
        queryRuntimeLogs: async () => ({ availability: "matched", rows: [LIVE_RUNTIME_ROW], workspaceCount: 1 }),
      },
    });

    expect(report.success).toBe(true);
    expect(report.statusCode).toBe("m074_s06_ok");
    expect(report.observed.liveSource).toBe("matched");
    expect(report.observed.liveGithubArtifactCounts).toMatchObject({ reviews: 1, total: 1 });
    expect(report.observed.liveRuntimeCorrelation).toMatchObject({ matchedRows: 1, malformedRows: 0, missingCorrelationRows: 0, workspaceCount: 1, queried: true });
    expect(JSON.stringify(report)).not.toContain(rawCanary);
    expect(JSON.stringify(report)).not.toContain("diff --git");
  });

  test("reports live-source blocked when credentials and injected collectors are absent", async () => {
    const report = await evaluateM074S06Contract(LIVE_ARGS, {
      generatedAt: "2026-05-18T18:45:00.000Z",
      readPackageJsonText: async () => VALID_PACKAGE,
      liveCollectors: {},
    });

    expect(report.success).toBe(false);
    expect(report.statusCode).toBe("m074_s06_live_source_blocked");
    expect(report.observed.liveSource).toBe("blocked");
    expect(report.failedCheckIds).toContain("source.available");
  });

  test("supports allow-blocked expect-status for live-source blocked diagnostics", async () => {
    const report = await evaluateM074S06Contract({ ...LIVE_ARGS, allowBlocked: true, expectStatus: "m074_s06_live_source_blocked" }, {
      generatedAt: "2026-05-18T18:45:00.000Z",
      readPackageJsonText: async () => VALID_PACKAGE,
      liveCollectors: {},
    });

    expect(report.success).toBe(true);
    expect(report.statusCode).toBe("m074_s06_live_source_blocked");
  });

  test("reports live-source unavailable when configured collectors fail", async () => {
    const report = await evaluateM074S06Contract(LIVE_ARGS, {
      generatedAt: "2026-05-18T18:45:00.000Z",
      readPackageJsonText: async () => VALID_PACKAGE,
      liveCollectors: {
        collectGithubArtifacts: async () => ({ availability: "unavailable", reason: "github timeout" }),
        queryRuntimeLogs: async () => ({ availability: "matched", rows: [LIVE_RUNTIME_ROW], workspaceCount: 1 }),
      },
    });

    expect(report.success).toBe(false);
    expect(report.statusCode).toBe("m074_s06_live_source_unavailable");
    expect(report.observed.liveSource).toBe("unavailable");
    expect(report.issues.join("\n")).toContain("github timeout");
  });

  test("fails live exact-key proof on duplicate, wrong, or stale artifacts", async () => {
    for (const collection of [
      liveCollection({ total: 2 }),
      liveCollection({ source: "issue-comment" }),
      liveCollection({ reviewState: "COMMENTED" }),
    ]) {
      const report = await evaluateM074S06Contract(LIVE_ARGS, {
        generatedAt: "2026-05-18T18:45:00.000Z",
        readPackageJsonText: async () => VALID_PACKAGE,
        liveCollectors: {
          collectGithubArtifacts: async () => ({ availability: "matched", collection }),
          queryRuntimeLogs: async () => ({ availability: "matched", rows: [LIVE_RUNTIME_ROW], workspaceCount: 1 }),
        },
      });

      expect(report.success).toBe(false);
      expect(report.statusCode).toBe("m074_s06_live_exact_key_failed");
      expect(report.failedCheckIds).toContain("visible-volume.bounded");
    }
  });

  test("fails live mode when runtime correlation is missing or malformed", async () => {
    const report = await evaluateM074S06Contract(LIVE_ARGS, {
      generatedAt: "2026-05-18T18:45:00.000Z",
      readPackageJsonText: async () => VALID_PACKAGE,
      liveCollectors: {
        collectGithubArtifacts: async () => ({ availability: "matched", collection: liveCollection() }),
        queryRuntimeLogs: async () => ({
          availability: "matched",
          workspaceCount: 1,
          rows: [{ ...LIVE_RUNTIME_ROW, deliveryId: "wrong", rawLog: "not-json", malformed: true }],
        }),
      },
    });

    expect(report.success).toBe(false);
    expect(report.statusCode).toBe("m074_s06_live_runtime_correlation_missing");
    expect(report.observed.liveRuntimeCorrelation).toMatchObject({ matchedRows: 0, malformedRows: 1, missingCorrelationRows: 1 });
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
          liveSource: "not-requested",
          target: "acme/widgets#74",
          reviewOutputKeyPresent: true,
          deliveryIdPresent: true,
          samePrSuggestionCount: 1,
          liveGithubArtifactCounts: { reviewComments: 0, issueComments: 0, reviews: 0, total: 0, capped: false },
          liveRuntimeCorrelation: { matchedRows: 0, malformedRows: 0, missingCorrelationRows: 0, workspaceCount: 0, queried: false },
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
