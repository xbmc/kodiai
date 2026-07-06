import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import {
  type CanonicalReviewSurface,
  type CanonicalSurfaceKind,
  findCanonicalReviewSurface,
} from "../review-orchestration/review-canonical-surface.ts";
import { ensureReviewOutputNotPublished } from "../review-orchestration/review-idempotency.ts";

export type ReviewOutputIdempotencyGateResult =
  | { action: "continue"; acceptedCanonicalSurface: CanonicalReviewSurface | null }
  | { action: "skip"; acceptedCanonicalSurface: null };

export async function evaluateReviewOutputIdempotencyGate(params: {
  octokit: Octokit;
  owner: string;
  repo: string;
  prNumber: number;
  reviewOutputKey: string;
  baseLog: Record<string, unknown>;
  logger: Pick<Logger, "info">;
}): Promise<ReviewOutputIdempotencyGateResult> {
  const idempotencyCheck = await ensureReviewOutputNotPublished({
    octokit: params.octokit,
    owner: params.owner,
    repo: params.repo,
    prNumber: params.prNumber,
    reviewOutputKey: params.reviewOutputKey,
  });

  if (!idempotencyCheck.shouldPublish) {
    const canonicalSurfaceKind = toCanonicalSurfaceKind(idempotencyCheck.existingLocation);
    const canonicalSurface = canonicalSurfaceKind
      ? await findCanonicalReviewSurface({
        octokit: params.octokit,
        owner: params.owner,
        repo: params.repo,
        prNumber: params.prNumber,
        reviewOutputKey: params.reviewOutputKey,
        surfaceKind: canonicalSurfaceKind,
      })
      : null;

    if (canonicalSurface && !canonicalSurface.body.includes("<summary>Review Details</summary>")) {
      params.logger.info(
        {
          ...params.baseLog,
          gate: "review-output-idempotency",
          gateResult: "accepted",
          reason: "canonical-surface-missing-review-details",
          reviewOutputKey: params.reviewOutputKey,
          existingLocation: idempotencyCheck.existingLocation,
          canonicalSurfaceKind: canonicalSurface.kind,
        },
        "Review output idempotency check accepted incomplete canonical surface for Review Details finalization",
      );
      return { action: "continue", acceptedCanonicalSurface: canonicalSurface };
    }

    params.logger.info(
      {
        ...params.baseLog,
        gate: "review-output-idempotency",
        gateResult: "skipped",
        skipReason: "already-published",
        reviewOutputKey: params.reviewOutputKey,
        existingLocation: idempotencyCheck.existingLocation,
      },
      "Skipping review execution because output already published for key",
    );
    return { action: "skip", acceptedCanonicalSurface: null };
  }

  params.logger.info(
    {
      ...params.baseLog,
      gate: "review-output-idempotency",
      gateResult: "accepted",
      reviewOutputKey: params.reviewOutputKey,
    },
    "Review output idempotency check passed",
  );
  return { action: "continue", acceptedCanonicalSurface: null };
}

function toCanonicalSurfaceKind(
  location: "review-comment" | "issue-comment" | "review" | null,
): CanonicalSurfaceKind | null {
  if (location === "review") {
    return "pull_review";
  }
  if (location === "issue-comment") {
    return "issue_comment";
  }
  return null;
}
