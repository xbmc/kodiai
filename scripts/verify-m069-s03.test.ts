import { describe, expect, test } from "bun:test";

import {
  M069_S03_CHECK_IDS,
  evaluateM069S03Contract,
  main,
  parseM069S03Args,
} from "./verify-m069-s03.ts";

const PASSING_PACKAGE_JSON = JSON.stringify({
  scripts: {
    "verify:m069:s03": "bun scripts/verify-m069-s03.ts",
  },
});

const PASSING_REDUCER = `
export type ShadowSpecialistMetricsProjection = {
  readonly privateOnly: true;
  readonly shadowOnly: true;
  readonly publishesFindings: false;
  readonly visiblePublicationDenied: true;
  readonly approvalPublicationDenied: true;
  readonly rawContentFieldCount: 0;
  readonly candidateBodyFieldCount: 0;
  readonly githubPublicationFieldCount: 0;
  readonly approvalFieldCount: 0;
  readonly specialistContentIncluded: false;
  readonly candidateFingerprintsIncluded: false;
  readonly candidateBodiesIncluded: false;
  readonly rawModelOutputIncluded: false;
  readonly toolPayloadIncluded: false;
  readonly approvalFieldsIncluded: false;
  readonly tierModeIncluded: false;
};
export function projectShadowSpecialistMetrics() {
  return {
    rawContentFieldCount: 0,
    candidateBodyFieldCount: 0,
    githubPublicationFieldCount: 0,
    approvalFieldCount: 0,
    specialistContentIncluded: false,
    candidateFingerprintsIncluded: false,
    candidateBodiesIncluded: false,
    rawModelOutputIncluded: false,
    toolPayloadIncluded: false,
    approvalFieldsIncluded: false,
    tierModeIncluded: false,
  };
}
`;

const PASSING_HANDLER = `
import { projectShadowSpecialistMetrics } from "../specialists/shadow-specialist-metrics.ts";
import { buildApprovedReviewBody, ensureReviewOutputNotPublished } from "./review-idempotency.ts";
function buildShadowSpecialistLogFields(result) {
  try {
    const projection = projectShadowSpecialistMetrics(result);
    return {
      gate: "shadow-specialist",
      laneId: projection.laneId,
      status: result.triggerStatus,
      outputStatus: projection.status,
      reason: projection.reason,
      candidateCount: projection.candidateCount,
      decisionCount: projection.decisionCount,
      duplicateCount: projection.duplicateCount,
      disagreementCount: projection.disagreementCount,
      metricAvailability: projection.metricAvailability,
      tokenCountAvailable: projection.tokenCountAvailable,
      costAvailable: projection.costAvailable,
      latencyMsAvailable: projection.latencyMsAvailable,
      deliveryId: projection.deliveryId,
      reviewOutputKey: projection.reviewOutputKey,
      correlationKey: projection.correlationKey,
      discardedRawPayload: projection.redactionFlags.discardedRawPayload,
      discardedPublicationFields: projection.redactionFlags.discardedPublicationFields,
      discardedApprovalFields: projection.redactionFlags.discardedApprovalFields,
      visiblePublicationDenied: projection.visiblePublicationDenied,
      approvalPublicationDenied: projection.approvalPublicationDenied,
      rawContentFieldCount: projection.rawContentFieldCount,
      candidateBodyFieldCount: projection.candidateBodyFieldCount,
      githubPublicationFieldCount: projection.githubPublicationFieldCount,
      approvalFieldCount: projection.approvalFieldCount,
      specialistContentIncluded: projection.specialistContentIncluded,
      candidateFingerprintsIncluded: projection.candidateFingerprintsIncluded,
      candidateBodiesIncluded: projection.candidateBodiesIncluded,
      rawModelOutputIncluded: projection.rawModelOutputIncluded,
      toolPayloadIncluded: projection.toolPayloadIncluded,
      approvalFieldsIncluded: projection.approvalFieldsIncluded,
      tierModeIncluded: projection.tierModeIncluded,
    };
  } catch {
    return {
      gate: "shadow-specialist",
      reason: "metrics-projection-error",
      visiblePublicationDenied: true,
      approvalPublicationDenied: true,
      metricProjectionDegraded: true,
    };
  }
}
`;

