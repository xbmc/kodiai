import { describe, expect, mock, test } from "bun:test";
import {
  buildReviewFamilyKey,
  createReviewWorkCoordinator,
} from "../jobs/review-work-coordinator.ts";
import { createMentionReviewWorkSession } from "./mention-review-work-session.ts";
import type { MentionEvent } from "./mention-types.ts";

function mention(overrides: Partial<MentionEvent> = {}): MentionEvent {
  return {
    surface: "pr_comment",
    owner: "Acme",
    repo: "Widgets",
    issueNumber: 42,
    prNumber: 42,
    commentId: 1001,
    commentBody: "@KodiAI review",
    commentAuthor: "alice",
    commentCreatedAt: "2026-01-01T00:00:00.000Z",
    headRef: "feature",
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

describe("createMentionReviewWorkSession", () => {
  test("claims explicit review work and exposes runtime publication gates", () => {
    const coordinator = createReviewWorkCoordinator();
    const logger = { info: mock((_fields: Record<string, unknown>, _message?: string) => {}) };

    const session = createMentionReviewWorkSession({
      coordinator,
      mention: mention(),
      reviewPrNumber: 42,
      isExplicitReviewRequest: true,
      deliveryId: "delivery-1",
      appSlug: "kodiai",
      logger,
    });

    expect(session.reviewWorkAttempt).toMatchObject({
      familyKey: buildReviewFamilyKey("Acme", "Widgets", 42),
      source: "explicit-review",
      lane: "interactive-review",
      deliveryId: "delivery-1",
      phase: "claimed",
    });
    expect(session.explicitReviewUsesCanonicalHandle).toBe(true);

    session.setReviewWorkPhase("prompt-build");
    expect(session.canPublishExplicitReviewOutput("test output", "review-output-1")).toBe(true);
    session.runtime.finalize();

    expect(coordinator.getSnapshot(buildReviewFamilyKey("Acme", "Widgets", 42))).toBeNull();
  });

  test("does not claim non-explicit review work", () => {
    const coordinator = createReviewWorkCoordinator();

    const session = createMentionReviewWorkSession({
      coordinator,
      mention: mention({ commentBody: "@kodiai explain this" }),
      reviewPrNumber: 42,
      isExplicitReviewRequest: false,
      deliveryId: "delivery-1",
      appSlug: "kodiai",
      logger: { info: () => undefined },
    });

    expect(session.reviewWorkAttempt).toBeUndefined();
    expect(session.explicitReviewUsesCanonicalHandle).toBe(false);
    expect(session.canPublishExplicitReviewOutput("test output")).toBe(true);
    expect(coordinator.getSnapshot(buildReviewFamilyKey("Acme", "Widgets", 42))).toBeNull();
  });
});
