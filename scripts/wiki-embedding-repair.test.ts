import { describe, expect, test } from "bun:test";

type RepairCliReport = {
  command: "repair:wiki-embeddings";
  mode: "repair" | "status";
  success: boolean;
  status_code: string;
  target_model: string;
  requested_page_title: string | null;
  resumed: boolean;
  run: {
    run_id: string;
    status: "running" | "completed" | "failed" | "resume_required";
    page_id: number | null;
    page_title: string | null;
    window_index: number | null;
    windows_total: number | null;
    repaired: number;
    skipped: number;
    failed: number;
    retry_count: number;
    failure_summary: {
      by_class: Record<string, number>;
      last_failure_class: string | null;
      last_failure_message: string | null;
    };
    used_split_fallback: boolean;
    updated_at: string;
  };
};

type WikiRepairCliModule = {
  parseWikiEmbeddingRepairCliArgs: (args: string[]) => {
    help?: boolean;
    json?: boolean;
    status?: boolean;
    resume?: boolean;
    pageTitle?: string;
  };
  runWikiEmbeddingRepairCli: (input?: {
    args?: string[];
    runRepair?: (options: { pageTitle?: string; resume?: boolean }) => Promise<RepairCliReport>;
    getRepairStatus?: () => Promise<RepairCliReport>;
  }) => Promise<{
    report: RepairCliReport;
    human: string;
    json: string;
  }>;
  main: (args: string[], deps?: {
    runRepair?: (options: { pageTitle?: string; resume?: boolean }) => Promise<RepairCliReport>;
    getRepairStatus?: () => Promise<RepairCliReport>;
    stdout?: { write: (chunk: string) => void };
    stderr?: { write: (chunk: string) => void };
  }) => Promise<number> | number;
};

async function loadWikiRepairCliModule(): Promise<WikiRepairCliModule> {
  try {
    return await import("./wiki-embedding-repair.ts") as WikiRepairCliModule;
  } catch (error) {
    throw new Error(
      "Missing S02 implementation: expected scripts/wiki-embedding-repair.ts to export parseWikiEmbeddingRepairCliArgs(), runWikiEmbeddingRepairCli(), and main() for bun run repair:wiki-embeddings [--page-title <title>] [--resume] [--status] [--json].",
      { cause: error },
    );
  }
}

function makeReport(overrides: Partial<RepairCliReport> = {}): RepairCliReport {
  return {
    command: "repair:wiki-embeddings",
    mode: "repair",
    success: true,
    status_code: "repair_completed",
    target_model: "voyage-context-3",
    requested_page_title: "JSON-RPC API/v8",
    resumed: false,
    run: {
      run_id: "wiki-repair-2026-03-12T12:00:00.000Z",
      status: "completed",
      page_id: 881,
      page_title: "JSON-RPC API/v8",
      window_index: 3,
      windows_total: 4,
      repaired: 12,
      skipped: 0,
      failed: 0,
      retry_count: 1,
      failure_summary: {
        by_class: { timeout_transient: 1 },
        last_failure_class: null,
        last_failure_message: null,
      },
      used_split_fallback: true,
      updated_at: "2026-03-12T12:10:00.000Z",
    },
    ...overrides,
  };
}

