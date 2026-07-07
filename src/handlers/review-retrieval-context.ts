import type { Logger } from "pino";
import type { createRetriever } from "../knowledge/retrieval.ts";
import type { TelemetryStore } from "../telemetry/types.ts";
import type { ContributorExperienceContract } from "../contributor/experience-contract.ts";
import type { ReviewAuthorClassification } from "../contributor/review-author-resolution.ts";
import type { DiffAnalysis } from "../execution/diff-analysis.ts";
import type { RepoConfig } from "../execution/config.ts";
import type { ParsedPRIntent } from "../lib/pr-intent-parser.ts";
import type { ReviewCommentMatch } from "../knowledge/review-comment-retrieval.ts";
import type { WikiKnowledgeMatch } from "../knowledge/wiki-retrieval.ts";
import type { UnifiedRetrievalChunk } from "../knowledge/cross-corpus-rrf.ts";
import { buildRetrievalVariants } from "../knowledge/multi-query-retrieval.ts";
import { resolveContributorExperienceRetrievalHint } from "../contributor/experience-contract.ts";
import { buildRetrievalReviewCacheEvent } from "../review-orchestration/review-prompt-cache-events.ts";
import {
  createReviewVisibleBudgetProjectionState,
  type ReviewVisibleBudgetProjectionState,
} from "./review-visible-budget-state.ts";
import { recordReviewCacheEventFailOpen } from "./review-handler-utils.ts";

export type ReviewRetrievalContextForPrompt = {
  findings: Array<{
    findingText: string;
    severity: string;
    category: string;
    path: string;
    line?: number;
    snippet?: string;
    outcome: string;
    distance: number;
    sourceRepo: string;
  }>;
  maxChars: number;
};

export type ReviewRetrievalContextResult = {
  retrievalContext: ReviewRetrievalContextForPrompt | null;
  visibleBudgetState: ReviewVisibleBudgetProjectionState;
  reviewPrecedents: ReviewCommentMatch[];
  wikiKnowledge: WikiKnowledgeMatch[];
  unifiedResults: UnifiedRetrievalChunk[];
  contextWindow?: string;
};

type ReviewRetrievalPromptConfig = Pick<RepoConfig, "knowledge" | "telemetry">;

type BuildReviewRetrievalContext = typeof buildReviewRetrievalContext;

export type ReviewRetrievalPromptContextResult = {
  reviewRetrievalContext: ReviewRetrievalContextResult;
  retrievalCtx: ReviewRetrievalContextResult["retrievalContext"];
  visibleBudgetState: ReviewRetrievalContextResult["visibleBudgetState"];
  reviewPrecedentsForPrompt: ReviewRetrievalContextResult["reviewPrecedents"];
  wikiKnowledgeForPrompt: ReviewRetrievalContextResult["wikiKnowledge"];
  unifiedResultsForPrompt: ReviewRetrievalContextResult["unifiedResults"];
  contextWindowForPrompt: ReviewRetrievalContextResult["contextWindow"];
};

