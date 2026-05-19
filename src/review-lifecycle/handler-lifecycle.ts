import {
  normalizeFindingLifecycle,
  toFindingLifecyclePublicProjection,
  type ReviewFindingEvidenceReference,
  type ReviewFindingInput,
  type ReviewFindingLifecycleInput,
  type ReviewFindingLifecyclePublicProjection,
  type ReviewFindingLifecycleResult,
} from "./finding-lifecycle.ts";
import type { ReviewCandidateFindingExecutionResult } from "../review-orchestration/review-candidate-finding.ts";
import type { ProcessedReviewFinding } from "../review-orchestration/review-reducer.ts";

export type ReviewLifecycleHandlerSource = "automatic" | "mention";
export type ReviewLifecycleHandlerTrigger = "pull_request" | "issue_comment" | "review_comment" | "manual";

export type ReviewLifecycleHandlerCorrelation = {
  repo?: string | null;
  pullNumber?: number | null;
  reviewOutputKey?: string | null;
  deliveryId?: string | null;
  commitSha?: string | null;
  headSha?: string | null;
  baseSha?: string | null;
  headRef?: string | null;
  baseRef?: string | null;
};

export type BoundedReviewFindingSummary = Pick<
  ReviewFindingInput,
  | "filePath"
  | "startLine"
  | "endLine"
  | "severity"
  | "category"
  | "title"
  | "confidence"
  | "actionability"
  | "validationNeeds"
  | "revalidationState"
  | "statusHistory"
  | "evidenceRefs"
  | "reasonCodes"
> & {
  commentId?: number | string | null;
  candidateFingerprint?: string | null;
  candidateId?: string | null;
  source?: string | null;
};

export type AttachReviewFindingLifecycleInput = {
  source: ReviewLifecycleHandlerSource;
  trigger: ReviewLifecycleHandlerTrigger;
  correlation: ReviewLifecycleHandlerCorrelation;
  findings?: ReadonlyArray<BoundedReviewFindingSummary | ProcessedReviewFinding | null | undefined> | null;
  candidateFinding?: ReviewCandidateFindingExecutionResult | null;
};

export type ReviewFindingLifecycleLogEvidence = {
  gate: "review-finding-lifecycle";
  reviewOutputKey: string;
  deliveryId?: string;
  source: ReviewLifecycleHandlerSource;
  trigger: ReviewLifecycleHandlerTrigger;
  normalizedStatus: ReviewFindingLifecycleResult["status"];
  counts: ReviewFindingLifecyclePublicProjection["counts"];
  statusSummary: ReviewFindingLifecyclePublicProjection["counts"]["status"];
  severitySummary: ReviewFindingLifecyclePublicProjection["counts"]["severity"];
  actionabilitySummary: ReviewFindingLifecyclePublicProjection["counts"]["actionability"];
  rejectionReasonCodes: readonly string[];
  reasonCodes: readonly string[];
  redaction: ReviewFindingLifecyclePublicProjection["redaction"];
};

export type AttachReviewFindingLifecycleResult = {
  status: ReviewFindingLifecycleResult["status"];
  source: ReviewLifecycleHandlerSource;
  trigger: ReviewLifecycleHandlerTrigger;
  lifecycle: ReviewFindingLifecycleResult;
  projection: ReviewFindingLifecyclePublicProjection;
  logEvidence: ReviewFindingLifecycleLogEvidence;
};

export function attachReviewFindingLifecycle(
  input: AttachReviewFindingLifecycleInput,
): AttachReviewFindingLifecycleResult {
  const lifecycleInput = toLifecycleInput(input);
  const lifecycle = normalizeFindingLifecycle(lifecycleInput);
  const projection = toFindingLifecyclePublicProjection(lifecycle);

  return {
    status: lifecycle.status,
    source: input.source,
    trigger: input.trigger,
    lifecycle,
    projection,
    logEvidence: {
      gate: "review-finding-lifecycle",
      reviewOutputKey: lifecycle.reviewOutputKey,
      ...(lifecycle.deliveryId ? { deliveryId: lifecycle.deliveryId } : {}),
      source: input.source,
      trigger: input.trigger,
      normalizedStatus: lifecycle.status,
      counts: projection.counts,
      statusSummary: projection.counts.status,
      severitySummary: projection.counts.severity,
      actionabilitySummary: projection.counts.actionability,
      rejectionReasonCodes: projection.rejectedReasonCodes,
      reasonCodes: projection.reasonCodes,
      redaction: projection.redaction,
    },
  };
}

