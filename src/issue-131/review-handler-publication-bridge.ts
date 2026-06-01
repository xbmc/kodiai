import {
  createCandidatePublicationBridgeRecord,
  projectCandidatePublicationReducerHandoffInput,
  type CandidatePublicationBridgeCounts,
  type CandidatePublicationBridgeMalformedReasonCode,
  type CandidatePublicationBridgeReasonCategory,
  type CandidatePublicationBridgeRecord,
  type CandidatePublicationReducerHandoffInput,
} from "./candidate-publication-bridge.ts";
import type { Issue131DeferredHandoffRow } from "./deferred-handoff.ts";
import type {
  CandidatePublicationPolicyCounts,
  CandidatePublicationPolicyReasonCategory,
  CandidatePublicationPolicyResult,
} from "../specialists/candidate-publication-policy.ts";
import type { CandidateVerificationState } from "../specialists/candidate-verification.ts";
import type { CandidateVerificationPublicationEvidenceSummary } from "../specialists/candidate-verification-publication-evidence.ts";
import type { ReviewHandlerPublicationBridgeReviewDetails } from "../review-orchestration/review-candidate-publication-bridge-details.ts";
export type { ReviewHandlerPublicationBridgeReviewDetails } from "../review-orchestration/review-candidate-publication-bridge-details.ts";

export const REVIEW_HANDLER_PUBLICATION_BRIDGE_SOURCE_LABEL = "review-handler-publication" as const;

export type ReviewHandlerPublicationBridgeProjectionInput = {
  readonly evidenceSummary?: CandidateVerificationPublicationEvidenceSummary | null;
  readonly deliveryId?: unknown;
  readonly reviewOutputKey?: unknown;
  readonly upstreamCorrelationKey?: unknown;
  readonly sourceLabel?: typeof REVIEW_HANDLER_PUBLICATION_BRIDGE_SOURCE_LABEL;
  readonly deferredHandoffRows?: readonly Issue131DeferredHandoffRow[];
};

export type ReviewHandlerPublicationBridgeLogFields = {
  readonly candidatePublicationBridgeStatus: CandidatePublicationBridgeRecord["status"];
  readonly candidatePublicationBridgeRecordKey: string;
  readonly candidatePublicationBridgeCorrelationKey: string;
  readonly candidatePublicationReducerHandoffAvailable: boolean;
  readonly candidatePublicationBridgeCandidateCount: number;
  readonly candidatePublicationBridgeEvidenceCount: number;
  readonly candidatePublicationBridgePublicationEligibleCount: number;
  readonly candidatePublicationBridgeMalformedRecordCount: number;
  readonly candidatePublicationBridgeUnsafeInputFieldCount: number;
  readonly candidatePublicationBridgeHasDeliveryId: boolean;
  readonly candidatePublicationBridgeHasReviewOutputKey: boolean;
  readonly candidatePublicationBridgeHasUpstreamCorrelationKey: boolean;
  readonly candidatePublicationBridgeHasPolicyCorrelationKey: boolean;
  readonly candidatePublicationBridgeReasonCategories: readonly CandidatePublicationBridgeReasonCategory[];
  readonly candidatePublicationBridgeMalformedReasonCodes: readonly CandidatePublicationBridgeMalformedReasonCode[];
  readonly candidatePublicationBridgeDiscardedRawPayload: boolean;
  readonly candidatePublicationBridgeDiscardedPublicationFields: boolean;
  readonly candidatePublicationBridgeDiscardedEvidencePayloads: boolean;
  readonly candidatePublicationBridgePrivateOnly: true;
};

export type ReviewHandlerPublicationBridgeProjection = {
  readonly bridgeRecord: CandidatePublicationBridgeRecord;
  readonly reducerHandoffInput: CandidatePublicationReducerHandoffInput;
  readonly logFields: ReviewHandlerPublicationBridgeLogFields;
  readonly reviewDetails: ReviewHandlerPublicationBridgeReviewDetails;
};

type UnsafeFieldDetection = {
  readonly unsafeInputFieldCount: number;
  readonly discardedRawPayload: boolean;
  readonly discardedPublicationFields: boolean;
  readonly discardedEvidencePayloads: boolean;
};

