import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import type { Logger } from "pino";

import { buildMcpServers } from "../execution/mcp/index.ts";
import type { ExecutionContext, ExecutionResult } from "../execution/types.ts";
import type { CandidatePublicationPolicyAttempt } from "../specialists/candidate-publication-policy.ts";
import type { ShadowSpecialistSubflowInput, ShadowSpecialistSubflowResult } from "../specialists/shadow-specialist-subflow.ts";
import { runReviewWithShadowMetrics, specialistCanary, specialistInlineCanary } from "./review-shadow-specialist-metrics.test.ts";

const deniedCandidateCanary = "M070_DENIED_CANDIDATE_BODY_SHOULD_NOT_LEAK";
const deniedSpecialistCanary = "M070_DENIED_SPECIALIST_PROSE_SHOULD_NOT_LEAK";

type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

type ToolHandler = (input: Record<string, unknown>) => Promise<ToolResult>;

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
    durationMs: 3,
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

async function runHandlerMcpPublicationScenario(params: {
  candidateBody: string;
  evidenceDecision?: "candidate" | "partially_verified" | "dismissed" | "disagreement" | "unclassifiable";
  shadowMode?: "matching" | "missing" | "malformed" | "stale-key" | "unsafe-canary";
  fallbackAfterDenied?: boolean;
}) {
  let inlineResult: ToolResult | undefined;
  let fallbackResult: ToolResult | undefined;
  let executorInput: ExecutionContext | undefined;

  const result = await runReviewWithShadowMetrics({
    autoApprove: false,
    shadowSpecialistSubflow: async (input) => {
      if (params.shadowMode === "missing") {
        throw new Error("projection unavailable");
      }
      const reviewOutputKey = params.shadowMode === "stale-key" ? `${input.reviewOutputKey}-stale` : input.reviewOutputKey;
      const candidate = {
        path: "docs/runbook.md",
        body: params.candidateBody,
        line: 2,
        side: "RIGHT" as const,
        reviewOutputKey,
        deliveryId: input.deliveryId,
      };
      if (params.shadowMode === "malformed") {
        return buildShadowResult(input, "not-an-array", { status: "degraded", errorKind: "invalid-output-shape" });
      }
      return buildShadowResult(input, [
        {
          fingerprint: candidateKey(candidate),
          decision: params.evidenceDecision ?? "candidate",
          duplicate: false,
          privateOnly: true,
          ...(params.shadowMode === "unsafe-canary" ? { specialistProse: deniedSpecialistCanary, body: specialistCanary, inlineComment: specialistInlineCanary } : {}),
        },
      ], params.shadowMode === "unsafe-canary"
        ? { redactionFlags: { unsafeFieldCount: 3, discardedRawPayload: false, discardedPublicationFields: true, discardedApprovalFields: false } }
        : {});
    },
    executorExecute: async ({ input, octokit, logger }) => {
      executorInput = input;
      const publishedEvents: unknown[] = [];
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
        onPublishEvent: (event) => publishedEvents.push(event),
        enableInlineTools: true,
        enableCommentTools: true,
        candidateVerificationContext: input.candidateVerificationContext,
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
          body: `fallback body ${deniedCandidateCanary}`,
        });
      }
      return {
        conclusion: "success",
        published: inlineResult?.isError ? false : true,
        costUsd: 0,
        numTurns: 1,
        durationMs: 1,
        sessionId: "session-m070-handler-mcp",
        errorMessage: undefined,
        model: undefined,
        inputTokens: undefined,
        outputTokens: undefined,
        cacheReadTokens: undefined,
        cacheCreationTokens: undefined,
        stopReason: undefined,
      } satisfies ExecutionResult;
    },
  });

  return { ...result, inlineResult, fallbackResult, executorInput };
}

