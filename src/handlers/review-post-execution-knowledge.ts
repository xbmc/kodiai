import type { Logger } from "pino";
import type { ExecutionResult } from "../execution/types.ts";
import type { RepoConfig } from "../execution/config.ts";
import type { KnowledgeStore, LearningMemoryStore, EmbeddingProvider } from "../knowledge/types.ts";
import type { ContributorProfileStore } from "../contributor/types.ts";
import type { CodeSnippetStore } from "../knowledge/code-snippet-types.ts";
import type { ReviewKnowledgeFinding } from "./review-knowledge-persistence.ts";
import { persistReviewKnowledgeIfAvailable } from "./review-knowledge-persistence.ts";
import { recordReviewPostExecutionSideEffects } from "./review-post-execution-side-effects.ts";

type ReviewPostExecutionPr = {
  number: number;
  title: string;
  user: { login: string };
  head: { sha: string };
  base: { sha: string };
};

type ReviewPostExecutionConfig = Pick<RepoConfig, "review" | "knowledge" | "model">;

export async function recordReviewPostExecutionKnowledge(params: {
  knowledgeStore: KnowledgeStore | undefined;
  logger: Pick<Logger, "debug" | "warn"> & Logger;
  repo: string;
  owner: string;
  pr: ReviewPostExecutionPr;
  reviewOutputKey: string;
  deliveryId: string;
  filesAnalyzed: number;
  linesChanged: number;
  findingCounts: {
    critical: number;
    major: number;
    medium: number;
    minor: number;
  };
  processedFindings: ReviewKnowledgeFinding[];
  suppressionMatchCounts: Map<string, number>;
  visibleFindingCount: number;
  lowConfidenceFindingCount: number;
  suppressionsApplied: number;
  config: ReviewPostExecutionConfig;
  reviewPlanConfigSnapshot: unknown;
  reducerResult: {
    status: string;
    counts: unknown;
    reason?: string;
  };
  reviewCandidateFindingConfigSnapshot: unknown;
  reviewCandidatePublicationRuntime: {
    safeConfigSnapshot: unknown;
  };
  reviewCandidatePublicationFlow: unknown;
  result: Pick<ExecutionResult, "durationMs" | "conclusion">;
  contributorProfileStore?: ContributorProfileStore;
  learningMemoryStore?: Pick<LearningMemoryStore, "hasMemoryConflict" | "writeMemory">;
  codeSnippetStore?: CodeSnippetStore | null;
  embeddingProvider?: EmbeddingProvider | null;
  reviewFiles: string[];
  changedFiles: string[];
  diffContent?: string | null;
  baseLog: Record<string, unknown>;
  persistKnowledge?: typeof persistReviewKnowledgeIfAvailable;
  recordSideEffects?: typeof recordReviewPostExecutionSideEffects;
}): Promise<number | undefined> {
  const persistKnowledge = params.persistKnowledge ?? persistReviewKnowledgeIfAvailable;
  const recordSideEffects = params.recordSideEffects ?? recordReviewPostExecutionSideEffects;
  const reviewId = await persistKnowledge({
    knowledgeStore: params.knowledgeStore,
    logger: params.logger,
    repo: params.repo,
    prNumber: params.pr.number,
    reviewOutputKey: params.reviewOutputKey,
    record: {
      repo: params.repo,
      prNumber: params.pr.number,
      headSha: params.pr.head.sha,
      deliveryId: params.deliveryId,
      filesAnalyzed: params.filesAnalyzed,
      linesChanged: params.linesChanged,
      findingCounts: params.findingCounts,
      findingsTotal: params.processedFindings.length,
      suppressionsApplied: params.suppressionsApplied,
      reviewConfig: {
        mode: params.config.review.mode,
        severityMinLevel: params.config.review.severity.minLevel,
        focusAreas: params.config.review.focusAreas,
        maxComments: params.config.review.maxComments,
        suppressionCount: params.config.review.suppressions.length,
        minConfidence: params.config.review.minConfidence,
        profile: params.config.review.profile,
      },
      shareGlobal: params.config.knowledge.shareGlobal,
      reviewPlan: params.reviewPlanConfigSnapshot,
      reviewReducer: {
        status: params.reducerResult.status,
        counts: params.reducerResult.counts,
        reason: params.reducerResult.reason,
      },
      reviewCandidateFinding: params.reviewCandidateFindingConfigSnapshot,
      reviewCandidatePublication: params.reviewCandidatePublicationRuntime.safeConfigSnapshot,
      reviewCandidatePublicationFlow: params.reviewCandidatePublicationFlow,
      durationMs: params.result.durationMs,
      model: params.config.model,
      conclusion: params.result.conclusion,
    },
    processedFindings: params.processedFindings,
    suppressionMatchCounts: params.suppressionMatchCounts,
    visibleFindingCount: params.visibleFindingCount,
    lowConfidenceFindingCount: params.lowConfidenceFindingCount,
    suppressionsApplied: params.suppressionsApplied,
    shareGlobal: params.config.knowledge.shareGlobal,
  });

  await recordSideEffects({
    knowledgeStore: params.knowledgeStore,
    repo: params.repo,
    owner: params.owner,
    prNumber: params.pr.number,
    prAuthor: params.pr.user.login,
    prTitle: params.pr.title,
    baseSha: params.pr.base.sha,
    headSha: params.pr.head.sha,
    filesChanged: params.reviewFiles,
    changedFilesForLanguageContext: params.changedFiles,
    findings: params.processedFindings,
    reviewId,
    diffContent: params.diffContent,
    hunkEmbeddingConfig: params.config.knowledge.retrieval.hunkEmbedding,
    contributorProfileStore: params.contributorProfileStore,
    learningMemoryStore: params.learningMemoryStore,
    codeSnippetStore: params.codeSnippetStore,
    embeddingProvider: params.embeddingProvider,
    logger: params.logger,
    logContext: params.baseLog,
  });

  return reviewId;
}
