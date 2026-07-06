import type { Logger } from "pino";
import type { ContributorProfileStore } from "../contributor/types.ts";
import { updateExpertiseIncremental } from "../contributor/expertise-scorer.ts";
import type { CodeSnippetStore } from "../knowledge/code-snippet-types.ts";
import type { EmbeddingProvider } from "../knowledge/types.ts";
import { err as resultErr, ok as resultOk, toError, type Result } from "../lib/result.ts";
import { splitDiffByFile } from "../lib/review-git-utils.ts";
import { embedReviewDiffHunks } from "../review-orchestration/review-diff-hunk-embedding.ts";

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
