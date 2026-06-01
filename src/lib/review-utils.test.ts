import { describe, it, expect } from "bun:test";
import { formatReviewDetailsSummary } from "./review-details-formatting.ts";
import type { ReviewFirstPassPayload } from "./review-first-pass.ts";
import { projectContributorExperienceContract } from "../contributor/experience-contract.ts";
import type { ReviewPlanDetailsSummary } from "../review-orchestration/review-plan.ts";
import type { ReviewReducerDetailsSummary } from "../review-orchestration/review-reducer.ts";
import type { ReviewCandidateFindingDetailsSummary } from "../review-orchestration/review-candidate-finding.ts";
import type { ReviewCandidatePublicationRuntimeDetailsSummary } from "../review-orchestration/review-candidate-publication-runtime.ts";

const BOUNDED_TIMEOUT_FIRST_PASS: ReviewFirstPassPayload = {
  state: "bounded-first-pass",
  boundedReason: "timeout",
  evidenceSource: "checkpoint",
  coveredScope: { reviewedFiles: 1, totalFiles: 3 },
  remainingScope: { remainingFiles: 2, totalFiles: 3 },
  findingCount: 2,
  publication: { eligible: true, hasPublishedOutput: false },
  continuationPending: true,
  zeroEvidenceFailure: false,
};

const BASE_PARAMS = {
  reviewOutputKey: "test-key-001",
  filesReviewed: 3,
  linesAdded: 50,
  linesRemoved: 10,
  findingCounts: { critical: 0, major: 1, medium: 2, minor: 0 },
  profileSelection: {
    selectedProfile: "balanced" as const,
    source: "auto" as const,
    linesChanged: 60,
    autoBand: null,
  },
  contributorExperience: projectContributorExperienceContract({
    source: "author-cache",
    tier: "regular",
  }).reviewDetails,
};

function reviewPlanLineCount(body: string): number {
  return body.split("\n").filter((line) => line.includes("Review plan:")).length;
}

function reviewReducerLineCount(body: string): number {
  return body.split("\n").filter((line) => line.includes("Review reducer:")).length;
}

function reviewCandidateLineCount(body: string): number {
  return body.split("\n").filter((line) => line.includes("Review candidates:")).length;
}

function reviewCandidatePublicationLineCount(body: string): number {
  return body.split("\n").filter((line) => line.includes("Review candidate publication:")).length;
}

function reviewFindingLifecycleLineCount(body: string): number {
  return body.split("\n").filter((line) => line.includes("Review finding lifecycle:")).length;
}

function reviewValidationTruthLineCount(body: string): number {
  return body.split("\n").filter((line) => line.includes("Review validation truth:")).length;
}

function candidatePublicationSummary(input: {
  mode?: ReviewCandidatePublicationRuntimeDetailsSummary["mode"];
  counts?: Partial<ReviewCandidatePublicationRuntimeDetailsSummary["counts"]>;
  reasons?: readonly string[];
  text?: string;
} = {}): ReviewCandidatePublicationRuntimeDetailsSummary {
  const counts: ReviewCandidatePublicationRuntimeDetailsSummary["counts"] = {
    approvedReferences: 0,
    rewrittenReferences: 0,
    candidatePublishable: 0,
    candidatePublished: 0,
    candidateSkipped: 0,
    candidateBlocked: 0,
    candidateFailed: 0,
    candidateMalformed: 0,
    candidateMovedToDetails: 0,
    candidateDetailsOnlyFindings: 0,
    candidateDetailsOnlyOmitted: 0,
    fixEligibilityBlocked: 0,
    nonPublishableReferences: 0,
    convertedProcessedFindings: 0,
    directAttempted: 0,
    directPublished: 0,
    fallbackEvidence: 0,
    fallbackDisallowed: 0,
    malformed: 0,
    ...input.counts,
  };
  return {
    label: "Review candidate publication runtime",
    text: input.text ?? "Review candidate publication runtime: typed-public-summary",
    mode: input.mode ?? "degraded",
    counts,
    reasons: (input.reasons ?? []) as ReviewCandidatePublicationRuntimeDetailsSummary["reasons"],
  };
}

