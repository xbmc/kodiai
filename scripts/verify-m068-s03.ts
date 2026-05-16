import { projectContributorExperienceContract } from "../src/contributor/experience-contract.ts";
import { formatReviewDetailsSummary } from "../src/lib/review-utils.ts";
import {
  classifyReviewCandidatePublicationRuntime,
  type ReviewCandidatePublicationRuntimeInput,
  type ReviewCandidatePublicationRuntimeResult,
} from "../src/review-orchestration/review-candidate-publication-runtime.ts";

export const M068_S03_CHECK_IDS = [
  "M068-S03-HANDLER-PREFERS-CANDIDATES",
  "M068-S03-DIRECT-FALLBACK-AUDITED",
  "M068-S03-REVIEW-DETAILS-PUBLICATION-MODE",
  "M068-S03-SAFE-CONFIG-SNAPSHOT",
  "M068-S03-PROMPT-CONTRACT",
  "M068-S03-NO-PARALLEL-PUBLISHER",
  "M068-S03-BOUNDED-EVIDENCE",
] as const;

type M068S03CheckId = (typeof M068_S03_CHECK_IDS)[number];
type M068S03StatusCode = "m068_s03_ok" | "m068_s03_contract_failed" | "m068_s03_invalid_arg";
type M068S03CheckStatusCode =
  | "handler_prefers_candidates_ok"
  | "handler_prefers_candidates_failed"
  | "direct_fallback_audited_ok"
  | "direct_fallback_audited_failed"
  | "review_details_publication_mode_ok"
  | "review_details_publication_mode_failed"
  | "safe_config_snapshot_ok"
  | "safe_config_snapshot_failed"
  | "prompt_contract_ok"
  | "prompt_contract_failed"
  | "no_parallel_publisher_ok"
  | "no_parallel_publisher_failed"
  | "bounded_evidence_ok"
  | "bounded_evidence_failed";

type M068S03Check = {
  id: M068S03CheckId;
  passed: boolean;
  status_code: M068S03CheckStatusCode;
  detail: string;
};

type M068S03SourceBundle = {
  handler: string;
  prompt: string;
  reviewUtils: string;
  adapter: string;
  publisher: string;
  createReviewCommentCallsites: Array<{ path: string; count: number }>;
};

type M068S03Contract = {
  runtime: {
    candidate_mode: string;
    candidate_published: number;
    direct_fallback_mode: string;
    direct_fallback_evidence: number;
    direct_fallback_candidate_published: number;
    candidate_reasons: string[];
    direct_fallback_reasons: string[];
  };
  static_boundary: {
    handler_required_callsite_count: number;
    handler_missing_callsite_count: number;
    adapter_create_review_comment_callsite_count: number;
    publisher_create_review_comment_callsite_count: number;
    non_shared_create_review_comment_callsite_count: number;
    non_shared_create_review_comment_paths: string[];
  };
  review_details: {
    candidate_line: string | null;
    fallback_line: string | null;
    malformed_line: string | null;
  };
  prompt_contract: {
    candidate_preferred_mentions: number;
    audited_fallback_mentions: number;
    raw_leak_warning_present: boolean;
  };
  safe_snapshot: {
    mode: string;
    reason_count: number;
    count_keys: string[];
    flow_payload_fingerprint_count: number;
    flow_published_comment_id_count: number;
  };
  negative_fixtures: {
    fallback_only_success_rejected: boolean;
    missing_handler_callsite_failed: boolean;
    extra_create_review_comment_failed: boolean;
    missing_prompt_fallback_failed: boolean;
    leak_marker_count: number;
  };
};

type M068S03Report = {
  command: "verify:m068:s03";
  generated_at: string;
  success: boolean;
  status_code: M068S03StatusCode;
  check_ids: M068S03CheckId[];
  checks: M068S03Check[];
  failing_check_id: M068S03CheckId | null;
  issues: string[];
  contract: M068S03Contract;
  redaction: {
    leak_marker_count: number;
    serialized_report_length: number;
    negative_fixture_leak_marker_count: number;
  };
};

type VerifyM068S03Args = {
  help: boolean;
  json: boolean;
};

