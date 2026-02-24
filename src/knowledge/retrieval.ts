import type { Logger } from "pino";
import type { EmbeddingProvider, RetrievalResult } from "./types.ts";
import type { IsolationLayer } from "./isolation.ts";
import type { MergedRetrievalResult, MultiQueryVariantType } from "./multi-query-retrieval.ts";
import type { SnippetAnchor } from "./retrieval-snippets.ts";
import { executeRetrievalVariants, mergeVariantResults } from "./multi-query-retrieval.ts";
import { rerankByLanguage } from "./retrieval-rerank.ts";
import { applyRecencyWeighting } from "./retrieval-recency.ts";
import { computeAdaptiveThreshold } from "./adaptive-threshold.ts";
import { buildSnippetAnchors, trimSnippetAnchorsToBudget } from "./retrieval-snippets.ts";

export type RetrieveOptions = {
  repo: string;
  owner: string;
  /** Raw text queries -- multi-query is first-class. Single query: pass ['query']. */
  queries: string[];
  /** Workspace dir for snippet anchoring. If omitted, skip snippet building. */
  workspaceDir?: string;
  /** PR languages for language-based reranking. Default: [] */
  prLanguages?: string[];
  /** Override topK from config. */
  topK?: number;
  /** Override distance threshold from config. */
  distanceThreshold?: number;
  /** Override adaptive threshold from config. */
  adaptive?: boolean;
  /** Override maxContextChars from config. */
  maxContextChars?: number;
  /** Logger instance for request-scoped logging. */
  logger: Logger;
};

export type RetrieveResult = {
  findings: MergedRetrievalResult[];
  snippetAnchors: SnippetAnchor[];
  provenance: {
    queryCount: number;
    candidateCount: number;
    sharedPoolUsed: boolean;
    thresholdMethod: string;
    thresholdValue: number;
  };
};

export type RetrieverConfig = {
  retrieval: {
    enabled: boolean;
    topK: number;
    distanceThreshold: number;
    adaptive: boolean;
    maxContextChars: number;
  };
  sharing: {
    enabled: boolean;
  };
};

const VARIANT_TYPE_SEQUENCE: MultiQueryVariantType[] = ["intent", "file-path", "code-shape"];

/**
 * Create a retriever with injected dependencies. Returns a retrieve() function
 * that encapsulates the entire retrieval pipeline: embedding, isolation, merging,
 * reranking, thresholding, and snippet anchoring.
 */
export function createRetriever(deps: {
  embeddingProvider: EmbeddingProvider;
  isolationLayer: IsolationLayer;
  config: RetrieverConfig;
}): { retrieve: (opts: RetrieveOptions) => Promise<RetrieveResult | null> } {
  const { embeddingProvider, isolationLayer, config } = deps;

  async function retrieve(opts: RetrieveOptions): Promise<RetrieveResult | null> {
    if (!config.retrieval.enabled) {
      return null;
    }

    if (!opts.queries || opts.queries.length === 0) {
      return null;
    }

    const logger = opts.logger;
    const topK = opts.topK ?? config.retrieval.topK;
    const distanceThreshold = opts.distanceThreshold ?? config.retrieval.distanceThreshold;
    const adaptive = opts.adaptive ?? config.retrieval.adaptive;
    const maxContextChars = opts.maxContextChars ?? config.retrieval.maxContextChars;
    const prLanguages = opts.prLanguages ?? [];

    try {
      // Step 1: Build variants from query strings
      // Each query string becomes a variant. Type assignment:
      // index 0 = "intent", 1 = "file-path", 2 = "code-shape", 3+ = "intent"
      const variants = opts.queries.map((query, index) => ({
        type: (VARIANT_TYPE_SEQUENCE[index] ?? "intent") as MultiQueryVariantType,
        query,
        priority: Math.min(index, 2),
      }));

      // Step 2: Execute retrieval variants
      const maxVariantConcurrency = 2;
      const variantTopK = Math.max(1, Math.ceil(topK / Math.max(variants.length, 1)));

      const resultsByVariant = await executeRetrievalVariants({
        variants,
        maxConcurrency: maxVariantConcurrency,
        execute: async (variant) => {
          const embedResult = await embeddingProvider.generate(variant.query, "query");
          if (!embedResult) {
            throw new Error(`Embedding unavailable for ${variant.type} retrieval variant`);
          }

          const retrieval = await isolationLayer.retrieveWithIsolation({
            queryEmbedding: embedResult.embedding,
            repo: opts.repo,
            owner: opts.owner,
            sharingEnabled: config.sharing.enabled,
            topK: variantTopK,
            distanceThreshold,
            adaptive,
            logger,
          });

          return retrieval.results;
        },
      });

      // Log variant failures
      const variantFailures = resultsByVariant.filter((v) => v.error);
      for (const failed of variantFailures) {
        logger.warn(
          { variant: failed.variant.type, err: failed.error },
          "Retrieval variant failed (fail-open)",
        );
      }

      // Step 3: Merge variant results
      const mergedResults = mergeVariantResults({
        resultsByVariant,
        topK,
      });

      // Step 4: Language reranking
      const languageReranked = mergedResults.length > 0
        ? rerankByLanguage({ results: mergedResults, prLanguages })
        : [];

      // Step 5: Recency weighting
      const reranked = languageReranked.length > 0
        ? applyRecencyWeighting({ results: languageReranked })
        : [];

      // Step 6: Adaptive threshold
      let thresholdMethod = "configured";
      let thresholdValue = distanceThreshold;
      let finalReranked = reranked.slice(0, topK);

      if (adaptive && reranked.length > 0) {
        const distances = reranked.map((r) => r.adjustedDistance);
        const adaptiveResult = computeAdaptiveThreshold({
          distances,
          configuredThreshold: distanceThreshold,
        });

        thresholdMethod = adaptiveResult.method;
        thresholdValue = adaptiveResult.threshold;

        const thresholdFiltered = reranked.filter(
          (r) => r.adjustedDistance <= adaptiveResult.threshold,
        );
        finalReranked = thresholdFiltered.slice(0, topK);

        logger.debug(
          {
            method: adaptiveResult.method,
            threshold: adaptiveResult.threshold,
            candidateCount: adaptiveResult.candidateCount,
            preFilterCount: reranked.length,
            postFilterCount: finalReranked.length,
          },
          "Adaptive threshold applied to retrieval results",
        );
      }

      // Step 7: Snippet anchoring (if workspace provided and results exist)
      let snippetAnchors: SnippetAnchor[] = [];
      if (opts.workspaceDir && finalReranked.length > 0) {
        snippetAnchors = await buildSnippetAnchors({
          workspaceDir: opts.workspaceDir,
          findings: finalReranked as RetrievalResult[],
        });

        snippetAnchors = trimSnippetAnchorsToBudget({
          anchors: snippetAnchors,
          maxChars: maxContextChars,
          maxItems: topK,
        });
      }

      // Compute provenance
      const totalCandidates = resultsByVariant.reduce((sum, v) => {
        return sum + (v.results?.length ?? 0);
      }, 0);

      const sharedPoolUsed = resultsByVariant.some((v) =>
        v.results?.some((r) => r.sourceRepo !== `${opts.repo}`),
      );

      return {
        findings: finalReranked,
        snippetAnchors,
        provenance: {
          queryCount: opts.queries.length,
          candidateCount: totalCandidates,
          sharedPoolUsed,
          thresholdMethod,
          thresholdValue,
        },
      };
    } catch (err) {
      logger.warn({ err }, "Retrieval pipeline failed (fail-open)");
      return null;
    }
  }

  return { retrieve };
}
