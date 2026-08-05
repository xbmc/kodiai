import { describe, expect, test } from "bun:test";
import {
  publishBlockedReviewFindingsNotice,
  resolveBlockedReviewFindingsNotice,
  willBlockedReviewFindingsNoticePublish,
} from "./review-blocked-findings-notice.ts";
import type {
  ReviewCandidatePublicationRuntimeCounts,
  ReviewCandidatePublicationRuntimeResult,
} from "../review-orchestration/review-candidate-publication-runtime.ts";

function baseCounts(
  overrides: Partial<ReviewCandidatePublicationRuntimeCounts> = {},
): ReviewCandidatePublicationRuntimeCounts {
  return {
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
    ...overrides,
  };
}

function baseRuntime(
  overrides: Partial<ReviewCandidatePublicationRuntimeResult> = {},
): ReviewCandidatePublicationRuntimeResult {
  return {
    mode: "unblocked",
    reasons: [],
    counts: baseCounts(),
    detailsOnlyFindings: [],
    detailsSummary: {},
    ...overrides,
  } as ReviewCandidatePublicationRuntimeResult;
}

describe("willBlockedReviewFindingsNoticePublish", () => {
  test("false when there are no lifecycle findings", () => {
    expect(willBlockedReviewFindingsNoticePublish({
      candidatePublicationRuntime: baseRuntime(),
      findingLifecycle: null,
      handlerPublishedReviewOutput: false,
    })).toBe(false);
  });

  test("true when findings exist and publication is blocked", () => {
    expect(willBlockedReviewFindingsNoticePublish({
      candidatePublicationRuntime: baseRuntime({ mode: "blocked" }),
      findingLifecycle: { counts: { severity: { critical: 0, major: 1, medium: 0, minor: 0 } } } as never,
      handlerPublishedReviewOutput: false,
    })).toBe(true);
  });

  test("false when findings exist but were already published elsewhere", () => {
    expect(willBlockedReviewFindingsNoticePublish({
      candidatePublicationRuntime: baseRuntime({ counts: baseCounts({ candidatePublished: 1 }) }),
      findingLifecycle: { counts: { severity: { critical: 0, major: 1, medium: 0, minor: 0 } } } as never,
      handlerPublishedReviewOutput: false,
    })).toBe(false);
  });

  test("false when the handler's own output already published a verdict, even if candidate publication is blocked", () => {
    expect(willBlockedReviewFindingsNoticePublish({
      candidatePublicationRuntime: baseRuntime({ mode: "blocked" }),
      findingLifecycle: { counts: { severity: { critical: 0, major: 1, medium: 0, minor: 0 } } } as never,
      handlerPublishedReviewOutput: true,
    })).toBe(false);
  });
});

describe("resolveBlockedReviewFindingsNotice", () => {
  test("shows bounded visible finding details when candidate publication is blocked", () => {
    const notice = resolveBlockedReviewFindingsNotice({
      reviewOutputKey: "review-key",
      reviewDetailsBlock: null,
      candidatePublicationRuntime: baseRuntime({ mode: "blocked" }),
      findingLifecycle: { counts: { severity: { critical: 0, major: 0, medium: 0, minor: 1 } } } as never,
      visibleFindings: [{
        filePath: "src/example.ts",
        startLine: 42,
        title: "Use the bounded publication path",
        severity: "minor",
        suppressed: false,
      } as never],
      handlerPublishedReviewOutput: false,
    });

    expect(notice?.body).toContain("**MINOR** `src/example.ts:42` — Use the bounded publication path");
    expect(notice?.body).not.toContain("Raw finding text was kept private");
  });
});

describe("publishBlockedReviewFindingsNotice", () => {
  test("returns false and does not reconcile a stale surface when publish rights are lost during the write", async () => {
    // Regression test: if upsertCanonicalReviewSurface's own recheckCanPublish
    // aborts mid-write (a superseded review-work race), the function must not
    // report success or run the (now unwarranted) supersede-reconciliation step.
    let updateReviewCalled = false;
    const octokit = {
      rest: {
        issues: { listComments: async () => ({ data: [] }) },
        pulls: {
          listReviews: async () => ({
            data: [{ id: 1, body: "Decision: APPROVE\n<!-- kodiai:review-output-key:review-key -->" }],
          }),
        },
      },
      request: async () => {
        updateReviewCalled = true;
        return { data: {} };
      },
    };

    let calls = 0;
    const published = await publishBlockedReviewFindingsNotice({
      octokit: octokit as never,
      owner: "acme",
      repo: "repo",
      prNumber: 42,
      reviewOutputKey: "review-key",
      body: "Decision: NOT APPROVED\n\nIssues:\n- finding",
      botHandles: ["kodiai"],
      logger: { info: () => {}, warn: () => {} },
      // First call (inside upsertCanonicalReviewSurface's recheckCanPublish) allows
      // the write to proceed only far enough to hit the recheck, then denies it.
      canPublishVisibleOutput: () => {
        calls += 1;
        return calls === 1;
      },
      setReviewWorkPhase: () => {},
    });

    expect(published).toBe(false);
    expect(updateReviewCalled).toBe(false);
  });

  test("returns true and reconciles a stale opposite-kind surface on a normal successful write", async () => {
    let createdBody: string | undefined;
    let reconciledBody: string | undefined;
    const octokit = {
      rest: {
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async (params: { body: string }) => {
            createdBody = params.body;
            return { data: { id: 5 } };
          },
        },
        pulls: {
          listReviews: async () => ({
            data: [{ id: 1, body: "Decision: APPROVE\n<!-- kodiai:review-output-key:review-key -->" }],
          }),
        },
      },
      request: async (_route: string, params: { body: string }) => {
        reconciledBody = params.body;
        return { data: {} };
      },
    };

    const published = await publishBlockedReviewFindingsNotice({
      octokit: octokit as never,
      owner: "acme",
      repo: "repo",
      prNumber: 42,
      reviewOutputKey: "review-key",
      body: "Decision: NOT APPROVED\n\nIssues:\n- finding",
      botHandles: ["kodiai"],
      logger: { info: () => {}, warn: () => {} },
      canPublishVisibleOutput: () => true,
      setReviewWorkPhase: () => {},
    });

    expect(published).toBe(true);
    expect(createdBody).toContain("Decision: NOT APPROVED");
    expect(reconciledBody).toContain("Superseded by a newer kodiai review decision");
  });
});
