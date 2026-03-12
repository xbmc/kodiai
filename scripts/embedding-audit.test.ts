import { describe, expect, test } from "bun:test";

type EmbeddingAuditScriptModule = {
  parseAuditCliArgs: (args: string[]) => {
    help?: boolean;
    json?: boolean;
  };
  runEmbeddingAuditCli: (deps?: {
    auditEmbeddings?: () => Promise<{
      generated_at: string;
      audited_corpora: string[];
      overall_status: string;
      overall_severity: string;
      success: boolean;
      status_code: string;
      corpora: unknown[];
    }>;
  }) => Promise<{
    report: {
      generated_at: string;
      audited_corpora: string[];
      overall_status: string;
      overall_severity: string;
      success: boolean;
      status_code: string;
      corpora: unknown[];
    };
    human: string;
    json: string;
  }>;
  main: (args: string[], deps?: {
    auditEmbeddings?: () => Promise<{
      generated_at: string;
      audited_corpora: string[];
      overall_status: string;
      overall_severity: string;
      success: boolean;
      status_code: string;
      corpora: unknown[];
    }>;
    stdout?: { write: (chunk: string) => void };
    stderr?: { write: (chunk: string) => void };
  }) => Promise<number> | number;
};

async function loadEmbeddingAuditScriptModule(): Promise<EmbeddingAuditScriptModule> {
  try {
    return await import("./embedding-audit.ts") as EmbeddingAuditScriptModule;
  } catch (error) {
    throw new Error(
      "Missing S01 implementation: expected scripts/embedding-audit.ts to export parseAuditCliArgs(), runEmbeddingAuditCli(), and main() for bun run audit:embeddings [--json].",
      { cause: error },
    );
  }
}

describe("audit CLI contract for scripts/embedding-audit.ts", () => {
  test("parses bun run audit:embeddings --json and preserves a JSON-first operator contract", async () => {
    const module = await loadEmbeddingAuditScriptModule();

    expect(module.parseAuditCliArgs(["--help"]).help).toBe(true);
    expect(module.parseAuditCliArgs(["--json"]).json).toBe(true);

    const { report, human, json } = await module.runEmbeddingAuditCli({
      auditEmbeddings: async () => ({
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
        success: false,
        status_code: "audit_failed",
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
        ],
      }),
    });

    expect(report.status_code).toBe("audit_failed");
    expect(report.success).toBe(false);
    expect(report.audited_corpora).toEqual([
      "learning_memories",
      "review_comments",
      "wiki_pages",
      "code_snippets",
      "issues",
      "issue_comments",
    ]);
    expect(JSON.parse(json)).toEqual(report);
    expect(human).toContain("overall_status: fail");
    expect(human).toContain("wiki_pages");
    expect(human).toContain("voyage-context-3");
  });

  test("main returns stable exit signaling for bun run audit:embeddings --json", async () => {
    const module = await loadEmbeddingAuditScriptModule();

    const chunks: string[] = [];
    const exitCode = await module.main(["--json"], {
      auditEmbeddings: async () => ({
        generated_at: "2026-03-12T12:00:00.000Z",
        audited_corpora: [
          "learning_memories",
          "review_comments",
          "wiki_pages",
          "code_snippets",
          "issues",
          "issue_comments",
        ],
        overall_status: "pass",
        overall_severity: "info",
        success: true,
        status_code: "audit_ok",
        corpora: [],
      }),
      stdout: { write: (chunk: string) => void chunks.push(chunk) },
      stderr: { write: () => undefined },
    });

    expect(exitCode).toBe(0);
    expect(JSON.parse(chunks.join(""))).toMatchObject({
      success: true,
      status_code: "audit_ok",
    });
  });

  test("main reports failures deterministically instead of hiding missing audit implementation behind vague output", async () => {
    const module = await loadEmbeddingAuditScriptModule();

    const stderr: string[] = [];
    const exitCode = await module.main([], {
      auditEmbeddings: async () => {
        throw new Error("knowledge db unavailable");
      },
      stdout: { write: () => undefined },
      stderr: { write: (chunk: string) => void stderr.push(chunk) },
    });

    expect(exitCode).toBe(1);
    expect(stderr.join(" ")).toContain("audit:embeddings failed");
    expect(stderr.join(" ")).toContain("knowledge db unavailable");
  });
});