async function evaluateWithFixtures(overrides: {
  packageJsonText?: string;
  reducerText?: string;
  handlerText?: string;
  projectMetrics?: Parameters<typeof evaluateM069S03Contract>[0]["projectMetrics"];
} = {}) {
  return await evaluateM069S03Contract({
    generatedAt: "2026-05-10T23:30:00.000Z",
    readPackageJsonText: async () => overrides.packageJsonText ?? PASSING_PACKAGE_JSON,
    readReducerText: async () => overrides.reducerText ?? PASSING_REDUCER,
    readHandlerText: async () => overrides.handlerText ?? PASSING_HANDLER,
    projectMetrics: overrides.projectMetrics,
  });
}

describe("verify-m069-s03", () => {
  test("exports stable check ids and parses only bounded CLI flags", () => {
    expect(M069_S03_CHECK_IDS).toEqual([
      "M069-S03-PACKAGE-WIRING",
      "M069-S03-REDUCER-EXPORT",
      "M069-S03-CANDIDATE-METRIC-PROJECTION",
      "M069-S03-HANDLER-METRIC-WIRING",
      "M069-S03-PUBLICATION-BOUNDARY",
      "M069-S03-NEGATIVE-VISIBLE-SURFACE",
    ]);
    expect(parseM069S03Args([])).toEqual({ json: false, help: false });
    expect(parseM069S03Args(["--json"])).toEqual({ json: true, help: false });
    expect(parseM069S03Args(["--help"])).toEqual({ json: false, help: true });
    expect(() => parseM069S03Args(["--fixture", ".gsd/secret.json"])).toThrow(/invalid_cli_args/);
  });

  test("passes representative package, reducer, handler metric wiring, and publication boundary checks", async () => {
    const report = await evaluateWithFixtures();

    expect(report).toMatchObject({
      command: "verify:m069:s03",
      generated_at: "2026-05-10T23:30:00.000Z",
      proofMode: "local-fixture-static",
      proofScope: "non-live-source-and-fixture-proof",
      success: true,
      status_code: "m069_s03_ok",
      candidateMetricProjectionPassed: true,
      handlerMetricWiringPresent: true,
      visiblePublicationFieldCount: 0,
      approvalFieldCount: 0,
      rawPayloadLeakCount: 0,
      specialistPromptInjectionCount: 0,
      normalReviewPublicationOnly: true,
      reviewDetailsSpecialistCandidateVisible: false,
      tierModeFieldCount: 0,
      failing_check_id: null,
      issues: [],
      summary: {
        packageScriptWired: true,
        reducerExportPresent: true,
        reducerPrivateDenialFieldsPresent: true,
        reducerZeroContentCountsPresent: true,
        handlerImportsReducer: true,
        handlerBuildsMetricLogFields: true,
        handlerLogsProjectionDenials: true,
        handlerProjectionFailOpenPresent: true,
        readsPlanningOrSecrets: false,
        liveServiceRequired: false,
      },
      projection: {
        laneId: "docs-config-truth",
        candidateCount: 6,
        decisionCount: 6,
        duplicateCount: 1,
        disagreementCount: 1,
        tokenCountAvailable: true,
        costAvailable: true,
        latencyMsAvailable: true,
        visiblePublicationDenied: true,
        approvalPublicationDenied: true,
        rawContentFieldCount: 0,
        candidateBodyFieldCount: 0,
        githubPublicationFieldCount: 0,
        approvalFieldCount: 0,
        specialistContentIncluded: false,
        candidateFingerprintsIncluded: false,
        candidateBodiesIncluded: false,
        rawModelOutputIncluded: false,
        toolPayloadIncluded: false,
        approvalFieldsIncluded: false,
        tierModeIncluded: false,
        serializedLeakMatches: [],
      },
    });
    expect(report.check_ids).toEqual(M069_S03_CHECK_IDS);
    expect(report.checks.every((check) => check.passed)).toBe(true);
    expect(report.targetedTests).toEqual([
      "bun test scripts/verify-m069-s03.test.ts",
      "bun run verify:m069:s03 --json",
      "bun test src/specialists/shadow-specialist-metrics.test.ts src/handlers/review-shadow-specialist-metrics.test.ts",
      "bun test src/specialists/shadow-specialist-runner.test.ts src/handlers/review-shadow-specialist.test.ts",
    ]);

    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("candidate-body-visible");
    expect(serialized).not.toContain("candidate-fingerprint-visible");
    expect(serialized).not.toContain("raw prompt visible");
    expect(serialized).not.toContain("raw model visible");
    expect(serialized).not.toContain("tool payload visible");
    expect(serialized).not.toContain("inline comment visible");
    expect(serialized).not.toContain("approval visible");
  });

  test("fails with bounded issue when package script wiring drifts", async () => {
    const report = await evaluateWithFixtures({ packageJsonText: JSON.stringify({ scripts: {} }) });

    expect(report.success).toBe(false);
    expect(report.status_code).toBe("m069_s03_contract_failed");
    expect(report.failing_check_id).toBe("M069-S03-PACKAGE-WIRING");
    expect(report.issues.join("\n")).toContain("package.json scripts.verify:m069:s03 must equal bun scripts/verify-m069-s03.ts.");
  });

  test("fails with bounded issue when reducer export is missing", async () => {
    const report = await evaluateWithFixtures({
      reducerText: PASSING_REDUCER.replace("export function projectShadowSpecialistMetrics", "function projectShadowSpecialistMetrics"),
    });

    expect(report.success).toBe(false);
    expect(report.failing_check_id).toBe("M069-S03-REDUCER-EXPORT");
    expect(report.issues.join("\n")).toContain("metrics reducer must export projectShadowSpecialistMetrics");
  });

  test("fails when synthetic projection exposes unsafe visible fields", async () => {
    const report = await evaluateWithFixtures({
      projectMetrics: () => ({
        laneId: "docs-config-truth",
        status: "ok",
        reason: null,
        deliveryId: "delivery",
        reviewOutputKey: "review",
        correlationKey: "corr",
        candidateCount: 1,
        decisionCount: 1,
        decisionCounts: { candidate: 1, duplicate: 0, disagreement: 0, dismissed: 0, unclassifiable: 0 },
        duplicateCount: 0,
        disagreementCount: 0,
        dismissedCount: 0,
        unclassifiableCount: 0,
        truncatedCandidateCount: 0,
        metricAvailability: { tokenCount: "available", costUsd: "available", latencyMs: "available" },
        tokenCountAvailable: true,
        costAvailable: true,
        latencyMsAvailable: true,
        redactionFlags: { unsafeFieldCount: 1, discardedRawPayload: true, discardedPublicationFields: true, discardedApprovalFields: true },
        privateOnly: true,
        shadowOnly: true,
        publishesFindings: false,
        visiblePublicationDenied: false,
        approvalPublicationDenied: false,
        rawContentFieldCount: 1,
        candidateBodyFieldCount: 1,
        githubPublicationFieldCount: 1,
        approvalFieldCount: 1,
        specialistContentIncluded: true,
        candidateFingerprintsIncluded: true,
        candidateBodiesIncluded: true,
        rawModelOutputIncluded: true,
        toolPayloadIncluded: true,
        approvalFieldsIncluded: true,
        tierModeIncluded: true,
        leaked: "candidate-body-visible",
      } as never),
    });

    expect(report.success).toBe(false);
    expect(report.failing_check_id).toBe("M069-S03-CANDIDATE-METRIC-PROJECTION");
    expect(report.visiblePublicationFieldCount).toBe(2);
    expect(report.approvalFieldCount).toBe(1);
    expect(report.rawPayloadLeakCount).toBeGreaterThan(0);
    expect(report.tierModeFieldCount).toBe(0);
    expect(report.projection.serializedLeakMatches).toContain("candidate-body-visible");
  });

  test("fails when handler shadow metric block contains publication callbacks", async () => {
    const report = await evaluateWithFixtures({
      handlerText: PASSING_HANDLER.replace("return {", "await octokit.issues.createComment({ body: 'bad' });\n    return {"),
    });

    expect(report.success).toBe(false);
    expect(report.failing_check_id).toBe("M069-S03-PUBLICATION-BOUNDARY");
    expect(report.sourceBoundary.handlerShadowForbiddenPublicationMatches).toEqual(["issues.createComment", "createComment", "octokit"]);
    expect(report.issues.join("\n")).toContain("handler shadow metric block must not call publication/approval tools");
  });

  test("fails when handler shadow metric block exposes raw payloads, prompts, Review Details, or tier mode", async () => {
    const report = await evaluateWithFixtures({
      handlerText: PASSING_HANDLER.replace(
        "gate: \"shadow-specialist\",",
        "gate: \"shadow-specialist\",\n      prompt: result.prompt,\n      commentBody: result.commentBody,\n      reviewDetails: 'Review Details',\n      tierMode: result.tierMode,",
      ),
    });

    expect(report.success).toBe(false);
    expect(report.failing_check_id).toBe("M069-S03-NEGATIVE-VISIBLE-SURFACE");
    expect(report.rawPayloadLeakCount).toBeGreaterThan(0);
    expect(report.specialistPromptInjectionCount).toBeGreaterThan(0);
    expect(report.reviewDetailsSpecialistCandidateVisible).toBe(true);
    expect(report.tierModeFieldCount).toBe(1);
  });

  test("main emits parseable JSON on pass, contract failure, and invalid args", async () => {
    const passingStdout: string[] = [];
    const passExitCode = await main(["--json"], {
      stdout: { write: (chunk: string) => void passingStdout.push(chunk) },
      stderr: { write: () => undefined },
      evaluate: async () => await evaluateWithFixtures(),
    });

    expect(passExitCode).toBe(0);
    expect(JSON.parse(passingStdout.join(""))).toMatchObject({
      command: "verify:m069:s03",
      success: true,
      status_code: "m069_s03_ok",
    });

    const failingStdout: string[] = [];
    const failExitCode = await main(["--json"], {
      stdout: { write: (chunk: string) => void failingStdout.push(chunk) },
      stderr: { write: () => undefined },
      evaluate: async () => await evaluateWithFixtures({ packageJsonText: JSON.stringify({ scripts: {} }) }),
    });

    expect(failExitCode).toBe(1);
    expect(JSON.parse(failingStdout.join(""))).toMatchObject({
      command: "verify:m069:s03",
      success: false,
      status_code: "m069_s03_contract_failed",
      failing_check_id: "M069-S03-PACKAGE-WIRING",
    });

    const invalidStdout: string[] = [];
    const invalidExitCode = await main(["--fixture", ".gsd/secret.json"], {
      stdout: { write: (chunk: string) => void invalidStdout.push(chunk) },
      stderr: { write: () => undefined },
      evaluate: async () => await evaluateWithFixtures(),
    });

    expect(invalidExitCode).toBe(2);
    expect(JSON.parse(invalidStdout.join(""))).toMatchObject({
      command: "verify:m069:s03",
      success: false,
      status_code: "m069_s03_invalid_arg",
      issues: [expect.stringContaining("invalid_cli_args")],
    });
  });
});
