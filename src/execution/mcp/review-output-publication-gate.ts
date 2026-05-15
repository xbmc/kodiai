import type { Octokit } from "@octokit/rest";
import {
  ensureReviewOutputNotPublished,
  type ReviewOutputPublicationStatus,
} from "../../handlers/review-idempotency.ts";
import {
  evaluateCandidatePublicationPolicy,
  type CandidatePublicationPolicyAttempt,
  type CandidatePublicationPolicyInput,
  type CandidatePublicationPolicyResult,
} from "../../specialists/candidate-publication-policy.ts";
import {
  createCandidateVerificationPublicationEvidenceCollector,
  type CandidateVerificationPublicationEvidenceSink,
  type CandidateVerificationPublicationEvidenceSummary,
} from "../../specialists/candidate-verification-publication-evidence.ts";
import {
  createCandidatePublicationBridgeRecord,
  projectCandidatePublicationReducerHandoffInput,
  type CandidatePublicationBridgeRecord,
  type CandidatePublicationReducerHandoffInput,
} from "../../issue-131/candidate-publication-bridge.ts";

export type ReviewOutputInlinePublicationState =
  | { status: "none" }
  | { status: "published"; commentId?: number; path?: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string };

export type CandidateVerificationContext = {
  readonly docsConfigTruth?: CandidatePublicationPolicyInput["docsConfigTruth"];
  readonly correlationKey?: unknown;
  readonly deliveryId?: unknown;
  readonly reviewOutputKey?: unknown;
};

export type CandidatePublicationPolicy = (
  input: CandidatePublicationPolicyInput,
) => CandidatePublicationPolicyResult;

export type CandidatePublicationBridgeCaptureState =
  | { status: "none" }
  | {
    status: "captured";
    record: CandidatePublicationBridgeRecord;
    reducerHandoffInput: CandidatePublicationReducerHandoffInput;
  };

export interface ReviewOutputPublicationGate {
  resolve(octokit: Octokit): Promise<ReviewOutputPublicationStatus>;
  evaluateInlineCandidatePublication(candidate: CandidatePublicationPolicyAttempt): CandidatePublicationPolicyResult | null;
  getInlinePublicationState(): ReviewOutputInlinePublicationState;
  getCandidateVerificationPublicationEvidenceSummary(): CandidateVerificationPublicationEvidenceSummary;
  getCandidatePublicationBridgeCaptureState(): CandidatePublicationBridgeCaptureState;
  recordInlinePublicationSkipped(reason: string): void;
  recordInlinePublicationFailed(reason: string): void;
  recordInlinePublicationPublished(details?: { commentId?: number; path?: string }): void;
}

function failClosedCandidatePublicationResult(): CandidatePublicationPolicyResult {
  return {
    allowed: false,
    status: "deny",
    candidateRef: "candidate-unavailable",
    verificationState: null,
    reasonCategories: ["classifier-fail-closed", "publication-ineligible"],
    counts: {
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
      malformedRecordCount: 1,
      truncatedCandidateCount: 0,
      truncatedEvidenceCount: 0,
      policyCandidateCount: 0,
    },
    hasDeliveryId: false,
    hasReviewOutputKey: false,
    hasCorrelationKey: false,
    redactionFlags: {
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
    },
  };
}

