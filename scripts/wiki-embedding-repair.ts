import pino from "pino";
import { createDbClient } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { contextualizedEmbedChunksForRepair } from "../src/knowledge/embeddings.ts";
import { DEFAULT_EMBEDDING_DIMENSIONS, createKnowledgeRuntime } from "../src/knowledge/runtime.ts";
import { TARGET_WIKI_EMBEDDING_MODEL, runWikiEmbeddingRepair, type RepairStore, type RepairWindow } from "../src/knowledge/wiki-embedding-repair.ts";

export type RepairCliReport = {
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

type CliOptions = {
  help?: boolean;
  json?: boolean;
  status?: boolean;
  resume?: boolean;
  pageTitle?: string;
};

type RunRepairFn = (options: { pageTitle?: string; resume?: boolean }) => Promise<RepairCliReport>;
type GetRepairStatusFn = () => Promise<RepairCliReport>;

type FailureSummaryState = {
  byClass: Record<string, number>;
  lastFailureClass: string | null;
  lastFailureMessage: string | null;
};

export function parseWikiEmbeddingRepairCliArgs(args: string[]): CliOptions {
  let pageTitle: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--page-title") {
      pageTitle = args[index + 1];
      index += 1;
    }
  }

  return {
    help: args.includes("--help") || args.includes("-h"),
    json: args.includes("--json"),
    status: args.includes("--status"),
    resume: args.includes("--resume"),
    pageTitle,
  };
}

function usage(): string {
  return [
    "Usage: bun run repair:wiki-embeddings [--page-title <title>] [--resume] [--status] [--json]",
    "",
    "Options:",
    "  --page-title <title>  Limit repair work to one wiki page title",
    "  --resume              Resume from the persisted bounded-window checkpoint",
    "  --status              Read the persisted checkpoint/status surface without repairing",
    "  --json                Print machine-readable JSON output",
    "  --help                Show this help",
    "",
    "Environment:",
    "  DATABASE_URL          PostgreSQL connection string (required)",
    "  VOYAGE_API_KEY        VoyageAI API key (required for repair runs; status-only mode reads DB state only)",
  ].join("\n");
}

function incrementFailure(summary: FailureSummaryState, failureClass: string, message: string): void {
  summary.byClass[failureClass] = (summary.byClass[failureClass] ?? 0) + 1;
  summary.lastFailureClass = failureClass;
  summary.lastFailureMessage = message;
}

function formatWindow(windowIndex: number | null, windowsTotal: number | null): string {
  if (windowIndex === null || windowsTotal === null || windowsTotal <= 0) {
    return "none";
  }
  return `${windowIndex + 1}/${windowsTotal}`;
}

function renderHumanReport(report: RepairCliReport): string {
  const lines = [
    "repair:wiki-embeddings",
    `mode: ${report.mode}`,
    `status_code: ${report.status_code}`,
    `success: ${report.success}`,
    `target_model: ${report.target_model}`,
    `requested_page_title: ${report.requested_page_title ?? "none"}`,
    `resumed: ${report.resumed}`,
    `run_id: ${report.run.run_id}`,
    `run_status: ${report.run.status}`,
    `page_id: ${report.run.page_id ?? "none"}`,
    `page_title: ${report.run.page_title ?? "none"}`,
    `window: ${formatWindow(report.run.window_index, report.run.windows_total)}`,
    `cursor: page_id=${report.run.page_id ?? "none"} window=${formatWindow(report.run.window_index, report.run.windows_total)}`,
    `repaired=${report.run.repaired} skipped=${report.run.skipped} failed=${report.run.failed}`,
    `retry_count: ${report.run.retry_count}`,
    `used_split_fallback: ${report.run.used_split_fallback}`,
    `last_failure_class=${report.run.failure_summary.last_failure_class ?? "none"}`,
    `last_failure_message=${report.run.failure_summary.last_failure_message ?? "none"}`,
    `updated_at: ${report.run.updated_at}`,
  ];

  const failureClasses = Object.entries(report.run.failure_summary.by_class)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([failureClass, count]) => `${failureClass}=${count}`);

  if (failureClasses.length > 0) {
    lines.push(`failure_summary: ${failureClasses.join(", ")}`);
  }

  return `${lines.join("\n")}\n`;
}

