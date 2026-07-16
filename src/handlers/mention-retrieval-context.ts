import type { Logger } from "pino";
import type { TelemetryStore } from "../telemetry/types.ts";
import type { createRetriever } from "../knowledge/retrieval.ts";
import type { UnifiedRetrievalChunk } from "../knowledge/cross-corpus-rrf.ts";
import type { ReviewCommentMatch } from "../knowledge/review-comment-retrieval.ts";
import type { WikiKnowledgeMatch } from "../knowledge/wiki-retrieval.ts";
import { buildRetrievalVariants } from "../knowledge/multi-query-retrieval.ts";
import { classifyFileLanguage } from "../execution/diff-analysis.ts";
import { splitGitLines } from "../lib/review-git-utils.ts";
import { buildMentionRetrievalBody } from "./mention-request-classification.ts";
import { collectMentionDiffFilePaths } from "./mention-workspace.ts";

export type MentionRetrievalContext = {
  maxChars?: number;
  maxItems?: number;
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
};

export type MentionRetrievalPromptContext = {
  retrievalContext?: MentionRetrievalContext;
  unifiedResultsForPrompt: UnifiedRetrievalChunk[];
  contextWindowForPrompt?: string;
  reviewPrecedentsForPrompt: ReviewCommentMatch[];
  wikiKnowledgeForPrompt: WikiKnowledgeMatch[];
};

const MENTION_RETRIEVAL_MAX_CONTEXT_CHARS = 1200;

function emptyMentionRetrievalPromptContext(): MentionRetrievalPromptContext {
  return {
    retrievalContext: undefined,
    unifiedResultsForPrompt: [],
    contextWindowForPrompt: undefined,
    reviewPrecedentsForPrompt: [],
    wikiKnowledgeForPrompt: [],
  };
}

function normalizePathForScope(path: string): string {
  return path.trim().replace(/^\.\/+/, "");
}

function getChunkFilePath(chunk: UnifiedRetrievalChunk): string | undefined {
  const filePath = chunk.metadata?.filePath;
  return typeof filePath === "string" && filePath.trim().length > 0
    ? normalizePathForScope(filePath)
    : undefined;
}

function getChunkPrNumber(chunk: UnifiedRetrievalChunk): number | undefined {
  const prNumber = chunk.metadata?.prNumber;
  return typeof prNumber === "number" && Number.isInteger(prNumber) && prNumber > 0
    ? prNumber
    : undefined;
}

function isFileScopedChunk(chunk: UnifiedRetrievalChunk): boolean {
  return ["code", "canonical_code", "review_comment", "snippet"].includes(chunk.source);
}

function isChunkAllowedByCurrentPrScope(params: {
  chunk: UnifiedRetrievalChunk;
  prNumber: number | undefined;
  changedPathSet: ReadonlySet<string>;
  enforceScope: boolean;
}): boolean {
  if (!params.enforceScope || !isFileScopedChunk(params.chunk)) {
    return true;
  }

  const chunkPrNumber = getChunkPrNumber(params.chunk);
  if (chunkPrNumber !== undefined && chunkPrNumber === params.prNumber) {
    return true;
  }

  const filePath = getChunkFilePath(params.chunk);
  if (!filePath) {
    return false;
  }

  return params.changedPathSet.has(filePath);
}