export async function resolveReviewRetrievalPromptContext(params: {
  retriever?: ReturnType<typeof createRetriever>;
  apiOwner: string;
  apiRepo: string;
  pr: {
    number: number;
    title: string;
    body?: string | null;
  };
  event: {
    id: string;
    name: string;
  };
  workspaceDir: string;
  parsedIntent: Pick<ParsedPRIntent, "conventionalType">;
  diffAnalysis: Pick<DiffAnalysis, "filesByLanguage" | "riskSignals">;
  reviewFiles: string[];
  authorContract: ReviewAuthorClassification["contract"];
  config: ReviewRetrievalPromptConfig;
  telemetryStore: Pick<
    TelemetryStore,
    "recordRateLimitEvent" | "recordRetrievalQuality" | "recordReviewCacheEvent"
  >;
  logger: Pick<Logger, "warn">;
  baseLog: Record<string, unknown>;
  buildContext?: BuildReviewRetrievalContext;
}): Promise<ReviewRetrievalPromptContextResult> {
  const buildContext = params.buildContext ?? buildReviewRetrievalContext;
  const reviewRetrievalContext = await buildContext({
    retriever: params.retriever,
    repo: `${params.apiOwner}/${params.apiRepo}`,
    owner: params.apiOwner,
    prNumber: params.pr.number,
    deliveryId: params.event.id,
    eventName: params.event.name,
    workspaceDir: params.workspaceDir,
    prTitle: params.pr.title,
    prBody: params.pr.body ?? undefined,
    conventionalType: params.parsedIntent.conventionalType?.type ?? null,
    prLanguages: Object.keys(params.diffAnalysis.filesByLanguage ?? {}),
    riskSignals: params.diffAnalysis.riskSignals ?? [],
    filePaths: params.reviewFiles,
    authorContract: params.authorContract,
    retrievalConfig: {
      topK: params.config.knowledge.retrieval.topK,
      maxContextChars: params.config.knowledge.retrieval.maxContextChars,
    },
    telemetryEnabled: params.config.telemetry.enabled,
    telemetryStore: params.telemetryStore,
    logger: params.logger,
    baseLog: params.baseLog,
  });

  return {
    reviewRetrievalContext,
    retrievalCtx: reviewRetrievalContext.retrievalContext,
    visibleBudgetState: reviewRetrievalContext.visibleBudgetState,
    reviewPrecedentsForPrompt: reviewRetrievalContext.reviewPrecedents,
    wikiKnowledgeForPrompt: reviewRetrievalContext.wikiKnowledge,
    unifiedResultsForPrompt: reviewRetrievalContext.unifiedResults,
    contextWindowForPrompt: reviewRetrievalContext.contextWindow,
  };
}

