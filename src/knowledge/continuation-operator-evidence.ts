import { parseReviewOutputKey } from "../handlers/review-idempotency.ts";
import { buildReviewFamilyKey } from "../jobs/review-work-coordinator.ts";
import type {
  ContinuationFamilyStateRecord,
  ContinuationOperatorEvidenceLookup,
  ContinuationOperatorEvidenceReport,
  KnowledgeStore,
} from "./types.ts";

function deriveReportStatus(
  canonicalState: ContinuationFamilyStateRecord,
): ContinuationOperatorEvidenceReport["status"] {
  if (canonicalState.authoritativeOutcome === "superseded") {
    return "superseded";
  }

  if (canonicalState.authoritativeOutcome === "continuation-pending") {
    return "pending";
  }

  if (canonicalState.projectionStatus === "degraded") {
    return "degraded";
  }

  return "canonical";
}

function buildResolvedDetail(canonicalState: ContinuationFamilyStateRecord): string {
  return [
    `Resolved canonical continuation-family state with outcome=${canonicalState.authoritativeOutcome}.`,
    `projectionStatus=${canonicalState.projectionStatus}.`,
    `finalStopReason=${canonicalState.finalStopReason}.`,
  ].join(" ");
}

export async function resolveContinuationOperatorEvidence(params: {
  reviewOutputKey: string;
  knowledgeStore: Pick<KnowledgeStore, "getContinuationFamilyState">;
}): Promise<ContinuationOperatorEvidenceLookup> {
  const normalizedReviewOutputKey = params.reviewOutputKey.trim().toLowerCase();
  const parsedReviewOutputKey = parseReviewOutputKey(normalizedReviewOutputKey);

  if (!parsedReviewOutputKey) {
    return {
      status: "invalid-review-output-key",
      reviewOutputKey: normalizedReviewOutputKey,
      baseReviewOutputKey: null,
      familyKey: null,
      parsedReviewOutputKey: null,
      canonicalState: null,
      detail: "reviewOutputKey did not match the canonical review-output identity contract.",
    };
  }

  const familyKey = buildReviewFamilyKey(
    parsedReviewOutputKey.owner,
    parsedReviewOutputKey.repo,
    parsedReviewOutputKey.prNumber,
  );

  if (typeof params.knowledgeStore.getContinuationFamilyState !== "function") {
    return {
      status: "lookup-unavailable",
      reviewOutputKey: normalizedReviewOutputKey,
      baseReviewOutputKey: parsedReviewOutputKey.baseReviewOutputKey,
      familyKey,
      parsedReviewOutputKey,
      canonicalState: null,
      detail: "knowledgeStore.getContinuationFamilyState is unavailable; canonical operator lookup cannot run.",
    };
  }

  const canonicalState = await params.knowledgeStore.getContinuationFamilyState({
    familyKey,
    baseReviewOutputKey: parsedReviewOutputKey.baseReviewOutputKey,
  });

  if (!canonicalState) {
    return {
      status: "missing-canonical-row",
      reviewOutputKey: normalizedReviewOutputKey,
      baseReviewOutputKey: parsedReviewOutputKey.baseReviewOutputKey,
      familyKey,
      parsedReviewOutputKey,
      canonicalState: null,
      detail: "No canonical continuation-family row exists for the derived family/base reviewOutputKey.",
    };
  }

  return {
    status: "resolved",
    reviewOutputKey: normalizedReviewOutputKey,
    baseReviewOutputKey: parsedReviewOutputKey.baseReviewOutputKey,
    familyKey,
    parsedReviewOutputKey,
    canonicalState,
    detail: buildResolvedDetail(canonicalState),
  };
}

export function buildContinuationOperatorEvidenceReport(
  lookup: ContinuationOperatorEvidenceLookup,
): ContinuationOperatorEvidenceReport {
  const canonicalState = lookup.canonicalState;
  const parsed = lookup.parsedReviewOutputKey;

  if (!canonicalState) {
    const status = lookup.status === "resolved" ? "lookup-unavailable" : lookup.status;
    return {
      status,
      detail: lookup.detail,
      reviewOutputKey: lookup.reviewOutputKey,
      baseReviewOutputKey: lookup.baseReviewOutputKey,
      familyKey: lookup.familyKey,
      repoFullName: parsed?.repoFullName ?? null,
      prNumber: parsed?.prNumber ?? null,
      action: parsed?.action ?? null,
      deliveryId: parsed?.deliveryId ?? null,
      effectiveDeliveryId: parsed?.effectiveDeliveryId ?? null,
      retryAttempt: parsed?.retryAttempt ?? null,
      authoritativeAttemptId: null,
      authoritativeAttemptOrdinal: null,
      authoritativeOutcome: null,
      finalStopReason: null,
      projectionStatus: null,
      supersededByAttemptId: null,
    };
  }

  return {
    status: deriveReportStatus(canonicalState),
    detail: lookup.detail,
    reviewOutputKey: lookup.reviewOutputKey,
    baseReviewOutputKey: lookup.baseReviewOutputKey,
    familyKey: lookup.familyKey,
    repoFullName: parsed?.repoFullName ?? null,
    prNumber: parsed?.prNumber ?? null,
    action: parsed?.action ?? null,
    deliveryId: parsed?.deliveryId ?? null,
    effectiveDeliveryId: parsed?.effectiveDeliveryId ?? null,
    retryAttempt: parsed?.retryAttempt ?? null,
    authoritativeAttemptId: canonicalState.authoritativeAttemptId,
    authoritativeAttemptOrdinal: canonicalState.authoritativeAttemptOrdinal,
    authoritativeOutcome: canonicalState.authoritativeOutcome,
    finalStopReason: canonicalState.finalStopReason,
    projectionStatus: canonicalState.projectionStatus,
    supersededByAttemptId: canonicalState.supersededByAttemptId ?? null,
  };
}
