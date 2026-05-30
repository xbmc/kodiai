import {
  normalizeFindingLifecycle,
  toFindingLifecyclePublicProjection,
  type ReviewFindingEvidenceReference,
  type ReviewFindingInput,
  type ReviewFindingLifecycleInput,
  type ReviewFindingLifecyclePublicProjection,
  type ReviewFindingLifecycleResult,
} from "./finding-lifecycle.ts";
import {
  reduceValidationTruth,
  type SamePrFixTruthEvidence,
  type ValidationTruthEvidence,
  type ValidationTruthProjection,
  type ValidationTruthResult,
} from "./validation-truth.ts";
import type { ReviewCandidatePublicationTruthEvidence } from "../review-orchestration/review-candidate-publication-adapter.ts";
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
  counts: Record<string, unknown>;
  statusSummary: Record<string, unknown>;
  severitySummary: Record<string, unknown>;
  actionabilitySummary: Record<string, unknown>;
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

export type AttachReviewValidationTruthInput = {
  lifecycle: ReviewFindingLifecycleResult;
  correlation?: ReviewLifecycleHandlerCorrelation | null;
  publicationFixes?: ReadonlyArray<ReviewCandidatePublicationTruthEvidence | SamePrFixTruthEvidence | null | undefined> | null;
  validations?: ReadonlyArray<ValidationTruthEvidence | null | undefined> | null;
  revalidations?: ReadonlyArray<ValidationTruthEvidence | null | undefined> | null;
  requireRevalidation?: boolean | null;
};

export type ReviewValidationTruthLogEvidence = {
  gate: "review-validation-truth";
  reviewOutputKey: string;
  deliveryId?: string;
  counts: ValidationTruthProjection["counts"];
  reasonCounts: ValidationTruthProjection["reasonCounts"];
  evidenceFreshness: ValidationTruthProjection["evidenceFreshness"];
  redaction: ValidationTruthProjection["redaction"];
};

export type AttachReviewValidationTruthResult = {
  status: ValidationTruthResult["projection"]["status"];
  validationTruth: ValidationTruthResult;
  projection: ValidationTruthProjection;
  logEvidence: ReviewValidationTruthLogEvidence;
};

export function attachReviewValidationTruth(input: AttachReviewValidationTruthInput): AttachReviewValidationTruthResult {
  const correlation = input.correlation ?? input.lifecycle;
  const samePrFixes = composeSamePrFixTruthEvidence(input.lifecycle, input.publicationFixes, correlation);
  const validationTruth = reduceValidationTruth({
    repo: correlation.repo ?? input.lifecycle.repo,
    pullNumber: correlation.pullNumber ?? input.lifecycle.pullNumber,
    reviewOutputKey: correlation.reviewOutputKey ?? input.lifecycle.reviewOutputKey,
    deliveryId: correlation.deliveryId ?? input.lifecycle.deliveryId,
    findings: input.lifecycle.records,
    samePrFixes,
    validations: input.validations,
    revalidations: input.revalidations,
    requireRevalidation: input.requireRevalidation,
  });

  return {
    status: validationTruth.projection.status,
    validationTruth,
    projection: validationTruth.projection,
    logEvidence: {
      gate: "review-validation-truth",
      reviewOutputKey: validationTruth.projection.reviewOutputKey ?? input.lifecycle.reviewOutputKey,
      ...(validationTruth.projection.deliveryId ? { deliveryId: validationTruth.projection.deliveryId } : {}),
      counts: validationTruth.projection.counts,
      reasonCounts: validationTruth.projection.reasonCounts,
      evidenceFreshness: validationTruth.projection.evidenceFreshness,
      redaction: validationTruth.projection.redaction,
    },
  };
}

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
      counts: omitZeroCountLeaves(projection.counts),
      statusSummary: omitZeroCountLeaves(projection.counts.status),
      severitySummary: omitZeroCountLeaves(projection.counts.severity),
      actionabilitySummary: omitZeroCountLeaves(projection.counts.actionability),
      rejectionReasonCodes: projection.rejectedReasonCodes,
      reasonCodes: projection.reasonCodes,
      redaction: projection.redaction,
    },
  };
}

