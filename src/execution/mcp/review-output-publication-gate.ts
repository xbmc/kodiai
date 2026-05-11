import type { Octokit } from "@octokit/rest";
import {
  ensureReviewOutputNotPublished,
  type ReviewOutputPublicationStatus,
} from "../../handlers/review-idempotency.ts";

export type ReviewOutputInlinePublicationState =
  | { status: "none" }
  | { status: "published"; commentId?: number; path?: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string };

export interface ReviewOutputPublicationGate {
  resolve(octokit: Octokit): Promise<ReviewOutputPublicationStatus>;
  getInlinePublicationState(): ReviewOutputInlinePublicationState;
  recordInlinePublicationSkipped(reason: string): void;
  recordInlinePublicationFailed(reason: string): void;
  recordInlinePublicationPublished(details?: { commentId?: number; path?: string }): void;
}

export function createReviewOutputPublicationGate(params: {
  owner: string;
  repo: string;
  prNumber: number;
  reviewOutputKey: string;
}): ReviewOutputPublicationGate {
  let cachedStatus: ReviewOutputPublicationStatus | null = null;
  let inFlight: Promise<ReviewOutputPublicationStatus> | null = null;

  let inlinePublicationState: ReviewOutputInlinePublicationState = { status: "none" };

  return {
    getInlinePublicationState(): ReviewOutputInlinePublicationState {
      return inlinePublicationState;
    },

    recordInlinePublicationSkipped(reason: string): void {
      inlinePublicationState = { status: "skipped", reason };
    },

    recordInlinePublicationFailed(reason: string): void {
      inlinePublicationState = { status: "failed", reason };
    },

    recordInlinePublicationPublished(details?: { commentId?: number; path?: string }): void {
      inlinePublicationState = { status: "published", ...details };
    },

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
