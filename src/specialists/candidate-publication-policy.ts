import { createHash } from "node:crypto";

import {
  classifyCandidateVerification,
  type CandidateVerificationCounts,
  type CandidateVerificationReasonCategory,
  type CandidateVerificationRedactionFlags,
  type CandidateVerificationState,
  type DocsConfigSpecialistAggregateInput,
} from "./candidate-verification.ts";

export type CandidatePublicationPolicyReasonCategory =
  | CandidateVerificationReasonCategory
  | "candidate-stale-or-nonmatching"
  | "classifier-fail-closed"
  | "not-exactly-one-candidate"
  | "publication-ineligible";

export type CandidatePublicationPolicyStatus = "allow" | "deny";

export type CandidatePublicationPolicyAttempt = {
  readonly path?: unknown;
  readonly side?: unknown;
  readonly line?: unknown;
  readonly startLine?: unknown;
  readonly body?: unknown;
  readonly deliveryId?: unknown;
  readonly reviewOutputKey?: unknown;
  readonly correlationKey?: unknown;
  readonly [key: string]: unknown;
};

export type CandidatePublicationPolicyInput = {
  readonly candidate?: CandidatePublicationPolicyAttempt | null;
  readonly docsConfigTruth?: DocsConfigSpecialistAggregateInput | null;
};

export type CandidatePublicationPolicyCounts = CandidateVerificationCounts & {
  readonly policyCandidateCount: number;
};

export type CandidatePublicationPolicyRedactionFlags = CandidateVerificationRedactionFlags & {
  readonly candidateAttemptIncluded: false;
  readonly candidateKeyIncluded: false;
};

export type CandidatePublicationPolicyResult = {
  readonly allowed: boolean;
  readonly status: CandidatePublicationPolicyStatus;
  readonly candidateRef: string;
  readonly verificationState: CandidateVerificationState | null;
  readonly reasonCategories: readonly CandidatePublicationPolicyReasonCategory[];
  readonly counts: CandidatePublicationPolicyCounts;
  readonly hasDeliveryId: boolean;
  readonly hasReviewOutputKey: boolean;
  readonly hasCorrelationKey: boolean;
  readonly redactionFlags: CandidatePublicationPolicyRedactionFlags;
};

type MutablePolicyCounts = {
  -readonly [K in keyof CandidatePublicationPolicyCounts]: CandidatePublicationPolicyCounts[K];
};

const MAX_BODY_SIGNAL_LENGTH = 4096;
const MISSING_CANDIDATE_REF = "candidate-unavailable";
const RAW_PAYLOAD_KEYS = new Set(["prompt", "rawPrompt", "systemPrompt", "modelOutput", "modelText", "rawModelOutput", "toolPayload", "toolResult", "toolResults", "messages"]);
const PUBLICATION_KEYS = new Set(["body", "commentBody", "githubCommentBody", "inlineComment", "inlineComments", "suggestion", "finding", "findings", "specialistProse", "prose"]);
const EVIDENCE_PAYLOAD_KEYS = new Set(["diff", "patch", "fingerprint", "rawFingerprint", "payload", "evidencePayload", "rawEvidence"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maxLength = 256): string | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function lineSignal(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }
  return null;
}

function hashSignal(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function bodySignal(value: unknown): string {
  const boundedBody = typeof value === "string" ? value.slice(0, MAX_BODY_SIGNAL_LENGTH) : "";
  return hashSignal(boundedBody);
}

function stableCandidateMaterial(candidate: Record<string, unknown>): string {
  const material = {
    path: boundedString(candidate.path) ?? "",
    side: boundedString(candidate.side, 32) ?? "",
    line: lineSignal(candidate.line),
    startLine: lineSignal(candidate.startLine),
    reviewOutputKey: boundedString(candidate.reviewOutputKey) ?? "",
    deliveryId: boundedString(candidate.deliveryId) ?? "",
    bodySignal: bodySignal(candidate.body),
  };
  return JSON.stringify(material);
}

function privateCandidateKey(candidate: Record<string, unknown>): string {
  return `m070-publication:${hashSignal(stableCandidateMaterial(candidate))}`;
}

function publicCandidateRef(candidateKey: string): string {
  return `candidate-${hashSignal(candidateKey).slice(0, 12)}`;
}

function appendUnique<T>(values: T[], value: T): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}

function mergeUnique<T>(target: T[], values: readonly T[]): void {
  for (const value of values) {
    appendUnique(target, value);
  }
}

function detectAttemptUnsafeFields(candidate: unknown): Pick<CandidatePublicationPolicyRedactionFlags, "unsafeInputFieldCount" | "discardedRawPayload" | "discardedPublicationFields" | "discardedEvidencePayloads"> {
  const flags = {
    unsafeInputFieldCount: 0,
    discardedRawPayload: false,
    discardedPublicationFields: false,
    discardedEvidencePayloads: false,
  };

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const entry of node) {
        visit(entry);
      }
      return;
    }
    if (!isRecord(node)) {
      return;
    }
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

  visit(candidate);
  return flags;
}

