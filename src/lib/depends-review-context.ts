import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import type { UnifiedRetrievalChunk } from "../knowledge/cross-corpus-rrf.ts";
import type { createRetriever } from "../knowledge/retrieval.ts";
import type { DependsBumpInfo } from "./depends-bump-detector.ts";
import type { DependsReviewData } from "./depends-review-builder.ts";
import {
  buildDependsReviewData,
  collectDependsReviewSignals,
  type DependsReviewFile,
  type DependsReviewSignalOptions,
  type DependsReviewSignals,
} from "./depends-review-signals.ts";

type DependsRetriever = Pick<ReturnType<typeof createRetriever>, "retrieve">;

export type DependsReviewContextSummaryInput = {
  packageName: string;
  snippets: string;
  repo: string;
  deliveryId: string;
};

export type DependsReviewContextResult = {
  reviewData: DependsReviewData;
  hasSourceChanges: boolean;
  prFiles: DependsReviewFile[];
};

type DependsReviewContextBuilderDependencies = {
  collectSignals: (opts: DependsReviewSignalOptions) => Promise<DependsReviewSignals>;
};

function formatDependsRetrievalSnippets(chunks: UnifiedRetrievalChunk[]): string {
  return chunks
    .map((chunk, index) => {
      const author = (chunk.metadata?.authorLogin as string | undefined) ?? "unknown";
      const date = chunk.createdAt ? new Date(chunk.createdAt).toISOString().slice(0, 10) : "?";
      return `${index + 1}. @${author} (${date}): ${chunk.text.trim().slice(0, 200)}`;
    })
    .join("\n");
}

async function retrieveDependsContext(opts: {
  retriever?: DependsRetriever | null;
  packageName?: string;
  owner: string;
  repo: string;
  workspaceDir?: string | null;
  logger: Logger;
  baseLog: Record<string, unknown>;
}): Promise<UnifiedRetrievalChunk[] | null> {
  const { retriever, packageName, owner, repo, workspaceDir, logger, baseLog } = opts;
  if (!retriever || !packageName) return null;

  try {
    const result = await retriever.retrieve({
      repo: `${owner}/${repo}`,
      owner,
      queries: [`${packageName} dependency bump update`],
      workspaceDir: workspaceDir ?? "",
      prLanguages: ["c", "cpp", "cmake"],
      logger,
      triggerType: "pr_review",
    });
    return result && result.unifiedResults.length > 0 ? result.unifiedResults.slice(0, 3) : null;
  } catch (err) {
    logger.warn({ ...baseLog, err, gate: "depends-retrieval" }, "Retrieval context failed (fail-open)");
    return null;
  }
}

async function summarizeDependsContext(opts: {
  retrievalContext: UnifiedRetrievalChunk[] | null;
  packageName: string;
  owner: string;
  repo: string;
  deliveryId: string;
  summarize?: (input: DependsReviewContextSummaryInput) => Promise<string | null>;
  logger: Logger;
  baseLog: Record<string, unknown>;
}): Promise<string | null> {
  const { retrievalContext, packageName, owner, repo, deliveryId, summarize, logger, baseLog } = opts;
  if (!summarize || !retrievalContext || retrievalContext.length === 0) return null;

  try {
    const text = await summarize({
      packageName,
      snippets: formatDependsRetrievalSnippets(retrievalContext),
      repo: `${owner}/${repo}`,
      deliveryId,
    });
    return text?.trim() || null;
  } catch (err) {
    logger.warn({ ...baseLog, err, gate: "depends-context-summary" }, "Context summary generation failed (fail-open)");
    return null;
  }
}

type DependsReviewContextOptions = {
  info: DependsBumpInfo;
  prFiles: DependsReviewFile[];
  octokit: Octokit;
  owner: string;
  repo: string;
  workspaceDir?: string | null;
  logger: Logger;
  baseLog: Record<string, unknown>;
  deliveryId: string;
  retriever?: DependsRetriever | null;
  summarize?: (input: DependsReviewContextSummaryInput) => Promise<string | null>;
};

export function createDependsReviewContextBuilder(
  dependencies: DependsReviewContextBuilderDependencies = {
    collectSignals: collectDependsReviewSignals,
  },
): (opts: DependsReviewContextOptions) => Promise<DependsReviewContextResult> {
  return async function buildDependsReviewContextWithDependencies(
    opts: DependsReviewContextOptions,
  ): Promise<DependsReviewContextResult> {
    const { info, owner, repo, workspaceDir, logger, baseLog } = opts;
    const primaryPackageName = info.packages[0]?.name;
    const [dependsSignals, retrievalContext] = await Promise.all([
      dependencies.collectSignals({
        info,
        prFiles: opts.prFiles,
        octokit: opts.octokit,
        owner,
        repo,
        workspaceDir,
        logger,
        baseLog,
      }),
      retrieveDependsContext({
        retriever: opts.retriever,
        packageName: primaryPackageName,
        owner,
        repo,
        workspaceDir,
        logger,
        baseLog,
      }),
    ]);
    const contextSummary = await summarizeDependsContext({
      retrievalContext,
      packageName: primaryPackageName ?? "this dependency",
      owner,
      repo,
      deliveryId: opts.deliveryId,
      summarize: opts.summarize,
      logger,
      baseLog,
    });

    return {
      reviewData: buildDependsReviewData(dependsSignals.signals, {
        retrievalContext,
        contextSummary,
      }),
      hasSourceChanges: dependsSignals.hasSourceChanges,
      prFiles: dependsSignals.prFiles,
    };
  };
}

export const buildDependsReviewContext = createDependsReviewContextBuilder();
