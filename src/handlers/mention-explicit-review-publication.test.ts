import { describe, expect, mock, test } from "bun:test";
import type { Logger } from "pino";
import { ok as resultOk, err as resultErr } from "../lib/result.ts";
import { publishExplicitMentionReviewResult } from "./mention-explicit-review-publication.ts";
import type { MentionErrorPostResult } from "./mention-publication-state.ts";

function publicationStatus(overrides: Partial<{
  shouldPublish: boolean;
  existingLocation: "review-comment" | "issue-comment" | "review" | null;
  idempotencyDecision: "publish" | "skip-existing-review-comment" | "skip-existing-issue-comment" | "skip-existing-review";
}> = {}) {
  const shouldPublish = overrides.shouldPublish ?? true;
  return {
    reviewOutputKey: "review-key",
    marker: "<!-- kodiai:review-output-key:review-key -->",
    shouldPublish,
    publicationState: shouldPublish ? "publish" as const : "skip-existing-output" as const,
    existingLocation: overrides.existingLocation ?? null,
    idempotencyDecision: overrides.idempotencyDecision ?? "publish",
    scanStats: {
      reviewComments: { scanned: 0, hitCap: false },
      issueComments: { scanned: 0, hitCap: false },
      reviews: { scanned: 0, hitCap: false },
    },
  };
}

function createOctokit(options: {
  existingMarkerOnFirstScan?: boolean;
  existingMarkerOnSecondScan?: boolean;
  createReviewThrows?: boolean;
}) {
  let scanCount = 0;
  const createReview = mock(async (_params: unknown) => {
    if (options.createReviewThrows) {
      throw Object.assign(new Error("github rejected review"), { status: 500 });
    }
    return { data: { id: 10 } };
  });
  const listReviewComments = mock(async () => {
    scanCount += 1;
    const shouldReturnMarker = scanCount === 1
      ? options.existingMarkerOnFirstScan
      : options.existingMarkerOnSecondScan;
    return {
      data: shouldReturnMarker
        ? [{ id: 20, body: publicationStatus().marker }]
        : [],
    };
  });
  const listComments = mock(async () => ({ data: [] }));
  const listReviews = mock(async () => ({ data: [] }));
  return {
    octokit: {
      rest: {
        pulls: {
          createReview,
          listReviewComments,
          listReviews,
        },
        issues: {
          createComment: mock(async () => ({ data: { id: 11 } })),
          listComments,
        },
      },
    },
    createReview,
    listReviewComments,
  };
}

function baseParams(overrides: Partial<Parameters<typeof publishExplicitMentionReviewResult>[0]> = {}) {
  const { octokit } = createOctokit({});
  return {
    octokit: octokit as never,
    owner: "octo-org",
    repo: "widget",
    prNumber: 42,
    surface: "issue_comment",
    deliveryId: "delivery-1",
    installationId: 123,
    reviewOutputKey: "review-key",
    canonicalReviewSurfaceKey: "review-key",
    appSlug: "kodiai",
    autoApprove: true,
    usedRepoInspectionTools: true,
    explicitReviewPromptFileCount: 2,
    explicitReviewFindingLifecycleResult: null,
    canPublishExplicitReviewOutput: mock(() => true),
    setReviewWorkPhase: mock((_phase: "publish") => {}),
    postMentionError: mock(async (_body: string): Promise<MentionErrorPostResult> => resultOk("error-comment-created")),
    summarizeError: (error: unknown) => error instanceof Error ? error.message : String(error),
    logger: {
      info: mock(() => {}),
      warn: mock(() => {}),
    } as unknown as Logger,
    ...overrides,
  };
}

