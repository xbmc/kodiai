import { describe, expect, test } from "bun:test";

import { buildM070FixtureScenario } from "./verify-m070.ts";
import {
  M070_S06_CHECK_IDS,
  M070_S06_STATUS_CODES,
  buildM070S06FixtureSources,
  evaluateM070S06,
  main,
  parseM070S06Args,
  type M070S06SourceSnapshot,
} from "./verify-m070-s06.ts";

const GENERATED_AT = "2026-05-10T00:00:00.000Z";
const TARGET = "xbmc/xbmc#28172";
const REPO = "xbmc/xbmc";
const REVIEW_OUTPUT_KEY = "review-output-28172-abc123";
const DELIVERY_ID = "delivery-28172";
const CORRELATION_KEY = "corr-28172";

function baseSources(): M070S06SourceSnapshot {
  return buildM070S06FixtureSources({
    scenario: "candidate_approved_verified",
    reviewOutputKey: REVIEW_OUTPUT_KEY,
    deliveryId: DELIVERY_ID,
    correlationKey: CORRELATION_KEY,
    repo: REPO,
    target: TARGET,
  });
}

function evaluate(overrides: Partial<Parameters<typeof evaluateM070S06>[0]> = {}) {
  return evaluateM070S06({
    reviewOutputKey: REVIEW_OUTPUT_KEY,
    deliveryId: DELIVERY_ID,
    correlationKey: CORRELATION_KEY,
    repo: REPO,
    target: TARGET,
    sources: baseSources(),
    readPackageJsonText: async () => JSON.stringify({ scripts: { "verify:m070:s06": "bun scripts/verify-m070-s06.ts" } }),
    generatedAt: GENERATED_AT,
    ...overrides,
  });
}