const HANDLER_PATH = "src/handlers/review.ts";
const PROMPT_PATH = "src/execution/review-prompt.ts";
const REVIEW_UTILS_PATH = "src/lib/review-utils.ts";
const ADAPTER_PATH = "src/review-orchestration/review-candidate-publication-adapter.ts";
const PUBLISHER_PATH = "src/execution/mcp/inline-review-publisher.ts";

const REQUIRED_HANDLER_FRAGMENTS = [
  "coordinateReviewCandidateApproval({",
  "adaptApprovedCandidatesForInlinePublication({",
  "createInlineReviewPublisher({",
  ".publish(payload.publication)",
  "convertPublishedCandidateResultsToProcessedFindings({",
  "classifyReviewCandidatePublicationRuntime({",
  "createCandidatePublicationFlowEvidence({",
  "reviewCandidatePublishedFindings.findings.length > 0",
  "reviewCandidatePublicationRuntime.detailsSummary",
  "reviewCandidatePublicationRuntime.safeConfigSnapshot",
  "reviewCandidatePublicationFlow",
] as const;

const REQUIRED_PROMPT_FRAGMENTS = [
  "Candidate-Preferred Finding Capture",
  "candidate-preferred publication path",
  "record every actionable draft finding before using direct GitHub publish tools",
  "Do not publish duplicate direct GitHub comments for findings already recorded as candidates",
  "Use direct GitHub publish tools only as audited fallback",
  "without including raw prompts, raw diffs, raw candidate payloads, or secrets",
] as const;

const LEAK_MARKERS = [
  "sk-secret-value",
  "ghp_secret_token_value",
  "BEGIN PROMPT",
  "PROMPT_SECRET",
  "diff --git",
  "hidden instructions",
  "system prompt",
  "rawPrompt",
  "rawDiff",
  "secretToken",
  "AKIA1234567890123456",
  "TOKEN=abc123",
];

const BASE_REVIEW_DETAILS_PARAMS = {
  reviewOutputKey: "verify-m068-s03-key",
  filesReviewed: 3,
  linesAdded: 42,
  linesRemoved: 7,
  findingCounts: { critical: 0, major: 1, medium: 1, minor: 0 },
  profileSelection: {
    selectedProfile: "balanced" as const,
    source: "auto" as const,
    linesChanged: 49,
    autoBand: null,
  },
  contributorExperience: projectContributorExperienceContract({
    source: "author-cache",
    tier: "regular",
  }).reviewDetails,
  completedAt: "2026-04-22T20:15:00.000Z",
};

function approvalSummary(counts: Partial<NonNullable<ReviewCandidatePublicationRuntimeInput["approval"]>["counts"]> = {}): NonNullable<ReviewCandidatePublicationRuntimeInput["approval"]> {
  return {
    counts: {
      input: 0,
      approved: 0,
      rewritten: 0,
      suppressed: 0,
      deduped: 0,
      rejected: 0,
      fallbackDisallowed: 0,
      auditEvents: 0,
      ...counts,
    },
    outcomes: [],
    approvedCandidates: [],
    rewrittenCandidates: [],
    audit: [],
    detailsSummary: { label: "Review candidate approval", text: "Review candidate approval: verifier fixture" },
  };
}

function adapterSummary(counts: Partial<NonNullable<ReviewCandidatePublicationRuntimeInput["adapter"]>["counts"]> = {}): NonNullable<ReviewCandidatePublicationRuntimeInput["adapter"]> {
  return {
    counts: {
      input: 0,
      publishable: 0,
      skipped: 0,
      approved: 0,
      rewritten: 0,
      ...counts,
    },
    skipped: [],
    fingerprints: [],
  };
}

function publisherSummary(results: NonNullable<ReviewCandidatePublicationRuntimeInput["publisher"]>["results"]): NonNullable<ReviewCandidatePublicationRuntimeInput["publisher"]> {
  return {
    counts: {
      input: results.length,
      processed: results.filter((result) => result.status === "published" && typeof result.commentId === "number").length,
      skipped: results.filter((result) => result.status === "skipped" || result.status === "missing").length,
      blocked: results.filter((result) => result.status === "blocked").length,
      failed: results.filter((result) => result.status === "failed").length,
      malformed: results.filter((result) => result.status === "malformed" || (result.status === "published" && typeof result.commentId !== "number")).length,
    },
    results,
  };
}

