import {
  normalizeShadowSpecialistOutput,
} from "../src/specialists/shadow-specialist.ts";
import { projectShadowSpecialistMetrics } from "../src/specialists/shadow-specialist-metrics.ts";

export const COMMAND_NAME = "verify:m069:s03" as const;
export const EXPECTED_PACKAGE_SCRIPT = "bun scripts/verify-m069-s03.ts" as const;

export const M069_S03_CHECK_IDS = [
  "M069-S03-PACKAGE-WIRING",
  "M069-S03-REDUCER-EXPORT",
  "M069-S03-CANDIDATE-METRIC-PROJECTION",
  "M069-S03-HANDLER-METRIC-WIRING",
  "M069-S03-PUBLICATION-BOUNDARY",
  "M069-S03-NEGATIVE-VISIBLE-SURFACE",
] as const;

export type M069S03CheckId = (typeof M069_S03_CHECK_IDS)[number];
export type M069S03StatusCode = "m069_s03_ok" | "m069_s03_contract_failed" | "m069_s03_invalid_arg";
export type M069S03CheckStatus = "pass" | "fail";
export type M069S03CheckStatusCode =
  | "package_wiring_ok"
  | "package_wiring_failed"
  | "reducer_export_ok"
  | "reducer_export_failed"
  | "candidate_metric_projection_ok"
  | "candidate_metric_projection_failed"
  | "handler_metric_wiring_ok"
  | "handler_metric_wiring_failed"
  | "publication_boundary_ok"
  | "publication_boundary_failed"
  | "negative_visible_surface_ok"
  | "negative_visible_surface_failed";

export type M069S03Check = {
  readonly id: M069S03CheckId;
  readonly passed: boolean;
  readonly status: M069S03CheckStatus;
  readonly status_code: M069S03CheckStatusCode;
  readonly detail: string;
};

export type M069S03Report = {
  readonly command: typeof COMMAND_NAME;
  readonly generated_at: string;
  readonly proofMode: "local-fixture-static";
  readonly proofScope: "non-live-source-and-fixture-proof";
  readonly success: boolean;
  readonly status_code: M069S03StatusCode;
  readonly candidateMetricProjectionPassed: boolean;
  readonly handlerMetricWiringPresent: boolean;
  readonly visiblePublicationFieldCount: number;
  readonly approvalFieldCount: number;
  readonly rawPayloadLeakCount: number;
  readonly specialistPromptInjectionCount: number;
  readonly normalReviewPublicationOnly: boolean;
  readonly reviewDetailsSpecialistCandidateVisible: boolean;
  readonly tierModeFieldCount: number;
  readonly check_ids: readonly M069S03CheckId[];
  readonly checks: readonly M069S03Check[];
  readonly failing_check_id: M069S03CheckId | null;
  readonly summary: {
    readonly packageScriptWired: boolean;
    readonly reducerExportPresent: boolean;
    readonly reducerPrivateDenialFieldsPresent: boolean;
    readonly reducerZeroContentCountsPresent: boolean;
    readonly handlerImportsReducer: boolean;
    readonly handlerBuildsMetricLogFields: boolean;
    readonly handlerLogsProjectionDenials: boolean;
    readonly handlerProjectionFailOpenPresent: boolean;
    readonly readsPlanningOrSecrets: false;
    readonly liveServiceRequired: false;
  };
  readonly projection: {
    readonly laneId: string;
    readonly status: string;
    readonly reason: string | null;
    readonly candidateCount: number;
    readonly decisionCount: number;
    readonly duplicateCount: number;
    readonly disagreementCount: number;
    readonly tokenCountAvailable: boolean;
    readonly costAvailable: boolean;
    readonly latencyMsAvailable: boolean;
    readonly visiblePublicationDenied: boolean;
    readonly approvalPublicationDenied: boolean;
    readonly rawContentFieldCount: number;
    readonly candidateBodyFieldCount: number;
    readonly githubPublicationFieldCount: number;
    readonly approvalFieldCount: number;
    readonly specialistContentIncluded: boolean;
    readonly candidateFingerprintsIncluded: boolean;
    readonly candidateBodiesIncluded: boolean;
    readonly rawModelOutputIncluded: boolean;
    readonly toolPayloadIncluded: boolean;
    readonly approvalFieldsIncluded: boolean;
    readonly tierModeIncluded: boolean;
    readonly serializedLeakMatches: readonly string[];
  };
  readonly sourceBoundary: {
    readonly reducerForbiddenPublicationMatches: readonly string[];
    readonly handlerShadowForbiddenPublicationMatches: readonly string[];
    readonly handlerShadowRawPayloadMatches: readonly string[];
    readonly handlerShadowPromptMatches: readonly string[];
    readonly handlerShadowReviewDetailsMatches: readonly string[];
    readonly tierModeFieldCount: number;
  };
  readonly targetedTests: readonly string[];
  readonly issues: readonly string[];
};

