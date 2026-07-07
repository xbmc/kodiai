import type { Logger } from "pino";
import type { IncrementalDiffResult } from "../lib/incremental-diff.ts";
import {
  resolveReviewFilesForIncrementalReview as defaultResolveReviewFilesForIncrementalReview,
} from "./review-incremental-diff.ts";
import {
  evaluateReviewSkipPathsGate as defaultEvaluateReviewSkipPathsGate,
} from "./review-skip-paths-gate.ts";
import {
  resolveReviewShadowSpecialistContext as defaultResolveReviewShadowSpecialistContext,
  type ReviewShadowSpecialistContext,
} from "./review-shadow-specialist.ts";

type EvaluateReviewSkipPathsGate = typeof defaultEvaluateReviewSkipPathsGate;
type ResolveReviewShadowSpecialistContext = typeof defaultResolveReviewShadowSpecialistContext;
type ResolveReviewFilesForIncrementalReview = typeof defaultResolveReviewFilesForIncrementalReview;

export type ReviewFileSelectionContext =
  | { action: "skip" }
  | ({
    action: "continue";
    changedFiles: string[];
    reviewFiles: string[];
    numstatLines: string[];
    diffContent: string | undefined;
  } & ReviewShadowSpecialistContext);

export async function resolveReviewFileSelectionContext(params: {
  prNumber: number;
  allChangedFiles: readonly string[];
  skipPaths: readonly string[];
  diffContentForValidation: string;
  diffContext: {
    numstatLines: string[];
    diffContent?: string;
  };
  workspaceDir: string;
  deliveryId: string;
  reviewOutputKey: string;
  incrementalResult: IncrementalDiffResult | null;
  baseLog: Record<string, unknown>;
  logger: Pick<Logger, "info" | "warn">;
  shadowSpecialistSubflow: Parameters<ResolveReviewShadowSpecialistContext>[0]["shadowSpecialistSubflow"];
  evaluateSkipPathsGate?: EvaluateReviewSkipPathsGate;
  resolveShadowSpecialistContext?: ResolveReviewShadowSpecialistContext;
  resolveReviewFilesForIncrementalReview?: ResolveReviewFilesForIncrementalReview;
}): Promise<ReviewFileSelectionContext> {
  const evaluateSkipPathsGate = params.evaluateSkipPathsGate ?? defaultEvaluateReviewSkipPathsGate;
  const resolveShadowSpecialistContext =
    params.resolveShadowSpecialistContext ?? defaultResolveReviewShadowSpecialistContext;
  const resolveReviewFilesForIncrementalReview =
    params.resolveReviewFilesForIncrementalReview ?? defaultResolveReviewFilesForIncrementalReview;

  const skipPathsGate = evaluateSkipPathsGate({
    prNumber: params.prNumber,
    allChangedFiles: params.allChangedFiles,
    skipPaths: params.skipPaths,
    logger: params.logger,
  });
  if (skipPathsGate.action === "skip") {
    return { action: "skip" };
  }

  const changedFiles = skipPathsGate.changedFiles;
  const shadowContext = await resolveShadowSpecialistContext({
    changedFiles,
    diffContentForValidation: params.diffContentForValidation,
    workspaceDir: params.workspaceDir,
    deliveryId: params.deliveryId,
    reviewOutputKey: params.reviewOutputKey,
    prNumber: params.prNumber,
    baseLog: params.baseLog,
    logger: params.logger,
    shadowSpecialistSubflow: params.shadowSpecialistSubflow,
  });
  const reviewFiles = resolveReviewFilesForIncrementalReview({
    changedFiles,
    incrementalResult: params.incrementalResult,
    baseLog: params.baseLog,
    logger: params.logger,
  });

  return {
    action: "continue",
    changedFiles,
    ...shadowContext,
    reviewFiles,
    numstatLines: params.diffContext.numstatLines,
    diffContent: changedFiles.length <= 200 ? params.diffContext.diffContent : undefined,
  };
}
