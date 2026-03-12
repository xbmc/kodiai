import { describe, expect, test } from "bun:test";

type RetrieverVerificationModule = {
  AUDITED_CORPORA: string[];
  RETRIEVER_PARTICIPATING_CORPORA: string[];
  verifyRetriever: (input: {
    repo: string;
    owner: string;
    query: string;
    queryEmbeddingProvider: {
      generate: (query: string, purpose: string) => Promise<
        | {
            embedding: Float32Array;
            model: string;
            dimensions: number;
          }
        | null
      >;
    };
    retriever: {
      retrieve: (input: {
        repo: string;
        owner: string;
        queries: string[];
        logger?: unknown;
      }) => Promise<
        | {
            unifiedResults: Array<{
              id: string;
              source: string;
              sourceLabel: string;
              text: string;
              vectorDistance: number;
              rrfScore: number;
            }>;
          }
        | null
      >;
    };
    logger?: unknown;
  }) => Promise<{
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
    status_code: string;
    success: boolean;
    hits: Array<{
      id: string;
      source: string;
      source_label: string;
      text_excerpt: string;
      vector_distance: number;
      rrf_score: number;
    }>;
  }>;
  renderRetrieverVerificationReport: (report: {
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
    status_code: string;
    success: boolean;
    hits: Array<{
      id: string;
      source: string;
      source_label: string;
      text_excerpt: string;
      vector_distance: number;
      rrf_score: number;
    }>;
  }) => string;
};

async function loadRetrieverVerificationModule(): Promise<RetrieverVerificationModule> {
  try {
    return await import("./retriever-verifier.ts") as RetrieverVerificationModule;
  } catch (error) {
    throw new Error(
      "Missing S01 implementation: expected src/knowledge/retriever-verifier.ts to export AUDITED_CORPORA, RETRIEVER_PARTICIPATING_CORPORA, verifyRetriever(), and renderRetrieverVerificationReport().",
      { cause: error },
    );
  }
}