export type M069S03Args = {
  readonly json: boolean;
  readonly help: boolean;
};

export type EvaluateM069S03Options = {
  readonly generatedAt?: string;
  readonly readPackageJsonText?: () => Promise<string>;
  readonly readReducerText?: () => Promise<string>;
  readonly readHandlerText?: () => Promise<string>;
  readonly projectMetrics?: typeof projectShadowSpecialistMetrics;
};

const REDUCER_PATH = "src/specialists/shadow-specialist-metrics.ts";
const HANDLER_PATH = "src/handlers/review.ts";

const TARGETED_TEST_COMMANDS = [
  "bun test scripts/verify-m069-s03.test.ts",
  "bun run verify:m069:s03 --json",
  "bun test src/specialists/shadow-specialist-metrics.test.ts src/handlers/review-shadow-specialist-metrics.test.ts",
  "bun test src/specialists/shadow-specialist-runner.test.ts src/handlers/review-shadow-specialist.test.ts",
] as const;

const FORBIDDEN_PUBLICATION_PATTERNS = [
  "issues.createComment",
  "pulls.createReview",
  "createComment",
  "createReview",
  "updateComment",
  "deleteReviewComment",
  "Octokit",
  "octokit",
  "approvalCallback",
  "approveCallback",
  "publishCallback",
  "publicationCallback",
  "inlineCommentBody",
  "issueCommentBody",
] as const;

const RAW_PAYLOAD_PATTERNS = [
  "raw prompt",
  "rawPrompt",
  "prompt:",
  "modelOutput",
  "rawModelOutput:",
  "toolPayload:",
  "commentBody:",
  "inlineComment:",
  "candidate.body",
  "candidateBody:",
  "candidateBodies:",
  "fingerprint:",
] as const;

const PROMPT_PATTERNS = ["buildReviewPrompt", "prompt:", "rawPrompt", "specialistPrompt", "modelOutput"] as const;
const REVIEW_DETAILS_PATTERNS = ["Review Details", "review details", "buildReviewDetailsMarker", "formatReviewDetailsSummary"] as const;
const LEAK_SENTINELS = [
  "candidate-body-visible",
  "candidate-fingerprint-visible",
  "raw prompt visible",
  "raw model visible",
  "tool payload visible",
  "inline comment visible",
  "issue comment visible",
  "approval visible",
  "tier-mode-visible",
] as const;

export function parseM069S03Args(args: readonly string[]): M069S03Args {
  let json = false;
  let help = false;

  for (const arg of args) {
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    throw new Error(`invalid_cli_args: Unknown argument: ${arg}`);
  }

  return { json, help };
}

