import { createHash } from "node:crypto";

import { buildMcpServers } from "../src/execution/mcp/index.ts";
import type { ExecutionContext, ExecutionResult } from "../src/execution/types.ts";
import type { CandidatePublicationPolicyAttempt } from "../src/specialists/candidate-publication-policy.ts";
import type { CandidateVerificationPublicationEvidenceSummary } from "../src/specialists/candidate-verification-publication-evidence.ts";
import type { ShadowSpecialistSubflowInput, ShadowSpecialistSubflowResult } from "../src/specialists/shadow-specialist-subflow.ts";
import { runReviewWithShadowMetrics, specialistCanary, specialistInlineCanary } from "../src/handlers/review-m070-integration-harness.ts";
import { evaluateM070VerifierScenario, type M070ScenarioName, type M070StatusCode, type M070VerifierReport } from "./verify-m070.ts";

export const COMMAND_NAME = "verify:m070:s05" as const;
export const EXPECTED_PACKAGE_SCRIPT = "bun scripts/verify-m070-s05.ts" as const;

export const M070_S05_CHECK_IDS = [
  "M070-S05-NORMAL-REVIEW-INTEGRATION",
  "M070-S05-M070-STATUS-SEMANTICS",
  "M070-S05-PUBLICATION-MODE",
  "M070-S05-CORRELATION-METADATA",
  "M070-S05-REVIEW-DETAILS-AND-LOGS",
  "M070-S05-VISIBLE-VOLUME",
  "M070-S05-REDACTION-BOUNDARY",
  "M070-S05-PACKAGE-WIRING",
] as const;

export type M070S05CheckId = (typeof M070_S05_CHECK_IDS)[number];
export type M070S05StatusCode = "m070_s05_ok" | "m070_s05_contract_failed" | "m070_s05_invalid_arg";
export type M070S05ScenarioKind = "verified" | "partial" | "dispute" | "unclassifiable" | "malformed" | "missing-correlation" | "missing-aggregate" | "direct-fallback-only";

type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean };
type ToolHandler = (input: Record<string, unknown>) => Promise<ToolResult>;

type ScenarioSpec = {
  readonly kind: M070S05ScenarioKind;
  readonly verifierScenario: M070ScenarioName;
  readonly expectedStatus: M070StatusCode;
  readonly candidateBody: string;
  readonly fallbackAfterDenied?: boolean;
};

export type M070S05ScenarioRow = {
  readonly scenario: M070S05ScenarioKind;
  readonly verifierScenario: M070ScenarioName;
  readonly success: boolean;
  readonly expectedStatus: M070StatusCode;
  readonly actualStatus: M070StatusCode;
  readonly statusMatchesExpected: boolean;
  readonly m070: M070VerifierReport;
  readonly publicationMode: {
    readonly candidateApprovedNonFallback: boolean;
    readonly directFallbackEvidence: boolean;
    readonly fallbackBlocked: boolean;
  };
  readonly correlationMetadata: {
    readonly contextHasDeliveryId: boolean;
    readonly contextHasReviewOutputKey: boolean;
    readonly contextHasCorrelationKey: boolean;
    readonly evidenceHasDeliveryId: boolean;
    readonly evidenceHasReviewOutputKey: boolean;
    readonly evidenceHasCorrelationKey: boolean;
  };
  readonly evidenceSurfaces: {
    readonly reviewDetailsPresent: boolean;
    readonly runtimeLogPresent: boolean;
    readonly mcpEvidencePresent: boolean;
  };
  readonly visibleVolume: {
    readonly issueCreateCount: number;
    readonly issueUpdateCount: number;
    readonly reviewCreateCount: number;
    readonly reviewUpdateCount: number;
    readonly reviewCommentCount: number;
    readonly totalVisibleBodies: number;
  };
  readonly denialReasonCategories: readonly string[];
  readonly redaction: {
    readonly candidateCanaryLeaked: boolean;
    readonly specialistCanaryLeaked: boolean;
    readonly rawCanaryLeaked: boolean;
    readonly verifierJsonLeakPresent: boolean;
    readonly aggregateOnly: boolean;
  };
  readonly issue_categories: readonly string[];
};

