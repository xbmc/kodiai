import { describe, expect, mock, test } from "bun:test";
import { projectContributorExperienceContract } from "../contributor/experience-contract.ts";
import type { ReviewPhaseName, ReviewPhaseTiming } from "../execution/types.ts";
import { createReviewPhaseTiming } from "../review-orchestration/review-phase-timing.ts";
import {
  createReviewDetailsPublicationRuntime,
  updateFinalizedReviewDetailsComment,
} from "./review-details-publication-runtime.ts";

function baseReviewDetailsBodyParams() {
  return {
    reviewOutputKey: "review-output-1",
    filesReviewed: 2,
    linesAdded: 10,
    linesRemoved: 4,
    findingCounts: { critical: 0, major: 0, medium: 0, minor: 0 },
    profileSelection: {
      selectedProfile: "balanced" as const,
      source: "auto" as const,
      autoBand: null,
      linesChanged: 14,
    },
    contributorExperience: projectContributorExperienceContract({
      source: "author-cache",
      tier: "regular",
    }).reviewDetails,
    lineCountSource: "local-diff" as const,
  };
}

describe("createReviewDetailsPublicationRuntime", () => {
  test("updates finalized Review Details comments through the GitHub publication pipeline", async () => {
    const updateComment = mock(async (params: unknown) => ({ data: { id: 456, params } }));
    const octokit = {
      rest: {
        issues: { updateComment },
      },
    } as any;

    await updateFinalizedReviewDetailsComment({
      octokit,
      owner: "xbmc",
      repo: "kodiai",
      commentId: 456,
      body: "Finalized details for @claude.",
      botHandles: ["kodiai", "claude"],
    });

    expect(updateComment).toHaveBeenCalledTimes(1);
    expect(updateComment.mock.calls[0]![0]).toMatchObject({
      owner: "xbmc",
      repo: "kodiai",
      comment_id: 456,
      body: "Finalized details for claude.",
    });
  });

  test("renders details, finalizes publication timing, and logs canonical completion", () => {
    const info = mock(() => undefined);
    const phases = new Map<ReviewPhaseName, ReviewPhaseTiming>([
      ["queue wait", createReviewPhaseTiming({ name: "queue wait", status: "completed", durationMs: 1 })],
    ]);

    const runtime = createReviewDetailsPublicationRuntime({
      logger: { info },
      baseLog: { prNumber: 123 },
      reviewOutputKey: "review-output-1",
      deliveryId: "delivery-1",
      doctrineFields: { doctrineApplied: true },
      reviewDetailsBodyBase: baseReviewDetailsBodyParams(),
      hasOperationalSignal: false,
      getVisibleBudgetProjection: () => null,
      filteredFindings: [],
      reviewPhaseTimings: phases,
      getPublicationPhaseStartedAt: () => Date.now() - 5,
    });

    expect(runtime.renderReviewDetailsBody()).toContain("review-output-1");

    runtime.finalizePublicationPhaseTiming();
    expect(phases.get("publication")).toMatchObject({
      name: "publication",
      status: "completed",
    });

    runtime.logCanonicalReviewDetailsPublicationCompleted({
      kind: "issue_comment",
      commentId: 456,
      body: "published body",
    });

    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        prNumber: 123,
        gate: "review-details-output",
        gateResult: "completed",
        reviewOutputKey: "review-output-1",
        deliveryId: "delivery-1",
        surfaceKind: "issue_comment",
        hasCommentId: true,
        doctrineApplied: true,
      }),
      "Review Details publication completed",
    );
  });

  test("does not log canonical completion when no surface was published", () => {
    const info = mock(() => undefined);
    const runtime = createReviewDetailsPublicationRuntime({
      logger: { info },
      baseLog: {},
      reviewOutputKey: "review-output-1",
      deliveryId: "delivery-1",
      reviewDetailsBodyBase: baseReviewDetailsBodyParams(),
      hasOperationalSignal: false,
      getVisibleBudgetProjection: () => null,
      filteredFindings: [],
      reviewPhaseTimings: new Map(),
      getPublicationPhaseStartedAt: () => undefined,
    });

    runtime.logCanonicalReviewDetailsPublicationCompleted(undefined);

    expect(info).not.toHaveBeenCalled();
  });
});
