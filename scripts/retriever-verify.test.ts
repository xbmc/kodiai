import { describe, expect, test } from "bun:test";

type RetrieverVerifyScriptModule = {
  parseRetrieverVerifyCliArgs: (args: string[]) => {
    help?: boolean;
    json?: boolean;
    repo?: string;
    query?: string;
  };
  runRetrieverVerifyCli: (deps?: {
    verifyRetriever?: () => Promise<{
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
      hits: unknown[];
    }>;
  }) => Promise<{
    report: {
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
      hits: unknown[];
    };
    human: string;
    json: string;
  }>;
  main: (args: string[], deps?: {
    verifyRetriever?: () => Promise<{
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
      hits: unknown[];
    }>;
    stdout?: { write: (chunk: string) => void };
    stderr?: { write: (chunk: string) => void };
  }) => Promise<number> | number;
};

async function loadRetrieverVerifyScriptModule(): Promise<RetrieverVerifyScriptModule> {
  try {
    return await import("./retriever-verify.ts") as RetrieverVerifyScriptModule;
  } catch (error) {
    throw new Error(
      "Missing S01 implementation: expected scripts/retriever-verify.ts to export parseRetrieverVerifyCliArgs(), runRetrieverVerifyCli(), and main() for bun run verify:retriever --repo <repo> --query <query> [--json].",
      { cause: error },
    );
  }
}

describe("retriever verify CLI contract for scripts/retriever-verify.ts", () => {
  test("parses bun run verify:retriever --repo xbmc/xbmc --query 'json-rpc subtitle delay' --json and preserves the JSON contract", async () => {
    const module = await loadRetrieverVerifyScriptModule();

    const parsed = module.parseRetrieverVerifyCliArgs([
      "--repo",
      "xbmc/xbmc",
      "--query",
      "json-rpc subtitle delay",
      "--json",
    ]);

    expect(parsed.repo).toBe("xbmc/xbmc");
    expect(parsed.query).toBe("json-rpc subtitle delay");
    expect(parsed.json).toBe(true);

    const { report, human, json } = await module.runRetrieverVerifyCli({
      verifyRetriever: async () => ({
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
          dimensions: 1024,
        },
        result_counts: {
          unified_results: 2,
          by_source: { code: 1, wiki: 1 },
        },
        status_code: "retrieval_hits",
        success: true,
        hits: [
          { id: "code:1", source: "code", source_label: "[code] src/interfaces/json-rpc.cpp" },
          { id: "wiki:1", source: "wiki", source_label: "[wiki: Subtitle Sync]" },
        ],
      }),
    });

    expect(JSON.parse(json)).toEqual(report);
    expect(report.not_in_retriever).toEqual(["issue_comments"]);
    expect(report.result_counts.by_source).toEqual({ code: 1, wiki: 1 });
    expect(human).toContain("query_embedding: generated");
    expect(human).toContain("not_in_retriever=issue_comments");
  });

  test("main exits non-zero for query_embedding_unavailable and keeps that degraded path distinct from retrieval_no_hits", async () => {
    const module = await loadRetrieverVerifyScriptModule();

    const degradedStdout: string[] = [];
    const degradedExit = await module.main(["--repo", "xbmc/xbmc", "--query", "json-rpc subtitle delay", "--json"], {
      verifyRetriever: async () => ({
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
      }),
      stdout: { write: (chunk: string) => void degradedStdout.push(chunk) },
      stderr: { write: () => undefined },
    });

    expect(degradedExit).toBe(1);
    expect(JSON.parse(degradedStdout.join(""))).toMatchObject({
      status_code: "query_embedding_unavailable",
      success: false,
    });

    const noHitStdout: string[] = [];
    const noHitExit = await module.main(["--repo", "xbmc/xbmc", "--query", "json-rpc subtitle delay", "--json"], {
      verifyRetriever: async () => ({
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
          dimensions: 1024,
        },
        result_counts: {
          unified_results: 0,
          by_source: {},
        },
        status_code: "retrieval_no_hits",
        success: false,
        hits: [],
      }),
      stdout: { write: (chunk: string) => void noHitStdout.push(chunk) },
      stderr: { write: () => undefined },
    });

    expect(noHitExit).toBe(1);
    expect(JSON.parse(noHitStdout.join(""))).toMatchObject({
      status_code: "retrieval_no_hits",
      success: false,
    });
  });

  test("main surfaces verifier command failures with stable operator text", async () => {
    const module = await loadRetrieverVerifyScriptModule();

    const stderr: string[] = [];
    const exitCode = await module.main(["--repo", "xbmc/xbmc", "--query", "json-rpc subtitle delay"], {
      verifyRetriever: async () => {
        throw new Error("retriever wiring unavailable");
      },
      stdout: { write: () => undefined },
      stderr: { write: (chunk: string) => void stderr.push(chunk) },
    });

    expect(exitCode).toBe(1);
    expect(stderr.join(" ")).toContain("verify:retriever failed");
    expect(stderr.join(" ")).toContain("retriever wiring unavailable");
  });
});