const MAX_SAFE_STRING_LENGTH = 256;
const MAX_REASON_CATEGORIES = 12;
const MAX_COUNT = 10_000;

const RAW_PAYLOAD_KEYS = new Set(["prompt", "rawPrompt", "systemPrompt", "modelOutput", "modelText", "rawModelOutput", "toolPayload", "toolResult", "toolResults", "messages"]);
const PUBLICATION_KEYS = new Set(["body", "commentBody", "githubCommentBody", "inlineComment", "inlineComments", "suggestion", "finding", "findings", "specialistProse", "prose"]);
const EVIDENCE_PAYLOAD_KEYS = new Set(["diff", "patch", "fingerprint", "rawFingerprint", "payload", "evidencePayload", "rawEvidence"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, MAX_SAFE_STRING_LENGTH) : undefined;
}

function clampCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(MAX_COUNT, Math.max(0, Math.trunc(value)));
}

function appendUnique<T>(target: T[], value: T): void {
  if (!target.includes(value)) target.push(value);
}

function detectUnsafeFields(value: unknown): UnsafeFieldDetection {
  const flags = {
    unsafeInputFieldCount: 0,
    discardedRawPayload: false,
    discardedPublicationFields: false,
    discardedEvidencePayloads: false,
  };

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const entry of node) visit(entry);
      return;
    }
    if (!isRecord(node)) return;
    for (const [key, nested] of Object.entries(node)) {
      if (RAW_PAYLOAD_KEYS.has(key)) {
        flags.unsafeInputFieldCount++;
        flags.discardedRawPayload = true;
      }
      if (PUBLICATION_KEYS.has(key)) {
        flags.unsafeInputFieldCount++;
        flags.discardedPublicationFields = true;
      }
      if (EVIDENCE_PAYLOAD_KEYS.has(key)) {
        flags.unsafeInputFieldCount++;
        flags.discardedEvidencePayloads = true;
      }
      visit(nested);
    }
  };

  visit(value);
  return flags;
}

function emptyPolicyCounts(overrides: Partial<CandidatePublicationPolicyCounts> = {}): CandidatePublicationPolicyCounts {
  return {
    candidateCount: 0,
    evidenceCount: 0,
    verifiedCount: 0,
    partiallyVerifiedCount: 0,
    unverifiedCount: 0,
    disprovenCount: 0,
    publicationEligibleCount: 0,
    duplicateCount: 0,
    disagreementCount: 0,
    unclassifiableCount: 0,
    malformedRecordCount: 0,
    truncatedCandidateCount: 0,
    truncatedEvidenceCount: 0,
    policyCandidateCount: 0,
    ...overrides,
  };
}

