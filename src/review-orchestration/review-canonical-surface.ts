import type { Octokit } from "@octokit/rest";
import type { GitHubApp } from "../auth/github-app.ts";
import type { ReviewBoundednessContract } from "../lib/review-utils.ts";
import { sanitizeOutgoingMentions } from "../lib/sanitizer.ts";
import { buildReviewOutputMarker } from "./review-idempotency.ts";
import { buildReviewDetailsMarker } from "../lib/review-utils.ts";
import { mergeReviewDetailsIntoSummaryBody } from "./review-details-summary-merge.ts";

export type CanonicalReviewSurface =
  | { kind: "issue_comment"; commentId: number; body: string }
  | { kind: "pull_review"; reviewId: number; body: string };

export type CanonicalSurfaceKind = CanonicalReviewSurface["kind"];

export function getCanonicalReviewSurfaceId(surface: CanonicalReviewSurface): number {
  return surface.kind === "issue_comment" ? surface.commentId : surface.reviewId;
}

export async function findCanonicalReviewSurface(params: {
  octokit: Octokit;
  owner: string;
  repo: string;
  prNumber: number;
  reviewOutputKey: string;
  surfaceKind: CanonicalSurfaceKind;
}): Promise<CanonicalReviewSurface | null> {
  const marker = buildReviewOutputMarker(params.reviewOutputKey);

  if (params.surfaceKind === "issue_comment") {
    const commentsResponse = await params.octokit.rest.issues.listComments({
      owner: params.owner,
      repo: params.repo,
      issue_number: params.prNumber,
      per_page: 100,
      sort: "created",
      direction: "desc",
    });

    const issueComment = commentsResponse.data.find((comment) =>
      typeof comment.id === "number"
      && typeof comment.body === "string"
      && comment.body.includes(marker)
    );
    const issueCommentBody = typeof issueComment?.body === "string" ? issueComment.body : undefined;

    if (typeof issueComment?.id === "number" && issueCommentBody !== undefined) {
      return {
        kind: "issue_comment",
        commentId: issueComment.id,
        body: issueCommentBody,
      };
    }

    return null;
  }

  const reviewsResponse = await params.octokit.rest.pulls.listReviews({
    owner: params.owner,
    repo: params.repo,
    pull_number: params.prNumber,
    per_page: 100,
  });

  const pullReview = [...reviewsResponse.data].reverse().find((review) =>
    typeof review.id === "number"
    && typeof review.body === "string"
    && review.body.includes(marker)
  );
  const pullReviewBody = typeof pullReview?.body === "string" ? pullReview.body : undefined;

  if (typeof pullReview?.id === "number" && pullReviewBody !== undefined) {
    return {
      kind: "pull_review",
      reviewId: pullReview.id,
      body: pullReviewBody,
    };
  }

  return null;
}

export async function updateCanonicalReviewSurface(params: {
  octokit: Octokit;
  owner: string;
  repo: string;
  prNumber: number;
  surface: CanonicalReviewSurface;
  body: string;
  botHandles: string[];
}): Promise<CanonicalReviewSurface> {
  const sanitizedBody = sanitizeOutgoingMentions(params.body, params.botHandles);

  if (params.surface.kind === "issue_comment") {
    await params.octokit.rest.issues.updateComment({
      owner: params.owner,
      repo: params.repo,
      comment_id: params.surface.commentId,
      body: sanitizedBody,
    });

    return {
      kind: "issue_comment",
      commentId: params.surface.commentId,
      body: sanitizedBody,
    };
  }

  await params.octokit.request(
    "PUT /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}",
    {
      owner: params.owner,
      repo: params.repo,
      pull_number: params.prNumber,
      review_id: params.surface.reviewId,
      body: sanitizedBody,
    },
  );

  return {
    kind: "pull_review",
    reviewId: params.surface.reviewId,
    body: sanitizedBody,
  };
}

export async function createCanonicalReviewSurface(params: {
  octokit: Octokit;
  owner: string;
  repo: string;
  prNumber: number;
  reviewOutputKey: string;
  surfaceKind: CanonicalSurfaceKind;
  body: string;
  botHandles: string[];
  pullReviewEvent?: "APPROVE" | "COMMENT" | "REQUEST_CHANGES";
}): Promise<CanonicalReviewSurface> {
  const sanitizedBody = sanitizeOutgoingMentions(params.body, params.botHandles);

  if (params.surfaceKind === "issue_comment") {
    const response = await params.octokit.rest.issues.createComment({
      owner: params.owner,
      repo: params.repo,
      issue_number: params.prNumber,
      body: sanitizedBody,
    });

    if (typeof response.data.id !== "number") {
      throw new Error("Created canonical issue comment did not return an id");
    }

    return {
      kind: "issue_comment",
      commentId: response.data.id,
      body: sanitizedBody,
    };
  }

  const response = await params.octokit.rest.pulls.createReview({
    owner: params.owner,
    repo: params.repo,
    pull_number: params.prNumber,
    event: params.pullReviewEvent ?? "COMMENT",
    body: sanitizedBody,
  });

  if (typeof response.data.id === "number") {
    return {
      kind: "pull_review",
      reviewId: response.data.id,
      body: sanitizedBody,
    };
  }

  const createdSurface = await findCanonicalReviewSurface({
    octokit: params.octokit,
    owner: params.owner,
    repo: params.repo,
    prNumber: params.prNumber,
    reviewOutputKey: params.reviewOutputKey,
    surfaceKind: "pull_review",
  });

  if (createdSurface?.kind === "pull_review") {
    return createdSurface;
  }

  throw new Error("Created canonical pull review could not be reloaded");
}

