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
  existingLocation: "review-comment" | "issue-comment" | "review" | null;
};

const KEY_PREFIX = "kodiai-review-output";

const DEFAULT_PER_PAGE = 100;
const DEFAULT_MAX_SCAN_ITEMS = 2000;

async function scanForMarkerInPagedBodies<T extends { body?: string | null }>(params: {
  marker: string;
  perPage?: number;
  maxItems?: number;
  fetchPage: (args: { page: number; per_page: number }) => Promise<T[]>;
}): Promise<{ found: boolean; scanned: number; hitCap: boolean }> {
  const perPage = params.perPage ?? DEFAULT_PER_PAGE;
  const maxItems = params.maxItems ?? DEFAULT_MAX_SCAN_ITEMS;

  let scanned = 0;
  for (let page = 1; scanned < maxItems; page++) {
    const data = await params.fetchPage({ page, per_page: perPage });
    for (const item of data) {
      scanned++;
      if (item.body?.includes(params.marker)) {
        return { found: true, scanned, hitCap: false };
      }
      if (scanned >= maxItems) break;
    }
    if (data.length < perPage) {
      return { found: false, scanned, hitCap: false };
    }
  }

  return { found: false, scanned, hitCap: true };
}

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

  const reviewCommentsScan = await scanForMarkerInPagedBodies({
    marker,
    fetchPage: async ({ page, per_page }) => {
      const { data } = await deps.octokit.rest.pulls.listReviewComments({
        owner: deps.owner,
        repo: deps.repo,
        pull_number: deps.prNumber,
        per_page,
        page,
        sort: "created",
        direction: "desc",
      });
      return data;
    },
  });

  if (reviewCommentsScan.found) {
    return {
      reviewOutputKey: deps.reviewOutputKey,
      marker,
      shouldPublish: false,
      existingLocation: "review-comment",
    };
  }

  const issueCommentsScan = await scanForMarkerInPagedBodies({
    marker,
    fetchPage: async ({ page, per_page }) => {
      const { data } = await deps.octokit.rest.issues.listComments({
        owner: deps.owner,
        repo: deps.repo,
        issue_number: deps.prNumber,
        per_page,
        page,
        sort: "created",
        direction: "desc",
      });
      return data;
    },
  });

  if (issueCommentsScan.found) {
    return {
      reviewOutputKey: deps.reviewOutputKey,
      marker,
      shouldPublish: false,
      existingLocation: "issue-comment",
    };
  }

  const reviewsScan = await scanForMarkerInPagedBodies({
    marker,
    fetchPage: async ({ page, per_page }) => {
      const { data } = await deps.octokit.rest.pulls.listReviews({
        owner: deps.owner,
        repo: deps.repo,
        pull_number: deps.prNumber,
        per_page,
        page,
      });
      return data;
    },
  });

  if (reviewsScan.found) {
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
