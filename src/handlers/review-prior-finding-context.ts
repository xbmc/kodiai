import type { Logger } from "pino";
import type { IncrementalDiffResult } from "../lib/incremental-diff.ts";
import {
  buildPriorFindingContext,
  type PriorFindingContext,
} from "../lib/finding-dedup.ts";
import type { PriorFinding } from "../knowledge/types.ts";

type ReviewPriorFindingKnowledgeStore = {
  getPriorReviewFindings(params: { repo: string; prNumber: number }): PriorFinding[] | Promise<PriorFinding[]>;
};

type ReviewPriorFindingLogger = Pick<Logger, "warn">;

export type ReviewPriorFindingContextResult = {
  priorFindings: PriorFinding[];
  priorFindingCtx: PriorFindingContext | null;
};

export async function resolveReviewPriorFindingContext(params: {
  knowledgeStore: ReviewPriorFindingKnowledgeStore | undefined;
  incrementalResult: IncrementalDiffResult | null | undefined;
  repo: string;
  prNumber: number;
  baseLog: Record<string, unknown>;
  logger: ReviewPriorFindingLogger;
}): Promise<ReviewPriorFindingContextResult> {
  if (!params.knowledgeStore || params.incrementalResult?.mode !== "incremental") {
    return { priorFindings: [], priorFindingCtx: null };
  }

  try {
    const priorFindings = await params.knowledgeStore.getPriorReviewFindings({
      repo: params.repo,
      prNumber: params.prNumber,
    });
    const priorFindingCtx = priorFindings.length > 0
      ? buildPriorFindingContext({
          priorFindings,
          changedFilesSinceLastReview: params.incrementalResult.changedFilesSinceLastReview,
        })
      : null;

    return { priorFindings, priorFindingCtx };
  } catch (err) {
    params.logger.warn(
      { ...params.baseLog, err },
      "Prior finding context failed (fail-open, no dedup)",
    );
    return { priorFindings: [], priorFindingCtx: null };
  }
}
