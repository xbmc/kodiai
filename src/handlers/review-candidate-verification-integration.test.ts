import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";

import { buildMcpServers } from "../execution/mcp/index.ts";
import type { ExecutionContext, ExecutionPublishEvent, ExecutionResult } from "../execution/types.ts";
import type { CandidatePublicationPolicyAttempt } from "../specialists/candidate-publication-policy.ts";
import type { CandidateVerificationPublicationEvidenceSummary } from "../specialists/candidate-verification-publication-evidence.ts";
import type { ShadowSpecialistSubflowInput, ShadowSpecialistSubflowResult } from "../specialists/shadow-specialist-subflow.ts";
import { evaluateM070VerifierScenario, type M070ScenarioName, type M070StatusCode } from "../../scripts/verify-m070.ts";
import { runReviewWithShadowMetrics, specialistCanary, specialistInlineCanary } from "./review-m070-integration-harness.ts";

const safeVerifiedBody = "M070 SAFE VERIFIED INLINE BODY";
const safePartialBody = "M070 SAFE PARTIAL INLINE BODY";
const deniedCandidateCanary = "M070_INTEGRATION_DENIED_CANDIDATE_BODY_SHOULD_NOT_LEAK";
const deniedSpecialistCanary = "M070_INTEGRATION_DENIED_SPECIALIST_PROSE_SHOULD_NOT_LEAK";
const promptCanary = "M070_INTEGRATION_PROMPT_SHOULD_NOT_LEAK";
const diffCanary = "M070_INTEGRATION_DIFF_SHOULD_NOT_LEAK";
const fingerprintCanary = "M070_INTEGRATION_FINGERPRINT_SHOULD_NOT_LEAK";
const toolPayloadCanary = "M070_INTEGRATION_TOOL_PAYLOAD_SHOULD_NOT_LEAK";
const evidencePayloadCanary = "M070_INTEGRATION_EVIDENCE_PAYLOAD_SHOULD_NOT_LEAK";

type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean };
type ToolHandler = (input: Record<string, unknown>) => Promise<ToolResult>;

type ScenarioKind = "verified" | "partial" | "dispute" | "unclassifiable" | "malformed" | "missing-correlation" | "missing-aggregate";

type IntegrationScenarioResult = Awaited<ReturnType<typeof runReviewWithShadowMetrics>> & {
  executorInput: ExecutionContext;
  inlineResult: ToolResult;
  fallbackResult?: ToolResult;
  evidence: CandidateVerificationPublicationEvidenceSummary;
  verifierReport: ReturnType<typeof evaluateM070VerifierScenario>;
};

function getToolHandler(server: unknown, name: string): ToolHandler {
  const instance = (server as { instance?: unknown }).instance as {
    _registeredTools?: Record<string, { handler: ToolHandler }>;
  };
  const tool = instance._registeredTools?.[name];
  if (!tool) {
    throw new Error(`${name} tool is not registered`);
  }
  return tool.handler;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function numericLine(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }
  return null;
}

function candidateKey(candidate: CandidatePublicationPolicyAttempt): string {
  const material = {
    path: String(candidate.path ?? "").trim().slice(0, 256),
    side: String(candidate.side ?? "").trim().slice(0, 32),
    line: numericLine(candidate.line),
    startLine: numericLine(candidate.startLine),
    reviewOutputKey: String(candidate.reviewOutputKey ?? "").trim().slice(0, 256),
    deliveryId: String(candidate.deliveryId ?? "").trim().slice(0, 256),
    bodySignal: sha256(String(candidate.body ?? "").slice(0, 4096)),
  };
  return `m070-publication:${sha256(JSON.stringify(material))}`;
}