export type M070S05Check = {
  readonly id: M070S05CheckId;
  readonly passed: boolean;
  readonly status: "pass" | "fail";
  readonly detail: string;
};

export type M070S05Report = {
  readonly command: typeof COMMAND_NAME;
  readonly generated_at: string;
  readonly proofMode: "local-in-process-normal-review-integration";
  readonly proofScope: "s05-normal-review-handler-mcp-review-details-verifier-semantics";
  readonly liveExactKeyProofRequiredBy: "S06";
  readonly success: boolean;
  readonly status_code: M070S05StatusCode;
  readonly check_ids: readonly M070S05CheckId[];
  readonly checks: readonly M070S05Check[];
  readonly failing_check_id: M070S05CheckId | null;
  readonly scenarioRows: readonly M070S05ScenarioRow[];
  readonly packageWiring: { readonly scriptName: typeof COMMAND_NAME; readonly expected: typeof EXPECTED_PACKAGE_SCRIPT; readonly present: boolean; readonly matches: boolean };
  readonly visibleVolumeSummary: { readonly totalVisibleBodies: number; readonly totalInlineComments: number; readonly totalReviewDetails: number };
  readonly publicationModes: { readonly candidateApprovedNonFallbackCount: number; readonly directFallbackEvidenceCount: number; readonly fallbackBlockedCount: number };
  readonly correlationMetadata: { readonly allContextPresent: boolean; readonly allEvidencePresentForSuccessRows: boolean };
  readonly evidenceSurfaces: { readonly reviewDetailsRows: number; readonly runtimeLogRows: number; readonly mcpEvidenceRows: number };
  readonly redaction: { readonly aggregateOnly: boolean; readonly canaryLeakPresent: boolean; readonly verifierJsonLeakPresent: boolean };
  readonly issue_categories: readonly string[];
  readonly issues: readonly string[];
};

export type M070S05Args = { readonly json: boolean; readonly help: boolean };
export type M070S05Deps = {
  readonly stdout?: { write(chunk: string): void };
  readonly stderr?: { write(chunk: string): void };
  readonly runScenario?: (spec: ScenarioSpec, generatedAt: string) => Promise<M070S05ScenarioRow>;
  readonly readPackageJsonText?: () => Promise<string>;
};

const SAFE_VERIFIED_BODY = "M070 S05 SAFE VERIFIED INLINE BODY";
const SAFE_PARTIAL_BODY = "M070 S05 SAFE PARTIAL INLINE BODY";
const DENIED_CANDIDATE_CANARY = "M070_S05_DENIED_CANDIDATE_BODY_SHOULD_NOT_LEAK";
const DENIED_SPECIALIST_CANARY = "M070_S05_SPECIALIST_PROSE_SHOULD_NOT_LEAK";
const PROMPT_CANARY = "M070_S05_PROMPT_SHOULD_NOT_LEAK";
const DIFF_CANARY = "M070_S05_DIFF_SHOULD_NOT_LEAK";
const FINGERPRINT_CANARY = "M070_S05_FINGERPRINT_SHOULD_NOT_LEAK";
const TOOL_PAYLOAD_CANARY = "M070_S05_TOOL_PAYLOAD_SHOULD_NOT_LEAK";
const EVIDENCE_PAYLOAD_CANARY = "M070_S05_EVIDENCE_PAYLOAD_SHOULD_NOT_LEAK";