describe("verify-m070-s06 exact-key wrapper", () => {
  test("exports stable status/check constants and parses bounded operator args", () => {
    expect(M070_S06_CHECK_IDS).toEqual([
      "M070-S06-CLI-ARGS",
      "M070-S06-SOURCE-AVAILABILITY",
      "M070-S06-EXACT-KEY-ARTIFACTS",
      "M070-S06-S04-EVALUATOR-STATUS",
      "M070-S06-RUNTIME-CORRELATION",
      "M070-S06-REDACTION-BOUNDARY",
      "M070-S06-PACKAGE-WIRING",
    ]);
    expect(M070_S06_STATUS_CODES).toContain("m070_s06_candidate_approved_verified_ok");
    expect(M070_S06_STATUS_CODES).toContain("m070_s06_missing_exact_key_blocked");
    expect(M070_S06_STATUS_CODES).toContain("m070_s06_package_wiring_drift");
    expect(parseM070S06Args([
      "--json",
      "--review-output-key",
      REVIEW_OUTPUT_KEY,
      "--delivery-id",
      DELIVERY_ID,
      "--repo",
      REPO,
      "--correlation-key",
      CORRELATION_KEY,
      "--target",
      TARGET,
      "--expect-status",
      "m070_s06_candidate_approved_verified_ok",
      "--allow-blocked",
    ])).toMatchObject({ json: true, reviewOutputKey: REVIEW_OUTPUT_KEY, deliveryId: DELIVERY_ID, repo: REPO, correlationKey: CORRELATION_KEY, target: TARGET, allowBlocked: true });
    expect(() => parseM070S06Args(["--review-output-key"])).toThrow(/invalid_cli_args/);
    expect(() => parseM070S06Args(["--expect-status", "wrong"])).toThrow(/invalid_cli_args/);
  });

  test("accepts exact-key verified candidate-approved non-fallback S04 success", async () => {
    const report = await evaluate();

    expect(report).toMatchObject({
      command: "verify:m070:s06",
      generated_at: GENERATED_AT,
      proofMode: "exact-key-live-or-production-like-wrapper",
      success: true,
      status_code: "m070_s06_candidate_approved_verified_ok",
      failing_check_id: null,
      inputs: { repo: REPO, target: TARGET, reviewOutputKeyPresent: true, deliveryIdPresent: true, correlationKeyPresent: true },
      sourceAvailability: { githubReviewDetailsAvailable: true, githubAccessPresent: true, githubUnavailable: false },
      artifactCounts: { matchingReviewDetails: 1, totalReviewDetails: 1, duplicateReviewDetails: 0, wrongKeyReviewDetails: 0 },
      s04: { status_code: "m070_candidate_approved_verified_ok", success: true },
      runtimeCorrelation: { correlationKeyPresent: true, runtimeLogRowsAvailable: true, matchingRuntimeRows: 1 },
      publicationMode: { candidateApprovedNonFallback: true, directFallbackEvidence: false },
    });
    expect(report.check_ids).toEqual(M070_S06_CHECK_IDS);
    expect(report.checks.every((check) => check.passed)).toBe(true);
    expect(report.issues).toEqual([]);
  });

  test("accepts exact-key undisputed partial S04 success", async () => {
    const report = await evaluate({ sources: buildM070S06FixtureSources({ scenario: "candidate_approved_partial_undisputed", reviewOutputKey: REVIEW_OUTPUT_KEY, deliveryId: DELIVERY_ID, correlationKey: CORRELATION_KEY, repo: REPO, target: TARGET }) });

    expect(report.success).toBe(true);
    expect(report.status_code).toBe("m070_s06_candidate_approved_partial_ok");
    expect(report.s04.status_code).toBe("m070_candidate_approved_partial_ok");
  });

  test("reports missing exact key and malformed key as bounded blocked states", async () => {
    const missing = await evaluate({ reviewOutputKey: null });
    expect(missing.success).toBe(false);
    expect(missing.status_code).toBe("m070_s06_missing_exact_key_blocked");
    expect(missing.failing_check_id).toBe("M070-S06-CLI-ARGS");

    const malformed = await evaluate({ reviewOutputKey: "../.gsd/private key" });
    expect(malformed.success).toBe(false);
    expect(malformed.status_code).toBe("m070_s06_invalid_or_stale_key_blocked");
    expect(JSON.stringify(malformed)).not.toContain("private key content");
  });

  test("distinguishes blocked GitHub source and artifact mismatch states", async () => {
    const noAccess = await evaluate({ sources: { ...baseSources(), github: { ...baseSources().github, accessPresent: false } } });
    expect(noAccess.success).toBe(false);
    expect(noAccess.status_code).toBe("m070_s06_missing_github_access_blocked");

    const unavailable = await evaluate({ sources: { ...baseSources(), github: { ...baseSources().github, unavailable: true } } });
    expect(unavailable.status_code).toBe("m070_s06_github_unavailable_blocked");

    const noArtifact = await evaluate({ sources: { ...baseSources(), reviewDetails: [] } });
    expect(noArtifact.status_code).toBe("m070_s06_no_artifact_blocked");

    const duplicate = await evaluate({ sources: { ...baseSources(), reviewDetails: [...baseSources().reviewDetails, ...baseSources().reviewDetails] } });
    expect(duplicate.status_code).toBe("m070_s06_duplicate_artifact_blocked");

    const wrong = await evaluate({ reviewOutputKey: "review-output-28172-missing", sources: baseSources() });
    expect(wrong.status_code).toBe("m070_s06_wrong_artifact_blocked");
  });

  test("maps direct fallback, missing correlation, malformed aggregate, redaction canaries, and package drift without raw leaks", async () => {
    const directFallback = await evaluate({ sources: buildM070S06FixtureSources({ scenario: "direct_fallback_only", reviewOutputKey: REVIEW_OUTPUT_KEY, deliveryId: DELIVERY_ID, correlationKey: CORRELATION_KEY, repo: REPO, target: TARGET }) });
    expect(directFallback.success).toBe(false);
    expect(directFallback.status_code).toBe("m070_s06_direct_fallback_rejected");

    const missingCorrelation = await evaluate({ correlationKey: null });
    expect(missingCorrelation.status_code).toBe("m070_s06_missing_runtime_correlation_blocked");
    expect(missingCorrelation.runtimeCorrelation.correlationKeyPresent).toBe(false);

    const malformedAggregate = await evaluate({ sources: { ...baseSources(), reviewDetails: [{ ...baseSources().reviewDetails[0]!, aggregateEvidence: { aggregateStatus: "wrong-status", counts: null } }] } });
    expect(malformedAggregate.status_code).toBe("m070_s06_malformed_aggregate_blocked");

    const redactionCanarySources = baseSources();
    const redaction = await evaluate({ sources: { ...redactionCanarySources, reviewDetails: [{
      ...redactionCanarySources.reviewDetails[0]!,
      aggregateEvidence: {
        ...buildM070FixtureScenario("candidate_approved_verified").aggregateEvidence as object,
        rawCandidateBody: "M070_S06_RAW_CANDIDATE_SHOULD_NOT_LEAK",
        specialistProse: "M070_S06_SPECIALIST_SHOULD_NOT_LEAK",
        prompt: "M070_S06_PROMPT_SHOULD_NOT_LEAK",
        diff: "M070_S06_DIFF_SHOULD_NOT_LEAK",
        fingerprint: "M070_S06_FINGERPRINT_SHOULD_NOT_LEAK",
        evidencePayload: "M070_S06_PAYLOAD_SHOULD_NOT_LEAK",
      },
    }] } });
    const serialized = JSON.stringify(redaction);
    expect(redaction.status_code).toBe("m070_s06_redaction_violation");
    expect(redaction.redaction.forbiddenInputFieldPresent).toBe(true);
    for (const canary of ["RAW_CANDIDATE", "SPECIALIST", "PROMPT", "DIFF", "FINGERPRINT", "PAYLOAD"]) {
      expect(serialized).not.toContain(`M070_S06_${canary}_SHOULD_NOT_LEAK`);
    }

    const drift = await evaluate({ readPackageJsonText: async () => JSON.stringify({ scripts: { "verify:m070:s06": "bun wrong.ts" } }) });
    expect(drift.success).toBe(false);
    expect(drift.status_code).toBe("m070_s06_package_wiring_drift");
    expect(drift.failing_check_id).toBe("M070-S06-PACKAGE-WIRING");
  });

  test("main emits parseable JSON; expect-status and allow-blocked control blocked exits", async () => {
    const okStdout: string[] = [];
    const okExit = await main(["--json", "--review-output-key", REVIEW_OUTPUT_KEY, "--delivery-id", DELIVERY_ID, "--correlation-key", CORRELATION_KEY, "--repo", REPO, "--target", TARGET], {
      stdout: { write: (chunk: string) => void okStdout.push(chunk) },
      stderr: { write: () => undefined },
      collectSources: async () => baseSources(),
      readPackageJsonText: async () => JSON.stringify({ scripts: { "verify:m070:s06": "bun scripts/verify-m070-s06.ts" } }),
      generatedAt: GENERATED_AT,
    });
    expect(okExit).toBe(0);
    expect(JSON.parse(okStdout.join(""))).toMatchObject({ success: true, status_code: "m070_s06_candidate_approved_verified_ok" });

    const blockedStdout: string[] = [];
    const blockedExit = await main(["--json", "--review-output-key", REVIEW_OUTPUT_KEY, "--expect-status", "m070_s06_missing_runtime_correlation_blocked"], {
      stdout: { write: (chunk: string) => void blockedStdout.push(chunk) },
      stderr: { write: () => undefined },
      collectSources: async () => baseSources(),
      readPackageJsonText: async () => JSON.stringify({ scripts: { "verify:m070:s06": "bun scripts/verify-m070-s06.ts" } }),
      generatedAt: GENERATED_AT,
    });
    expect(blockedExit).toBe(0);
    expect(JSON.parse(blockedStdout.join("")).status_code).toBe("m070_s06_missing_runtime_correlation_blocked");

    const defaultBlockedStdout: string[] = [];
    const defaultBlockedExit = await main(["--json", "--review-output-key", REVIEW_OUTPUT_KEY], {
      stdout: { write: (chunk: string) => void defaultBlockedStdout.push(chunk) },
      stderr: { write: () => undefined },
      collectSources: async () => baseSources(),
      readPackageJsonText: async () => JSON.stringify({ scripts: { "verify:m070:s06": "bun scripts/verify-m070-s06.ts" } }),
      generatedAt: GENERATED_AT,
    });
    expect(defaultBlockedExit).toBe(1);

    const allowBlockedStdout: string[] = [];
    const allowBlockedExit = await main(["--json", "--review-output-key", REVIEW_OUTPUT_KEY, "--allow-blocked"], {
      stdout: { write: (chunk: string) => void allowBlockedStdout.push(chunk) },
      stderr: { write: () => undefined },
      collectSources: async () => baseSources(),
      readPackageJsonText: async () => JSON.stringify({ scripts: { "verify:m070:s06": "bun scripts/verify-m070-s06.ts" } }),
      generatedAt: GENERATED_AT,
    });
    expect(allowBlockedExit).toBe(0);

    const invalidStdout: string[] = [];
    const invalidExit = await main(["--bad"], { stdout: { write: (chunk: string) => void invalidStdout.push(chunk) }, stderr: { write: () => undefined }, generatedAt: GENERATED_AT });
    expect(invalidExit).toBe(2);
    expect(JSON.parse(invalidStdout.join(""))).toMatchObject({ success: false, status_code: "m070_s06_invalid_arg" });
  });
});
