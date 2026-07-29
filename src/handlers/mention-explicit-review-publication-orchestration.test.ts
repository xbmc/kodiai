import { describe, expect, mock, test } from "bun:test";
import { publishExplicitMentionReviewIfEligible } from "./mention-explicit-review-publication-orchestration.ts";
import type { MentionEvent } from "./mention-types.ts";

function baseMention(): MentionEvent {
  return {
    surface: "pr_comment",
    owner: "owner",
    repo: "repo",
    issueNumber: 17,
    prNumber: 17,
    commentId: 123,
    commentBody: "@kodiai review",
    commentAuthor: "octocat",
    commentCreatedAt: "2026-07-07T00:00:00Z",
    headRef: "feature",
    headSha: "feature",
    baseRef: "main",
    headRepoOwner: "owner",
    headRepoName: "repo",
    diffHunk: undefined,
    filePath: undefined,
    fileLine: undefined,
    inReplyToId: undefined,
    issueBody: null,
    issueTitle: "PR title",
  };
}

describe("publishExplicitMentionReviewIfEligible", () => {
  test("returns decision evidence without publishing when explicit review output is ineligible", async () => {
    const projectLifecycle = mock(() => null);
    const resolvePublishDecision = mock(() => ({
      evaluation: {
        eligible: false,
        skipReason: "result-text-findings" as const,
        findingLines: ["- (1) [major] src/a.ts (10): Broken branch"],
        hasUnpublishedFindings: true,
      },
      findingLines: ["- (1) [major] src/a.ts (10): Broken branch"],
      eligible: false,
    }));
    const publishReview = mock(async () => {
      throw new Error("publish should not be called");
    });
    const getOctokit = mock(async () => {
      throw new Error("octokit should not be requested");
    });

    const result = await publishExplicitMentionReviewIfEligible({
      explicitReviewRequest: true,
      eventName: "issue_comment",
      mention: baseMention(),
      reviewOutputKey: "review-key",
      canonicalReviewSurfaceKey: "canonical-review-key",
      deliveryId: "delivery-1",
      installationId: 123,
      headSha: "head-sha",
      baseSha: "base-sha",
      result: {
        conclusion: "success",
        published: false,
        usedRepoInspectionTools: true,
        resultText: "found issue",
        toolUseNames: ["review_output"],
      },
      appSlug: "kodiai",
      autoApprove: true,
      explicitReviewPromptFileCount: 2,
      getOctokit,
      canPublishExplicitReviewOutput: () => true,
      setReviewWorkPhase: () => {},
      postMentionError: async () => ({ ok: true, value: "error-comment-created" }),
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never,
      projectLifecycle,
      resolvePublishDecision,
      publishReview,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw result.err;
    expect(result.value.explicitReviewPublication).toBeNull();
    expect(result.value.explicitReviewPublishEvaluation).toMatchObject({
      eligible: false,
      skipReason: "result-text-findings",
      hasUnpublishedFindings: true,
    });
    expect(result.value.explicitReviewResultFindingLines).toEqual([
      "- (1) [major] src/a.ts (10): Broken branch",
    ]);
    expect(projectLifecycle).toHaveBeenCalledTimes(1);
    expect(resolvePublishDecision).toHaveBeenCalledTimes(1);
    expect(getOctokit).not.toHaveBeenCalled();
    expect(publishReview).not.toHaveBeenCalled();
  });
});
