import {
  createDegradedReviewCandidateFindingResult,
  createReviewCandidateFindingExecutionResult,
  type ReviewCandidateFinding,
  type ReviewCandidateFindingExecutionResult,
} from "../src/review-orchestration/review-candidate-finding.ts";
import {
  createDegradedReviewReducerResult,
  type ProcessedReviewFinding,
  type ReviewReducerResult,
} from "../src/review-orchestration/review-reducer.ts";
import type {
  coordinateReviewCandidateApproval as coordinateReviewCandidateApprovalType,
  toReviewCandidateApprovalDetailsSummary as toReviewCandidateApprovalDetailsSummaryType,
  ReviewCandidateApprovalResult,
} from "../src/review-orchestration/review-candidate-approval.ts";

export const M068_S01_CHECK_IDS = [
  "M068-S01-CANDIDATE-APPROVED",
  "M068-S01-CANDIDATE-SUPPRESSED",
  "M068-S01-CANDIDATE-DEDUPED",
  "M068-S01-CANDIDATE-REWRITTEN",
  "M068-S01-CANDIDATE-REJECTED",
  "M068-S01-FALLBACK-DISALLOWED",
  "M068-S01-DEGRADED-FAIL-OPEN",
  "M068-S01-BOUNDED-EVIDENCE",
] as const;

export type M068S01CheckId = (typeof M068_S01_CHECK_IDS)[number];

export type M068S01StatusCode =
  | "m068_s01_ok"
  | "m068_s01_contract_failed"
  | "m068_s01_invalid_arg"
  | "m068_s01_import_failed";

export type M068S01CheckStatusCode =
  | "candidate_approved"
  | "candidate_approval_failed"
  | "candidate_suppressed"
  | "candidate_suppression_failed"
  | "candidate_deduped"
  | "candidate_dedupe_failed"
  | "candidate_rewritten"
  | "candidate_rewrite_failed"
  | "candidate_rejected"
  | "candidate_rejection_failed"
  | "fallback_disallowed"
  | "fallback_disallowed_failed"
  | "degraded_fail_open"
  | "degraded_fail_open_failed"
  | "bounded_evidence"
  | "bounded_evidence_failed"
  | "coordinator_import_failed";

export type M068S01Check = {
  id: M068S01CheckId;
  passed: boolean;
  status_code: M068S01CheckStatusCode;
  detail: string;
};

export type M068S01Report = {
  command: "verify:m068:s01";
  generated_at: string;
  success: boolean;
  status_code: M068S01StatusCode;
  check_ids: M068S01CheckId[];
  checks: M068S01Check[];
  failing_check_id: M068S01CheckId | null;
  issues: string[];
  contract: {
    lifecycle_counts: Record<string, number>;
    approved_reference_count: number;
    rewritten_reference_count: number;
    summary_text: string;
  };
  redaction: {
    leak_marker_count: number;
    summary_length: number;
  };
};

type VerifyM068S01Args = {
  help: boolean;
  json: boolean;
};

type ApprovalModule = {
  coordinateReviewCandidateApproval: typeof coordinateReviewCandidateApprovalType;
  toReviewCandidateApprovalDetailsSummary: typeof toReviewCandidateApprovalDetailsSummaryType;
};

type EvaluationContext = {
  approved: ReviewCandidateApprovalResult;
  suppressed: ReviewCandidateApprovalResult;
  deduped: ReviewCandidateApprovalResult;
  rewritten: ReviewCandidateApprovalResult;
  rejected: ReviewCandidateApprovalResult;
  fallbackDisallowed: ReviewCandidateApprovalResult;
  degradedFailOpen: ReviewCandidateApprovalResult;
  boundedEvidence: ReviewCandidateApprovalResult;
  boundedSummary: string;
  serializedEvidence: string;
};

const BASE_INPUT = {
  repo: "owner/repo",
  pullNumber: 68,
  reviewOutputKey: "m068-s01-candidate-approval",
  deliveryId: "delivery-m068-s01",
};