function buildMentionContextWindow(chunks: readonly UnifiedRetrievalChunk[], maxChars: number): string | undefined {
  const parts: string[] = [];
  let totalChars = 0;

  for (const chunk of chunks) {
    const entry = `${chunk.sourceLabel}: ${chunk.text}`;
    if (totalChars + entry.length > maxChars) {
      break;
    }
    parts.push(entry);
    totalChars += entry.length;
  }

  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

function normalizePrLanguage(language: string): string {
  return language.toLowerCase()
    .replace("c++", "cpp")
    .replace("c#", "csharp")
    .replace("objective-c++", "objectivecpp")
    .replace("objective-c", "objectivec")
    .replace("f#", "fsharp");
}

export async function buildMentionRetrievalContextForPrompt(params: {
  retriever?: ReturnType<typeof createRetriever>;
  retrievalEnabled: boolean;
  topK?: number;
  telemetryEnabled: boolean;
  telemetryStore: Pick<TelemetryStore, "recordRateLimitEvent"> | Record<string, never>;
  deliveryId: string;
  owner: string;
  repo: string;
  surface: string;
  issueNumber: number;
  prNumber?: number;
  baseRef?: string;
  workspaceDir: string;
  writeRequest: string;
  mentionContext: string;
  allowHeavyContext: boolean;
  allowDiffContext: boolean;
  explicitReviewRequest: boolean;
  inReplyToId?: number;
  includeIssueCorpus: boolean;
  logger: Pick<Logger, "warn">;
  collectDiffFilePaths?: typeof collectMentionDiffFilePaths;
}): Promise<MentionRetrievalPromptContext> {
  if (!params.retriever || !params.retrievalEnabled) {
    return emptyMentionRetrievalPromptContext();
  }

  try {
    const retrievalBody = buildMentionRetrievalBody({
      userQuestion: params.writeRequest,
      mentionContext: params.mentionContext,
      allowHeavyContext: params.allowHeavyContext,
      allowDiffContext: params.allowDiffContext,
      explicitReviewRequest: params.explicitReviewRequest,
    });

    let filePaths: string[] = [];
    let shouldEnforceCurrentPrScope = false;
    if (
      (params.explicitReviewRequest || params.allowDiffContext) &&
      params.prNumber !== undefined &&
      params.baseRef
    ) {
      shouldEnforceCurrentPrScope = true;
      const collectDiffFilePaths = params.collectDiffFilePaths ?? collectMentionDiffFilePaths;
      const diffResult = await collectDiffFilePaths({
        workspaceDir: params.workspaceDir,
        baseRef: params.baseRef,
      });
      if (diffResult.exitCode === 0) {
        filePaths = splitGitLines(diffResult.stdout).map(normalizePathForScope);
      } else {
        params.logger.warn(
          {
            surface: params.surface,
            owner: params.owner,
            repo: params.repo,
            prNumber: params.prNumber,
            baseRef: params.baseRef,
            exitCode: diffResult.exitCode,
          },
          "Failed to collect mention retrieval file paths (fail-open)",
        );
      }
    }

    const prLanguages = Array.from(
      new Set(
        filePaths
          .map((filePath) => classifyFileLanguage(filePath))
          .filter((language) => language !== "Unknown")
          .map((language) => normalizePrLanguage(language)),
      ),
    );
    const retrievalTopK = Math.max(1, Math.min(params.topK ?? 5, 3));
    const variants = buildRetrievalVariants({
      title: params.writeRequest,
      body: retrievalBody,
      conventionalType: null,
      prLanguages,
      riskSignals: [params.surface, params.inReplyToId !== undefined ? "reply-thread" : "single-mention"],
      filePaths,
    });

    const result = await params.retriever.retrieve({
      repo: `${params.owner}/${params.repo}`,
      owner: params.owner,
      queries: variants.map((variant) => variant.query),
      workspaceDir: params.workspaceDir,
      prLanguages,
      topK: retrievalTopK,
      logger: params.logger as Logger,
      triggerType: "question",
      includeIssues: params.includeIssueCorpus,
    });

    if (params.telemetryEnabled && "recordRateLimitEvent" in params.telemetryStore) {
      try {
        const totalEmbeddingLookups =
          (result?.provenance.embeddingRequests ?? 0) +
          (result?.provenance.embeddingCacheHits ?? 0);
        await params.telemetryStore.recordRateLimitEvent({
          deliveryId: params.deliveryId,
          executionIdentity: `${params.deliveryId}:reuse.retrieval-query-embedding.mention`,
          repo: `${params.owner}/${params.repo}`,
          prNumber: params.prNumber,
          eventType: "reuse.retrieval-query-embedding.mention",
          cacheHitRate: totalEmbeddingLookups > 0
            ? (result?.provenance.embeddingCacheHits ?? 0) / totalEmbeddingLookups
            : 0,
          skippedQueries: result?.provenance.embeddingCacheHits ?? 0,
          retryAttempts: result?.provenance.embeddingRequests ?? 0,
          degradationPath: result == null
            ? "degraded"
            : (result.provenance.embeddingCacheHits > 0 ? "hit" : "miss"),
        });
      } catch (err) {
        params.logger.warn(
          { err, surface: params.surface, issueNumber: params.issueNumber },
          "Mention retrieval reuse telemetry write failed (non-blocking)",
        );
      }
    }

    const promptContext = emptyMentionRetrievalPromptContext();
    if (!result) {
      return promptContext;
    }

    const changedPathSet = new Set(filePaths);
    const unifiedResultsForPrompt = result.unifiedResults.filter((chunk) =>
      isChunkAllowedByCurrentPrScope({
        chunk,
        prNumber: params.prNumber,
        changedPathSet,
        enforceScope: shouldEnforceCurrentPrScope,
      })
    );

    if (unifiedResultsForPrompt.length > 0) {
      promptContext.unifiedResultsForPrompt = unifiedResultsForPrompt;
      promptContext.contextWindowForPrompt = unifiedResultsForPrompt.length === result.unifiedResults.length
        ? result.contextWindow
        : buildMentionContextWindow(unifiedResultsForPrompt, MENTION_RETRIEVAL_MAX_CONTEXT_CHARS);
    }
    if (result.reviewPrecedents.length > 0) {
      promptContext.reviewPrecedentsForPrompt = result.reviewPrecedents;
    }
    if (result.wikiKnowledge.length > 0) {
      promptContext.wikiKnowledgeForPrompt = result.wikiKnowledge;
    }
    const scopedFindings = result.findings
      .map((finding, index) => ({ finding, anchor: result.snippetAnchors[index] }))
      .filter(({ finding, anchor }) => {
        if (!shouldEnforceCurrentPrScope) {
          return true;
        }
        const anchorPath = anchor?.path ? normalizePathForScope(anchor.path) : undefined;
        const recordPath = normalizePathForScope(finding.record.filePath);
        return changedPathSet.has(anchorPath ?? recordPath);
      });

    if (scopedFindings.length > 0) {
      promptContext.retrievalContext = {
        maxChars: MENTION_RETRIEVAL_MAX_CONTEXT_CHARS,
        maxItems: retrievalTopK,
        findings: scopedFindings.slice(0, retrievalTopK).map(({ finding, anchor }) => {
          return {
            findingText: finding.record.findingText,
            severity: finding.record.severity,
            category: finding.record.category,
            path: anchor?.path ?? finding.record.filePath,
            line: anchor?.line,
            snippet: anchor?.snippet,
            outcome: finding.record.outcome,
            distance: finding.distance,
            sourceRepo: finding.sourceRepo,
          };
        }),
      };
    }

    return promptContext;
  } catch (err) {
    params.logger.warn(
      {
        err,
        surface: params.surface,
        owner: params.owner,
        repo: params.repo,
        issueNumber: params.issueNumber,
        prNumber: params.prNumber,
      },
      "Mention retrieval context generation failed (fail-open)",
    );
    return emptyMentionRetrievalPromptContext();
  }
}