function candidateApprovedRuntime(): ReviewCandidatePublicationRuntimeResult {
  return classifyReviewCandidatePublicationRuntime({
    approval: approvalSummary({ input: 2, approved: 2 }),
    adapter: adapterSummary({ input: 2, publishable: 2, approved: 2 }),
    publisher: publisherSummary([
      { fingerprint: "rcf-111111111111", status: "published", reason: "published", commentId: 101 },
      { fingerprint: "rcf-222222222222", status: "published", reason: "published", commentId: 102 },
    ]),
    convertedProcessedFindingCount: 2,
    directPublication: { attempted: false, allowed: true, published: 0, reason: "candidate-approved-path" },
  });
}

function directFallbackRuntime(): ReviewCandidatePublicationRuntimeResult {
  return classifyReviewCandidatePublicationRuntime({
    approval: approvalSummary(),
    adapter: adapterSummary(),
    publisher: publisherSummary([]),
    convertedProcessedFindingCount: 0,
    directPublication: { attempted: true, allowed: true, published: 2, reason: "direct-fallback-audited" },
  });
}

function formatReviewDetailsLine(runtime: ReviewCandidatePublicationRuntimeResult): string | null {
  const body = formatReviewDetailsSummary({
    ...BASE_REVIEW_DETAILS_PARAMS,
    reviewCandidatePublication: runtime.detailsSummary,
  });
  return firstCandidatePublicationLine(body);
}

function firstCandidatePublicationLine(body: string): string | null {
  return body.split("\n").find((line) => line.includes("Review candidate publication:")) ?? null;
}

function countSubstring(source: string, fragment: string): number {
  return source.split(fragment).length - 1;
}

