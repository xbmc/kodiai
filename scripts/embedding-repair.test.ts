import { describe, expect, test } from "bun:test";

type EmbeddingRepairCorpus = "review_comments" | "learning_memories" | "code_snippets" | "issues" | "issue_comments";

type RepairCliReport = {
  command: "repair:embeddings";
  mode: "repair" | "status";
  success: boolean;
  status_code: string;
  corpus: EmbeddingRepairCorpus;
  target_model: string;
  resumed: boolean;
  dry_run: boolean;
  run: {
    run_id: string;
    status: "running" | "completed" | "failed" | "resume_required" | "not_needed";
    corpus: EmbeddingRepairCorpus;
    batch_index: number | null;
    batches_total: number | null;
    last_row_id: number | null;
    processed: number;
    repaired: number;
    skipped: number;
    failed: number;
    failure_summary: {
      by_class: Record<string, number>;
      last_failure_class: string | null;
      last_failure_message: string | null;
    };
    updated_at: string;
  };
};

type EmbeddingRepairCliModule = {
  parseEmbeddingRepairCliArgs: (args: string[]) => {
    help?: boolean;
    json?: boolean;
    status?: boolean;
    resume?: boolean;
    dryRun?: boolean;
    corpus?: EmbeddingRepairCorpus;
  };
  runEmbeddingRepairCli: (input?: {
    args?: string[];
    runRepair?: (options: { corpus: EmbeddingRepairCorpus; resume?: boolean; dryRun?: boolean }) => Promise<RepairCliReport>;
    getRepairStatus?: (options: { corpus: EmbeddingRepairCorpus }) => Promise<RepairCliReport>;
  }) => Promise<{
    report: RepairCliReport;
    human: string;
    json: string;
  }>;
  main: (args: string[], deps?: {
    runRepair?: (options: { corpus: EmbeddingRepairCorpus; resume?: boolean; dryRun?: boolean }) => Promise<RepairCliReport>;
    getRepairStatus?: (options: { corpus: EmbeddingRepairCorpus }) => Promise<RepairCliReport>;
    stdout?: { write: (chunk: string) => void };
    stderr?: { write: (chunk: string) => void };
  }) => Promise<number> | number;
};

async function loadEmbeddingRepairCliModule(): Promise<EmbeddingRepairCliModule> {
  try {
    return await import("./embedding-repair.ts") as EmbeddingRepairCliModule;
  } catch (error) {
    throw new Error(
      "Missing S03 implementation: expected scripts/embedding-repair.ts to export parseEmbeddingRepairCliArgs(), runEmbeddingRepairCli(), and main() for bun run repair:embeddings -- --corpus <name> [--resume] [--status] [--dry-run] [--json].",
      { cause: error },
    );
  }
}

function makeReport(overrides: Partial<RepairCliReport> = {}): RepairCliReport {
  return {
    command: "repair:embeddings",
    mode: "repair",
    success: true,
    status_code: "repair_completed",
    corpus: "review_comments",
    target_model: "voyage-code-3",
    resumed: false,
    dry_run: false,
    run: {
      run_id: "embedding-repair-review_comments-2026-03-12T12:00:00.000Z",
      status: "completed",
      corpus: "review_comments",
      batch_index: 1,
      batches_total: 2,
      last_row_id: 3033,
      processed: 4,
      repaired: 4,
      skipped: 0,
      failed: 0,
      failure_summary: {
        by_class: {},
        last_failure_class: null,
        last_failure_message: null,
      },
      updated_at: "2026-03-12T12:10:00.000Z",
    },
    ...overrides,
  };
}