describe("repair CLI contract for scripts/wiki-embedding-repair.ts", () => {
  test("parses JSON, status, resume, and page-title flags for bun run repair:wiki-embeddings", async () => {
    const module = await loadWikiRepairCliModule();

    expect(module.parseWikiEmbeddingRepairCliArgs(["--help"]).help).toBe(true);
    expect(module.parseWikiEmbeddingRepairCliArgs(["--json"]).json).toBe(true);
    expect(module.parseWikiEmbeddingRepairCliArgs(["--status"]).status).toBe(true);
    expect(module.parseWikiEmbeddingRepairCliArgs(["--resume"]).resume).toBe(true);
    expect(module.parseWikiEmbeddingRepairCliArgs(["--page-title", "JSON-RPC API/v8"]).pageTitle).toBe("JSON-RPC API/v8");
  });

  test("runWikiEmbeddingRepairCli preserves stable JSON and human progress fields for repair runs", async () => {
    const module = await loadWikiRepairCliModule();

    const { report, human, json } = await module.runWikiEmbeddingRepairCli({
      args: ["--page-title", "JSON-RPC API/v8", "--json"],
      runRepair: async ({ pageTitle, resume }) => makeReport({
        requested_page_title: pageTitle ?? null,
        resumed: Boolean(resume),
      }),
      getRepairStatus: async () => {
        throw new Error("status path should not run for repair invocation");
      },
    });

    expect(report).toMatchObject({
      command: "repair:wiki-embeddings",
      mode: "repair",
      success: true,
      status_code: "repair_completed",
      target_model: "voyage-context-3",
      requested_page_title: "JSON-RPC API/v8",
      resumed: false,
      run: {
        run_id: "wiki-repair-2026-03-12T12:00:00.000Z",
        page_id: 881,
        page_title: "JSON-RPC API/v8",
        window_index: 3,
        windows_total: 4,
        repaired: 12,
        skipped: 0,
        failed: 0,
        retry_count: 1,
        failure_summary: {
          by_class: { timeout_transient: 1 },
          last_failure_class: null,
          last_failure_message: null,
        },
        used_split_fallback: true,
      },
    });
    expect(JSON.parse(json)).toEqual(report);
    expect(human).toContain("repair:wiki-embeddings");
    expect(human).toContain("status_code: repair_completed");
    expect(human).toContain("page_title: JSON-RPC API/v8");
    expect(human).toContain("window: 4/4");
    expect(human).toContain("repaired=12 skipped=0 failed=0");
    expect(human).toContain("last_failure_class=none");
  });

  test("status mode returns machine-readable cursor and failure summary without rerunning repair work", async () => {
    const module = await loadWikiRepairCliModule();

    const { report, human, json } = await module.runWikiEmbeddingRepairCli({
      args: ["--status", "--json"],
      runRepair: async () => {
        throw new Error("repair path should not run for --status");
      },
      getRepairStatus: async () => makeReport({
        mode: "status",
        success: false,
        status_code: "repair_resume_available",
        requested_page_title: null,
        run: {
          run_id: "wiki-repair-2026-03-12T12:00:00.000Z",
          status: "resume_required",
          page_id: 881,
          page_title: "JSON-RPC API/v8",
          window_index: 1,
          windows_total: 4,
          repaired: 6,
          skipped: 0,
          failed: 1,
          retry_count: 2,
          failure_summary: {
            by_class: { timeout_transient: 2, request_too_large: 1 },
            last_failure_class: "timeout_transient",
            last_failure_message: "provider timed out after retry budget",
          },
          used_split_fallback: true,
          updated_at: "2026-03-12T12:05:00.000Z",
        },
      }),
    });

    expect(report).toMatchObject({
      mode: "status",
      success: false,
      status_code: "repair_resume_available",
      requested_page_title: null,
      run: {
        status: "resume_required",
        page_id: 881,
        page_title: "JSON-RPC API/v8",
        window_index: 1,
        windows_total: 4,
        repaired: 6,
        failed: 1,
        retry_count: 2,
        failure_summary: {
          by_class: { timeout_transient: 2, request_too_large: 1 },
          last_failure_class: "timeout_transient",
          last_failure_message: "provider timed out after retry budget",
        },
      },
    });
    expect(JSON.parse(json)).toEqual(report);
    expect(human).toContain("mode: status");
    expect(human).toContain("cursor: page_id=881 window=2/4");
    expect(human).toContain("repair_resume_available");
    expect(human).toContain("last_failure_class=timeout_transient");
  });

  test("main returns stable exit codes and preserves failure diagnostics for repair and status invocations", async () => {
    const module = await loadWikiRepairCliModule();

    const okStdout: string[] = [];
    const okExit = await module.main(["--status", "--json"], {
      runRepair: async () => {
        throw new Error("repair path should not run for --status");
      },
      getRepairStatus: async () => makeReport({
        mode: "status",
        status_code: "repair_completed",
        success: true,
      }),
      stdout: { write: (chunk: string) => void okStdout.push(chunk) },
      stderr: { write: () => undefined },
    });

    expect(okExit).toBe(0);
    expect(JSON.parse(okStdout.join(""))).toMatchObject({
      status_code: "repair_completed",
      success: true,
    });

    const failStderr: string[] = [];
    const failExit = await module.main(["--resume", "--json"], {
      runRepair: async () => makeReport({
        success: false,
        resumed: true,
        status_code: "repair_failed",
        run: {
          run_id: "wiki-repair-2026-03-12T12:00:00.000Z",
          status: "failed",
          page_id: 881,
          page_title: "JSON-RPC API/v8",
          window_index: 1,
          windows_total: 4,
          repaired: 6,
          skipped: 0,
          failed: 2,
          retry_count: 2,
          failure_summary: {
            by_class: { timeout_transient: 2 },
            last_failure_class: "timeout_transient",
            last_failure_message: "provider timed out after retry budget",
          },
          used_split_fallback: true,
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
    expect(failStderr.join(" ")).toContain("repair:wiki-embeddings failed");
    expect(failStderr.join(" ")).toContain("repair_failed");
    expect(failStderr.join(" ")).toContain("timeout_transient");
  });
});
