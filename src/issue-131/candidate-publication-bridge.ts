import { createHash } from "node:crypto";

import {
  evaluateCandidatePublicationPolicy,
  type CandidatePublicationPolicyInput,
  type CandidatePublicationPolicyReasonCategory,
  type CandidatePublicationPolicyResult,
  type CandidatePublicationPolicyStatus,
  type CandidatePublicationPolicyRedactionFlags,
} from "../specialists/candidate-publication-policy.ts";
import type { CandidateVerificationState } from "../specialists/candidate-verification.ts";

export const CANDIDATE_PUBLICATION_BRIDGE_VERSION = "candidate-publication-bridge.v1" as const;

export type CandidatePublicationBridgeStatus = "allowed" | "denied" | "malformed";

export type CandidatePublicationBridgeReasonCategory =
  | CandidatePublicationPolicyReasonCategory
  | "policy-evaluation-failed";

export type CandidatePublicationBridgeMalformedReasonCode =
  | "missing-delivery-id"
  | "missing-review-output-key"
  | "missing-correlation-key"
  | "policy-evaluation-failed"
  | "invalid-policy-result";

export type CandidatePublicationBridgePresence = {
  readonly hasDeliveryId: boolean;
  readonly hasReviewOutputKey: boolean;
  readonly hasUpstreamCorrelationKey: boolean;
  readonly hasPolicyCorrelationKey: boolean;
};

export type CandidatePublicationBridgeCounts = {
  readonly candidateCount: number;
  readonly evidenceCount: number;
  readonly verifiedCount: number;
  readonly partiallyVerifiedCount: number;
  readonly unverifiedCount: number;
  readonly disprovenCount: number;
  readonly publicationEligibleCount: number;
  readonly duplicateCount: number;
  readonly disagreementCount: number;
  readonly unclassifiableCount: number;
  readonly malformedRecordCount: number;
  readonly truncatedCandidateCount: number;
  readonly truncatedEvidenceCount: number;
  readonly policyCandidateCount: number;
  readonly unsafeInputFieldCount: number;
};

export type CandidatePublicationBridgeRedactionFlags = CandidatePublicationPolicyRedactionFlags & {
  readonly githubCommentBodyIncluded: false;
  readonly reducerHandoffIncludesRawPayload: false;
};

export type CandidatePublicationBridgeRecord = {
  readonly bridgeVersion: typeof CANDIDATE_PUBLICATION_BRIDGE_VERSION;
  readonly recordKey: string;
  readonly correlationKey: string;
  readonly status: CandidatePublicationBridgeStatus;
  readonly sourceLabel: string;
  readonly candidateRef: string;
  readonly policyStatus: CandidatePublicationPolicyStatus;
  readonly verificationState: CandidateVerificationState | null;
  readonly presence: CandidatePublicationBridgePresence;
  readonly counts: CandidatePublicationBridgeCounts;
  readonly reasonCategories: readonly CandidatePublicationBridgeReasonCategory[];
  readonly malformedReasonCodes: readonly CandidatePublicationBridgeMalformedReasonCode[];
  readonly redactionFlags: CandidatePublicationBridgeRedactionFlags;
};

export type CandidatePublicationReducerHandoffInput = Omit<CandidatePublicationBridgeRecord, "policyStatus">;

export type CandidatePublicationPolicyEvaluator = (input: CandidatePublicationPolicyInput | null | undefined) => CandidatePublicationPolicyResult;

export type CandidatePublicationBridgeInput = {
  readonly sourceLabel?: unknown;
  readonly upstreamCorrelationKey?: unknown;
  readonly candidateMetadata?: unknown;
  readonly candidatePolicyInput?: CandidatePublicationPolicyInput | null;
  readonly policyResult?: CandidatePublicationPolicyResult | null;
  readonly evaluatePolicy?: CandidatePublicationPolicyEvaluator;
};

type UnsafeFieldDetection = {
  unsafeInputFieldCount: number;
  discardedRawPayload: boolean;
  discardedPublicationFields: boolean;
  discardedEvidencePayloads: boolean;
};

