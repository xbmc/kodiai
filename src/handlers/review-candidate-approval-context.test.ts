import { describe, expect, test } from "bun:test";
import type { Logger } from "pino";
import type { ReviewCandidateApprovalResult } from "../review-orchestration/review-candidate-approval.ts";
import type { ReviewCandidatePublicationAdapterResult } from "../review-orchestration/review-candidate-publication-adapter.ts";
import type { ReviewCandidateFindingExecutionResult } from "../review-orchestration/review-candidate-finding.ts";
import type { ReviewReducerResult } from "../review-orchestration/review-reducer.ts";
import { resolveReviewCandidateApprovalContext } from "./review-candidate-approval-context.ts";

function makeCandidates(overrides: Partial<ReviewCandidateFindingExecutionResult> = {}): ReviewCandidateFindingExecutionResult {
  return {
    status: "unavailable",
    repo: "xbmc/kodiai",
    pullNumber: 42,
    reviewOutputKey: "review-output-1",
    deliveryId: "delivery-1",
    artifactPresent: false,
    findings: [],
    rejections: [],
    counts: { input: 0, recorded: 0, rejected: 0, errors: 0 },
    ...overrides,
  };
}

function makeReducer(): ReviewReducerResult {
  return {
    status: "ready",
    findings: [],
    visibleFindings: [],
    filteredInlineFindings: [],
    lowConfidenceFindings: [],
    suppressionMatchCounts: new Map(),
    filterRecords: [],
    counts: {
      input: 0,
      kept: 0,
      suppressed: 0,
      rewritten: 0,
      deprioritized: 0,
      lowConfidence: 0,
      auditEvents: 0,
      severityDemoted: 0,
      graphValidated: 0,
      graphUncertain: 0,
    },
    audit: [],
    detailsSummary: {
      label: "Review reducer",
      text: "ready",
      status: "ready",
    },
  };
}

function makeApproval(): ReviewCandidateApprovalResult {
  return {
    outcomes: [],
    approvedCandidates: [],
    rewrittenCandidates: [],
    counts: {
      input: 0,
      approved: 0,
      rewritten: 0,
      suppressed: 0,
      deduped: 0,
      rejected: 0,
      fallbackDisallowed: 0,
      auditEvents: 0,
    },
    audit: [],
    detailsSummary: {
      label: "Review candidate approval",
      text: "approval",
    },
  };
}

function makeAdapter(): ReviewCandidatePublicationAdapterResult {
  return {
    payloads: [],
    summary: {
      counts: {
        input: 0,
        publishable: 0,
        skipped: 0,
        approved: 0,
        rewritten: 0,
      },
      skipped: [],
      fingerprints: [],
      fixEligibility: {
        schema: "same-pr-fix-eligibility.v1",
        status: "empty",
        counts: {
          input: 0,
          eligible: 0,
          blocked: 0,
          omitted: 0,
          capped: 0,
        },
        reasonCounts: {},
        omittedReasonCounts: {},
        redaction: {
          privateOnly: true,
          rawPromptsIncluded: false,
          rawModelOutputIncluded: false,
          candidateBodiesIncluded: false,
          toolPayloadsIncluded: false,
          diffsIncluded: false,
          unboundedDiffsIncluded: false,
          secretDetected: false,
        },
      },
      fixOutcomes: [],
      detailsOnlyFindings: [],
      movedToDetails: {
        counts: {
          total: 0,
          fromFixEligibility: 0,
          fromPublisherResult: 0,
          omitted: 0,
        },
        reasonCounts: {},
        redaction: {
          rawCandidatePayloadsIncluded: false,
          rawPromptsIncluded: false,
          rawModelOutputIncluded: false,
          diffsIncluded: false,
          replacementTextIncluded: false,
          githubResponsePayloadsIncluded: false,
          secretLikeValuesIncluded: false,
          bounded: true,
        },
      },
    },
  };
}

describe("resolveReviewCandidateApprovalContext", () => {
  test("allows direct fallback when candidate capture is unavailable and direct output was attempted", () => {
    const coordinateCalls: unknown[] = [];
    const adaptCalls: unknown[] = [];
    const approval = makeApproval();
    const adapter = makeAdapter();

    const context = resolveReviewCandidateApprovalContext({
      candidates: makeCandidates({ status: "unavailable" }),
      reducer: makeReducer(),
      resultPublished: true,
      extractedFindingCount: 0,
      minConfidence: 75,
      prDiffText: "diff --git a/src/example.ts b/src/example.ts",
      maxFixSuggestions: 4,
      logger: {} as Logger,
      coordinateApproval: (input) => {
        coordinateCalls.push(input);
        return approval;
      },
      adaptForPublication: (input) => {
        adaptCalls.push(input);
        return adapter;
      },
    });

    expect(context.directFallbackAllowed).toBe(true);
    expect(context.directPublicationAttempted).toBe(true);
    expect(context.approval).toBe(approval);
    expect(context.publicationAdapter).toBe(adapter);
    expect(coordinateCalls[0]).toMatchObject({
      fallbackPolicy: {
        allowDirectFallback: true,
        attemptedDirectFallback: true,
      },
      minConfidence: 75,
    });
    expect(adaptCalls[0]).toMatchObject({
      approval,
      prDiffText: "diff --git a/src/example.ts b/src/example.ts",
      maxFixSuggestions: 4,
    });
  });

  test("disallows direct fallback when shadow capture recorded candidates and direct output was quiet", () => {
    const coordinateCalls: unknown[] = [];

    const context = resolveReviewCandidateApprovalContext({
      candidates: makeCandidates({
        status: "shadow",
        counts: { input: 1, recorded: 1, rejected: 0, errors: 0 },
      }),
      reducer: makeReducer(),
      resultPublished: false,
      extractedFindingCount: 0,
      minConfidence: 50,
      prDiffText: null,
      maxFixSuggestions: undefined,
      logger: {} as Logger,
      coordinateApproval: (input) => {
        coordinateCalls.push(input);
        return makeApproval();
      },
      adaptForPublication: () => makeAdapter(),
    });

    expect(context.directFallbackAllowed).toBe(false);
    expect(context.directPublicationAttempted).toBe(false);
    expect(coordinateCalls[0]).toMatchObject({
      fallbackPolicy: {
        allowDirectFallback: false,
        attemptedDirectFallback: false,
      },
    });
  });
});