export async function evaluateM069S03Contract(options: EvaluateM069S03Options = {}): Promise<M069S03Report> {
  const readPackageJsonText = options.readPackageJsonText ?? (() => Bun.file("package.json").text());
  const readReducerText = options.readReducerText ?? (() => Bun.file(REDUCER_PATH).text());
  const readHandlerText = options.readHandlerText ?? (() => Bun.file(HANDLER_PATH).text());
  const projectMetrics = options.projectMetrics ?? projectShadowSpecialistMetrics;

  const [packageJsonText, reducerText, handlerText] = await Promise.all([
    readPackageJsonText(),
    readReducerText(),
    readHandlerText(),
  ]);

  const projectionProof = buildSyntheticProjectionProof(projectMetrics);
  const reducerSummary = summarizeReducer(reducerText);
  const handlerSummary = summarizeHandlerMetricWiring(handlerText);
  const sourceBoundary = summarizeSourceBoundary(reducerText, handlerText);

  const packageCheck = buildPackageWiringCheck(packageJsonText);
  const reducerCheck = buildReducerExportCheck(reducerSummary);
  const projectionCheck = buildProjectionCheck(projectionProof);
  const handlerCheck = buildHandlerMetricWiringCheck(handlerSummary);
  const publicationCheck = buildPublicationBoundaryCheck(sourceBoundary);
  const visibleSurfaceCheck = buildNegativeVisibleSurfaceCheck(projectionProof, sourceBoundary);
  const checks = [packageCheck, reducerCheck, projectionCheck, handlerCheck, publicationCheck, visibleSurfaceCheck];
  const issues = checks.filter((check) => !check.passed).map((check) => check.detail);
  const failingCheck = checks.find((check) => !check.passed) ?? null;

  const visiblePublicationFieldCount = projectionProof.githubPublicationFieldCount + projectionProof.candidateBodyFieldCount;
  const approvalFieldCount = projectionProof.approvalFieldCount;
  const rawPayloadLeakCount = projectionProof.serializedLeakMatches.length + sourceBoundary.handlerShadowRawPayloadMatches.length;
  const specialistPromptInjectionCount = sourceBoundary.handlerShadowPromptMatches.length;
  const normalReviewPublicationOnly = sourceBoundary.reducerForbiddenPublicationMatches.length === 0
    && sourceBoundary.handlerShadowForbiddenPublicationMatches.length === 0
    && handlerSummary.normalPublicationPathPresent;

  return {
    command: COMMAND_NAME,
    generated_at: options.generatedAt ?? new Date().toISOString(),
    proofMode: "local-fixture-static",
    proofScope: "non-live-source-and-fixture-proof",
    success: issues.length === 0,
    status_code: issues.length === 0 ? "m069_s03_ok" : "m069_s03_contract_failed",
    candidateMetricProjectionPassed: projectionCheck.passed,
    handlerMetricWiringPresent: handlerCheck.passed,
    visiblePublicationFieldCount,
    approvalFieldCount,
    rawPayloadLeakCount,
    specialistPromptInjectionCount,
    normalReviewPublicationOnly,
    reviewDetailsSpecialistCandidateVisible: sourceBoundary.handlerShadowReviewDetailsMatches.length > 0,
    tierModeFieldCount: sourceBoundary.tierModeFieldCount,
    check_ids: [...M069_S03_CHECK_IDS],
    checks,
    failing_check_id: failingCheck?.id ?? null,
    summary: {
      packageScriptWired: packageCheck.passed,
      reducerExportPresent: reducerSummary.reducerExportPresent,
      reducerPrivateDenialFieldsPresent: reducerSummary.reducerPrivateDenialFieldsPresent,
      reducerZeroContentCountsPresent: reducerSummary.reducerZeroContentCountsPresent,
      handlerImportsReducer: handlerSummary.handlerImportsReducer,
      handlerBuildsMetricLogFields: handlerSummary.handlerBuildsMetricLogFields,
      handlerLogsProjectionDenials: handlerSummary.handlerLogsProjectionDenials,
      handlerProjectionFailOpenPresent: handlerSummary.handlerProjectionFailOpenPresent,
      readsPlanningOrSecrets: false,
      liveServiceRequired: false,
    },
    projection: projectionProof,
    sourceBoundary,
    targetedTests: [...TARGETED_TEST_COMMANDS],
    issues,
  };
}

type ReducerSummary = {
  readonly reducerExportPresent: boolean;
  readonly projectionTypeExportPresent: boolean;
  readonly reducerPrivateDenialFieldsPresent: boolean;
  readonly reducerZeroContentCountsPresent: boolean;
  readonly reducerNoContentInclusionPresent: boolean;
};

type HandlerMetricWiringSummary = {
  readonly handlerImportsReducer: boolean;
  readonly handlerBuildsMetricLogFields: boolean;
  readonly handlerLogsBoundedCounts: boolean;
  readonly handlerLogsProjectionDenials: boolean;
  readonly handlerLogsCorrelationKeys: boolean;
  readonly handlerProjectionFailOpenPresent: boolean;
  readonly normalPublicationPathPresent: boolean;
};

