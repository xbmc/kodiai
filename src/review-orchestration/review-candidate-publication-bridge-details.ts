import type { CandidateVerificationState } from "../specialists/candidate-verification.ts";

export type ReviewHandlerPublicationBridgeReviewDetails = {
  readonly bridgeVersion: string;
  readonly bridgeId: string;
  readonly recordKey: string;
  readonly correlationKey: string;
  readonly status: "allowed" | "denied" | "malformed" | "unavailable";
  readonly sourceLabel: string;
  readonly candidateRef: string;
  readonly verificationState: CandidateVerificationState | null;
  readonly reducerHandoffAvailable: boolean;
  readonly counts: {
    readonly candidateCount: number;
    readonly evidenceCount: number;
    readonly verifiedCount: number;
    readonly partiallyVerifiedCount: number;
    readonly unverifiedCount: number;
    readonly disprovenCount: number;
    readonly publicationEligibleCount: number;
    readonly malformedRecordCount: number;
    readonly unsafeInputFieldCount: number;
  };
  readonly presence: {
    readonly hasDeliveryId: boolean;
    readonly hasReviewOutputKey: boolean;
    readonly hasUpstreamCorrelationKey: boolean;
    readonly hasPolicyCorrelationKey: boolean;
  };
  readonly reasonCategories: readonly string[];
  readonly malformedReasonCodes: readonly string[];
  readonly redaction: {
    readonly privateOnly: true;
    readonly rawPayloadsIncluded: false;
    readonly publicationFieldsIncluded: false;
    readonly evidencePayloadsIncluded: false;
    readonly githubCommentBodyIncluded: false;
    readonly reducerHandoffIncludesRawPayload: false;
    readonly discardedRawPayload: boolean;
    readonly discardedPublicationFields: boolean;
    readonly discardedEvidencePayloads: boolean;
  };
};
