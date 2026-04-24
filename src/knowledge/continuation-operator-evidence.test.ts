import { describe, expect, it } from "bun:test";
import { buildReviewOutputKey } from "../handlers/review-idempotency.ts";
import type {
  ContinuationFamilyStateKey,
  ContinuationFamilyStateRecord,
  KnowledgeStore,
} from "./types.ts";
import {
  buildContinuationOperatorEvidenceReport,
  resolveContinuationOperatorEvidence,
} from "./continuation-operator-evidence.ts";

function makeReviewOutputKey(deliveryId = "delivery-123"): string {
  return buildReviewOutputKey({
    installationId: 42,
    owner: "Acme",
    repo: "Repo",
    prNumber: 101,
    action: "review_requested",
    deliveryId,
    headSha: "abcdef1234567890",
  });
}

function createStore(
  state: ContinuationFamilyStateRecord | null,
  hooks?: {
    onLookup?: (key: ContinuationFamilyStateKey) => void;
  },
): Pick<KnowledgeStore, "getContinuationFamilyState"> {
  return {
    async getContinuationFamilyState(key: ContinuationFamilyStateKey): Promise<ContinuationFamilyStateRecord | null> {
      hooks?.onLookup?.(key);
      return state;
    },
  };
}

function makeCanonicalState(
  overrides: Partial<ContinuationFamilyStateRecord> = {},
): ContinuationFamilyStateRecord {
  return {
    familyKey: "acme/repo#101",
    baseReviewOutputKey: makeReviewOutputKey(),
    authoritativeAttemptId: "review-work-2",
    authoritativeAttemptOrdinal: 2,
    authoritativeOutcome: "merged",
    finalStopReason: "merged-continuation-results",
    projectionStatus: "canonical",
    supersededByAttemptId: null,
    ...overrides,
  };
}

describe("resolveContinuationOperatorEvidence", () => {
  it("derives family lookup from reviewOutputKey identity and returns canonical state", async () => {
    const reviewOutputKey = `${makeReviewOutputKey()}-retry-2`;
    const canonicalState = makeCanonicalState();
    let observedKey: ContinuationFamilyStateKey | null = null;

    const lookup = await resolveContinuationOperatorEvidence({
      reviewOutputKey,
      knowledgeStore: createStore(canonicalState, {
        onLookup: (key) => {
          observedKey = key;
        },
      }),
    });

    expect(observedKey).toEqual({
      familyKey: "acme/repo#101",
      baseReviewOutputKey: makeReviewOutputKey(),
    });
    expect(lookup.status).toBe("resolved");
    expect(lookup.baseReviewOutputKey).toBe(makeReviewOutputKey());
    expect(lookup.familyKey).toBe("acme/repo#101");
    expect(lookup.parsedReviewOutputKey?.retryAttempt).toBe(2);
    expect(lookup.parsedReviewOutputKey?.effectiveDeliveryId).toBe("delivery-123-retry-2");
    expect(lookup.canonicalState).toEqual(canonicalState);
  });

  it("returns explicit missing-canonical-row status when the derived row is absent", async () => {
    const lookup = await resolveContinuationOperatorEvidence({
      reviewOutputKey: makeReviewOutputKey(),
      knowledgeStore: createStore(null),
    });

    expect(lookup.status).toBe("missing-canonical-row");
    expect(lookup.familyKey).toBe("acme/repo#101");
    expect(lookup.baseReviewOutputKey).toBe(makeReviewOutputKey());
    expect(lookup.canonicalState).toBeNull();
    expect(lookup.detail).toContain("No canonical continuation-family row exists");
  });

  it("rejects malformed reviewOutputKey input without querying the store", async () => {
    let lookedUp = false;

    const lookup = await resolveContinuationOperatorEvidence({
      reviewOutputKey: "not-a-review-output-key",
      knowledgeStore: createStore(null, {
        onLookup: () => {
          lookedUp = true;
        },
      }),
    });

    expect(lookup.status).toBe("invalid-review-output-key");
    expect(lookup.baseReviewOutputKey).toBeNull();
    expect(lookup.familyKey).toBeNull();
    expect(lookup.parsedReviewOutputKey).toBeNull();
    expect(lookup.canonicalState).toBeNull();
    expect(lookedUp).toBeFalse();
  });
});