function buildShadowResult(
  input: ShadowSpecialistSubflowInput,
  candidates: unknown,
  overrides: Partial<ShadowSpecialistSubflowResult["output"]> = {},
): ShadowSpecialistSubflowResult {
  const candidateArray = Array.isArray(candidates) ? candidates : [];
  const counts = {
    candidate: candidateArray.filter((entry) => (entry as { decision?: unknown }).decision === "candidate").length,
    duplicate: candidateArray.filter((entry) => (entry as { decision?: unknown }).decision === "duplicate").length,
    disagreement: candidateArray.filter((entry) => (entry as { decision?: unknown }).decision === "disagreement").length,
    dismissed: candidateArray.filter((entry) => (entry as { decision?: unknown }).decision === "dismissed").length,
    unclassifiable: candidateArray.filter((entry) => (entry as { decision?: unknown }).decision === "unclassifiable").length,
  };
  return {
    trigger: {
      status: "triggered",
      laneId: "docs-config-truth",
      skipReason: null,
      degradedReason: null,
      errorKind: null,
      matchedPaths: ["docs/runbook.md"],
      candidateCount: candidateArray.length,
      selectedLaneCount: 1,
      shadowOnly: true,
      publishesFindings: false,
      correlationKey: input.correlationKey ?? null,
      metrics: { decisionCount: candidateArray.length, duplicateCount: counts.duplicate, disagreementCount: counts.disagreement, tokenCountAvailable: false, costAvailable: false, latencyMsAvailable: false },
    },
    output: {
      laneId: "docs-config-truth",
      status: "ok",
      skipReason: null,
      degradedReasons: [],
      errorKind: null,
      candidates,
      candidateCount: candidateArray.length,
      truncatedCandidateCount: 0,
      decisionCounts: counts,
      duplicateCount: counts.duplicate,
      disagreementCount: counts.disagreement,
      metricAvailability: { tokenCount: "unavailable", costUsd: "unavailable", latencyMs: "unavailable" },
      metrics: { decisionCount: candidateArray.length, duplicateCount: counts.duplicate, disagreementCount: counts.disagreement, tokenCountAvailable: false, costAvailable: false, latencyMsAvailable: false },
      deliveryId: input.deliveryId ?? null,
      reviewOutputKey: input.reviewOutputKey ?? null,
      correlationKey: input.correlationKey ?? null,
      redactionFlags: { unsafeFieldCount: 0, discardedRawPayload: false, discardedPublicationFields: false, discardedApprovalFields: false },
      shadowOnly: true,
      publishesFindings: false,
      ...overrides,
    } as never,
    durationMs: 4,
    laneId: "docs-config-truth",
    triggerStatus: "triggered",
    skipReason: null,
    degradedReason: null,
    errorKind: null,
    timeoutReason: null,
    errorReason: null,
    unclassifiableReason: null,
    deliveryId: input.deliveryId ?? null,
    reviewOutputKey: input.reviewOutputKey ?? null,
    correlationKey: input.correlationKey ?? null,
    candidateCount: candidateArray.length,
    decisionCount: candidateArray.length,
    duplicateCount: counts.duplicate,
    disagreementCount: counts.disagreement,
    metricAvailability: { tokenCount: "unavailable", costUsd: "unavailable", latencyMs: "unavailable" },
    redactionFlags: { unsafeFieldCount: 0, discardedRawPayload: false, discardedPublicationFields: false, discardedApprovalFields: false },
    shadowOnly: true,
    publishesFindings: false,
  };
}

function buildShadowSubflow(kind: ScenarioKind, candidateBody: string) {
  return async (input: ShadowSpecialistSubflowInput): Promise<ShadowSpecialistSubflowResult> => {
    if (kind === "missing-aggregate") {
      throw new Error("docs/config truth aggregate unavailable");
    }
    if (kind === "malformed") {
      return buildShadowResult(input, "not-an-array", { status: "degraded", errorKind: "invalid-output-shape" });
    }

    const reviewOutputKey = kind === "missing-correlation" ? undefined : input.reviewOutputKey;
    const deliveryId = kind === "missing-correlation" ? undefined : input.deliveryId;
    const correlationKey = kind === "missing-correlation" ? undefined : input.correlationKey;
    const candidate = {
      path: "docs/runbook.md",
      body: candidateBody,
      line: 2,
      side: "RIGHT" as const,
      reviewOutputKey,
      deliveryId,
      correlationKey,
    };
    const baseEvidence = {
      fingerprint: candidateKey(candidate),
      candidateKey: candidateKey(candidate),
      duplicate: false,
      privateOnly: true,
      evidenceId: `evidence-${kind}`,
      source: "docs-config-truth",
    };
    const decision = kind === "partial"
      ? "partially_verified"
      : kind === "dispute"
        ? "disagreement"
        : kind === "unclassifiable"
          ? "unclassifiable"
          : "candidate";

    return buildShadowResult(input, [
      {
        ...baseEvidence,
        decision,
        ...(kind === "dispute" || kind === "unclassifiable"
          ? {
            specialistProse: deniedSpecialistCanary,
            prompt: promptCanary,
            diff: diffCanary,
            rawFingerprint: fingerprintCanary,
            toolPayload: toolPayloadCanary,
            evidencePayload: evidencePayloadCanary,
            body: specialistCanary,
            inlineComment: specialistInlineCanary,
          }
          : {}),
      },
    ], kind === "dispute" || kind === "unclassifiable"
      ? { redactionFlags: { unsafeFieldCount: 7, discardedRawPayload: true, discardedPublicationFields: true, discardedApprovalFields: false } }
      : {});
  };
}