const RAW_LEAK_MARKERS = [
  "Unsafe raw approval title",
  "Unsafe raw suppression title",
  "Unsafe raw rewrite title",
  "Unsafe raw rejection title",
  "Body includes hidden prompt",
  "Evidence includes raw workspace",
  "src/approved-unsafe.ts",
  "src/suppressed-unsafe.ts",
  "src/rewrite-unsafe.ts",
  "src/rejected-unsafe.ts",
  "/home/keith/src/kodiai",
  "/tmp/kodiai/workspace",
  "BEGIN PROMPT",
  "PROMPT_SECRET",
  "diff --git",
  "TOKEN=abc123",
  "sk-live-secret-token",
  "rawPrompt",
  "rawDiff",
  "secretToken",
];

export async function loadApprovalModule(): Promise<ApprovalModule> {
  const module = await import("../src/review-orchestration/review-candidate-approval.ts");
  if (typeof module.coordinateReviewCandidateApproval !== "function" || typeof module.toReviewCandidateApprovalDetailsSummary !== "function") {
    throw new Error("approval_coordinator_malformed_export");
  }
  return module;
}

function candidateInput(filePath: string, title: string, overrides: Record<string, unknown> = {}) {
  return {
    filePath,
    startLine: 10,
    endLine: 12,
    severity: "major",
    category: "correctness",
    title,
    body: `${title} body is safe and grounded.`,
    evidence: "bounded evidence fixture",
    ...overrides,
  };
}

function unsafeCandidateInput(filePath: string, title: string, overrides: Record<string, unknown> = {}) {
  return candidateInput(filePath, title, {
    body: `${title}: Body includes hidden prompt BEGIN PROMPT PROMPT_SECRET diff --git TOKEN=abc123 sk-live-secret-token rawPrompt rawDiff secretToken`,
    evidence: `Evidence includes raw workspace /home/keith/src/kodiai and /tmp/kodiai/workspace`,
    ...overrides,
  });
}

function candidateResult(candidates: Parameters<typeof createReviewCandidateFindingExecutionResult>[0]["candidates"]): ReviewCandidateFindingExecutionResult {
  return createReviewCandidateFindingExecutionResult({
    ...BASE_INPUT,
    artifactPresent: true,
    candidates,
    unsafeTextDetector: () => false,
  });
}