function createRunId(updatedAt: string): string {
  return `wiki-repair-${updatedAt}`;
}

async function runMigrationsQuietly(db: ReturnType<typeof createDbClient>): Promise<void> {
  const originalConsoleLog = console.log;
  console.log = () => undefined;
  try {
    await runMigrations(db.sql);
  } finally {
    console.log = originalConsoleLog;
  }
}

async function executeRepair(options: { pageTitle?: string; resume?: boolean }): Promise<RepairCliReport> {
  const logger = pino({ level: "silent" });
  const db = createDbClient({ logger });
  const startedAt = new Date().toISOString();
  const failureSummary: FailureSummaryState = {
    byClass: {},
    lastFailureClass: null,
    lastFailureMessage: null,
  };

  try {
    await runMigrationsQuietly(db);
    const runtime = createKnowledgeRuntime({ sql: db.sql, logger });

    if (!process.env.VOYAGE_API_KEY?.trim()) {
      throw new Error("VOYAGE_API_KEY is required for repair runs");
    }

    const result = await runWikiEmbeddingRepair({
      pageTitle: options.pageTitle,
      resume: options.resume,
      store: runtime.wikiPageStore as unknown as RepairStore,
      logger,
      embedWindow: async (window: RepairWindow, attempt: number) => {
        const rows = await runtime.wikiPageStore.getPageChunks(window.page_id);
        const rowsById = new Map(rows.map((row) => [row.id, row]));
        const chunks = window.chunk_ids
          .map((chunkId) => rowsById.get(chunkId)?.chunkText)
          .filter((chunkText): chunkText is string => typeof chunkText === "string");

        const outcome = await contextualizedEmbedChunksForRepair({
          apiKey: process.env.VOYAGE_API_KEY!.trim(),
          chunks,
          model: TARGET_WIKI_EMBEDDING_MODEL,
          dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
          logger,
          maxRetries: 0,
        });

        if (outcome.status === "ok") {
          return {
            status: "ok" as const,
            embeddings: window.chunk_ids
              .map((chunk_id, index) => {
                const embedding = outcome.embeddings.get(index);
                return embedding ? { chunk_id, embedding } : null;
              })
              .filter((item): item is { chunk_id: number; embedding: Float32Array } => item !== null),
            retry_count: outcome.retry_count ?? attempt,
          };
        }

        incrementFailure(failureSummary, outcome.failure_class, outcome.message);
        return {
          status: "failed" as const,
          failure_class: outcome.failure_class,
          message: outcome.message,
          retryable: outcome.retryable,
          should_split: outcome.should_split,
        };
      },
    });

    const updatedAt = new Date().toISOString();
    const retryCount = Math.max(0, ...result.progress.map((entry) => entry.retry_count));

    return {
      command: "repair:wiki-embeddings",
      mode: "repair",
      success: result.success,
      status_code: result.status_code,
      target_model: result.target_model,
      requested_page_title: options.pageTitle ?? null,
      resumed: result.resumed,
      run: {
        run_id: createRunId(startedAt),
        status: result.success ? "completed" : "failed",
        page_id: result.cursor.page_id,
        page_title: result.cursor.page_title,
        window_index: result.cursor.window_index,
        windows_total: result.cursor.windows_total,
        repaired: result.repaired,
        skipped: result.skipped,
        failed: result.failed,
        retry_count: retryCount,
        failure_summary: {
          by_class: failureSummary.byClass,
          last_failure_class: result.success ? null : failureSummary.lastFailureClass,
          last_failure_message: result.success ? null : failureSummary.lastFailureMessage,
        },
        used_split_fallback: result.used_split_fallback,
        updated_at: updatedAt,
      },
    };
  } finally {
    await db.close();
  }
}

