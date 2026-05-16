import { describe, expect, test } from "bun:test";

import { buildM070FixtureScenario } from "./verify-m070.ts";
import { buildApprovedReviewBody } from "../src/handlers/review-idempotency.ts";
import {
  DEFAULT_TARGET,
  EXPECTED_PACKAGE_SCRIPT,
  M070_S06_CHECK_IDS,
  M070_S06_STATUS_CODES,
  buildM070S06FixtureSources,
  collectM070S06Sources,
  evaluateM070S06,
  extractM070AggregateEvidenceFromArtifactBody,
  main,
  parseM070S06Args,
  type M070S06SourceSnapshot,
} from "./verify-m070-s06.ts";
import type { ReviewOutputArtifactCollection } from "../src/review-audit/review-output-artifacts.ts";

const GENERATED_AT = "2026-05-10T00:00:00.000Z";
const TARGET = "xbmc/xbmc#28172";
const REPO = "xbmc/xbmc";
const REVIEW_OUTPUT_KEY = "kodiai-review-output:v1:inst-123:xbmc/xbmc:pr-28172:action-review:delivery-delivery-28172:head-abcdef";
const DELIVERY_ID = "delivery-28172";
const CORRELATION_KEY = "corr-28172";

function m070EvidenceLine(correlationKey = CORRELATION_KEY): string {
  return [
    "- M070 candidate verification publication: status=mixed",
    "counts=attempted:1,allowed:1,denied:0,published:1,skipped:0,failed:0",
    "verification=verified:1,partially_verified:0,unverified:0,disproven:0,unavailable:0",
    "candidateVerification=candidateCount:1,evidenceCount:1,verifiedCount:1,partiallyVerifiedCount:0,unverifiedCount:0,disprovenCount:0,publicationEligibleCount:1",
    "denialCounts=none",
    "reasons=full-support",
    `metadata=deliveryId:y,reviewOutputKey:y,correlationKey:y,deliveryIdValue:${DELIVERY_ID},reviewOutputKeyValue:${REVIEW_OUTPUT_KEY},correlationKeyValue:${correlationKey}`,
    "redaction=privateOnly:y,candidateBodies:n,specialistProse:n,rawPrompts:n,rawModelOutput:n,diffs:n,evidencePayloads:n,rawFingerprints:n,publicationEvidence:n,unsafeFields:0",
  ].join("; ");
}

function approvedReviewBody(extra = ""): string {
  return buildApprovedReviewBody({
    reviewOutputKey: REVIEW_OUTPUT_KEY,
    evidence: ["candidate-approved non-fallback proof"],
    reviewDetailsBlock: [
      "<details>",
      "<summary>Review Details</summary>",
      m070EvidenceLine(),
      extra,
      "</details>",
    ].filter(Boolean).join("\n"),
  });
}

function fakeCollection(overrides: Partial<Record<string, unknown>> = {}): ReviewOutputArtifactCollection {
  return {
    requestedReviewOutputKey: REVIEW_OUTPUT_KEY,
    prUrl: "https://github.com/xbmc/xbmc/pull/28172",
    artifactCounts: { reviewComments: 0, issueComments: 0, reviews: 1, total: 1 },
    artifacts: [{
      prNumber: 28172,
      prUrl: "https://github.com/xbmc/xbmc/pull/28172",
      source: "review",
      sourceUrl: "https://github.com/xbmc/xbmc/pull/28172#pullrequestreview-1",
      updatedAt: "2026-05-10T00:00:00Z",
      reviewOutputKey: REVIEW_OUTPUT_KEY,
      lane: null,
      action: "review",
      body: approvedReviewBody(),
      reviewState: "APPROVED",
      ...overrides,
    }],
  } as never;
}

