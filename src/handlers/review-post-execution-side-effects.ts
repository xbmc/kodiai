import type { Logger } from "pino";
import type { ContributorProfileStore } from "../contributor/types.ts";
import { updateExpertiseIncremental } from "../contributor/expertise-scorer.ts";
import type { CodeSnippetStore } from "../knowledge/code-snippet-types.ts";
import type { EmbeddingProvider, LearningMemoryStore } from "../knowledge/types.ts";
import { classifyFileLanguageWithContext } from "../execution/diff-analysis.ts";
import { err as resultErr, ok as resultOk, toError, type Result } from "../lib/result.ts";
import { splitDiffByFile } from "../lib/review-git-utils.ts";
import { embedReviewDiffHunks } from "../review-orchestration/review-diff-hunk-embedding.ts";
import {
  type ReviewLearningMemoryFindingInput,
  scheduleReviewLearningMemoryBatch,
} from "./review-learning-memory.ts";

type SideEffectLogger = Pick<Logger, "warn">;
export type ReviewRunCompletionStatus = "completed";
export type ReviewRunCompletionResult = Result<ReviewRunCompletionStatus>;

export async function completeReviewRunFailOpen(params: {
  knowledgeStore: { completeRun(runKey: string): Promise<void> };
  repo: string;
  prNumber: number;
  baseSha: string;
  headSha: string;
  logger: SideEffectLogger;
  logContext: Record<string, unknown>;
}): Promise<ReviewRunCompletionResult> {
  const { knowledgeStore, repo, prNumber, baseSha, headSha, logger, logContext } = params;
  const runKey = `${repo}:pr-${prNumber}:base-${baseSha}:head-${headSha}`;

  try {
    await knowledgeStore.completeRun(runKey);
    return resultOk("completed");
  } catch (err) {
    const error = toError(err);
    logger.warn({ ...logContext, err: error }, "Failed to mark run as completed (non-fatal)");
    return resultErr(error);
  }
}

export function scheduleContributorExpertiseUpdate(params: {
  contributorProfileStore: ContributorProfileStore;
  githubUsername: string;
  filesChanged: string[];
  logger: SideEffectLogger;
  updateExpertise?: typeof updateExpertiseIncremental;
}): "scheduled" {
  const {
    contributorProfileStore,
    githubUsername,
    filesChanged,
    logger,
    updateExpertise = updateExpertiseIncremental,
  } = params;

  updateExpertise({
    githubUsername,
    filesChanged,
    type: "pr_authored",
    profileStore: contributorProfileStore,
    logger: logger as Logger,
  }).catch((err) => logger.warn({ err }, "Contributor expertise update failed (non-blocking)"));

  return "scheduled";
}

export function scheduleReviewHunkEmbedding(params: {
  diffContent?: string | null;
  repo: string;
  owner: string;
  prNumber: number;
  prTitle: string;
  codeSnippetStore?: CodeSnippetStore | null;
  embeddingProvider?: EmbeddingProvider | null;
  config: { enabled: boolean; maxHunksPerPr: number; minChangedLines: number; excludePatterns: string[] };
  logger: Logger;
  logContext: Record<string, unknown>;
  embedHunks?: typeof embedReviewDiffHunks;
}): "scheduled" | "skipped" {
  const {
    diffContent,
    repo,
    owner,
    prNumber,
    prTitle,
    codeSnippetStore,
    embeddingProvider,
    config,
    logger,
    logContext,
    embedHunks = embedReviewDiffHunks,
  } = params;

  if (!codeSnippetStore || !embeddingProvider || !config.enabled || !diffContent) {
    return "skipped";
  }

  embedHunks({
    diffFiles: splitDiffByFile(diffContent),
    repo,
    owner,
    prNumber,
    prTitle,
    codeSnippetStore,
    embeddingProvider,
    config,
    logger,
  }).catch((err) => {
    logger.warn({ ...logContext, err }, "Hunk embedding failed (fire-and-forget)");
  });

  return "scheduled";
}

export async function recordReviewPostExecutionSideEffects(params: {
  knowledgeStore?: { completeRun(runKey: string): Promise<void> };
  repo: string;
  owner: string;
  prNumber: number;
  prAuthor: string;
  prTitle: string;
  baseSha: string;
  headSha: string;
  filesChanged: string[];
  changedFilesForLanguageContext: string[];
  findings: ReviewLearningMemoryFindingInput[];
  reviewId?: number;
  diffContent?: string | null;
  hunkEmbeddingConfig: { enabled: boolean; maxHunksPerPr: number; minChangedLines: number; excludePatterns: string[] };
  contributorProfileStore?: ContributorProfileStore;
  learningMemoryStore?: Pick<LearningMemoryStore, "hasMemoryConflict" | "writeMemory">;
  codeSnippetStore?: CodeSnippetStore | null;
  embeddingProvider?: EmbeddingProvider | null;
  logger: Logger;
  logContext: Record<string, unknown>;
  completeRunFailOpen?: typeof completeReviewRunFailOpen;
  scheduleExpertiseUpdate?: typeof scheduleContributorExpertiseUpdate;
  scheduleLearningMemoryBatch?: typeof scheduleReviewLearningMemoryBatch;
  scheduleHunkEmbedding?: typeof scheduleReviewHunkEmbedding;
}): Promise<void> {
  const {
    knowledgeStore,
    repo,
    owner,
    prNumber,
    prAuthor,
    prTitle,
    baseSha,
    headSha,
    filesChanged,
    changedFilesForLanguageContext,
    findings,
    reviewId,
    diffContent,
    hunkEmbeddingConfig,
    contributorProfileStore,
    learningMemoryStore,
    codeSnippetStore,
    embeddingProvider,
    logger,
    logContext,
    completeRunFailOpen = completeReviewRunFailOpen,
    scheduleExpertiseUpdate = scheduleContributorExpertiseUpdate,
    scheduleLearningMemoryBatch = scheduleReviewLearningMemoryBatch,
    scheduleHunkEmbedding = scheduleReviewHunkEmbedding,
  } = params;

  if (knowledgeStore) {
    await completeRunFailOpen({
      knowledgeStore,
      repo,
      prNumber,
      baseSha,
      headSha,
      logger,
      logContext,
    });
  }

  if (contributorProfileStore) {
    scheduleExpertiseUpdate({
      contributorProfileStore,
      githubUsername: prAuthor,
      filesChanged,
      logger,
    });
  }

  if (learningMemoryStore && embeddingProvider && findings.length > 0) {
    scheduleLearningMemoryBatch({
      findings,
      owner,
      repo,
      reviewId,
      prNumber,
      store: learningMemoryStore,
      embeddingProvider,
      logger,
      logContext,
      classifyLanguage: (filePath) => classifyFileLanguageWithContext(filePath, changedFilesForLanguageContext),
    });
  }

  scheduleHunkEmbedding({
    diffContent,
    repo,
    owner,
    prNumber,
    prTitle,
    codeSnippetStore,
    embeddingProvider,
    config: hunkEmbeddingConfig,
    logger,
    logContext,
  });
}