type ProjectionProof = M069S03Report["projection"];

function buildSyntheticProjectionProof(projectMetrics: typeof projectShadowSpecialistMetrics): ProjectionProof {
  const projection = projectMetrics(normalizeShadowSpecialistOutput({
    status: "ok",
    deliveryId: "m069-s03-fixture-delivery",
    reviewOutputKey: "m069-s03-fixture-review-output",
    correlationKey: "m069-s03-fixture-correlation",
    metrics: { tokenCount: 42, costUsd: 0.02, latencyMs: 7 },
    candidates: [
      { fingerprint: "candidate-fingerprint-visible", decision: "candidate", body: "candidate-body-visible" },
      { fingerprint: "duplicate-fingerprint", decision: "candidate" },
      { fingerprint: "duplicate-fingerprint", decision: "candidate" },
      { fingerprint: "disagreement-fingerprint", decision: "disagreement", disagreementCategory: "tier-mode-visible" },
      { fingerprint: "dismissed-fingerprint", decision: "dismissed", inlineComment: "inline comment visible" },
      { fingerprint: "unknown-fingerprint", decision: "unknown", commentBody: "issue comment visible" },
    ],
    prompt: "raw prompt visible",
    modelOutput: "raw model visible",
    toolPayload: { payload: "tool payload visible" },
    approval: "approval visible",
  }));
  const serialized = JSON.stringify(projection);

  return {
    laneId: projection.laneId,
    status: projection.status,
    reason: projection.reason,
    candidateCount: projection.candidateCount,
    decisionCount: projection.decisionCount,
    duplicateCount: projection.duplicateCount,
    disagreementCount: projection.disagreementCount,
    tokenCountAvailable: projection.tokenCountAvailable,
    costAvailable: projection.costAvailable,
    latencyMsAvailable: projection.latencyMsAvailable,
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
    serializedLeakMatches: LEAK_SENTINELS.filter((sentinel) => serialized.includes(sentinel)),
  };
}

function buildPackageWiringCheck(packageJsonText: string): M069S03Check {
  const failures: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(packageJsonText);
  } catch {
    failures.push("package.json must be parseable JSON.");
  }

  const scripts = isRecord(parsed) && isRecord(parsed.scripts) ? parsed.scripts : {};
  if (scripts[COMMAND_NAME] !== EXPECTED_PACKAGE_SCRIPT) {
    failures.push(`package.json scripts.${COMMAND_NAME} must equal ${EXPECTED_PACKAGE_SCRIPT}.`);
  }

  return makeCheck({
    id: "M069-S03-PACKAGE-WIRING",
    okCode: "package_wiring_ok",
    failCode: "package_wiring_failed",
    okDetail: "package.json exposes verify:m069:s03 as a local no-live-service verifier.",
    failures,
  });
}

function buildReducerExportCheck(summary: ReducerSummary): M069S03Check {
  const failures: string[] = [];
  if (!summary.reducerExportPresent) failures.push("shadow-specialist metrics reducer must export projectShadowSpecialistMetrics.");
  if (!summary.projectionTypeExportPresent) failures.push("shadow-specialist metrics reducer must export ShadowSpecialistMetricsProjection.");
  if (!summary.reducerPrivateDenialFieldsPresent) failures.push("metrics projection must include private/shadow/publication-denial fields.");
  if (!summary.reducerZeroContentCountsPresent) failures.push("metrics projection must include zero visible publication/content field counts.");
  if (!summary.reducerNoContentInclusionPresent) failures.push("metrics projection must include false raw/candidate/tool/approval/tier inclusion booleans.");

  return makeCheck({
    id: "M069-S03-REDUCER-EXPORT",
    okCode: "reducer_export_ok",
    failCode: "reducer_export_failed",
    okDetail: "private shadow-specialist metrics reducer exports a bounded projection with denial and no-content fields.",
    failures,
  });
}