function visibleBodies(scenario: Pick<IntegrationScenarioResult, "issueCreatePayloads" | "issueUpdatePayloads" | "reviewCreatePayloads" | "reviewUpdatePayloads" | "reviewCommentPayloads">): string[] {
  return [
    ...scenario.issueCreatePayloads.map((payload) => String(payload.body ?? "")),
    ...scenario.issueUpdatePayloads.map((payload) => String(payload.body ?? "")),
    ...scenario.reviewCreatePayloads.map((payload) => String(payload.body ?? "")),
    ...scenario.reviewUpdatePayloads.map((payload) => String(payload.body ?? "")),
    ...scenario.reviewCommentPayloads.map((payload) => String(payload.body ?? "")),
  ];
}

function latestEvidence(evidenceEvents: CandidateVerificationPublicationEvidenceSummary[]): CandidateVerificationPublicationEvidenceSummary {
  const evidence = evidenceEvents.at(-1);
  if (!evidence) {
    throw new Error("MCP candidate verification evidence sink did not emit");
  }
  return evidence;
}

async function runProductionLikeScenario(params: {
  kind: ScenarioKind;
  candidateBody: string;
  verifierScenario: M070ScenarioName;
  expectedStatus: M070StatusCode;
  fallbackAfterDenied?: boolean;
}): Promise<IntegrationScenarioResult> {
  let executorInput: ExecutionContext | undefined;
  let inlineResult: ToolResult | undefined;
  let fallbackResult: ToolResult | undefined;
  const evidenceEvents: CandidateVerificationPublicationEvidenceSummary[] = [];

  const result = await runReviewWithShadowMetrics({
    autoApprove: false,
    shadowSpecialistSubflow: buildShadowSubflow(params.kind, params.candidateBody),
    executorExecute: async ({ input, octokit, logger }) => {
      executorInput = input;
      const publishEvents: ExecutionPublishEvent[] = [];
      const servers = buildMcpServers({
        getOctokit: async () => octokit as never,
        owner: input.owner,
        repo: input.repo,
        prNumber: input.prNumber,
        commentId: input.commentId,
        botHandles: input.botHandles,
        reviewOutputKey: input.reviewOutputKey,
        deliveryId: input.deliveryId,
        logger,
        onPublishEvent: (event) => publishEvents.push(event),
        enableInlineTools: true,
        enableCommentTools: true,
        candidateVerificationContext: input.candidateVerificationContext,
        candidateVerificationPublicationEvidenceSink: (summary) => evidenceEvents.push(summary),
      });

      inlineResult = await getToolHandler(servers.github_inline_comment, "create_inline_comment")({
        path: "docs/runbook.md",
        body: params.candidateBody,
        line: 2,
        side: "RIGHT",
      });

      if (params.fallbackAfterDenied) {
        fallbackResult = await getToolHandler(servers.github_comment, "create_comment")({
          issueNumber: input.prNumber,
          body: `fallback ${deniedCandidateCanary}`,
        });
      }

      const evidence = latestEvidence(evidenceEvents);
      return {
        conclusion: "success",
        published: inlineResult?.isError ? false : true,
        costUsd: 0,
        numTurns: 1,
        durationMs: 1,
        sessionId: "session-m070-normal-review-integration",
        errorMessage: undefined,
        model: undefined,
        inputTokens: undefined,
        outputTokens: undefined,
        cacheReadTokens: undefined,
        cacheCreationTokens: undefined,
        stopReason: undefined,
        publishEvents,
        candidateVerificationPublicationEvidence: evidence,
      } satisfies ExecutionResult;
    },
  });

  if (!executorInput || !inlineResult) {
    throw new Error("scenario did not reach executor MCP publication attempt");
  }
  const evidence = latestEvidence(evidenceEvents);
  const verifierReport = evaluateM070VerifierScenario({
    scenario: params.verifierScenario,
    aggregateEvidence: evidence,
    publicationMode: {
      candidateApprovedNonFallback: inlineResult.isError !== true && result.reviewCommentPayloads.length === 1,
      directFallbackEvidence: false,
    },
  }, { generatedAt: "2026-05-10T00:00:00.000Z" });
  expect(verifierReport.status_code).toBe(params.expectedStatus);

  return { ...result, executorInput, inlineResult, fallbackResult, evidence, verifierReport };
}