function toLifecycleInput(input: AttachReviewFindingLifecycleInput): ReviewFindingLifecycleInput {
  const correlation = input.correlation;
  const candidateFindings = input.candidateFinding?.findings ?? [];
  const findings = [
    ...(Array.isArray(input.findings) ? input.findings : []),
    ...candidateFindings,
  ]
    .filter((finding): finding is BoundedReviewFindingSummary | ProcessedReviewFinding | ReviewCandidateFindingExecutionResult["findings"][number] => Boolean(finding))
    .map((finding) => toLifecycleFinding(finding, input.source));

  const commitSha = normalizeOptionalToken(correlation.commitSha)
    ?? normalizeOptionalToken(correlation.headSha)
    ?? normalizeOptionalToken(correlation.baseSha);

  return {
    repo: correlation.repo,
    pullNumber: correlation.pullNumber,
    reviewOutputKey: correlation.reviewOutputKey,
    deliveryId: correlation.deliveryId,
    commitSha,
    headRef: correlation.headRef ?? correlation.headSha,
    baseRef: correlation.baseRef ?? correlation.baseSha,
    findings,
  };
}

function toLifecycleFinding(
  finding: BoundedReviewFindingSummary | ProcessedReviewFinding | ReviewCandidateFindingExecutionResult["findings"][number],
  source: ReviewLifecycleHandlerSource,
): ReviewFindingInput {
  const record = finding as BoundedReviewFindingSummary & ReviewFindingInput & { fingerprint?: unknown; evidence?: unknown; commentId?: unknown };
  const isCandidateExecutionFinding = typeof record.fingerprint === "string";
  const evidenceRefs = boundedEvidenceRefs(record, source);
  return {
    filePath: record.filePath,
    startLine: record.startLine,
    endLine: record.endLine,
    severity: typeof record.severity === "string" ? record.severity : undefined,
    category: typeof record.category === "string" ? record.category : undefined,
    title: record.title,
    confidence: typeof record.confidence === "number" ? record.confidence : undefined,
    actionability: record.actionability,
    validationNeeds: record.validationNeeds,
    revalidationState: record.revalidationState,
    reasonCodes: sanitizeReasonCodes(record.reasonCodes, source),
    evidenceRefs,
    statusHistory: Array.isArray(record.statusHistory) && record.statusHistory.length > 0
      ? record.statusHistory
      : [
        { status: "detected", reasonCode: `${source}-detected`, evidenceRefs },
        { status: "open", reasonCode: `${source}-open`, evidenceRefs },
      ],
    body: !isCandidateExecutionFinding && typeof record.body === "string" ? record.body : undefined,
    rawPrompt: typeof record.rawPrompt === "string" ? record.rawPrompt : undefined,
    rawModelOutput: typeof record.rawModelOutput === "string" ? record.rawModelOutput : undefined,
    candidateBody: typeof record.candidateBody === "string" ? record.candidateBody : undefined,
    toolPayload: record.toolPayload,
    diffText: typeof record.diffText === "string" ? record.diffText : undefined,
  };
}

function boundedEvidenceRefs(
  finding: BoundedReviewFindingSummary & { fingerprint?: unknown; evidence?: unknown; commentId?: unknown },
  source: ReviewLifecycleHandlerSource,
): ReviewFindingInput["evidenceRefs"] {
  const refs: ReviewFindingEvidenceReference[] = [];
  if (Array.isArray(finding.evidenceRefs)) refs.push(...finding.evidenceRefs);
  const fileRef = boundedFileRef(finding.filePath, finding.startLine);
  if (fileRef) refs.push({ kind: "file", ref: fileRef });
  const commentId = sanitizeRefToken(finding.commentId);
  if (commentId) refs.push({ kind: "artifact", ref: `comment:${commentId}` });
  const candidateRef = sanitizeRefToken(finding.candidateFingerprint ?? finding.candidateId ?? finding.fingerprint);
  if (candidateRef) refs.push({ kind: "artifact", ref: `candidate:${candidateRef}` });
  refs.push({ kind: "rule", ref: `trigger:${source}` });
  return refs;
}

function sanitizeReasonCodes(
  reasonCodes: ReviewFindingInput["reasonCodes"],
  source: ReviewLifecycleHandlerSource,
): ReviewFindingInput["reasonCodes"] {
  const values = Array.isArray(reasonCodes) ? reasonCodes : [];
  return [`${source}-review`, ...values];
}

function boundedFileRef(filePath: unknown, startLine: unknown): string | null {
  if (typeof filePath !== "string" || !filePath.trim()) return null;
  const path = filePath.trim().replace(/[\r\n|]+/g, " ").slice(0, 100);
  if (!path || path.startsWith("/") || path.includes("..")) return null;
  const line = typeof startLine === "number" && Number.isFinite(startLine) && startLine > 0
    ? `:${Math.floor(startLine)}`
    : "";
  return `${path}${line}`;
}

function sanitizeRefToken(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value)
    .trim()
    .replace(/[^a-zA-Z0-9._:@-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return normalized || null;
}

function normalizeOptionalToken(value: unknown): string | undefined {
  const normalized = sanitizeRefToken(value);
  return normalized ?? undefined;
}