function reducerFinding(
  commentId: number,
  candidate: ReviewCandidateFinding,
  overrides: Partial<ProcessedReviewFinding> & { candidateFingerprint?: string } = {},
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

function lifecycleCount(result: ReviewCandidateApprovalResult, lifecycle: string): number {
  return result.outcomes.filter((outcome) => outcome.lifecycle === lifecycle).length;
}

function reasons(result: ReviewCandidateApprovalResult): string[] {
  return result.audit.map((event) => event.reason);
}

function hasRawLeak(value: string): boolean {
  return RAW_LEAK_MARKERS.some((marker) => value.includes(marker));
}

function sanitizeEvidenceText(value: string): string {
  return value
    .replace(/Unsafe raw [a-z ]+ title/gi, "candidate-title-redacted")
    .replace(/Body includes hidden prompt/gi, "candidate-body-redacted")
    .replace(/Evidence includes raw workspace/gi, "candidate-evidence-redacted")
    .replace(/BEGIN\s+PROMPT/gi, "prompt-redacted")
    .replace(/PROMPT[_-]?SECRET/gi, "prompt-redacted")
    .replace(/diff --git/gi, "diff-redacted")
    .replace(/TOKEN\s*=\s*[^\s]+/gi, "token-redacted")
    .replace(/sk-[a-zA-Z0-9_-]+/g, "redacted")
    .replace(/\/home\/keith\/src\/kodiai/g, "workspace-redacted")
    .replace(/\/tmp\/kodiai\/workspace/g, "workspace-redacted")
    .replace(/src\/[a-z0-9._-]+\.ts/gi, "file-redacted")
    .replace(/rawPrompt/gi, "raw-prompt-redacted")
    .replace(/rawDiff/gi, "raw-diff-redacted")
    .replace(/secretToken/gi, "secret-token-redacted")
    .replace(/\s+/g, " ")
    .trim();
}

function boundedDetail(value: string): string {
  return sanitizeEvidenceText(value).slice(0, 180) || "bounded-result";
}

function buildPassedCheck(id: M068S01CheckId, statusCode: M068S01CheckStatusCode, detail: string): M068S01Check {
  return { id, passed: true, status_code: statusCode, detail: boundedDetail(detail) };
}

function buildFailedCheck(id: M068S01CheckId, statusCode: M068S01CheckStatusCode, failures: string[]): M068S01Check {
  return {
    id,
    passed: false,
    status_code: statusCode,
    detail: boundedDetail(failures.join("; ")),
  };
}

function checkApproved(result: ReviewCandidateApprovalResult): M068S01Check {
  const failures = [
    ...(result.counts.approved !== 1 ? [`approved count was ${result.counts.approved}`] : []),
    ...(result.approvedCandidates.length !== 1 ? [`approved reference count was ${result.approvedCandidates.length}`] : []),
    ...(lifecycleCount(result, "approved") !== 1 ? [`approved lifecycle count was ${lifecycleCount(result, "approved")}`] : []),
    ...(!reasons(result).includes("candidate-approved") ? ["candidate-approved reason missing"] : []),
  ];
  return failures.length === 0
    ? buildPassedCheck("M068-S01-CANDIDATE-APPROVED", "candidate_approved", "joined visible reducer finding becomes exactly one approved candidate reference")
    : buildFailedCheck("M068-S01-CANDIDATE-APPROVED", "candidate_approval_failed", failures);
}

function checkSuppressed(result: ReviewCandidateApprovalResult): M068S01Check {
  const failures = [
    ...(result.counts.approved !== 0 ? [`approved count was ${result.counts.approved}`] : []),
    ...(result.counts.suppressed !== 1 ? [`suppressed count was ${result.counts.suppressed}`] : []),
    ...(!reasons(result).includes("reducer-suppressed") ? ["reducer-suppressed reason missing"] : []),
  ];
  return failures.length === 0
    ? buildPassedCheck("M068-S01-CANDIDATE-SUPPRESSED", "candidate_suppressed", "reducer suppression remains a non-approval lifecycle outcome")
    : buildFailedCheck("M068-S01-CANDIDATE-SUPPRESSED", "candidate_suppression_failed", failures);
}

function checkDeduped(result: ReviewCandidateApprovalResult): M068S01Check {
  const failures = [
    ...(result.counts.approved !== 1 ? [`approved count was ${result.counts.approved}`] : []),
    ...(result.counts.deduped !== 1 ? [`deduped count was ${result.counts.deduped}`] : []),
    ...(!reasons(result).includes("duplicate-candidate-fingerprint") ? ["duplicate-candidate-fingerprint reason missing"] : []),
  ];
  return failures.length === 0
    ? buildPassedCheck("M068-S01-CANDIDATE-DEDUPED", "candidate_deduped", "duplicate normalized candidate fingerprints collapse into a bounded deduped outcome")
    : buildFailedCheck("M068-S01-CANDIDATE-DEDUPED", "candidate_dedupe_failed", failures);
}

function checkRewritten(result: ReviewCandidateApprovalResult): M068S01Check {
  const failures = [
    ...(result.counts.approved !== 0 ? [`approved count was ${result.counts.approved}`] : []),
    ...(result.counts.rewritten !== 1 ? [`rewritten count was ${result.counts.rewritten}`] : []),
    ...(result.rewrittenCandidates.length !== 1 ? [`rewritten reference count was ${result.rewrittenCandidates.length}`] : []),
    ...(!reasons(result).includes("reducer-rewritten") ? ["reducer-rewritten reason missing"] : []),
  ];
  return failures.length === 0
    ? buildPassedCheck("M068-S01-CANDIDATE-REWRITTEN", "candidate_rewritten", "reducer rewrite becomes a rewritten candidate reference, not normal approval")
    : buildFailedCheck("M068-S01-CANDIDATE-REWRITTEN", "candidate_rewrite_failed", failures);
}

function checkRejected(result: ReviewCandidateApprovalResult): M068S01Check {
  const failures = [
    ...(result.counts.approved !== 0 ? [`approved count was ${result.counts.approved}`] : []),
    ...(result.counts.rejected !== 1 ? [`rejected count was ${result.counts.rejected}`] : []),
    ...(!reasons(result).includes("candidate-rejected") ? ["candidate-rejected audit reason missing"] : []),
  ];
  return failures.length === 0
    ? buildPassedCheck("M068-S01-CANDIDATE-REJECTED", "candidate_rejected", "malformed candidate fixture is represented as bounded rejection evidence")
    : buildFailedCheck("M068-S01-CANDIDATE-REJECTED", "candidate_rejection_failed", failures);
}

function checkFallbackDisallowed(result: ReviewCandidateApprovalResult): M068S01Check {
  const failures = [
    ...(result.counts.fallbackDisallowed !== 1 ? [`fallback disallowed count was ${result.counts.fallbackDisallowed}`] : []),
    ...(result.counts.approved !== 0 ? [`approved count was ${result.counts.approved}`] : []),
    ...(!reasons(result).includes("direct-fallback-disallowed") ? ["direct-fallback-disallowed reason missing"] : []),
  ];
  return failures.length === 0
    ? buildPassedCheck("M068-S01-FALLBACK-DISALLOWED", "fallback_disallowed", "direct fallback attempts are bounded as fallback-disallowed instead of approval")
    : buildFailedCheck("M068-S01-FALLBACK-DISALLOWED", "fallback_disallowed_failed", failures);
}

function checkDegradedFailOpen(result: ReviewCandidateApprovalResult): M068S01Check {
  const failures = [
    ...(result.counts.approved !== 0 ? [`approved count was ${result.counts.approved}`] : []),
    ...(result.counts.suppressed < 1 ? [`suppressed count was ${result.counts.suppressed}`] : []),
    ...(!reasons(result).includes("reducer-degraded-fail-open") ? ["reducer-degraded-fail-open reason missing"] : []),
  ];
  return failures.length === 0
    ? buildPassedCheck("M068-S01-DEGRADED-FAIL-OPEN", "degraded_fail_open", "degraded reducer output fails open into suppression instead of approval")
    : buildFailedCheck("M068-S01-DEGRADED-FAIL-OPEN", "degraded_fail_open_failed", failures);
}

function checkBoundedEvidence(context: EvaluationContext): M068S01Check {
  const summaryLength = context.boundedSummary.length;
  const failures = [
    ...(summaryLength > 260 ? [`summary length was ${summaryLength}`] : []),
    ...(!context.boundedSummary.includes("Review candidate approval:") ? ["summary prefix missing"] : []),
    ...(hasRawLeak(context.serializedEvidence) ? ["text or JSON evidence leaked raw candidate, evidence, file path, prompt, diff, workspace path, or token markers"] : []),
  ];
  return failures.length === 0
    ? buildPassedCheck("M068-S01-BOUNDED-EVIDENCE", "bounded_evidence", "text and JSON evidence remain bounded to lifecycle counts, reason codes, and safe status metadata")
    : buildFailedCheck("M068-S01-BOUNDED-EVIDENCE", "bounded_evidence_failed", failures);
}

function toBoundedPublicEvidenceProjection(result: ReviewCandidateApprovalResult, summaryText = result.detailsSummary.text) {
  return {
    outcomes: result.outcomes,
    counts: result.counts,
    audit: result.audit,
    detailsSummary: result.detailsSummary,
    bounded_report_fields: {
      lifecycle_counts: result.counts,
      summary_text: summaryText,
    },
  };
}

function buildEvaluationContext(module: ApprovalModule): EvaluationContext {
  const approvedCandidates = candidateResult([
    unsafeCandidateInput("src/approved-unsafe.ts", "Unsafe raw approval title"),
  ]);
  const approvedCandidate = approvedCandidates.findings[0]!;
  const approved = module.coordinateReviewCandidateApproval({
    candidates: approvedCandidates,
    reducer: reducerResult({
      findings: [reducerFinding(1, approvedCandidate, { candidateFingerprint: approvedCandidate.fingerprint })],
      visibleFindings: [reducerFinding(1, approvedCandidate, { candidateFingerprint: approvedCandidate.fingerprint })],
    }),
  });

  const suppressedCandidates = candidateResult([
    unsafeCandidateInput("src/suppressed-unsafe.ts", "Unsafe raw suppression title"),
  ]);
  const suppressedCandidate = suppressedCandidates.findings[0]!;
  const suppressed = module.coordinateReviewCandidateApproval({
    candidates: suppressedCandidates,
    reducer: reducerResult({
      findings: [reducerFinding(2, suppressedCandidate, { candidateFingerprint: suppressedCandidate.fingerprint, suppressed: true })],
      filteredInlineFindings: [reducerFinding(2, suppressedCandidate, { candidateFingerprint: suppressedCandidate.fingerprint, suppressed: true })],
    }),
  });

  const dedupedCandidates = candidateResult([
    unsafeCandidateInput("src/approved-unsafe.ts", "Unsafe raw approval title"),
    unsafeCandidateInput("src/approved-unsafe.ts", "Unsafe raw approval title"),
  ]);
  const firstDeduped = dedupedCandidates.findings[0]!;
  const deduped = module.coordinateReviewCandidateApproval({
    candidates: dedupedCandidates,
    reducer: reducerResult({
      findings: [reducerFinding(3, firstDeduped, { candidateFingerprint: firstDeduped.fingerprint })],
      visibleFindings: [reducerFinding(3, firstDeduped, { candidateFingerprint: firstDeduped.fingerprint })],
    }),
  });

  const rewrittenCandidates = candidateResult([
    unsafeCandidateInput("src/rewrite-unsafe.ts", "Unsafe raw rewrite title"),
  ]);
  const rewrittenCandidate = rewrittenCandidates.findings[0]!;
  const rewritten = module.coordinateReviewCandidateApproval({
    candidates: rewrittenCandidates,
    reducer: reducerResult({
      findings: [reducerFinding(4, rewrittenCandidate, {
        candidateFingerprint: rewrittenCandidate.fingerprint,
        title: "Bounded rewritten title",
        originalTitle: rewrittenCandidate.title,
        filterAction: "rewritten",
      })],
      visibleFindings: [reducerFinding(4, rewrittenCandidate, {
        candidateFingerprint: rewrittenCandidate.fingerprint,
        title: "Bounded rewritten title",
        originalTitle: rewrittenCandidate.title,
        filterAction: "rewritten",
      })],
    }),
  });

  const rejectedCandidates = candidateResult([
    unsafeCandidateInput("src/rejected-unsafe.ts", "Unsafe raw rejection title", { filePath: "" }),
  ]);
  const rejected = module.coordinateReviewCandidateApproval({
    candidates: rejectedCandidates,
    reducer: reducerResult(),
  });

  const fallbackDisallowed = module.coordinateReviewCandidateApproval({
    candidates: candidateResult([]),
    reducer: reducerResult(),
    fallbackPolicy: { allowDirectFallback: false, attemptedDirectFallback: true },
  });

  const degradedCandidates = createDegradedReviewCandidateFindingResult({
    ...BASE_INPUT,
    artifactPresent: false,
    reason: "normalization-error",
    inputCount: 1,
  });
  const degradedFailOpen = module.coordinateReviewCandidateApproval({
    candidates: degradedCandidates,
    reducer: createDegradedReviewReducerResult({
      findings: [],
      reason: "reducer degraded with diff --git and sk-live-secret-token",
    }),
  });

  const boundedEvidence = module.coordinateReviewCandidateApproval({
    candidates: candidateResult([
      unsafeCandidateInput("src/approved-unsafe.ts", "Unsafe raw approval title"),
      unsafeCandidateInput("src/suppressed-unsafe.ts", "Unsafe raw suppression title", { filePath: "" }),
    ]),
    reducer: reducerResult(),
    fallbackPolicy: { allowDirectFallback: false, attemptedDirectFallback: true },
  });
  const boundedSummary = module.toReviewCandidateApprovalDetailsSummary(boundedEvidence).text;

  return {
    approved,
    suppressed,
    deduped,
    rewritten,
    rejected,
    fallbackDisallowed,
    degradedFailOpen,
    boundedEvidence,
    boundedSummary,
    serializedEvidence: JSON.stringify(toBoundedPublicEvidenceProjection(boundedEvidence, boundedSummary)),
  };
}

function deriveOutcome(checks: M068S01Check[]): Pick<M068S01Report, "success" | "status_code" | "failing_check_id" | "issues"> {
  const failingCheck = checks.find((check) => !check.passed);
  if (!failingCheck) {
    return {
      success: true,
      status_code: "m068_s01_ok",
      failing_check_id: null,
      issues: [],
    };
  }

  return {
    success: false,
    status_code: "m068_s01_contract_failed",
    failing_check_id: failingCheck.id,
    issues: [`${failingCheck.id}: ${boundedDetail(failingCheck.detail)}`],
  };
}

function failedImportReport(params: { generatedAt: string; issue: string }): M068S01Report {
  const checks = M068_S01_CHECK_IDS.map((id) => ({
    id,
    passed: false,
    status_code: "coordinator_import_failed" as const,
    detail: boundedDetail(`approval coordinator import failed: ${params.issue}`),
  }));
  return {
    command: "verify:m068:s01",
    generated_at: params.generatedAt,
    success: false,
    status_code: "m068_s01_import_failed",
    check_ids: [...M068_S01_CHECK_IDS],
    checks,
    failing_check_id: M068_S01_CHECK_IDS[0],
    issues: [`approval coordinator import failed: ${boundedDetail(params.issue)}`],
    contract: {
      lifecycle_counts: {},
      approved_reference_count: 0,
      rewritten_reference_count: 0,
      summary_text: "",
    },
    redaction: {
      leak_marker_count: 0,
      summary_length: 0,
    },
  };
}

function emptyReport(params: { generatedAt?: string; issue: string }): M068S01Report {
  return {
    command: "verify:m068:s01",
    generated_at: params.generatedAt ?? new Date().toISOString(),
    success: false,
    status_code: "m068_s01_invalid_arg",
    check_ids: [...M068_S01_CHECK_IDS],
    checks: [],
    failing_check_id: null,
    issues: [boundedDetail(params.issue)],
    contract: {
      lifecycle_counts: {},
      approved_reference_count: 0,
      rewritten_reference_count: 0,
      summary_text: "",
    },
    redaction: {
      leak_marker_count: 0,
      summary_length: 0,
    },
  };
}

export async function evaluateM068S01CandidateApprovalContract(params?: { generatedAt?: string }): Promise<M068S01Report> {
  const generatedAt = params?.generatedAt ?? new Date().toISOString();
  let module: ApprovalModule;
  try {
    module = await loadApprovalModule();
  } catch (error) {
    return failedImportReport({ generatedAt, issue: error instanceof Error ? error.message : String(error) });
  }

  const context = buildEvaluationContext(module);
  const checks = [
    checkApproved(context.approved),
    checkSuppressed(context.suppressed),
    checkDeduped(context.deduped),
    checkRewritten(context.rewritten),
    checkRejected(context.rejected),
    checkFallbackDisallowed(context.fallbackDisallowed),
    checkDegradedFailOpen(context.degradedFailOpen),
    checkBoundedEvidence(context),
  ];
  const outcome = deriveOutcome(checks);
  const lifecycleCounts = {
    approved: context.approved.counts.approved,
    suppressed: context.suppressed.counts.suppressed,
    deduped: context.deduped.counts.deduped,
    rewritten: context.rewritten.counts.rewritten,
    rejected: context.rejected.counts.rejected,
    fallbackDisallowed: context.fallbackDisallowed.counts.fallbackDisallowed,
    degradedSuppressed: context.degradedFailOpen.counts.suppressed,
  };

  const safeReportProjection = JSON.stringify({
    public_evidence: context.serializedEvidence,
    checks,
    contract: {
      lifecycle_counts: lifecycleCounts,
      approved_reference_count: context.approved.approvedCandidates.length,
      rewritten_reference_count: context.rewritten.rewrittenCandidates.length,
      summary_text: context.boundedSummary,
    },
    redaction: {
      summary_length: context.boundedSummary.length,
    },
  });

  return {
    command: "verify:m068:s01",
    generated_at: generatedAt,
    success: outcome.success,
    status_code: outcome.status_code,
    check_ids: [...M068_S01_CHECK_IDS],
    checks,
    failing_check_id: outcome.failing_check_id,
    issues: outcome.issues,
    contract: {
      lifecycle_counts: lifecycleCounts,
      approved_reference_count: context.approved.approvedCandidates.length,
      rewritten_reference_count: context.rewritten.rewrittenCandidates.length,
      summary_text: context.boundedSummary,
    },
    redaction: {
      leak_marker_count: RAW_LEAK_MARKERS.filter((marker) => safeReportProjection.includes(marker)).length,
      summary_length: context.boundedSummary.length,
    },
  };
}

export function parseVerifyM068S01Args(args: string[]): VerifyM068S01Args {
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
    "Usage: bun run verify:m068:s01 -- [--json]",
    "",
    "Verifies the M068 S01 review candidate approval coordinator contract using local inline fixtures only.",
    "",
    "Options:",
    "  --json       Print machine-readable JSON output",
    "  --help       Show this help",
  ].join("\n");
}