function buildProjectionCheck(proof: ProjectionProof): M069S03Check {
  const failures: string[] = [];
  if (proof.laneId !== "docs-config-truth") failures.push("synthetic projection must preserve docs-config-truth lane id.");
  if (proof.candidateCount < 1 || proof.decisionCount < 1) failures.push("synthetic projection must expose aggregate candidate and decision counts.");
  if (proof.duplicateCount < 1) failures.push("synthetic projection must expose duplicate aggregate count.");
  if (proof.disagreementCount < 1) failures.push("synthetic projection must expose disagreement aggregate count.");
  if (!proof.tokenCountAvailable || !proof.costAvailable || !proof.latencyMsAvailable) failures.push("synthetic projection must expose metric availability booleans.");
  if (!proof.visiblePublicationDenied || !proof.approvalPublicationDenied) failures.push("synthetic projection must deny visible and approval publication.");
  if (proof.rawContentFieldCount !== 0 || proof.candidateBodyFieldCount !== 0 || proof.githubPublicationFieldCount !== 0 || proof.approvalFieldCount !== 0) {
    failures.push("synthetic projection must keep raw/content/publication/approval field counts at zero.");
  }
  if (proof.specialistContentIncluded || proof.candidateFingerprintsIncluded || proof.candidateBodiesIncluded || proof.rawModelOutputIncluded || proof.toolPayloadIncluded || proof.approvalFieldsIncluded || proof.tierModeIncluded) {
    failures.push("synthetic projection must not include specialist content, fingerprints, bodies, raw model output, tool payload, approval fields, or tier mode.");
  }
  if (proof.serializedLeakMatches.length > 0) failures.push(`synthetic projection leaked forbidden sentinel content: ${proof.serializedLeakMatches.join(", ")}.`);

  return makeCheck({
    id: "M069-S03-CANDIDATE-METRIC-PROJECTION",
    okCode: "candidate_metric_projection_ok",
    failCode: "candidate_metric_projection_failed",
    okDetail: "synthetic specialist candidate fixture projects to private aggregate metrics without content leaks.",
    failures,
  });
}

function buildHandlerMetricWiringCheck(summary: HandlerMetricWiringSummary): M069S03Check {
  const failures: string[] = [];
  if (!summary.handlerImportsReducer) failures.push("review handler must import projectShadowSpecialistMetrics.");
  if (!summary.handlerBuildsMetricLogFields) failures.push("review handler must build private shadow-specialist metric log fields.");
  if (!summary.handlerLogsBoundedCounts) failures.push("review handler metric fields must include bounded candidate/decision/duplicate/disagreement counts and metric availability.");
  if (!summary.handlerLogsProjectionDenials) failures.push("review handler metric fields must include redaction, publication denial, and no-content booleans.");
  if (!summary.handlerLogsCorrelationKeys) failures.push("review handler metric fields must include delivery/review/correlation keys only as correlation keys.");
  if (!summary.handlerProjectionFailOpenPresent) failures.push("review handler metric projection failures must degrade privately instead of blocking publication.");

  return makeCheck({
    id: "M069-S03-HANDLER-METRIC-WIRING",
    okCode: "handler_metric_wiring_ok",
    failCode: "handler_metric_wiring_failed",
    okDetail: "review handler logs reducer-backed private aggregate metrics and has a private degraded projection fallback.",
    failures,
  });
}

function buildPublicationBoundaryCheck(boundary: M069S03Report["sourceBoundary"]): M069S03Check {
  const failures: string[] = [];
  if (boundary.reducerForbiddenPublicationMatches.length > 0) failures.push(`metrics reducer must not import or call publication/approval tools: ${boundary.reducerForbiddenPublicationMatches.join(", ")}.`);
  if (boundary.handlerShadowForbiddenPublicationMatches.length > 0) failures.push(`handler shadow metric block must not call publication/approval tools: ${boundary.handlerShadowForbiddenPublicationMatches.join(", ")}.`);

  return makeCheck({
    id: "M069-S03-PUBLICATION-BOUNDARY",
    okCode: "publication_boundary_ok",
    failCode: "publication_boundary_failed",
    okDetail: "specialist metric reducer and handler metric block have no GitHub publication or approval callbacks.",
    failures,
  });
}

