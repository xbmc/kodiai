import type { Octokit } from "@octokit/rest";
import type { GitHubApp } from "../auth/github-app.ts";
import {
  createIssueCommentWithPublicationPipeline,
  createPullReviewWithPublicationPipeline,
  prepareGitHubPublicationBody,
  updateIssueCommentWithPublicationPipeline,
  updatePullReviewWithPublicationPipeline,
} from "../lib/github-publication.ts";
import type { ReviewBoundednessContract } from "../lib/review-boundedness.ts";
import {
  findIssueCommentByMarkerPaged,
  findPullReviewByMarkerPaged,
} from "../lib/github-issue-comments.ts";
import { buildReviewOutputMarker } from "./review-idempotency.ts";
import { buildReviewDetailsMarker } from "../lib/review-details-formatting.ts";
import { mergeReviewDetailsIntoSummaryBody } from "./review-details-summary-merge.ts";

export type CanonicalReviewSurface =
  | { kind: "issue_comment"; commentId: number; body: string }
  | { kind: "pull_review"; reviewId: number; body: string };

export type CanonicalSurfaceKind = CanonicalReviewSurface["kind"];
const MARKER_LOOKUP_PAGE_SIZE = 100;

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
    const issueComment = await findIssueCommentByMarkerPaged(params.octokit, {
      owner: params.owner,
      repo: params.repo,
      issueNumber: params.prNumber,
      marker,
      perPage: MARKER_LOOKUP_PAGE_SIZE,
    });

    if (issueComment) {
      return {
        kind: "issue_comment",
        commentId: issueComment.id,
        body: issueComment.body ?? "",
      };
    }

    return null;
  }

  const pullReview = await findPullReviewByMarkerPaged(params.octokit, {
    owner: params.owner,
    repo: params.repo,
    prNumber: params.prNumber,
    marker,
    perPage: MARKER_LOOKUP_PAGE_SIZE,
  });

  if (pullReview) {
    return {
      kind: "pull_review",
      reviewId: pullReview.id,
      body: pullReview.body,
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
  const publicationBody = prepareGitHubPublicationBody(params.body, {
    botHandles: params.botHandles,
    preserveKodiaiMarkers: true,
  });

  if (params.surface.kind === "issue_comment") {
    await updateIssueCommentWithPublicationPipeline(params.octokit, {
      owner: params.owner,
      repo: params.repo,
      comment_id: params.surface.commentId,
      body: params.body,
      botHandles: params.botHandles,
      preserveKodiaiMarkers: true,
    });

    return {
      kind: "issue_comment",
      commentId: params.surface.commentId,
      body: publicationBody,
    };
  }

  await updatePullReviewWithPublicationPipeline(params.octokit, {
    owner: params.owner,
    repo: params.repo,
    pull_number: params.prNumber,
    review_id: params.surface.reviewId,
    body: params.body,
    botHandles: params.botHandles,
    preserveKodiaiMarkers: true,
  });

  return {
    kind: "pull_review",
    reviewId: params.surface.reviewId,
    body: publicationBody,
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
  const publicationBody = prepareGitHubPublicationBody(params.body, {
    botHandles: params.botHandles,
    preserveKodiaiMarkers: true,
  });

  if (params.surfaceKind === "issue_comment") {
    const response = await createIssueCommentWithPublicationPipeline(params.octokit, {
      owner: params.owner,
      repo: params.repo,
      issue_number: params.prNumber,
      body: params.body,
      botHandles: params.botHandles,
      preserveKodiaiMarkers: true,
    });

    if (typeof response.data.id !== "number") {
      throw new Error("Created canonical issue comment did not return an id");
    }

    return {
      kind: "issue_comment",
      commentId: response.data.id,
      body: publicationBody,
    };
  }

  const response = await createPullReviewWithPublicationPipeline(params.octokit, {
    owner: params.owner,
    repo: params.repo,
    pull_number: params.prNumber,
    event: params.pullReviewEvent ?? "COMMENT",
    body: params.body,
    botHandles: params.botHandles,
    preserveKodiaiMarkers: true,
  });

  if (typeof response.data.id === "number") {
    return {
      kind: "pull_review",
      reviewId: response.data.id,
      body: publicationBody,
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

  const existingComment = await findIssueCommentByMarkerPaged(octokit, {
    owner,
    repo,
    issueNumber: prNumber,
    marker,
    perPage: MARKER_LOOKUP_PAGE_SIZE,
  });

  if (params.recheckCanPublish && !params.recheckCanPublish()) {
    return undefined;
  }

  if (existingComment) {
    await updateIssueCommentWithPublicationPipeline(octokit, {
      owner,
      repo,
      comment_id: existingComment.id,
      body,
      botHandles,
      preserveKodiaiMarkers: true,
    });
    return existingComment.id;
  }

  const response = await createIssueCommentWithPublicationPipeline(octokit, {
    owner,
    repo,
    issue_number: prNumber,
    body,
    botHandles,
    preserveKodiaiMarkers: true,
  });
  return response.data.id;
}