const SCENARIOS: readonly ScenarioSpec[] = [
  { kind: "verified", verifierScenario: "candidate_approved_verified", expectedStatus: "m070_candidate_approved_verified_ok", candidateBody: SAFE_VERIFIED_BODY },
  { kind: "partial", verifierScenario: "candidate_approved_partial_undisputed", expectedStatus: "m070_candidate_approved_partial_ok", candidateBody: SAFE_PARTIAL_BODY },
  { kind: "dispute", verifierScenario: "dispute_blocked", expectedStatus: "m070_dispute_blocked", candidateBody: DENIED_CANDIDATE_CANARY },
  { kind: "unclassifiable", verifierScenario: "unclassifiable_blocked", expectedStatus: "m070_unclassifiable_blocked", candidateBody: DENIED_CANDIDATE_CANARY },
  { kind: "malformed", verifierScenario: "unclassifiable_blocked", expectedStatus: "m070_unclassifiable_blocked", candidateBody: DENIED_CANDIDATE_CANARY },
  { kind: "missing-correlation", verifierScenario: "unclassifiable_blocked", expectedStatus: "m070_unclassifiable_blocked", candidateBody: DENIED_CANDIDATE_CANARY },
  { kind: "missing-aggregate", verifierScenario: "unclassifiable_blocked", expectedStatus: "m070_unclassifiable_blocked", candidateBody: DENIED_CANDIDATE_CANARY },
  { kind: "direct-fallback-only", verifierScenario: "dispute_blocked", expectedStatus: "m070_dispute_blocked", candidateBody: DENIED_CANDIDATE_CANARY, fallbackAfterDenied: true },
] as const;

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

