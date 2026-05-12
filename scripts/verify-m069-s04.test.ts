import { describe, expect, test } from "bun:test";

import {
  M069_S04_CHECK_IDS,
  buildSyntheticPassingEvidence,
  evaluateM069S04Contract,
  main,
  parseM069S04Args,
  type M069S04Evidence,
} from "./verify-m069-s04.ts";

const PASSING_PACKAGE_JSON = JSON.stringify({
  scripts: {
    "verify:m069:s04": "bun scripts/verify-m069-s04.ts",
  },
});

async function evaluateWithEvidence(evidence: M069S04Evidence = buildSyntheticPassingEvidence(), packageJsonText = PASSING_PACKAGE_JSON) {
  return await evaluateM069S04Contract({
    generatedAt: "2026-05-10T23:45:00.000Z",
    evidence,
    readPackageJsonText: async () => packageJsonText,
  });
}

function cloneEvidence(overrides: Partial<M069S04Evidence> = {}): M069S04Evidence {
  const base = buildSyntheticPassingEvidence();
  return { ...base, ...overrides };
}

describe("verify-m069-s04", () => {
  test("exports stable check ids and accepts only bounded CLI flags", () => {
    expect(M069_S04_CHECK_IDS).toEqual([
      "M069-S04-PACKAGE-WIRING",
      "M069-S04-TRIGGERED-EVIDENCE",
      "M069-S04-CORRELATION-SHAPE",
      "M069-S04-COUNT-METRIC-SHAPE",
      "M069-S04-REDACTION-DENIALS",
      "M069-S04-NO-RAW-PAYLOAD-LEAKAGE",
      "M069-S04-NO-VISIBLE-PUBLICATION",
    ]);
    expect(parseM069S04Args([])).toEqual({ json: false, help: false });
    expect(parseM069S04Args(["--json"])).toEqual({ json: true, help: false });
    expect(parseM069S04Args(["--help"])).toEqual({ json: false, help: true });
    expect(() => parseM069S04Args(["--fixture", ".gsd/secret.json"])).toThrow(/invalid_cli_args/);
  });

  test("passes with local fixture proof and no raw specialist payload leakage", async () => {
    const report = await evaluateWithEvidence();

    expect(report).toMatchObject({
      command: "verify:m069:s04",
      generated_at: "2026-05-10T23:45:00.000Z",
      proofMode: "local-fixture-static",
      proofScope: "non-live-review-details-log-verifier-contract",
      success: true,
      status_code: "m069_ok",
      status_reason: "bounded local S04 evidence passed",
      failing_check_id: null,
      lane: "docs-config-truth",
      reviewOutputKey: "m069-s04-fixture-review-output",
      deliveryId: "m069-s04-fixture-delivery",
      correlationKey: "m069-s04-fixture-correlation",
      counts: {
        candidateCount: 6,
        decisionCount: 6,
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
      summary: {
        packageScriptWired: true,
        triggered: true,
        liveServiceRequired: false,
        readsGitignoredPaths: false,
        malformedEvidence: false,
        boundedMetricShape: true,
      },
      issues: [],
    });
    expect(report.check_ids).toEqual(M069_S04_CHECK_IDS);
    expect(report.checks.every((check) => check.passed)).toBe(true);

    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("candidate-body-visible");
    expect(serialized).not.toContain("candidate-fingerprint-visible");
    expect(serialized).not.toContain("raw prompt visible");
    expect(serialized).not.toContain("raw model visible");
    expect(serialized).not.toContain("tool payload visible");
    expect(serialized).not.toContain("inline comment visible");
    expect(serialized).not.toContain("issue comment visible");
    expect(serialized).not.toContain("approval visible");
  });

  test("fails closed when package script wiring is missing", async () => {
    const report = await evaluateWithEvidence(buildSyntheticPassingEvidence(), JSON.stringify({ scripts: {} }));

    expect(report.success).toBe(false);
    expect(report.status_code).toBe("m069_malformed_evidence");
    expect(report.failing_check_id).toBe("M069-S04-PACKAGE-WIRING");
    expect(report.issues.join("\n")).toContain("package.json scripts.verify:m069:s04 must equal bun scripts/verify-m069-s04.ts");
  });

  test("classifies requested missing live credentials as blocked live access", async () => {
    const report = await evaluateWithEvidence(cloneEvidence({ requestedLiveProof: true, liveAccessBlocked: true }));

    expect(report.success).toBe(false);
    expect(report.status_code).toBe("m069_blocked_live_access");
    expect(report.status_reason).toContain("live proof was requested");
    expect(report.summary.liveServiceRequired).toBe(false);
  });

  test("classifies skipped or untriggered evidence as not triggered", async () => {
    const report = await evaluateWithEvidence(cloneEvidence({ triggered: false, status: "skipped", reason: "shadow-disabled" }));

    expect(report.success).toBe(false);
    expect(report.status_code).toBe("m069_not_triggered");
    expect(report.failing_check_id).toBe("M069-S04-TRIGGERED-EVIDENCE");
    expect(report.issues.join("\n")).toContain("shadow specialist evidence was not triggered");
  });

  test("classifies bounded degraded and malformed metric availability as degraded", async () => {
    const evidence = cloneEvidence({ status: "degraded", reason: "timeout" });
    evidence.log = { ...evidence.log, tokenCountAvailable: "maybe" };
    evidence.verifier = { ...evidence.verifier, tokenCountAvailable: "maybe" };
    const report = await evaluateWithEvidence(evidence);

    expect(report.success).toBe(false);
    expect(report.status_code).toBe("m069_degraded");
    expect(report.status_reason).toContain("degraded/error");
    expect(report.leakSummary.rawPayloadLeakCount).toBe(0);
  });

  test("classifies visible specialist findings, comments, approvals, or publication fields as violation", async () => {
    const evidence = cloneEvidence();
    evidence.log = {
      ...evidence.log,
      visibleSpecialistFindingPublished: true,
      visibleSpecialistCommentPublished: true,
      visibleSpecialistApprovalPublished: true,
      finding: { summary: "bounded-not-raw" },
      approval: { state: "APPROVE" },
    };
    const report = await evaluateWithEvidence(evidence);

    expect(report.success).toBe(false);
    expect(report.status_code).toBe("m069_visible_publication_violation");
    expect(report.publicationDenials.visibleSpecialistFindingPublished).toBe(true);
    expect(report.publicationDenials.visibleSpecialistCommentPublished).toBe(true);
    expect(report.publicationDenials.visibleSpecialistApprovalPublished).toBe(true);
    expect(report.leakSummary.visiblePublicationFieldCount).toBeGreaterThan(0);
    expect(report.leakSummary.approvalFieldCount).toBeGreaterThan(0);
  });

  test("classifies missing Review Details line and absent correlation as malformed evidence", async () => {
    const report = await evaluateWithEvidence(cloneEvidence({ reviewDetailsLine: null, correlationKey: null }));

    expect(report.success).toBe(false);
    expect(report.status_code).toBe("m069_malformed_evidence");
    expect(report.failing_check_id).toBe("M069-S04-CORRELATION-SHAPE");
    expect(report.issues.join("\n")).toContain("Review Details compact line is missing");
    expect(report.issues.join("\n")).toContain("correlationKey is missing");
  });

  test("classifies raw candidate body, prompt, approval sentinel, and tier-mode leakage as malformed evidence without echoing values", async () => {
    const evidence = cloneEvidence();
    evidence.log = {
      ...evidence.log,
      candidateBody: "candidate-body-visible",
      prompt: "raw prompt visible",
      modelOutput: "raw model visible",
      toolPayload: { payload: "tool payload visible" },
      tierMode: "tier-mode-visible",
    };
    evidence.verifier = {
      ...evidence.verifier,
      candidateFingerprint: "candidate-fingerprint-visible",
    };
    const report = await evaluateWithEvidence(evidence);

    expect(report.success).toBe(false);
    expect(report.status_code).toBe("m069_malformed_evidence");
    expect(report.failing_check_id).toBe("M069-S04-NO-RAW-PAYLOAD-LEAKAGE");
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

  test("main emits parseable JSON for pass, failure, and unknown CLI arg", async () => {
    const passingStdout: string[] = [];
    const passExitCode = await main(["--json"], {
      stdout: { write: (chunk: string) => void passingStdout.push(chunk) },
      stderr: { write: () => undefined },
      evaluate: async () => await evaluateWithEvidence(),
    });
    expect(passExitCode).toBe(0);
    expect(JSON.parse(passingStdout.join(""))).toMatchObject({
      command: "verify:m069:s04",
      success: true,
      status_code: "m069_ok",
    });

    const failingStdout: string[] = [];
    const failExitCode = await main(["--json"], {
      stdout: { write: (chunk: string) => void failingStdout.push(chunk) },
      stderr: { write: () => undefined },
      evaluate: async () => await evaluateWithEvidence(cloneEvidence({ triggered: false, status: "skipped" })),
    });
    expect(failExitCode).toBe(1);
    expect(JSON.parse(failingStdout.join(""))).toMatchObject({
      command: "verify:m069:s04",
      success: false,
      status_code: "m069_not_triggered",
      failing_check_id: "M069-S04-TRIGGERED-EVIDENCE",
    });

    const invalidStdout: string[] = [];
    const invalidExitCode = await main(["--fixture", ".gsd/secret.json"], {
      stdout: { write: (chunk: string) => void invalidStdout.push(chunk) },
      stderr: { write: () => undefined },
      evaluate: async () => await evaluateWithEvidence(),
    });
    expect(invalidExitCode).toBe(2);
    expect(JSON.parse(invalidStdout.join(""))).toMatchObject({
      command: "verify:m069:s04",
      success: false,
      status_code: "m069_malformed_evidence",
      issues: [expect.stringContaining("invalid_cli_args")],
      summary: { readsGitignoredPaths: false },
    });
  });
});
