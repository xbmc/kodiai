import type {
  CandidatePublicationPolicyCounts,
  CandidatePublicationPolicyReasonCategory,
  CandidatePublicationPolicyRedactionFlags,
  CandidatePublicationPolicyResult,
} from "./candidate-publication-policy.ts";
import type { CandidateVerificationState } from "./candidate-verification.ts";

export type CandidateVerificationPublicationOutcome = "allowed" | "denied" | "published" | "skipped" | "failed";

export type CandidateVerificationPublicationMetadata = {
  readonly deliveryId?: unknown;
  readonly reviewOutputKey?: unknown;
  readonly correlationKey?: unknown;
};

export type CandidateVerificationPublicationEvidenceEvent = {
  readonly outcome: CandidateVerificationPublicationOutcome;
  readonly policyResult?: CandidatePublicationPolicyResult | null;
  readonly reason?: unknown;
  readonly metadata?: CandidateVerificationPublicationMetadata;
};

export type CandidateVerificationPublicationEvidenceCounts = {
  attempted: number;
  allowed: number;
  denied: number;
  published: number;
  skipped: number;
  failed: number;
};

export type CandidateVerificationPublicationVerificationStateCounts = Record<CandidateVerificationState | "unavailable", number>;

export type CandidateVerificationPublicationEvidenceMetadataSummary = {
  hasDeliveryId: boolean;
  hasReviewOutputKey: boolean;
  hasCorrelationKey: boolean;
  deliveryId?: string;
  reviewOutputKey?: string;
  correlationKey?: string;
};

export type CandidateVerificationPublicationEvidenceRedactionFlags = CandidatePublicationPolicyRedactionFlags & {
  readonly publicationEvidenceIncluded: false;
};

export type CandidateVerificationPublicationEvidenceSummary = {
  aggregateStatus: "none" | CandidateVerificationPublicationOutcome | "mixed";
  counts: CandidateVerificationPublicationEvidenceCounts;
  publicationDenialCounts: Partial<Record<CandidatePublicationPolicyReasonCategory, number>>;
  reasonCategories: CandidatePublicationPolicyReasonCategory[];
  verificationStateCounts: CandidateVerificationPublicationVerificationStateCounts;
  candidateVerificationCounts: CandidatePublicationPolicyCounts;
  metadata: CandidateVerificationPublicationEvidenceMetadataSummary;
  redactionFlags: CandidateVerificationPublicationEvidenceRedactionFlags;
};

type MutableCandidatePublicationPolicyCounts = {
  -readonly [K in keyof CandidatePublicationPolicyCounts]: CandidatePublicationPolicyCounts[K];
};

type MutableCandidateVerificationPublicationEvidenceRedactionFlags = {
  -readonly [K in keyof CandidateVerificationPublicationEvidenceRedactionFlags]: CandidateVerificationPublicationEvidenceRedactionFlags[K];
};

export type CandidateVerificationPublicationEvidenceSink = (
  summary: CandidateVerificationPublicationEvidenceSummary,
  event: CandidateVerificationPublicationEvidenceEvent,
) => void;

const MAX_REASON_CATEGORIES = 12;
const MAX_METADATA_VALUE_LENGTH = 256;

const DEFAULT_REASON_CATEGORIES: readonly CandidatePublicationPolicyReasonCategory[] = [
  "classifier-fail-closed",
  "publication-ineligible",
];

function emptyPolicyCounts(): CandidatePublicationPolicyCounts {
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
  };
}

function emptyRedactionFlags(): CandidateVerificationPublicationEvidenceRedactionFlags {
  return {
    privateOnly: true,
    candidateBodiesIncluded: false,
    specialistProseIncluded: false,
    rawPromptsIncluded: false,
    rawModelOutputIncluded: false,
    diffsIncluded: false,
    evidencePayloadsIncluded: false,
    rawFingerprintsIncluded: false,
    unsafeInputFieldCount: 0,
    discardedRawPayload: false,
    discardedPublicationFields: false,
    discardedEvidencePayloads: false,
    candidateAttemptIncluded: false,
    candidateKeyIncluded: false,
    publicationEvidenceIncluded: false,
  };
}