export function createReviewOutputPublicationGate(params: {
  owner: string;
  repo: string;
  prNumber: number;
  reviewOutputKey: string;
  candidatePublicationPolicy?: CandidatePublicationPolicy;
  candidateVerificationContext?: CandidateVerificationContext;
  candidateVerificationPublicationEvidenceSink?: CandidateVerificationPublicationEvidenceSink;
}): ReviewOutputPublicationGate {
  let cachedStatus: ReviewOutputPublicationStatus | null = null;
  let inFlight: Promise<ReviewOutputPublicationStatus> | null = null;

  let inlinePublicationState: ReviewOutputInlinePublicationState = { status: "none" };

  const policy = params.candidatePublicationPolicy ?? evaluateCandidatePublicationPolicy;
  const hasCandidateVerificationContext = params.candidateVerificationContext !== undefined;
  const evidenceCollector = createCandidateVerificationPublicationEvidenceCollector(
    params.candidateVerificationPublicationEvidenceSink,
  );
  let lastInlinePolicyResult: CandidatePublicationPolicyResult | null = null;

  const evidenceMetadata = () => ({
    deliveryId: params.candidateVerificationContext?.deliveryId,
    reviewOutputKey: params.candidateVerificationContext?.reviewOutputKey ?? params.reviewOutputKey,
    correlationKey: params.candidateVerificationContext?.correlationKey,
  });

  const upstreamCorrelationKey = (candidate: CandidatePublicationPolicyAttempt): unknown => (
    candidate.correlationKey ?? params.candidateVerificationContext?.correlationKey
  );

  const candidatePolicyInput = (candidate: CandidatePublicationPolicyAttempt): CandidatePublicationPolicyInput => ({
    candidate: {
      ...candidate,
      reviewOutputKey: candidate.reviewOutputKey ?? params.candidateVerificationContext?.reviewOutputKey ?? params.reviewOutputKey,
      deliveryId: candidate.deliveryId ?? params.candidateVerificationContext?.deliveryId,
      correlationKey: candidate.correlationKey ?? params.candidateVerificationContext?.correlationKey,
    },
    docsConfigTruth: params.candidateVerificationContext?.docsConfigTruth ?? null,
  });

  let bridgeCaptureState: CandidatePublicationBridgeCaptureState = { status: "none" };

  const captureBridgeState = (
    candidate: CandidatePublicationPolicyAttempt,
    input: CandidatePublicationPolicyInput | null,
    result: CandidatePublicationPolicyResult,
  ): void => {
    const record = createCandidatePublicationBridgeRecord({
      sourceLabel: "inline-mcp-review-comment",
      upstreamCorrelationKey: upstreamCorrelationKey(candidate),
      candidateMetadata: candidate,
      candidatePolicyInput: input,
      policyResult: result,
    });
    bridgeCaptureState = {
      status: "captured",
      record,
      reducerHandoffInput: projectCandidatePublicationReducerHandoffInput(record),
    };
  };

  return {
    getInlinePublicationState(): ReviewOutputInlinePublicationState {
      return inlinePublicationState;
    },

    getCandidateVerificationPublicationEvidenceSummary(): CandidateVerificationPublicationEvidenceSummary {
      return evidenceCollector.getSummary();
    },

    getCandidatePublicationBridgeCaptureState(): CandidatePublicationBridgeCaptureState {
      return bridgeCaptureState;
    },

    evaluateInlineCandidatePublication(candidate: CandidatePublicationPolicyAttempt): CandidatePublicationPolicyResult | null {
      if (!hasCandidateVerificationContext && !params.candidatePublicationPolicy) {
        return null;
      }

      const input = candidatePolicyInput(candidate);
      try {
        const result = policy(input);
        lastInlinePolicyResult = result;
        captureBridgeState(candidate, input, result);
        evidenceCollector.record({
          outcome: result.allowed ? "allowed" : "denied",
          policyResult: result,
          metadata: evidenceMetadata(),
        });
        return result;
      } catch {
        const result = failClosedCandidatePublicationResult();
        lastInlinePolicyResult = result;
        captureBridgeState(candidate, input, result);
        evidenceCollector.record({
          outcome: "denied",
          policyResult: result,
          metadata: evidenceMetadata(),
        });
        return result;
      }
    },

    recordInlinePublicationSkipped(reason: string): void {
      inlinePublicationState = { status: "skipped", reason };
      evidenceCollector.record({
        outcome: "skipped",
        reason,
        policyResult: lastInlinePolicyResult,
        metadata: evidenceMetadata(),
      });
    },

    recordInlinePublicationFailed(reason: string): void {
      inlinePublicationState = { status: "failed", reason };
      evidenceCollector.record({
        outcome: "failed",
        reason,
        policyResult: lastInlinePolicyResult,
        metadata: evidenceMetadata(),
      });
    },

    recordInlinePublicationPublished(details?: { commentId?: number; path?: string }): void {
      inlinePublicationState = { status: "published", ...details };
      evidenceCollector.record({
        outcome: "published",
        policyResult: lastInlinePolicyResult,
        metadata: evidenceMetadata(),
      });
    },

    async resolve(octokit: Octokit): Promise<ReviewOutputPublicationStatus> {
      if (cachedStatus) {
        return cachedStatus;
      }

      if (!inFlight) {
        inFlight = ensureReviewOutputNotPublished({
          octokit,
          owner: params.owner,
          repo: params.repo,
          prNumber: params.prNumber,
          reviewOutputKey: params.reviewOutputKey,
        }).then((status) => {
          cachedStatus = status;
          return status;
        }).finally(() => {
          inFlight = null;
        });
      }

      return inFlight;
    },
  };
}
