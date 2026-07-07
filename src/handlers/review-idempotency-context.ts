import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import type { CanonicalReviewSurface } from "../review-orchestration/review-canonical-surface.ts";
import {
  evaluateReviewOutputIdempotencyGate,
  type ReviewOutputIdempotencyGateResult,
} from "./review-idempotency-gate.ts";
import { buildReviewSetupOctokitAdapters } from "./review-setup-octokit.ts";

type EvaluateReviewOutputIdempotencyGate = typeof evaluateReviewOutputIdempotencyGate;

export type ReviewIdempotencyContext = {
  octokit: Octokit;
  idempotencyGate: ReviewOutputIdempotencyGateResult;
  acceptedCanonicalSurface: CanonicalReviewSurface | null;
};

export async function resolveReviewIdempotencyContext(params: {
  installationId: number;
  getInstallationOctokit: (installationId: number) => Promise<Octokit>;
  owner: string;
  repo: string;
  prNumber: number;
  reviewOutputKey: string;
  baseLog: Record<string, unknown>;
  logger: Pick<Logger, "info">;
  evaluateIdempotencyGate?: EvaluateReviewOutputIdempotencyGate;
}): Promise<ReviewIdempotencyContext> {
  const reviewSetupOctokitAdapters = buildReviewSetupOctokitAdapters({
    installationId: params.installationId,
    getInstallationOctokit: params.getInstallationOctokit,
  });
  const octokit = await reviewSetupOctokitAdapters.getOctokit();
  const idempotencyGate = await (params.evaluateIdempotencyGate ?? evaluateReviewOutputIdempotencyGate)({
    octokit,
    owner: params.owner,
    repo: params.repo,
    prNumber: params.prNumber,
    reviewOutputKey: params.reviewOutputKey,
    baseLog: params.baseLog,
    logger: params.logger,
  });

  return {
    octokit,
    idempotencyGate,
    acceptedCanonicalSurface: idempotencyGate.acceptedCanonicalSurface,
  };
}