const MAX_SAFE_STRING_LENGTH = 256;
const MAX_LABEL_LENGTH = 80;
const MAX_REASON_CATEGORIES = 12;
const MAX_REASON_LENGTH = 80;
const MAX_COUNT = 10_000;

const RAW_PAYLOAD_KEYS = new Set(["prompt", "rawPrompt", "systemPrompt", "modelOutput", "modelText", "rawModelOutput", "toolPayload", "toolResult", "toolResults", "messages"]);
const PUBLICATION_KEYS = new Set(["body", "commentBody", "githubCommentBody", "inlineComment", "inlineComments", "suggestion", "finding", "findings", "specialistProse", "prose"]);
const EVIDENCE_PAYLOAD_KEYS = new Set(["diff", "patch", "fingerprint", "rawFingerprint", "payload", "evidencePayload", "rawEvidence"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maxLength = MAX_SAFE_STRING_LENGTH): string | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function clampCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.min(MAX_COUNT, Math.max(0, Math.trunc(value)));
}

function appendUnique<T>(values: T[], value: T): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}

function detectUnsafeFields(value: unknown): UnsafeFieldDetection {
  const flags: UnsafeFieldDetection = {
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

function emptyCounts(overrides: Partial<CandidatePublicationBridgeCounts> = {}): CandidatePublicationBridgeCounts {
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
    unsafeInputFieldCount: 0,
    ...overrides,
  };
}

function emptyPolicyRedactionFlags(): CandidatePublicationPolicyRedactionFlags {
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
  };
}

function normalizeCounts(policyResult: CandidatePublicationPolicyResult, unsafeInputFieldCount: number): CandidatePublicationBridgeCounts {
  return {
    candidateCount: clampCount(policyResult.counts.candidateCount),
    evidenceCount: clampCount(policyResult.counts.evidenceCount),
    verifiedCount: clampCount(policyResult.counts.verifiedCount),
    partiallyVerifiedCount: clampCount(policyResult.counts.partiallyVerifiedCount),
    unverifiedCount: clampCount(policyResult.counts.unverifiedCount),
    disprovenCount: clampCount(policyResult.counts.disprovenCount),
    publicationEligibleCount: clampCount(policyResult.counts.publicationEligibleCount),
    duplicateCount: clampCount(policyResult.counts.duplicateCount),
    disagreementCount: clampCount(policyResult.counts.disagreementCount),
    unclassifiableCount: clampCount(policyResult.counts.unclassifiableCount),
    malformedRecordCount: clampCount(policyResult.counts.malformedRecordCount),
    truncatedCandidateCount: clampCount(policyResult.counts.truncatedCandidateCount),
    truncatedEvidenceCount: clampCount(policyResult.counts.truncatedEvidenceCount),
    policyCandidateCount: clampCount(policyResult.counts.policyCandidateCount),
    unsafeInputFieldCount: clampCount(unsafeInputFieldCount),
  };
}

function normalizeReasonCategories(values: readonly unknown[]): CandidatePublicationBridgeReasonCategory[] {
  const reasons: CandidatePublicationBridgeReasonCategory[] = [];
  for (const value of values) {
    const reason = boundedString(value, MAX_REASON_LENGTH) as CandidatePublicationBridgeReasonCategory | null;
    if (reason) appendUnique(reasons, reason);
    if (reasons.length >= MAX_REASON_CATEGORIES) break;
  }
  return reasons;
}

function resolvePolicyResult(input: CandidatePublicationBridgeInput): {
  policyResult: CandidatePublicationPolicyResult;
  evaluationFailed: boolean;
  invalidPolicyResult: boolean;
} {
  if (isPolicyResult(input.policyResult)) {
    return { policyResult: input.policyResult, evaluationFailed: false, invalidPolicyResult: false };
  }
  if (input.policyResult !== undefined && input.policyResult !== null) {
    return { policyResult: failClosedPolicyResult(), evaluationFailed: false, invalidPolicyResult: true };
  }

  try {
    const evaluator = input.evaluatePolicy ?? evaluateCandidatePublicationPolicy;
    const policyResult = evaluator(input.candidatePolicyInput);
    if (!isPolicyResult(policyResult)) {
      return { policyResult: failClosedPolicyResult(), evaluationFailed: false, invalidPolicyResult: true };
    }
    return { policyResult, evaluationFailed: false, invalidPolicyResult: false };
  } catch {
    return { policyResult: failClosedPolicyResult(), evaluationFailed: true, invalidPolicyResult: false };
  }
}

