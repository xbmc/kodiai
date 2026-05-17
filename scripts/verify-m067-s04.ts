import { basename } from "node:path";
import { projectContributorExperienceContract } from "../src/contributor/experience-contract.ts";
import { buildAllowedMcpTools, buildMcpServerFactories } from "../src/execution/mcp/index.ts";
import { createCandidateFindingServer } from "../src/execution/mcp/candidate-finding-server.ts";
import { buildReviewPrompt } from "../src/execution/review-prompt.ts";
import { formatReviewDetailsSummary } from "../src/lib/review-utils.ts";
import {
  buildReviewPlan,
  toReviewPlanDetailsSummary,
} from "../src/review-orchestration/review-plan.ts";
import {
  createDegradedReviewCandidateFindingResult,
  createReviewCandidateFindingExecutionResult,
  toReviewCandidateFindingDetailsSummary,
  type ReviewCandidateFindingDetailsSummary,
  type ReviewCandidateFindingRecorder,
} from "../src/review-orchestration/review-candidate-finding.ts";

export const M067_S04_CHECK_IDS = [
  "CANDIDATE-SCHEMA-SHADOW",
  "CANDIDATE-MCP-TOOL-CAPTURE",
  "CANDIDATE-FAIL-OPEN",
  "CANDIDATE-DETAILS-COMPACT",
  "PLAN-CANDIDATE-SHADOW",
  "PROMPT-SHADOW-NOT-PUBLISH",
  "CANDIDATE-ARTIFACT-SIDECAR",
] as const;

export type M067S04CheckId = (typeof M067_S04_CHECK_IDS)[number];

export type M067S04StatusCode =
  | "m067_s04_ok"
  | "m067_s04_contract_failed"
  | "m067_s04_invalid_arg";

export type M067S04CheckStatusCode =
  | "candidate_schema_shadow"
  | "candidate_schema_not_shadow"
  | "candidate_mcp_tool_capture"
  | "candidate_mcp_tool_capture_failed"
  | "candidate_fail_open"
  | "candidate_failed_closed"
  | "candidate_details_compact"
  | "candidate_details_not_compact"
  | "plan_candidate_shadow"
  | "plan_candidate_not_shadow"
  | "prompt_shadow_not_publish"
  | "prompt_shadow_publish_leak"
  | "candidate_artifact_sidecar"
  | "candidate_artifact_sidecar_missing";

export type M067S04Check = {
  id: M067S04CheckId;
  passed: boolean;
  status_code: M067S04CheckStatusCode;
  detail: string;
};

export type M067S04Report = {
  command: "verify:m067:s04";
  generated_at: string;
  success: boolean;
  status_code: M067S04StatusCode;
  check_ids: M067S04CheckId[];
  checks: M067S04Check[];
  failing_check_id: M067S04CheckId | null;
  issues: string[];
  candidate: {
    status: "shadow" | "unavailable" | "degraded";
    counts: { input: number; recorded: number; rejected: number; errors: number };
    artifact_present: boolean;
    artifact_basename: string | null;
    details_line: string;
  };
  mcp: {
    server_names: string[];
    allowed_tools: string[];
    recorded_response: Record<string, unknown>;
    failing_recorder_response: Record<string, unknown>;
    warning_count: number;
  };
  review_details: {
    marker_count: number;
    candidate_line_count: number;
    candidate_line: string;
  };
  review_plan: {
    status: "ready";
    candidate_mode: "shadow" | "unavailable" | "preferred";
    details_line: string;
  };
  prompt: {
    has_shadow_section: boolean;
    shadow_section: string;
    publish_tool_count: number;
    includes_candidate_in_publish_contract: boolean;
  };
  sidecar: {
    artifact_present: boolean;
    artifact_basename: string | null;
  };
};

type EvaluateM067S04Params = {
  generatedAt?: string;
  overrides?: {
    candidateDetailsSummaryText?: string;
  };
};

type VerifyM067S04Args = {
  help: boolean;
  json: boolean;
};