function expectCorrelationEverywhere(scenario: IntegrationScenarioResult) {
  const context = scenario.executorInput.candidateVerificationContext;
  expect(context).toMatchObject({
    deliveryId: "delivery-shadow-metrics",
    reviewOutputKey: scenario.executorInput.reviewOutputKey,
  });
  expect(typeof context?.correlationKey).toBe("string");
  expect(context?.docsConfigTruth).toMatchObject({
    deliveryId: "delivery-shadow-metrics",
    reviewOutputKey: scenario.executorInput.reviewOutputKey,
    correlationKey: context?.correlationKey,
  });
  expect(scenario.evidence.metadata).toMatchObject({
    hasDeliveryId: true,
    hasReviewOutputKey: true,
    hasCorrelationKey: true,
    deliveryId: "delivery-shadow-metrics",
    reviewOutputKey: scenario.executorInput.reviewOutputKey,
    correlationKey: context?.correlationKey,
  });

  const log = scenario.entries.find((entry) => entry.data?.gate === "m070-candidate-verification-evidence");
  expect(log?.data).toMatchObject({
    gate: "m070-candidate-verification-evidence",
    hasDeliveryId: true,
    hasReviewOutputKey: true,
    hasCorrelationKey: true,
    deliveryId: "delivery-shadow-metrics",
    reviewOutputKey: scenario.executorInput.reviewOutputKey,
    correlationKey: context?.correlationKey,
    boundedness: "aggregate-only",
  });
  expect(scenario.verifierReport.correlationMetadata).toMatchObject({
    hasDeliveryId: true,
    hasReviewOutputKey: true,
    hasCorrelationKey: true,
  });

  const detailsBody = visibleBodies(scenario).find((body) => body.includes("M070 candidate verification publication"));
  expect(detailsBody).toContain("metadata=deliveryId:y,reviewOutputKey:y,correlationKey:y");
  expect(detailsBody).not.toContain("deliveryIdValue:delivery-shadow-metrics");
  expect(detailsBody).not.toContain(`reviewOutputKeyValue:${scenario.executorInput.reviewOutputKey}`);
  expect(detailsBody).not.toContain(`correlationKeyValue:${context?.correlationKey}`);
}

function expectAggregateOnlySurfaces(scenario: IntegrationScenarioResult, forbiddenValues: string[]) {
  const serialized = JSON.stringify({
    prompt: scenario.executorInput.prompt,
    triggerBody: scenario.executorInput.triggerBody,
    inlineResult: scenario.inlineResult,
    fallbackResult: scenario.fallbackResult,
    logs: scenario.entries,
    visibleBodies: visibleBodies(scenario),
    verifierReport: scenario.verifierReport,
    evidence: scenario.evidence,
  });
  for (const forbidden of forbiddenValues) {
    expect(serialized).not.toContain(forbidden);
  }
  expect(scenario.verifierReport.redaction).toMatchObject({
    privateOnly: true,
    candidateBodiesIncluded: false,
    specialistProseIncluded: false,
    rawPromptsIncluded: false,
    rawModelOutputIncluded: false,
    diffsIncluded: false,
    evidencePayloadsIncluded: false,
    rawFingerprintsIncluded: false,
    publicationEvidenceIncluded: false,
    candidateAttemptIncluded: false,
    candidateKeyIncluded: false,
  });
}

