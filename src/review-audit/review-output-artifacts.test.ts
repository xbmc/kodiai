import { describe, expect, test } from "bun:test";
import {
  buildApprovedReviewBody,
  buildReviewOutputKey,
  buildReviewOutputMarker,
} from "../handlers/review-idempotency.ts";
import {
  ReviewOutputArtifactCollectionError,
  collectReviewOutputArtifacts,
  evaluateExactReviewOutputProof,
  validateCollapsedApproveReviewBody,
} from "./review-output-artifacts.ts";

function makeReviewOutputKey(overrides?: Partial<{
  owner: string;
  repo: string;
  prNumber: number;
  action: string;
  deliveryId: string;
  headSha: string;
}>) {
  return buildReviewOutputKey({
    installationId: 42,
    owner: overrides?.owner ?? "xbmc",
    repo: overrides?.repo ?? "kodiai",
    prNumber: overrides?.prNumber ?? 101,
    action: overrides?.action ?? "mention-review",
    deliveryId: overrides?.deliveryId ?? "delivery-101",
    headSha: overrides?.headSha ?? "head-101",
  });
}

function createOctokitStub(options?: {
  reviewComments?: Array<{ body?: string | null; html_url?: string; updated_at?: string }>;
  issueComments?: Array<{ body?: string | null; html_url?: string; updated_at?: string }>;
  reviews?: Array<{ body?: string | null; html_url?: string; submitted_at?: string; updated_at?: string; state?: string }>;
  failures?: Partial<Record<"reviewComments" | "issueComments" | "reviews", Error>>;
}) {
  const calls = {
    reviewComments: [] as Array<Record<string, unknown>>,
    issueComments: [] as Array<Record<string, unknown>>,
    reviews: [] as Array<Record<string, unknown>>,
  };

  return {
    calls,
    octokit: {
      rest: {
        pulls: {
          listReviewComments: async (args: Record<string, unknown>) => {
            calls.reviewComments.push(args);
            if (options?.failures?.reviewComments) {
              throw options.failures.reviewComments;
            }
            return { data: options?.reviewComments ?? [] };
          },
          listReviews: async (args: Record<string, unknown>) => {
            calls.reviews.push(args);
            if (options?.failures?.reviews) {
              throw options.failures.reviews;
            }
            return { data: options?.reviews ?? [] };
          },
        },
        issues: {
          listComments: async (args: Record<string, unknown>) => {
            calls.issueComments.push(args);
            if (options?.failures?.issueComments) {
              throw options.failures.issueComments;
            }
            return { data: options?.issueComments ?? [] };
          },
        },
      },
    },
  };
}