function buildNegativeVisibleSurfaceCheck(proof: ProjectionProof, boundary: M069S03Report["sourceBoundary"]): M069S03Check {
  const failures: string[] = [];
  if (proof.serializedLeakMatches.length > 0) failures.push(`JSON projection must not expose specialist candidate/raw content: ${proof.serializedLeakMatches.join(", ")}.`);
  if (boundary.handlerShadowRawPayloadMatches.length > 0) failures.push(`handler shadow metric block must not expose raw payload/comment/candidate body fields: ${boundary.handlerShadowRawPayloadMatches.join(", ")}.`);
  if (boundary.handlerShadowPromptMatches.length > 0) failures.push(`handler shadow metric block must not build or expose specialist prompts/model output: ${boundary.handlerShadowPromptMatches.join(", ")}.`);
  if (boundary.handlerShadowReviewDetailsMatches.length > 0) failures.push(`handler shadow metric block must not write specialist candidate content into Review Details-visible surfaces: ${boundary.handlerShadowReviewDetailsMatches.join(", ")}.`);
  if (boundary.tierModeFieldCount > 0 || proof.tierModeIncluded) failures.push("specialist tier-mode fields must not be projected or logged.");

  return makeCheck({
    id: "M069-S03-NEGATIVE-VISIBLE-SURFACE",
    okCode: "negative_visible_surface_ok",
    failCode: "negative_visible_surface_failed",
    okDetail: "no specialist prompt, raw payload, candidate body, Review Details, approval, or tier-mode content is visible through the metric surface.",
    failures,
  });
}

function summarizeReducer(reducerText: string): ReducerSummary {
  return {
    reducerExportPresent: reducerText.includes("export function projectShadowSpecialistMetrics"),
    projectionTypeExportPresent: reducerText.includes("export type ShadowSpecialistMetricsProjection"),
    reducerPrivateDenialFieldsPresent: [
      "readonly privateOnly: true",
      "readonly shadowOnly: true",
      "readonly publishesFindings: false",
      "readonly visiblePublicationDenied: true",
      "readonly approvalPublicationDenied: true",
    ].every((needle) => reducerText.includes(needle)),
    reducerZeroContentCountsPresent: [
      "readonly rawContentFieldCount: 0",
      "readonly candidateBodyFieldCount: 0",
      "readonly githubPublicationFieldCount: 0",
      "readonly approvalFieldCount: 0",
      "rawContentFieldCount: 0",
      "candidateBodyFieldCount: 0",
      "githubPublicationFieldCount: 0",
      "approvalFieldCount: 0",
    ].every((needle) => reducerText.includes(needle)),
    reducerNoContentInclusionPresent: [
      "readonly specialistContentIncluded: false",
      "readonly candidateFingerprintsIncluded: false",
      "readonly candidateBodiesIncluded: false",
      "readonly rawModelOutputIncluded: false",
      "readonly toolPayloadIncluded: false",
      "readonly approvalFieldsIncluded: false",
      "readonly tierModeIncluded: false",
      "specialistContentIncluded: false",
      "candidateFingerprintsIncluded: false",
      "candidateBodiesIncluded: false",
      "rawModelOutputIncluded: false",
      "toolPayloadIncluded: false",
      "approvalFieldsIncluded: false",
      "tierModeIncluded: false",
    ].every((needle) => reducerText.includes(needle)),
  };
}

function summarizeHandlerMetricWiring(handlerText: string): HandlerMetricWiringSummary {
  const block = extractFunctionBlock(handlerText, "buildShadowSpecialistLogFields") ?? "";
  return {
    handlerImportsReducer: handlerText.includes("../specialists/shadow-specialist-metrics.ts") && handlerText.includes("projectShadowSpecialistMetrics"),
    handlerBuildsMetricLogFields: block.includes("function buildShadowSpecialistLogFields") && block.includes("projectShadowSpecialistMetrics(result)"),
    handlerLogsBoundedCounts: [
      "candidateCount",
      "decisionCount",
      "duplicateCount",
      "disagreementCount",
      "metricAvailability",
      "tokenCountAvailable",
      "costAvailable",
      "latencyMsAvailable",
    ].every((needle) => block.includes(needle)),
    handlerLogsProjectionDenials: [
      "discardedRawPayload",
      "discardedPublicationFields",
      "discardedApprovalFields",
      "visiblePublicationDenied",
      "approvalPublicationDenied",
      "rawContentFieldCount",
      "candidateBodyFieldCount",
      "githubPublicationFieldCount",
      "approvalFieldCount",
      "specialistContentIncluded",
      "candidateFingerprintsIncluded",
      "candidateBodiesIncluded",
      "rawModelOutputIncluded",
      "toolPayloadIncluded",
      "approvalFieldsIncluded",
      "tierModeIncluded",
    ].every((needle) => block.includes(needle)),
    handlerLogsCorrelationKeys: ["deliveryId", "reviewOutputKey", "correlationKey"].every((needle) => block.includes(needle)),
    handlerProjectionFailOpenPresent: block.includes("metrics-projection-error") && block.includes("metricProjectionDegraded: true"),
    normalPublicationPathPresent: handlerText.includes("buildApprovedReviewBody") && handlerText.includes("ensureReviewOutputNotPublished"),
  };
}

