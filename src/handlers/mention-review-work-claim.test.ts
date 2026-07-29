import { describe, expect, mock, test } from "bun:test";
import {
  buildReviewFamilyKey,
  createReviewWorkCoordinator,
} from "../jobs/review-work-coordinator.ts";
import { claimMentionReviewWorkAttempt } from "./mention-review-work-claim.ts";
import type { MentionEvent } from "./mention-types.ts";

function mention(overrides: Partial<MentionEvent> = {}): MentionEvent {
  return {
    surface: "pr_comment",
    owner: "Acme",
    repo: "Widgets",
    issueNumber: 42,
    prNumber: 42,
    commentId: 1001,
    commentBody: "@kodiai review",
    commentAuthor: "alice",
    commentCreatedAt: "2026-01-01T00:00:00.000Z",
    headRef: "feature",
    headSha: "feature",
    baseRef: "main",
    headRepoOwner: "Acme",
    headRepoName: "Widgets",
    diffHunk: undefined,
    filePath: undefined,
    fileLine: undefined,
    inReplyToId: undefined,
    issueBody: null,
    issueTitle: "Example PR",
    ...overrides,
  };
}

describe("claimMentionReviewWorkAttempt", () => {
  test("does not claim review work outside explicit PR review requests", () => {
    const coordinator = createReviewWorkCoordinator();
    const logger = { info: mock((_fields: Record<string, unknown>, _message: string) => {}) };

    expect(claimMentionReviewWorkAttempt({
      coordinator,
      mention: mention({ prNumber: undefined }),
      reviewPrNumber: undefined,
      isExplicitReviewRequest: true,
      deliveryId: "delivery-1",
      logger,
    })).toBeUndefined();
    expect(claimMentionReviewWorkAttempt({
      coordinator,
      mention: mention(),
      reviewPrNumber: 42,
      isExplicitReviewRequest: false,
      deliveryId: "delivery-2",
      logger,
    })).toBeUndefined();

    expect(logger.info).not.toHaveBeenCalled();
  });

  test("claims explicit review work and logs the latest stale predecessor", () => {
    let now = 1_000;
    const coordinator = createReviewWorkCoordinator({ nowFn: () => now });
    const familyKey = buildReviewFamilyKey("Acme", "Widgets", 42);
    const olderAttempt = coordinator.claim({
      familyKey,
      source: "automatic-review",
      lane: "review",
      deliveryId: "older-delivery",
      phase: "publish",
    });
    now = 2_500;
    const logger = { info: mock((_fields: Record<string, unknown>, _message: string) => {}) };

    const attempt = claimMentionReviewWorkAttempt({
      coordinator,
      mention: mention(),
      reviewPrNumber: 42,
      isExplicitReviewRequest: true,
      deliveryId: "new-delivery",
      logger,
    });

    expect(attempt).toMatchObject({
      familyKey,
      source: "explicit-review",
      lane: "interactive-review",
      deliveryId: "new-delivery",
      phase: "claimed",
    });
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info.mock.calls[0]![0]).toEqual(expect.objectContaining({
      gate: "review-family-coordinator",
      gateResult: "claimed-with-predecessor",
      reviewFamilyKey: familyKey,
      reviewWorkAttemptId: attempt?.attemptId,
      predecessorAttemptId: olderAttempt.attemptId,
      predecessorPhase: "publish",
      predecessorAgeMs: 1_500,
    }));
  });
});
