import type { Octokit } from "@octokit/rest";
import {
  ensureReviewOutputNotPublished,
  type ReviewOutputPublicationStatus,
} from "../../handlers/review-idempotency.ts";

export interface ReviewOutputPublicationGate {
  resolve(octokit: Octokit): Promise<ReviewOutputPublicationStatus>;
}

export function createReviewOutputPublicationGate(params: {
  owner: string;
  repo: string;
  prNumber: number;
  reviewOutputKey: string;
}): ReviewOutputPublicationGate {
  let cachedStatus: ReviewOutputPublicationStatus | null = null;
  let inFlight: Promise<ReviewOutputPublicationStatus> | null = null;

  return {
    async resolve(octokit: Octokit): Promise<ReviewOutputPublicationStatus> {
      if (cachedStatus) {
        return cachedStatus;
      }

      if (!inFlight) {
        inFlight = ensureReviewOutputNotPublished({
          octokit,
          owner: params.owner,
          repo: params.repo,
          prNumber: params.prNumber,
          reviewOutputKey: params.reviewOutputKey,
        }).then((status) => {
          cachedStatus = status;
          return status;
        }).finally(() => {
          inFlight = null;
        });
      }

      return inFlight;
    },
  };
}
