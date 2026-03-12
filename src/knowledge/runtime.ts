import type { Logger } from "pino";
import type { Sql } from "../db/client.ts";
import type { EmbeddingProvider, LearningMemoryStore } from "./types.ts";
import type { ReviewCommentStore } from "./review-comment-types.ts";
import type { WikiPageStore } from "./wiki-types.ts";
import type { CodeSnippetStore } from "./code-snippet-types.ts";
import type { IssueStore } from "./issue-types.ts";
import { createLearningMemoryStore } from "./memory-store.ts";
import { createEmbeddingProvider, createNoOpEmbeddingProvider, createContextualizedEmbeddingProvider } from "./embeddings.ts";
import { createReviewCommentStore } from "./review-comment-store.ts";
import { createWikiPageStore } from "./wiki-store.ts";
import { createCodeSnippetStore } from "./code-snippet-store.ts";
import { createIssueStore } from "./issue-store.ts";
import { createIsolationLayer, type IsolationLayer } from "./isolation.ts";
import { createRetriever, type RetrieverConfig } from "./retrieval.ts";
import { createWikiPopularityStore } from "./wiki-popularity-store.ts";

export const DEFAULT_EMBEDDING_MODEL = "voyage-code-3";
export const DEFAULT_WIKI_EMBEDDING_MODEL = "voyage-context-3";
export const DEFAULT_EMBEDDING_DIMENSIONS = 1024;

export const DEFAULT_RETRIEVER_CONFIG: RetrieverConfig = {
  retrieval: {
    enabled: true,
    topK: 5,
    distanceThreshold: 0.3,
    adaptive: true,
    maxContextChars: 2000,
  },
  sharing: {
    enabled: false,
  },
};

export type KnowledgeRuntime = {
  learningMemoryStore: LearningMemoryStore | undefined;
  embeddingProvider: EmbeddingProvider;
  wikiEmbeddingProvider: EmbeddingProvider;
  reviewCommentStore: ReviewCommentStore;
  wikiPageStore: WikiPageStore;
  codeSnippetStore: CodeSnippetStore;
  issueStore: IssueStore;
  isolationLayer: IsolationLayer | undefined;
  retriever: ReturnType<typeof createRetriever> | undefined;
  wikiCitationLogger: ReturnType<typeof createWikiPopularityStore>;
};

export function createKnowledgeRuntime(opts: {
  sql: Sql;
  logger: Logger;
  voyageApiKey?: string | null;
  retrieverConfig?: RetrieverConfig;
}): KnowledgeRuntime {
  const { sql, logger } = opts;
  const voyageApiKey = opts.voyageApiKey?.trim() ?? process.env.VOYAGE_API_KEY?.trim() ?? "";

  let learningMemoryStore: LearningMemoryStore | undefined;
  try {
    learningMemoryStore = createLearningMemoryStore({ sql, logger });
    logger.info("Learning memory store initialized (PostgreSQL + pgvector)");
  } catch (err) {
    logger.warn({ err }, "Learning memory store failed to initialize (fail-open, learning disabled)");
  }

  const embeddingProvider = voyageApiKey && learningMemoryStore
    ? createEmbeddingProvider({
        apiKey: voyageApiKey,
        model: DEFAULT_EMBEDDING_MODEL,
        dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
        logger,
      })
    : createNoOpEmbeddingProvider(logger);

  if (voyageApiKey && learningMemoryStore) {
    logger.info(
      { model: DEFAULT_EMBEDDING_MODEL, dimensions: DEFAULT_EMBEDDING_DIMENSIONS },
      "Embedding provider initialized",
    );
  } else if (!voyageApiKey) {
    logger.info("VOYAGE_API_KEY not set, embedding generation disabled (no-op provider)");
  }

  const wikiEmbeddingProvider: EmbeddingProvider = voyageApiKey
    ? createContextualizedEmbeddingProvider({
        apiKey: voyageApiKey,
        model: DEFAULT_WIKI_EMBEDDING_MODEL,
        dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
        logger,
      })
    : embeddingProvider;

  if (voyageApiKey) {
    logger.info(
      { model: DEFAULT_WIKI_EMBEDDING_MODEL, dimensions: DEFAULT_EMBEDDING_DIMENSIONS },
      "Wiki embedding provider initialized (contextualized)",
    );
  }

  const reviewCommentStore = createReviewCommentStore({ sql, logger });
  logger.info("Review comment store initialized (PostgreSQL + pgvector)");

  const wikiPageStore = createWikiPageStore({
    sql,
    logger,
    embeddingModel: DEFAULT_WIKI_EMBEDDING_MODEL,
  });
  logger.info("Wiki page store initialized (PostgreSQL + pgvector)");

  const codeSnippetStore = createCodeSnippetStore({ sql, logger });
  logger.info("Code snippet store initialized (PostgreSQL + pgvector)");

  const issueStore = createIssueStore({ sql, logger });
  logger.info("Issue store initialized (PostgreSQL + pgvector)");

  let isolationLayer: IsolationLayer | undefined;
  if (learningMemoryStore) {
    isolationLayer = createIsolationLayer({ memoryStore: learningMemoryStore, logger });
    logger.info("Learning memory isolation layer initialized");
  }

  const wikiCitationLogger = createWikiPopularityStore({ sql, logger });

  const retriever = isolationLayer
    ? createRetriever({
        embeddingProvider,
        wikiEmbeddingProvider,
        isolationLayer,
        config: opts.retrieverConfig ?? DEFAULT_RETRIEVER_CONFIG,
        reviewCommentStore,
        wikiPageStore,
        memoryStore: learningMemoryStore,
        codeSnippetStore,
        issueStore,
        wikiCitationLogger,
      })
    : undefined;

  return {
    learningMemoryStore,
    embeddingProvider,
    wikiEmbeddingProvider,
    reviewCommentStore,
    wikiPageStore,
    codeSnippetStore,
    issueStore,
    isolationLayer,
    retriever,
    wikiCitationLogger,
  };
}

export function startEmbeddingSmokeTest(opts: {
  embeddingProvider: EmbeddingProvider;
  logger: Logger;
}): void {
  const { embeddingProvider, logger } = opts;

  void Promise.resolve()
    .then(async () => {
      if (embeddingProvider.model === "none") {
        return;
      }

      const start = Date.now();
      try {
        const result = await embeddingProvider.generate("kodiai smoke test", "query");
        const latencyMs = Date.now() - start;
        if (result !== null) {
          logger.info(
            {
              model: embeddingProvider.model,
              dimensions: embeddingProvider.dimensions,
              latencyMs,
            },
            "Embeddings smoke test passed",
          );
        } else {
          logger.warn(
            { model: embeddingProvider.model },
            "Embeddings smoke test failed -- VoyageAI returned null (embeddings degraded)",
          );
        }
      } catch (err) {
        logger.warn(
          { err, model: embeddingProvider.model },
          "Embeddings smoke test failed -- error connecting to VoyageAI (embeddings degraded)",
        );
      }
    })
    .catch((err) => {
      logger.warn({ err }, "Embeddings smoke test unexpected error (non-fatal)");
    });
}
