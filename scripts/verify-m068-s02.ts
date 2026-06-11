import { createInlineReviewPublisher, REVIEW_OUTPUT_MARKER_PREFIX, type InlineReviewPublicationResult } from "../src/execution/mcp/inline-review-publisher.ts";
import { buildPrDiffCommentabilityIndex, type PrDiffCommentabilityIndex } from "../src/execution/formatter-suggestions.ts";
import { coordinateReviewCandidateApproval, type ReviewCandidateApprovalResult } from "../src/review-orchestration/review-candidate-approval.ts";
import {
  adaptApprovedCandidatesForInlinePublication,
  convertPublishedCandidateResultsToProcessedFindings,
  type PublishableReviewCandidateInlinePayload,
} from "../src/review-orchestration/review-candidate-publication-adapter.ts";
import {
  createReviewCandidateFindingExecutionResult,
  type ReviewCandidateFinding,
  type ReviewCandidateFindingExecutionResult,
} from "../src/review-orchestration/review-candidate-finding.ts";
import type { ProcessedReviewFinding, ReviewReducerResult } from "../src/review-orchestration/review-reducer.ts";

export const M068_S02_CHECK_IDS = [
  "M068-S02-ADAPTER-MAPPING",
  "M068-S02-NO-PARALLEL-PUBLISHER",
  "M068-S02-IDEMPOTENCY",
  "M068-S02-COMMENTABILITY",
  "M068-S02-SECRET-SCAN",
  "M068-S02-BOUNDED-EVIDENCE",
  "M068-S02-PROCESSED-FINDING-SHAPE",
] as const;

export type M068S02CheckId = (typeof M068_S02_CHECK_IDS)[number];

export type M068S02StatusCode =
  | "m068_s02_ok"
  | "m068_s02_contract_failed"
  | "m068_s02_invalid_arg";

export type M068S02CheckStatusCode =
  | "adapter_mapping_ok"
  | "adapter_mapping_failed"
  | "no_parallel_publisher_ok"
  | "no_parallel_publisher_failed"
  | "idempotency_ok"
  | "idempotency_failed"
  | "commentability_ok"
  | "commentability_failed"
  | "secret_scan_ok"
  | "secret_scan_failed"
  | "bounded_evidence_ok"
  | "bounded_evidence_failed"
  | "processed_finding_shape_ok"
  | "processed_finding_shape_failed";

export type M068S02Check = {
  id: M068S02CheckId;
  passed: boolean;
  status_code: M068S02CheckStatusCode;
  detail: string;
};

export type M068S02Report = {
  command: "verify:m068:s02";
  generated_at: string;
  success: boolean;
  status_code: M068S02StatusCode;
  check_ids: M068S02CheckId[];
  checks: M068S02Check[];
  failing_check_id: M068S02CheckId | null;
  issues: string[];
  contract: {
    adapter: {
      input_count: number;
      publishable_count: number;
      skipped_count: number;
      skipped_reasons: string[];
      payload_paths: string[];
    };
    publication: {
      published_status: string | null;
      published_comment_id: number | null;
      idempotency_status: string | null;
      idempotency_reason: string | null;
      commentability_status: string | null;
      commentability_reason: string | null;
      secret_status: string | null;
      secret_reason: string | null;
      github_validation_status: string | null;
      github_validation_reason: string | null;
      create_review_comment_calls: number;
      sanitized_mention: boolean;
    };
    processed: {
      processed_count: number;
      skipped_count: number;
      blocked_count: number;
      failed_count: number;
      malformed_count: number;
      comment_ids: number[];
      statuses: string[];
      reasons: string[];
    };
    static_boundary: {
      adapter_path: string;
      adapter_create_review_comment_callsite_count: number;
      publisher_create_review_comment_callsite_count: number;
      marker_prefix: string;
    };
  };
  redaction: {
    leak_marker_count: number;
    serialized_report_length: number;
  };
};