describe("repair CLI contract for scripts/embedding-repair.ts", () => {
  test("parses corpus, status, resume, dry-run, and json flags for bun run repair:embeddings", async () => {
    const module = await loadEmbeddingRepairCliModule();

    expect(module.parseEmbeddingRepairCliArgs(["--help"]).help).toBe(true);
    expect(module.parseEmbeddingRepairCliArgs(["--json"]).json).toBe(true);
    expect(module.parseEmbeddingRepairCliArgs(["--status"]).status).toBe(true);
    expect(module.parseEmbeddingRepairCliArgs(["--resume"]).resume).toBe(true);
    expect(module.parseEmbeddingRepairCliArgs(["--dry-run"]).dryRun).toBe(true);
    expect(module.parseEmbeddingRepairCliArgs(["--corpus", "review_comments"]).corpus).toBe("review_comments");
  });

  test("runEmbeddingRepairCli preserves stable JSON and human rendering for mutating repair runs", async () => {
    const module = await loadEmbeddingRepairCliModule();

    const { report, human, json } = await module.runEmbeddingRepairCli({
      args: ["--corpus", "review_comments", "--json"],
      runRepair: async ({ corpus, resume, dryRun }) => makeReport({
        corpus,
        resumed: Boolean(resume),
        dry_run: Boolean(dryRun),
        run: {
          ...makeReport().run,
          corpus,
        },
      }),
      getRepairStatus: async () => {
        throw new Error("status path should not run for repair invocation");
      },
    });

    expect(report).toMatchObject({
      command: "repair:embeddings",
      mode: "repair",
      success: true,
      status_code: "repair_completed",
      corpus: "review_comments",
      target_model: "voyage-code-3",
      resumed: false,
      dry_run: false,
      run: {
        run_id: "embedding-repair-review_comments-2026-03-12T12:00:00.000Z",
        status: "completed",
        corpus: "review_comments",
        batch_index: 1,
        batches_total: 2,
        last_row_id: 3033,
        processed: 4,
        repaired: 4,
        skipped: 0,
        failed: 0,
        failure_summary: {
          by_class: {},
          last_failure_class: null,
          last_failure_message: null,
        },
      },
    });
    expect(JSON.parse(json)).toEqual(report);
    expect(human).toContain("repair:embeddings");
    expect(human).toContain("corpus: review_comments");
    expect(human).toContain("status_code: repair_completed");
    expect(human).toContain("batch: 2/2");
    expect(human).toContain("processed=4 repaired=4 skipped=0 failed=0");
    expect(human).toContain("last_failure_class=none");
  });

  test("status and dry-run stay read-only while preserving durable run and failure_summary fields from the same report envelope", async () => {
    const module = await loadEmbeddingRepairCliModule();

    const status = await module.runEmbeddingRepairCli({
      args: ["--corpus", "review_comments", "--status", "--json"],
      runRepair: async () => {
        throw new Error("repair path should not run for --status");
      },
      getRepairStatus: async ({ corpus }) => makeReport({
        mode: "status",
        success: false,
        status_code: "repair_resume_available",
        corpus,
        run: {
          run_id: "embedding-repair-review_comments-2026-03-12T12:00:00.000Z",
          status: "resume_required",
          corpus,
          batch_index: 0,
          batches_total: 2,
          last_row_id: 1516,
          processed: 2,
          repaired: 2,
          skipped: 0,
          failed: 1,
          failure_summary: {
            by_class: { timeout_transient: 2, provider_error: 1 },
            last_failure_class: "provider_error",
            last_failure_message: "Voyage provider returned 503",
          },
          updated_at: "2026-03-12T12:05:00.000Z",
        },
      }),
    });

    expect(status.report).toMatchObject({
      mode: "status",
      success: false,
      status_code: "repair_resume_available",
      corpus: "review_comments",
      run: {
        run_id: "embedding-repair-review_comments-2026-03-12T12:00:00.000Z",
        status: "resume_required",
        batch_index: 0,
        batches_total: 2,
        last_row_id: 1516,
        processed: 2,
        repaired: 2,
        failed: 1,
        failure_summary: {
          by_class: { timeout_transient: 2, provider_error: 1 },
          last_failure_class: "provider_error",
          last_failure_message: "Voyage provider returned 503",
        },
      },
    });
    expect(status.human).toContain("mode: status");
    expect(status.human).toContain("cursor: last_row_id=1516 batch=1/2");
    expect(status.human).toContain("provider_error");

    const dryRun = await module.runEmbeddingRepairCli({
      args: ["--corpus", "issues", "--dry-run", "--json"],
      runRepair: async ({ corpus, dryRun }) => makeReport({
        corpus,
        dry_run: Boolean(dryRun),
        run: {
          run_id: "embedding-repair-issues-2026-03-12T12:20:00.000Z",
          status: "not_needed",
          corpus,
          batch_index: 0,
          batches_total: 1,
          last_row_id: 9001,
          processed: 1,
          repaired: 0,
          skipped: 1,
          failed: 0,
          failure_summary: {
            by_class: {},
            last_failure_class: null,
            last_failure_message: null,
          },
          updated_at: "2026-03-12T12:20:00.000Z",
        },
      }),
      getRepairStatus: async () => {
        throw new Error("status path should not run for --dry-run");
      },
    });

    expect(dryRun.report).toMatchObject({
      mode: "repair",
      success: true,
      status_code: "repair_completed",
      corpus: "issues",
      dry_run: true,
      run: {
        run_id: "embedding-repair-issues-2026-03-12T12:20:00.000Z",
        status: "not_needed",
        corpus: "issues",
        processed: 1,
        repaired: 0,
        skipped: 1,
        failed: 0,
        failure_summary: {
          by_class: {},
          last_failure_class: null,
          last_failure_message: null,
        },
      },
    });
    expect(dryRun.human).toContain("dry_run: true");
    expect(dryRun.human).toContain("processed=1 repaired=0 skipped=1 failed=0");
  });

  test("main returns stable exit codes and surfaces corpus-specific failure diagnostics", async () => {
    const module = await loadEmbeddingRepairCliModule();

    const okStdout: string[] = [];
    const okExit = await module.main(["--corpus", "issues", "--dry-run", "--json"], {
      runRepair: async ({ corpus, dryRun }) => makeReport({
        corpus,
        dry_run: Boolean(dryRun),
      }),
      getRepairStatus: async () => {
        throw new Error("status path should not run for repair invocation");
      },
      stdout: { write: (chunk: string) => void okStdout.push(chunk) },
      stderr: { write: () => undefined },
    });

    expect(okExit).toBe(0);
    expect(JSON.parse(okStdout.join("")).status_code).toBe("repair_completed");

    const failStderr: string[] = [];
    const failExit = await module.main(["--corpus", "review_comments", "--resume", "--json"], {
      runRepair: async ({ corpus }) => makeReport({
        success: false,
        status_code: "repair_failed",
        corpus,
        resumed: true,
        run: {
          run_id: "embedding-repair-review_comments-2026-03-12T12:00:00.000Z",
          status: "failed",
          corpus,
          batch_index: 0,
          batches_total: 2,
          last_row_id: 1516,
          processed: 2,
          repaired: 2,
          skipped: 0,
          failed: 1,
          failure_summary: {
            by_class: { timeout_transient: 2 },
            last_failure_class: "timeout_transient",
            last_failure_message: "provider timed out after retry budget",
          },
          updated_at: "2026-03-12T12:06:00.000Z",
        },
      }),
      getRepairStatus: async () => {
        throw new Error("status path should not run for repair invocation");
      },
      stdout: { write: () => undefined },
      stderr: { write: (chunk: string) => void failStderr.push(chunk) },
    });

    expect(failExit).toBe(1);
    expect(failStderr.join(" ")).toContain("repair:embeddings failed");
    expect(failStderr.join(" ")).toContain("review_comments");
    expect(failStderr.join(" ")).toContain("repair_failed");
    expect(failStderr.join(" ")).toContain("timeout_transient");
  });
});
