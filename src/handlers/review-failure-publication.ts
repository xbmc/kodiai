import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import {
  postOrUpdateErrorComment as defaultPostOrUpdateErrorComment,
  type ErrorCommentPublicationStatus,
} from "../lib/errors.ts";
import { err, ok, type Result } from "../lib/result.ts";
import { buildReviewFailureFallbackBody } from "./review-fallback-body.ts";
import { describeReviewErrorCommentDelivery } from "./review-publication-state.ts";

export type ReviewFailureFallbackPublicationValue = {
  published: boolean;
  resolution: "failure-fallback" | "skipped";
  fallbackDelivery?: string;
};

export type ReviewFailureFallbackPublicationError = {
  published: false;
  resolution: "failure-fallback-failed";
  fallbackDelivery: string;
};

export type ReviewFailureFallbackPublicationResult = Result<
  ReviewFailureFallbackPublicationValue,
  ReviewFailureFallbackPublicationError
>;

export async function publishReviewFailureFallback(params: {
  octokit: Octokit;
  owner: string;
  repo: string;
  prNumber: number;
  logger: Logger;
  canPublishVisibleOutput: (reason: string) => boolean;
  setReviewWorkPhase: (phase: "publish") => void;
  postOrUpdateErrorComment?: (
    octokit: Octokit,
    target: {
      owner: string;
      repo: string;
      issueNumber: number;
    },
    body: string,
    logger: Logger,
  ) => Promise<ErrorCommentPublicationStatus>;
}): Promise<ReviewFailureFallbackPublicationResult> {
  if (!params.canPublishVisibleOutput("failure fallback comment")) {
    return ok({
      published: false,
      resolution: "skipped",
      fallbackDelivery: undefined,
    });
  }

  params.setReviewWorkPhase("publish");
  const postOrUpdateErrorComment = params.postOrUpdateErrorComment ?? defaultPostOrUpdateErrorComment;
  const publicationStatus = await postOrUpdateErrorComment(
    params.octokit,
    {
      owner: params.owner,
      repo: params.repo,
      issueNumber: params.prNumber,
    },
    buildReviewFailureFallbackBody(),
    params.logger,
  );
  const fallbackDelivery = describeReviewErrorCommentDelivery(publicationStatus);

  if (publicationStatus.ok) {
    return ok({
      published: true,
      resolution: "failure-fallback",
      fallbackDelivery,
    });
  }

  return err({
    published: false,
    resolution: "failure-fallback-failed",
    fallbackDelivery,
  });
}
