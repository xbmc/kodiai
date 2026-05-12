import { describe, expect, test } from "bun:test";

import {
  COMMAND_NAME,
  EXPECTED_PACKAGE_SCRIPT,
  M069_S05_CHECK_IDS,
  buildBlockedM069S05Evidence,
  buildSyntheticPassingM069S05Evidence,
  collectM069S05LiveEvidence,
  evaluateM069S05Proof,
  main,
  parseM069S05Args,
  type M069S05Evidence,
} from "./verify-m069-s05.ts";

function cloneEvidence(overrides: Partial<M069S05Evidence> = {}): M069S05Evidence {
  const base = buildSyntheticPassingM069S05Evidence();
  return {
    ...base,
    ...overrides,
    sourceAvailability: { ...base.sourceAvailability, ...overrides.sourceAvailability },
    reviewDetails: overrides.reviewDetails === null
      ? null
      : { ...base.reviewDetails!, ...(overrides.reviewDetails ?? {}) },
    runtimeLog: overrides.runtimeLog === null
      ? null
      : { ...base.runtimeLog!, ...(overrides.runtimeLog ?? {}) },
    visiblePublication: overrides.visiblePublication === null
      ? null
      : { ...base.visiblePublication!, ...(overrides.visiblePublication ?? {}) },
  };
}

function evaluate(evidence: M069S05Evidence = buildSyntheticPassingM069S05Evidence()) {
  return evaluateM069S05Proof({ generatedAt: "2026-05-11T00:00:00.000Z", evidence });
}

const LIVE_REVIEW_OUTPUT_KEY = "kodiai-review-output:v1:inst-123:xbmc/xbmc:pr-28172:action-synchronize:delivery-delivery-123:head-abcdef";
const LIVE_DELIVERY_ID = "delivery-123";
const LIVE_CORRELATION_KEY = "correlation-123";

function liveReviewDetailsBody(extra = ""): string {
  return [
    "<details>",
    "<summary>Review Details</summary>",
    `<!-- kodiai:review-details:${LIVE_REVIEW_OUTPUT_KEY} -->`,
    `shadow-specialist lane=docs-config-truth status=ok candidateCount=4 decisionCount=4 duplicateCount=1 disagreementCount=1 metricAvailability=token:y,cost:y,latency:y visiblePublicationDenied=true approvalPublicationDenied=true correlationKey=${LIVE_CORRELATION_KEY} deliveryId=${LIVE_DELIVERY_ID} reviewOutputKey=${LIVE_REVIEW_OUTPUT_KEY} redacted=raw:y,publication:y,approval:y,unsafe:0`,
    extra,
    "</details>",
  ].join("\n");
}

