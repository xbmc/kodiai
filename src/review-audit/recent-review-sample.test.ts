import { describe, expect, test } from "bun:test";
import {
  classifyReviewOutputLane,
  collectLatestReviewArtifacts,
  selectRecentReviewSample,
  type RecentReviewArtifact,
} from "./recent-review-sample.ts";
import { buildReviewOutputKey, buildReviewOutputMarker } from "../handlers/review-idempotency.ts";

function makeArtifact(overrides: Partial<RecentReviewArtifact> & Pick<RecentReviewArtifact, "prNumber" | "updatedAt" | "lane">): RecentReviewArtifact {
  const reviewOutputKey = overrides.reviewOutputKey ?? buildReviewOutputKey({
    installationId: 42,
    owner: "xbmc",
    repo: "xbmc",
    prNumber: overrides.prNumber,
    action: overrides.lane === "explicit" ? "mention-review" : "review_requested",
    deliveryId: `delivery-${overrides.prNumber}`,
    headSha: `head-${overrides.prNumber}`,
  });

  return {
    prNumber: overrides.prNumber,
    prUrl: overrides.prUrl ?? `https://github.com/xbmc/xbmc/pull/${overrides.prNumber}`,
    source: overrides.source ?? "review",
    sourceUrl: overrides.sourceUrl ?? `https://github.com/xbmc/xbmc/pull/${overrides.prNumber}#discussion_r${overrides.prNumber}`,
    updatedAt: overrides.updatedAt,
    reviewOutputKey,
    lane: overrides.lane,
    action: overrides.action ?? (overrides.lane === "explicit" ? "mention-review" : "review_requested"),
  };
}

function createOctokitStub(records: Record<number, {
  reviewComments?: Array<{ body: string; html_url: string; updated_at: string }>;
  issueComments?: Array<{ body: string; html_url: string; updated_at: string }>;
  reviews?: Array<{ body: string; html_url: string; submitted_at?: string; updated_at?: string }>;
}>) {
  return {
    rest: {
      pulls: {
        listReviewComments: async ({ pull_number }: { pull_number: number }) => ({
          data: records[pull_number]?.reviewComments ?? [],
        }),
        listReviews: async ({ pull_number }: { pull_number: number }) => ({
          data: records[pull_number]?.reviews ?? [],
        }),
      },
      issues: {
        listComments: async ({ issue_number }: { issue_number: number }) => ({
          data: records[issue_number]?.issueComments ?? [],
        }),
      },
    },
  };
}

describe("recent review sample helpers", () => {
  test("classifyReviewOutputLane distinguishes automatic and explicit review lanes", () => {
    expect(classifyReviewOutputLane("review_requested")).toBe("automatic");
    expect(classifyReviewOutputLane("mention-review")).toBe("explicit");
    expect(classifyReviewOutputLane("unknown-action")).toBeNull();
  });

  test("collectLatestReviewArtifacts keeps only the latest valid marker-backed artifact per PR", async () => {
    const automaticKey = buildReviewOutputKey({
      installationId: 42,
      owner: "xbmc",
      repo: "xbmc",
      prNumber: 101,
      action: "review_requested",
      deliveryId: "delivery-101",
      headSha: "head-101",
    });
    const explicitKey = buildReviewOutputKey({
      installationId: 42,
      owner: "xbmc",
      repo: "xbmc",
      prNumber: 101,
      action: "mention-review",
      deliveryId: "delivery-101b",
      headSha: "head-101b",
    });
    const mismatchedKey = buildReviewOutputKey({
      installationId: 42,
      owner: "xbmc",
      repo: "xbmc",
      prNumber: 999,
      action: "review_requested",
      deliveryId: "delivery-999",
      headSha: "head-999",
    });

    const artifacts = await collectLatestReviewArtifacts({
      octokit: createOctokitStub({
        101: {
          reviews: [
            {
              body: `Older review\n\n${buildReviewOutputMarker(automaticKey)}`,
              html_url: "https://github.com/xbmc/xbmc/pull/101#pullrequestreview-1",
              submitted_at: "2026-04-08T10:00:00.000Z",
            },
          ],
          issueComments: [
            {
              body: `Newer issue comment\n\n${buildReviewOutputMarker(explicitKey)}`,
              html_url: "https://github.com/xbmc/xbmc/pull/101#issuecomment-2",
              updated_at: "2026-04-08T12:00:00.000Z",
            },
          ],
        },
        102: {
          reviewComments: [
            {
              body: `Wrong PR marker\n\n${buildReviewOutputMarker(mismatchedKey)}`,
              html_url: "https://github.com/xbmc/xbmc/pull/102#discussion_r3",
              updated_at: "2026-04-08T11:00:00.000Z",
            },
          ],
        },
      }) as never,
      owner: "xbmc",
      repo: "xbmc",
      pullRequests: [
        { number: 101, html_url: "https://github.com/xbmc/xbmc/pull/101" },
        { number: 102, html_url: "https://github.com/xbmc/xbmc/pull/102" },
      ],
    });

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.prNumber).toBe(101);
    expect(artifacts[0]?.lane).toBe("explicit");
    expect(artifacts[0]?.source).toBe("issue-comment");
    expect(artifacts[0]?.reviewOutputKey).toBe(explicitKey);
  });

  test("collectLatestReviewArtifacts accepts standalone review-details comments for clean automatic reviews", async () => {
    const automaticKey = buildReviewOutputKey({
      installationId: 42,
      owner: "xbmc",
      repo: "xbmc",
      prNumber: 103,
      action: "review_requested",
      deliveryId: "delivery-103",
      headSha: "head-103",
    });

    const artifacts = await collectLatestReviewArtifacts({
      octokit: createOctokitStub({
        103: {
          issueComments: [
            {
              body: `Standalone Review Details\n\n<!-- kodiai:review-details:${automaticKey} -->`,
              html_url: "https://github.com/xbmc/xbmc/pull/103#issuecomment-4",
              updated_at: "2026-04-08T13:00:00.000Z",
            },
          ],
        },
      }) as never,
      owner: "xbmc",
      repo: "xbmc",
      pullRequests: [
        { number: 103, html_url: "https://github.com/xbmc/xbmc/pull/103" },
      ],
    });

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.prNumber).toBe(103);
    expect(artifacts[0]?.lane).toBe("automatic");
    expect(artifacts[0]?.source).toBe("issue-comment");
    expect(artifacts[0]?.reviewOutputKey).toBe(automaticKey);
  });

  test("selectRecentReviewSample applies the per-lane cap and fill rule deterministically", () => {
    const automaticArtifacts = Array.from({ length: 10 }, (_, index) => makeArtifact({
      prNumber: 200 + index,
      lane: "automatic",
      updatedAt: `2026-04-08T${String(index).padStart(2, "0")}:00:00.000Z`,
    }));
    const explicitArtifacts = Array.from({ length: 2 }, (_, index) => makeArtifact({
      prNumber: 300 + index,
      lane: "explicit",
      updatedAt: `2026-04-09T0${index}:00:00.000Z`,
    }));

    const result = selectRecentReviewSample([...automaticArtifacts, ...explicitArtifacts], {
      perLaneLimit: 6,
      totalLimit: 12,
    });

    expect(result.artifacts).toHaveLength(12);
    expect(result.selection.selectedLaneCounts.automatic).toBe(10);
    expect(result.selection.selectedLaneCounts.explicit).toBe(2);
    expect(result.selection.fillCount).toBe(4);
    expect(result.artifacts[0]?.lane).toBe("explicit");
    expect(result.artifacts.at(-1)?.prNumber).toBe(200);
  });
});