export async function buildReviewRetrievalContext(params: {
  retriever?: ReturnType<typeof createRetriever>;
  repo: string;
  owner: string;
  prNumber: number;
  deliveryId: string;
  eventName: string;
  workspaceDir: string;
  prTitle: string;
  prBody?: string;
  conventionalType?: string | null;
  prLanguages: string[];
  riskSignals: string[];
  filePaths: string[];
  authorContract?: Partial<
    Pick<ContributorExperienceContract, "state" | "promptPolicy" | "promptTier">
  > | null;
  retrievalConfig: {
    topK: number;
    maxContextChars: number;
  };
  telemetryEnabled: boolean;
  telemetryStore: Pick<
    TelemetryStore,
    "recordRateLimitEvent" | "recordRetrievalQuality" | "recordReviewCacheEvent"
  >;
  logger: Pick<Logger, "warn">;
  baseLog: Record<string, unknown>;
}): Promise<ReviewRetrievalContextResult> {
  const visibleBudgetState = createReviewVisibleBudgetProjectionState();
  let retrievalContext: ReviewRetrievalContextForPrompt | null = null;
  let reviewPrecedents: ReviewCommentMatch[] = [];
  let wikiKnowledge: WikiKnowledgeMatch[] = [];
  let unifiedResults: UnifiedRetrievalChunk[] = [];
  let contextWindow: string | undefined;

  if (!params.retriever) {
    return {
      retrievalContext,
      visibleBudgetState,
      reviewPrecedents,
      wikiKnowledge,
      unifiedResults,
      contextWindow,
    };
  }

  try {
    const authorHint = resolveContributorExperienceRetrievalHint(params.authorContract);
    const variants = buildRetrievalVariants({
      title: params.prTitle,
      body: params.prBody,
      conventionalType: params.conventionalType ?? null,
      prLanguages: params.prLanguages,
      riskSignals: params.riskSignals,
      filePaths: params.filePaths,
      authorHint: authorHint ?? undefined,
    });

    const result = await params.retriever.retrieve({
      repo: params.repo,
      owner: params.owner,
      queries: variants.map((v) => v.query),
      workspaceDir: params.workspaceDir,
      prLanguages: params.prLanguages,
      logger: params.logger as Logger,
      triggerType: "pr_review",
    });

    const retrievalCacheEvent = buildRetrievalReviewCacheEvent({
      deliveryId: params.deliveryId,
      repo: params.repo,
      prNumber: params.prNumber,
      result,
    });
    visibleBudgetState.reviewCacheObservations.push(retrievalCacheEvent);

    if (params.telemetryEnabled) {
      try {
        const totalEmbeddingLookups = (result?.provenance?.embeddingRequests ?? 0)
          + (result?.provenance?.embeddingCacheHits ?? 0);
        await params.telemetryStore.recordRateLimitEvent({
          deliveryId: params.deliveryId,
          executionIdentity: `${params.deliveryId}:reuse.retrieval-query-embedding.main`,
          repo: params.repo,
          prNumber: params.prNumber,
          eventType: "reuse.retrieval-query-embedding.main",
          cacheHitRate: totalEmbeddingLookups > 0
            ? (result?.provenance?.embeddingCacheHits ?? 0) / totalEmbeddingLookups
            : 0,
          skippedQueries: result?.provenance?.embeddingCacheHits ?? 0,
          retryAttempts: result?.provenance?.embeddingRequests ?? 0,
          degradationPath: retrievalCacheEvent.reason
            ? `${retrievalCacheEvent.status}:${retrievalCacheEvent.reason}`
            : retrievalCacheEvent.status,
        });
      } catch (err) {
        params.logger.warn(
          { ...params.baseLog, err },
          "Review retrieval reuse telemetry write failed (non-blocking)",
        );
      }

      await recordReviewCacheEventFailOpen({
        telemetryStore: params.telemetryStore,
        logger: params.logger,
        entry: retrievalCacheEvent,
      });
    }

    if (result && result.unifiedResults && result.unifiedResults.length > 0) {
      unifiedResults = result.unifiedResults;
      contextWindow = result.contextWindow;
    }

    if (result && result.reviewPrecedents.length > 0) {
      reviewPrecedents = result.reviewPrecedents;
    }

    if (result && result.wikiKnowledge.length > 0) {
      wikiKnowledge = result.wikiKnowledge;
    }

    if (result && result.findings.length > 0) {
      if (params.telemetryEnabled) {
        try {
          const resultCount = result.findings.length;
          const avgDistance = resultCount > 0
            ? result.findings.reduce((sum, r) => sum + (r as any).adjustedDistance, 0) / resultCount
            : null;
          const languageMatchRatio = resultCount > 0
            ? result.findings.filter((r) => (r as any).languageMatch).length / resultCount
            : null;

          await params.telemetryStore.recordRetrievalQuality({
            deliveryId: params.deliveryId,
            repo: params.repo,
            prNumber: params.prNumber,
            eventType: params.eventName,
            topK: params.retrievalConfig.topK,
            distanceThreshold: result.provenance.thresholdValue,
            thresholdMethod: result.provenance.thresholdMethod,
            resultCount,
            avgDistance,
            languageMatchRatio,
          });
        } catch (err) {
          params.logger.warn(
            { ...params.baseLog, err },
            "Retrieval quality telemetry write failed (non-blocking)",
          );
        }
      }

      retrievalContext = {
        maxChars: params.retrievalConfig.maxContextChars,
        findings: result.findings.map((finding, index) => {
          const anchor = result.snippetAnchors[index];
          return {
            findingText: finding.record.findingText,
            severity: finding.record.severity,
            category: finding.record.category,
            path: anchor?.path ?? finding.record.filePath,
            line: anchor?.line,
            snippet: anchor?.snippet,
            outcome: finding.record.outcome,
            distance: (finding as any).adjustedDistance ?? finding.distance,
            sourceRepo: finding.sourceRepo,
          };
        }),
      };
    }
  } catch (err) {
    params.logger.warn(
      { ...params.baseLog, err },
      "Retrieval context generation failed (fail-open, proceeding without retrieval)",
    );
  }

  return {
    retrievalContext,
    visibleBudgetState,
    reviewPrecedents,
    wikiKnowledge,
    unifiedResults,
    contextWindow,
  };
}