function isValidReason(value: unknown): value is CandidatePublicationPolicyReasonCategory {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeReasonCategories(values: unknown, fallback: readonly CandidatePublicationPolicyReasonCategory[]): CandidatePublicationPolicyReasonCategory[] {
  const reasons: CandidatePublicationPolicyReasonCategory[] = [];
  const source = Array.isArray(values) ? values : fallback;
  for (const value of source) {
    if (isValidReason(value)) appendUnique(reasons, value.slice(0, 80) as CandidatePublicationPolicyReasonCategory);
    if (reasons.length >= MAX_REASON_CATEGORIES) break;
  }
  if (reasons.length === 0) {
    for (const reason of fallback) appendUnique(reasons, reason);
  }
  return reasons;
}

function isPublicationEvidenceSummary(value: unknown): value is CandidateVerificationPublicationEvidenceSummary {
  if (!isRecord(value)) return false;
  return (value.aggregateStatus === "none"
      || value.aggregateStatus === "allowed"
      || value.aggregateStatus === "denied"
      || value.aggregateStatus === "published"
      || value.aggregateStatus === "skipped"
      || value.aggregateStatus === "failed"
      || value.aggregateStatus === "mixed")
    && isRecord(value.counts)
    && isRecord(value.candidateVerificationCounts)
    && isRecord(value.metadata)
    && isRecord(value.redactionFlags)
    && Array.isArray(value.reasonCategories)
    && isRecord(value.verificationStateCounts);
}

function dominantVerificationState(summary: CandidateVerificationPublicationEvidenceSummary): CandidateVerificationState | null {
  const counts = summary.verificationStateCounts;
  const ordered: readonly CandidateVerificationState[] = ["verified", "partially_verified", "unverified", "disproven"];
  let best: CandidateVerificationState | null = null;
  let bestCount = 0;
  for (const state of ordered) {
    const count = clampCount(counts[state]);
    if (count > bestCount) {
      best = state;
      bestCount = count;
    }
  }
  return best;
}

function safePolicyCounts(summary: CandidateVerificationPublicationEvidenceSummary | null, malformedRecordCount = 0): CandidatePublicationPolicyCounts {
  const source = summary?.candidateVerificationCounts;
  return emptyPolicyCounts({
    candidateCount: clampCount(source?.candidateCount),
    evidenceCount: clampCount(source?.evidenceCount),
    verifiedCount: clampCount(source?.verifiedCount),
    partiallyVerifiedCount: clampCount(source?.partiallyVerifiedCount),
    unverifiedCount: clampCount(source?.unverifiedCount),
    disprovenCount: clampCount(source?.disprovenCount),
    publicationEligibleCount: clampCount(source?.publicationEligibleCount),
    duplicateCount: clampCount(source?.duplicateCount),
    disagreementCount: clampCount(source?.disagreementCount),
    unclassifiableCount: clampCount(source?.unclassifiableCount),
    malformedRecordCount: Math.max(clampCount(source?.malformedRecordCount), malformedRecordCount),
    truncatedCandidateCount: clampCount(source?.truncatedCandidateCount),
    truncatedEvidenceCount: clampCount(source?.truncatedEvidenceCount),
    policyCandidateCount: clampCount(source?.policyCandidateCount),
  });
}

function hasUnsafeRedactionFlags(summary: CandidateVerificationPublicationEvidenceSummary): boolean {
  const flags = summary.redactionFlags;
  return flags.privateOnly !== true
    || flags.candidateBodiesIncluded !== false
    || flags.specialistProseIncluded !== false
    || flags.rawPromptsIncluded !== false
    || flags.rawModelOutputIncluded !== false
    || flags.diffsIncluded !== false
    || flags.evidencePayloadsIncluded !== false
    || flags.rawFingerprintsIncluded !== false
    || flags.candidateAttemptIncluded !== false
    || flags.candidateKeyIncluded !== false
    || flags.publicationEvidenceIncluded !== false;
}

function candidateRefFor(input: {
  readonly deliveryId?: string;
  readonly reviewOutputKey?: string;
  readonly correlationKey?: string;
  readonly status: string;
}): string {
  const material = [input.deliveryId, input.reviewOutputKey, input.correlationKey, input.status].filter(Boolean).join(":");
  if (!material) return "candidate-publication-summary-unavailable";
  let hash = 0;
  for (let index = 0; index < material.length; index++) {
    hash = (Math.imul(31, hash) + material.charCodeAt(index)) | 0;
  }
  return `candidate-publication-summary-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function policyResultFromEvidence(
  evidenceSummary: CandidateVerificationPublicationEvidenceSummary | null,
  input: ReviewHandlerPublicationBridgeProjectionInput,
  malformed: boolean,
  unsafeFields: UnsafeFieldDetection,
): CandidatePublicationPolicyResult {
  const deliveryId = boundedString(input.deliveryId) ?? evidenceSummary?.metadata.deliveryId;
  const reviewOutputKey = boundedString(input.reviewOutputKey) ?? evidenceSummary?.metadata.reviewOutputKey;
  const correlationKey = boundedString(input.upstreamCorrelationKey) ?? evidenceSummary?.metadata.correlationKey;
  const hasDeliveryId = Boolean(deliveryId ?? evidenceSummary?.metadata.hasDeliveryId);
  const hasReviewOutputKey = Boolean(reviewOutputKey ?? evidenceSummary?.metadata.hasReviewOutputKey);
  const hasCorrelationKey = Boolean(correlationKey ?? evidenceSummary?.metadata.hasCorrelationKey);
  const absent = evidenceSummary === null || evidenceSummary.aggregateStatus === "none" || evidenceSummary.counts.attempted === 0;
  const unsafeRedactions = evidenceSummary ? hasUnsafeRedactionFlags(evidenceSummary) : false;
  const counts = safePolicyCounts(evidenceSummary, malformed || unsafeRedactions || unsafeFields.unsafeInputFieldCount > 0 ? 1 : 0);
  const allowedByOutcome = evidenceSummary?.aggregateStatus === "allowed" || evidenceSummary?.aggregateStatus === "published";
  const allowed = allowedByOutcome
    && hasDeliveryId
    && hasReviewOutputKey
    && hasCorrelationKey
    && !malformed
    && !unsafeRedactions
    && counts.malformedRecordCount === 0
    && unsafeFields.unsafeInputFieldCount === 0;
  const reasons = normalizeReasonCategories(
    evidenceSummary?.reasonCategories,
    absent ? ["no-evidence", "publication-ineligible"] : ["publication-ineligible"],
  );

  if (malformed || unsafeRedactions) appendUnique(reasons, "malformed-input");
  if (!allowed) appendUnique(reasons, "publication-ineligible");

  const redactionFlags = evidenceSummary?.redactionFlags;
  return {
    allowed,
    status: allowed ? "allow" : "deny",
    candidateRef: candidateRefFor({ deliveryId, reviewOutputKey, correlationKey, status: evidenceSummary?.aggregateStatus ?? "none" }),
    verificationState: dominantVerificationState(evidenceSummary ?? ({ verificationStateCounts: {} } as CandidateVerificationPublicationEvidenceSummary)),
    reasonCategories: reasons,
    counts,
    hasDeliveryId,
    hasReviewOutputKey,
    hasCorrelationKey,
    redactionFlags: {
      privateOnly: true,
      candidateBodiesIncluded: false,
      specialistProseIncluded: false,
      rawPromptsIncluded: false,
      rawModelOutputIncluded: false,
      diffsIncluded: false,
      evidencePayloadsIncluded: false,
      rawFingerprintsIncluded: false,
      unsafeInputFieldCount: clampCount((redactionFlags?.unsafeInputFieldCount ?? 0) + unsafeFields.unsafeInputFieldCount),
      discardedRawPayload: Boolean(redactionFlags?.discardedRawPayload || unsafeFields.discardedRawPayload || unsafeRedactions),
      discardedPublicationFields: Boolean(redactionFlags?.discardedPublicationFields || unsafeFields.discardedPublicationFields || unsafeRedactions),
      discardedEvidencePayloads: Boolean(redactionFlags?.discardedEvidencePayloads || unsafeFields.discardedEvidencePayloads || unsafeRedactions),
      candidateAttemptIncluded: false,
      candidateKeyIncluded: false,
    },
  };
}

function logFields(record: CandidatePublicationBridgeRecord, handoff: CandidatePublicationReducerHandoffInput): ReviewHandlerPublicationBridgeLogFields {
  return {
    candidatePublicationBridgeStatus: record.status,
    candidatePublicationBridgeRecordKey: record.recordKey,
    candidatePublicationBridgeCorrelationKey: record.correlationKey,
    candidatePublicationReducerHandoffAvailable: handoff.downstreamHandoffOwner !== null,
    candidatePublicationBridgeCandidateCount: record.counts.candidateCount,
    candidatePublicationBridgeEvidenceCount: record.counts.evidenceCount,
    candidatePublicationBridgePublicationEligibleCount: record.counts.publicationEligibleCount,
    candidatePublicationBridgeMalformedRecordCount: record.counts.malformedRecordCount,
    candidatePublicationBridgeUnsafeInputFieldCount: record.counts.unsafeInputFieldCount,
    candidatePublicationBridgeHasDeliveryId: record.presence.hasDeliveryId,
    candidatePublicationBridgeHasReviewOutputKey: record.presence.hasReviewOutputKey,
    candidatePublicationBridgeHasUpstreamCorrelationKey: record.presence.hasUpstreamCorrelationKey,
    candidatePublicationBridgeHasPolicyCorrelationKey: record.presence.hasPolicyCorrelationKey,
    candidatePublicationBridgeReasonCategories: record.reasonCategories,
    candidatePublicationBridgeMalformedReasonCodes: record.malformedReasonCodes,
    candidatePublicationBridgeDiscardedRawPayload: record.redactionFlags.discardedRawPayload,
    candidatePublicationBridgeDiscardedPublicationFields: record.redactionFlags.discardedPublicationFields,
    candidatePublicationBridgeDiscardedEvidencePayloads: record.redactionFlags.discardedEvidencePayloads,
    candidatePublicationBridgePrivateOnly: true,
  };
}

function reviewDetails(record: CandidatePublicationBridgeRecord, handoff: CandidatePublicationReducerHandoffInput): ReviewHandlerPublicationBridgeReviewDetails {
  return {
    bridgeVersion: record.bridgeVersion,
    bridgeId: record.recordKey,
    recordKey: record.recordKey,
    correlationKey: record.correlationKey,
    status: record.status,
    sourceLabel: record.sourceLabel,
    candidateRef: record.candidateRef,
    verificationState: record.verificationState,
    reducerHandoffAvailable: handoff.downstreamHandoffOwner !== null,
    counts: {
      candidateCount: record.counts.candidateCount,
      evidenceCount: record.counts.evidenceCount,
      verifiedCount: record.counts.verifiedCount,
      partiallyVerifiedCount: record.counts.partiallyVerifiedCount,
      unverifiedCount: record.counts.unverifiedCount,
      disprovenCount: record.counts.disprovenCount,
      publicationEligibleCount: record.counts.publicationEligibleCount,
      malformedRecordCount: record.counts.malformedRecordCount,
      unsafeInputFieldCount: record.counts.unsafeInputFieldCount,
    },
    presence: record.presence,
    reasonCategories: record.reasonCategories,
    malformedReasonCodes: record.malformedReasonCodes,
    redaction: {
      privateOnly: true,
      rawPayloadsIncluded: false,
      publicationFieldsIncluded: false,
      evidencePayloadsIncluded: false,
      githubCommentBodyIncluded: false,
      reducerHandoffIncludesRawPayload: false,
      discardedRawPayload: record.redactionFlags.discardedRawPayload,
      discardedPublicationFields: record.redactionFlags.discardedPublicationFields,
      discardedEvidencePayloads: record.redactionFlags.discardedEvidencePayloads,
    },
  };
}

export function projectReviewHandlerCandidatePublicationBridgeEvidence(
  input: ReviewHandlerPublicationBridgeProjectionInput,
): ReviewHandlerPublicationBridgeProjection {
  const evidenceSummary = isPublicationEvidenceSummary(input.evidenceSummary) ? input.evidenceSummary : null;
  const malformed = input.evidenceSummary !== null && input.evidenceSummary !== undefined && evidenceSummary === null;
  const unsafeFields = detectUnsafeFields(input.evidenceSummary);
  const sourceLabel = input.sourceLabel ?? REVIEW_HANDLER_PUBLICATION_BRIDGE_SOURCE_LABEL;
  const upstreamCorrelationKey = boundedString(input.upstreamCorrelationKey) ?? evidenceSummary?.metadata.correlationKey;
  const policyResult = policyResultFromEvidence(evidenceSummary, input, malformed, unsafeFields);
  const bridgeRecord = createCandidatePublicationBridgeRecord({
    sourceLabel,
    upstreamCorrelationKey,
    policyResult,
    candidateMetadata: unsafeFields.unsafeInputFieldCount > 0 ? input.evidenceSummary : undefined,
  });
  const reducerHandoffInput = projectCandidatePublicationReducerHandoffInput(bridgeRecord, input.deferredHandoffRows);

  return {
    bridgeRecord,
    reducerHandoffInput,
    logFields: logFields(bridgeRecord, reducerHandoffInput),
    reviewDetails: reviewDetails(bridgeRecord, reducerHandoffInput),
  };
}