export async function upsertCanonicalReviewSurface(params: {
  octokit: Octokit;
  owner: string;
  repo: string;
  prNumber: number;
  reviewOutputKey: string;
  preferredKind: CanonicalSurfaceKind;
  body?: string;
  reviewDetailsBlock?: string;
  summaryBody?: string;
  canonicalSurface?: CanonicalReviewSurface;
  requireDegradationDisclosure?: boolean;
  reviewBoundedness?: ReviewBoundednessContract | null;
  botHandles: string[];
  pullReviewEvent?: "APPROVE" | "COMMENT" | "REQUEST_CHANGES";
  recheckCanPublish?: () => boolean;
}): Promise<CanonicalReviewSurface | undefined> {
  let existingSurface = params.canonicalSurface?.kind === params.preferredKind
    ? params.canonicalSurface
    : await findCanonicalReviewSurface({
      octokit: params.octokit,
      owner: params.owner,
      repo: params.repo,
      prNumber: params.prNumber,
      reviewOutputKey: params.reviewOutputKey,
      surfaceKind: params.preferredKind,
    });

  if (!existingSurface && params.reviewDetailsBlock) {
    const alternateKind: CanonicalSurfaceKind = params.preferredKind === "issue_comment" ? "pull_review" : "issue_comment";
    existingSurface = await findCanonicalReviewSurface({
      octokit: params.octokit,
      owner: params.owner,
      repo: params.repo,
      prNumber: params.prNumber,
      reviewOutputKey: params.reviewOutputKey,
      surfaceKind: alternateKind,
    });
  }

  const body = params.reviewDetailsBlock
    ? (() => {
      const summaryBody = params.summaryBody ?? existingSurface?.body;
      if (!summaryBody) {
        throw new Error(`Canonical ${params.preferredKind} surface not found for review output marker`);
      }

      return mergeReviewDetailsIntoSummaryBody({
        summaryBody,
        reviewDetailsBlock: params.reviewDetailsBlock,
        requireDegradationDisclosure: params.requireDegradationDisclosure ?? false,
        reviewBoundedness: params.reviewBoundedness,
      });
    })()
    : params.body;

  if (!body) {
    throw new Error("Canonical review surface upsert requires body content");
  }

  if (params.recheckCanPublish && !params.recheckCanPublish()) {
    return undefined;
  }

  if (existingSurface) {
    return await updateCanonicalReviewSurface({
      octokit: params.octokit,
      owner: params.owner,
      repo: params.repo,
      prNumber: params.prNumber,
      surface: existingSurface,
      body,
      botHandles: params.botHandles,
    });
  }

  return await createCanonicalReviewSurface({
    octokit: params.octokit,
    owner: params.owner,
    repo: params.repo,
    prNumber: params.prNumber,
    reviewOutputKey: params.reviewOutputKey,
    surfaceKind: params.preferredKind,
    body,
    botHandles: params.botHandles,
    pullReviewEvent: params.pullReviewEvent,
  });
}

export async function upsertDegradedReviewDetailsFallbackComment(params: {
  octokit: Awaited<ReturnType<GitHubApp["getInstallationOctokit"]>>;
  owner: string;
  repo: string;
  prNumber: number;
  reviewOutputKey: string;
  body: string;
  botHandles: string[];
  recheckCanPublish?: () => boolean;
}): Promise<number | undefined> {
  const { octokit, owner, repo, prNumber, reviewOutputKey, body, botHandles } = params;
  const marker = buildReviewDetailsMarker(reviewOutputKey);
  const sanitizedBody = sanitizeOutgoingMentions(body, botHandles);

  const commentsResponse = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: prNumber,
    per_page: 100,
    sort: "created",
    direction: "desc",
  });

  const existingComment = commentsResponse.data.find((comment) =>
    typeof comment.body === "string" && comment.body.includes(marker)
  );

  if (params.recheckCanPublish && !params.recheckCanPublish()) {
    return undefined;
  }

  if (existingComment) {
    await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existingComment.id,
      body: sanitizedBody,
    });
    return existingComment.id;
  }

  const response = await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body: sanitizedBody,
  });
  return response.data.id;
}
