import { describe, expect, mock, test } from "bun:test";
import type { AttachReviewFindingLifecycleResult } from "../review-lifecycle/handler-lifecycle.ts";
import { projectExplicitMentionReviewLifecycle } from "./mention-explicit-review-lifecycle.ts";
import type { MentionEvent } from "./mention-types.ts";

function makeMention(overrides: Partial<MentionEvent> = {}): MentionEvent {
  return {
    surface: "pr_comment",
    owner: "octo-org",
    repo: "widget",
    issueNumber: 42,
    prNumber: 42,
    commentId: 99,
    commentBody: "@kodiai review this",
    commentAuthor: "mona",
    commentCreatedAt: "2026-07-06T12:00:00Z",
    headRef: "feature",
    baseRef: "main",
    headRepoOwner: "octo-org",
    headRepoName: "widget",
    diffHunk: undefined,
    filePath: undefined,
    fileLine: undefined,
    inReplyToId: undefined,
    issueBody: null,
    issueTitle: "Improve widget",
    ...overrides,
  };
}

function fakeLifecycleResult(): AttachReviewFindingLifecycleResult {
  return {
    status: "normalized",
    source: "mention",
    trigger: "issue_comment",
    lifecycle: { records: [] },
    projection: {},
    logEvidence: {
      gate: "review-finding-lifecycle",
      reviewOutputKey: "review-key",
      normalizedStatus: "normalized",
    },
  } as unknown as AttachReviewFindingLifecycleResult;
}

describe("projectExplicitMentionReviewLifecycle", () => {
  test("projects finding lifecycle and validation truth for explicit PR review mentions", () => {
    const lifecycleResult = fakeLifecycleResult();
    const attachLifecycle = mock((_input: unknown) => lifecycleResult);
    const projectValidationTruth = mock((_input: unknown) => "recorded");
    const info = mock((_fields: Record<string, unknown>, _message: string) => {});

    const result = projectExplicitMentionReviewLifecycle({
      explicitReviewRequest: true,
      eventName: "issue_comment",
      mention: makeMention(),
      reviewOutputKey: "review-key",
      deliveryId: "delivery-1",
      headSha: "head-sha",
      baseSha: "base-sha",
      candidateFinding: { status: "recorded" } as never,
      logger: { info } as never,
      attachLifecycle: attachLifecycle as never,
      projectValidationTruth: projectValidationTruth as never,
    });

    expect(result).toBe(lifecycleResult);
    expect(attachLifecycle).toHaveBeenCalledWith(expect.objectContaining({
      source: "mention",
      trigger: "issue_comment",
      correlation: expect.objectContaining({
        repo: "octo-org/widget",
        pullNumber: 42,
        reviewOutputKey: "review-key",
        deliveryId: "delivery-1",
        commitSha: "head-sha",
        headSha: "head-sha",
        baseSha: "base-sha",
        headRef: "feature",
        baseRef: "main",
      }),
      findings: [],
      candidateFinding: { status: "recorded" },
    }));
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: "pr_comment",
        owner: "octo-org",
        repo: "widget",
        prNumber: 42,
        gate: "review-finding-lifecycle",
        source: "explicit-mention-review",
      }),
      "Projected explicit mention review finding lifecycle evidence",
    );
    expect(projectValidationTruth).toHaveBeenCalledWith(expect.objectContaining({
      surface: "pr_comment",
      owner: "octo-org",
      repo: "widget",
      prNumber: 42,
      reviewOutputKey: "review-key",
      deliveryId: "delivery-1",
      lifecycleResult,
    }));
  });

  test("maps review comment and review body events to review_comment trigger", () => {
    const attachLifecycle = mock((_input: unknown) => fakeLifecycleResult());

    projectExplicitMentionReviewLifecycle({
      explicitReviewRequest: true,
      eventName: "pull_request_review_comment",
      mention: makeMention({ surface: "pr_review_comment" }),
      reviewOutputKey: "review-key",
      deliveryId: "delivery-1",
      candidateFinding: undefined,
      logger: { info: () => undefined } as never,
      attachLifecycle: attachLifecycle as never,
      projectValidationTruth: (() => "recorded") as never,
    });
    projectExplicitMentionReviewLifecycle({
      explicitReviewRequest: true,
      eventName: "pull_request_review",
      mention: makeMention({ surface: "pr_review_body" }),
      reviewOutputKey: "review-key",
      deliveryId: "delivery-2",
      candidateFinding: undefined,
      logger: { info: () => undefined } as never,
      attachLifecycle: attachLifecycle as never,
      projectValidationTruth: (() => "recorded") as never,
    });

    expect(attachLifecycle.mock.calls.map((call) => (call[0] as { trigger: string }).trigger)).toEqual([
      "review_comment",
      "review_comment",
    ]);
  });

  test("skips when request is not an explicit PR review with an output key", () => {
    const attachLifecycle = mock((_input: unknown) => fakeLifecycleResult());

    expect(projectExplicitMentionReviewLifecycle({
      explicitReviewRequest: false,
      eventName: "issue_comment",
      mention: makeMention(),
      reviewOutputKey: "review-key",
      deliveryId: "delivery-1",
      candidateFinding: undefined,
      logger: { info: () => undefined } as never,
      attachLifecycle: attachLifecycle as never,
      projectValidationTruth: (() => "recorded") as never,
    })).toBeNull();
    expect(projectExplicitMentionReviewLifecycle({
      explicitReviewRequest: true,
      eventName: "issue_comment",
      mention: makeMention({ prNumber: undefined }),
      reviewOutputKey: "review-key",
      deliveryId: "delivery-1",
      candidateFinding: undefined,
      logger: { info: () => undefined } as never,
      attachLifecycle: attachLifecycle as never,
      projectValidationTruth: (() => "recorded") as never,
    })).toBeNull();
    expect(projectExplicitMentionReviewLifecycle({
      explicitReviewRequest: true,
      eventName: "issue_comment",
      mention: makeMention(),
      reviewOutputKey: undefined,
      deliveryId: "delivery-1",
      candidateFinding: undefined,
      logger: { info: () => undefined } as never,
      attachLifecycle: attachLifecycle as never,
      projectValidationTruth: (() => "recorded") as never,
    })).toBeNull();
    expect(attachLifecycle).not.toHaveBeenCalled();
  });
});
