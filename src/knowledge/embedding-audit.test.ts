import { describe, expect, test } from "bun:test";

type EmbeddingAuditModule = {
  EXPECTED_CORPUS_MODELS: Record<string, string>;
  buildEmbeddingAuditReport: (input: {
    generatedAt: string;
    corpora: Record<
      string,
      {
        total: number;
        missing_or_null: number;
        stale?: number;
        stale_support?: "supported" | "not_supported";
        actual_model_counts: Record<string, number>;
        occurrence_diagnostics?: {
          occurrence_rows: number;
          snippets_without_occurrences: number;
        };
      }
    >;
  }) => {
    generated_at: string;
    audited_corpora: string[];
    overall_status: string;
    overall_severity: string;
    corpora: Array<{
      corpus: string;
      total: number;
      missing_or_null: number;
      stale: number;
      stale_support: "supported" | "not_supported";
      model_mismatch: number;
      expected_model: string;
      actual_models: string[];
      status: string;
      severity: string;
      occurrence_diagnostics?: {
        occurrence_rows: number;
        snippets_without_occurrences: number;
      };
    }>;
  };
  renderEmbeddingAuditReport: (report: {
    generated_at: string;
    audited_corpora: string[];
    overall_status: string;
    overall_severity: string;
    corpora: Array<{
      corpus: string;
      total: number;
      missing_or_null: number;
      stale: number;
      stale_support: "supported" | "not_supported";
      model_mismatch: number;
      expected_model: string;
      actual_models: string[];
      status: string;
      severity: string;
      occurrence_diagnostics?: {
        occurrence_rows: number;
        snippets_without_occurrences: number;
      };
    }>;
  }) => string;
};

async function loadEmbeddingAuditModule(): Promise<EmbeddingAuditModule> {
  try {
    return await import("./embedding-audit.ts") as EmbeddingAuditModule;
  } catch (error) {
    throw new Error(
      "Missing S01 implementation: expected src/knowledge/embedding-audit.ts to export EXPECTED_CORPUS_MODELS, buildEmbeddingAuditReport(), and renderEmbeddingAuditReport() for the audit contract.",
      { cause: error },
    );
  }
}