async function executeStatus(): Promise<RepairCliReport> {
  const logger = pino({ level: "silent" });
  const db = createDbClient({ logger });

  try {
    await runMigrationsQuietly(db);
    const runtime = createKnowledgeRuntime({ sql: db.sql, logger });
    const checkpoint = await runtime.wikiPageStore.getRepairCheckpoint();
    const remaining = await runtime.wikiPageStore.listRepairCandidates();

    const updatedAt = checkpoint?.updatedAt ?? new Date().toISOString();
    const hasRemaining = remaining.length > 0;
    const lastFailureClass = checkpoint?.lastFailureClass ?? null;
    const status = hasRemaining || lastFailureClass ? "resume_required" : "completed";
    const statusCode = status === "completed" ? "repair_completed" : "repair_resume_available";

    return {
      command: "repair:wiki-embeddings",
      mode: "status",
      success: status === "completed",
      status_code: statusCode,
      target_model: TARGET_WIKI_EMBEDDING_MODEL,
      requested_page_title: null,
      resumed: false,
      run: {
        run_id: createRunId(updatedAt),
        status,
        page_id: checkpoint?.pageId ?? remaining[0]?.pageId ?? null,
        page_title: checkpoint?.pageTitle ?? remaining[0]?.pageTitle ?? null,
        window_index: checkpoint?.windowIndex ?? null,
        windows_total: checkpoint?.windowsTotal ?? null,
        repaired: checkpoint?.repaired ?? 0,
        skipped: checkpoint?.skipped ?? 0,
        failed: checkpoint?.failed ?? 0,
        retry_count: checkpoint?.retryCount ?? 0,
        failure_summary: {
          by_class: lastFailureClass ? { [lastFailureClass]: Math.max(checkpoint?.failed ?? 0, 1) } : {},
          last_failure_class: lastFailureClass,
          last_failure_message: checkpoint?.lastFailureMessage ?? null,
        },
        used_split_fallback: checkpoint?.usedSplitFallback ?? false,
        updated_at: updatedAt,
      },
    };
  } finally {
    await db.close();
  }
}

export async function runWikiEmbeddingRepairCli(input?: {
  args?: string[];
  runRepair?: RunRepairFn;
  getRepairStatus?: GetRepairStatusFn;
}): Promise<{
  report: RepairCliReport;
  human: string;
  json: string;
}> {
  const args = input?.args ?? process.argv.slice(2);
  const options = parseWikiEmbeddingRepairCliArgs(args);

  const runRepair = input?.runRepair ?? executeRepair;
  const getRepairStatus = input?.getRepairStatus ?? executeStatus;

  const report = options.status
    ? await getRepairStatus()
    : await runRepair({ pageTitle: options.pageTitle, resume: options.resume });

  return {
    report,
    human: renderHumanReport(report),
    json: `${JSON.stringify(report, null, 2)}\n`,
  };
}

export async function main(
  args: string[] = process.argv.slice(2),
  deps?: {
    runRepair?: RunRepairFn;
    getRepairStatus?: GetRepairStatusFn;
    stdout?: { write: (chunk: string) => void };
    stderr?: { write: (chunk: string) => void };
  },
): Promise<number> {
  const options = parseWikiEmbeddingRepairCliArgs(args);
  const stdout = deps?.stdout ?? process.stdout;
  const stderr = deps?.stderr ?? process.stderr;

  if (options.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  try {
    const { report, human, json } = await runWikiEmbeddingRepairCli({
      args,
      runRepair: deps?.runRepair,
      getRepairStatus: deps?.getRepairStatus,
    });

    stdout.write(options.json ? json : human);

    if (!report.success) {
      stderr.write(
        `repair:wiki-embeddings failed: ${report.status_code} last_failure_class=${report.run.failure_summary.last_failure_class ?? "none"}\n`,
      );
      return 1;
    }

    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`repair:wiki-embeddings failed: ${message}\n`);
    return 1;
  }
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