describe("buildContinuationOperatorEvidenceReport", () => {
  it("maps canonical rows to canonical report status", () => {
    const report = buildContinuationOperatorEvidenceReport({
      status: "resolved",
      reviewOutputKey: makeReviewOutputKey(),
      baseReviewOutputKey: makeReviewOutputKey(),
      familyKey: "acme/repo#101",
      parsedReviewOutputKey: {
        reviewOutputKey: makeReviewOutputKey(),
        baseReviewOutputKey: makeReviewOutputKey(),
        retryAttempt: null,
        installationId: 42,
        owner: "acme",
        repo: "repo",
        repoFullName: "acme/repo",
        prNumber: 101,
        action: "review_requested",
        deliveryId: "delivery-123",
        effectiveDeliveryId: "delivery-123",
        headSha: "abcdef1234567890",
      },
      canonicalState: makeCanonicalState(),
      detail: "resolved",
    });

    expect(report.status).toBe("canonical");
    expect(report.authoritativeAttemptId).toBe("review-work-2");
    expect(report.finalStopReason).toBe("merged-continuation-results");
    expect(report.projectionStatus).toBe("canonical");
    expect(report.supersededByAttemptId).toBeNull();
  });

  it("maps degraded projection rows to degraded report status while preserving canonical fields verbatim", () => {
    const canonicalState = makeCanonicalState({
      authoritativeOutcome: "blocked",
      finalStopReason: "no-follow-up",
      projectionStatus: "degraded",
    });

    const report = buildContinuationOperatorEvidenceReport({
      status: "resolved",
      reviewOutputKey: makeReviewOutputKey(),
      baseReviewOutputKey: makeReviewOutputKey(),
      familyKey: canonicalState.familyKey,
      parsedReviewOutputKey: null,
      canonicalState,
      detail: "resolved",
    });

    expect(report.status).toBe("degraded");
    expect(report.authoritativeOutcome).toBe("blocked");
    expect(report.finalStopReason).toBe("no-follow-up");
    expect(report.projectionStatus).toBe("degraded");
  });

  it("maps continuation-pending rows to pending report status", () => {
    const report = buildContinuationOperatorEvidenceReport({
      status: "resolved",
      reviewOutputKey: makeReviewOutputKey(),
      baseReviewOutputKey: makeReviewOutputKey(),
      familyKey: "acme/repo#101",
      parsedReviewOutputKey: null,
      canonicalState: makeCanonicalState({
        authoritativeOutcome: "continuation-pending",
        finalStopReason: "awaiting-continuation",
        projectionStatus: "pending",
      }),
      detail: "resolved",
    });

    expect(report.status).toBe("pending");
    expect(report.authoritativeOutcome).toBe("continuation-pending");
    expect(report.finalStopReason).toBe("awaiting-continuation");
    expect(report.projectionStatus).toBe("pending");
  });

  it("maps superseded rows to superseded report status and preserves supersession identity", () => {
    const report = buildContinuationOperatorEvidenceReport({
      status: "resolved",
      reviewOutputKey: makeReviewOutputKey(),
      baseReviewOutputKey: makeReviewOutputKey(),
      familyKey: "acme/repo#101",
      parsedReviewOutputKey: null,
      canonicalState: makeCanonicalState({
        authoritativeAttemptId: "review-work-3",
        authoritativeAttemptOrdinal: 3,
        authoritativeOutcome: "superseded",
        finalStopReason: "superseded-by-newer-attempt",
        projectionStatus: "canonical",
        supersededByAttemptId: "review-work-3",
      }),
      detail: "resolved",
    });

    expect(report.status).toBe("superseded");
    expect(report.authoritativeAttemptId).toBe("review-work-3");
    expect(report.finalStopReason).toBe("superseded-by-newer-attempt");
    expect(report.projectionStatus).toBe("canonical");
    expect(report.supersededByAttemptId).toBe("review-work-3");
  });

  it("passes through invalid lookup status without inventing canonical fields", () => {
    const report = buildContinuationOperatorEvidenceReport({
      status: "invalid-review-output-key",
      reviewOutputKey: "bad-key",
      baseReviewOutputKey: null,
      familyKey: null,
      parsedReviewOutputKey: null,
      canonicalState: null,
      detail: "bad key",
    });

    expect(report.status).toBe("invalid-review-output-key");
    expect(report.detail).toBe("bad key");
    expect(report.authoritativeAttemptId).toBeNull();
    expect(report.finalStopReason).toBeNull();
    expect(report.projectionStatus).toBeNull();
  });
});