function buildShadowResult(input: ShadowSpecialistSubflowInput, candidates: unknown, overrides: Partial<ShadowSpecialistSubflowResult["output"]> = {}): ShadowSpecialistSubflowResult {
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

function buildShadowSubflow(kind: M070S05ScenarioKind, candidateBody: string) {
  return async (input: ShadowSpecialistSubflowInput): Promise<ShadowSpecialistSubflowResult> => {
    if (kind === "missing-aggregate") throw new Error("docs/config truth aggregate unavailable");
    if (kind === "malformed") return buildShadowResult(input, "not-an-array", { status: "degraded", errorKind: "invalid-output-shape" });

    const reviewOutputKey = kind === "missing-correlation" ? undefined : input.reviewOutputKey;
    const deliveryId = kind === "missing-correlation" ? undefined : input.deliveryId;
    const correlationKey = kind === "missing-correlation" ? undefined : input.correlationKey;
    const candidate = { path: "docs/runbook.md", body: candidateBody, line: 2, side: "RIGHT" as const, reviewOutputKey, deliveryId, correlationKey };
    const baseEvidence = { fingerprint: candidateKey(candidate), candidateKey: candidateKey(candidate), duplicate: false, privateOnly: true, evidenceId: `evidence-${kind}`, source: "docs-config-truth" };
    const decision = kind === "partial" ? "partially_verified" : kind === "dispute" || kind === "direct-fallback-only" ? "disagreement" : kind === "unclassifiable" ? "unclassifiable" : "candidate";
    const unsafe = kind === "dispute" || kind === "unclassifiable" || kind === "direct-fallback-only";

    return buildShadowResult(input, [{
      ...baseEvidence,
      decision,
      ...(unsafe ? {
        specialistProse: DENIED_SPECIALIST_CANARY,
        prompt: PROMPT_CANARY,
        diff: DIFF_CANARY,
        rawFingerprint: FINGERPRINT_CANARY,
        toolPayload: TOOL_PAYLOAD_CANARY,
        evidencePayload: EVIDENCE_PAYLOAD_CANARY,
        body: specialistCanary,
        inlineComment: specialistInlineCanary,
      } : {}),
    }], unsafe ? { redactionFlags: { unsafeFieldCount: 7, discardedRawPayload: true, discardedPublicationFields: true, discardedApprovalFields: false } } : {});
  };
}

function getToolHandler(server: unknown, name: string): ToolHandler {
  const instance = (server as { instance?: unknown }).instance as { _registeredTools?: Record<string, { handler: ToolHandler }> };
  const tool = instance._registeredTools?.[name];
  if (!tool) throw new Error(`${name} tool is not registered`);
  return tool.handler;
}

function latestEvidence(evidenceEvents: CandidateVerificationPublicationEvidenceSummary[]): CandidateVerificationPublicationEvidenceSummary {
  const evidence = evidenceEvents.at(-1);
  if (!evidence) throw new Error("MCP candidate verification evidence sink did not emit");
  return evidence;
}

function visibleBodies(result: Awaited<ReturnType<typeof runReviewWithShadowMetrics>>): string[] {
  return [
    ...result.issueCreatePayloads.map((payload) => String(payload.body ?? "")),
    ...result.issueUpdatePayloads.map((payload) => String(payload.body ?? "")),
    ...result.reviewCreatePayloads.map((payload) => String(payload.body ?? "")),
    ...result.reviewUpdatePayloads.map((payload) => String(payload.body ?? "")),
    ...result.reviewCommentPayloads.map((payload) => String(payload.body ?? "")),
  ];
}

function rowIssues(row: Omit<M070S05ScenarioRow, "issue_categories">): string[] {
  const issues: string[] = [];
  if (!row.statusMatchesExpected) issues.push("scenario-status-drift");
  if (row.scenario === "direct-fallback-only" && !row.publicationMode.fallbackBlocked) issues.push("direct-fallback-not-blocked");
  if ((row.scenario === "verified" || row.scenario === "partial") && !row.publicationMode.candidateApprovedNonFallback) issues.push("candidate-publication-missing");
  if (row.redaction.candidateCanaryLeaked || row.redaction.specialistCanaryLeaked || row.redaction.rawCanaryLeaked || row.redaction.verifierJsonLeakPresent) issues.push("redaction-leak");
  if (!row.evidenceSurfaces.reviewDetailsPresent || !row.evidenceSurfaces.runtimeLogPresent || !row.evidenceSurfaces.mcpEvidencePresent) issues.push("evidence-surface-missing");
  return [...new Set(issues)];
}

export async function runM070S05Scenario(spec: ScenarioSpec, generatedAt: string): Promise<M070S05ScenarioRow> {
  let executorInput: ExecutionContext | undefined;
  let inlineResult: ToolResult | undefined;
  let fallbackResult: ToolResult | undefined;
  const evidenceEvents: CandidateVerificationPublicationEvidenceSummary[] = [];

  const result = await runReviewWithShadowMetrics({
    autoApprove: false,
    shadowSpecialistSubflow: buildShadowSubflow(spec.kind, spec.candidateBody),
    executorExecute: async ({ input, octokit, logger }) => {
      executorInput = input;
      const publishEvents: unknown[] = [];
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

      inlineResult = await getToolHandler(servers.github_inline_comment, "create_inline_comment")({ path: "docs/runbook.md", body: spec.candidateBody, line: 2, side: "RIGHT" });
      if (spec.fallbackAfterDenied) {
        fallbackResult = await getToolHandler(servers.github_comment, "create_comment")({ issueNumber: input.prNumber, body: `fallback ${DENIED_CANDIDATE_CANARY}` });
      }
      const evidence = latestEvidence(evidenceEvents);
      return { conclusion: "success", published: inlineResult?.isError ? false : true, costUsd: 0, numTurns: 1, durationMs: 1, sessionId: "session-m070-s05-normal-review-integration", errorMessage: undefined, model: undefined, inputTokens: undefined, outputTokens: undefined, cacheReadTokens: undefined, cacheCreationTokens: undefined, stopReason: undefined, publishEvents, candidateVerificationPublicationEvidence: evidence } satisfies ExecutionResult;
    },
  });

  if (!executorInput || !inlineResult) throw new Error("scenario did not reach executor MCP publication attempt");
  const evidence = latestEvidence(evidenceEvents);
  const candidateApprovedNonFallback = inlineResult.isError !== true && result.reviewCommentPayloads.length === 1;
  const directFallbackEvidence = spec.fallbackAfterDenied === true;
  const m070 = evaluateM070VerifierScenario({ scenario: spec.verifierScenario, aggregateEvidence: evidence, publicationMode: { candidateApprovedNonFallback, directFallbackEvidence: false } }, { generatedAt });
  const bodies = visibleBodies(result);
  const serializedVisible = bodies.join("\n");
  const serializedVerifier = JSON.stringify(m070);
  const rawCanaries = [PROMPT_CANARY, DIFF_CANARY, FINGERPRINT_CANARY, TOOL_PAYLOAD_CANARY, EVIDENCE_PAYLOAD_CANARY, specialistCanary, specialistInlineCanary];
  const baseRow = {
    scenario: spec.kind,
    verifierScenario: spec.verifierScenario,
    success: m070.success,
    expectedStatus: spec.expectedStatus,
    actualStatus: m070.status_code,
    statusMatchesExpected: m070.status_code === spec.expectedStatus,
    m070,
    publicationMode: { candidateApprovedNonFallback, directFallbackEvidence, fallbackBlocked: fallbackResult?.isError === true },
    correlationMetadata: {
      contextHasDeliveryId: typeof executorInput.candidateVerificationContext?.deliveryId === "string",
      contextHasReviewOutputKey: typeof executorInput.candidateVerificationContext?.reviewOutputKey === "string",
      contextHasCorrelationKey: typeof executorInput.candidateVerificationContext?.correlationKey === "string",
      evidenceHasDeliveryId: evidence.metadata.hasDeliveryId,
      evidenceHasReviewOutputKey: evidence.metadata.hasReviewOutputKey,
      evidenceHasCorrelationKey: evidence.metadata.hasCorrelationKey,
    },
    evidenceSurfaces: {
      reviewDetailsPresent: bodies.some((body) => body.includes("M070 candidate verification publication")),
      runtimeLogPresent: result.entries.some((entry) => entry.data?.gate === "m070-candidate-verification-evidence"),
      mcpEvidencePresent: evidenceEvents.length > 0,
    },
    visibleVolume: {
      issueCreateCount: result.issueCreatePayloads.length,
      issueUpdateCount: result.issueUpdatePayloads.length,
      reviewCreateCount: result.reviewCreatePayloads.length,
      reviewUpdateCount: result.reviewUpdatePayloads.length,
      reviewCommentCount: result.reviewCommentPayloads.length,
      totalVisibleBodies: bodies.length,
    },
    denialReasonCategories: m070.aggregateEvidence.reasonCategories,
    redaction: {
      candidateCanaryLeaked: serializedVisible.includes(DENIED_CANDIDATE_CANARY),
      specialistCanaryLeaked: serializedVisible.includes(DENIED_SPECIALIST_CANARY),
      rawCanaryLeaked: rawCanaries.some((canary) => serializedVisible.includes(canary)),
      verifierJsonLeakPresent: [DENIED_CANDIDATE_CANARY, DENIED_SPECIALIST_CANARY, ...rawCanaries].some((canary) => serializedVerifier.includes(canary)),
      aggregateOnly: !m070.redaction.candidateBodiesIncluded && !m070.redaction.specialistProseIncluded && !m070.redaction.rawPromptsIncluded && !m070.redaction.rawModelOutputIncluded && !m070.redaction.diffsIncluded && !m070.redaction.evidencePayloadsIncluded && !m070.redaction.rawFingerprintsIncluded && !m070.redaction.publicationEvidenceIncluded && !m070.redaction.candidateAttemptIncluded && !m070.redaction.candidateKeyIncluded,
    },
  } satisfies Omit<M070S05ScenarioRow, "issue_categories">;
  return { ...baseRow, issue_categories: rowIssues(baseRow) };
}

function parsePackageWiring(packageJsonText: string): M070S05Report["packageWiring"] {
  try {
    const parsed = JSON.parse(packageJsonText) as { scripts?: Record<string, unknown> };
    const script = parsed.scripts?.[COMMAND_NAME];
    return { scriptName: COMMAND_NAME, expected: EXPECTED_PACKAGE_SCRIPT, present: typeof script === "string", matches: script === EXPECTED_PACKAGE_SCRIPT };
  } catch {
    return { scriptName: COMMAND_NAME, expected: EXPECTED_PACKAGE_SCRIPT, present: false, matches: false };
  }
}

function makeCheck(id: M070S05CheckId, passed: boolean, detail: string): M070S05Check {
  return { id, passed, status: passed ? "pass" : "fail", detail };
}

export async function evaluateM070S05Integration(options: { generatedAt?: string; runScenario?: (spec: ScenarioSpec, generatedAt: string) => Promise<M070S05ScenarioRow>; readPackageJsonText?: () => Promise<string> } = {}): Promise<M070S05Report> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const runScenario = options.runScenario ?? runM070S05Scenario;
  const rows: M070S05ScenarioRow[] = [];
  const issues: string[] = [];
  const issueCategories = new Set<string>();

  for (const spec of SCENARIOS) {
    try {
      rows.push(await runScenario(spec, generatedAt));
    } catch {
      const m070 = evaluateM070VerifierScenario({ scenario: spec.verifierScenario, aggregateEvidence: null, publicationMode: { candidateApprovedNonFallback: false, directFallbackEvidence: false } }, { generatedAt });
      rows.push({ scenario: spec.kind, verifierScenario: spec.verifierScenario, success: false, expectedStatus: spec.expectedStatus, actualStatus: m070.status_code, statusMatchesExpected: false, m070, publicationMode: { candidateApprovedNonFallback: false, directFallbackEvidence: false, fallbackBlocked: false }, correlationMetadata: { contextHasDeliveryId: false, contextHasReviewOutputKey: false, contextHasCorrelationKey: false, evidenceHasDeliveryId: false, evidenceHasReviewOutputKey: false, evidenceHasCorrelationKey: false }, evidenceSurfaces: { reviewDetailsPresent: false, runtimeLogPresent: false, mcpEvidencePresent: false }, visibleVolume: { issueCreateCount: 0, issueUpdateCount: 0, reviewCreateCount: 0, reviewUpdateCount: 0, reviewCommentCount: 0, totalVisibleBodies: 0 }, denialReasonCategories: [], redaction: { candidateCanaryLeaked: false, specialistCanaryLeaked: false, rawCanaryLeaked: false, verifierJsonLeakPresent: false, aggregateOnly: true }, issue_categories: ["scenario-runner-failed"] });
    }
  }

  const packageWiring = parsePackageWiring(await (options.readPackageJsonText ?? (() => Bun.file("package.json").text()))());
  for (const row of rows) for (const category of row.issue_categories) issueCategories.add(category);
  if (!packageWiring.matches) issueCategories.add("package-wiring");

  const positiveRows = rows.filter((row) => row.scenario === "verified" || row.scenario === "partial");
  const negativeRows = rows.filter((row) => !positiveRows.includes(row));
  const allStatusesMatch = rows.every((row) => row.statusMatchesExpected);
  const positivePublish = positiveRows.every((row) => row.success && row.publicationMode.candidateApprovedNonFallback && !row.publicationMode.directFallbackEvidence);
  const negativeRejected = negativeRows.every((row) => !row.success && !row.publicationMode.candidateApprovedNonFallback);
  const directFallbackRejected = rows.find((row) => row.scenario === "direct-fallback-only")?.publicationMode.fallbackBlocked === true;
  const successRowsHaveCorrelation = positiveRows.every((row) => row.correlationMetadata.contextHasDeliveryId && row.correlationMetadata.contextHasReviewOutputKey && row.correlationMetadata.contextHasCorrelationKey && row.correlationMetadata.evidenceHasDeliveryId && row.correlationMetadata.evidenceHasReviewOutputKey && row.correlationMetadata.evidenceHasCorrelationKey);
  const surfacesPresent = rows.every((row) => row.evidenceSurfaces.reviewDetailsPresent && row.evidenceSurfaces.runtimeLogPresent && row.evidenceSurfaces.mcpEvidencePresent);
  const volumeBounded = rows.every((row) => row.visibleVolume.totalVisibleBodies <= 2 && row.visibleVolume.reviewCommentCount <= 1);
  const aggregateOnly = rows.every((row) => row.redaction.aggregateOnly && !row.redaction.candidateCanaryLeaked && !row.redaction.specialistCanaryLeaked && !row.redaction.rawCanaryLeaked && !row.redaction.verifierJsonLeakPresent);

  const checks = [
    makeCheck("M070-S05-NORMAL-REVIEW-INTEGRATION", rows.length === SCENARIOS.length && rows.every((row) => row.evidenceSurfaces.mcpEvidencePresent), "All local scenarios reached the normal review executor and MCP evidence sink."),
    makeCheck("M070-S05-M070-STATUS-SEMANTICS", allStatusesMatch && positiveRows.every((row) => row.success) && negativeRows.every((row) => !row.success), "Scenario rows match expected M070 verifier status semantics."),
    makeCheck("M070-S05-PUBLICATION-MODE", positivePublish && negativeRejected && directFallbackRejected, "Candidate-approved inline publication is distinguished from denied/direct fallback behavior."),
    makeCheck("M070-S05-CORRELATION-METADATA", successRowsHaveCorrelation, "Successful rows carry delivery, review output, and correlation metadata booleans through context and evidence."),
    makeCheck("M070-S05-REVIEW-DETAILS-AND-LOGS", surfacesPresent, "Each scenario emits Review Details and runtime log aggregate evidence surfaces."),
    makeCheck("M070-S05-VISIBLE-VOLUME", volumeBounded, "Visible output counts remain locally bounded."),
    makeCheck("M070-S05-REDACTION-BOUNDARY", aggregateOnly, "Verifier JSON and visible surfaces exclude raw candidate/specialist/model/tool/diff/evidence payloads."),
    makeCheck("M070-S05-PACKAGE-WIRING", packageWiring.matches, "package.json exposes verify:m070:s05."),
  ] as const;
  const failingCheck = checks.find((check) => !check.passed) ?? null;
  if (failingCheck) issues.push(failingCheck.detail);
  if (!allStatusesMatch) issues.push("One or more S05 integration scenarios drifted from expected M070 status codes.");
  if (!packageWiring.matches) issues.push(`package.json scripts.${COMMAND_NAME} must equal ${EXPECTED_PACKAGE_SCRIPT}.`);

  return {
    command: COMMAND_NAME,
    generated_at: generatedAt,
    proofMode: "local-in-process-normal-review-integration",
    proofScope: "s05-normal-review-handler-mcp-review-details-verifier-semantics",
    liveExactKeyProofRequiredBy: "S06",
    success: failingCheck === null,
    status_code: failingCheck === null ? "m070_s05_ok" : "m070_s05_contract_failed",
    check_ids: M070_S05_CHECK_IDS,
    checks,
    failing_check_id: failingCheck?.id ?? null,
    scenarioRows: rows,
    packageWiring,
    visibleVolumeSummary: { totalVisibleBodies: rows.reduce((sum, row) => sum + row.visibleVolume.totalVisibleBodies, 0), totalInlineComments: rows.reduce((sum, row) => sum + row.visibleVolume.reviewCommentCount, 0), totalReviewDetails: rows.filter((row) => row.evidenceSurfaces.reviewDetailsPresent).length },
    publicationModes: { candidateApprovedNonFallbackCount: rows.filter((row) => row.publicationMode.candidateApprovedNonFallback).length, directFallbackEvidenceCount: rows.filter((row) => row.publicationMode.directFallbackEvidence).length, fallbackBlockedCount: rows.filter((row) => row.publicationMode.fallbackBlocked).length },
    correlationMetadata: { allContextPresent: rows.every((row) => row.correlationMetadata.contextHasDeliveryId && row.correlationMetadata.contextHasReviewOutputKey && row.correlationMetadata.contextHasCorrelationKey), allEvidencePresentForSuccessRows: successRowsHaveCorrelation },
    evidenceSurfaces: { reviewDetailsRows: rows.filter((row) => row.evidenceSurfaces.reviewDetailsPresent).length, runtimeLogRows: rows.filter((row) => row.evidenceSurfaces.runtimeLogPresent).length, mcpEvidenceRows: rows.filter((row) => row.evidenceSurfaces.mcpEvidencePresent).length },
    redaction: { aggregateOnly, canaryLeakPresent: rows.some((row) => row.redaction.candidateCanaryLeaked || row.redaction.specialistCanaryLeaked || row.redaction.rawCanaryLeaked), verifierJsonLeakPresent: rows.some((row) => row.redaction.verifierJsonLeakPresent) },
    issue_categories: [...issueCategories],
    issues,
  };
}

