import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import {
  publishReviewHandlerFailureError as defaultPublishReviewHandlerFailureError,
  type ReviewHandlerFailureErrorPublicationResult,
} from "./review-error-publication.ts";

type PublishReviewHandlerFailureError = typeof defaultPublishReviewHandlerFailureError;

export function buildReviewHandlerFailurePublicationAdapter(params: {
  getOctokit: () => Promise<Octokit>;
  owner: string;
  repo: string;
  prNumber: number;
  error: unknown;
  logger: Logger;
  canPublishVisibleOutput: (reason: string) => boolean;
  setReviewWorkPhase: (phase: "publish") => void;
  publishReviewHandlerFailureError?: PublishReviewHandlerFailureError;
}): () => Promise<ReviewHandlerFailureErrorPublicationResult> {
  const publishReviewHandlerFailureError =
    params.publishReviewHandlerFailureError ?? defaultPublishReviewHandlerFailureError;

  return async () => await publishReviewHandlerFailureError({
    octokit: await params.getOctokit(),
    owner: params.owner,
    repo: params.repo,
    prNumber: params.prNumber,
    error: params.error,
    logger: params.logger,
    canPublishVisibleOutput: params.canPublishVisibleOutput,
    setReviewWorkPhase: params.setReviewWorkPhase,
  });
}