type VerifyM068S02Args = {
  help: boolean;
  json: boolean;
};

type ScenarioContext = {
  validPayloads: PublishableReviewCandidateInlinePayload[];
  malformedPayloads: PublishableReviewCandidateInlinePayload[];
  skippedReasons: string[];
  publicationResults: Map<string, InlineReviewPublicationResult>;
  publishedBodies: string[];
  createReviewCommentCalls: number;
};

const BASE_INPUT = {
  repo: "owner/repo",
  pullNumber: 68,
  reviewOutputKey: "m068-s02-candidate-publication",
  deliveryId: "delivery-m068-s02",
};

const ADAPTER_PATH = "src/review-orchestration/review-candidate-publication-adapter.ts";
const PUBLISHER_PATH = "src/execution/mcp/inline-review-publisher.ts";

const RAW_LEAK_MARKERS = [
  "BEGIN PROMPT",
  "PROMPT_SECRET",
  "diff --git a/private",
  "TOKEN=abc123",
  "sk-live-secret-token",
  "rawPrompt",
  "rawDiff",
  "AKIA1234567890123456",
  "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
  "Credential-like fixture",
];

export function parseVerifyM068S02Args(args: string[]): VerifyM068S02Args {
  for (const arg of args) {
    if (arg === "--help" || arg === "-h" || arg === "--json") {
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return {
    help: args.includes("--help") || args.includes("-h"),
    json: args.includes("--json"),
  };
}

function passedCheck(id: M068S02CheckId, statusCode: M068S02CheckStatusCode, detail: string): M068S02Check {
  return { id, passed: true, status_code: statusCode, detail: boundedDetail(detail) };
}

function failedCheck(id: M068S02CheckId, statusCode: M068S02CheckStatusCode, failures: string[]): M068S02Check {
  return { id, passed: false, status_code: statusCode, detail: boundedDetail(failures.join("; ")) };
}

function boundedDetail(value: string): string {
  return sanitizeEvidenceText(value).replace(/\s+/g, " ").slice(0, 240) || "bounded-result";
}

function sanitizeEvidenceText(value: string): string {
  return value
    .replace(/BEGIN\s+PROMPT/gi, "prompt-redacted")
    .replace(/PROMPT[_-]?SECRET/gi, "prompt-redacted")
    .replace(/diff --git[^\s]*/gi, "diff-redacted")
    .replace(/TOKEN\s*=\s*[^\s]+/gi, "token-redacted")
    .replace(/sk-[a-zA-Z0-9_-]+/g, "redacted")
    .replace(/AKIA[0-9A-Z]{16}/g, "redacted")
    .replace(/gh[pousr]_[a-zA-Z0-9_]+/g, "redacted")
    .replace(/Credential-like fixture/gi, "credential-redacted")
    .replace(/rawPrompt/gi, "raw-prompt-redacted")
    .replace(/rawDiff/gi, "raw-diff-redacted");
}

function emptyContract(): M068S02Report["contract"] {
  return {
    adapter: {
      input_count: 0,
      publishable_count: 0,
      skipped_count: 0,
      skipped_reasons: [],
      payload_paths: [],
    },
    publication: {
      published_status: null,
      published_comment_id: null,
      idempotency_status: null,
      idempotency_reason: null,
      commentability_status: null,
      commentability_reason: null,
      secret_status: null,
      secret_reason: null,
      github_validation_status: null,
      github_validation_reason: null,
      create_review_comment_calls: 0,
      sanitized_mention: false,
    },
    processed: {
      processed_count: 0,
      skipped_count: 0,
      blocked_count: 0,
      failed_count: 0,
      malformed_count: 0,
      comment_ids: [],
      statuses: [],
      reasons: [],
    },
    static_boundary: {
      adapter_path: ADAPTER_PATH,
      adapter_create_review_comment_callsite_count: 0,
      publisher_create_review_comment_callsite_count: 0,
      marker_prefix: REVIEW_OUTPUT_MARKER_PREFIX,
    },
  };
}

function emptyReport(params: { generatedAt?: string; issue?: string } = {}): M068S02Report {
  const issue = params.issue ? boundedDetail(params.issue) : null;
  return {
    command: "verify:m068:s02",
    generated_at: params.generatedAt ?? new Date().toISOString(),
    success: false,
    status_code: issue?.startsWith("unknown argument") ? "m068_s02_invalid_arg" : "m068_s02_contract_failed",
    check_ids: [...M068_S02_CHECK_IDS],
    checks: [],
    failing_check_id: null,
    issues: issue ? [issue] : [],
    contract: emptyContract(),
    redaction: { leak_marker_count: 0, serialized_report_length: 0 },
  };
}

function countCreateReviewCommentCallsites(source: string): number {
  return source.match(/\.pulls\.createReviewComment\(/g)?.length ?? 0;
}

function candidateInput(filePath: string, title: string, overrides: Record<string, unknown> = {}) {
  return {
    filePath,
    startLine: 10,
    endLine: 10,
    severity: "major",
    category: "correctness",
    title,
    body: `${title} body is safe and grounded.`,
    ...overrides,
  };
}

function candidateResult(candidates: Parameters<typeof createReviewCandidateFindingExecutionResult>[0]["candidates"]): ReviewCandidateFindingExecutionResult {
  return createReviewCandidateFindingExecutionResult({ ...BASE_INPUT, artifactPresent: true, candidates });
}

function reducerFinding(
  commentId: number,
  candidate: ReviewCandidateFinding,
  overrides: Partial<ProcessedReviewFinding> & { candidateFingerprint?: string; body?: string } = {},
): ProcessedReviewFinding {
  return {
    commentId,
    filePath: candidate.filePath,
    title: candidate.title,
    severity: candidate.severity,
    category: candidate.category,
    startLine: candidate.startLine,
    endLine: candidate.endLine,
    suppressed: false,
    confidence: 90,
    body: candidate.body,
    ...overrides,
  };
}

function reducerResult(overrides: Partial<ReviewReducerResult> = {}): ReviewReducerResult {
  const findings = overrides.findings ?? [];
  const visibleFindings = overrides.visibleFindings ?? [];
  const filteredInlineFindings = overrides.filteredInlineFindings ?? [];
  const lowConfidenceFindings = overrides.lowConfidenceFindings ?? [];
  return {
    status: "ready",
    findings,
    visibleFindings,
    filteredInlineFindings,
    lowConfidenceFindings,
    suppressionMatchCounts: new Map(),
    filterRecords: [],
    counts: {
      input: findings.length,
      kept: visibleFindings.length,
      suppressed: filteredInlineFindings.filter((finding) => finding.suppressed).length,
      rewritten: visibleFindings.filter((finding) => finding.filterAction === "rewritten" || finding.filterAction === "guardrail-rewritten").length,
      deprioritized: filteredInlineFindings.filter((finding) => finding.deprioritized).length,
      lowConfidence: lowConfidenceFindings.length,
      auditEvents: 0,
      severityDemoted: 0,
      graphValidated: 0,
      graphUncertain: 0,
    },
    audit: [],
    detailsSummary: { label: "Review reducer", status: "ready", text: "Review reducer: ready" },
    ...overrides,
  };
}

function approvalForCandidates(candidates: ReviewCandidateFinding[]): ReviewCandidateApprovalResult {
  return coordinateReviewCandidateApproval({
    candidates: candidateResult(candidates),
    reducer: reducerResult({
      findings: candidates.map((candidate, index) => reducerFinding(index + 1, candidate, { candidateFingerprint: candidate.fingerprint })),
      visibleFindings: candidates.map((candidate, index) => reducerFinding(index + 1, candidate, { candidateFingerprint: candidate.fingerprint })),
    }),
  });
}

async function buildScenarioContext(): Promise<ScenarioContext> {
  const validCandidates = candidateResult([
    candidateInput("src/published.ts", "@kodiai publishable candidate"),
    candidateInput("src/skipped.ts", "Idempotent candidate"),
    candidateInput("src/non-commentable.ts", "Non commentable candidate", { startLine: 11, endLine: 11 }),
    candidateInput("src/secret.ts", "Secret candidate", {
      body: "Credential-like fixture AKIA1234567890123456 must be blocked before GitHub create.",
    }),
    candidateInput("src/malformed-publisher.ts", "Malformed publisher result candidate"),
  ]).findings;
  const approval = approvalForCandidates(validCandidates);
  const adapted = adaptApprovedCandidatesForInlinePublication({ approval, reducer: reducerResult() });

  const missingPathCandidate: ReviewCandidateFinding = {
    fingerprint: "rcf-aaaaaaaaaaaaaaaa",
    repo: "xbmc/xbmc",
    pullNumber: 28172,
    reviewOutputKey: "kodiai-review-output:v1:inst-42:xbmc/xbmc:pr-28172:action-opened:delivery-delivery-28172:head-head-28172",
    filePath: "",
    startLine: 10,
    endLine: 10,
    severity: "major",
    category: "correctness",
    title: "Missing path candidate",
    body: "Missing path candidate body is safe and grounded.",
  };
  const malformedCandidates = [
    missingPathCandidate,
    ...candidateResult([
      candidateInput("src/missing-line.ts", "Missing line candidate", { startLine: undefined, endLine: undefined }),
    ]).findings,
  ];
  const malformedApproval: ReviewCandidateApprovalResult = {
    outcomes: [],
    approvedCandidates: malformedCandidates.map((candidate) => ({
      lifecycle: "approved" as const,
      fingerprint: candidate.fingerprint,
      candidate,
    })),
    rewrittenCandidates: [],
    counts: { input: malformedCandidates.length, approved: malformedCandidates.length, rewritten: 0, suppressed: 0, deduped: 0, rejected: 0, fallbackDisallowed: 0, auditEvents: 0 },
    audit: [],
    detailsSummary: { label: "Review candidate approval", text: "Review candidate approval: verifier fixture" },
  };
  const malformedAdapted = adaptApprovedCandidatesForInlinePublication({ approval: malformedApproval, reducer: reducerResult() });

  const payloadByPath = new Map(adapted.payloads.map((payload) => [payload.publication.location.path, payload]));
  const publicationResults = new Map<string, InlineReviewPublicationResult>();
  const publishedBodies: string[] = [];
  let createReviewCommentCalls = 0;
  const octokit = {
    rest: {
      pulls: {
        get: async () => ({ data: { head: { sha: "abcdef1234" } } }),
        createReviewComment: async (params: { body: string; path: string; line: number }) => {
          createReviewCommentCalls++;
          publishedBodies.push(params.body);
          if (params.path === "src/github-validation.ts") {
            const error = new Error("Validation Failed") as Error & { status?: number; response?: unknown };
            error.status = 422;
            error.response = { data: { message: "Validation Failed", errors: [{ code: "invalid" }] }, headers: { "x-github-request-id": "REQ123" } };
            throw error;
          }
          return {
            data: {
              id: 9000 + createReviewCommentCalls,
              html_url: `https://example.test/comment/${9000 + createReviewCommentCalls}`,
              path: params.path,
              line: params.line,
              original_line: params.line,
            },
          };
        },
      },
    },
  };

  async function publishPayload(
    payload: PublishableReviewCandidateInlinePayload,
    options: { shouldPublish?: boolean; prDiffCommentabilityIndex?: PrDiffCommentabilityIndex } = {},
  ): Promise<InlineReviewPublicationResult> {
    const publisher = createInlineReviewPublisher({
      getOctokit: async () => octokit as never,
      owner: "acme",
      repo: "repo",
      prNumber: 68,
      botHandles: ["kodiai"],
      reviewOutputKey: `review-output-${payload.publication.location.path}`,
      publicationGate: { resolve: async () => ({ shouldPublish: options.shouldPublish ?? true }) as never },
      prDiffCommentabilityIndex: options.prDiffCommentabilityIndex,
    });
    return publisher.publish(payload.publication);
  }

  const publishedPayload = payloadByPath.get("src/published.ts")!;
  const skippedPayload = payloadByPath.get("src/skipped.ts")!;
  const nonCommentablePayload = payloadByPath.get("src/non-commentable.ts")!;
  const secretPayload = payloadByPath.get("src/secret.ts")!;
  const malformedPublisherPayload = payloadByPath.get("src/malformed-publisher.ts")!;

  publicationResults.set(publishedPayload.candidateFingerprint, await publishPayload(publishedPayload));
  publicationResults.set(skippedPayload.candidateFingerprint, await publishPayload(skippedPayload, { shouldPublish: false }));
  publicationResults.set(nonCommentablePayload.candidateFingerprint, await publishPayload(nonCommentablePayload, {
    prDiffCommentabilityIndex: buildPrDiffCommentabilityIndex([
      "diff --git a/src/non-commentable.ts b/src/non-commentable.ts",
      "--- a/src/non-commentable.ts",
      "+++ b/src/non-commentable.ts",
      "@@ -1,1 +10,1 @@",
      "+commentable",
    ].join("\n")),
  }));
  publicationResults.set(secretPayload.candidateFingerprint, await publishPayload(secretPayload));
  publicationResults.set(malformedPublisherPayload.candidateFingerprint, {
    status: "published",
    content: [{ type: "text", text: "{}" }],
  });

  return {
    validPayloads: adapted.payloads,
    malformedPayloads: malformedAdapted.payloads,
    skippedReasons: malformedAdapted.summary.skipped.map((item) => item.reason),
    publicationResults,
    publishedBodies,
    createReviewCommentCalls,
  };
}

function resultForPath(context: ScenarioContext, path: string): InlineReviewPublicationResult | undefined {
  const payload = context.validPayloads.find((candidatePayload) => candidatePayload.publication.location.path === path);
  return payload ? context.publicationResults.get(payload.candidateFingerprint) : undefined;
}

async function buildChecks(contract: M068S02Report["contract"]): Promise<M068S02Check[]> {
  const checks: M068S02Check[] = [];
  const context = await buildScenarioContext();
  const converted = convertPublishedCandidateResultsToProcessedFindings({
    payloads: context.validPayloads,
    results: context.publicationResults,
  });

  contract.adapter = {
    input_count: context.validPayloads.length + context.skippedReasons.length,
    publishable_count: context.validPayloads.length,
    skipped_count: context.skippedReasons.length,
    skipped_reasons: [...context.skippedReasons].sort(),
    payload_paths: context.validPayloads.map((payload) => payload.publication.location.path).sort(),
  };
  contract.processed = {
    processed_count: converted.summary.counts.processed,
    skipped_count: converted.summary.counts.skipped,
    blocked_count: converted.summary.counts.blocked,
    failed_count: converted.summary.counts.failed,
    malformed_count: converted.summary.counts.malformed,
    comment_ids: converted.findings.map((finding) => finding.commentId),
    statuses: converted.summary.results.map((result) => result.status),
    reasons: converted.summary.results.map((result) => result.reason),
  };

  const published = resultForPath(context, "src/published.ts");
  const skipped = resultForPath(context, "src/skipped.ts");
  const nonCommentable = resultForPath(context, "src/non-commentable.ts");
  const secret = resultForPath(context, "src/secret.ts");
  contract.publication = {
    published_status: published?.status ?? null,
    published_comment_id: published?.commentId ?? null,
    idempotency_status: skipped?.status ?? null,
    idempotency_reason: skipped?.reason ?? null,
    commentability_status: nonCommentable?.status ?? null,
    commentability_reason: nonCommentable?.reason ?? null,
    secret_status: secret?.status ?? null,
    secret_reason: secret?.reason ?? null,
    github_validation_status: null,
    github_validation_reason: null,
    create_review_comment_calls: context.createReviewCommentCalls,
    sanitized_mention: context.publishedBodies[0]?.includes("@kodiai") === false && context.publishedBodies[0]?.includes("kodiai publishable candidate") === true,
  };

  const adapterFailures = [
    ...(contract.adapter.publishable_count !== 5 ? [`publishable=${contract.adapter.publishable_count}`] : []),
    ...(contract.adapter.skipped_count !== 2 ? [`skipped=${contract.adapter.skipped_count}`] : []),
    ...(!contract.adapter.skipped_reasons.includes("missing-line") ? ["missing-line skip absent"] : []),
    ...(!contract.adapter.skipped_reasons.includes("missing-path") ? ["missing-path skip absent"] : []),
    ...(context.malformedPayloads.length !== 0 ? [`malformed payloads accepted=${context.malformedPayloads.length}`] : []),
  ];
  checks.push(adapterFailures.length === 0
    ? passedCheck("M068-S02-ADAPTER-MAPPING", "adapter_mapping_ok", "approved candidates adapt to publishable payloads while malformed path/line inputs remain bounded skips")
    : failedCheck("M068-S02-ADAPTER-MAPPING", "adapter_mapping_failed", adapterFailures));

  const [adapterSource, publisherSource] = await Promise.all([
    Bun.file(ADAPTER_PATH).text(),
    Bun.file(PUBLISHER_PATH).text(),
  ]);
  contract.static_boundary.adapter_create_review_comment_callsite_count = countCreateReviewCommentCallsites(adapterSource);
  contract.static_boundary.publisher_create_review_comment_callsite_count = countCreateReviewCommentCallsites(publisherSource);
  const boundaryFailures = [
    ...(contract.static_boundary.adapter_create_review_comment_callsite_count !== 0 ? [`${ADAPTER_PATH} createReviewComment callsites=${contract.static_boundary.adapter_create_review_comment_callsite_count}`] : []),
    ...(contract.static_boundary.publisher_create_review_comment_callsite_count !== 1 ? [`${PUBLISHER_PATH} createReviewComment callsites=${contract.static_boundary.publisher_create_review_comment_callsite_count}`] : []),
  ];
  checks.push(boundaryFailures.length === 0
    ? passedCheck("M068-S02-NO-PARALLEL-PUBLISHER", "no_parallel_publisher_ok", `${ADAPTER_PATH} has no direct GitHub createReviewComment call; shared publisher owns the single writer`)
    : failedCheck("M068-S02-NO-PARALLEL-PUBLISHER", "no_parallel_publisher_failed", boundaryFailures));

  const idempotencyFailures = [
    ...(contract.publication.idempotency_status !== "skipped" ? [`status=${contract.publication.idempotency_status ?? "missing"}`] : []),
    ...(contract.publication.idempotency_reason !== "already-published" ? [`reason=${contract.publication.idempotency_reason ?? "missing"}`] : []),
    ...(contract.publication.create_review_comment_calls !== 1 ? [`runtime create calls=${contract.publication.create_review_comment_calls}`] : []),
  ];
  checks.push(idempotencyFailures.length === 0
    ? passedCheck("M068-S02-IDEMPOTENCY", "idempotency_ok", "publication gate returns already-published as a bounded skipped result before duplicate create")
    : failedCheck("M068-S02-IDEMPOTENCY", "idempotency_failed", idempotencyFailures));

  const commentabilityFailures = [
    ...(contract.publication.commentability_status !== "failed" ? [`status=${contract.publication.commentability_status ?? "missing"}`] : []),
    ...(contract.publication.commentability_reason !== "line-not-commentable-in-pr-diff" ? [`reason=${contract.publication.commentability_reason ?? "missing"}`] : []),
  ];
  checks.push(commentabilityFailures.length === 0
    ? passedCheck("M068-S02-COMMENTABILITY", "commentability_ok", "shared publisher rejects non-commentable RIGHT lines before GitHub create")
    : failedCheck("M068-S02-COMMENTABILITY", "commentability_failed", commentabilityFailures));

  const secretFailures = [
    ...(contract.publication.secret_status !== "blocked" ? [`status=${contract.publication.secret_status ?? "missing"}`] : []),
    ...(contract.publication.secret_reason !== "secret-detected" ? [`reason=${contract.publication.secret_reason ?? "missing"}`] : []),
    ...(!contract.publication.sanitized_mention ? ["bot mention was not sanitized before publish"] : []),
  ];
  checks.push(secretFailures.length === 0
    ? passedCheck("M068-S02-SECRET-SCAN", "secret_scan_ok", "shared publisher blocks credential-like candidate body and sanitizes bot-handle mentions")
    : failedCheck("M068-S02-SECRET-SCAN", "secret_scan_failed", secretFailures));

  const processedFailures = [
    ...(contract.publication.published_status !== "published" ? [`published status=${contract.publication.published_status ?? "missing"}`] : []),
    ...(contract.publication.published_comment_id !== 9001 ? [`comment id=${contract.publication.published_comment_id ?? "missing"}`] : []),
    ...(contract.processed.processed_count !== 1 ? [`processed=${contract.processed.processed_count}`] : []),
    ...(contract.processed.skipped_count !== 1 ? [`skipped=${contract.processed.skipped_count}`] : []),
    ...(contract.processed.blocked_count !== 1 ? [`blocked=${contract.processed.blocked_count}`] : []),
    ...(contract.processed.failed_count !== 1 ? [`failed=${contract.processed.failed_count}`] : []),
    ...(contract.processed.malformed_count !== 1 ? [`malformed=${contract.processed.malformed_count}`] : []),
    ...(!contract.processed.comment_ids.includes(9001) ? ["published comment id not carried into processed finding"] : []),
  ];
  checks.push(processedFailures.length === 0
    ? passedCheck("M068-S02-PROCESSED-FINDING-SHAPE", "processed_finding_shape_ok", "only published candidate results with numeric comment IDs become processed findings")
    : failedCheck("M068-S02-PROCESSED-FINDING-SHAPE", "processed_finding_shape_failed", processedFailures));

  return checks;
}

export async function evaluateM068S02InlinePublisherContract(params: { generatedAt?: string } = {}): Promise<M068S02Report> {
  const generatedAt = params.generatedAt ?? new Date().toISOString();
  const contract = emptyContract();
  const checks = await buildChecks(contract);
  const partialReport = {
    command: "verify:m068:s02" as const,
    generated_at: generatedAt,
    success: false,
    status_code: "m068_s02_contract_failed" as M068S02StatusCode,
    check_ids: [...M068_S02_CHECK_IDS],
    checks,
    failing_check_id: null,
    issues: [],
    contract,
    redaction: { leak_marker_count: 0, serialized_report_length: 0 },
  };
  const serialized = JSON.stringify(partialReport);
  const leakMarkerCount = RAW_LEAK_MARKERS.filter((marker) => serialized.includes(marker)).length;
  const redaction = { leak_marker_count: leakMarkerCount, serialized_report_length: serialized.length };
  const boundedFailures = [
    ...(leakMarkerCount !== 0 ? [`leak markers=${leakMarkerCount}`] : []),
    ...(serialized.length > 12000 ? [`serialized length=${serialized.length}`] : []),
  ];
  checks.push(boundedFailures.length === 0
    ? passedCheck("M068-S02-BOUNDED-EVIDENCE", "bounded_evidence_ok", "report exposes statuses, reason codes, counts, paths, fingerprints, and comment IDs without raw prompts/diffs/bodies/secrets")
    : failedCheck("M068-S02-BOUNDED-EVIDENCE", "bounded_evidence_failed", boundedFailures));

  const failing = checks.find((check) => !check.passed) ?? null;
  const issues = failing ? [`${failing.id}: ${boundedDetail(failing.detail)}`] : [];

  return {
    command: "verify:m068:s02",
    generated_at: generatedAt,
    success: !failing,
    status_code: failing ? "m068_s02_contract_failed" : "m068_s02_ok",
    check_ids: [...M068_S02_CHECK_IDS],
    checks,
    failing_check_id: failing?.id ?? null,
    issues,
    contract,
    redaction,
  };
}

export function renderM068S02Report(report: M068S02Report): string {
  const lines = [
    "# M068 S02 — Candidate Publication Boundary Verifier",
    "",
    `Status: ${report.status_code}`,
    `Overall success: ${String(report.success)}`,
    `Failing check: ${report.failing_check_id ?? "none"}`,
    `Adapter: publishable=${report.contract.adapter.publishable_count} skipped=${report.contract.adapter.skipped_count} skippedReasons=${report.contract.adapter.skipped_reasons.join(",") || "none"}`,
    `Publication: published=${report.contract.publication.published_status ?? "missing"} idempotency=${report.contract.publication.idempotency_reason ?? "missing"} commentability=${report.contract.publication.commentability_reason ?? "missing"} secret=${report.contract.publication.secret_reason ?? "missing"}`,
    `Processed: processed=${report.contract.processed.processed_count} skipped=${report.contract.processed.skipped_count} blocked=${report.contract.processed.blocked_count} failed=${report.contract.processed.failed_count} malformed=${report.contract.processed.malformed_count}`,
    `Static boundary: adapter=${report.contract.static_boundary.adapter_create_review_comment_callsite_count} publisher=${report.contract.static_boundary.publisher_create_review_comment_callsite_count} path=${report.contract.static_boundary.adapter_path}`,
    `Redaction: leakMarkers=${report.redaction.leak_marker_count} reportLength=${report.redaction.serialized_report_length}`,
    "",
    "Checks:",
  ];

  for (const check of report.checks) {
    lines.push(`- ${check.id}: ${check.status_code} (passed=${String(check.passed)})`);
    lines.push(`  - ${boundedDetail(check.detail)}`);
  }

  if (report.issues.length > 0) {
    lines.push("", "Issues:");
    for (const issue of report.issues) {
      lines.push(`- ${boundedDetail(issue)}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function usage(): string {
  return [
    "Usage: bun run verify:m068:s02 -- [--json]",
    "",
    "Verifies the M068 S02 approved-candidate publication adapter and shared inline publisher boundary using local fixtures only.",
    "",
    "Options:",
    "  --json       Emit machine-readable JSON",
    "  --help       Show this help",
  ].join("\n");
}

export async function main(
  args: string[] = process.argv.slice(2),
  deps?: {
    stdout?: { write: (chunk: string) => void };
    stderr?: { write: (chunk: string) => void };
    evaluateFn?: typeof evaluateM068S02InlinePublisherContract;
  },
): Promise<number> {
  const stdout = deps?.stdout ?? process.stdout;
  const stderr = deps?.stderr ?? process.stderr;
  const evaluateFn = deps?.evaluateFn ?? evaluateM068S02InlinePublisherContract;

  try {
    const options = parseVerifyM068S02Args(args);
    if (options.help) {
      stdout.write(`${usage()}\n`);
      return 0;
    }

    const report = await evaluateFn();
    stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderM068S02Report(report));

    if (!report.success) {
      stderr.write(`verify:m068:s02 failed: ${report.failing_check_id ?? report.status_code}\n`);
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
