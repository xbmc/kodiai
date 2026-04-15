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

export type ParsedReviewOutputKey = {
  reviewOutputKey: string;
  baseReviewOutputKey: string;
  retryAttempt: number | null;
  installationId: number;
  owner: string;
  repo: string;
  repoFullName: string;
  prNumber: number;
  action: string;
  deliveryId: string;
  effectiveDeliveryId: string;
  headSha: string;
};

const KEY_PREFIX = "kodiai-review-output";
const KEY_VERSION = "v1";
const REVIEW_OUTPUT_MARKER_REGEX = /<!--\s*kodiai:(?:review-output-key|review-details):([^>]+?)\s*-->/i;
const MAX_APPROVAL_EVIDENCE_LINES = 3;
const DEFAULT_APPROVAL_EVIDENCE = "No actionable issues were identified in the reviewed changes.";

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

function normalizeApprovalEvidenceLine(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function buildApprovedReviewEvidence(params: {
  evidence?: string[];
  approvalConfidence?: string | null;
}): string[] {
  const normalizedEvidence = (params.evidence ?? [])
    .map((line) => normalizeApprovalEvidenceLine(line))
    .filter((line): line is string => Boolean(line));
  const approvalConfidence = normalizeApprovalEvidenceLine(params.approvalConfidence);
  const evidenceLimit = approvalConfidence ? MAX_APPROVAL_EVIDENCE_LINES - 1 : MAX_APPROVAL_EVIDENCE_LINES;
  const evidence = normalizedEvidence.slice(0, evidenceLimit);

  if (approvalConfidence) {
    evidence.push(approvalConfidence);
  }

  if (evidence.length > 0) {
    return evidence;
  }

  return [DEFAULT_APPROVAL_EVIDENCE];
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
    KEY_VERSION,
    `inst-${input.installationId}`,
    `${owner}/${repo}`,
    `pr-${input.prNumber}`,
    `action-${action}`,
    `delivery-${deliveryId}`,
    `head-${headSha}`,
  ].join(":");
}

export function extractReviewOutputKey(body: string | null | undefined): string | null {
  if (typeof body !== "string") {
    return null;
  }

  const match = body.match(REVIEW_OUTPUT_MARKER_REGEX);
  if (!match?.[1]) {
    return null;
  }

  return normalizeSegment(match[1]);
}

export function parseReviewOutputKey(reviewOutputKey: string): ParsedReviewOutputKey | null {
  const normalizedKey = normalizeSegment(reviewOutputKey);
  if (!normalizedKey) {
    return null;
  }

  const retryMatch = normalizedKey.match(/^(.*)-retry-(\d+)$/);
  const baseReviewOutputKey = retryMatch?.[1] ?? normalizedKey;
  const retryAttempt = retryMatch?.[2] ? Number.parseInt(retryMatch[2], 10) : null;

  if (retryAttempt !== null && (!Number.isInteger(retryAttempt) || retryAttempt < 1)) {
    return null;
  }

  const segments = baseReviewOutputKey.split(":");
  if (segments.length !== 8) {
    return null;
  }

  const [
    prefix,
    version,
    installationSegment,
    repoSegment,
    prSegment,
    actionSegment,
    deliverySegment,
    headSegment,
  ] = segments;

  if (
    !prefix
    || !version
    || !installationSegment
    || !repoSegment
    || !prSegment
    || !actionSegment
    || !deliverySegment
    || !headSegment
  ) {
    return null;
  }

  if (prefix !== KEY_PREFIX || version !== KEY_VERSION) {
    return null;
  }

  if (!installationSegment.startsWith("inst-") || !prSegment.startsWith("pr-") || !actionSegment.startsWith("action-") || !deliverySegment.startsWith("delivery-") || !headSegment.startsWith("head-")) {
    return null;
  }

  const installationId = Number.parseInt(installationSegment.slice("inst-".length), 10);
  const prNumber = Number.parseInt(prSegment.slice("pr-".length), 10);
  const [owner, repo] = repoSegment.split("/");
  const action = actionSegment.slice("action-".length);
  const deliveryId = deliverySegment.slice("delivery-".length);
  const headSha = headSegment.slice("head-".length);

  if (!Number.isInteger(installationId) || installationId < 1) {
    return null;
  }

  if (!Number.isInteger(prNumber) || prNumber < 1) {
    return null;
  }

  if (!owner || !repo || !action || !deliveryId || !headSha) {
    return null;
  }

  return {
    reviewOutputKey: normalizedKey,
    baseReviewOutputKey,
    retryAttempt,
    installationId,
    owner,
    repo,
    repoFullName: `${owner}/${repo}`,
    prNumber,
    action,
    deliveryId,
    effectiveDeliveryId: retryAttempt === null ? deliveryId : `${deliveryId}-retry-${retryAttempt}`,
    headSha,
  };
}

export function buildReviewOutputMarker(reviewOutputKey: string): string {
  return `<!-- kodiai:review-output-key:${reviewOutputKey} -->`;
}

export function buildApprovedReviewBody(params: {
  reviewOutputKey: string;
  evidence?: string[];
  approvalConfidence?: string | null;
}): string {
  const marker = buildReviewOutputMarker(params.reviewOutputKey);
  const evidence = buildApprovedReviewEvidence(params);
  const collapsedBody = wrapInDetails(
    [
      "Decision: APPROVE",
      "Issues: none",
      "",
      "Evidence:",
      ...evidence.map((line) => `- ${line}`),
    ].join("\n"),
    "kodiai response",
  );

  return [collapsedBody, "", marker].join("\n");
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