export function renderM068S01Report(report: M068S01Report): string {
  const lines = [
    "# M068 S01 — Review Candidate Approval Contract Verifier",
    "",
    `Status: ${report.status_code}`,
    `Overall success: ${String(report.success)}`,
    `Failing check: ${report.failing_check_id ?? "none"}`,
    `Lifecycle counts: approved=${report.contract.lifecycle_counts.approved ?? 0} suppressed=${report.contract.lifecycle_counts.suppressed ?? 0} deduped=${report.contract.lifecycle_counts.deduped ?? 0} rewritten=${report.contract.lifecycle_counts.rewritten ?? 0} rejected=${report.contract.lifecycle_counts.rejected ?? 0} fallbackDisallowed=${report.contract.lifecycle_counts.fallbackDisallowed ?? 0} degradedSuppressed=${report.contract.lifecycle_counts.degradedSuppressed ?? 0}`,
    `Candidate references: approved=${report.contract.approved_reference_count} rewritten=${report.contract.rewritten_reference_count}`,
    `Bounded summary: ${sanitizeEvidenceText(report.contract.summary_text) || "missing"}`,
    `Redaction: leakMarkers=${report.redaction.leak_marker_count} summaryLength=${report.redaction.summary_length}`,
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

export async function main(
  args: string[] = process.argv.slice(2),
  deps?: {
    stdout?: { write: (chunk: string) => void };
    stderr?: { write: (chunk: string) => void };
    evaluateFn?: typeof evaluateM068S01CandidateApprovalContract;
  },
): Promise<number> {
  const stdout = deps?.stdout ?? process.stdout;
  const stderr = deps?.stderr ?? process.stderr;
  const evaluateFn = deps?.evaluateFn ?? evaluateM068S01CandidateApprovalContract;

  try {
    const options = parseVerifyM068S01Args(args);

    if (options.help) {
      stdout.write(`${usage()}\n`);
      return 0;
    }

    const report = await evaluateFn();
    stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderM068S01Report(report));

    if (!report.success) {
      stderr.write(`verify:m068:s01 failed: ${report.failing_check_id ?? report.status_code}\n`);
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
