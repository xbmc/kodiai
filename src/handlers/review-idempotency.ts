import type { Octokit } from "@octokit/rest";

export type ReviewOutputKeyInput = {
  installationId: number;
  owner: string;
  repo: string;
  prNumber: number;
  action: string;
  deliveryId: string;
  headSha: string;
};

export type ReviewOutputPublicationStatus = {
  reviewOutputKey: string;
  marker: string;
  shouldPublish: boolean;
  existingLocation: "review-comment" | "review" | null;
};

const KEY_PREFIX = "kodiai-review-output";

function normalizeSegment(value: string): string {
  return value.trim().toLowerCase();
}

export function buildReviewOutputKey(input: ReviewOutputKeyInput): string {
  const owner = normalizeSegment(input.owner);
  const repo = normalizeSegment(input.repo);
  const action = normalizeSegment(input.action);
  const deliveryId = normalizeSegment(input.deliveryId);
  const headSha = normalizeSegment(input.headSha);

  return [
    KEY_PREFIX,
    "v1",
    `inst-${input.installationId}`,
    `${owner}/${repo}`,
    `pr-${input.prNumber}`,
    `action-${action}`,
    `delivery-${deliveryId}`,
    `head-${headSha}`,
  ].join(":");
}

export function buildReviewOutputMarker(reviewOutputKey: string): string {
  return `<!-- kodiai:review-output-key:${reviewOutputKey} -->`;
}

export async function ensureReviewOutputNotPublished(deps: {
  octokit: Octokit;
  owner: string;
  repo: string;
  prNumber: number;
  reviewOutputKey: string;
}): Promise<ReviewOutputPublicationStatus> {
  const marker = buildReviewOutputMarker(deps.reviewOutputKey);

  const { data: reviewComments } = await deps.octokit.rest.pulls.listReviewComments({
    owner: deps.owner,
    repo: deps.repo,
    pull_number: deps.prNumber,
  });

  if (reviewComments.some((comment) => comment.body?.includes(marker))) {
    return {
      reviewOutputKey: deps.reviewOutputKey,
      marker,
      shouldPublish: false,
      existingLocation: "review-comment",
    };
  }

  const { data: reviews } = await deps.octokit.rest.pulls.listReviews({
    owner: deps.owner,
    repo: deps.repo,
    pull_number: deps.prNumber,
  });

  if (reviews.some((review) => review.body?.includes(marker))) {
    return {
      reviewOutputKey: deps.reviewOutputKey,
      marker,
      shouldPublish: false,
      existingLocation: "review",
    };
  }

  return {
    reviewOutputKey: deps.reviewOutputKey,
    marker,
    shouldPublish: true,
    existingLocation: null,
  };
}