describe("verify-m069-s05", () => {
  test("exports stable check ids and parses only bounded CLI flags", () => {
    expect(M069_S05_CHECK_IDS).toEqual([
      "M069-S05-LIVE-SOURCE-AVAILABILITY",
      "M069-S05-EXACT-TARGET",
      "M069-S05-REVIEW-DETAILS-EVIDENCE",
      "M069-S05-LOG-CORRELATION-EVIDENCE",
      "M069-S05-TRIGGERED-SPECIALIST",
      "M069-S05-COUNT-METRIC-BOUNDS",
      "M069-S05-REDACTION-PUBLICATION-DENIALS",
      "M069-S05-NO-RAW-PAYLOAD-LEAKAGE",
      "M069-S05-NO-VISIBLE-PUBLICATION",
    ]);
    expect(parseM069S05Args([])).toMatchObject({
      json: false,
      help: false,
      allowBlocked: false,
      owner: "xbmc",
      repo: "xbmc",
      pr: 28172,
      reviewOutputKey: null,
      deliveryId: null,
    });
    expect(parseM069S05Args(["--json", "--allow-blocked", "--owner", "xbmc", "--repo", "xbmc", "--pr", "28172", "--review-output-key", "rk", "--delivery-id", "did"])).toMatchObject({
      json: true,
      allowBlocked: true,
      reviewOutputKey: "rk",
      deliveryId: "did",
    });
    expect(() => parseM069S05Args(["--fixture", ".gsd/secret.json"])).toThrow(/invalid_cli_args/);
  });

  test("passes only exact-target, correlated, bounded, shadow-only injected proof", () => {
    const report = evaluate();

    expect(report).toMatchObject({
      command: "verify:m069:s05",
      generated_at: "2026-05-11T00:00:00.000Z",
      proofMode: "injected-evidence",
      proofScope: "production-like-specialist-shadow-proof",
      success: true,
      status_code: "m069_ok",
      target: { owner: "xbmc", repo: "xbmc", pr: 28172 },
      lane: "docs-config-truth",
      reviewOutputKey: "m069-s05-review-output",
      deliveryId: "m069-s05-delivery",
      correlationKey: "m069-s05-correlation",
      sourceAvailability: {
        githubReviewDetailsAvailable: true,
        logAnalyticsAvailable: true,
        liveAccessBlocked: false,
      },
      counts: {
        candidateCount: 4,
        decisionCount: 4,
        duplicateCount: 1,
        disagreementCount: 1,
      },
      metricAvailability: {
        tokenCountAvailable: true,
        costAvailable: true,
        latencyMsAvailable: true,
      },
      publicationDenials: {
        visiblePublicationDenied: true,
        approvalPublicationDenied: true,
        publishesFindings: false,
        visibleSpecialistFindingPublished: false,
        visibleSpecialistCommentPublished: false,
        visibleSpecialistApprovalPublished: false,
      },
      leakSummary: {
        rawPayloadLeakCount: 0,
        visiblePublicationFieldCount: 0,
        approvalFieldCount: 0,
        tierModeFieldCount: 0,
      },
      issues: [],
    });
    expect(report.checks.every((check) => check.passed)).toBe(true);
  });

  test("classifies missing credentials or collector access as blocked live access and never success", () => {
    const report = evaluate(buildBlockedM069S05Evidence());

    expect(report.success).toBe(false);
    expect(report.status_code).toBe("m069_blocked_live_access");
    expect(report.status_reason).toContain("blocked evidence, not operational success");
    expect(report.sourceAvailability.liveAccessBlocked).toBe(true);
  });

  test("fails malformed when owner/repo/pr is not exact xbmc/xbmc#28172", () => {
    const evidence = cloneEvidence({ target: { owner: "other", repo: "xbmc", pr: 28172 } });
    const report = evaluateM069S05Proof({
      generatedAt: "2026-05-11T00:00:00.000Z",
      target: { owner: "other", repo: "xbmc", pr: 28172 },
      evidence,
    });

    expect(report.success).toBe(false);
    expect(report.status_code).toBe("m069_malformed_evidence");
    expect(report.issues.join("\n")).toContain("target must be exact xbmc/xbmc#28172");
  });

  test("fails malformed for missing Review Details line or reviewOutputKey", () => {
    const missingLine = evaluate(cloneEvidence({ reviewDetails: null }));
    expect(missingLine.success).toBe(false);
    expect(missingLine.status_code).toBe("m069_malformed_evidence");
    expect(missingLine.issues.join("\n")).toContain("Review Details compact specialist line is missing");

    const missingKey = evaluate(cloneEvidence({ reviewDetails: { reviewOutputKey: null } }));
    expect(missingKey.success).toBe(false);
    expect(missingKey.status_code).toBe("m069_malformed_evidence");
    expect(missingKey.issues.join("\n")).toContain("reviewOutputKey is missing or unbounded");
  });

  test("fails malformed for missing deliveryId, correlationKey, or log evidence", () => {
    const missingLog = evaluate(cloneEvidence({ runtimeLog: null }));
    expect(missingLog.success).toBe(false);
    expect(missingLog.status_code).toBe("m069_malformed_evidence");
    expect(missingLog.issues.join("\n")).toContain("runtime log correlation evidence is missing");

    const missingDelivery = evaluate(cloneEvidence({ reviewDetails: { deliveryId: null }, runtimeLog: { deliveryId: null } }));
    expect(missingDelivery.success).toBe(false);
    expect(missingDelivery.status_code).toBe("m069_malformed_evidence");
    expect(missingDelivery.issues.join("\n")).toContain("deliveryId is missing or unbounded");

    const missingCorrelation = evaluate(cloneEvidence({ reviewDetails: { correlationKey: null }, runtimeLog: { correlationKey: null } }));
    expect(missingCorrelation.success).toBe(false);
    expect(missingCorrelation.status_code).toBe("m069_malformed_evidence");
    expect(missingCorrelation.issues.join("\n")).toContain("correlationKey is missing or unbounded");
  });

  test("classifies skipped and degraded specialist status as non-success", () => {
    const skipped = evaluate(cloneEvidence({ reviewDetails: { status: "skipped" }, runtimeLog: { status: "skipped" } }));
    expect(skipped.success).toBe(false);
    expect(skipped.status_code).toBe("m069_not_triggered");
    expect(skipped.issues.join("\n")).toContain("shadow specialist evidence was not triggered");

    const degraded = evaluate(cloneEvidence({ reviewDetails: { status: "degraded" }, runtimeLog: { status: "degraded" } }));
    expect(degraded.success).toBe(false);
    expect(degraded.status_code).toBe("m069_degraded");
    expect(degraded.issues.join("\n")).toContain("shadow specialist status is degraded/error/unclassifiable");
  });

  test("fails malformed for unbounded counts or malformed metric availability", () => {
    const badCount = evaluate(cloneEvidence({ reviewDetails: { candidateCount: 2, decisionCount: 3 } }));
    expect(badCount.success).toBe(false);
    expect(badCount.status_code).toBe("m069_malformed_evidence");
    expect(badCount.issues.join("\n")).toContain("counts and metric availability must be bounded");

    const badMetric = evaluate(cloneEvidence({ reviewDetails: { tokenCountAvailable: "maybe" as unknown as boolean } }));
    expect(badMetric.success).toBe(false);
    expect(badMetric.status_code).toBe("m069_malformed_evidence");
    expect(badMetric.issues.join("\n")).toContain("counts and metric availability must be bounded");
  });

  test("rejects raw payload and tier-mode sentinels without echoing raw values", () => {
    const evidence = cloneEvidence({
      reviewDetails: {
        candidateBody: "candidate-body-visible",
        candidateFingerprint: "candidate-fingerprint-visible",
        prompt: "raw prompt visible",
        modelOutput: "raw model visible",
        toolPayload: { value: "tool payload visible" },
        tierMode: "tier-mode-visible",
      },
    });
    const report = evaluate(evidence);

    expect(report.success).toBe(false);
    expect(report.status_code).toBe("m069_malformed_evidence");
    expect(report.leakSummary.rawPayloadLeakCount).toBeGreaterThan(0);
    expect(report.leakSummary.tierModeFieldCount).toBeGreaterThan(0);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("candidate-body-visible");
    expect(serialized).not.toContain("candidate-fingerprint-visible");
    expect(serialized).not.toContain("raw prompt visible");
    expect(serialized).not.toContain("raw model visible");
    expect(serialized).not.toContain("tool payload visible");
    expect(serialized).not.toContain("tier-mode-visible");
  });

  test("classifies visible specialist inline, issue, approval, and approval fields as publication violation", () => {
    const report = evaluate(cloneEvidence({
      reviewDetails: {
        inlineComment: "inline comment visible",
        issueComment: "issue comment visible",
        approval: { state: "APPROVE", body: "approval visible" },
      },
      visiblePublication: {
        visibleSpecialistFindingPublished: true,
        visibleSpecialistCommentPublished: true,
        visibleSpecialistApprovalPublished: true,
      },
    }));

    expect(report.success).toBe(false);
    expect(report.status_code).toBe("m069_visible_publication_violation");
    expect(report.publicationDenials.visibleSpecialistFindingPublished).toBe(true);
    expect(report.publicationDenials.visibleSpecialistCommentPublished).toBe(true);
    expect(report.publicationDenials.visibleSpecialistApprovalPublished).toBe(true);
    expect(report.leakSummary.visiblePublicationFieldCount).toBeGreaterThan(0);
    expect(report.leakSummary.approvalFieldCount).toBeGreaterThan(0);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("inline comment visible");
    expect(serialized).not.toContain("issue comment visible");
    expect(serialized).not.toContain("approval visible");
  });


  test("package.json wires verify:m069:s05 and verifier avoids gitignored evidence inputs", async () => {
    const packageJson = JSON.parse(await Bun.file("package.json").text());
    expect(packageJson.scripts[COMMAND_NAME]).toBe(EXPECTED_PACKAGE_SCRIPT);

    const verifierSource = await Bun.file("scripts/verify-m069-s05.ts").text();
    expect(verifierSource).not.toMatch(/Bun\.file\(["'`](?:\.gsd|\.planning|\.audits)\//);
    expect(verifierSource).not.toMatch(/readFile[^\n]+(?:\.gsd|\.planning|\.audits)\//);
  });

  test("injected live collectors extract bounded Review Details and correlated runtime rows", async () => {
    const requestedArgs = parseM069S05Args(["--owner", "xbmc", "--repo", "xbmc", "--pr", "28172"]);
    const runtimeKeys: Array<{ reviewOutputKey: string | null; deliveryId: string | null }> = [];
    const evidence = await collectM069S05LiveEvidence(requestedArgs, {
      collectGitHubArtifacts: async (args) => {
        expect(args).toMatchObject({ owner: "xbmc", repo: "xbmc", pr: 28172 });
        return {
          artifacts: [
            { source: "issue-comment", body: "ordinary public review text" },
            { source: "review", body: liveReviewDetailsBody("candidate-body-visible"), state: "COMMENTED" },
            { source: "review-comment", body: liveReviewDetailsBody(), state: null },
          ],
          sourceAvailability: {
            githubReviewDetailsAvailable: true,
            githubAccessAvailable: true,
            githubDependency: "available",
            liveAccessBlocked: false,
            blockerReason: null,
          },
        };
      },
      collectRuntimeLogs: async (_args, keys) => {
        runtimeKeys.push(keys);
        return {
          runtimeLog: {
            present: true,
            laneId: "docs-config-truth",
            status: "ok",
            reviewOutputKey: keys.reviewOutputKey,
            deliveryId: keys.deliveryId,
            correlationKey: LIVE_CORRELATION_KEY,
            tokenCountAvailable: true,
            costAvailable: true,
            latencyMsAvailable: true,
          },
          sourceAvailability: {
            logAnalyticsAvailable: true,
            azureLogs: "available",
            liveAccessBlocked: false,
            blockerReason: null,
          },
        };
      },
    });

    expect(runtimeKeys).toEqual([{ reviewOutputKey: LIVE_REVIEW_OUTPUT_KEY, deliveryId: LIVE_DELIVERY_ID }]);
    const report = evaluateM069S05Proof({ generatedAt: "2026-05-11T00:00:00.000Z", evidence });
    expect(report).toMatchObject({ success: true, status_code: "m069_ok", reviewOutputKey: LIVE_REVIEW_OUTPUT_KEY, deliveryId: LIVE_DELIVERY_ID });
    expect(JSON.stringify(report)).not.toContain("candidate-body-visible");
  });

  test("injected collectors classify GitHub access failures and Azure missing logs as blocked", async () => {
    const evidence = await collectM069S05LiveEvidence(parseM069S05Args([]), {
      collectGitHubArtifacts: async () => ({
        artifacts: [],
        sourceAvailability: {
          githubReviewDetailsAvailable: false,
          githubAccessAvailable: false,
          githubDependency: "unavailable",
          liveAccessBlocked: true,
          blockerReason: "github_access_403",
        },
      }),
      collectRuntimeLogs: async (_args, keys) => {
        expect(keys).toEqual({ reviewOutputKey: null, deliveryId: null });
        return {
          runtimeLog: null,
          sourceAvailability: {
            logAnalyticsAvailable: false,
            azureLogs: "unavailable",
            liveAccessBlocked: true,
            blockerReason: "missing_correlation_key",
          },
        };
      },
    });

    const report = evaluateM069S05Proof({ generatedAt: "2026-05-11T00:00:00.000Z", evidence });
    expect(report.success).toBe(false);
    expect(report.status_code).toBe("m069_blocked_live_access");
    expect(report.sourceAvailability).toMatchObject({
      githubDependency: "unavailable",
      azureLogs: "unavailable",
      liveAccessBlocked: true,
    });
    expect(report.sourceAvailability.blockerReason).toContain("github_access_403");
    expect(report.sourceAvailability.blockerReason).toContain("missing_correlation_key");
  });

  test("collector evidence reports visible specialist publication violations", async () => {
    const evidence = await collectM069S05LiveEvidence(parseM069S05Args([]), {
      collectGitHubArtifacts: async () => ({
        artifacts: [
          { source: "review", body: liveReviewDetailsBody(), state: "COMMENTED" },
          { source: "review", body: "Visible docs-config-truth specialist finding should never publish", state: "APPROVED" },
        ],
        sourceAvailability: {
          githubReviewDetailsAvailable: true,
          githubAccessAvailable: true,
          githubDependency: "available",
          liveAccessBlocked: false,
          blockerReason: null,
        },
      }),
      collectRuntimeLogs: async (_args, keys) => ({
        runtimeLog: {
          present: true,
          laneId: "docs-config-truth",
          status: "ok",
          reviewOutputKey: keys.reviewOutputKey,
          deliveryId: keys.deliveryId,
          correlationKey: LIVE_CORRELATION_KEY,
          tokenCountAvailable: true,
          costAvailable: true,
          latencyMsAvailable: true,
        },
        sourceAvailability: {
          logAnalyticsAvailable: true,
          azureLogs: "available",
          liveAccessBlocked: false,
          blockerReason: null,
        },
      }),
    });

    const report = evaluateM069S05Proof({ generatedAt: "2026-05-11T00:00:00.000Z", evidence });
    expect(report.success).toBe(false);
    expect(report.status_code).toBe("m069_visible_publication_violation");
    expect(report.publicationDenials.visibleSpecialistCommentPublished).toBe(true);
    expect(report.publicationDenials.visibleSpecialistApprovalPublished).toBe(true);
    expect(JSON.stringify(report)).not.toContain("Visible docs-config-truth specialist finding should never publish");
  });


  test("main emits JSON and allow-blocked only changes exit code, not success", async () => {
    const passStdout: string[] = [];
    const passExit = await main(["--json"], {
      stdout: { write: (chunk: string) => void passStdout.push(chunk) },
      stderr: { write: () => undefined },
      evaluate: () => evaluate(),
    });
    expect(passExit).toBe(0);
    expect(JSON.parse(passStdout.join(""))).toMatchObject({ success: true, status_code: "m069_ok" });

    const blockedStdout: string[] = [];
    const blockedExit = await main(["--json", "--allow-blocked"], {
      stdout: { write: (chunk: string) => void blockedStdout.push(chunk) },
      stderr: { write: () => undefined },
      evaluate: () => evaluate(buildBlockedM069S05Evidence()),
    });
    const blockedReport = JSON.parse(blockedStdout.join(""));
    expect(blockedExit).toBe(0);
    expect(blockedReport).toMatchObject({ success: false, status_code: "m069_blocked_live_access" });

    const blockedWithoutAllowStdout: string[] = [];
    const blockedWithoutAllowExit = await main(["--json"], {
      stdout: { write: (chunk: string) => void blockedWithoutAllowStdout.push(chunk) },
      stderr: { write: () => undefined },
      evaluate: () => evaluate(buildBlockedM069S05Evidence()),
    });
    expect(blockedWithoutAllowExit).toBe(1);
    expect(JSON.parse(blockedWithoutAllowStdout.join(""))).toMatchObject({ success: false, status_code: "m069_blocked_live_access" });

    const invalidStdout: string[] = [];
    const invalidExit = await main(["--fixture", ".gsd/secret.json"], {
      stdout: { write: (chunk: string) => void invalidStdout.push(chunk) },
      stderr: { write: () => undefined },
      evaluate: () => evaluate(),
    });
    expect(invalidExit).toBe(2);
    expect(JSON.parse(invalidStdout.join(""))).toMatchObject({
      success: false,
      status_code: "m069_malformed_evidence",
      issues: [expect.stringContaining("invalid_cli_args")],
    });
  });
});