describe("review handler M070 candidate verification publication wiring", () => {
  test.each([
    ["verified candidate", "candidate"],
    ["undisputed safe partial candidate", "partially_verified"],
  ] as const)("allows %s through the real MCP inline publication server", async (_label, evidenceDecision) => {
    const scenario = await runHandlerMcpPublicationScenario({
      candidateBody: "SAFE INLINE REVIEW BODY",
      evidenceDecision,
    });

    expect(scenario.executorInput?.candidateVerificationContext).toMatchObject({
      deliveryId: "delivery-shadow-metrics",
      reviewOutputKey: scenario.executorInput?.reviewOutputKey,
    });
    expect(scenario.inlineResult?.isError).toBeUndefined();
    expect(scenario.inlineResult?.content[0]?.text).toContain('"success":true');
    expect(scenario.reviewCommentPayloads).toHaveLength(1);
    expect(String(scenario.reviewCommentPayloads[0]?.body)).toContain("SAFE INLINE REVIEW BODY");
  });

  test.each([
    ["disputed", { candidateBody: deniedCandidateCanary, evidenceDecision: "disagreement" as const, shadowMode: "unsafe-canary" as const }],
    ["unverified", { candidateBody: deniedCandidateCanary, evidenceDecision: "dismissed" as const }],
    ["disproven", { candidateBody: deniedCandidateCanary, evidenceDecision: "disagreement" as const }],
    ["malformed", { candidateBody: deniedCandidateCanary, shadowMode: "malformed" as const }],
    ["missing aggregate", { candidateBody: deniedCandidateCanary, shadowMode: "missing" as const }],
    ["stale review output key", { candidateBody: deniedCandidateCanary, evidenceDecision: "candidate" as const, shadowMode: "stale-key" as const }],
    ["unclassifiable", { candidateBody: deniedCandidateCanary, evidenceDecision: "unclassifiable" as const }],
  ] as const)("denies %s candidates before GitHub-visible inline publication", async (_label, options) => {
    const scenario = await runHandlerMcpPublicationScenario(options);

    expect(scenario.inlineResult?.isError).toBe(true);
    expect(scenario.inlineResult?.content[0]?.text).toContain("m070-candidate-verification-denied");
    expect(scenario.reviewCommentPayloads).toHaveLength(0);
    expect(scenario.issueCreatePayloads).toHaveLength(1); // normal handler summary only; no top-level fallback from the MCP denial
    expect(String(scenario.issueCreatePayloads[0]?.body)).not.toContain(deniedCandidateCanary);
  });

  test("blocks direct fallback after a denied candidate and emits only bounded denial diagnostics", async () => {
    const scenario = await runHandlerMcpPublicationScenario({
      candidateBody: deniedCandidateCanary,
      evidenceDecision: "disagreement",
      shadowMode: "unsafe-canary",
      fallbackAfterDenied: true,
    });

    expect(scenario.inlineResult?.isError).toBe(true);
    expect(scenario.fallbackResult?.isError).toBe(true);
    expect(scenario.fallbackResult?.content[0]?.text).toContain('"fallback_blocked":true');
    expect(scenario.fallbackResult?.content[0]?.text).toContain('"candidate_publication_state":"skipped"');
    expect(scenario.reviewCommentPayloads).toHaveLength(0);

    const denialLog = scenario.entries.find((entry) => entry.data?.gate === "m070-candidate-publication-policy");
    expect(denialLog?.data).toMatchObject({
      gate: "m070-candidate-publication-policy",
      gateResult: "deny",
      hasDeliveryId: true,
      hasReviewOutputKey: true,
      hasCorrelationKey: true,
    });
    expect(denialLog?.data).toHaveProperty("candidateRef");
    expect(denialLog?.data).toHaveProperty("counts");
    expect(denialLog?.data).toHaveProperty("reasonCategories");
    expect(denialLog?.data).toHaveProperty("redactionFlags");
    expect(denialLog?.data).not.toHaveProperty("body");
    expect(denialLog?.data).not.toHaveProperty("candidate");
    expect(denialLog?.data).not.toHaveProperty("docsConfigTruth");

    const serializedVisible = JSON.stringify({
      prompt: scenario.executorInput?.prompt,
      triggerBody: scenario.executorInput?.triggerBody,
      inlineResult: scenario.inlineResult,
      fallbackResult: scenario.fallbackResult,
      logs: scenario.entries,
      issueBodies: scenario.issueCreatePayloads.map((payload) => payload.body),
      reviewBodies: scenario.reviewCreatePayloads.map((payload) => payload.body),
    });
    for (const forbidden of [
      deniedCandidateCanary,
      deniedSpecialistCanary,
      specialistCanary,
      specialistInlineCanary,
    ]) {
      expect(serializedVisible).not.toContain(forbidden);
    }
  });
});