function isPolicyResult(value: unknown): value is CandidatePublicationPolicyResult {
  if (!isRecord(value)) return false;
  return typeof value.allowed === "boolean"
    && (value.status === "allow" || value.status === "deny")
    && typeof value.candidateRef === "string"
    && (value.verificationState === null || value.verificationState === "verified" || value.verificationState === "partially_verified" || value.verificationState === "unverified" || value.verificationState === "disproven")
    && Array.isArray(value.reasonCategories)
    && isRecord(value.counts)
    && typeof value.hasDeliveryId === "boolean"
    && typeof value.hasReviewOutputKey === "boolean"
    && typeof value.hasCorrelationKey === "boolean"
    && isRecord(value.redactionFlags);
}

function failClosedPolicyResult(): CandidatePublicationPolicyResult {
  return {
    allowed: false,
    status: "deny",
    candidateRef: "candidate-unavailable",
    verificationState: null,
    reasonCategories: ["malformed-input", "publication-ineligible"],
    counts: emptyCounts({ malformedRecordCount: 1 }),
    hasDeliveryId: false,
    hasReviewOutputKey: false,
    hasCorrelationKey: false,
    redactionFlags: emptyPolicyRedactionFlags(),
  };
}

function redactionFlags(policyFlags: CandidatePublicationPolicyRedactionFlags, unsafeFields: UnsafeFieldDetection): CandidatePublicationBridgeRedactionFlags {
  return {
    ...policyFlags,
    unsafeInputFieldCount: clampCount(policyFlags.unsafeInputFieldCount + unsafeFields.unsafeInputFieldCount),
    discardedRawPayload: policyFlags.discardedRawPayload || unsafeFields.discardedRawPayload,
    discardedPublicationFields: policyFlags.discardedPublicationFields || unsafeFields.discardedPublicationFields,
    discardedEvidencePayloads: policyFlags.discardedEvidencePayloads || unsafeFields.discardedEvidencePayloads,
    candidateAttemptIncluded: false,
    candidateKeyIncluded: false,
    githubCommentBodyIncluded: false,
    reducerHandoffIncludesRawPayload: false,
  };
}

function malformedReasonCodes(
  presence: CandidatePublicationBridgePresence,
  evaluationFailed: boolean,
  invalidPolicyResult: boolean,
): CandidatePublicationBridgeMalformedReasonCode[] {
  const reasons: CandidatePublicationBridgeMalformedReasonCode[] = [];
  if (!presence.hasDeliveryId) reasons.push("missing-delivery-id");
  if (!presence.hasReviewOutputKey) reasons.push("missing-review-output-key");
  if (!presence.hasPolicyCorrelationKey && !presence.hasUpstreamCorrelationKey) reasons.push("missing-correlation-key");
  if (evaluationFailed) reasons.push("policy-evaluation-failed");
  if (invalidPolicyResult) reasons.push("invalid-policy-result");
  return reasons;
}

function bridgeStatus(policyResult: CandidatePublicationPolicyResult, evaluationFailed: boolean, invalidPolicyResult: boolean): CandidatePublicationBridgeStatus {
  if (evaluationFailed || invalidPolicyResult || policyResult.reasonCategories.includes("malformed-input") || policyResult.counts.malformedRecordCount > 0) {
    return "malformed";
  }
  return policyResult.allowed && policyResult.status === "allow" ? "allowed" : "denied";
}

