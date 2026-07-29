import { describe, expect, test } from "bun:test";
import {
  buildReviewFamilyKey,
  createReviewWorkCoordinator,
  type ReviewWorkCoordinator,
  type ReviewWorkAttempt,
} from "../jobs/review-work-coordinator.ts";
import type { MentionEvent } from "./mention-types.ts";
import {
  createMentionReviewWorkRuntime,
  usesCanonicalExplicitReviewHandle,
} from "./mention-review-work-runtime.ts";

function createMention(): MentionEvent {
  return {
    surface: "pr_comment",
    owner: "Acme",
    repo: "Widgets",
    issueNumber: 7,
    prNumber: 7,
    commentId: 101,
    commentBody: "@kodiai review this",
    commentAuthor: "octo",
    commentCreatedAt: "2026-07-06T00:00:00Z",
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
    issueTitle: "Improve widgets",
  };
}

function claimAttempt(coordinator: ReviewWorkCoordinator): ReviewWorkAttempt {
  return coordinator.claim({
    familyKey: buildReviewFamilyKey("Acme", "Widgets", 7),
    source: "explicit-review",
    lane: "interactive-review",
    deliveryId: "delivery-1",
    phase: "claimed",
  });
}

describe("mention review work runtime", () => {
  test("recognizes canonical explicit review handles only when review work is claimed", () => {
    const coordinator = createReviewWorkCoordinator();
    const attempt = claimAttempt(coordinator);

    expect(usesCanonicalExplicitReviewHandle({
      attempt,
      appSlug: "kodiai",
      commentBody: "Please @KODIAI review this",
    })).toBe(true);
    expect(usesCanonicalExplicitReviewHandle({
      attempt,
      appSlug: "kodiai",
      commentBody: "Please @kodai review this",
    })).toBe(true);
    expect(usesCanonicalExplicitReviewHandle({
      attempt: undefined,
      appSlug: "kodiai",
      commentBody: "Please @kodiai review this",
    })).toBe(false);
    expect(usesCanonicalExplicitReviewHandle({
      attempt,
      appSlug: "kodiai",
      commentBody: "Please @claude review this",
    })).toBe(false);
  });

  test("releases an uncommitted queued review attempt on finalize", () => {
    const coordinator = createReviewWorkCoordinator();
    const attempt = claimAttempt(coordinator);
    const runtime = createMentionReviewWorkRuntime({
      attempt,
      coordinator,
      mention: createMention(),
      logger: { info: () => undefined },
    });

    runtime.finalize();

    expect(coordinator.getSnapshot(attempt.familyKey)).toBeNull();
  });

  test("completes a queued review attempt after phase progress commits it", () => {
    const coordinator = createReviewWorkCoordinator();
    const attempt = claimAttempt(coordinator);
    const runtime = createMentionReviewWorkRuntime({
      attempt,
      coordinator,
      mention: createMention(),
      logger: { info: () => undefined },
    });

    runtime.setPhase("prompt-build");
    runtime.finalize();

    expect(coordinator.getSnapshot(attempt.familyKey)).toBeNull();
  });

  test("records publish-rights loss when a newer active attempt supersedes output", () => {
    const coordinator = createReviewWorkCoordinator();
    const attempt = claimAttempt(coordinator);
    const newerAttempt = claimAttempt(coordinator);
    coordinator.setPhase(attempt.attemptId, "prompt-build");
    coordinator.setPhase(newerAttempt.attemptId, "prompt-build");
    const infoEntries: unknown[] = [];
    const runtime = createMentionReviewWorkRuntime({
      attempt,
      coordinator,
      mention: createMention(),
      logger: {
        info(fields: unknown) {
          infoEntries.push(fields);
        },
      },
    });

    expect(runtime.canPublishExplicitReviewOutput("explicit mention review publish", "review-output-1")).toBe(false);

    expect(runtime.reviewPublishRightsLost).toBe(true);
    expect(infoEntries).toContainEqual(expect.objectContaining({
      gate: "review-family-coordinator",
      gateResult: "skipped",
      skipReason: "publish-rights-lost",
      reviewOutputKey: "review-output-1",
      reviewWorkAttemptId: attempt.attemptId,
      supersededByAttemptId: newerAttempt.attemptId,
    }));
  });
});