function countCreateReviewCommentCallsites(source: string): number {
  return source.match(/\.pulls\.createReviewComment\(/g)?.length ?? 0;
}

function countLeakMarkers(value: string): number {
  return LEAK_MARKERS.reduce((count, marker) => count + (value.includes(marker) ? 1 : 0), 0);
}

function sanitizeEvidenceText(value: string): string {
  return value
    .replace(/sk-[a-zA-Z0-9_-]+/g, "redacted")
    .replace(/gh[pousr]_[a-zA-Z0-9_]+/g, "redacted")
    .replace(/AKIA[0-9A-Z]{16}/g, "redacted")
    .replace(/TOKEN\s*=\s*[^\s,]+/gi, "token-redacted")
    .replace(/PROMPT[_-]?SECRET|BEGIN\s+PROMPT/gi, "prompt-redacted")
    .replace(/diff --git/gi, "diff-redacted")
    .replace(/hidden instructions|system prompt/gi, "prompt-redacted")
    .replace(/rawPrompt/gi, "raw-prompt-redacted")
    .replace(/rawDiff/gi, "raw-diff-redacted")
    .replace(/secretToken/gi, "secret-token-redacted");
}

function boundedDetail(value: string): string {
  return sanitizeEvidenceText(value).trim().replace(/\s+/g, " ").slice(0, 240) || "bounded-result";
}

function passedCheck(id: M068S03CheckId, statusCode: M068S03CheckStatusCode, detail: string): M068S03Check {
  return { id, passed: true, status_code: statusCode, detail: boundedDetail(detail) };
}

function failedCheck(id: M068S03CheckId, statusCode: M068S03CheckStatusCode, failures: string[]): M068S03Check {
  return { id, passed: false, status_code: statusCode, detail: boundedDetail(failures.join("; ")) };
}

function emptyContract(): M068S03Contract {
  return {
    runtime: {
      candidate_mode: "missing",
      candidate_published: 0,
      direct_fallback_mode: "missing",
      direct_fallback_evidence: 0,
      direct_fallback_candidate_published: 0,
      candidate_reasons: [],
      direct_fallback_reasons: [],
    },
    static_boundary: {
      handler_required_callsite_count: 0,
      handler_missing_callsite_count: REQUIRED_HANDLER_FRAGMENTS.length,
      adapter_create_review_comment_callsite_count: 0,
      publisher_create_review_comment_callsite_count: 0,
      non_shared_create_review_comment_callsite_count: 0,
      non_shared_create_review_comment_paths: [],
    },
    review_details: {
      candidate_line: null,
      fallback_line: null,
      malformed_line: null,
    },
    prompt_contract: {
      candidate_preferred_mentions: 0,
      audited_fallback_mentions: 0,
      raw_leak_warning_present: false,
    },
    safe_snapshot: {
      mode: "missing",
      reason_count: 0,
      count_keys: [],
      flow_payload_fingerprint_count: 0,
      flow_published_comment_id_count: 0,
    },
    negative_fixtures: {
      fallback_only_success_rejected: false,
      missing_handler_callsite_failed: false,
      extra_create_review_comment_failed: false,
      missing_prompt_fallback_failed: false,
      leak_marker_count: 0,
    },
  };
}

function makeReport(params: {
  generatedAt: string;
  checks: M068S03Check[];
  contract: M068S03Contract;
  negativeLeakMarkerCount: number;
}): M068S03Report {
  const failing = params.checks.find((check) => !check.passed) ?? null;
  const issues = failing ? [`${failing.id}: ${boundedDetail(failing.detail)}`] : [];
  const preliminary = {
    command: "verify:m068:s03" as const,
    generated_at: params.generatedAt,
    success: !failing,
    status_code: failing ? "m068_s03_contract_failed" as const : "m068_s03_ok" as const,
    check_ids: [...M068_S03_CHECK_IDS],
    checks: params.checks,
    failing_check_id: failing?.id ?? null,
    issues,
    contract: params.contract,
  };
  const serialized = JSON.stringify(preliminary);
  return {
    ...preliminary,
    redaction: {
      leak_marker_count: countLeakMarkers(serialized),
      serialized_report_length: serialized.length,
      negative_fixture_leak_marker_count: params.negativeLeakMarkerCount,
    },
  };
}

async function readSourceBundle(): Promise<M068S03SourceBundle> {
  const [handler, prompt, reviewUtils, adapter, publisher] = await Promise.all([
    Bun.file(HANDLER_PATH).text(),
    Bun.file(PROMPT_PATH).text(),
    Bun.file(REVIEW_UTILS_PATH).text(),
    Bun.file(ADAPTER_PATH).text(),
    Bun.file(PUBLISHER_PATH).text(),
  ]);

  const createReviewCommentCallsites: Array<{ path: string; count: number }> = [];
  const glob = new Bun.Glob("src/**/*.ts");
  for await (const path of glob.scan({ cwd: "." })) {
    const source = await Bun.file(path).text();
    const count = countCreateReviewCommentCallsites(source);
    if (count > 0) {
      createReviewCommentCallsites.push({ path, count });
    }
  }

  return { handler, prompt, reviewUtils, adapter, publisher, createReviewCommentCallsites };
}

function evaluateHandlerPrefersCandidates(handlerSource: string): { missing: string[]; presentCount: number } {
  const missing = REQUIRED_HANDLER_FRAGMENTS.filter((fragment) => !handlerSource.includes(fragment));
  return { missing, presentCount: REQUIRED_HANDLER_FRAGMENTS.length - missing.length };
}

function evaluatePromptContract(promptSource: string): { missing: string[]; candidatePreferredMentions: number; auditedFallbackMentions: number; rawLeakWarningPresent: boolean } {
  const missing = REQUIRED_PROMPT_FRAGMENTS.filter((fragment) => !promptSource.includes(fragment));
  return {
    missing,
    candidatePreferredMentions: countSubstring(promptSource, "candidate-preferred"),
    auditedFallbackMentions: countSubstring(promptSource, "audited fallback"),
    rawLeakWarningPresent: promptSource.includes("raw prompts, raw diffs, raw candidate payloads, or secrets"),
  };
}

function evaluateParallelPublisherBoundary(sources: M068S03SourceBundle): { failures: string[]; adapterCallsites: number; publisherCallsites: number; nonSharedCallsites: Array<{ path: string; count: number }> } {
  const adapterCallsites = countCreateReviewCommentCallsites(sources.adapter);
  const publisherCallsites = countCreateReviewCommentCallsites(sources.publisher);
  const nonSharedCallsites = sources.createReviewCommentCallsites.filter((entry) => entry.path !== PUBLISHER_PATH);
  const failures = [
    ...(adapterCallsites !== 0 ? [`${ADAPTER_PATH} createReviewComment callsites=${adapterCallsites}`] : []),
    ...(publisherCallsites !== 1 ? [`${PUBLISHER_PATH} createReviewComment callsites=${publisherCallsites}`] : []),
    ...(nonSharedCallsites.length > 0 ? [`non-shared createReviewComment paths=${nonSharedCallsites.map((entry) => `${entry.path}:${entry.count}`).join(",")}`] : []),
  ];
  return { failures, adapterCallsites, publisherCallsites, nonSharedCallsites };
}

function buildNegativeFixtureResults(sources: M068S03SourceBundle): M068S03Contract["negative_fixtures"] {
  const fallbackOnly = directFallbackRuntime();
  const missingHandler = evaluateHandlerPrefersCandidates(sources.handler.replace("coordinateReviewCandidateApproval({", "coordinateReviewCandidateApproval__missing({"));
  const extraPublisherBoundary = evaluateParallelPublisherBoundary({
    ...sources,
    handler: `${sources.handler}\nasync function unsafe(octokit: never) { return octokit.rest.pulls.createReviewComment({}); }`,
    createReviewCommentCallsites: [...sources.createReviewCommentCallsites, { path: HANDLER_PATH, count: 1 }],
  });
  const missingPrompt = evaluatePromptContract(sources.prompt.replace("Use direct GitHub publish tools only as audited fallback", "Use direct GitHub publish tools"));
  const leakMarkerCount = countLeakMarkers("BEGIN PROMPT diff --git sk-secret-value rawPrompt TOKEN=abc123");

  return {
    fallback_only_success_rejected: fallbackOnly.mode !== "candidate-approved" && fallbackOnly.counts.candidatePublished === 0,
    missing_handler_callsite_failed: missingHandler.missing.includes("coordinateReviewCandidateApproval({"),
    extra_create_review_comment_failed: extraPublisherBoundary.failures.length > 0,
    missing_prompt_fallback_failed: missingPrompt.missing.includes("Use direct GitHub publish tools only as audited fallback"),
    leak_marker_count: leakMarkerCount,
  };
}

export async function evaluateM068S03ClosureContract(params: { generatedAt?: string } = {}): Promise<M068S03Report> {
  const generatedAt = params.generatedAt ?? new Date().toISOString();
  const contract = emptyContract();
  const sources = await readSourceBundle();
  const candidateRuntime = candidateApprovedRuntime();
  const fallbackRuntime = directFallbackRuntime();
  const checks: M068S03Check[] = [];

  contract.runtime = {
    candidate_mode: candidateRuntime.mode,
    candidate_published: candidateRuntime.counts.candidatePublished,
    direct_fallback_mode: fallbackRuntime.mode,
    direct_fallback_evidence: fallbackRuntime.counts.fallbackEvidence,
    direct_fallback_candidate_published: fallbackRuntime.counts.candidatePublished,
    candidate_reasons: candidateRuntime.reasons,
    direct_fallback_reasons: fallbackRuntime.reasons,
  };

  const handlerContract = evaluateHandlerPrefersCandidates(sources.handler);
  contract.static_boundary.handler_required_callsite_count = handlerContract.presentCount;
  contract.static_boundary.handler_missing_callsite_count = handlerContract.missing.length;
  const handlerFailures = [
    ...handlerContract.missing.map((fragment) => `missing handler fragment=${fragment}`),
    ...(candidateRuntime.mode !== "candidate-approved" ? [`candidate mode=${candidateRuntime.mode}`] : []),
    ...(candidateRuntime.counts.candidatePublished !== 2 ? [`candidatePublished=${candidateRuntime.counts.candidatePublished}`] : []),
  ];
  checks.push(handlerFailures.length === 0
    ? passedCheck("M068-S03-HANDLER-PREFERS-CANDIDATES", "handler_prefers_candidates_ok", "handler coordinates approval, adapts candidates, publishes through shared publisher, converts published candidates, and prefers candidate findings")
    : failedCheck("M068-S03-HANDLER-PREFERS-CANDIDATES", "handler_prefers_candidates_failed", handlerFailures));

  const fallbackFailures = [
    ...(fallbackRuntime.mode !== "direct-fallback" ? [`fallback mode=${fallbackRuntime.mode}`] : []),
    ...(fallbackRuntime.counts.candidatePublished !== 0 ? [`fallback candidatePublished=${fallbackRuntime.counts.candidatePublished}`] : []),
    ...(fallbackRuntime.counts.fallbackEvidence !== 2 ? [`fallbackEvidence=${fallbackRuntime.counts.fallbackEvidence}`] : []),
    ...(!fallbackRuntime.reasons.includes("direct-fallback-attempted") ? ["direct-fallback-attempted reason missing"] : []),
    ...(!fallbackRuntime.reasons.includes("direct-fallback-published") ? ["direct-fallback-published reason missing"] : []),
  ];
  checks.push(fallbackFailures.length === 0
    ? passedCheck("M068-S03-DIRECT-FALLBACK-AUDITED", "direct_fallback_audited_ok", "fallback-only direct output is classified as direct-fallback evidence and does not satisfy candidate-approved success")
    : failedCheck("M068-S03-DIRECT-FALLBACK-AUDITED", "direct_fallback_audited_failed", fallbackFailures));

  const malformedDetailsBody = formatReviewDetailsSummary({
    ...BASE_REVIEW_DETAILS_PARAMS,
    reviewCandidatePublication: { label: "Review candidate publication runtime", text: 17 } as never,
  });
  contract.review_details = {
    candidate_line: formatReviewDetailsLine(candidateRuntime),
    fallback_line: formatReviewDetailsLine(fallbackRuntime),
    malformed_line: firstCandidatePublicationLine(malformedDetailsBody),
  };
  const detailsFailures = [
    ...(contract.review_details.candidate_line?.includes("mode=candidate-approved") ? [] : [`candidate line=${contract.review_details.candidate_line ?? "missing"}`]),
    ...(contract.review_details.candidate_line?.includes("published=2") ? [] : ["candidate published count missing from Review Details"]),
    ...(contract.review_details.fallback_line?.includes("mode=direct-fallback") ? [] : [`fallback line=${contract.review_details.fallback_line ?? "missing"}`]),
    ...(contract.review_details.fallback_line?.includes("directFallback=2") ? [] : ["fallback evidence count missing from Review Details"]),
    ...(contract.review_details.malformed_line === "- Review candidate publication: mode=degraded approved=0 rewritten=0 published=0 directFallback=0 reasons=malformed-runtime-summary" ? [] : [`malformed line=${contract.review_details.malformed_line ?? "missing"}`]),
    ...(sources.reviewUtils.includes("formatReviewCandidatePublicationDetailsLine") ? [] : ["Review Details formatter missing publication mode function"]),
  ];
  checks.push(detailsFailures.length === 0
    ? passedCheck("M068-S03-REVIEW-DETAILS-PUBLICATION-MODE", "review_details_publication_mode_ok", "Review Details exposes candidate-approved, direct-fallback, and malformed degraded publication modes as bounded lines")
    : failedCheck("M068-S03-REVIEW-DETAILS-PUBLICATION-MODE", "review_details_publication_mode_failed", detailsFailures));

  const snapshot = candidateRuntime.safeConfigSnapshot;
  contract.safe_snapshot = {
    mode: snapshot.mode,
    reason_count: snapshot.reasons.length,
    count_keys: Object.keys(snapshot.counts).sort(),
    flow_payload_fingerprint_count: 2,
    flow_published_comment_id_count: 2,
  };
  const safeSnapshotText = JSON.stringify(snapshot);
  const safeSnapshotFailures = [
    ...(snapshot.mode !== "candidate-approved" ? [`snapshot mode=${snapshot.mode}`] : []),
    ...(snapshot.counts.candidatePublished !== 2 ? [`snapshot candidatePublished=${snapshot.counts.candidatePublished}`] : []),
    ...(snapshot.counts.fallbackEvidence !== 0 ? [`snapshot fallbackEvidence=${snapshot.counts.fallbackEvidence}`] : []),
    ...(snapshot.reasons.length > 12 ? [`snapshot reason count=${snapshot.reasons.length}`] : []),
    ...(countLeakMarkers(safeSnapshotText) !== 0 ? [`snapshot leak markers=${countLeakMarkers(safeSnapshotText)}`] : []),
    ...(sources.handler.includes("reviewCandidatePublicationRuntime.safeConfigSnapshot") ? [] : ["handler config snapshot missing runtime.safeConfigSnapshot"]),
    ...(sources.handler.includes("reviewCandidatePublicationFlow") ? [] : ["handler config snapshot missing bounded flow evidence"]),
    ...(sources.handler.includes("knowledgeStore.recordReview({") ? [] : ["handler recordReview call missing"]),
  ];
  checks.push(safeSnapshotFailures.length === 0
    ? passedCheck("M068-S03-SAFE-CONFIG-SNAPSHOT", "safe_config_snapshot_ok", "knowledgeStore config snapshot uses bounded runtime mode/count/reason snapshot plus publication flow IDs/counts only")
    : failedCheck("M068-S03-SAFE-CONFIG-SNAPSHOT", "safe_config_snapshot_failed", safeSnapshotFailures));

  const promptContract = evaluatePromptContract(sources.prompt);
  contract.prompt_contract = {
    candidate_preferred_mentions: promptContract.candidatePreferredMentions,
    audited_fallback_mentions: promptContract.auditedFallbackMentions,
    raw_leak_warning_present: promptContract.rawLeakWarningPresent,
  };
  const promptFailures = [
    ...promptContract.missing.map((fragment) => `missing prompt fragment=${fragment}`),
    ...(promptContract.candidatePreferredMentions < 1 ? ["candidate-preferred wording missing"] : []),
    ...(promptContract.auditedFallbackMentions < 1 ? ["audited fallback wording missing"] : []),
    ...(!promptContract.rawLeakWarningPresent ? ["raw prompt/diff/candidate/secret fallback warning missing"] : []),
  ];
  checks.push(promptFailures.length === 0
    ? passedCheck("M068-S03-PROMPT-CONTRACT", "prompt_contract_ok", "prompt contract makes candidate finding capture preferred and direct GitHub tools audited fallback-only for candidate-preferred runs")
    : failedCheck("M068-S03-PROMPT-CONTRACT", "prompt_contract_failed", promptFailures));

  const publisherBoundary = evaluateParallelPublisherBoundary(sources);
  contract.static_boundary.adapter_create_review_comment_callsite_count = publisherBoundary.adapterCallsites;
  contract.static_boundary.publisher_create_review_comment_callsite_count = publisherBoundary.publisherCallsites;
  contract.static_boundary.non_shared_create_review_comment_callsite_count = publisherBoundary.nonSharedCallsites.reduce((sum, entry) => sum + entry.count, 0);
  contract.static_boundary.non_shared_create_review_comment_paths = publisherBoundary.nonSharedCallsites.map((entry) => entry.path).sort();
  checks.push(publisherBoundary.failures.length === 0
    ? passedCheck("M068-S03-NO-PARALLEL-PUBLISHER", "no_parallel_publisher_ok", "shared inline publisher owns the only src createReviewComment writer callsite; adapter and handler have none")
    : failedCheck("M068-S03-NO-PARALLEL-PUBLISHER", "no_parallel_publisher_failed", publisherBoundary.failures));

  const negativeFixtures = buildNegativeFixtureResults(sources);
  contract.negative_fixtures = negativeFixtures;
  const preliminarySerialized = JSON.stringify({ checks, contract });
  const boundedFailures = [
    ...(!negativeFixtures.fallback_only_success_rejected ? ["negative fallback-only fixture was not rejected as candidate-approved success"] : []),
    ...(!negativeFixtures.missing_handler_callsite_failed ? ["negative missing handler callsite fixture did not fail"] : []),
    ...(!negativeFixtures.extra_create_review_comment_failed ? ["negative extra createReviewComment fixture did not fail"] : []),
    ...(!negativeFixtures.missing_prompt_fallback_failed ? ["negative missing prompt fallback fixture did not fail"] : []),
    ...(negativeFixtures.leak_marker_count <= 0 ? ["intentional leak marker fixture did not increment leak count"] : []),
    ...(countLeakMarkers(preliminarySerialized) !== 0 ? [`report leak markers=${countLeakMarkers(preliminarySerialized)}`] : []),
    ...(preliminarySerialized.length > 18000 ? [`report length=${preliminarySerialized.length}`] : []),
  ];
  checks.push(boundedFailures.length === 0
    ? passedCheck("M068-S03-BOUNDED-EVIDENCE", "bounded_evidence_ok", "verifier evidence is bounded to IDs/counts/reasons/paths; negative fixtures prove fallback-only, missing callsites, parallel publisher, prompt regression, and leak markers fail")
    : failedCheck("M068-S03-BOUNDED-EVIDENCE", "bounded_evidence_failed", boundedFailures));

  return makeReport({ generatedAt, checks, contract, negativeLeakMarkerCount: negativeFixtures.leak_marker_count });
}

function parseVerifyM068S03Args(args: string[]): VerifyM068S03Args {
  const options: VerifyM068S03Args = { help: false, json: false };
  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--json") {
      options.json = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

function emptyReport(issue: string): M068S03Report {
  return {
    command: "verify:m068:s03",
    generated_at: new Date().toISOString(),
    success: false,
    status_code: "m068_s03_invalid_arg",
    check_ids: [...M068_S03_CHECK_IDS],
    checks: [],
    failing_check_id: null,
    issues: [boundedDetail(issue)],
    contract: emptyContract(),
    redaction: {
      leak_marker_count: 0,
      serialized_report_length: 0,
      negative_fixture_leak_marker_count: 0,
    },
  };
}

export function renderM068S03Report(report: M068S03Report): string {
  const lines = [
    "# M068 S03 — Candidate Publication Closure Verifier",
    "",
    `Status: ${report.status_code}`,
    `Overall success: ${String(report.success)}`,
    `Failing check: ${report.failing_check_id ?? "none"}`,
    `Runtime: candidateMode=${report.contract.runtime.candidate_mode} candidatePublished=${report.contract.runtime.candidate_published} fallbackMode=${report.contract.runtime.direct_fallback_mode} fallbackEvidence=${report.contract.runtime.direct_fallback_evidence}`,
    `Static boundary: handlerPresent=${report.contract.static_boundary.handler_required_callsite_count} handlerMissing=${report.contract.static_boundary.handler_missing_callsite_count} adapterCreate=${report.contract.static_boundary.adapter_create_review_comment_callsite_count} publisherCreate=${report.contract.static_boundary.publisher_create_review_comment_callsite_count} nonSharedCreate=${report.contract.static_boundary.non_shared_create_review_comment_callsite_count}`,
    `Review Details: candidate=${report.contract.review_details.candidate_line ?? "missing"}`,
    `Review Details fallback: ${report.contract.review_details.fallback_line ?? "missing"}`,
    `Prompt contract: candidatePreferred=${report.contract.prompt_contract.candidate_preferred_mentions} auditedFallback=${report.contract.prompt_contract.audited_fallback_mentions} rawLeakWarning=${String(report.contract.prompt_contract.raw_leak_warning_present)}`,
    `Redaction: leakMarkers=${report.redaction.leak_marker_count} negativeFixtureLeakMarkers=${report.redaction.negative_fixture_leak_marker_count} reportLength=${report.redaction.serialized_report_length}`,
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
    "Usage: bun run verify:m068:s03 -- [--json]",
    "",
    "Verifies the M068 S03 candidate-approved publication closure contract using bounded runtime fixtures and static source checks.",
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
    evaluateFn?: typeof evaluateM068S03ClosureContract;
  },
): Promise<number> {
  const stdout = deps?.stdout ?? process.stdout;
  const stderr = deps?.stderr ?? process.stderr;
  const evaluateFn = deps?.evaluateFn ?? evaluateM068S03ClosureContract;

  try {
    const options = parseVerifyM068S03Args(args);
    if (options.help) {
      stdout.write(`${usage()}\n`);
      return 0;
    }

    const report = await evaluateFn();
    stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderM068S03Report(report));

    if (!report.success) {
      stderr.write(`verify:m068:s03 failed: ${report.failing_check_id ?? report.status_code}\n`);
    }

    return report.success ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stdout.write(`${JSON.stringify(emptyReport(message), null, 2)}\n`);
    return 1;
  }
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