function fakeArtifact() {
  return fakeCollection().artifacts[0]!;
}

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
    readPackageJsonText: async () => JSON.stringify({ scripts: { "verify:m070:s06": EXPECTED_PACKAGE_SCRIPT } }),
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

  test("package script is pinned to the S06 verifier command", async () => {
    const packageJson = await Bun.file(new URL("../package.json", import.meta.url)).json() as { scripts?: Record<string, string> };
    expect(packageJson.scripts?.["verify:m070:s06"]).toBe(EXPECTED_PACKAGE_SCRIPT);
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
      m070: { status_code: "m070_candidate_approved_verified_ok", success: true },
      correlationMetadata: { reviewOutputKeyPresent: true, deliveryIdPresent: true, correlationKeyPresent: true, runtimeLogRowsAvailable: true, matchingRuntimeRows: 1 },
      runtimeCorrelation: { correlationKeyPresent: true, runtimeLogRowsAvailable: true, matchingRuntimeRows: 1 },
      packageWiring: { scriptName: "verify:m070:s06", expected: EXPECTED_PACKAGE_SCRIPT, present: true, matches: true },
      publicationMode: { candidateApprovedNonFallback: true, directFallbackEvidence: false },
    });
    expect(Object.keys(report)).toEqual(expect.arrayContaining([
      "command",
      "proofMode",
      "proofScope",
      "success",
      "status_code",
      "check_ids",
      "checks",
      "failing_check_id",
      "m070",
      "sourceAvailability",
      "artifactCounts",
      "correlationMetadata",
      "redaction",
      "issue_categories",
      "issues",
    ]));
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

    const wrong = await evaluate({ reviewOutputKey: "kodiai-review-output:v1:inst-123:xbmc/xbmc:pr-28172:action-review:delivery-delivery-28172:head-fedcba", sources: baseSources() });
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
    expect(drift.packageWiring).toMatchObject({ present: true, matches: false });

    const malformedPackage = await evaluate({ readPackageJsonText: async () => "{not json" });
    expect(malformedPackage.success).toBe(false);
    expect(malformedPackage.status_code).toBe("m070_s06_package_wiring_drift");
    expect(malformedPackage.failing_check_id).toBe("M070-S06-PACKAGE-WIRING");
    expect(malformedPackage.packageWiring).toMatchObject({ present: false, matches: false });
    expect(JSON.stringify(malformedPackage)).not.toContain("{not json");
  });

  test("extracts bounded aggregate evidence from Review Details without leaking raw body canaries", () => {
    const body = approvedReviewBody("M070_S06_BODY_CANARY_SHOULD_NOT_LEAK");
    const aggregate = extractM070AggregateEvidenceFromArtifactBody(body);
    expect(aggregate).toMatchObject({
      aggregateStatus: "mixed",
      counts: { attempted: 1, allowed: 1, denied: 0, published: 1 },
      metadata: { hasDeliveryId: true, hasReviewOutputKey: true, hasCorrelationKey: true, correlationKey: CORRELATION_KEY },
    });
    expect(JSON.stringify(aggregate)).not.toContain("M070_S06_BODY_CANARY_SHOULD_NOT_LEAK");
  });

  test("collects GitHub artifacts through injected production-like seam and discards raw bodies", async () => {
    const sources = await collectM070S06Sources(parseM070S06Args(["--review-output-key", REVIEW_OUTPUT_KEY, "--repo", REPO, "--target", TARGET]), {
      env: { GITHUB_APP_ID: "123", GITHUB_PRIVATE_KEY: "-----BEGIN TEST KEY-----" },
      createInstallationOctokit: async (parsed) => {
        expect(parsed).toMatchObject({ owner: "xbmc", repo: "xbmc", prNumber: 28172, effectiveDeliveryId: DELIVERY_ID });
        return {} as never;
      },
      collectReviewOutputArtifacts: async () => fakeCollection(),
      queryRuntimeLogs: async () => ({ unavailable: false, rows: [] }),
    });
    const report = await evaluate({ correlationKey: null, sources });
    expect(report.status_code).toBe("m070_s06_candidate_approved_verified_ok");
    expect(report.runtimeCorrelation.correlationKeyPresent).toBe(true);
    expect(JSON.stringify(report)).not.toContain("candidate-approved non-fallback proof");
  });

  test("collector reports missing GitHub credentials and GitHub collection failures as bounded blocked states", async () => {
    const missing = await collectM070S06Sources(parseM070S06Args(["--review-output-key", REVIEW_OUTPUT_KEY]), { env: {} });
    expect(missing.github).toMatchObject({ accessPresent: false, unavailable: false });
    expect((await evaluate({ sources: missing })).status_code).toBe("m070_s06_missing_github_access_blocked");

    const unavailable = await collectM070S06Sources(parseM070S06Args(["--review-output-key", REVIEW_OUTPUT_KEY]), {
      env: { GITHUB_APP_ID: "123", GITHUB_PRIVATE_KEY_BASE64: "dGVzdA==" },
      createInstallationOctokit: async () => { throw new Error("M070_S06_SECRET_CANARY_SHOULD_NOT_LEAK unavailable"); },
      queryRuntimeLogs: async () => ({ unavailable: false, rows: [] }),
    });
    const report = await evaluate({ sources: unavailable });
    expect(report.status_code).toBe("m070_s06_github_unavailable_blocked");
    expect(JSON.stringify(report)).not.toContain("M070_S06_SECRET_CANARY_SHOULD_NOT_LEAK");
  });

  test("collector maps no artifacts, duplicate artifacts, wrong source, and wrong review state to blocked policy surfaces", async () => {
    const args = parseM070S06Args(["--review-output-key", REVIEW_OUTPUT_KEY, "--correlation-key", CORRELATION_KEY]);
    const deps = (collection: ReviewOutputArtifactCollection) => ({
      env: { GITHUB_APP_ID: "123", GITHUB_PRIVATE_KEY: "-----BEGIN TEST KEY-----" },
      createInstallationOctokit: async () => ({} as never),
      collectReviewOutputArtifacts: async () => collection,
      queryRuntimeLogs: async () => ({ unavailable: false, rows: [{ id: "runtime", reviewOutputKey: REVIEW_OUTPUT_KEY, deliveryId: DELIVERY_ID, correlationKey: CORRELATION_KEY, available: true }] }),
    });

    const noArtifacts = await evaluate({ sources: await collectM070S06Sources(args, deps({ ...fakeCollection(), artifactCounts: { reviewComments: 0, issueComments: 0, reviews: 0, total: 0 }, artifacts: [] })) });
    expect(noArtifacts.status_code).toBe("m070_s06_no_artifact_blocked");

    const duplicate = await evaluate({ sources: await collectM070S06Sources(args, deps({ ...fakeCollection(), artifactCounts: { reviewComments: 0, issueComments: 0, reviews: 2, total: 2 }, artifacts: [fakeArtifact(), { ...fakeArtifact(), sourceUrl: "https://github.com/xbmc/xbmc/pull/28172#pullrequestreview-2" }] })) });
    expect(duplicate.status_code).toBe("m070_s06_duplicate_artifact_blocked");

    const wrongSource = await evaluate({ sources: await collectM070S06Sources(args, deps({ ...fakeCollection(), artifactCounts: { reviewComments: 0, issueComments: 1, reviews: 0, total: 1 }, artifacts: [{ ...fakeArtifact(), source: "issue-comment", reviewState: null }] })) });
    expect(wrongSource.status_code).toBe("m070_s06_direct_fallback_rejected");

    const wrongState = await evaluate({ sources: await collectM070S06Sources(args, deps(fakeCollection({ reviewState: "COMMENTED" }))) });
    expect(wrongState.status_code).toBe("m070_s06_malformed_aggregate_blocked");
  });

  test("distinguishes stale key input, optional Azure unavailable, runtime row present, and runtime row missing", async () => {
    const staleDelivery = await evaluate({ deliveryId: "different-delivery" });
    expect(staleDelivery.status_code).toBe("m070_s06_invalid_or_stale_key_blocked");

    const azureUnavailable = await evaluate({ sources: { ...baseSources(), runtime: { queried: true, unavailable: true, rows: [] } } });
    expect(azureUnavailable.status_code).toBe("m070_s06_candidate_approved_verified_ok");
    expect(azureUnavailable.sourceAvailability.runtimeUnavailable).toBe(true);

    const runtimePresent = await evaluate({ sources: { ...baseSources(), runtime: { queried: true, unavailable: false, rows: [{ id: "runtime", reviewOutputKey: REVIEW_OUTPUT_KEY, deliveryId: DELIVERY_ID, correlationKey: CORRELATION_KEY, available: true }] } } });
    expect(runtimePresent.status_code).toBe("m070_s06_candidate_approved_verified_ok");
    expect(runtimePresent.runtimeCorrelation.matchingRuntimeRows).toBe(1);

    const runtimeMissing = await evaluate({ sources: { ...baseSources(), runtime: { queried: true, unavailable: false, rows: [] } } });
    expect(runtimeMissing.status_code).toBe("m070_s06_missing_runtime_correlation_blocked");
  });

  test("help text documents operator args, default target, env key names, and blocked semantics", async () => {
    const stdout: string[] = [];
    const exitCode = await main(["--help"], { stdout: { write: (chunk: string) => void stdout.push(chunk) }, stderr: { write: () => undefined } });
    const help = stdout.join("");

    expect(exitCode).toBe(0);
    expect(help).toContain("--review-output-key <key>");
    expect(help).toContain("--delivery-id <id>");
    expect(help).toContain("--correlation-key <key>");
    expect(help).toContain("--expect-status <status>");
    expect(help).toContain(DEFAULT_TARGET);
    expect(help).toContain("GITHUB_APP_ID");
    expect(help).toContain("GITHUB_PRIVATE_KEY_BASE64");
    expect(help).toContain("AZURE_LOG_ANALYTICS_WORKSPACE_ID");
    expect(help).toContain("ACA_RESOURCE_GROUP");
    expect(help).toContain("success:false");
    expect(help).toContain("m070_s06_missing_exact_key_blocked");
    expect(help).toContain("m070_s06_direct_fallback_rejected");
  });

  test("main emits parseable JSON; expect-status and allow-blocked control blocked exits", async () => {
    const okStdout: string[] = [];
    const okExit = await main(["--json", "--review-output-key", REVIEW_OUTPUT_KEY, "--delivery-id", DELIVERY_ID, "--correlation-key", CORRELATION_KEY, "--repo", REPO, "--target", TARGET], {
      stdout: { write: (chunk: string) => void okStdout.push(chunk) },
      stderr: { write: () => undefined },
      collectSources: async () => baseSources(),
      readPackageJsonText: async () => JSON.stringify({ scripts: { "verify:m070:s06": EXPECTED_PACKAGE_SCRIPT } }),
      generatedAt: GENERATED_AT,
    });
    expect(okExit).toBe(0);
    expect(JSON.parse(okStdout.join(""))).toMatchObject({ success: true, status_code: "m070_s06_candidate_approved_verified_ok" });

    const blockedStdout: string[] = [];
    const blockedExit = await main(["--json", "--review-output-key", REVIEW_OUTPUT_KEY, "--expect-status", "m070_s06_missing_runtime_correlation_blocked"], {
      stdout: { write: (chunk: string) => void blockedStdout.push(chunk) },
      stderr: { write: () => undefined },
      collectSources: async () => baseSources(),
      readPackageJsonText: async () => JSON.stringify({ scripts: { "verify:m070:s06": EXPECTED_PACKAGE_SCRIPT } }),
      generatedAt: GENERATED_AT,
    });
    expect(blockedExit).toBe(0);
    expect(JSON.parse(blockedStdout.join("")).status_code).toBe("m070_s06_missing_runtime_correlation_blocked");

    const defaultBlockedStdout: string[] = [];
    const defaultBlockedExit = await main(["--json", "--review-output-key", REVIEW_OUTPUT_KEY], {
      stdout: { write: (chunk: string) => void defaultBlockedStdout.push(chunk) },
      stderr: { write: () => undefined },
      collectSources: async () => baseSources(),
      readPackageJsonText: async () => JSON.stringify({ scripts: { "verify:m070:s06": EXPECTED_PACKAGE_SCRIPT } }),
      generatedAt: GENERATED_AT,
    });
    expect(defaultBlockedExit).toBe(1);

    const allowBlockedStdout: string[] = [];
    const allowBlockedExit = await main(["--json", "--review-output-key", REVIEW_OUTPUT_KEY, "--allow-blocked"], {
      stdout: { write: (chunk: string) => void allowBlockedStdout.push(chunk) },
      stderr: { write: () => undefined },
      collectSources: async () => baseSources(),
      readPackageJsonText: async () => JSON.stringify({ scripts: { "verify:m070:s06": EXPECTED_PACKAGE_SCRIPT } }),
      generatedAt: GENERATED_AT,
    });
    expect(allowBlockedExit).toBe(0);

    const invalidStdout: string[] = [];
    const invalidExit = await main(["--bad"], { stdout: { write: (chunk: string) => void invalidStdout.push(chunk) }, stderr: { write: () => undefined }, generatedAt: GENERATED_AT });
    expect(invalidExit).toBe(2);
    expect(JSON.parse(invalidStdout.join(""))).toMatchObject({ success: false, status_code: "m070_s06_invalid_arg" });
  });
});