function combineRedactionFlags(
  classifierFlags: CandidateVerificationRedactionFlags,
  candidate: unknown,
): CandidatePublicationPolicyRedactionFlags {
  const attemptFlags = detectAttemptUnsafeFields(candidate);
  return {
    ...classifierFlags,
    unsafeInputFieldCount: classifierFlags.unsafeInputFieldCount + attemptFlags.unsafeInputFieldCount,
    discardedRawPayload: classifierFlags.discardedRawPayload || attemptFlags.discardedRawPayload,
    discardedPublicationFields: classifierFlags.discardedPublicationFields || attemptFlags.discardedPublicationFields,
    discardedEvidencePayloads: classifierFlags.discardedEvidencePayloads || attemptFlags.discardedEvidencePayloads,
    candidateAttemptIncluded: false,
    candidateKeyIncluded: false,
  };
}

function policyCounts(counts: CandidateVerificationCounts, policyCandidateCount: number): MutablePolicyCounts {
  return { ...counts, policyCandidateCount };
}

function emptyVerificationCounts(): CandidateVerificationCounts {
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
  };
}

function denyMalformed(candidate: unknown): CandidatePublicationPolicyResult {
  const classifier = classifyCandidateVerification({
    normalReview: { candidates: [], deliveryId: undefined, reviewOutputKey: undefined, correlationKey: undefined },
    docsConfigTruth: null,
  });
  return {
    allowed: false,
    status: "deny",
    candidateRef: MISSING_CANDIDATE_REF,
    verificationState: null,
    reasonCategories: ["malformed-input", "not-exactly-one-candidate"],
    counts: policyCounts({ ...emptyVerificationCounts(), malformedRecordCount: 1 }, 0),
    hasDeliveryId: false,
    hasReviewOutputKey: false,
    hasCorrelationKey: false,
    redactionFlags: combineRedactionFlags(classifier.redactionFlags, candidate),
  };
}

export function evaluateCandidatePublicationPolicy(
  input: CandidatePublicationPolicyInput | null | undefined,
): CandidatePublicationPolicyResult {
  const candidate = isRecord(input) ? input.candidate : null;
  if (!isRecord(candidate)) {
    return denyMalformed(candidate);
  }

  const candidateKey = privateCandidateKey(candidate);
  const classifier = classifyCandidateVerification({
    normalReview: {
      candidates: [{ candidateKey }],
      deliveryId: boundedString(candidate.deliveryId),
      reviewOutputKey: boundedString(candidate.reviewOutputKey),
      correlationKey: boundedString(candidate.correlationKey),
    },
    docsConfigTruth: isRecord(input?.docsConfigTruth) ? input.docsConfigTruth : null,
  });

  const classifierCandidate = classifier.candidates[0];
  const reasons: CandidatePublicationPolicyReasonCategory[] = [];
  mergeUnique(reasons, classifier.reasonCategories);
  if (classifierCandidate) {
    mergeUnique(reasons, classifierCandidate.reasonCategories);
  }

  if (classifier.status !== "pass") {
    appendUnique(reasons, "classifier-fail-closed");
  }
  if (classifier.counts.candidateCount !== 1 || classifier.candidates.length !== 1) {
    appendUnique(reasons, "not-exactly-one-candidate");
  }
  if (!classifierCandidate?.publicationEligible) {
    appendUnique(reasons, "publication-ineligible");
  }
  if (classifier.counts.evidenceCount > 0 && classifierCandidate?.evidenceCount === 0) {
    appendUnique(reasons, "candidate-stale-or-nonmatching");
  }

  const hasUnsafeAggregate = classifier.counts.duplicateCount > 0
    || classifier.counts.disagreementCount > 0
    || classifier.counts.unclassifiableCount > 0
    || classifier.counts.malformedRecordCount > 0
    || classifier.counts.truncatedCandidateCount > 0
    || classifier.counts.truncatedEvidenceCount > 0
    || classifier.counts.disprovenCount > 0;
  if (hasUnsafeAggregate) {
    appendUnique(reasons, "publication-ineligible");
  }

  const allowed = classifier.status === "pass"
    && classifier.counts.candidateCount === 1
    && classifier.counts.publicationEligibleCount === 1
    && !hasUnsafeAggregate
    && (classifierCandidate?.verificationState === "verified" || classifierCandidate?.verificationState === "partially_verified")
    && classifierCandidate.publicationEligible === true;

  if (!allowed && reasons.length === 0) {
    appendUnique(reasons, "publication-ineligible");
  }

  return {
    allowed,
    status: allowed ? "allow" : "deny",
    candidateRef: publicCandidateRef(candidateKey),
    verificationState: classifierCandidate?.verificationState ?? null,
    reasonCategories: reasons,
    counts: policyCounts(classifier.counts, 1),
    hasDeliveryId: classifier.hasDeliveryId,
    hasReviewOutputKey: classifier.hasReviewOutputKey,
    hasCorrelationKey: classifier.hasCorrelationKey,
    redactionFlags: combineRedactionFlags(classifier.redactionFlags, candidate),
  };
}