function omitZeroCountLeaves(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output: Record<string, unknown> = {};

  for (const [key, child] of Object.entries(value)) {
    if (typeof child === "number") {
      if (child !== 0) output[key] = child;
      continue;
    }

    if (child && typeof child === "object" && !Array.isArray(child)) {
      const nested = omitZeroCountLeaves(child);
      if (Object.keys(nested).length > 0) output[key] = nested;
      continue;
    }

    output[key] = child;
  }

  return output;
}

function composeSamePrFixTruthEvidence(
  lifecycle: ReviewFindingLifecycleResult,
  publicationFixes: AttachReviewValidationTruthInput["publicationFixes"],
  correlation: ReviewLifecycleHandlerCorrelation | ReviewFindingLifecycleResult,
): SamePrFixTruthEvidence[] {
  const inputs = (Array.isArray(publicationFixes) ? publicationFixes : []).filter(
    (evidence): evidence is ReviewCandidatePublicationTruthEvidence | SamePrFixTruthEvidence => Boolean(evidence),
  );
  const matchedRecordIds = new Set<string>();
  const samePrFixes: SamePrFixTruthEvidence[] = [];
  let unmatchedPublicationEvidence = false;

  for (const evidence of inputs) {
    const matchedRecord = findLifecycleRecordForPublicationEvidence(lifecycle, evidence);
    if (!matchedRecord) {
      unmatchedPublicationEvidence = true;
      continue;
    }
    matchedRecordIds.add(matchedRecord.id);
    samePrFixes.push({
      reviewOutputKey: correlation.reviewOutputKey ?? lifecycle.reviewOutputKey,
      deliveryId: correlation.deliveryId ?? lifecycle.deliveryId,
      findingId: matchedRecord.id,
      findingIdentityHash: matchedRecord.identityHash,
      lifecycleId: matchedRecord.id,
      status: normalizeSamePrFixTruthStatus(evidence.status),
      suggested: evidence.suggested === true || evidence.status === "suggested",
    });
  }

  if (unmatchedPublicationEvidence) {
    for (const record of lifecycle.records) {
      if (matchedRecordIds.has(record.id)) continue;
      samePrFixes.push({
        reviewOutputKey: correlation.reviewOutputKey ?? lifecycle.reviewOutputKey,
        deliveryId: correlation.deliveryId ?? lifecycle.deliveryId,
        findingId: record.id,
        findingIdentityHash: record.identityHash,
        lifecycleId: record.id,
        status: "degraded",
        suggested: false,
      });
    }
  }

  return samePrFixes;
}

function findLifecycleRecordForPublicationEvidence(
  lifecycle: ReviewFindingLifecycleResult,
  evidence: ReviewCandidatePublicationTruthEvidence | SamePrFixTruthEvidence,
): ReviewFindingLifecycleResult["records"][number] | undefined {
  const candidateFingerprint = sanitizeRefToken((evidence as ReviewCandidatePublicationTruthEvidence).candidateFingerprint);
  const commentArtifactRef = sanitizeRefToken((evidence as ReviewCandidatePublicationTruthEvidence).commentArtifactRef);
  const findingId = sanitizeRefToken(evidence.findingId ?? evidence.lifecycleId);
  const identityHash = typeof evidence.findingIdentityHash === "string" ? evidence.findingIdentityHash.trim() : "";
  return lifecycle.records.find((record) => {
    if (findingId && (record.id === findingId || record.identityHash === findingId)) return true;
    if (identityHash && record.identityHash === identityHash) return true;
    if (candidateFingerprint && hasEvidenceRef(record, `candidate:${candidateFingerprint}`)) return true;
    if (commentArtifactRef && hasEvidenceRef(record, commentArtifactRef)) return true;
    return false;
  });
}

function hasEvidenceRef(record: ReviewFindingLifecycleResult["records"][number], ref: string): boolean {
  return record.evidenceRefs.some((evidenceRef) => evidenceRef.kind === "artifact" && evidenceRef.ref === ref);
}

function normalizeSamePrFixTruthStatus(status: SamePrFixTruthEvidence["status"]): NonNullable<SamePrFixTruthEvidence["status"]> {
  if (status === "suggested" || status === "blocked" || status === "degraded") return status;
  return "open";
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
