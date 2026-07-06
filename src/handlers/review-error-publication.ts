import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import {
  postOrUpdateErrorComment as defaultPostOrUpdateErrorComment,
  type ErrorCategory,
  type ErrorCommentPublicationStatus,
} from "../lib/errors.ts";
import { ok, type Result } from "../lib/result.ts";
import type { TimeoutBudgetDetails } from "../lib/review-details-formatting.ts";
import {
  buildReviewExecutionErrorFallbackBody,
  buildReviewHandlerFailureErrorBody,
} from "./review-fallback-body.ts";
import {
  describeReviewErrorCommentDelivery,
  describeTurnLimitNoticeDelivery,
} from "./review-publication-state.ts";

export type ReviewExecutionErrorFallbackPublicationValue = {
  published: boolean;
  resolution:
    | "turn-limit-fallback"
    | "error-fallback"
    | "skipped";
  fallbackDelivery?: string;
};

export type ReviewExecutionErrorFallbackPublicationError = {
  published: false;
  resolution: "turn-limit-fallback-undelivered" | "error-comment-failed";
  fallbackDelivery: string;
};

export type ReviewExecutionErrorFallbackPublicationResult = Result<
  ReviewExecutionErrorFallbackPublicationValue,
  ReviewExecutionErrorFallbackPublicationError
>;

export type ReviewHandlerFailureErrorPublicationResult = {
  phaseDetail:
    | "posted error comment after handler failure"
    | "suppressed error comment after handler failure because publish rights were lost"
    | "failed to publish error comment after handler failure";
};

export async function publishReviewExecutionErrorFallback(params: {
  octokit: Octokit;
  owner: string;
  repo: string;
  prNumber: number;
  exhaustedTurnBudget: boolean;
  retryScheduled: boolean;
  category: ErrorCategory;
  errorMessage: string | undefined;
  totalTimeoutSeconds: number;
  complexityInfo: string;
  timeoutEstimate?: TimeoutBudgetDetails | null;
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
}): Promise<ReviewExecutionErrorFallbackPublicationResult> {
  if (!params.canPublishVisibleOutput("error comment")) {
    return ok({
      published: false,
      resolution: "skipped",
      fallbackDelivery: undefined,
    });
  }

  const errorBody = buildReviewExecutionErrorFallbackBody({
    exhaustedTurnBudget: params.exhaustedTurnBudget,
    retryScheduled: params.retryScheduled,
    category: params.category,
    errorMessage: params.errorMessage,
    totalTimeoutSeconds: params.totalTimeoutSeconds,
    complexityInfo: params.complexityInfo,
    timeoutEstimate: params.timeoutEstimate,
  });

  params.setReviewWorkPhase("publish");
  const postOrUpdateErrorComment = params.postOrUpdateErrorComment ?? defaultPostOrUpdateErrorComment;
  const publicationStatus = await postOrUpdateErrorComment(
    params.octokit,
    {
      owner: params.owner,
      repo: params.repo,
      issueNumber: params.prNumber,
    },
    errorBody,
    params.logger,
  );
  const fallbackDelivery = params.exhaustedTurnBudget
    ? describeTurnLimitNoticeDelivery(publicationStatus)
    : describeReviewErrorCommentDelivery(publicationStatus);

  if (publicationStatus.ok) {
    return ok({
      published: true,
      resolution: params.exhaustedTurnBudget ? "turn-limit-fallback" : "error-fallback",
      fallbackDelivery,
    });
  }

  return {
    ok: false,
    err: {
      published: false,
      resolution: params.exhaustedTurnBudget
        ? "turn-limit-fallback-undelivered"
        : "error-comment-failed",
      fallbackDelivery,
    },
  };
}

export async function publishReviewHandlerFailureError(params: {
  octokit: Octokit;
  owner: string;
  repo: string;
  prNumber: number;
  error: unknown;
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
}): Promise<ReviewHandlerFailureErrorPublicationResult> {
  if (!params.canPublishVisibleOutput("handler failure error comment")) {
    return {
      phaseDetail: "suppressed error comment after handler failure because publish rights were lost",
    };
  }

  params.setReviewWorkPhase("publish");
  const postOrUpdateErrorComment = params.postOrUpdateErrorComment ?? defaultPostOrUpdateErrorComment;
  await postOrUpdateErrorComment(
    params.octokit,
    {
      owner: params.owner,
      repo: params.repo,
      issueNumber: params.prNumber,
    },
    buildReviewHandlerFailureErrorBody(params.error),
    params.logger,
  );

  return {
    phaseDetail: "posted error comment after handler failure",
  };
}
