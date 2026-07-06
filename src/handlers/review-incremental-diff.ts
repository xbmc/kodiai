import type { Logger } from "pino";
import {
  computeIncrementalDiff,
  type IncrementalDiffResult,
} from "../lib/incremental-diff.ts";

type ReviewIncrementalDiffKnowledgeStore = {
  getLastReviewedHeadSha(params: { repo: string; prNumber: number }): string | null | Promise<string | null>;
};

type ReviewIncrementalDiffLogger = Pick<Logger, "info" | "warn">;
type ReviewIncrementalFilterLogger = Pick<Logger, "info">;

export async function resolveReviewIncrementalDiff(params: {
  knowledgeStore: ReviewIncrementalDiffKnowledgeStore | undefined;
  workspaceDir: string;
  repo: string;
  prNumber: number;
  baseLog: Record<string, unknown>;
  logger: ReviewIncrementalDiffLogger;
  computeIncrementalDiffFn?: typeof computeIncrementalDiff;
}): Promise<IncrementalDiffResult | null> {
  if (!params.knowledgeStore) {
    return null;
  }

  try {
    const incrementalResult = await (params.computeIncrementalDiffFn ?? computeIncrementalDiff)({
      workspaceDir: params.workspaceDir,
      repo: params.repo,
      prNumber: params.prNumber,
      getLastReviewedHeadSha: (p) => params.knowledgeStore!.getLastReviewedHeadSha(p),
      logger: params.logger as Logger,
    });
    params.logger.info(
      {
        ...params.baseLog,
        gate: "incremental-diff",
        mode: incrementalResult.mode,
        reason: incrementalResult.reason,
      },
      "Incremental diff computation complete",
    );
    return incrementalResult;
  } catch (err) {
    params.logger.warn(
      { ...params.baseLog, err },
      "Incremental diff computation failed (fail-open, full review)",
    );
    return null;
  }
}

export function resolveReviewFilesForIncrementalReview(params: {
  changedFiles: readonly string[];
  incrementalResult: IncrementalDiffResult | null | undefined;
  baseLog: Record<string, unknown>;
  logger: ReviewIncrementalFilterLogger;
}): string[] {
  if (params.incrementalResult?.mode !== "incremental" || params.incrementalResult.changedFilesSinceLastReview.length === 0) {
    return [...params.changedFiles];
  }

  const incrementalSet = new Set(params.incrementalResult.changedFilesSinceLastReview);
  const reviewFiles = params.changedFiles.filter(file => incrementalSet.has(file));
  params.logger.info(
    {
      ...params.baseLog,
      gate: "incremental-filter",
      fullCount: params.changedFiles.length,
      incrementalCount: reviewFiles.length,
    },
    "Filtered to incremental changed files",
  );
  return reviewFiles;
}