export function initialCandidateVerificationPublicationEvidenceSummary(): CandidateVerificationPublicationEvidenceSummary {
  return {
    aggregateStatus: "none",
    counts: { attempted: 0, allowed: 0, denied: 0, published: 0, skipped: 0, failed: 0 },
    publicationDenialCounts: {},
    reasonCategories: [],
    verificationStateCounts: { verified: 0, partially_verified: 0, unverified: 0, disproven: 0, unavailable: 0 },
    candidateVerificationCounts: emptyPolicyCounts(),
    metadata: { hasDeliveryId: false, hasReviewOutputKey: false, hasCorrelationKey: false },
    redactionFlags: emptyRedactionFlags(),
  };
}

function cloneSummary(summary: CandidateVerificationPublicationEvidenceSummary): CandidateVerificationPublicationEvidenceSummary {
  return {
    aggregateStatus: summary.aggregateStatus,
    counts: { ...summary.counts },
    publicationDenialCounts: { ...summary.publicationDenialCounts },
    reasonCategories: [...summary.reasonCategories],
    verificationStateCounts: { ...summary.verificationStateCounts },
    candidateVerificationCounts: { ...summary.candidateVerificationCounts },
    metadata: { ...summary.metadata },
    redactionFlags: { ...summary.redactionFlags },
  };
}

function boundedString(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, MAX_METADATA_VALUE_LENGTH) : undefined;
}

function isPolicyResult(value: unknown): value is CandidatePublicationPolicyResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<CandidatePublicationPolicyResult>;
  return (candidate.status === "allow" || candidate.status === "deny")
    && typeof candidate.allowed === "boolean"
    && typeof candidate.counts === "object"
    && candidate.counts !== null
    && Array.isArray(candidate.reasonCategories)
    && typeof candidate.redactionFlags === "object"
    && candidate.redactionFlags !== null;
}

function failClosedPolicyResult(): Pick<CandidatePublicationPolicyResult, "verificationState" | "reasonCategories" | "counts" | "hasDeliveryId" | "hasReviewOutputKey" | "hasCorrelationKey" | "redactionFlags"> {
  return {
    verificationState: null,
    reasonCategories: DEFAULT_REASON_CATEGORIES,
    counts: { ...emptyPolicyCounts(), malformedRecordCount: 1 },
    hasDeliveryId: false,
    hasReviewOutputKey: false,
    hasCorrelationKey: false,
    redactionFlags: emptyRedactionFlags(),
  };
}

function appendReason(summary: CandidateVerificationPublicationEvidenceSummary, reason: CandidatePublicationPolicyReasonCategory): void {
  if (!summary.reasonCategories.includes(reason) && summary.reasonCategories.length < MAX_REASON_CATEGORIES) {
    summary.reasonCategories.push(reason);
  }
}

function incrementDenialReason(summary: CandidateVerificationPublicationEvidenceSummary, reason: CandidatePublicationPolicyReasonCategory): void {
  if (!(reason in summary.publicationDenialCounts) && Object.keys(summary.publicationDenialCounts).length >= MAX_REASON_CATEGORIES) {
    return;
  }
  summary.publicationDenialCounts[reason] = (summary.publicationDenialCounts[reason] ?? 0) + 1;
}

function addPolicyCounts(target: MutableCandidatePublicationPolicyCounts, source: CandidatePublicationPolicyCounts): void {
  target.candidateCount += source.candidateCount;
  target.evidenceCount += source.evidenceCount;
  target.verifiedCount += source.verifiedCount;
  target.partiallyVerifiedCount += source.partiallyVerifiedCount;
  target.unverifiedCount += source.unverifiedCount;
  target.disprovenCount += source.disprovenCount;
  target.publicationEligibleCount += source.publicationEligibleCount;
  target.duplicateCount += source.duplicateCount;
  target.disagreementCount += source.disagreementCount;
  target.unclassifiableCount += source.unclassifiableCount;
  target.malformedRecordCount += source.malformedRecordCount;
  target.truncatedCandidateCount += source.truncatedCandidateCount;
  target.truncatedEvidenceCount += source.truncatedEvidenceCount;
  target.policyCandidateCount += source.policyCandidateCount;
}

function mergeRedactionFlags(target: MutableCandidateVerificationPublicationEvidenceRedactionFlags, source: CandidatePublicationPolicyRedactionFlags): void {
  target.unsafeInputFieldCount += source.unsafeInputFieldCount;
  target.discardedRawPayload ||= source.discardedRawPayload;
  target.discardedPublicationFields ||= source.discardedPublicationFields;
  target.discardedEvidencePayloads ||= source.discardedEvidencePayloads;
}

