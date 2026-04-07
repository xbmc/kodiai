import type { Octokit } from "@octokit/rest";
import { wrapInDetails } from "../lib/formatting.ts";

export type ReviewOutputKeyInput = {
  installationId: number;
  owner: string;
  repo: string;
  prNumber: number;
  action: string;
  deliveryId: string;
  headSha: string;
};

export type ReviewOutputIdempotencyLocation =
  | "review-comment"
  | "issue-comment"
  | "review";

export type ReviewOutputIdempotencyDecision =
  | "publish"
  | "skip-existing-review-comment"
  | "skip-existing-issue-comment"
  | "skip-existing-review";

export type ReviewOutputScanSummary = {
  scanned: number;
  hitCap: boolean;
};

export type ReviewOutputScanStats = {
  reviewComments: ReviewOutputScanSummary;
  issueComments: ReviewOutputScanSummary;
  reviews: ReviewOutputScanSummary;
};

export type ReviewOutputPublicationState = "publish" | "skip-existing-output";

export type ReviewOutputPublicationStatus = {
  reviewOutputKey: string;
  marker: string;
  shouldPublish: boolean;
  publicationState: ReviewOutputPublicationState;
  existingLocation: ReviewOutputIdempotencyLocation | null;
  idempotencyDecision: ReviewOutputIdempotencyDecision;
  scanStats: ReviewOutputScanStats;
};

const KEY_PREFIX = "kodiai-review-output";

const DEFAULT_PER_PAGE = 100;
const DEFAULT_MAX_SCAN_ITEMS = 2000;
const EMPTY_SCAN_SUMMARY: ReviewOutputScanSummary = { scanned: 0, hitCap: false };

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

function summarizeScan(scan: { scanned: number; hitCap: boolean }): ReviewOutputScanSummary {
  return { scanned: scan.scanned, hitCap: scan.hitCap };
}

function buildPublicationStatus(params: {
  reviewOutputKey: string;
  marker: string;
  shouldPublish: boolean;
  existingLocation: ReviewOutputIdempotencyLocation | null;
  idempotencyDecision: ReviewOutputIdempotencyDecision;
  scanStats: Partial<ReviewOutputScanStats>;
}): ReviewOutputPublicationStatus {
  return {
    reviewOutputKey: params.reviewOutputKey,
    marker: params.marker,
    shouldPublish: params.shouldPublish,
    publicationState: params.shouldPublish ? "publish" : "skip-existing-output",
    existingLocation: params.existingLocation,
    idempotencyDecision: params.idempotencyDecision,
    scanStats: {
      reviewComments: params.scanStats.reviewComments ?? EMPTY_SCAN_SUMMARY,
      issueComments: params.scanStats.issueComments ?? EMPTY_SCAN_SUMMARY,
      reviews: params.scanStats.reviews ?? EMPTY_SCAN_SUMMARY,
    },
  };
}

export function buildReviewOutputPublicationLogFields(
  status: ReviewOutputPublicationStatus,
): Record<string, string | number | boolean | null> {
  return {
    reviewOutputKey: status.reviewOutputKey,
    reviewOutputPublicationState: status.publicationState,
    idempotencyDecision: status.idempotencyDecision,
    existingLocation: status.existingLocation,
    reviewCommentsScanned: status.scanStats.reviewComments.scanned,
    reviewCommentsHitCap: status.scanStats.reviewComments.hitCap,
    issueCommentsScanned: status.scanStats.issueComments.scanned,
    issueCommentsHitCap: status.scanStats.issueComments.hitCap,
    reviewsScanned: status.scanStats.reviews.scanned,
    reviewsHitCap: status.scanStats.reviews.hitCap,
  };
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

export function buildApprovedReviewBody(params: {
  reviewOutputKey: string;
  approvalConfidence?: string | null;
}): string {
  const marker = buildReviewOutputMarker(params.reviewOutputKey);
  const lines = [
    "Decision: APPROVE",
    "Issues: none",
  ];

  const approvalConfidence = params.approvalConfidence?.trim();
  if (approvalConfidence) {
    lines.push("", approvalConfidence);
  }

  lines.push("", marker);
  return wrapInDetails(lines.join("\n"), "kodiai response");
}

export async function ensureReviewOutputNotPublished(deps: {
  octokit: Octokit;
  owner: string;
  repo: string;
  prNumber: number;
  reviewOutputKey: string;
}): Promise<ReviewOutputPublicationStatus> {
  const marker = buildReviewOutputMarker(deps.reviewOutputKey);
  const scanStats: Partial<ReviewOutputScanStats> = {};

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
  scanStats.reviewComments = summarizeScan(reviewCommentsScan);

  if (reviewCommentsScan.found) {
    return buildPublicationStatus({
      reviewOutputKey: deps.reviewOutputKey,
      marker,
      shouldPublish: false,
      existingLocation: "review-comment",
      idempotencyDecision: "skip-existing-review-comment",
      scanStats,
    });
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
  scanStats.issueComments = summarizeScan(issueCommentsScan);

  if (issueCommentsScan.found) {
    return buildPublicationStatus({
      reviewOutputKey: deps.reviewOutputKey,
      marker,
      shouldPublish: false,
      existingLocation: "issue-comment",
      idempotencyDecision: "skip-existing-issue-comment",
      scanStats,
    });
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
  scanStats.reviews = summarizeScan(reviewsScan);

  if (reviewsScan.found) {
    return buildPublicationStatus({
      reviewOutputKey: deps.reviewOutputKey,
      marker,
      shouldPublish: false,
      existingLocation: "review",
      idempotencyDecision: "skip-existing-review",
      scanStats,
    });
  }

  return buildPublicationStatus({
    reviewOutputKey: deps.reviewOutputKey,
    marker,
    shouldPublish: true,
    existingLocation: null,
    idempotencyDecision: "publish",
    scanStats,
  });
}