function buildKeys(input: {
  sourceLabel: string;
  status: CandidatePublicationBridgeStatus;
  candidateRef: string;
  verificationState: CandidateVerificationState | null;
  presence: CandidatePublicationBridgePresence;
  counts: CandidatePublicationBridgeCounts;
  reasonCategories: readonly CandidatePublicationBridgeReasonCategory[];
  upstreamCorrelationKey: string | null;
}): { recordKey: string; correlationKey: string } {
  const correlationMaterial = {
    bridgeVersion: CANDIDATE_PUBLICATION_BRIDGE_VERSION,
    sourceLabel: input.sourceLabel,
    candidateRef: input.candidateRef,
    upstreamCorrelationKey: input.upstreamCorrelationKey,
    presence: input.presence,
  };
  const recordMaterial = {
    ...correlationMaterial,
    status: input.status,
    verificationState: input.verificationState,
    counts: input.counts,
    reasonCategories: input.reasonCategories,
  };
  return {
    correlationKey: `candidate-publication-bridge:${hashJson(correlationMaterial).slice(0, 32)}`,
    recordKey: `candidate-publication-record:${hashJson(recordMaterial).slice(0, 32)}`,
  };
}

export function createCandidatePublicationBridgeRecord(input: CandidatePublicationBridgeInput | null | undefined): CandidatePublicationBridgeRecord {
  const safeInput = isRecord(input) ? input : {};
  const sourceLabel = boundedString(safeInput.sourceLabel, MAX_LABEL_LENGTH) ?? "candidate-publication";
  const upstreamCorrelationKey = boundedString(safeInput.upstreamCorrelationKey);
  const unsafeFields = detectUnsafeFields(safeInput.candidateMetadata);
  const { policyResult, evaluationFailed, invalidPolicyResult } = resolvePolicyResult(safeInput);
  const redactions = redactionFlags(policyResult.redactionFlags, unsafeFields);
  const counts = normalizeCounts(policyResult, redactions.unsafeInputFieldCount);
  const presence: CandidatePublicationBridgePresence = {
    hasDeliveryId: policyResult.hasDeliveryId,
    hasReviewOutputKey: policyResult.hasReviewOutputKey,
    hasUpstreamCorrelationKey: upstreamCorrelationKey !== null,
    hasPolicyCorrelationKey: policyResult.hasCorrelationKey,
  };
  const status = bridgeStatus(policyResult, evaluationFailed, invalidPolicyResult);
  const reasonCategories = normalizeReasonCategories(policyResult.reasonCategories.filter((reason) => reason !== "publication-ineligible"));
  if (evaluationFailed) appendUnique(reasonCategories, "policy-evaluation-failed");
  if (invalidPolicyResult) appendUnique(reasonCategories, "malformed-input");
  if (status !== "allowed") appendUnique(reasonCategories, "publication-ineligible");

  const malformedCodes = malformedReasonCodes(presence, evaluationFailed, invalidPolicyResult);
  const candidateRef = boundedString(policyResult.candidateRef) ?? "candidate-unavailable";
  const keys = buildKeys({
    sourceLabel,
    status,
    candidateRef,
    verificationState: policyResult.verificationState,
    presence,
    counts,
    reasonCategories,
    upstreamCorrelationKey,
  });

  return {
    bridgeVersion: CANDIDATE_PUBLICATION_BRIDGE_VERSION,
    recordKey: keys.recordKey,
    correlationKey: keys.correlationKey,
    status,
    sourceLabel,
    candidateRef,
    policyStatus: policyResult.status,
    verificationState: policyResult.verificationState,
    presence,
    counts,
    reasonCategories,
    malformedReasonCodes: malformedCodes,
    redactionFlags: redactions,
  };
}

function assertBridgeRecord(record: CandidatePublicationBridgeRecord): void {
  if (record.bridgeVersion !== CANDIDATE_PUBLICATION_BRIDGE_VERSION || !record.recordKey || !record.correlationKey || !record.sourceLabel) {
    throw new Error("candidate publication bridge record is malformed");
  }
}

export function projectCandidatePublicationReducerHandoffInput(
  record: CandidatePublicationBridgeRecord,
): CandidatePublicationReducerHandoffInput {
  assertBridgeRecord(record);
  return {
    bridgeVersion: record.bridgeVersion,
    recordKey: record.recordKey,
    correlationKey: record.correlationKey,
    sourceLabel: record.sourceLabel,
    status: record.status,
    candidateRef: record.candidateRef,
    verificationState: record.verificationState,
    presence: record.presence,
    counts: record.counts,
    reasonCategories: record.reasonCategories,
    malformedReasonCodes: record.malformedReasonCodes,
    redactionFlags: record.redactionFlags,
  };
}
