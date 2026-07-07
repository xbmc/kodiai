import type { Logger } from "pino";
import type { RepoConfig } from "../execution/config.ts";
import { analyzeDiff } from "../execution/diff-analysis.ts";
import type { KnowledgeStore } from "../knowledge/types.ts";
import type { IncrementalDiffResult } from "../lib/incremental-diff.ts";
import type { ReviewGraphBlastRadiusResult } from "../review-graph/query.ts";
import type { StructuralImpactCache } from "../structural-impact/cache.ts";
import type { StructuralImpactPayload } from "../structural-impact/types.ts";
import { buildReviewFileRiskScores, resolveReviewLargePrTriage } from "./review-large-pr-triage.ts";
import { resolveReviewStructuralImpactSelection } from "./review-structural-impact-selection.ts";
import { resolveReviewPathInstructions } from "./review-path-instructions.ts";
import { resolveReviewRepoDoctrineContext } from "./review-repo-doctrine-context.ts";
import { resolveReviewPriorFindingContext } from "./review-prior-finding-context.ts";

type ReviewChangedFileContextConfig = Pick<RepoConfig, "review" | "largePR">;

export async function resolveReviewChangedFileContext(params: {
  changedFiles: string[];
  reviewFiles: string[];
  numstatLines: string[];
  diffContent: string | undefined;
  config: ReviewChangedFileContextConfig;
  reviewGraphQuery: ((input: {
    repo: string;
    workspaceKey: string;
    changedPaths: string[];
    limit?: number;
  }) => Promise<ReviewGraphBlastRadiusResult>) | undefined;
  structuralImpactCache: StructuralImpactCache;
  owner: string;
  repo: string;
  workspaceKey: string;
  baseSha: string;
  headSha: string;
  canonicalRef: string;
  incrementalResult: IncrementalDiffResult | null;
  knowledgeStore: Pick<KnowledgeStore, "getPriorReviewFindings"> | undefined;
  prNumber: number;
  baseLog: Record<string, unknown>;
  logger: Logger;
}): Promise<{
  diffAnalysis: ReturnType<typeof analyzeDiff>;
  diffContent: string | undefined;
  riskScores: ReturnType<typeof buildReviewFileRiskScores>["riskScores"];
  perFileStats: ReturnType<typeof buildReviewFileRiskScores>["perFileStats"];
  graphSelection: Awaited<ReturnType<typeof resolveReviewStructuralImpactSelection>>["graphSelection"];
  graphBlastRadius: ReviewGraphBlastRadiusResult | null;
  graphQueryBypassedForTrivialChange: boolean;
  structuralImpactForReview: StructuralImpactPayload | null;
  tieredFiles: ReturnType<typeof resolveReviewLargePrTriage>["tieredFiles"];
  promptFiles: string[];
  matchedPathInstructions: ReturnType<typeof resolveReviewPathInstructions>;
  repoDoctrineProjection: ReturnType<typeof resolveReviewRepoDoctrineContext>["repoDoctrineProjection"];
  repoDoctrineReviewSurface: ReturnType<typeof resolveReviewRepoDoctrineContext>["repoDoctrineReviewSurface"];
  priorFindings: Awaited<ReturnType<typeof resolveReviewPriorFindingContext>>["priorFindings"];
  priorFindingCtx: Awaited<ReturnType<typeof resolveReviewPriorFindingContext>>["priorFindingCtx"];
}> {
  const diffAnalysis = analyzeDiff({
    changedFiles: params.changedFiles,
    numstatLines: params.numstatLines,
    diffContent: params.diffContent,
    fileCategories: params.config.review.fileCategories as Record<string, string[]> | undefined,
  });

  const { riskScores, perFileStats } = buildReviewFileRiskScores({
    reviewFiles: params.reviewFiles,
    numstatLines: params.numstatLines,
    filesByCategory: diffAnalysis.filesByCategory,
    riskWeights: params.config.largePR.riskWeights,
  });

  const structuralImpactSelection = await resolveReviewStructuralImpactSelection({
    reviewGraphQuery: params.reviewGraphQuery,
    structuralImpactCache: params.structuralImpactCache,
    logger: params.logger,
    baseLog: params.baseLog,
    owner: params.owner,
    repo: params.repo,
    workspaceKey: params.workspaceKey,
    baseSha: params.baseSha,
    headSha: params.headSha,
    changedPaths: params.reviewFiles,
    canonicalRef: params.canonicalRef,
    fullReviewCount: params.config.largePR.fullReviewCount,
    abbreviatedCount: params.config.largePR.abbreviatedCount,
    totalLinesChanged:
      (diffAnalysis.metrics.totalLinesAdded ?? 0)
      + (diffAnalysis.metrics.totalLinesRemoved ?? 0),
    riskScores,
  });

  const largePrTriage = resolveReviewLargePrTriage({
    graphSelection: structuralImpactSelection.graphSelection,
    reviewFiles: params.reviewFiles,
    changedFiles: params.changedFiles,
    largePrConfig: params.config.largePR,
    baseLog: params.baseLog,
    logger: params.logger,
  });

  const matchedPathInstructions = resolveReviewPathInstructions({
    pathInstructions: params.config.review.pathInstructions,
    changedFiles: params.changedFiles,
  });

  const {
    repoDoctrineProjection,
    repoDoctrineReviewSurface,
  } = resolveReviewRepoDoctrineContext({
    doctrine: params.config.review.doctrine,
    changedFiles: params.changedFiles,
    baseLog: params.baseLog,
    logger: params.logger,
  });

  const { priorFindings, priorFindingCtx } = await resolveReviewPriorFindingContext({
    knowledgeStore: params.knowledgeStore,
    incrementalResult: params.incrementalResult,
    repo: `${params.owner}/${params.repo}`,
    prNumber: params.prNumber,
    baseLog: params.baseLog,
    logger: params.logger,
  });

  return {
    diffAnalysis,
    diffContent: params.diffContent,
    riskScores,
    perFileStats,
    graphSelection: structuralImpactSelection.graphSelection,
    graphBlastRadius: structuralImpactSelection.graphBlastRadius,
    graphQueryBypassedForTrivialChange: structuralImpactSelection.graphQueryBypassedForTrivialChange,
    structuralImpactForReview: structuralImpactSelection.structuralImpactForReview,
    tieredFiles: largePrTriage.tieredFiles,
    promptFiles: largePrTriage.promptFiles,
    matchedPathInstructions,
    repoDoctrineProjection,
    repoDoctrineReviewSurface,
    priorFindings,
    priorFindingCtx,
  };
}