describe("publishExplicitMentionReviewResult", () => {
  test("skips approval publication when review output marker already exists", async () => {
    const harness = createOctokit({ existingMarkerOnFirstScan: true });
    const result = await publishExplicitMentionReviewResult(baseParams({
      octokit: harness.octokit as never,
    }));

    expect(result).toEqual({
      ok: true,
      value: {
        outputPublished: true,
        resolution: "idempotency-skip",
        fallbackDelivery: null,
      },
    });
    expect(harness.createReview).not.toHaveBeenCalled();
  });

  test("publishes approval review with evidence when idempotency allows publication", async () => {
    const harness = createOctokit({});
    const result = await publishExplicitMentionReviewResult(baseParams({
      octokit: harness.octokit as never,
    }));

    expect(result).toEqual({
      ok: true,
      value: {
        outputPublished: true,
        resolution: "approval-bridge",
        fallbackDelivery: null,
      },
    });
    expect(harness.createReview).toHaveBeenCalledTimes(1);
    const call = harness.createReview.mock.calls[0]![0] as { body: string; event: string };
    expect(call.event).toBe("APPROVE");
    expect(call.body).toContain("Decision: APPROVE");
    expect(call.body).toContain("Review prompt covered 2 changed files.");
    expect(call.body).toContain("Repo inspection tools were used to verify the changed code.");
    expect(call.body).toContain("<!-- kodiai:review-output-key:review-key -->");
  });

  test("never leaks lifecycle telemetry counts into the published APPROVE body, even when non-blocking findings were recorded", async () => {
    // Regression guard for PR #206: kodiai once published "Decision: APPROVE"
    // / "Issues: none" in the same comment as an internal telemetry line
    // reporting non-zero minor findings (severity=...minor:2), contradicting
    // itself. That telemetry line is now log-only -- verify it never
    // reappears in the published body, whatever findings were recorded.
    const harness = createOctokit({});
    const result = await publishExplicitMentionReviewResult(baseParams({
      octokit: harness.octokit as never,
      explicitReviewFindingLifecycleResult: {
        projection: {
          schema: "review-finding-lifecycle.v1",
          status: "normalized",
          counts: {
            input: 2,
            recorded: 2,
            rejected: 0,
            unsafeInputFields: 0,
            status: { detected: 2, open: 2, validated: 0, degraded: 0 },
            severity: { critical: 0, major: 0, medium: 0, minor: 2 },
            actionability: { actionable: 0, "needs-human-review": 2, blocked: 0 },
          },
          rejectedReasonCodes: [],
          redaction: { unsafeInputFieldCount: 0 },
        },
      } as never,
    }));

    expect(result.ok).toBe(true);
    expect(harness.createReview).toHaveBeenCalledTimes(1);
    const call = harness.createReview.mock.calls[0]![0] as { body: string; event: string };
    expect(call.event).toBe("APPROVE");
    expect(call.body).toContain("Decision: APPROVE");
    expect(call.body).not.toContain("severity=");
    expect(call.body).not.toContain("actionability=");
    expect(call.body).not.toContain("needs-human-review");
  });

  test("publishes an approval-shaped comment instead of a pull review when autoApprove is false", async () => {
    const harness = createOctokit({});
    const result = await publishExplicitMentionReviewResult(baseParams({
      octokit: harness.octokit as never,
      autoApprove: false,
    }));

    expect(result).toEqual({
      ok: true,
      value: {
        outputPublished: true,
        resolution: "comment-approval",
        fallbackDelivery: null,
      },
    });
    expect(harness.createReview).not.toHaveBeenCalled();
    const createComment = harness.octokit.rest.issues.createComment as unknown as {
      mock: { calls: unknown[][] };
    };
    expect(createComment.mock.calls).toHaveLength(1);
    const call = createComment.mock.calls[0]![0] as { body: string };
    expect(call.body).toContain("Decision: APPROVE");
    expect(call.body).toContain("<!-- kodiai:review-output-key:review-key -->");
  });

  test("suppresses fallback when failed approval publish is visible on recheck", async () => {
    const harness = createOctokit({
      createReviewThrows: true,
      existingMarkerOnSecondScan: true,
    });
    const result = await publishExplicitMentionReviewResult(baseParams({
      octokit: harness.octokit as never,
    }));

    expect(result).toEqual({
      ok: true,
      value: {
        outputPublished: true,
        resolution: "duplicate-suppressed",
        failureCategory: "api_error",
        fallbackDelivery: null,
      },
    });
  });

  test("posts fallback error and reports delivery when approval publish fails", async () => {
    const harness = createOctokit({ createReviewThrows: true });
    const postMentionError = mock(async (_body: string): Promise<MentionErrorPostResult> =>
      resultErr(new Error("comment failed"))
    );
    const result = await publishExplicitMentionReviewResult(baseParams({
      octokit: harness.octokit as never,
      postMentionError,
    }));

    expect(result).toEqual({
      ok: false,
      err: {
        outputPublished: false,
        resolution: "publish-failure-comment-failed",
        failureCategory: "api_error",
        fallbackDelivery: "error-comment-failed",
      },
    });
    expect(postMentionError).toHaveBeenCalledTimes(1);
  });
});
