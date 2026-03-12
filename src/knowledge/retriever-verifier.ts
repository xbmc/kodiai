import pino from "pino";
import type { Logger } from "pino";
import type { EmbeddingProvider } from "./types.ts";

export const AUDITED_CORPORA: string[] = [
  "learning_memories",
  "review_comments",
  "wiki_pages",
  "code_snippets",
  "issues",
  "issue_comments",
];

export const RETRIEVER_PARTICIPATING_CORPORA: string[] = [
  "learning_memories",
  "review_comments",
  "wiki_pages",
  "code_snippets",
  "issues",
];

export type RetrieverVerifierReport = {
  repo: string;
  query: string;
  audited_corpora: string[];
  participating_corpora: string[];
  not_in_retriever: string[];
  query_embedding: {
    status: "generated" | "unavailable";
    model: string | null;
    dimensions: number | null;
  };
  result_counts: {
    unified_results: number;
    by_source: Record<string, number>;
  };
  status_code: "retrieval_hits" | "retrieval_no_hits" | "query_embedding_unavailable" | "retrieval_unavailable";
  success: boolean;
  hits: Array<{
    id: string;
    source: string;
    source_label: string;
    text_excerpt: string;
    vector_distance: number;
    rrf_score: number;
  }>;
};

type RetrievedUnifiedResult = {
  id: string;
  source: string;
  sourceLabel: string;
  text: string;
  vectorDistance: number;
  rrfScore: number;
};

function summarizeCounts(results: RetrievedUnifiedResult[]): Record<string, number> {
  const bySource: Record<string, number> = {};
  for (const result of results) {
    bySource[result.source] = (bySource[result.source] ?? 0) + 1;
  }
  return bySource;
}

function buildHit(result: RetrievedUnifiedResult): RetrieverVerifierReport["hits"][number] {
  return {
    id: result.id,
    source: result.source,
    source_label: result.sourceLabel,
    text_excerpt: result.text.slice(0, 280),
    vector_distance: result.vectorDistance,
    rrf_score: result.rrfScore,
  };
}

export async function verifyRetriever(input: {
  repo: string;
  owner: string;
  query: string;
  queryEmbeddingProvider: Pick<EmbeddingProvider, "generate">;
  retriever: {
    retrieve: (input: {
      repo: string;
      owner: string;
      queries: string[];
      logger?: unknown;
    }) => Promise<{
      unifiedResults: RetrievedUnifiedResult[];
    } | null>;
  };
  logger?: Logger;
}): Promise<RetrieverVerifierReport> {
  const logger = input.logger ?? pino({ level: "silent" });
  const notInRetriever = AUDITED_CORPORA.filter((corpus) => !RETRIEVER_PARTICIPATING_CORPORA.includes(corpus));

  const queryEmbedding = await input.queryEmbeddingProvider.generate(input.query, "query");
  if (!queryEmbedding) {
    return {
      repo: input.repo,
      query: input.query,
      audited_corpora: [...AUDITED_CORPORA],
      participating_corpora: [...RETRIEVER_PARTICIPATING_CORPORA],
      not_in_retriever: notInRetriever,
      query_embedding: {
        status: "unavailable",
        model: null,
        dimensions: null,
      },
      result_counts: {
        unified_results: 0,
        by_source: {},
      },
      status_code: "query_embedding_unavailable",
      success: false,
      hits: [],
    };
  }

  const retrieval = await input.retriever.retrieve({
    repo: input.repo,
    owner: input.owner,
    queries: [input.query],
    logger,
  });

  const unifiedResults = retrieval?.unifiedResults ?? [];
  const bySource = summarizeCounts(unifiedResults);
  const statusCode = retrieval === null
    ? "retrieval_unavailable"
    : unifiedResults.length > 0
      ? "retrieval_hits"
      : "retrieval_no_hits";

  return {
    repo: input.repo,
    query: input.query,
    audited_corpora: [...AUDITED_CORPORA],
    participating_corpora: [...RETRIEVER_PARTICIPATING_CORPORA],
    not_in_retriever: notInRetriever,
    query_embedding: {
      status: "generated",
      model: queryEmbedding.model,
      dimensions: queryEmbedding.dimensions,
    },
    result_counts: {
      unified_results: unifiedResults.length,
      by_source: bySource,
    },
    status_code: statusCode,
    success: statusCode === "retrieval_hits",
    hits: unifiedResults.map(buildHit),
  };
}

export function renderRetrieverVerificationReport(report: RetrieverVerifierReport): string {
  const bySource = Object.keys(report.result_counts.by_source).length > 0
    ? Object.entries(report.result_counts.by_source)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([source, count]) => `${source}:${count}`)
        .join(",")
    : "none";

  const lines = [
    `repo: ${report.repo}`,
    `query: ${report.query}`,
    `query_embedding: ${report.query_embedding.status}`,
    `query_embedding_model: ${report.query_embedding.model ?? "none"}`,
    `query_embedding_dimensions: ${report.query_embedding.dimensions ?? "none"}`,
    `audited_corpora=${report.audited_corpora.join(",")}`,
    `participating_corpora=${report.participating_corpora.join(",")}`,
    `not_in_retriever=${report.not_in_retriever.join(",") || "none"}`,
    `unified_results=${report.result_counts.unified_results}`,
    `by_source=${bySource}`,
    `success=${report.success}`,
    `status_code=${report.status_code}`,
  ];

  if (report.hits.length > 0) {
    lines.push("hits:");
    for (const hit of report.hits) {
      lines.push(
        `  - ${hit.source} ${hit.id} score=${hit.rrf_score} distance=${hit.vector_distance} label=${hit.source_label} excerpt=${hit.text_excerpt}`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
}