function summarizeSourceBoundary(reducerText: string, handlerText: string): M069S03Report["sourceBoundary"] {
  const handlerBlock = extractFunctionBlock(handlerText, "buildShadowSpecialistLogFields") ?? "";
  return {
    reducerForbiddenPublicationMatches: uniqueMatches(reducerText, FORBIDDEN_PUBLICATION_PATTERNS),
    handlerShadowForbiddenPublicationMatches: uniqueMatches(handlerBlock, FORBIDDEN_PUBLICATION_PATTERNS),
    handlerShadowRawPayloadMatches: uniqueMatches(handlerBlock, RAW_PAYLOAD_PATTERNS),
    handlerShadowPromptMatches: uniqueMatches(handlerBlock, PROMPT_PATTERNS),
    handlerShadowReviewDetailsMatches: uniqueMatches(handlerBlock, REVIEW_DETAILS_PATTERNS),
    tierModeFieldCount: countOccurrences(handlerBlock, "tierMode:"),
  };
}

function extractFunctionBlock(source: string, functionName: string): string | null {
  const start = source.indexOf(`function ${functionName}`);
  if (start < 0) return null;
  const bodyStart = source.indexOf("{", start);
  if (bodyStart < 0) return null;
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return null;
}

function uniqueMatches(text: string, patterns: readonly string[]): readonly string[] {
  return [...new Set(patterns.filter((pattern) => text.includes(pattern)))];
}

function countOccurrences(text: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let index = text.indexOf(needle);
  while (index >= 0) {
    count += 1;
    index = text.indexOf(needle, index + needle.length);
  }
  return count;
}