export function parseM070S05Args(argv: readonly string[]): M070S05Args {
  let json = false;
  let help = false;
  for (const arg of argv) {
    if (arg === "--json") json = true;
    else if (arg === "--help" || arg === "-h") help = true;
    else throw new Error(`invalid_cli_args: unsupported argument ${arg}`);
  }
  return { json, help };
}

function helpText(): string {
  return `Usage: bun run verify:m070:s05 [--json]\n\nRuns deterministic in-process normal review integration scenarios. Output is aggregate-only and does not read .gsd, planning, audit, gitignored evidence, GitHub, Azure, or live credential sources.\n`;
}

function renderHuman(report: M070S05Report): string {
  return [`${COMMAND_NAME} ${report.status_code} success=${report.success}`, ...report.scenarioRows.map((row) => `- ${row.scenario}: ${row.actualStatus} expected=${row.expectedStatus} success=${row.success}`), ...(report.issues.length > 0 ? ["issues:", ...report.issues.map((issue) => `- ${issue}`)] : []), ""].join("\n");
}

function invalidArgReport(issue: string): M070S05Report {
  const check = makeCheck("M070-S05-NORMAL-REVIEW-INTEGRATION", false, "CLI argument parsing failed.");
  return { command: COMMAND_NAME, generated_at: new Date().toISOString(), proofMode: "local-in-process-normal-review-integration", proofScope: "s05-normal-review-handler-mcp-review-details-verifier-semantics", liveExactKeyProofRequiredBy: "S06", success: false, status_code: "m070_s05_invalid_arg", check_ids: M070_S05_CHECK_IDS, checks: [check], failing_check_id: check.id, scenarioRows: [], packageWiring: { scriptName: COMMAND_NAME, expected: EXPECTED_PACKAGE_SCRIPT, present: false, matches: false }, visibleVolumeSummary: { totalVisibleBodies: 0, totalInlineComments: 0, totalReviewDetails: 0 }, publicationModes: { candidateApprovedNonFallbackCount: 0, directFallbackEvidenceCount: 0, fallbackBlockedCount: 0 }, correlationMetadata: { allContextPresent: false, allEvidencePresentForSuccessRows: false }, evidenceSurfaces: { reviewDetailsRows: 0, runtimeLogRows: 0, mcpEvidenceRows: 0 }, redaction: { aggregateOnly: true, canaryLeakPresent: false, verifierJsonLeakPresent: false }, issue_categories: ["invalid-arg"], issues: [issue.slice(0, 240)] };
}

export async function main(argv: readonly string[] = process.argv.slice(2), deps: M070S05Deps = {}): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  let args: M070S05Args;
  try {
    args = parseM070S05Args(argv);
  } catch (error) {
    const report = invalidArgReport(error instanceof Error ? error.message : String(error));
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    stderr.write(`${report.issues[0]}\n`);
    return 2;
  }
  if (args.help) {
    stdout.write(helpText());
    return 0;
  }
  const report = await evaluateM070S05Integration({ runScenario: deps.runScenario, readPackageJsonText: deps.readPackageJsonText });
  stdout.write(args.json ? `${JSON.stringify(report, null, 2)}\n` : renderHuman(report));
  if (!report.success) stderr.write(`${COMMAND_NAME} failed: ${report.failing_check_id ?? "unknown"}\n`);
  return report.success ? 0 : 1;
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