describe("retriever verifier contract for src/knowledge/retriever-verifier.ts", () => {
  test("locks generated query embeddings, attributed unifiedResults hits, and issue_comments:not_in_retriever reporting", async () => {
    const module = await loadRetrieverVerificationModule();

    expect(module.AUDITED_CORPORA).toEqual([
      "learning_memories",
      "review_comments",
      "wiki_pages",
      "code_snippets",
      "issues",
      "issue_comments",
    ]);
    expect(module.RETRIEVER_PARTICIPATING_CORPORA).toEqual([
      "learning_memories",
      "review_comments",
      "wiki_pages",
      "code_snippets",
      "issues",
    ]);

    const report = await module.verifyRetriever({
      repo: "xbmc/xbmc",
      owner: "xbmc",
      query: "json-rpc subtitle delay",
      queryEmbeddingProvider: {
        generate: async () => ({
          embedding: new Float32Array([0.1, 0.2]),
          model: "voyage-code-3",
          dimensions: 2,
        }),
      },
      retriever: {
        retrieve: async () => ({
          unifiedResults: [
            {
              id: "code:1",
              source: "code",
              sourceLabel: "[code] src/interfaces/json-rpc.cpp",
              text: "Delay handling lives in the JSON-RPC subtitle pipeline.",
              vectorDistance: 0.12,
              rrfScore: 0.91,
            },
            {
              id: "wiki:99",
              source: "wiki",
              sourceLabel: "[wiki: Subtitle Sync]",
              text: "Subtitle delay can be configured from the player settings screen.",
              vectorDistance: 0.18,
              rrfScore: 0.72,
            },
          ],
        }),
      },
    });

    expect(report).toEqual({
      repo: "xbmc/xbmc",
      query: "json-rpc subtitle delay",
      audited_corpora: [
        "learning_memories",
        "review_comments",
        "wiki_pages",
        "code_snippets",
        "issues",
        "issue_comments",
      ],
      participating_corpora: [
        "learning_memories",
        "review_comments",
        "wiki_pages",
        "code_snippets",
        "issues",
      ],
      not_in_retriever: ["issue_comments"],
      query_embedding: {
        status: "generated",
        model: "voyage-code-3",
        dimensions: 2,
      },
      result_counts: {
        unified_results: 2,
        by_source: {
          code: 1,
          wiki: 1,
        },
      },
      status_code: "retrieval_hits",
      success: true,
      hits: [
        {
          id: "code:1",
          source: "code",
          source_label: "[code] src/interfaces/json-rpc.cpp",
          text_excerpt: "Delay handling lives in the JSON-RPC subtitle pipeline.",
          vector_distance: 0.12,
          rrf_score: 0.91,
        },
        {
          id: "wiki:99",
          source: "wiki",
          source_label: "[wiki: Subtitle Sync]",
          text_excerpt: "Subtitle delay can be configured from the player settings screen.",
          vector_distance: 0.18,
          rrf_score: 0.72,
        },
      ],
    });
  });

  test("distinguishes query_embedding_unavailable from no_hits so degraded provider mode is inspectable", async () => {
    const module = await loadRetrieverVerificationModule();

    const unavailable = await module.verifyRetriever({
      repo: "xbmc/xbmc",
      owner: "xbmc",
      query: "json-rpc subtitle delay",
      queryEmbeddingProvider: {
        generate: async () => null,
      },
      retriever: {
        retrieve: async () => {
          throw new Error("retrieve() must not run when the query embedding is unavailable");
        },
      },
    });

    expect(unavailable.query_embedding).toEqual({
      status: "unavailable",
      model: null,
      dimensions: null,
    });
    expect(unavailable.result_counts).toEqual({
      unified_results: 0,
      by_source: {},
    });
    expect(unavailable.status_code).toBe("query_embedding_unavailable");
    expect(unavailable.success).toBe(false);
    expect(unavailable.not_in_retriever).toEqual(["issue_comments"]);

    const noHits = await module.verifyRetriever({
      repo: "xbmc/xbmc",
      owner: "xbmc",
      query: "json-rpc subtitle delay",
      queryEmbeddingProvider: {
        generate: async () => ({
          embedding: new Float32Array([0.1, 0.2]),
          model: "voyage-code-3",
          dimensions: 2,
        }),
      },
      retriever: {
        retrieve: async () => ({ unifiedResults: [] }),
      },
    });

    expect(noHits.query_embedding).toEqual({
      status: "generated",
      model: "voyage-code-3",
      dimensions: 2,
    });
    expect(noHits.result_counts).toEqual({
      unified_results: 0,
      by_source: {},
    });
    expect(noHits.status_code).toBe("retrieval_no_hits");
    expect(noHits.success).toBe(false);
  });

  test("human renderer exposes participating_corpora, not_in_retriever, query_embedding state, and source counts from bun run verify:retriever --repo xbmc/xbmc --query 'json-rpc subtitle delay' --json", async () => {
    const module = await loadRetrieverVerificationModule();

    const rendered = module.renderRetrieverVerificationReport({
      repo: "xbmc/xbmc",
      query: "json-rpc subtitle delay",
      audited_corpora: [
        "learning_memories",
        "review_comments",
        "wiki_pages",
        "code_snippets",
        "issues",
        "issue_comments",
      ],
      participating_corpora: [
        "learning_memories",
        "review_comments",
        "wiki_pages",
        "code_snippets",
        "issues",
      ],
      not_in_retriever: ["issue_comments"],
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
    });

    expect(rendered).toContain("repo: xbmc/xbmc");
    expect(rendered).toContain("query_embedding: unavailable");
    expect(rendered).toContain("participating_corpora=learning_memories,review_comments,wiki_pages,code_snippets,issues");
    expect(rendered).toContain("not_in_retriever=issue_comments");
    expect(rendered).toContain("status_code=query_embedding_unavailable");
  });
});