describe("review output artifact helpers", () => {
  test("collectReviewOutputArtifacts returns exact per-surface counts and preserves matching metadata", async () => {
    const reviewOutputKey = makeReviewOutputKey();
    const wrongRepoKey = makeReviewOutputKey({ repo: "other-repo" });
    const wrongPrKey = makeReviewOutputKey({ prNumber: 999 });
    const wrongActionKey = makeReviewOutputKey({ action: "review_requested" });
    const validReviewBody = buildApprovedReviewBody({
      reviewOutputKey,
      evidence: ["Reviewed the changed files and found no actionable issues."],
    });

    const { octokit, calls } = createOctokitStub({
      reviewComments: [
        {
          body: `Inline note\n\n${buildReviewOutputMarker(reviewOutputKey)}`,
          html_url: "https://github.com/xbmc/kodiai/pull/101#discussion_r1",
          updated_at: "2026-04-10T10:00:00.000Z",
        },
        {
          body: `Wrong action\n\n${buildReviewOutputMarker(wrongActionKey)}`,
          html_url: "https://github.com/xbmc/kodiai/pull/101#discussion_r2",
          updated_at: "2026-04-10T10:01:00.000Z",
        },
      ],
      issueComments: [
        {
          body: `Summary comment\n\n${buildReviewOutputMarker(reviewOutputKey)}`,
          html_url: "https://github.com/xbmc/kodiai/pull/101#issuecomment-1",
          updated_at: "2026-04-10T11:00:00.000Z",
        },
        {
          body: `Wrong repo\n\n${buildReviewOutputMarker(wrongRepoKey)}`,
          html_url: "https://github.com/xbmc/kodiai/pull/101#issuecomment-2",
          updated_at: "2026-04-10T11:01:00.000Z",
        },
      ],
      reviews: [
        {
          body: validReviewBody,
          html_url: "https://github.com/xbmc/kodiai/pull/101#pullrequestreview-1",
          submitted_at: "2026-04-10T12:00:00.000Z",
          state: "APPROVED",
        },
        {
          body: `Wrong PR\n\n${buildReviewOutputMarker(wrongPrKey)}`,
          html_url: "https://github.com/xbmc/kodiai/pull/101#pullrequestreview-2",
          submitted_at: "2026-04-10T12:01:00.000Z",
          state: "APPROVED",
        },
      ],
    });

    const result = await collectReviewOutputArtifacts({
      octokit: octokit as never,
      reviewOutputKey,
    });

    expect(calls.reviewComments).toEqual([
      {
        owner: "xbmc",
        repo: "kodiai",
        pull_number: 101,
        per_page: 100,
        page: 1,
        sort: "created",
        direction: "desc",
      },
    ]);
    expect(calls.issueComments).toEqual([
      {
        owner: "xbmc",
        repo: "kodiai",
        issue_number: 101,
        per_page: 100,
        page: 1,
        sort: "created",
        direction: "desc",
      },
    ]);
    expect(calls.reviews).toEqual([
      {
        owner: "xbmc",
        repo: "kodiai",
        pull_number: 101,
        per_page: 100,
        page: 1,
      },
    ]);

    expect(result.artifactCounts).toEqual({
      reviewComments: 1,
      issueComments: 1,
      reviews: 1,
      total: 3,
    });
    expect(result.artifacts).toHaveLength(3);
    expect(result.artifacts.map((artifact) => artifact.source)).toEqual([
      "review-comment",
      "issue-comment",
      "review",
    ]);
    expect(result.artifacts[2]).toMatchObject({
      source: "review",
      sourceUrl: "https://github.com/xbmc/kodiai/pull/101#pullrequestreview-1",
      updatedAt: "2026-04-10T12:00:00.000Z",
      body: validReviewBody,
      reviewState: "APPROVED",
      action: "mention-review",
      lane: "explicit",
      reviewOutputKey,
    });
  });

  test("collectReviewOutputArtifacts rejects malformed reviewOutputKey values before any GitHub calls", async () => {
    const { octokit, calls } = createOctokitStub();

    await expect(
      collectReviewOutputArtifacts({
        octokit: octokit as never,
        reviewOutputKey: "not-a-review-output-key",
      }),
    ).rejects.toMatchObject({
      code: "invalid_review_output_key",
    } satisfies Partial<ReviewOutputArtifactCollectionError>);

    expect(calls.reviewComments).toHaveLength(0);
    expect(calls.issueComments).toHaveLength(0);
    expect(calls.reviews).toHaveLength(0);
  });

  test("collectReviewOutputArtifacts propagates named GitHub collection failures", async () => {
    const reviewOutputKey = makeReviewOutputKey();
    const { octokit } = createOctokitStub({
      failures: {
        reviewComments: new Error("GitHub timed out"),
      },
    });

    await expect(
      collectReviewOutputArtifacts({
        octokit: octokit as never,
        reviewOutputKey,
      }),
    ).rejects.toMatchObject({
      code: "review_output_artifact_collection_failed",
      endpoint: "reviewComments",
    } satisfies Partial<ReviewOutputArtifactCollectionError>);
  });

  test("validateCollapsedApproveReviewBody accepts the shipped collapsed APPROVE grammar with 1-3 bullets", () => {
    const oneBulletKey = makeReviewOutputKey({ deliveryId: "delivery-one" });
    const threeBulletKey = makeReviewOutputKey({ deliveryId: "delivery-three" });

    const oneBullet = validateCollapsedApproveReviewBody({
      reviewOutputKey: oneBulletKey,
      body: buildApprovedReviewBody({
        reviewOutputKey: oneBulletKey,
        evidence: ["Reviewed the touched files and found no actionable issues."],
      }),
    });
    const threeBullets = validateCollapsedApproveReviewBody({
      reviewOutputKey: threeBulletKey,
      body: buildApprovedReviewBody({
        reviewOutputKey: threeBulletKey,
        evidence: [
          "Reviewed the touched files and found no actionable issues.",
          "The approval body matches the collapsed GitHub contract.",
          "No visible approval body drift is present.",
        ],
      }),
    });

    expect(oneBullet.valid).toBe(true);
    expect(oneBullet.evidenceBulletCount).toBe(1);
    expect(oneBullet.hasExactMarker).toBe(true);
    expect(oneBullet.hasDetailsWrapper).toBe(true);

    expect(threeBullets.valid).toBe(true);
    expect(threeBullets.evidenceBulletCount).toBe(3);
    expect(threeBullets.hasOnlyEvidenceBullets).toBe(true);
    expect(threeBullets.issues).toEqual([]);
  });

  test("validateCollapsedApproveReviewBody rejects missing Evidence bullets, overflow bullets, and visible-body drift", () => {
    const reviewOutputKey = makeReviewOutputKey();

    const zeroBullets = validateCollapsedApproveReviewBody({
      reviewOutputKey,
      body: [
        "Decision: APPROVE",
        "Issues: none",
        "",
        "Evidence:",
        "",
        buildReviewOutputMarker(reviewOutputKey),
      ].join("\n"),
    });
    const fourBullets = validateCollapsedApproveReviewBody({
      reviewOutputKey,
      body: [
        "Decision: APPROVE",
        "Issues: none",
        "",
        "Evidence:",
        "- Evidence line one.",
        "- Evidence line two.",
        "- Evidence line three.",
        "- Evidence line four.",
        "",
        buildReviewOutputMarker(reviewOutputKey),
      ].join("\n"),
    });
    const visible = validateCollapsedApproveReviewBody({
      reviewOutputKey,
      body: [
        "Decision: APPROVE",
        "Issues: none",
        "",
        "Evidence:",
        "- Reviewed the changed files.",
        "",
        buildReviewOutputMarker(reviewOutputKey),
      ].join("\n"),
    });

    expect(zeroBullets.valid).toBe(false);
    expect(zeroBullets.evidenceBulletCount).toBe(0);
    expect(zeroBullets.issues).toContain("Approval body must include 1-3 evidence bullets.");

    expect(fourBullets.valid).toBe(false);
    expect(fourBullets.evidenceBulletCount).toBe(4);
    expect(fourBullets.issues).toContain("Approval body must include 1-3 evidence bullets.");

    expect(visible.valid).toBe(false);
    expect(visible.hasDetailsWrapper).toBe(false);
    expect(visible.issues).toContain("Approval body must use collapsed <details> wrapper text.");
  });

  test("evaluateExactReviewOutputProof passes only for one APPROVED review with the shared collapsed body", async () => {
    const reviewOutputKey = makeReviewOutputKey();
    const { octokit } = createOctokitStub({
      reviews: [
        {
          body: buildApprovedReviewBody({
            reviewOutputKey,
            evidence: ["Reviewed the touched files and found no actionable issues."],
          }),
          html_url: "https://github.com/xbmc/kodiai/pull/101#pullrequestreview-7",
          submitted_at: "2026-04-10T12:00:00.000Z",
          state: "APPROVED",
        },
      ],
    });

    const collection = await collectReviewOutputArtifacts({
      octokit: octokit as never,
      reviewOutputKey,
    });
    const result = evaluateExactReviewOutputProof(collection);

    expect(result.status).toBe("ok");
    expect(result.ok).toBe(true);
    expect(result.artifact?.source).toBe("review");
    expect(result.artifact?.reviewState).toBe("APPROVED");
    expect(result.validation?.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  test("evaluateExactReviewOutputProof names duplicate visible outputs instead of collapsing them into missing-artifact", async () => {
    const reviewOutputKey = makeReviewOutputKey();
    const { octokit } = createOctokitStub({
      issueComments: [
        {
          body: `Issue comment\n\n${buildReviewOutputMarker(reviewOutputKey)}`,
          html_url: "https://github.com/xbmc/kodiai/pull/101#issuecomment-1",
          updated_at: "2026-04-10T10:00:00.000Z",
        },
      ],
      reviews: [
        {
          body: buildApprovedReviewBody({
            reviewOutputKey,
            evidence: ["Reviewed the touched files and found no actionable issues."],
          }),
          html_url: "https://github.com/xbmc/kodiai/pull/101#pullrequestreview-7",
          submitted_at: "2026-04-10T12:00:00.000Z",
          state: "APPROVED",
        },
      ],
    });

    const result = evaluateExactReviewOutputProof(
      await collectReviewOutputArtifacts({
        octokit: octokit as never,
        reviewOutputKey,
      }),
    );

    expect(result.status).toBe("duplicate_artifacts");
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toContain("Expected exactly one visible GitHub artifact");
    expect(result.issues[0]).toContain("issueComments=1");
    expect(result.issues[0]).toContain("reviews=1");
  });

  test("evaluateExactReviewOutputProof names the wrong GitHub surface when the only match is not a review", async () => {
    const reviewOutputKey = makeReviewOutputKey();
    const { octokit } = createOctokitStub({
      issueComments: [
        {
          body: `Issue comment\n\n${buildReviewOutputMarker(reviewOutputKey)}`,
          html_url: "https://github.com/xbmc/kodiai/pull/101#issuecomment-1",
          updated_at: "2026-04-10T10:00:00.000Z",
        },
      ],
    });

    const result = evaluateExactReviewOutputProof(
      await collectReviewOutputArtifacts({
        octokit: octokit as never,
        reviewOutputKey,
      }),
    );

    expect(result.status).toBe("wrong_artifact_source");
    expect(result.ok).toBe(false);
    expect(result.issues).toContain("Expected the sole matching GitHub artifact to be a pull request review, found issue-comment.");
  });

  test("evaluateExactReviewOutputProof names the wrong review state when the sole review is not APPROVED", async () => {
    const reviewOutputKey = makeReviewOutputKey();
    const { octokit } = createOctokitStub({
      reviews: [
        {
          body: buildApprovedReviewBody({
            reviewOutputKey,
            evidence: ["Reviewed the touched files and found no actionable issues."],
          }),
          html_url: "https://github.com/xbmc/kodiai/pull/101#pullrequestreview-7",
          submitted_at: "2026-04-10T12:00:00.000Z",
          state: "COMMENTED",
        },
      ],
    });

    const result = evaluateExactReviewOutputProof(
      await collectReviewOutputArtifacts({
        octokit: octokit as never,
        reviewOutputKey,
      }),
    );

    expect(result.status).toBe("wrong_review_state");
    expect(result.ok).toBe(false);
    expect(result.issues).toContain("Expected the sole matching review to have state APPROVED, found COMMENTED.");
  });

  test("evaluateExactReviewOutputProof names visible-body drift when the sole APPROVED review body no longer matches contract", async () => {
    const reviewOutputKey = makeReviewOutputKey();
    const { octokit } = createOctokitStub({
      reviews: [
        {
          body: [
            "Decision: APPROVE",
            "Issues: none",
            "",
            "- Reviewed the touched files and found no actionable issues.",
            "",
            buildReviewOutputMarker(reviewOutputKey),
          ].join("\n"),
          html_url: "https://github.com/xbmc/kodiai/pull/101#pullrequestreview-7",
          submitted_at: "2026-04-10T12:00:00.000Z",
          state: "APPROVED",
        },
      ],
    });

    const result = evaluateExactReviewOutputProof(
      await collectReviewOutputArtifacts({
        octokit: octokit as never,
        reviewOutputKey,
      }),
    );

    expect(result.status).toBe("body_drift");
    expect(result.ok).toBe(false);
    expect(result.validation?.valid).toBe(false);
    expect(result.issues).toContain("Approval body must include 'Evidence:'.");
  });

  test("evaluateExactReviewOutputProof surfaces invalid metadata when a matching review lacks URL, timestamp, or state", () => {
    const reviewOutputKey = makeReviewOutputKey();
    const body = buildApprovedReviewBody({
      reviewOutputKey,
      evidence: ["Reviewed the touched files and found no actionable issues."],
    });

    const missingUrl = evaluateExactReviewOutputProof({
      requestedReviewOutputKey: reviewOutputKey,
      prUrl: "https://github.com/xbmc/kodiai/pull/101",
      artifactCounts: { reviewComments: 0, issueComments: 0, reviews: 1, total: 1 },
      artifacts: [
        {
          prNumber: 101,
          prUrl: "https://github.com/xbmc/kodiai/pull/101",
          source: "review",
          sourceUrl: null,
          updatedAt: "2026-04-10T12:00:00.000Z",
          reviewOutputKey,
          lane: "explicit",
          action: "mention-review",
          body,
          reviewState: "APPROVED",
        },
      ],
    });
    const missingTimestamp = evaluateExactReviewOutputProof({
      requestedReviewOutputKey: reviewOutputKey,
      prUrl: "https://github.com/xbmc/kodiai/pull/101",
      artifactCounts: { reviewComments: 0, issueComments: 0, reviews: 1, total: 1 },
      artifacts: [
        {
          prNumber: 101,
          prUrl: "https://github.com/xbmc/kodiai/pull/101",
          source: "review",
          sourceUrl: "https://github.com/xbmc/kodiai/pull/101#pullrequestreview-7",
          updatedAt: null,
          reviewOutputKey,
          lane: "explicit",
          action: "mention-review",
          body,
          reviewState: "APPROVED",
        },
      ],
    });
    const missingState = evaluateExactReviewOutputProof({
      requestedReviewOutputKey: reviewOutputKey,
      prUrl: "https://github.com/xbmc/kodiai/pull/101",
      artifactCounts: { reviewComments: 0, issueComments: 0, reviews: 1, total: 1 },
      artifacts: [
        {
          prNumber: 101,
          prUrl: "https://github.com/xbmc/kodiai/pull/101",
          source: "review",
          sourceUrl: "https://github.com/xbmc/kodiai/pull/101#pullrequestreview-7",
          updatedAt: "2026-04-10T12:00:00.000Z",
          reviewOutputKey,
          lane: "explicit",
          action: "mention-review",
          body,
          reviewState: null,
        },
      ],
    });

    expect(missingUrl.status).toBe("invalid_artifact_metadata");
    expect(missingUrl.issues).toContain("Matching artifact is missing sourceUrl.");

    expect(missingTimestamp.status).toBe("invalid_artifact_metadata");
    expect(missingTimestamp.issues).toContain("Matching artifact is missing updatedAt timestamp.");

    expect(missingState.status).toBe("invalid_artifact_metadata");
    expect(missingState.issues).toContain("Matching review artifact is missing reviewState.");
  });
});