function makeCheck(params: {
  id: M069S03CheckId;
  okCode: M069S03CheckStatusCode;
  failCode: M069S03CheckStatusCode;
  okDetail: string;
  failures: readonly string[];
}): M069S03Check {
  const passed = params.failures.length === 0;
  return {
    id: params.id,
    passed,
    status: passed ? "pass" : "fail",
    status_code: passed ? params.okCode : params.failCode,
    detail: passed ? params.okDetail : params.failures.join(" "),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function renderM069S03Report(report: M069S03Report): string {
  return [
    "M069 S03 private metric/publication boundary verifier",
    `status: ${report.status_code}`,
    `success: ${report.success ? "yes" : "no"}`,
    `proof: ${report.proofMode} / ${report.proofScope}`,
    "",
    "checks:",
    ...report.checks.map((check) => `- [${check.passed ? "x" : " "}] ${check.id}: ${check.detail}`),
    "",
    "bounded metrics:",
    `- candidateMetricProjectionPassed: ${report.candidateMetricProjectionPassed}`,
    `- handlerMetricWiringPresent: ${report.handlerMetricWiringPresent}`,
    `- visiblePublicationFieldCount: ${report.visiblePublicationFieldCount}`,
    `- approvalFieldCount: ${report.approvalFieldCount}`,
    `- rawPayloadLeakCount: ${report.rawPayloadLeakCount}`,
    `- specialistPromptInjectionCount: ${report.specialistPromptInjectionCount}`,
    `- normalReviewPublicationOnly: ${report.normalReviewPublicationOnly}`,
    `- reviewDetailsSpecialistCandidateVisible: ${report.reviewDetailsSpecialistCandidateVisible}`,
    `- tierModeFieldCount: ${report.tierModeFieldCount}`,
    "",
    "targeted tests:",
    ...report.targetedTests.map((command) => `- ${command}`),
    ...(report.issues.length > 0 ? ["", "issues:", ...report.issues.map((issue) => `- ${issue}`)] : []),
    "",
  ].join("\n");
}

export function renderHelp(): string {
  return [
    "M069 S03 private metric/publication boundary verifier",
    "",
    "Usage:",
    "  bun run verify:m069:s03 [--json]",
    "",
    "Notes:",
    "  - Uses package.json plus static source-file contract checks and one synthetic reducer projection only.",
    "  - Does not read .gsd, .planning, .audits, .env, GitHub, Azure, databases, or credentials.",
    "  - Emits bounded booleans and counts; no raw prompts, model text, tool payloads, candidate bodies, visible comments, approval fields, correctness claims, or security claims.",
    "  - Proof is local fixture/static, not live operational proof.",
    "",
  ].join("\n");
}

export async function main(
  args: readonly string[] = process.argv.slice(2),
  io?: {
    stdout?: { write: (chunk: string) => void };
    stderr?: { write: (chunk: string) => void };
    evaluate?: typeof evaluateM069S03Contract;
  },
): Promise<number> {
  const stdout = io?.stdout ?? process.stdout;
  const stderr = io?.stderr ?? process.stderr;
  const evaluate = io?.evaluate ?? evaluateM069S03Contract;

  let parsed: M069S03Args;
  try {
    parsed = parseM069S03Args(args);
  } catch (error) {
    const report = buildInvalidArgReport(error instanceof Error ? error.message : String(error));
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 2;
  }

  if (parsed.help) {
    stdout.write(renderHelp());
    return 0;
  }

  const report = await evaluate({ generatedAt: new Date().toISOString() });
  if (parsed.json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    stdout.write(renderM069S03Report(report));
  }

  if (!report.success) {
    stderr.write(`${COMMAND_NAME} failed: ${report.failing_check_id ?? "unknown"}\n`);
  }

  return report.success ? 0 : 1;
}

function buildInvalidArgReport(issue: string): M069S03Report {
  return {
    command: COMMAND_NAME,
    generated_at: new Date().toISOString(),
    proofMode: "local-fixture-static",
    proofScope: "non-live-source-and-fixture-proof",
    success: false,
    status_code: "m069_s03_invalid_arg",
    candidateMetricProjectionPassed: false,
    handlerMetricWiringPresent: false,
    visiblePublicationFieldCount: 0,
    approvalFieldCount: 0,
    rawPayloadLeakCount: 0,
    specialistPromptInjectionCount: 0,
    normalReviewPublicationOnly: false,
    reviewDetailsSpecialistCandidateVisible: false,
    tierModeFieldCount: 0,
    check_ids: [...M069_S03_CHECK_IDS],
    checks: [],
    failing_check_id: null,
    summary: {
      packageScriptWired: false,
      reducerExportPresent: false,
      reducerPrivateDenialFieldsPresent: false,
      reducerZeroContentCountsPresent: false,
      handlerImportsReducer: false,
      handlerBuildsMetricLogFields: false,
      handlerLogsProjectionDenials: false,
      handlerProjectionFailOpenPresent: false,
      readsPlanningOrSecrets: false,
      liveServiceRequired: false,
    },
    projection: {
      laneId: "",
      status: "",
      reason: null,
      candidateCount: 0,
      decisionCount: 0,
      duplicateCount: 0,
      disagreementCount: 0,
      tokenCountAvailable: false,
      costAvailable: false,
      latencyMsAvailable: false,
      visiblePublicationDenied: false,
      approvalPublicationDenied: false,
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
    sourceBoundary: {
      reducerForbiddenPublicationMatches: [],
      handlerShadowForbiddenPublicationMatches: [],
      handlerShadowRawPayloadMatches: [],
      handlerShadowPromptMatches: [],
      handlerShadowReviewDetailsMatches: [],
      tierModeFieldCount: 0,
    },
    targetedTests: [...TARGETED_TEST_COMMANDS],
    issues: [issue],
  };
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