describe("production-like normal review M070 candidate verification integration", () => {
  test.each([
    ["verified", safeVerifiedBody, "candidate_approved_verified", "m070_candidate_approved_verified_ok"],
    ["partial", safePartialBody, "candidate_approved_partial_undisputed", "m070_candidate_approved_partial_ok"],
  ] as const)("publishes candidate-approved non-fallback inline output for %s evidence and satisfies the M070 verifier", async (kind, candidateBody, verifierScenario, expectedStatus) => {
    const scenario = await runProductionLikeScenario({
      kind,
      candidateBody,
      verifierScenario,
      expectedStatus,
    });

    expect(scenario.inlineResult.isError).toBeUndefined();
    expect(scenario.inlineResult.content[0]?.text).toContain('"success":true');
    expect(scenario.reviewCommentPayloads).toHaveLength(1);
    expect(String(scenario.reviewCommentPayloads[0]?.body)).toContain(candidateBody);
    expect(scenario.issueCreatePayloads).toHaveLength(1);
    expect(scenario.reviewCreatePayloads).toHaveLength(0);
    expect(scenario.verifierReport.success).toBe(true);
    expect(scenario.verifierReport.publicationMode).toEqual({ candidateApprovedNonFallback: true, directFallbackEvidence: false });
    expect(scenario.evidence.counts).toMatchObject({ attempted: 1, allowed: 1, denied: 0, published: 1 });
    expect(scenario.evidence.redactionFlags.publicationEvidenceIncluded).toBe(false);
    expectCorrelationEverywhere(scenario);
    expect(visibleBodies(scenario).filter((body) => body.includes("M070 candidate verification publication"))).toHaveLength(1);
  });

  test.each([
    ["dispute", "dispute_blocked", "m070_dispute_blocked"],
    ["unclassifiable", "unclassifiable_blocked", "m070_unclassifiable_blocked"],
    ["malformed", "unclassifiable_blocked", "m070_unclassifiable_blocked"],
    ["missing-correlation", "unclassifiable_blocked", "m070_unclassifiable_blocked"],
    ["missing-aggregate", "unclassifiable_blocked", "m070_unclassifiable_blocked"],
  ] as const)("fails closed for %s evidence before visible GitHub candidate publication", async (kind, verifierScenario, expectedStatus) => {
    const scenario = await runProductionLikeScenario({
      kind,
      candidateBody: deniedCandidateCanary,
      verifierScenario,
      expectedStatus,
    });

    expect(scenario.inlineResult.isError).toBe(true);
    expect(scenario.inlineResult.content[0]?.text).toContain("m070-candidate-verification-denied");
    expect(scenario.reviewCommentPayloads).toHaveLength(0);
    expect(scenario.issueCreatePayloads).toHaveLength(1);
    expect(visibleBodies(scenario).join("\n")).not.toContain(deniedCandidateCanary);
    expect(scenario.verifierReport.success).toBe(false);
    expect(scenario.verifierReport.status_code).toBe(expectedStatus);
    expect(scenario.evidence.counts.denied).toBe(1);
    expect(scenario.evidence.counts.published).toBe(0);
    expect(scenario.evidence.redactionFlags.publicationEvidenceIncluded).toBe(false);

    const denialLog = scenario.entries.find((entry) => entry.data?.gate === "m070-candidate-publication-policy");
    expect(denialLog?.data).toHaveProperty("reasonCategories");
    expect(denialLog?.data).toHaveProperty("redactionFlags");
    expect(denialLog?.data).not.toHaveProperty("body");
    expect(denialLog?.data).not.toHaveProperty("candidate");
    expect(denialLog?.data).not.toHaveProperty("docsConfigTruth");

    expectAggregateOnlySurfaces(scenario, [
      deniedCandidateCanary,
      deniedSpecialistCanary,
      promptCanary,
      diffCanary,
      fingerprintCanary,
      toolPayloadCanary,
      evidencePayloadCanary,
      specialistCanary,
      specialistInlineCanary,
    ]);
  });

  test("blocks direct fallback after denied inline publication without leaking candidate content", async () => {
    const scenario = await runProductionLikeScenario({
      kind: "dispute",
      candidateBody: deniedCandidateCanary,
      verifierScenario: "dispute_blocked",
      expectedStatus: "m070_dispute_blocked",
      fallbackAfterDenied: true,
    });

    expect(scenario.inlineResult.isError).toBe(true);
    expect(scenario.fallbackResult?.isError).toBe(true);
    expect(scenario.fallbackResult?.content[0]?.text).toContain('"fallback_blocked":true');
    expect(scenario.fallbackResult?.content[0]?.text).toContain('"candidate_publication_state":"skipped"');
    expect(scenario.reviewCommentPayloads).toHaveLength(0);
    expect(scenario.issueCreatePayloads).toHaveLength(1);
    expect(visibleBodies(scenario).join("\n")).not.toContain(deniedCandidateCanary);
    expect(scenario.evidence.counts).toMatchObject({ attempted: 1, allowed: 0, denied: 1, published: 0, skipped: 1 });
    expect(scenario.verifierReport.success).toBe(false);
    expect(scenario.verifierReport.status_code).toBe("m070_dispute_blocked");
    expectAggregateOnlySurfaces(scenario, [
      deniedCandidateCanary,
      deniedSpecialistCanary,
      promptCanary,
      diffCanary,
      fingerprintCanary,
      toolPayloadCanary,
      evidencePayloadCanary,
      specialistCanary,
      specialistInlineCanary,
    ]);
  });
});
