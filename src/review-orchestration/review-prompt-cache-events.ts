import type { ReviewCacheEventRecord } from "../telemetry/types.ts";
import type { RetrieveResult } from "../knowledge/retrieval.ts";

export type ReviewPromptCacheState = {
  status: ReviewCacheEventRecord["status"];
  reason: string | null;
  fingerprintVersion?: string;
  safetySignalNames?: string[];
  missingSignalNames?: string[];
  invalidationSignalNames?: string[];
  bookkeepingErrorCount?: number;
};

export const REVIEW_PROMPT_FINGERPRINT_VERSION = "review-prompt-v1";
export const RETRIEVAL_EMBEDDING_FINGERPRINT_VERSION = "retrieval-query-embedding-v1";

const BOUNDED_REVIEW_CACHE_SIGNAL_NAME = /^[a-z0-9][a-z0-9.-]{0,79}$/;

export function normalizeReviewCacheSignalNames(values: readonly string[] | undefined): string[] | undefined {
  if (!values || values.length === 0) return undefined;
  const normalized = Array.from(new Set(
    values
      .map((value) => value.trim().toLowerCase())
      .filter((value) => BOUNDED_REVIEW_CACHE_SIGNAL_NAME.test(value)),
  )).sort((a, b) => a.localeCompare(b));
  return normalized.length > 0 ? normalized : undefined;
}

export function mapReviewPromptCacheReason(state: ReviewPromptCacheState): ReviewCacheEventRecord["reason"] {
  if (state.status === "hit") return "safe-reuse";
  if (state.status === "miss") return "cache-miss";
  if (state.status === "bypass") {
    return state.reason === "disabled-cache" ? "disabled-cache" : "incomplete-fingerprint";
  }
  if (state.status === "degraded") return "bookkeeping-failure";
  return undefined;
}

export function buildPromptReviewCacheEvent(params: {
  deliveryId: string;
  repo: string;
  prNumber: number;
  state: ReviewPromptCacheState;
}): ReviewCacheEventRecord {
  const reason = mapReviewPromptCacheReason(params.state);
  return {
    deliveryId: params.deliveryId,
    repo: params.repo,
    prNumber: params.prNumber,
    cacheSurface: "review-derived-prompt",
    status: params.state.status,
    ...(reason ? { reason } : {}),
    ...(params.state.fingerprintVersion ? { fingerprintVersion: params.state.fingerprintVersion } : {}),
    ...(normalizeReviewCacheSignalNames(params.state.safetySignalNames) ? { safetySignalNames: normalizeReviewCacheSignalNames(params.state.safetySignalNames) } : {}),
    ...(normalizeReviewCacheSignalNames(params.state.missingSignalNames) ? { missingSignalNames: normalizeReviewCacheSignalNames(params.state.missingSignalNames) } : {}),
    ...(normalizeReviewCacheSignalNames(params.state.invalidationSignalNames) ? { invalidationSignalNames: normalizeReviewCacheSignalNames(params.state.invalidationSignalNames) } : {}),
    ...(params.state.bookkeepingErrorCount ? { bookkeepingErrorCount: params.state.bookkeepingErrorCount } : {}),
  };
}

export function buildRetrievalReviewCacheEvent(params: {
  deliveryId: string;
  repo: string;
  prNumber: number;
  result: RetrieveResult | null | undefined;
}): ReviewCacheEventRecord {
  const provenance = params.result?.provenance;
  if (
    !params.result
    || !provenance
    || !Number.isFinite(provenance.embeddingRequests)
    || !Number.isFinite(provenance.embeddingCacheHits)
  ) {
    return {
      deliveryId: params.deliveryId,
      repo: params.repo,
      prNumber: params.prNumber,
      cacheSurface: "retrieval-query-embedding",
      status: "degraded",
      reason: "unavailable-retrieval",
      missingSignalNames: ["retrieval-provenance"],
    };
  }

  if (provenance.embeddingCacheHits > 0) {
    return {
      deliveryId: params.deliveryId,
      repo: params.repo,
      prNumber: params.prNumber,
      cacheSurface: "retrieval-query-embedding",
      status: "hit",
      reason: "safe-reuse",
      fingerprintVersion: RETRIEVAL_EMBEDDING_FINGERPRINT_VERSION,
      safetySignalNames: ["embedding-cache-provenance"],
    };
  }

  return {
    deliveryId: params.deliveryId,
    repo: params.repo,
    prNumber: params.prNumber,
    cacheSurface: "retrieval-query-embedding",
    status: "miss",
    reason: "cache-miss",
    fingerprintVersion: RETRIEVAL_EMBEDDING_FINGERPRINT_VERSION,
    safetySignalNames: ["embedding-cache-provenance"],
  };
}
