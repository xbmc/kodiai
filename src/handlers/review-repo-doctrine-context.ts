import type { Logger } from "pino";
import {
  normalizeRepoDoctrineProjection,
  type RepoDoctrineConfig,
  type RepoDoctrineProjection,
} from "../repo-doctrine/contracts.ts";
import {
  buildRepoDoctrineLogFields,
  toRepoDoctrineReviewSurfaceProjection,
  type RepoDoctrineReviewSurfaceProjection,
} from "../review-orchestration/review-plan-doctrine-log.ts";

type ReviewRepoDoctrineLogger = Pick<Logger, "info">;

export type ReviewRepoDoctrineContext = {
  repoDoctrineProjection: RepoDoctrineProjection;
  repoDoctrineReviewSurface: RepoDoctrineReviewSurfaceProjection;
};

export function resolveReviewRepoDoctrineContext(params: {
  doctrine: RepoDoctrineConfig;
  changedFiles: readonly string[];
  baseLog: Record<string, unknown>;
  logger: ReviewRepoDoctrineLogger;
}): ReviewRepoDoctrineContext {
  const repoDoctrineProjection = normalizeRepoDoctrineProjection(
    params.doctrine,
    [...params.changedFiles],
  );
  const repoDoctrineReviewSurface = toRepoDoctrineReviewSurfaceProjection(repoDoctrineProjection);
  params.logger.info(
    {
      ...params.baseLog,
      gate: "repo-doctrine",
      gateResult: repoDoctrineReviewSurface.status,
      ...buildRepoDoctrineLogFields(repoDoctrineProjection),
    },
    "Resolved bounded repository doctrine projection",
  );

  return {
    repoDoctrineProjection,
    repoDoctrineReviewSurface,
  };
}