describe("embedding audit contract for src/knowledge/embedding-audit.ts", () => {
  test("locks six-corpus audit math, wiki-vs-non-wiki model rules, unsupported stale semantics, and code_snippet_occurrences diagnostics", async () => {
    const module = await loadEmbeddingAuditModule();

    expect(module.EXPECTED_CORPUS_MODELS).toEqual({
      learning_memories: "voyage-code-3",
      review_comments: "voyage-code-3",
      wiki_pages: "voyage-context-3",
      code_snippets: "voyage-code-3",
      issues: "voyage-code-3",
      issue_comments: "voyage-code-3",
    });

    const report = module.buildEmbeddingAuditReport({
      generatedAt: "2026-03-12T12:00:00.000Z",
      corpora: {
        learning_memories: {
          total: 5,
          missing_or_null: 0,
          stale: 1,
          stale_support: "supported",
          actual_model_counts: { "voyage-code-3": 5 },
        },
        review_comments: {
          total: 4,
          missing_or_null: 1,
          stale: 0,
          stale_support: "supported",
          actual_model_counts: { "voyage-code-3": 3 },
        },
        wiki_pages: {
          total: 3,
          missing_or_null: 0,
          stale: 0,
          stale_support: "supported",
          actual_model_counts: { "voyage-code-3": 3 },
        },
        code_snippets: {
          total: 6,
          missing_or_null: 0,
          stale: 0,
          stale_support: "supported",
          actual_model_counts: { "voyage-code-3": 6 },
          occurrence_diagnostics: {
            occurrence_rows: 4,
            snippets_without_occurrences: 2,
          },
        },
        issues: {
          total: 2,
          missing_or_null: 0,
          stale_support: "not_supported",
          actual_model_counts: { "voyage-code-3": 2 },
        },
        issue_comments: {
          total: 7,
          missing_or_null: 2,
          stale_support: "not_supported",
          actual_model_counts: { "voyage-code-3": 5 },
        },
      },
    });

    expect(report.generated_at).toBe("2026-03-12T12:00:00.000Z");
    expect(report.audited_corpora).toEqual([
      "learning_memories",
      "review_comments",
      "wiki_pages",
      "code_snippets",
      "issues",
      "issue_comments",
    ]);
    expect(report.overall_status).toBe("fail");
    expect(report.overall_severity).toBe("critical");

    expect(report.corpora).toEqual([
      expect.objectContaining({
        corpus: "learning_memories",
        total: 5,
        missing_or_null: 0,
        stale: 1,
        stale_support: "supported",
        model_mismatch: 0,
        expected_model: "voyage-code-3",
        actual_models: ["voyage-code-3"],
        status: "warn",
        severity: "warning",
      }),
      expect.objectContaining({
        corpus: "review_comments",
        total: 4,
        missing_or_null: 1,
        stale: 0,
        stale_support: "supported",
        model_mismatch: 0,
        expected_model: "voyage-code-3",
        actual_models: ["voyage-code-3"],
        status: "fail",
        severity: "critical",
      }),
      expect.objectContaining({
        corpus: "wiki_pages",
        total: 3,
        missing_or_null: 0,
        stale: 0,
        stale_support: "supported",
        model_mismatch: 3,
        expected_model: "voyage-context-3",
        actual_models: ["voyage-code-3"],
        status: "fail",
        severity: "critical",
      }),
      expect.objectContaining({
        corpus: "code_snippets",
        total: 6,
        missing_or_null: 0,
        stale: 0,
        stale_support: "supported",
        model_mismatch: 0,
        expected_model: "voyage-code-3",
        actual_models: ["voyage-code-3"],
        status: "warn",
        severity: "warning",
        occurrence_diagnostics: {
          occurrence_rows: 4,
          snippets_without_occurrences: 2,
        },
      }),
      expect.objectContaining({
        corpus: "issues",
        total: 2,
        missing_or_null: 0,
        stale: 0,
        stale_support: "not_supported",
        model_mismatch: 0,
        expected_model: "voyage-code-3",
        actual_models: ["voyage-code-3"],
        status: "pass",
        severity: "info",
      }),
      expect.objectContaining({
        corpus: "issue_comments",
        total: 7,
        missing_or_null: 2,
        stale: 0,
        stale_support: "not_supported",
        model_mismatch: 0,
        expected_model: "voyage-code-3",
        actual_models: ["voyage-code-3"],
        status: "fail",
        severity: "critical",
      }),
    ]);
  });

  test("human renderer states the same contract as bun run audit:embeddings --json without inventing stale support for issues or issue_comments", async () => {
    const module = await loadEmbeddingAuditModule();

    const rendered = module.renderEmbeddingAuditReport({
      generated_at: "2026-03-12T12:00:00.000Z",
      audited_corpora: [
        "learning_memories",
        "review_comments",
        "wiki_pages",
        "code_snippets",
        "issues",
        "issue_comments",
      ],
      overall_status: "fail",
      overall_severity: "critical",
      corpora: [
        {
          corpus: "wiki_pages",
          total: 3,
          missing_or_null: 0,
          stale: 0,
          stale_support: "supported",
          model_mismatch: 3,
          expected_model: "voyage-context-3",
          actual_models: ["voyage-code-3"],
          status: "fail",
          severity: "critical",
        },
        {
          corpus: "issue_comments",
          total: 7,
          missing_or_null: 2,
          stale: 0,
          stale_support: "not_supported",
          model_mismatch: 0,
          expected_model: "voyage-code-3",
          actual_models: ["voyage-code-3"],
          status: "fail",
          severity: "critical",
        },
      ],
    });

    expect(rendered).toContain("overall_status: fail");
    expect(rendered).toContain("wiki_pages");
    expect(rendered).toContain("expected_model=voyage-context-3");
    expect(rendered).toContain("actual_models=voyage-code-3");
    expect(rendered).toContain("issue_comments");
    expect(rendered).toContain("stale=not_supported");
    expect(rendered).not.toContain("issue_comments stale=0 supported");
  });
});
