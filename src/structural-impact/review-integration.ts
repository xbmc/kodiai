import type { Logger } from "pino";
import type { EmbeddingProvider } from "../knowledge/types.ts";
import { searchCanonicalCode } from "../knowledge/canonical-code-retrieval.ts";
import type { CanonicalCodeStore } from "../knowledge/canonical-code-types.ts";
import type { ReviewGraphBlastRadiusResult } from "../review-graph/query.ts";
import type { GraphAdapter, GraphQueryInput, CorpusAdapter, CorpusQueryInput } from "./adapters.ts";
import {
  fetchStructuralImpact,
  type StructuralImpactSignal,
} from "./orchestrator.ts";
import {
  buildStructuralImpactCacheKey,
  type StructuralImpactCache,
} from "./cache.ts";
import { summarizeStructuralImpactDegradation } from "./degradation.ts";
import type { StructuralImpactPayload } from "./types.ts";

export type ReviewGraphQueryFn = (input: {
  repo: string;
  workspaceKey: string;
  changedPaths: string[];
  limit?: number;
}) => Promise<ReviewGraphBlastRadiusResult>;

export type ReviewStructuralImpactDeps = {
  reviewGraphQuery?: ReviewGraphQueryFn;
  canonicalCodeStore?: Pick<CanonicalCodeStore, "searchByEmbedding">;
  embeddingProvider?: Pick<EmbeddingProvider, "generate">;
  cache?: StructuralImpactCache;
  logger: Logger;
};

export type ReviewStructuralImpactRequest = {
  repo: string;
  owner: string;
  workspaceKey: string;
  baseSha: string;
  headSha: string;
  changedPaths: string[];
  canonicalRef: string;
  query: string;
  language?: string;
  graphLimit?: number;
  corpusTopK?: number;
  timeoutMs?: number;
  onSignal?: (signal: StructuralImpactSignal) => void;
};

export type ReviewStructuralImpactResult = {
  payload: StructuralImpactPayload;
  graphBlastRadius: ReviewGraphBlastRadiusResult | null;
};

function emit(
  onSignal: ((signal: StructuralImpactSignal) => void) | undefined,
  signal: StructuralImpactSignal,
): void {
  if (!onSignal) return;
  try {
    onSignal(signal);
  } catch {
    // Observability must never affect review execution.
  }
}

export function createReviewGraphAdapter(reviewGraphQuery: ReviewGraphQueryFn): GraphAdapter {
  return {
    async queryBlastRadius(input: GraphQueryInput) {
      return await reviewGraphQuery({
        repo: input.repo,
        workspaceKey: input.workspaceKey,
        changedPaths: input.changedPaths,
        limit: input.limit,
      });
    },
  };
}

export function createCanonicalCorpusAdapter(params: {
  canonicalCodeStore: Pick<CanonicalCodeStore, "searchByEmbedding">;
  embeddingProvider: Pick<EmbeddingProvider, "generate">;
  logger: Logger;
}): CorpusAdapter {
  const { canonicalCodeStore, embeddingProvider, logger } = params;

  return {
    async searchCanonicalCode(input: CorpusQueryInput) {
      const result = await searchCanonicalCode({
        store: canonicalCodeStore,
        embeddingProvider,
        query: input.query,
        repo: input.repo,
        canonicalRef: input.canonicalRef,
        topK: input.topK ?? 10,
        language: input.language,
        logger,
      });

      return result.map((match) => ({
        filePath: match.filePath,
        language: match.language,
        startLine: match.startLine,
        endLine: match.endLine,
        chunkType: match.chunkType,
        symbolName: match.symbolName,
        chunkText: match.chunkText,
        distance: match.distance,
        commitSha: match.commitSha,
        canonicalRef: match.canonicalRef,
      }));
    },
  };
}

export async function fetchReviewStructuralImpact(
  deps: ReviewStructuralImpactDeps,
  request: ReviewStructuralImpactRequest,
): Promise<ReviewStructuralImpactResult> {
  const { reviewGraphQuery, canonicalCodeStore, embeddingProvider, cache, logger } = deps;
  const graphAdapter: GraphAdapter = reviewGraphQuery
    ? createReviewGraphAdapter(reviewGraphQuery)
    : {
        queryBlastRadius: async () => {
          throw new Error("graph adapter unavailable");
        },
      };

  const corpusAdapter: CorpusAdapter = canonicalCodeStore && embeddingProvider
    ? createCanonicalCorpusAdapter({ canonicalCodeStore, embeddingProvider, logger })
    : {
        searchCanonicalCode: async () => {
          throw new Error("corpus adapter unavailable");
        },
      };

  let graphBlastRadius: ReviewGraphBlastRadiusResult | null = null;
  const graphAdapterWithCapture: GraphAdapter = {
    async queryBlastRadius(input) {
      const graph = await graphAdapter.queryBlastRadius(input);
      graphBlastRadius = graph as ReviewGraphBlastRadiusResult;
      return graph;
    },
  };

  const hasGraph = Boolean(reviewGraphQuery);
  const hasCorpus = Boolean(canonicalCodeStore && embeddingProvider);

  if (!hasGraph) {
    emit(request.onSignal, { kind: "graph-error", detail: "graph adapter unavailable" });
  }
  if (!hasCorpus) {
    emit(request.onSignal, { kind: "corpus-error", detail: "corpus adapter unavailable" });
  }

  const payload = await fetchStructuralImpact({
    graphAdapter: graphAdapterWithCapture,
    corpusAdapter,
    graphInput: {
      repo: request.repo,
      workspaceKey: request.workspaceKey,
      changedPaths: request.changedPaths,
      limit: request.graphLimit,
    },
    corpusInput: {
      repo: request.repo,
      canonicalRef: request.canonicalRef,
      query: request.query,
      topK: request.corpusTopK,
      language: request.language,
    },
    timeoutMs: request.timeoutMs,
    cache,
    cacheKey: cache
      ? buildStructuralImpactCacheKey({
          repo: request.repo,
          baseSha: request.baseSha,
          headSha: request.headSha,
        })
      : undefined,
    onSignal: request.onSignal,
  });

  const degradationSummary = summarizeStructuralImpactDegradation(payload);
  const normalizedPayload: StructuralImpactPayload = {
    ...payload,
    status: degradationSummary.status,
    degradations: degradationSummary.degradations,
  };

  return {
    payload: normalizedPayload,
    graphBlastRadius,
  };
}