describe("formatReviewDetailsSummary", () => {
  it("renders bounded doctrine counts in structured review plan details without raw canaries", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      reviewPlan: {
        label: "Review plan",
        status: "ready",
        hash: "abcdef1234567890",
        text: "Review plan: ready hash=abcdef123456 route=standard task=review.full files=2 lines=20(local-diff) budget=na/900s gates=1/2 publish=inline+summary graph=enabled candidates=shadow doctrine=applied/3/2/1 reasons=redaction-applied +1 omitted",
      },
    });

    expect(result).toContain("doctrine=applied/3/2/1 reasons=redaction-applied");
    expect(result).toContain("+1 omitted");
    expect(result).not.toContain("TOKEN=abc123");
    expect(result).not.toContain("diff --git");
    expect(result).not.toContain("PROMPT_SECRET");
  });

  it("renders exactly one compact ready review plan line without dumping structured plan data", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      reviewPlan: {
        label: "Review plan",
        status: "ready",
        hash: "abcdef1234567890",
        text: "Review plan: ready hash=abcdef123456 route=standard task=review.full files=4 lines=212(local-diff) budget=na/900s gates=1/2 publish=inline+summary graph=enabled candidates=shadow",
      } satisfies ReviewPlanDetailsSummary,
    });

    expect(reviewPlanLineCount(result)).toBe(1);
    expect(result).toContain("- Review plan: ready hash=abcdef123456 route=standard task=review.full files=4 lines=212(local-diff) budget=na/900s gates=1/2 publish=inline+summary graph=enabled candidates=shadow");
    expect(result).not.toContain("{\"");
    expect(result).not.toContain("routing:");
    expect(result).not.toContain("diff --git");
    expect(result).not.toContain("prompt text");
  });

  it("renders exactly one compact degraded review plan line without throwing on missing hash or unknown projection fields", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      reviewPlan: {
        label: "Review plan",
        status: "degraded",
        text: "Review plan: degraded route=unknown reason=builder-error graph=skipped candidates=unavailable",
        routing: { prompt: "prompt text", diff: "diff --git a/secret b/secret" },
      } as never,
    });

    expect(reviewPlanLineCount(result)).toBe(1);
    expect(result).toContain("- Review plan: degraded route=unknown reason=builder-error graph=skipped candidates=unavailable");
    expect(result).not.toContain("{\"");
    expect(result).not.toContain("routing:");
    expect(result).not.toContain("diff --git");
    expect(result).not.toContain("prompt text");
  });

  it("preserves no-plan Review Details output and marker placement when reviewPlan is omitted", () => {
    const completedAt = "2026-04-22T20:15:00.000Z";
    const result = formatReviewDetailsSummary({ ...BASE_PARAMS, completedAt });

    expect(reviewPlanLineCount(result)).toBe(0);
    expect(result).not.toContain("Review plan:");
    expect(result).toContain("- Review completed: 2026-04-22T20:15:00.000Z");
    expect(result).toContain("\n\n</details>\n\n<!-- kodiai:review-details:test-key-001 -->");
  });

  it("renders exactly one compact review reducer line next to the review plan line", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      reviewPlan: {
        label: "Review plan",
        status: "ready",
        hash: "abcdef1234567890",
        text: "Review plan: ready hash=abcdef123456 route=standard task=review.full files=4 lines=212(local-diff) budget=na/900s gates=1/2 publish=inline+summary graph=enabled candidates=shadow",
      } satisfies ReviewPlanDetailsSummary,
      reviewReducer: {
        label: "Review reducer",
        status: "ready",
        text: "Review reducer: ready input=2 kept=1 suppressed=1 rewritten=0 deprioritized=0 lowConfidence=0 auditEvents=1 severityDemoted=0 graphValidated=1 graphUncertain=0",
      } satisfies ReviewReducerDetailsSummary,
    });

    expect(reviewPlanLineCount(result)).toBe(1);
    expect(reviewReducerLineCount(result)).toBe(1);
    expect(result.indexOf("Review plan:")).toBeLessThan(result.indexOf("Review reducer:"));
    expect(result).toContain("- Review reducer: ready input=2 kept=1 suppressed=1 rewritten=0 deprioritized=0 lowConfidence=0 auditEvents=1 severityDemoted=0 graphValidated=1 graphUncertain=0");
    expect(result).not.toContain("diff --git");
    expect(result).not.toContain("prompt text");
  });

  it("renders exactly one compact review candidate line after plan and reducer lines", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      reviewPlan: {
        label: "Review plan",
        status: "ready",
        hash: "abcdef1234567890",
        text: "Review plan: ready hash=abcdef123456 route=standard task=review.full files=4 lines=212(local-diff) budget=na/900s gates=1/2 publish=inline+summary graph=enabled candidates=shadow",
      } satisfies ReviewPlanDetailsSummary,
      reviewReducer: {
        label: "Review reducer",
        status: "ready",
        text: "Review reducer: ready input=2 kept=1 suppressed=1 rewritten=0 deprioritized=0 lowConfidence=0 auditEvents=1 severityDemoted=0 graphValidated=1 graphUncertain=0",
      } satisfies ReviewReducerDetailsSummary,
      reviewCandidateFinding: {
        label: "Review candidates",
        status: "shadow",
        text: "Review candidates: shadow recorded=1 rejected=0 errors=0 artifact=present repo=owner-repo pr=42 key=review-output-abc123 delivery=delivery-001",
      } satisfies ReviewCandidateFindingDetailsSummary,
    });

    expect(reviewCandidateLineCount(result)).toBe(1);
    expect(result.indexOf("Review plan:")).toBeLessThan(result.indexOf("Review reducer:"));
    expect(result.indexOf("Review reducer:")).toBeLessThan(result.indexOf("Review candidates:"));
    expect(result).toContain("- Review candidates: shadow recorded=1 rejected=0 errors=0 artifact=present repo=owner-repo pr=42 key=review-output-abc123 delivery=delivery-001");
  });

  it("omits candidate metadata when omitted or malformed without breaking Review Details", () => {
    const omitted = formatReviewDetailsSummary({ ...BASE_PARAMS });
    const malformed = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      reviewCandidateFinding: {
        label: "Review candidates",
        status: "shadow",
        text: 17,
      } as never,
    });

    expect(reviewCandidateLineCount(omitted)).toBe(0);
    expect(reviewCandidateLineCount(malformed)).toBe(0);
    expect(malformed).toContain("<summary>Review Details</summary>");
    expect(malformed).toContain("<!-- kodiai:review-details:test-key-001 -->");
  });

  it("omits lifecycle details when absent or malformed without breaking Review Details", () => {
    const omitted = formatReviewDetailsSummary({ ...BASE_PARAMS });
    const malformed = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      reviewFindingLifecycle: {
        schema: "review-finding-lifecycle.v1",
        status: "normalized",
        redaction: { privateOnly: false },
      } as never,
    });

    expect(reviewFindingLifecycleLineCount(omitted)).toBe(0);
    expect(reviewFindingLifecycleLineCount(malformed)).toBe(0);
    expect(malformed).toContain("<summary>Review Details</summary>");
    expect(malformed).toContain("<!-- kodiai:review-details:test-key-001 -->");
  });

  it("renders a safe bounded lifecycle projection exactly once without raw canaries", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      reviewFindingLifecycle: {
        schema: "review-finding-lifecycle.v1",
        status: "normalized",
        counts: {
          input: 2,
          recorded: 2,
          rejected: 0,
          unsafeInputFields: 3,
          status: { detected: 2, open: 2, suggested: 0, validated: 0, revalidated: 0, resolved: 0, blocked: 0, degraded: 0 },
          severity: { critical: 1, major: 1, medium: 0, minor: 0 },
          category: { security: 1, correctness: 1, performance: 0, style: 0, documentation: 0 },
          actionability: { actionable: 1, "needs-human-review": 1, "needs-reproduction": 0, blocked: 0, "not-actionable": 0 },
          validationNeeds: { none: 0, "needs-tests": 1, "needs-reproduction": 0, "needs-security-review": 1, "needs-owner-confirmation": 0 },
          revalidationState: { "not-required": 1, pending: 1, passed: 0, failed: 0, blocked: 0 },
        },
        correlation: {
          repoPresent: true,
          pullNumberPresent: true,
          reviewOutputKeyPresent: true,
          deliveryIdPresent: true,
          commitIdentityPresent: true,
        },
        reasonCodes: ["automatic-review", "needs-tests"],
        rejectedReasonCodes: [],
        references: [],
        omitted: { references: 0, reasonCodes: 0, rejectedReasonCodes: 0 },
        redaction: {
          privateOnly: true,
          rawPromptsIncluded: false,
          rawModelOutputIncluded: false,
          candidateBodiesIncluded: false,
          toolPayloadsIncluded: false,
          secretLikeStringsIncluded: false,
          diffsIncluded: false,
          unboundedArraysIncluded: false,
          unsafeInputFieldCount: 3,
        },
      },
    });

    expect(reviewFindingLifecycleLineCount(result)).toBe(1);
    expect(result).toContain("- Review finding lifecycle: status=normalized");
    expect(result).toContain("counts=input:2,recorded:2,rejected:0,unsafeInputFields:3");
    expect(result).toContain("correlation=repo:y,pull:y,reviewOutputKey:y,deliveryId:y,commit:y");
    expect(result).toContain("severity=critical:1,major:1,medium:0,minor:0");
    expect(result).toContain("redaction=privateOnly:y,rawPrompts:n,rawModelOutput:n,candidateBodies:n,toolPayloads:n,secretLike:n,diffs:n,unboundedArrays:n,unsafeFields:3");
    expect(result).not.toContain("RAW_PROMPT_CANARY");
    expect(result).not.toContain("RAW_MODEL_OUTPUT_CANARY");
    expect(result).not.toContain("CANDIDATE_BODY_CANARY");
    expect(result).not.toContain("TOOL_PAYLOAD_CANARY");
    expect(result).not.toContain("diff --git");
  });


  it("omits validation truth details when absent malformed or unsafe without breaking Review Details", () => {
    const omitted = formatReviewDetailsSummary({ ...BASE_PARAMS });
    const malformed = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      reviewValidationTruth: {
        schema: "review-validation-truth.v1",
        gate: "wrong-gate",
        status: "normalized",
        redaction: { privateOnly: true },
      } as never,
    });
    const unsafe = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      reviewValidationTruth: {
        schema: "review-validation-truth.v1",
        gate: "review-validation-truth",
        status: "normalized",
        redaction: {
          privateOnly: true,
          rawPromptsIncluded: false,
          rawModelOutputIncluded: true,
          candidateBodiesIncluded: false,
          replacementTextIncluded: false,
          toolPayloadsIncluded: false,
          secretLikeStringsIncluded: false,
          diffsIncluded: false,
          unboundedArraysIncluded: false,
        },
      } as never,
    });

    expect(reviewValidationTruthLineCount(omitted)).toBe(0);
    expect(reviewValidationTruthLineCount(malformed)).toBe(0);
    expect(reviewValidationTruthLineCount(unsafe)).toBe(0);
    expect(malformed).toContain("<summary>Review Details</summary>");
    expect(unsafe).toContain("<!-- kodiai:review-details:test-key-001 -->");
  });

  it("renders a safe bounded validation truth projection exactly once without raw canaries", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      reviewValidationTruth: {
        schema: "review-validation-truth.v1",
        gate: "review-validation-truth",
        reviewOutputKey: "review-output-abc123",
        deliveryId: "delivery-001",
        status: "normalized",
        counts: {
          detected: 4,
          suggested: 2,
          validated: 2,
          revalidated: 1,
          resolved: 1,
          blocked: 1,
          degraded: 0,
          open: 1,
          uncertain: 1,
          inputFindings: 4,
          unsafeInputFields: 6,
        },
        reasonCounts: {
          "suggested-but-open": 1,
          "validation-missing": 1,
          "validation-passed": 2,
          "revalidation-passed": 1,
          blocked: 1,
          resolved: 1,
        },
        evidenceFreshness: {
          fresh: 2,
          stale: 1,
          missingValidation: 1,
          missingRevalidation: 1,
        },
        references: [
          { id: "finding-1", status: "open", reasonCodes: ["validation-missing"], hasSuggestedFix: false, validationPresent: false, revalidationPresent: false },
          { id: "finding-2", status: "resolved", reasonCodes: ["validation-passed", "revalidation-passed", "resolved"], hasSuggestedFix: true, validationPresent: true, revalidationPresent: true },
        ],
        omitted: { references: 0, reasonCodes: 0 },
        redaction: {
          privateOnly: true,
          rawPromptsIncluded: false,
          rawModelOutputIncluded: false,
          candidateBodiesIncluded: false,
          replacementTextIncluded: false,
          toolPayloadsIncluded: false,
          secretLikeStringsIncluded: false,
          diffsIncluded: false,
          unboundedArraysIncluded: false,
          unsafeInputFieldCount: 6,
        },
        rawPrompt: "RAW_PROMPT_CANARY",
        rawModelOutput: "RAW_MODEL_OUTPUT_CANARY",
        candidateBody: "CANDIDATE_BODY_CANARY",
        replacementText: "REPLACEMENT_TEXT_CANARY",
        toolPayload: "TOOL_PAYLOAD_CANARY",
        secret: "sk-secret-value",
        diffText: "diff --git a/secret b/secret",
      } as never,
    });

    expect(reviewValidationTruthLineCount(result)).toBe(1);
    expect(result).toContain("- Review validation truth: status=normalized");
    expect(result).toContain("counts=detected:4,suggested:2,validated:2,revalidated:1,resolved:1,blocked:1,degraded:0,open:1,uncertain:1,inputFindings:4,unsafeInputFields:6");
    expect(result).toContain("evidence=fresh:2,stale:1,missingValidation:1,missingRevalidation:1");
    expect(result).toContain("reasons=suggested-but-open:1,validation-missing:1,validation-passed:2,revalidation-passed:1,blocked:1,resolved:1");
    expect(result).toContain("refs=finding-1:open:validation-missing:fix:n:validation:n:revalidation:n,finding-2:resolved:validation-passed+revalidation-passed+resolved:fix:y:validation:y:revalidation:y");
    expect(result).toContain("correlation=reviewOutputKey:y,deliveryId:y");
    expect(result).toContain("redaction=privateOnly:y,rawPrompts:n,rawModelOutput:n,candidateBodies:n,replacementText:n,toolPayloads:n,secretLike:n,diffs:n,unboundedArrays:n,unsafeFields:6");
    expect(result).not.toContain("RAW_PROMPT_CANARY");
    expect(result).not.toContain("RAW_MODEL_OUTPUT_CANARY");
    expect(result).not.toContain("CANDIDATE_BODY_CANARY");
    expect(result).not.toContain("REPLACEMENT_TEXT_CANARY");
    expect(result).not.toContain("TOOL_PAYLOAD_CANARY");
    expect(result).not.toContain("sk-secret-value");
    expect(result).not.toContain("diff --git");
  });

  it("caps validation truth reason and reference details with omitted counts", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      reviewValidationTruth: {
        schema: "review-validation-truth.v1",
        gate: "review-validation-truth",
        status: "degraded",
        counts: { detected: 7, suggested: 1, validated: 2, revalidated: 1, resolved: 2, blocked: 1, degraded: 1, open: 1, uncertain: 1, inputFindings: 7, unsafeInputFields: 0 },
        reasonCounts: {
          "suggested-but-open": 1,
          "validation-missing": 1,
          "validation-passed": 2,
          "validation-failed": 1,
          "validation-stale": 1,
          "revalidation-missing": 1,
          "revalidation-passed": 1,
          "revalidation-failed": 1,
          degraded: 1,
          blocked: 1,
          resolved: 2,
        },
        evidenceFreshness: { fresh: 3, stale: 2, missingValidation: 1, missingRevalidation: 1 },
        references: Array.from({ length: 7 }, (_, index) => ({
          id: `finding-${index + 1}`,
          status: index === 0 ? "degraded" : "open",
          reasonCodes: ["validation-missing"],
          hasSuggestedFix: index % 2 === 0,
          validationPresent: index % 3 === 0,
          revalidationPresent: false,
        })),
        omitted: { references: 2, reasonCodes: 3 },
        redaction: {
          privateOnly: true,
          rawPromptsIncluded: false,
          rawModelOutputIncluded: false,
          candidateBodiesIncluded: false,
          replacementTextIncluded: false,
          toolPayloadsIncluded: false,
          secretLikeStringsIncluded: false,
          diffsIncluded: false,
          unboundedArraysIncluded: false,
          unsafeInputFieldCount: 0,
        },
      },
    });

    expect(reviewValidationTruthLineCount(result)).toBe(1);
    expect(result).toContain("reasons=suggested-but-open:1,validation-missing:1,validation-passed:2,validation-failed:1,validation-stale:1,revalidation-missing:1,revalidation-passed:1,revalidation-failed:1 +6 omitted");
    expect(result).toContain("refs=finding-1:degraded:validation-missing:fix:y:validation:y:revalidation:n,finding-2:open:validation-missing:fix:n:validation:n:revalidation:n,finding-3:open:validation-missing:fix:y:validation:n:revalidation:n,finding-4:open:validation-missing:fix:n:validation:y:revalidation:n,finding-5:open:validation-missing:fix:y:validation:n:revalidation:n +4 omitted");
    expect(result).not.toContain("finding-6");
    expect(result).not.toContain("finding-7");
  });

  it("does not leak raw candidate title body diff prompt token or secret-like strings in public details", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      reviewCandidateFinding: {
        label: "Review candidates",
        status: "degraded",
        text: "Review candidates: degraded recorded=0 rejected=1 errors=1 artifact=absent reason=scanner-redacted repo=owner-repo pr=42 key=review-output-abc123",
        rawTitle: "Raw candidate title",
        rawBody: "Raw body with diff --git and prompt text",
        token: "ghp_secret_token_value",
        secret: "sk-secret-value",
      } as never,
    });

    expect(reviewCandidateLineCount(result)).toBe(1);
    expect(result).toContain("- Review candidates: degraded recorded=0 rejected=1 errors=1 artifact=absent reason=scanner-redacted repo=owner-repo pr=42 key=review-output-abc123");
    expect(result).not.toContain("Raw candidate title");
    expect(result).not.toContain("Raw body");
    expect(result).not.toContain("diff --git");
    expect(result).not.toContain("prompt text");
    expect(result).not.toContain("ghp_secret_token_value");
    expect(result).not.toContain("sk-secret-value");
  });

  it("renders exactly one bounded candidate-approved publication line after candidate details", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      reviewCandidateFinding: {
        label: "Review candidates",
        status: "shadow",
        text: "Review candidates: shadow recorded=2 rejected=0 errors=0 artifact=present repo=owner-repo pr=42 key=review-output-abc123 delivery=delivery-001",
      } satisfies ReviewCandidateFindingDetailsSummary,
      reviewCandidatePublication: candidatePublicationSummary({
        text: "Review candidate publication runtime: candidate-approved approvedRefs=2 rewrittenRefs=1 publishable=3 candidatePublished=3 skipped=0 blocked=0 failed=0 directPublished=0 fallbackEvidence=0 malformed=0 reasons=candidate-publisher-published",
        mode: "candidate-approved",
        counts: {
          approvedReferences: 2,
          rewrittenReferences: 1,
          candidatePublishable: 3,
          candidatePublished: 3,
          convertedProcessedFindings: 3,
        },
        reasons: ["candidate-publisher-published"],
      }),
    });

    expect(reviewCandidatePublicationLineCount(result)).toBe(1);
    expect(result.indexOf("Review candidates:")).toBeLessThan(result.indexOf("Review candidate publication:"));
    expect(result).toContain("- Review candidate publication: mode=candidate-approved approved=2 rewritten=1 publishable=3 nonPublishable=0 fixBlocked=0 published=3 directFallback=0 reasons=candidate-publisher-published");
    expect(result).not.toContain("Review candidate publication runtime:");
  });

  it("renders candidate publication details from typed metadata instead of reparsing stale visible text", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      reviewCandidatePublication: {
        label: "Review candidate publication runtime",
        text: "Review candidate publication runtime: degraded approvedRefs=999 rewrittenRefs=999 publishable=999 candidatePublished=999 directPublished=999 fallbackEvidence=999 reasons=stale-visible-text",
        mode: "candidate-approved",
        counts: {
          approvedReferences: 2,
          rewrittenReferences: 1,
          candidatePublishable: 3,
          candidatePublished: 3,
          candidateSkipped: 0,
          candidateBlocked: 0,
          candidateFailed: 0,
          candidateMalformed: 0,
          candidateMovedToDetails: 0,
          candidateDetailsOnlyFindings: 0,
          candidateDetailsOnlyOmitted: 0,
          fixEligibilityBlocked: 0,
          nonPublishableReferences: 0,
          convertedProcessedFindings: 3,
          directAttempted: 0,
          directPublished: 0,
          fallbackEvidence: 0,
          fallbackDisallowed: 0,
          malformed: 0,
        },
        reasons: ["candidate-publisher-published"],
      } satisfies ReviewCandidatePublicationRuntimeDetailsSummary,
    });

    expect(result).toContain("- Review candidate publication: mode=candidate-approved approved=2 rewritten=1 publishable=3 nonPublishable=0 fixBlocked=0 published=3 directFallback=0 reasons=candidate-publisher-published");
    expect(result).not.toContain("approved=999");
    expect(result).not.toContain("stale-visible-text");
  });

  it("renders compact publication outcome buckets without raw canaries", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      reviewCandidatePublication: {
        ...candidatePublicationSummary({
          text: "Review candidate publication runtime: candidate-approved-partial approvedRefs=7 rewrittenRefs=0 publishable=5 candidatePublished=1 skipped=1 blocked=1 failed=1 movedToDetails=2 detailsOnly=2 detailsOmitted=1 directPublished=0 fallbackEvidence=0 malformed=1 reasons=candidate-publisher-published,candidate-publisher-skipped,candidate-publisher-blocked,candidate-publisher-failed,candidate-moved-to-details,direct-fallback-disallowed,candidate-publisher-malformed",
          mode: "candidate-approved-partial",
          counts: {
            approvedReferences: 7,
            candidatePublishable: 5,
            candidatePublished: 1,
            candidateSkipped: 1,
            candidateBlocked: 1,
            candidateFailed: 1,
            candidateMovedToDetails: 2,
            candidateDetailsOnlyFindings: 2,
            candidateDetailsOnlyOmitted: 1,
            fallbackDisallowed: 1,
            malformed: 1,
          },
          reasons: ["candidate-publisher-published", "candidate-publisher-skipped", "candidate-publisher-blocked", "candidate-publisher-failed", "candidate-moved-to-details", "direct-fallback-disallowed", "candidate-publisher-malformed"],
        }),
        outcomeBuckets: {
          published: { mode: "published", count: 1, reasons: ["candidate-publisher-published", "RAW_PROMPT_CANARY"] },
          skipped: { mode: "skipped", count: 1, reasons: ["candidate-publisher-skipped", "diff --git"] },
          blocked: { mode: "blocked", count: 1, reasons: ["candidate-publisher-blocked", "sk-secret-value"] },
          failed: { mode: "failed", count: 1, reasons: ["candidate-publisher-failed", "TOKEN=abc123"] },
          movedToDetails: { mode: "moved-to-details", count: 2, reasons: ["candidate-moved-to-details"] },
          fallbackDisallowed: { mode: "fallback-disallowed", count: 1, reasons: ["direct-fallback-disallowed"] },
          degraded: { mode: "degraded", count: 1, reasons: ["candidate-publisher-malformed"] },
        },
      },
    });

    expect(reviewCandidatePublicationLineCount(result)).toBe(1);
    expect(result).toContain("buckets=published:1:candidate-publisher-published");
    expect(result).toContain("skipped:1:candidate-publisher-skipped");
    expect(result).toContain("blocked:1:candidate-publisher-blocked");
    expect(result).toContain("failed:1:candidate-publisher-failed");
    expect(result).toContain("moved-to-details:2:candidate-moved-to-details");
    expect(result).toContain("fallback-disallowed:1:direct-fallback-disallowed");
    expect(result).toContain("degraded:1:candidate-publisher-malformed");
    expect(result).not.toContain("RAW_PROMPT_CANARY");
    expect(result).not.toContain("diff --git");
    expect(result).not.toContain("sk-secret-value");
    expect(result).not.toContain("TOKEN=abc123");
  });

  it("caps compact publication outcome bucket text and redacts unsafe bucket reasons", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      reviewCandidatePublication: {
        ...candidatePublicationSummary({
          text: "Review candidate publication runtime: degraded approvedRefs=240 rewrittenRefs=0 publishable=240 candidatePublished=60 skipped=60 blocked=60 failed=60 directPublished=0 fallbackEvidence=0 malformed=1 reasons=candidate-publisher-partial",
          mode: "degraded",
          counts: {
            approvedReferences: 240,
            candidatePublishable: 240,
            candidatePublished: 60,
            candidateSkipped: 60,
            candidateBlocked: 60,
            candidateFailed: 60,
            malformed: 1,
          },
          reasons: ["candidate-publisher-partial"],
        }),
        outcomeBuckets: {
          published: { mode: "published", count: 60, reasons: ["candidate-publisher-published", ...Array.from({ length: 20 }, (_, index) => `unsafe published ${index} diff --git sk-secret`)] },
          skipped: { mode: "skipped", count: 60, reasons: ["candidate-publisher-skipped"] },
          blocked: { mode: "blocked", count: 60, reasons: ["candidate-publisher-blocked"] },
          failed: { mode: "failed", count: 60, reasons: ["candidate-publisher-failed"] },
          degraded: { mode: "degraded", count: 1, reasons: ["malformed-publisher-result", "BEGIN PROMPT hidden instructions"] },
        },
      },
    });

    const line = result.split("\n").find((entry) => entry.includes("Review candidate publication:")) ?? "";
    expect(line).toContain("buckets=published:60:candidate-publisher-published");
    expect(line).toContain("+20 bucketReasonsOmitted");
    expect(line.length).toBeLessThanOrEqual(520);
    expect(result).not.toContain("unsafe published");
    expect(result).not.toContain("diff --git");
    expect(result).not.toContain("sk-secret");
    expect(result).not.toContain("BEGIN PROMPT");
    expect(result).not.toContain("hidden instructions");
  });


  it("renders moved-to-details publication status plus bounded details-only findings", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      reviewCandidatePublication: {
        ...candidatePublicationSummary({
          text: "Review candidate publication runtime: moved-to-details approvedRefs=1 rewrittenRefs=0 publishable=0 candidatePublished=0 skipped=0 blocked=0 failed=0 movedToDetails=1 detailsOnly=1 detailsOmitted=0 directPublished=0 fallbackEvidence=0 malformed=0 reasons=candidate-moved-to-details,line-not-commentable-in-pr-diff",
          mode: "moved-to-details",
          counts: {
            approvedReferences: 1,
            candidateMovedToDetails: 1,
            candidateDetailsOnlyFindings: 1,
          },
          reasons: ["candidate-moved-to-details", "line-not-commentable-in-pr-diff"],
        }),
        movedToDetails: {
          counts: { total: 1, fromFixEligibility: 0, fromPublisherResult: 1, omitted: 0 },
          reasonCounts: { "line-not-commentable-in-pr-diff": 1 },
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
        detailsOnlyFindings: [{
          fingerprint: "rcf-0000000000000001",
          lifecycle: "approved",
          severity: "major",
          category: "correctness",
          title: "Guard null payload before enqueue",
          location: { path: "src/worker.ts", line: 42 },
          reason: "line-not-commentable-in-pr-diff",
          excerpt: "The enqueue path dereferences payload before validating it.",
        }],
      } satisfies ReviewCandidatePublicationRuntimeDetailsSummary,
    });

    expect(reviewCandidatePublicationLineCount(result)).toBe(1);
    expect(result).toContain("- Review candidate publication: mode=moved-to-details approved=1 rewritten=0 publishable=0 nonPublishable=0 fixBlocked=0 published=0 directFallback=0 reasons=candidate-moved-to-details,line-not-commentable-in-pr-diff movedToDetails=1 detailsOmitted=0");
    expect(result).toContain("- Moved review candidates preserved in details:");
    expect(result).toContain("  - [major/correctness] Guard null payload before enqueue (src/worker.ts:42, reason=line-not-commentable-in-pr-diff) — The enqueue path dereferences payload before validating it.");
    expect(result).not.toContain("direct-fallback-published");
  });

  it("bounds and sanitizes moved-to-details finding lines while reporting omitted count", () => {
    const findings = Array.from({ length: 12 }, (_, index) => ({
      fingerprint: `rcf-${index.toString(16).padStart(16, "0")}`,
      lifecycle: "approved" as const,
      severity: "major" as const,
      category: "security" as const,
      title: `Safe title ${index} sk-secret-value ghp_secret_token_value BEGIN PROMPT diff --git`,
      location: { path: `src/file-${index}.ts`, line: 10 + index },
      reason: index === 0 ? "line-not-commentable-in-pr-diff" as const : "line-not-commentable" as const,
      excerpt: `short excerpt ${index} TOKEN=abc123 secret=value \`\`\`suggestion\nreplacement text\n\`\`\` diff --git prompt text`,
    }));

    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      reviewCandidatePublication: {
        ...candidatePublicationSummary({
          text: "Review candidate publication runtime: moved-to-details approvedRefs=12 rewrittenRefs=0 publishable=0 candidatePublished=0 skipped=0 blocked=0 failed=0 movedToDetails=12 detailsOnly=12 detailsOmitted=7 directPublished=0 fallbackEvidence=0 malformed=0 reasons=candidate-moved-to-details,oversized reason one,oversized reason two,oversized reason three,oversized reason four,oversized reason five,oversized reason six,oversized reason seven",
          mode: "moved-to-details",
          counts: {
            approvedReferences: 12,
            candidateMovedToDetails: 12,
            candidateDetailsOnlyFindings: 12,
            candidateDetailsOnlyOmitted: 7,
          },
          reasons: ["candidate-moved-to-details", "oversized reason one", "oversized reason two", "oversized reason three", "oversized reason four", "oversized reason five", "oversized reason six", "oversized reason seven"],
        }),
        movedToDetails: {
          counts: { total: 12, fromFixEligibility: 12, fromPublisherResult: 0, omitted: 7 },
          reasonCounts: { "line-not-commentable": 11, "line-not-commentable-in-pr-diff": 1 },
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
        detailsOnlyFindings: findings,
      } satisfies ReviewCandidatePublicationRuntimeDetailsSummary,
    });

    expect(result).toContain("movedToDetails=12 detailsOmitted=7");
    expect(result).toContain("+2 more");
    expect(result).toContain("  - ...and 7 more omitted (bounded-details-only)");
    expect(result).toContain("Safe title 0 redacted redacted prompt-redacted");
    expect(result).toContain("[fix-redacted]");
    expect(result).not.toContain("Safe title 5");
    for (const unsafe of ["sk-secret-value", "ghp_secret_token_value", "BEGIN PROMPT", "TOKEN=abc123", "secret=value", "replacement text", "diff --git"] as const) {
      expect(result).not.toContain(unsafe);
    }
  });

  it("degrades moved-to-details metadata and omits findings when projection is malformed or unsafe", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      reviewCandidatePublication: {
        ...candidatePublicationSummary({
          text: "Review candidate publication runtime: not-a-real-mode approvedRefs=1 rewrittenRefs=0 publishable=0 candidatePublished=0 skipped=0 blocked=0 failed=0 movedToDetails=1 detailsOnly=1 detailsOmitted=0 directPublished=0 fallbackEvidence=0 malformed=0 reasons=BEGIN PROMPT,diff --git,unknown reason",
          mode: "degraded",
          counts: {
            approvedReferences: 1,
            candidateMovedToDetails: 1,
            candidateDetailsOnlyFindings: 1,
          },
          reasons: ["BEGIN PROMPT", "diff --git", "unknown reason"],
        }),
        movedToDetails: {
          counts: { total: 1, fromFixEligibility: 1, fromPublisherResult: 0, omitted: 0 },
          reasonCounts: { "unknown unsafe reason": 1 },
          redaction: {
            rawCandidatePayloadsIncluded: false,
            rawPromptsIncluded: true,
            rawModelOutputIncluded: false,
            diffsIncluded: false,
            replacementTextIncluded: false,
            githubResponsePayloadsIncluded: false,
            secretLikeValuesIncluded: false,
            bounded: true,
          },
        },
        detailsOnlyFindings: [{
          fingerprint: "rcf-0000000000000001",
          lifecycle: "approved",
          severity: "major",
          category: "security",
          title: "MUST_NOT_RENDER sk-secret-value",
          location: { path: "src/secret.ts", line: 1 },
          reason: "line-not-commentable",
          excerpt: "PROMPT_SECRET diff --git",
        }],
      } as never,
    });

    expect(reviewCandidatePublicationLineCount(result)).toBe(1);
    expect(result).toContain("mode=degraded");
    expect(result).toContain("prompt-redacted,diff-redacted,unknown-reason");
    expect(result).not.toContain("Moved review candidates preserved in details");
    expect(result).not.toContain("MUST_NOT_RENDER");
    expect(result).not.toContain("sk-secret-value");
    expect(result).not.toContain("diff --git");
  });

  it("renders direct fallback publication state as audited fallback evidence", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      reviewCandidatePublication: candidatePublicationSummary({
        text: "Review candidate publication runtime: direct-fallback approvedRefs=0 rewrittenRefs=0 publishable=0 candidatePublished=0 skipped=0 blocked=0 failed=0 directPublished=2 fallbackEvidence=2 malformed=0 reasons=direct-fallback-attempted,direct-fallback-published",
        mode: "direct-fallback",
        counts: {
          directAttempted: 1,
          directPublished: 2,
          fallbackEvidence: 2,
        },
        reasons: ["direct-fallback-attempted", "direct-fallback-published"],
      }),
    });

    expect(reviewCandidatePublicationLineCount(result)).toBe(1);
    expect(result).toContain("- Review candidate publication: mode=direct-fallback approved=0 rewritten=0 publishable=0 nonPublishable=0 fixBlocked=0 published=0 directFallback=2 reasons=direct-fallback-attempted,direct-fallback-published");
  });

  it("omits missing candidate publication metadata and degrades malformed metadata without breaking Review Details", () => {
    const omitted = formatReviewDetailsSummary({ ...BASE_PARAMS });
    const malformed = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      reviewCandidatePublication: {
        label: "Review candidate publication runtime",
        text: 17,
      } as never,
    });

    expect(reviewCandidatePublicationLineCount(omitted)).toBe(0);
    expect(reviewCandidatePublicationLineCount(malformed)).toBe(1);
    expect(malformed).toContain("- Review candidate publication: mode=degraded approved=0 rewritten=0 publishable=0 nonPublishable=0 fixBlocked=0 published=0 directFallback=0 reasons=malformed-runtime-summary");
    expect(malformed).toContain("buckets=degraded:1:malformed-runtime-summary");
    expect(malformed).toContain("<summary>Review Details</summary>");
    expect(malformed).toContain("<!-- kodiai:review-details:test-key-001 -->");
  });

  it("caps oversized candidate publication reasons and redacts secret prompt and diff markers", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      reviewCandidatePublication: candidatePublicationSummary({
        text: "Review candidate publication runtime: degraded approvedRefs=1 rewrittenRefs=0 publishable=1 candidatePublished=0 skipped=0 blocked=0 failed=1 directPublished=0 fallbackEvidence=0 malformed=1 reasons=candidate-publisher-failed,sk-secret-value,ghp_secret_token_value,BEGIN PROMPT,diff --git,hidden instructions,oversized reason one,oversized reason two,oversized reason three,oversized reason four,oversized reason five,oversized reason six",
        mode: "degraded",
        counts: {
          approvedReferences: 1,
          candidatePublishable: 1,
          candidateFailed: 1,
          malformed: 1,
        },
        reasons: ["candidate-publisher-failed", "sk-secret-value", "ghp_secret_token_value", "BEGIN PROMPT", "diff --git", "hidden instructions", "oversized reason one", "oversized reason two", "oversized reason three", "oversized reason four", "oversized reason five", "oversized reason six"],
      }),
    });

    expect(reviewCandidatePublicationLineCount(result)).toBe(1);
    expect(result).toContain("- Review candidate publication: mode=degraded approved=1 rewritten=0 publishable=1 nonPublishable=0 fixBlocked=0 published=0 directFallback=0 reasons=candidate-publisher-failed,redacted,redacted,prompt-redacted,diff-redacted,prompt-redacted");
    expect(result).toContain("+6 more");
    expect(result).not.toContain("sk-secret-value");
    expect(result).not.toContain("ghp_secret_token_value");
    expect(result).not.toContain("BEGIN PROMPT");
    expect(result).not.toContain("diff --git");
    expect(result).not.toContain("hidden instructions");
  });

  it("omits the review reducer line when reducer metadata is omitted", () => {
    const result = formatReviewDetailsSummary({ ...BASE_PARAMS });

    expect(reviewReducerLineCount(result)).toBe(0);
    expect(result).not.toContain("Review reducer:");
  });

  it("renders bounded first-pass diagnostics from the normalized contract", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      reviewFirstPass: BOUNDED_TIMEOUT_FIRST_PASS,
    });

    expect(result).toContain("- Bounded first-pass: timeout via checkpoint evidence");
    expect(result).toContain("- Covered scope: 1/3 changed files");
    expect(result).toContain("- Remaining scope: 2/3 changed files");
    expect(result).toContain("- First-pass findings captured: 2");
    expect(result).toContain("- Publication eligibility: eligible");
    expect(result).toContain("- Continuation state: follow-up review pending for remaining scope");
  });

  it("renders zero-evidence hard failure explicitly instead of bounded success", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      reviewFirstPass: {
        state: "zero-evidence-failure",
        boundedReason: "max-turns",
        evidenceSource: "none",
        publication: { eligible: false, hasPublishedOutput: false },
        continuationPending: false,
        zeroEvidenceFailure: true,
      },
    });

    expect(result).toContain("- Constrained outcome: zero-evidence hard failure after max-turns");
    expect(result).toContain("- Publication eligibility: ineligible");
    expect(result).toContain("- Continuation state: stopped after first pass; no follow-up review is pending");
    expect(result).not.toContain("- Bounded first-pass:");
    expect(result).not.toContain("- Covered scope:");
  });

  it("degrades truthfully when remaining scope is missing instead of implying exhaustive coverage", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      reviewFirstPass: {
        ...BOUNDED_TIMEOUT_FIRST_PASS,
        remainingScope: undefined,
        continuationPending: true,
      },
    });

    expect(result).toContain("- Covered scope: 1/3 changed files");
    expect(result).toContain("- Remaining scope: not confirmed from structured evidence");
    expect(result).toContain("- Continuation state: follow-up review pending; remaining scope still unconfirmed");
  });

  it("degrades truthfully when covered scope is missing instead of inventing reviewed coverage", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      reviewFirstPass: {
        ...BOUNDED_TIMEOUT_FIRST_PASS,
        coveredScope: undefined,
        remainingScope: { remainingFiles: 2, totalFiles: 3 },
        continuationPending: false,
      },
    });

    expect(result).not.toContain("- Covered scope:");
    expect(result).toContain("- Remaining scope: 2/3 changed files");
    expect(result).toContain("- Continuation state: stopped after first pass; 2/3 files remain unreviewed");
  });

  it("renders contributor-experience contract wording without raw tier leakage", () => {
    const cases = [
      {
        projection: projectContributorExperienceContract({
          source: "contributor-profile",
          tier: "established",
        }).reviewDetails,
        expected:
          "- Contributor experience: profile-backed (using linked contributor profile guidance)",
      },
      {
        projection: projectContributorExperienceContract({
          source: "author-cache",
          tier: "regular",
        }).reviewDetails,
        expected:
          "- Contributor experience: coarse-fallback (using coarse fallback signals only)",
      },
      {
        projection: projectContributorExperienceContract({
          source: "none",
          tier: null,
        }).reviewDetails,
        expected:
          "- Contributor experience: generic-unknown (no reliable contributor signal available)",
      },
      {
        projection: projectContributorExperienceContract({
          source: "contributor-profile",
          tier: "senior",
          optedOut: true,
        }).reviewDetails,
        expected:
          "- Contributor experience: generic-opt-out (contributor-specific guidance disabled by opt-out)",
      },
      {
        projection: projectContributorExperienceContract({
          source: "github-search",
          tier: "regular",
          degraded: true,
          degradationPath: "search-api-rate-limit",
        }).reviewDetails,
        expected:
          "- Contributor experience: generic-degraded (fallback signals unavailable: search-api-rate-limit)",
      },
    ];

    for (const testCase of cases) {
      const result = formatReviewDetailsSummary({
        ...BASE_PARAMS,
        contributorExperience: testCase.projection,
      });

      expect(result).toContain(testCase.expected);
      expect(result).not.toContain("- Author tier:");
      expect(result).not.toContain("developing guidance");
      expect(result).not.toContain("established contributor guidance");
      expect(result).not.toContain("senior contributor guidance");
    }
  });

  it("renders usage line when usageLimit is present", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      usageLimit: {
        utilization: 0.75,
        rateLimitType: "seven_day",
        resetsAt: 1735000000,
      },
    });

    expect(result).toContain("25% of seven_day limit remaining");
    expect(result).toContain("resets ");

    const resultWithout = formatReviewDetailsSummary({ ...BASE_PARAMS });
    expect(resultWithout).not.toContain("Claude Code usage");
  });

  it("renders token line when tokenUsage is present", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      tokenUsage: {
        inputTokens: 1000,
        outputTokens: 500,
        costUsd: 0.0123,
      },
    });

    expect(result).toContain("in /");
    expect(result).toContain("out");
    expect(result).toContain("0.0123");
  });

  it("uses a provided completedAt timestamp instead of regenerating wall clock time", () => {
    const completedAt = "2026-04-22T20:15:00.000Z";
    const first = formatReviewDetailsSummary({ ...BASE_PARAMS, completedAt });
    const second = formatReviewDetailsSummary({ ...BASE_PARAMS, completedAt });

    expect(first).toContain(`- Review completed: ${completedAt}`);
    expect(second).toContain(`- Review completed: ${completedAt}`);
    expect(first).toBe(second);
  });

  it("omits usage and token lines when fields absent", () => {
    const result = formatReviewDetailsSummary({ ...BASE_PARAMS });

    expect(result).not.toContain("Claude Code usage:");
    expect(result).not.toContain("Tokens:");
  });

  it("renders timeout progress from analyzed evidence instead of generic reviewed totals", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      timeoutProgress: {
        analyzedFiles: 1,
        totalFiles: 3,
        findingCount: 2,
        retryState: "scheduled reduced-scope retry",
      },
    });

    expect(result).toContain("- Analyzed progress before timeout: 1/3 changed files");
    expect(result).toContain("- Findings captured before timeout: 2 total");
    expect(result).toContain("- Retry state: scheduled reduced-scope retry");
    expect(result).not.toContain("- Files reviewed: 3");
    expect(result).not.toContain("- Findings: 0 critical, 1 major, 2 medium, 0 minor");
  });

  it("renders timeout budget lines when timeout progress includes split budgets", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      timeoutProgress: {
        analyzedFiles: 1,
        totalFiles: 3,
        findingCount: 2,
        retryState: "scheduled reduced-scope retry",
      },
      timeoutBudget: {
        remoteRuntimeBudgetSeconds: 423,
        infraOverheadBudgetSeconds: 180,
        totalTimeoutSeconds: 603,
      },
    });

    expect(result).toContain("- Timeout budget: remote runtime 423s + infra overhead 180s = total 603s");
  });

  it("keeps shared bounded first-pass wording visible when timeout retry metadata is present", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      reviewFirstPass: BOUNDED_TIMEOUT_FIRST_PASS,
      timeoutProgress: {
        analyzedFiles: 1,
        totalFiles: 3,
        findingCount: 2,
        retryState: "scheduled reduced-scope retry",
      },
    });

    expect(result).toContain("- Bounded first-pass: timeout via checkpoint evidence");
    expect(result).toContain("- Covered scope: 1/3 changed files");
    expect(result).toContain("- Remaining scope: 2/3 changed files");
    expect(result).toContain("- Continuation state: follow-up review pending for remaining scope");
    expect(result).toContain("- Retry state: scheduled reduced-scope retry");
  });

  it("degrades truthfully on timeout metadata when bounded scope fields are missing", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      reviewFirstPass: {
        ...BOUNDED_TIMEOUT_FIRST_PASS,
        coveredScope: undefined,
        remainingScope: undefined,
        continuationPending: true,
      },
      timeoutProgress: {
        analyzedFiles: 1,
        totalFiles: 3,
        findingCount: 2,
        retryState: "retry skipped after timeout",
      },
    });

    expect(result).toContain("- Bounded first-pass: timeout via checkpoint evidence");
    expect(result).toContain("- Remaining scope: not confirmed from structured evidence");
    expect(result).toContain("- Continuation state: follow-up review pending; remaining scope still unconfirmed");
    expect(result).not.toContain("- Covered scope:");
    expect(result).toContain("- Retry state: retry skipped after timeout");
  });

  it("renders total wall-clock time and the six required phases in stable order", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      phaseTimingSummary: {
        totalDurationMs: 2500,
        phases: [
          { name: "publication", status: "completed", durationMs: 400 },
          { name: "remote runtime", status: "completed", durationMs: 1200 },
          { name: "executor handoff", status: "completed", durationMs: 50 },
          { name: "retrieval/context assembly", status: "completed", durationMs: 300 },
          { name: "workspace preparation", status: "completed", durationMs: 200 },
          { name: "queue wait", status: "completed", durationMs: 350 },
        ],
      },
    });

    expect(result).toContain("- Total wall-clock: 2.5s");
    expect(result).toContain("- Phase timings:");

    const orderedLines = [
      "queue wait: 350ms",
      "workspace preparation: 200ms",
      "retrieval/context assembly: 300ms",
      "executor handoff: 50ms",
      "remote runtime: 1.2s",
      "publication: 400ms",
    ];

    let lastIndex = -1;
    for (const line of orderedLines) {
      const nextIndex = result.indexOf(line);
      expect(nextIndex).toBeGreaterThan(lastIndex);
      lastIndex = nextIndex;
    }
  });

  it("omits total wall-clock when the summary duration is invalid instead of rendering an epoch-sized value", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      phaseTimingSummary: {
        totalDurationMs: Number.POSITIVE_INFINITY,
        phases: [
          { name: "queue wait", status: "completed", durationMs: 350 },
        ],
      },
    });

    expect(result).not.toContain("- Total wall-clock:");
    expect(result).toContain("queue wait: 350ms");
  });

  it("renders degraded and unavailable wording for malformed or missing phase timings instead of throwing", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      phaseTimingSummary: {
        totalDurationMs: 3100,
        phases: [
          { name: "publication", status: "degraded", durationMs: 120, detail: "captured before publication completed" },
          { name: "remote runtime", status: "completed", durationMs: 800 },
          { name: "executor handoff", status: "completed", durationMs: 50 },
          { name: "workspace preparation", status: "bogus", durationMs: 200 } as never,
          { name: "queue wait", status: "completed", durationMs: Number.NaN } as never,
        ],
      },
    });

    expect(result).toContain("queue wait: unavailable (invalid phase timing data)");
    expect(result).toContain("workspace preparation: unavailable (invalid phase timing data)");
    expect(result).toContain("retrieval/context assembly: unavailable (phase timing unavailable)");
    expect(result).toContain("executor handoff: 50ms");
    expect(result).toContain("remote runtime: 800ms");
    expect(result).toContain("publication: 120ms (degraded: captured before publication completed)");
  });

  it("renders saturated comment-cap diagnostics when prioritization omitted findings", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      prioritization: {
        findingsScored: 9,
        topScore: 182,
        thresholdScore: 97,
        maxComments: 3,
        selectedFindings: 3,
        omittedFindings: 6,
      },
    });

    expect(result).toContain("- Comment cap saturated: published 3/9 prioritized findings; 6 lower-priority findings omitted from inline publication");
    expect(result).toContain("- Prioritization: scored 9 findings | top score 182 | threshold score 97");
  });

  it("renders singular saturated comment-cap diagnostics when one finding is omitted", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      prioritization: {
        findingsScored: 4,
        topScore: 182,
        thresholdScore: 97,
        maxComments: 3,
        selectedFindings: 3,
        omittedFindings: 1,
      },
    });

    expect(result).toContain("- Comment cap saturated: published 3/4 prioritized findings; 1 lower-priority finding omitted from inline publication");
  });

  it("renders requested versus effective bounded-review lines without duplicating the old profile line", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      reviewBoundedness: {
        requestedProfile: {
          selectedProfile: "strict",
          source: "keyword",
          autoBand: null,
          linesChanged: 100,
        },
        effectiveProfile: {
          selectedProfile: "strict",
          source: "keyword",
          autoBand: null,
          linesChanged: 100,
        },
        reasonCodes: [
          "large-pr-triage",
          "timeout-auto-reduction-skipped-explicit-profile",
        ],
        disclosureRequired: true,
        disclosureSentence:
          "Requested strict review; effective review remained strict and covered 50/60 changed files via large-PR triage (30 full, 20 abbreviated; 10 not reviewed).",
        largePR: {
          fullCount: 30,
          abbreviatedCount: 20,
          reviewedCount: 50,
          totalFiles: 60,
          notReviewedCount: 10,
        },
        timeout: {
          riskLevel: "high",
          dynamicTimeoutSeconds: 900,
          shouldReduceScope: true,
          reductionApplied: false,
          reductionSkippedReason: "explicit-profile",
        },
      } as never,
    });

    expect(result).toContain("- Requested profile: strict (keyword override)");
    expect(result).toContain("- Effective profile: strict");
    expect(result).toContain(
      "- Bounded review: covered 50/60 changed files via large-PR triage (30 full, 20 abbreviated; 10 not reviewed)",
    );
    expect(result).toContain("- Timeout auto-reduction: skipped (explicit profile)");
    expect(result).not.toContain("- Profile: balanced (auto, lines changed: 60)");
  });

  it("keeps small unbounded reviews quiet by retaining the existing single profile line", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      reviewBoundedness: {
        requestedProfile: {
          selectedProfile: "strict",
          source: "auto",
          autoBand: "small",
          linesChanged: 60,
        },
        effectiveProfile: {
          selectedProfile: "strict",
          source: "auto",
          autoBand: "small",
          linesChanged: 60,
        },
        reasonCodes: [],
        disclosureRequired: false,
        disclosureSentence: null,
        largePR: null,
        timeout: {
          riskLevel: "low",
          dynamicTimeoutSeconds: 600,
          shouldReduceScope: false,
          reductionApplied: false,
          reductionSkippedReason: null,
        },
      } as never,
    });

    expect(result).toContain("- Profile: balanced (auto, lines changed: 60)");
    expect(result).not.toContain("- Requested profile:");
    expect(result).not.toContain("- Effective profile:");
    expect(result).not.toContain("- Bounded review:");
  });
});