type RegisteredTool = {
  description?: string;
  inputSchema?: { safeParse: (input: unknown) => { success: boolean } };
  handler: (input: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;
};

const REVIEW_OUTPUT_KEY = "m067-s04-shadow-candidates";
const DELIVERY_ID = "delivery-m067-s04";
const ARTIFACT_BASENAME = "review-candidate-findings.json";
const PUBLICATION_TOOLS = [
  "mcp__github_inline_comment__create_inline_comment",
  "mcp__github_comment__create_comment",
];
const RAW_LEAK_MARKERS = [
  "Unsafe raw fixture title",
  "Candidate body includes hidden prompt",
  "diff --git",
  "BEGIN PROMPT",
  "PROMPT_SECRET",
  "TOKEN=abc123",
  "sk-live-secret-token",
  "/tmp/kodiai/workspace",
  "rawPrompt",
  "rawDiff",
  "secretToken",
];

const validCandidateInput = {
  filePath: "src/execution/mcp/index.ts",
  startLine: 12,
  endLine: 18,
  severity: "major",
  category: "correctness",
  title: "Candidate title",
  body: "Candidate body explaining the potential issue.",
  evidence: "Optional short evidence.",
};

function representativeCandidateInputs() {
  return [
    validCandidateInput,
    {
      filePath: "../unsafe.ts",
      startLine: 5,
      endLine: 2,
      severity: "major",
      category: "correctness",
      title: "Unsafe raw fixture title",
      body: "Candidate body includes hidden prompt BEGIN PROMPT PROMPT_SECRET diff --git TOKEN=abc123 sk-live-secret-token",
      evidence: "/tmp/kodiai/workspace should never be public evidence",
    },
  ];
}

function getRegisteredTool(server: ReturnType<typeof createCandidateFindingServer>, toolName: string): RegisteredTool {
  const instance = server.instance as unknown as {
    _registeredTools?: Record<string, RegisteredTool>;
  };

  const registeredTool = instance._registeredTools?.[toolName];
  if (!registeredTool) {
    throw new Error(`tool '${toolName}' is not registered`);
  }
  return registeredTool;
}

function parseToolResponse(result: { content: Array<{ text: string }> }): Record<string, unknown> {
  try {
    const text = result.content[0]?.text ?? "{}";
    const parsed = JSON.parse(text) as unknown;
    return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function countOccurrences(value: string, needle: string): number {
  if (!needle) {
    return 0;
  }
  return value.split(needle).length - 1;
}

function sanitizeEvidenceText(value: string): string {
  return value
    .replace(/Unsafe raw fixture title/gi, "candidate-title-redacted")
    .replace(/Candidate body includes hidden prompt/gi, "candidate-body-redacted")
    .replace(/BEGIN\s+PROMPT/gi, "prompt-redacted")
    .replace(/PROMPT[_-]?SECRET/gi, "prompt-redacted")
    .replace(/diff --git/gi, "diff-redacted")
    .replace(/TOKEN\s*=\s*[^\s]+/gi, "token-redacted")
    .replace(/sk-[a-zA-Z0-9_-]+/g, "redacted")
    .replace(/\/tmp\/kodiai\/workspace/g, "workspace-redacted")
    .replace(/rawPrompt/gi, "raw-prompt-redacted")
    .replace(/rawDiff/gi, "raw-diff-redacted")
    .replace(/secretToken/gi, "secret-token-redacted")
    .replace(/\s+/g, " ")
    .trim();
}

function hasRawLeak(value: string): boolean {
  return RAW_LEAK_MARKERS.some((marker) => value.includes(marker));
}

function buildReviewDetails(params: {
  candidateSummary: ReviewCandidateFindingDetailsSummary;
  reviewPlanSummary: ReturnType<typeof toReviewPlanDetailsSummary>;
}): string {
  return formatReviewDetailsSummary({
    reviewOutputKey: REVIEW_OUTPUT_KEY,
    filesReviewed: 3,
    linesAdded: 42,
    linesRemoved: 7,
    findingCounts: {
      critical: 0,
      major: 1,
      medium: 0,
      minor: 0,
    },
    profileSelection: {
      selectedProfile: "balanced",
      source: "auto",
      autoBand: null,
      linesChanged: 49,
    },
    contributorExperience: projectContributorExperienceContract({
      source: "author-cache",
      tier: "regular",
    }).reviewDetails,
    reviewPlan: params.reviewPlanSummary,
    reviewCandidateFinding: params.candidateSummary,
    completedAt: "2026-05-09T18:00:00.000Z",
  });
}

function inspectReviewDetails(body: string): { marker_count: number; candidate_line_count: number; candidate_line_raw: string; candidate_line: string } {
  const candidateLines = body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes("Review candidates:"));

  const candidateLineRaw = candidateLines[0] ?? "";
  return {
    marker_count: countOccurrences(body, `<!-- kodiai:review-details:${REVIEW_OUTPUT_KEY} -->`),
    candidate_line_count: candidateLines.length,
    candidate_line_raw: candidateLineRaw,
    candidate_line: sanitizeEvidenceText(candidateLineRaw),
  };
}

function extractSection(value: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return value.match(new RegExp(`${escaped}[\\s\\S]*?(?=\\n## |$)`))?.[0] ?? "";
}

function representativeReviewPrompt(): string {
  return buildReviewPrompt({
    owner: "acme",
    repo: "repo",
    prNumber: 42,
    prTitle: "Add candidate verifier",
    prBody: "Representative PR body.",
    prAuthor: "octocat",
    baseBranch: "main",
    headBranch: "feature/m067-s04",
    changedFiles: ["src/execution/mcp/index.ts"],
    mode: "standard",
    publishToolNames: PUBLICATION_TOOLS,
    candidateFindingToolName: "record_candidate_finding",
    candidateFindingMode: "shadow",
  });
}

function buildSchemaShadowCheck(params: {
  candidateStatus: string;
  recorded: number;
  rejected: number;
  detailsLine: string;
}): M067S04Check {
  const failures = [
    ...(params.candidateStatus !== "shadow" ? [`candidate status was ${params.candidateStatus}`] : []),
    ...(params.recorded !== 1 ? [`recorded count was ${params.recorded}`] : []),
    ...(params.rejected !== 1 ? [`rejected count was ${params.rejected}`] : []),
    ...(!params.detailsLine.includes("Review candidates: shadow") ? ["candidate summary omitted shadow status"] : []),
    ...(hasRawLeak(params.detailsLine) ? ["candidate summary leaked raw candidate, diff, prompt, token, or path data"] : []),
  ];

  return {
    id: "CANDIDATE-SCHEMA-SHADOW",
    passed: failures.length === 0,
    status_code: failures.length === 0 ? "candidate_schema_shadow" : "candidate_schema_not_shadow",
    detail: failures.length === 0
      ? "candidate contract normalizes one recorded candidate and one rejection as shadow-only bounded metadata"
      : sanitizeEvidenceText(failures.join("; ")),
  };
}

function buildMcpCaptureCheck(params: {
  serverNames: string[];
  allowedTools: string[];
  response: Record<string, unknown>;
  warningCount: number;
}): M067S04Check {
  const failures = [
    ...(!params.serverNames.includes("review_candidate_finding") ? ["candidate MCP server factory missing"] : []),
    ...(!params.allowedTools.includes("mcp__review_candidate_finding__record_candidate_finding") ? ["candidate MCP tool not allowlisted"] : []),
    ...(params.response.recorded !== true ? [`recorded response was ${String(params.response.recorded)}`] : []),
    ...(params.response.mode !== "shadow" ? [`recorded mode was ${String(params.response.mode)}`] : []),
    ...(params.warningCount !== 0 ? [`unexpected warning count during happy path: ${params.warningCount}`] : []),
  ];

  return {
    id: "CANDIDATE-MCP-TOOL-CAPTURE",
    passed: failures.length === 0,
    status_code: failures.length === 0 ? "candidate_mcp_tool_capture" : "candidate_mcp_tool_capture_failed",
    detail: failures.length === 0
      ? "record_candidate_finding is opt-in, allowlisted, and records through the injected shadow recorder"
      : sanitizeEvidenceText(failures.join("; ")),
  };
}

function buildFailOpenCheck(params: {
  degradedResponse: Record<string, unknown>;
  degradedCandidateLine: string;
}): M067S04Check {
  const failures = [
    ...(params.degradedResponse.recorded !== false ? [`degraded recorded flag was ${String(params.degradedResponse.recorded)}`] : []),
    ...(params.degradedResponse.mode !== "degraded" ? [`degraded mode was ${String(params.degradedResponse.mode)}`] : []),
    ...(params.degradedResponse.reason !== "candidate-finding-record-failed" ? [`degraded reason was ${String(params.degradedResponse.reason)}`] : []),
    ...(!params.degradedCandidateLine.includes("Review candidates: degraded") ? ["degraded candidate details line missing"] : []),
    ...(!params.degradedCandidateLine.includes("errors=1") ? ["degraded candidate details line omitted errors=1"] : []),
    ...(hasRawLeak(params.degradedCandidateLine) ? ["degraded candidate details leaked raw data"] : []),
  ];

  return {
    id: "CANDIDATE-FAIL-OPEN",
    passed: failures.length === 0,
    status_code: failures.length === 0 ? "candidate_fail_open" : "candidate_failed_closed",
    detail: failures.length === 0
      ? "candidate recorder failures return degraded metadata and safe Review Details instead of throwing or blocking publication"
      : sanitizeEvidenceText(failures.join("; ")),
  };
}

function buildDetailsCompactCheck(params: { markerCount: number; candidateLineCount: number; candidateLineRaw: string }): M067S04Check {
  const line = params.candidateLineRaw;
  const failures = [
    ...(params.markerCount !== 1 ? [`Review Details marker count was ${params.markerCount}`] : []),
    ...(params.candidateLineCount !== 1 ? [`Review candidates line count was ${params.candidateLineCount}`] : []),
    ...(!line.startsWith("- Review candidates: shadow") ? ["candidate details line did not use shadow prefix"] : []),
    ...(line.length > 262 ? [`candidate details line too long (${line.length} chars)`] : []),
    ...(!line.includes("recorded=1") ? ["candidate details line omitted recorded=1"] : []),
    ...(!line.includes("rejected=1") ? ["candidate details line omitted rejected=1"] : []),
    ...(!line.includes("errors=0") ? ["candidate details line omitted errors=0"] : []),
    ...(!line.includes("artifact=present") ? ["candidate details line omitted artifact=present"] : []),
    ...(!line.includes("repo=acme-repo") ? ["candidate details line omitted repo correlation"] : []),
    ...(!line.includes("pr=42") ? ["candidate details line omitted PR correlation"] : []),
    ...(!line.includes(`key=${REVIEW_OUTPUT_KEY}`) ? ["candidate details line omitted review output key correlation"] : []),
    ...(hasRawLeak(line) ? ["candidate details line leaked raw candidate title/body/diff/prompt/token/path data"] : []),
  ];

  return {
    id: "CANDIDATE-DETAILS-COMPACT",
    passed: failures.length === 0,
    status_code: failures.length === 0 ? "candidate_details_compact" : "candidate_details_not_compact",
    detail: failures.length === 0
      ? "Review Details contains exactly one compact Review candidates line with count-only/correlation-only evidence"
      : sanitizeEvidenceText(failures.join("; ")),
  };
}

function buildPlanShadowCheck(params: { candidateMode: string; detailsLine: string }): M067S04Check {
  const failures = [
    ...(params.candidateMode !== "shadow" ? [`plan candidate mode was ${params.candidateMode}`] : []),
    ...(!params.detailsLine.includes("candidates=shadow") ? ["plan details did not project candidates=shadow"] : []),
    ...(hasRawLeak(params.detailsLine) ? ["plan details leaked raw data"] : []),
  ];

  return {
    id: "PLAN-CANDIDATE-SHADOW",
    passed: failures.length === 0,
    status_code: failures.length === 0 ? "plan_candidate_shadow" : "plan_candidate_not_shadow",
    detail: failures.length === 0
      ? "ReviewPlan and Review Details project the candidate seam as shadow metadata"
      : sanitizeEvidenceText(failures.join("; ")),
  };
}

function buildPromptShadowCheck(params: {
  hasShadowSection: boolean;
  shadowSection: string;
  publishToolCount: number;
  includesCandidateInPublishContract: boolean;
}): M067S04Check {
  const failures = [
    ...(!params.hasShadowSection ? ["prompt omitted Shadow Candidate Finding Capture section"] : []),
    ...(!params.shadowSection.includes("optional shadow-only tool") ? ["shadow section omitted optional shadow wording"] : []),
    ...(!params.shadowSection.includes("does not publish GitHub comments") ? ["shadow section omitted no-publish wording"] : []),
    ...(!params.shadowSection.includes("MUST still use the GitHub publish tools") ? ["shadow section omitted mandatory GitHub publish wording"] : []),
    ...(params.publishToolCount !== 2 ? [`publish tool count was ${params.publishToolCount}`] : []),
    ...(params.includesCandidateInPublishContract ? ["candidate tool appeared in mandatory GitHub publish contract"] : []),
  ];

  return {
    id: "PROMPT-SHADOW-NOT-PUBLISH",
    passed: failures.length === 0,
    status_code: failures.length === 0 ? "prompt_shadow_not_publish" : "prompt_shadow_publish_leak",
    detail: failures.length === 0
      ? "prompt exposes candidate capture as optional shadow-only and keeps mandatory publication on GitHub tools"
      : sanitizeEvidenceText(failures.join("; ")),
  };
}

function buildArtifactSidecarCheck(params: { artifactPresent: boolean; artifactBasename: string | null }): M067S04Check {
  const failures = [
    ...(params.artifactPresent !== true ? ["candidate artifact-present flag was false"] : []),
    ...(params.artifactBasename !== ARTIFACT_BASENAME ? [`artifact basename was ${params.artifactBasename ?? "missing"}`] : []),
    ...((params.artifactBasename?.includes("/") ?? false) ? ["artifact metadata exposed a path instead of a basename"] : []),
  ];

  return {
    id: "CANDIDATE-ARTIFACT-SIDECAR",
    passed: failures.length === 0,
    status_code: failures.length === 0 ? "candidate_artifact_sidecar" : "candidate_artifact_sidecar_missing",
    detail: failures.length === 0
      ? "sidecar artifact metadata is present and bounded to a safe basename"
      : sanitizeEvidenceText(failures.join("; ")),
  };
}

function deriveOutcome(checks: M067S04Check[]): Pick<M067S04Report, "success" | "status_code" | "failing_check_id" | "issues"> {
  const failingCheck = checks.find((check) => !check.passed);
  if (!failingCheck) {
    return {
      success: true,
      status_code: "m067_s04_ok",
      failing_check_id: null,
      issues: [],
    };
  }

  return {
    success: false,
    status_code: "m067_s04_contract_failed",
    failing_check_id: failingCheck.id,
    issues: [`${failingCheck.id}: ${sanitizeEvidenceText(failingCheck.detail)}`],
  };
}

function emptyReport(params: { generatedAt?: string; issue: string }): M067S04Report {
  return {
    command: "verify:m067:s04",
    generated_at: params.generatedAt ?? new Date().toISOString(),
    success: false,
    status_code: "m067_s04_invalid_arg",
    check_ids: [...M067_S04_CHECK_IDS],
    checks: [],
    failing_check_id: null,
    issues: [sanitizeEvidenceText(params.issue)],
    candidate: {
      status: "unavailable",
      counts: { input: 0, recorded: 0, rejected: 0, errors: 0 },
      artifact_present: false,
      artifact_basename: null,
      details_line: "",
    },
    mcp: {
      server_names: [],
      allowed_tools: [],
      recorded_response: {},
      failing_recorder_response: {},
      warning_count: 0,
    },
    review_details: {
      marker_count: 0,
      candidate_line_count: 0,
      candidate_line: "",
    },
    review_plan: {
      status: "ready",
      candidate_mode: "unavailable",
      details_line: "",
    },
    prompt: {
      has_shadow_section: false,
      shadow_section: "",
      publish_tool_count: 0,
      includes_candidate_in_publish_contract: false,
    },
    sidecar: {
      artifact_present: false,
      artifact_basename: null,
    },
  };
}

export async function evaluateM067S04CandidateSeamContract(params?: EvaluateM067S04Params): Promise<M067S04Report> {
  const generatedAt = params?.generatedAt ?? new Date().toISOString();
  const candidateResult = createReviewCandidateFindingExecutionResult({
    repo: "acme/repo",
    pullNumber: 42,
    reviewOutputKey: REVIEW_OUTPUT_KEY,
    deliveryId: DELIVERY_ID,
    artifactPresent: true,
    candidates: representativeCandidateInputs(),
  });
  const candidateSummaryBase = toReviewCandidateFindingDetailsSummary(candidateResult);
  const candidateSummary: ReviewCandidateFindingDetailsSummary = {
    ...candidateSummaryBase,
    ...(params?.overrides?.candidateDetailsSummaryText ? { text: params.overrides.candidateDetailsSummaryText } : {}),
  };
  const candidateDetailsLine = sanitizeEvidenceText(candidateSummary.text);

  const reviewPlan = buildReviewPlan({
    task: { taskType: "review-full", routingReason: "standard" },
    change: { changedFileCount: 3, linesChanged: 49, linesChangedSource: "inline-fixture" },
    budget: { timeoutSeconds: 900, maxTurns: 50, maxTurnsSource: "default-review-budget" },
    context: { sources: ["inline-fixture"], summary: "Representative candidate seam verification fixture." },
    gates: { enabled: ["quality", "candidate-shadow"], current: ["quality"] },
    policy: { publish: "inline+summary", tools: "standard-review-tools", retry: "retry-on-transient-failure" },
    graphValidation: { status: "enabled", reason: "graph-blast-radius-available" },
    candidateFinding: { mode: "shadow", reason: "candidate-finding-shadow-mode" },
  }).plan;
  const reviewPlanSummary = toReviewPlanDetailsSummary(reviewPlan);
  const reviewDetails = buildReviewDetails({ candidateSummary, reviewPlanSummary });
  const reviewDetailsEvidence = inspectReviewDetails(reviewDetails);

  const recordedCalls: unknown[] = [];
  const warnings: unknown[] = [];
  const logger = { warn: (...args: unknown[]) => warnings.push(args), debug: () => undefined };
  const recorder: ReviewCandidateFindingRecorder = {
    recordCandidateFinding: (finding, context) => {
      recordedCalls.push({ finding, context });
    },
  };
  const happyServer = createCandidateFindingServer({
    recorder,
    repo: "acme/repo",
    pullNumber: 42,
    reviewOutputKey: REVIEW_OUTPUT_KEY,
    deliveryId: DELIVERY_ID,
    logger: logger as never,
  });
  const happyTool = getRegisteredTool(happyServer, "record_candidate_finding");
  const recordedResponse = parseToolResponse(await happyTool.handler(validCandidateInput));

  const failingRecorder: ReviewCandidateFindingRecorder = {
    recordCandidateFinding: async () => {
      throw new Error("Unsafe raw fixture title Candidate body includes hidden prompt diff --git TOKEN=abc123");
    },
  };
  const failingServer = createCandidateFindingServer({
    recorder: failingRecorder,
    repo: "acme/repo",
    pullNumber: 42,
    reviewOutputKey: REVIEW_OUTPUT_KEY,
    deliveryId: DELIVERY_ID,
    logger: logger as never,
  });
  const failingRecorderResponse = parseToolResponse(await getRegisteredTool(failingServer, "record_candidate_finding").handler(validCandidateInput));
  const degradedCandidate = createDegradedReviewCandidateFindingResult({
    repo: "acme/repo",
    pullNumber: 42,
    reviewOutputKey: REVIEW_OUTPUT_KEY,
    deliveryId: DELIVERY_ID,
    artifactPresent: false,
    reason: "candidate-finding-record-failed",
    inputCount: 1,
  });
  const degradedCandidateLine = toReviewCandidateFindingDetailsSummary(degradedCandidate).text;

  const factories = buildMcpServerFactories({
    getOctokit: async () => { throw new Error("not used by local verifier"); },
    owner: "acme",
    repo: "repo",
    prNumber: 42,
    reviewOutputKey: REVIEW_OUTPUT_KEY,
    deliveryId: DELIVERY_ID,
    enableCommentTools: true,
    enableInlineTools: true,
    enableCandidateFindingTool: true,
    candidateFindingRecorder: recorder,
  });
  const serverNames = Object.keys(factories).sort();
  const allowedTools = buildAllowedMcpTools(serverNames).sort();

  const prompt = representativeReviewPrompt();
  const shadowSection = extractSection(prompt, "## Shadow Candidate Finding Capture");
  const publishSection = extractSection(prompt, "## Tool Availability Contract");
  const promptEvidence = {
    hasShadowSection: shadowSection.length > 0,
    shadowSection: sanitizeEvidenceText(shadowSection),
    publishToolCount: PUBLICATION_TOOLS.filter((toolName) => publishSection.includes(toolName)).length,
    includesCandidateInPublishContract: publishSection.includes("record_candidate_finding"),
  };

  const artifactBasename = basename(ARTIFACT_BASENAME);
  const checks = [
    buildSchemaShadowCheck({
      candidateStatus: candidateResult.status,
      recorded: candidateResult.counts.recorded,
      rejected: candidateResult.counts.rejected,
      detailsLine: candidateDetailsLine,
    }),
    buildMcpCaptureCheck({
      serverNames,
      allowedTools,
      response: recordedResponse,
      warningCount: warnings.length - 1,
    }),
    buildFailOpenCheck({
      degradedResponse: failingRecorderResponse,
      degradedCandidateLine,
    }),
    buildDetailsCompactCheck({
      markerCount: reviewDetailsEvidence.marker_count,
      candidateLineCount: reviewDetailsEvidence.candidate_line_count,
      candidateLineRaw: reviewDetailsEvidence.candidate_line_raw,
    }),
    buildPlanShadowCheck({
      candidateMode: reviewPlan.candidateFinding.mode,
      detailsLine: reviewPlanSummary.text,
    }),
    buildPromptShadowCheck(promptEvidence),
    buildArtifactSidecarCheck({ artifactPresent: candidateResult.artifactPresent, artifactBasename }),
  ];
  const outcome = deriveOutcome(checks);

  return {
    command: "verify:m067:s04",
    generated_at: generatedAt,
    success: outcome.success,
    status_code: outcome.status_code,
    check_ids: [...M067_S04_CHECK_IDS],
    checks,
    failing_check_id: outcome.failing_check_id,
    issues: outcome.issues,
    candidate: {
      status: candidateResult.status,
      counts: candidateResult.counts,
      artifact_present: candidateResult.artifactPresent,
      artifact_basename: artifactBasename,
      details_line: candidateDetailsLine,
    },
    mcp: {
      server_names: serverNames,
      allowed_tools: allowedTools,
      recorded_response: recordedResponse,
      failing_recorder_response: failingRecorderResponse,
      warning_count: warnings.length,
    },
    review_details: {
      marker_count: reviewDetailsEvidence.marker_count,
      candidate_line_count: reviewDetailsEvidence.candidate_line_count,
      candidate_line: reviewDetailsEvidence.candidate_line,
    },
    review_plan: {
      status: reviewPlan.status,
      candidate_mode: reviewPlan.candidateFinding.mode,
      details_line: sanitizeEvidenceText(reviewPlanSummary.text),
    },
    prompt: {
      has_shadow_section: promptEvidence.hasShadowSection,
      shadow_section: promptEvidence.shadowSection,
      publish_tool_count: promptEvidence.publishToolCount,
      includes_candidate_in_publish_contract: promptEvidence.includesCandidateInPublishContract,
    },
    sidecar: {
      artifact_present: candidateResult.artifactPresent,
      artifact_basename: artifactBasename,
    },
  };
}

export function parseVerifyM067S04Args(args: string[]): VerifyM067S04Args {
  for (const arg of args) {
    if (arg === "--help" || arg === "-h" || arg === "--json") {
      continue;
    }

    throw new Error(`invalid_cli_args: Unknown argument: ${arg}`);
  }

  return {
    help: args.includes("--help") || args.includes("-h"),
    json: args.includes("--json"),
  };
}

function usage(): string {
  return [
    "Usage: bun run verify:m067:s04 -- [--json]",
    "",
    "Verifies the M067 S04 shadow candidate-finding seam using local inline fixtures only.",
    "",
    "Options:",
    "  --json       Print machine-readable JSON output",
    "  --help       Show this help",
  ].join("\n");
}

export function renderM067S04Report(report: M067S04Report): string {
  const lines = [
    "# M067 S04 — Shadow Candidate Seam Verifier",
    "",
    `Status: ${report.status_code}`,
    `Overall success: ${String(report.success)}`,
    `Failing check: ${report.failing_check_id ?? "none"}`,
    `Candidate seam: status=${report.candidate.status} recorded=${report.candidate.counts.recorded} rejected=${report.candidate.counts.rejected} errors=${report.candidate.counts.errors} artifact=${report.candidate.artifact_present ? "present" : "absent"}`,
    `MCP: servers=${report.mcp.server_names.join(",") || "none"} warnings=${report.mcp.warning_count}`,
    `Review candidates: ${report.review_details.candidate_line || "missing"}`,
    `Prompt shadow section: ${report.prompt.has_shadow_section ? "present" : "absent"}; candidate in publish contract=${String(report.prompt.includes_candidate_in_publish_contract)}`,
    "",
    "Checks:",
  ];

  for (const check of report.checks) {
    lines.push(`- ${check.id}: ${check.status_code} (passed=${String(check.passed)})`);
    lines.push(`  - ${sanitizeEvidenceText(check.detail)}`);
  }

  lines.push("", "Inspection surfaces:");
  lines.push(`- Candidate details: ${sanitizeEvidenceText(report.candidate.details_line)}`);
  lines.push(`- Review plan: ${sanitizeEvidenceText(report.review_plan.details_line)}`);
  lines.push(`- Sidecar artifact basename: ${report.sidecar.artifact_basename ?? "none"}`);

  if (report.issues.length > 0) {
    lines.push("", "Issues:");
    for (const issue of report.issues) {
      lines.push(`- ${sanitizeEvidenceText(issue)}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export async function main(
  args: string[] = process.argv.slice(2),
  deps?: {
    stdout?: { write: (chunk: string) => void };
    stderr?: { write: (chunk: string) => void };
    evaluateFn?: typeof evaluateM067S04CandidateSeamContract;
  },
): Promise<number> {
  const stdout = deps?.stdout ?? process.stdout;
  const stderr = deps?.stderr ?? process.stderr;
  const evaluateFn = deps?.evaluateFn ?? evaluateM067S04CandidateSeamContract;

  try {
    const options = parseVerifyM067S04Args(args);

    if (options.help) {
      stdout.write(`${usage()}\n`);
      return 0;
    }

    const report = await evaluateFn();
    stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderM067S04Report(report));

    if (!report.success) {
      stderr.write(`verify:m067:s04 failed: ${report.failing_check_id ?? report.status_code}\n`);
    }

    return report.success ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const report = emptyReport({ issue: message });
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 1;
  }
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