function mergeMetadata(summary: CandidateVerificationPublicationEvidenceSummary, metadata?: CandidateVerificationPublicationMetadata, policy?: Pick<CandidatePublicationPolicyResult, "hasDeliveryId" | "hasReviewOutputKey" | "hasCorrelationKey">): void {
  const deliveryId = boundedString(metadata?.deliveryId);
  const reviewOutputKey = boundedString(metadata?.reviewOutputKey);
  const correlationKey = boundedString(metadata?.correlationKey);

  summary.metadata.hasDeliveryId ||= policy?.hasDeliveryId === true || deliveryId !== undefined;
  summary.metadata.hasReviewOutputKey ||= policy?.hasReviewOutputKey === true || reviewOutputKey !== undefined;
  summary.metadata.hasCorrelationKey ||= policy?.hasCorrelationKey === true || correlationKey !== undefined;

  if (deliveryId !== undefined) summary.metadata.deliveryId = deliveryId;
  if (reviewOutputKey !== undefined) summary.metadata.reviewOutputKey = reviewOutputKey;
  if (correlationKey !== undefined) summary.metadata.correlationKey = correlationKey;
}

function nextAggregateStatus(counts: CandidateVerificationPublicationEvidenceCounts): CandidateVerificationPublicationEvidenceSummary["aggregateStatus"] {
  const active = (["allowed", "denied", "published", "skipped", "failed"] as const).filter((key) => counts[key] > 0);
  if (active.length === 0) return "none";
  if (active.length === 1) return active[0] ?? "none";
  return "mixed";
}

function applyPolicyResult(summary: CandidateVerificationPublicationEvidenceSummary, policyResult: Pick<CandidatePublicationPolicyResult, "verificationState" | "reasonCategories" | "counts" | "redactionFlags">, denied: boolean): void {
  const verificationState = policyResult.verificationState ?? "unavailable";
  summary.verificationStateCounts[verificationState]++;
  addPolicyCounts(summary.candidateVerificationCounts, policyResult.counts);
  mergeRedactionFlags(summary.redactionFlags, policyResult.redactionFlags);
  for (const reason of policyResult.reasonCategories) {
    appendReason(summary, reason);
    if (denied) {
      incrementDenialReason(summary, reason);
    }
  }
}

export function projectCandidateVerificationPublicationEvidence(
  current: CandidateVerificationPublicationEvidenceSummary | undefined,
  event: CandidateVerificationPublicationEvidenceEvent,
): CandidateVerificationPublicationEvidenceSummary {
  const summary = cloneSummary(current ?? initialCandidateVerificationPublicationEvidenceSummary());
  const outcome = event.outcome;

  if (outcome === "allowed" || outcome === "denied") {
    summary.counts.attempted++;
    summary.counts[outcome]++;
    const policyResult = isPolicyResult(event.policyResult) ? event.policyResult : failClosedPolicyResult();
    applyPolicyResult(summary, policyResult, outcome === "denied");
    mergeMetadata(summary, event.metadata, policyResult);
  } else {
    summary.counts[outcome]++;
    mergeMetadata(summary, event.metadata);
  }

  summary.aggregateStatus = nextAggregateStatus(summary.counts);
  return summary;
}

export function createCandidateVerificationPublicationEvidenceCollector(
  sink?: CandidateVerificationPublicationEvidenceSink,
): {
  record(event: CandidateVerificationPublicationEvidenceEvent): CandidateVerificationPublicationEvidenceSummary;
  getSummary(): CandidateVerificationPublicationEvidenceSummary;
} {
  let summary = initialCandidateVerificationPublicationEvidenceSummary();
  return {
    record(event: CandidateVerificationPublicationEvidenceEvent): CandidateVerificationPublicationEvidenceSummary {
      summary = projectCandidateVerificationPublicationEvidence(summary, event);
      const snapshot = cloneSummary(summary);
      if (sink) {
        try {
          sink(cloneSummary(snapshot), event);
        } catch {
          // Evidence is diagnostic-only. Sink failures must not affect publication decisions.
        }
      }
      return snapshot;
    },
    getSummary(): CandidateVerificationPublicationEvidenceSummary {
      return cloneSummary(summary);
    },
  };
}
