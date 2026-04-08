import pino from "pino";
import { createDbClient } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import {
  CANONICAL_CODE_TARGET_EMBEDDING_MODEL,
  NON_WIKI_REPAIR_CORPORA,
  NON_WIKI_TARGET_EMBEDDING_MODEL,
  runCanonicalCodeEmbeddingRepair,
  runCodeSnippetEmbeddingRepair,
  runIssueEmbeddingRepair,
  runLearningMemoryEmbeddingRepair,
  runReviewCommentEmbeddingRepair,
  type EmbeddingRepairCorpus,
  type EmbeddingRepairCheckpoint,
  type EmbeddingRepairReport,
  type EmbeddingRepairRun,
} from "../src/knowledge/embedding-repair.ts";
import { createKnowledgeRuntime } from "../src/knowledge/runtime.ts";

export type RepairCliReport = {
  command: "repair:embeddings";
  mode: "repair" | "status";
  success: boolean;
  status_code: string;
  corpus: EmbeddingRepairCorpus;
  target_model: string;
  resumed: boolean;
  dry_run: boolean;
  run: EmbeddingRepairRun;
};

type CliOptions = {
  help?: boolean;
  json?: boolean;
  status?: boolean;
  resume?: boolean;
  dryRun?: boolean;
  corpus?: EmbeddingRepairCorpus;
  /** Required when --corpus canonical_code: the repository name (e.g. "kodiai") */
  repo?: string;
  /** Required when --corpus canonical_code: the canonical ref (e.g. "main") */
  canonicalRef?: string;
};

type RunRepairFn = (options: {
  corpus: EmbeddingRepairCorpus;
  resume?: boolean;
  dryRun?: boolean;
  repo?: string;
  canonicalRef?: string;
}) => Promise<RepairCliReport>;

type GetRepairStatusFn = (options: {
  corpus: EmbeddingRepairCorpus;
  repo?: string;
  canonicalRef?: string;
}) => Promise<RepairCliReport>;

function isEmbeddingRepairCorpus(value: string | undefined): value is EmbeddingRepairCorpus {
  return value != null && NON_WIKI_REPAIR_CORPORA.includes(value as EmbeddingRepairCorpus);
}

export function parseEmbeddingRepairCliArgs(args: string[]): CliOptions {
  let corpus: EmbeddingRepairCorpus | undefined;
  let repo: string | undefined;
  let canonicalRef: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--corpus") {
      const value = args[index + 1];
      if (isEmbeddingRepairCorpus(value)) {
        corpus = value;
      }
      index += 1;
    } else if (arg === "--repo") {
      repo = args[index + 1];
      index += 1;
    } else if (arg === "--ref") {
      canonicalRef = args[index + 1];
      index += 1;
    }
  }

  return {
    help: args.includes("--help") || args.includes("-h"),
    json: args.includes("--json"),
    status: args.includes("--status"),
    resume: args.includes("--resume"),
    dryRun: args.includes("--dry-run"),
    corpus,
    repo,
    canonicalRef,
  };
}

function usage(): string {
  return [
    "Usage: bun run repair:embeddings -- --corpus <name> [--resume] [--status] [--dry-run] [--json]",
    "",
    "Supported corpora:",
    `  ${NON_WIKI_REPAIR_CORPORA.join(", ")}`,
    "",
    "Options:",
    "  --corpus <name>      Required. Select one non-wiki persisted corpus",
    "  --repo <name>        Required when --corpus canonical_code: repository name",
    "  --ref <ref>          Required when --corpus canonical_code: canonical ref (e.g. main)",
    "  --resume             Resume from the persisted embedding_repair_state cursor",
    "  --status             Read the persisted repair state without mutating rows",
    "  --dry-run            Execute candidate planning without writing embeddings",
    "  --json               Print machine-readable JSON output",
    "  --help               Show this help",
    "",
    "Environment:",
    "  DATABASE_URL         PostgreSQL connection string (required)",
    "  VOYAGE_API_KEY       Required for repair/dry-run runs that still need live embeddings; status mode reads DB state only",
  ].join("\n");
}

function formatBatch(batchIndex: number | null, batchesTotal: number | null): string {
  if (batchIndex === null || batchesTotal === null || batchesTotal <= 0) {
    return "none";
  }
  return `${batchIndex + 1}/${batchesTotal}`;
}

function summarizeFailureClasses(byClass: Record<string, number>): string | null {
  const entries = Object.entries(byClass)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([failureClass, count]) => `${failureClass}=${count}`);

  return entries.length > 0 ? entries.join(", ") : null;
}

function renderHumanReport(report: RepairCliReport): string {
  const failureSummary = summarizeFailureClasses(report.run.failure_summary.by_class);
  const lines = [
    "repair:embeddings",
    `mode: ${report.mode}`,
    `status_code: ${report.status_code}`,
    `success: ${report.success}`,
    `corpus: ${report.corpus}`,
    `target_model: ${report.target_model}`,
    `resumed: ${report.resumed}`,
    `dry_run: ${report.dry_run}`,
    `run_id: ${report.run.run_id}`,
    `run_status: ${report.run.status}`,
    `batch: ${formatBatch(report.run.batch_index, report.run.batches_total)}`,
    `cursor: last_row_id=${report.run.last_row_id ?? "none"} batch=${formatBatch(report.run.batch_index, report.run.batches_total)}`,
    `processed=${report.run.processed} repaired=${report.run.repaired} skipped=${report.run.skipped} failed=${report.run.failed}`,
    `last_failure_class=${report.run.failure_summary.last_failure_class ?? "none"}`,
    `last_failure_message=${report.run.failure_summary.last_failure_message ?? "none"}`,
    `updated_at: ${report.run.updated_at}`,
  ];

  if (failureSummary) {
    lines.push(`failure_summary: ${failureSummary}`);
  }

  return `${lines.join("\n")}\n`;
}

function normalizeStatusReport(params: {
  corpus: EmbeddingRepairCorpus;
  checkpoint: EmbeddingRepairCheckpoint | null;
  hasCandidates: boolean;
}): RepairCliReport {
  const updatedAt = params.checkpoint?.updated_at ?? new Date().toISOString();
  const hasResumeState = Boolean(
    params.hasCandidates
      || params.checkpoint?.status === "failed"
      || params.checkpoint?.status === "resume_required"
      || params.checkpoint?.failure_summary.last_failure_class,
  );
  const status: EmbeddingRepairRun["status"] = hasResumeState
    ? "resume_required"
    : (params.checkpoint?.status ?? "completed");

  return {
    command: "repair:embeddings",
    mode: "status",
    success: !hasResumeState,
    status_code: hasResumeState ? "repair_resume_available" : "repair_completed",
    corpus: params.corpus,
    target_model: NON_WIKI_TARGET_EMBEDDING_MODEL,
    resumed: false,
    dry_run: params.checkpoint?.status === "not_needed" ? Boolean(false) : Boolean(false),
    run: {
      run_id: params.checkpoint?.run_id ?? `embedding-repair-${params.corpus}-${updatedAt}`,
      status,
      corpus: params.corpus,
      batch_index: params.checkpoint?.batch_index ?? null,
      batches_total: params.checkpoint?.batches_total ?? null,
      last_row_id: params.checkpoint?.last_row_id ?? null,
      processed: params.checkpoint?.processed ?? 0,
      repaired: params.checkpoint?.repaired ?? 0,
      skipped: params.checkpoint?.skipped ?? 0,
      failed: params.checkpoint?.failed ?? 0,
      failure_summary: {
        by_class: { ...(params.checkpoint?.failure_summary.by_class ?? {}) },
        last_failure_class: params.checkpoint?.failure_summary.last_failure_class ?? null,
        last_failure_message: params.checkpoint?.failure_summary.last_failure_message ?? null,
      },
      updated_at: updatedAt,
    },
  };
}

function reportFromRepairResult(result: EmbeddingRepairReport): RepairCliReport {
  return {
    command: "repair:embeddings",
    mode: "repair",
    success: result.success,
    status_code: result.status_code,
    corpus: result.corpus,
    target_model: result.target_model,
    resumed: result.resumed,
    dry_run: result.dry_run,
    run: result.run,
  };
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

async function executeRepair(options: {
  corpus: EmbeddingRepairCorpus;
  resume?: boolean;
  dryRun?: boolean;
  repo?: string;
  canonicalRef?: string;
}): Promise<RepairCliReport> {
  const logger = pino({ level: "silent" });
  const db = createDbClient({ logger });

  try {
    await runMigrationsQuietly(db);
    const runtime = createKnowledgeRuntime({ sql: db.sql, logger });

    switch (options.corpus) {
      case "review_comments":
        return reportFromRepairResult(await runReviewCommentEmbeddingRepair({
          store: runtime.reviewCommentStore,
          embeddingProvider: runtime.embeddingProvider,
          resume: options.resume,
          dryRun: options.dryRun,
          logger,
        }));
      case "learning_memories":
        if (!runtime.learningMemoryStore) {
          throw new Error("Learning memory store is unavailable; cannot repair learning_memories");
        }
        return reportFromRepairResult(await runLearningMemoryEmbeddingRepair({
          store: runtime.learningMemoryStore,
          embeddingProvider: runtime.embeddingProvider,
          resume: options.resume,
          dryRun: options.dryRun,
          logger,
        }));
      case "code_snippets":
        return reportFromRepairResult(await runCodeSnippetEmbeddingRepair({
          store: runtime.codeSnippetStore,
          embeddingProvider: runtime.embeddingProvider,
          resume: options.resume,
          dryRun: options.dryRun,
          logger,
        }));
      case "issues":
      case "issue_comments":
        return reportFromRepairResult(await runIssueEmbeddingRepair({
          corpus: options.corpus,
          store: runtime.issueStore,
          embeddingProvider: runtime.embeddingProvider,
          resume: options.resume,
          dryRun: options.dryRun,
          logger,
        }));
      case "canonical_code": {
        const repo = options.repo;
        const canonicalRef = options.canonicalRef;
        if (!repo || !canonicalRef) {
          throw new Error(
            "canonical_code repair requires --repo and --ref to identify the corpus scope",
          );
        }
        if (!runtime.canonicalCodeStore) {
          throw new Error("Canonical code store is unavailable; cannot repair canonical_code");
        }
        return reportFromRepairResult(await runCanonicalCodeEmbeddingRepair({
          store: runtime.canonicalCodeStore,
          embeddingProvider: runtime.embeddingProvider,
          repo,
          canonicalRef,
          resume: options.resume,
          dryRun: options.dryRun,
          logger,
        }));
      }
      default: {
        const exhaustiveCheck: never = options.corpus;
        throw new Error(`Unsupported repair corpus: ${String(exhaustiveCheck)}`);
      }
    }
  } finally {
    await db.close();
  }
}

async function executeStatus(options: {
  corpus: EmbeddingRepairCorpus;
  repo?: string;
  canonicalRef?: string;
}): Promise<RepairCliReport> {
  const logger = pino({ level: "silent" });
  const db = createDbClient({ logger });

  try {
    await runMigrationsQuietly(db);
    const runtime = createKnowledgeRuntime({ sql: db.sql, logger });

    switch (options.corpus) {
      case "review_comments": {
        const checkpoint = await runtime.reviewCommentStore.getRepairState!(options.corpus);
        const candidates = await runtime.reviewCommentStore.listRepairCandidates!(options.corpus);
        return normalizeStatusReport({ corpus: options.corpus, checkpoint, hasCandidates: candidates.length > 0 });
      }
      case "learning_memories": {
        if (!runtime.learningMemoryStore) {
          throw new Error("Learning memory store is unavailable; cannot inspect learning_memories repair state");
        }
        const checkpoint = await runtime.learningMemoryStore.getRepairState!(options.corpus);
        const candidates = await runtime.learningMemoryStore.listRepairCandidates!(options.corpus);
        return normalizeStatusReport({ corpus: options.corpus, checkpoint, hasCandidates: candidates.length > 0 });
      }
      case "code_snippets": {
        const checkpoint = await runtime.codeSnippetStore.getRepairState!(options.corpus);
        const candidates = await runtime.codeSnippetStore.listRepairCandidates!(options.corpus);
        return normalizeStatusReport({ corpus: options.corpus, checkpoint, hasCandidates: candidates.length > 0 });
      }
      case "issues":
      case "issue_comments": {
        const checkpoint = await runtime.issueStore.getRepairState!(options.corpus);
        const candidates = await runtime.issueStore.listRepairCandidates!(options.corpus);
        return normalizeStatusReport({ corpus: options.corpus, checkpoint, hasCandidates: candidates.length > 0 });
      }
      case "canonical_code": {
        const repo = options.repo;
        const canonicalRef = options.canonicalRef;
        if (!repo || !canonicalRef) {
          throw new Error(
            "canonical_code status requires --repo and --ref to scope the query",
          );
        }
        if (!runtime.canonicalCodeStore) {
          throw new Error("Canonical code store is unavailable; cannot inspect canonical_code repair state");
        }
        // Canonical code has no persistent checkpoint table — derive status from
        // whether any stale/missing chunks exist for this repo×ref pair.
        const staleChunks = await runtime.canonicalCodeStore.listStaleChunks({
          repo,
          canonicalRef,
          targetModel: CANONICAL_CODE_TARGET_EMBEDDING_MODEL,
          limit: 1,
        });
        return normalizeStatusReport({
          corpus: options.corpus,
          checkpoint: null,
          hasCandidates: staleChunks.length > 0,
        });
      }
      default: {
        const exhaustiveCheck: never = options.corpus;
        throw new Error(`Unsupported repair corpus: ${String(exhaustiveCheck)}`);
      }
    }
  } finally {
    await db.close();
  }
}

export async function runEmbeddingRepairCli(input?: {
  args?: string[];
  runRepair?: RunRepairFn;
  getRepairStatus?: GetRepairStatusFn;
}): Promise<{
  report: RepairCliReport;
  human: string;
  json: string;
}> {
  const args = input?.args ?? process.argv.slice(2);
  const options = parseEmbeddingRepairCliArgs(args);

  if (!options.corpus) {
    throw new Error(`--corpus is required and must be one of: ${NON_WIKI_REPAIR_CORPORA.join(", ")}`);
  }

  const runRepair = input?.runRepair ?? executeRepair;
  const getRepairStatus = input?.getRepairStatus ?? executeStatus;
  const report = options.status
    ? await getRepairStatus({
        corpus: options.corpus,
        repo: options.repo,
        canonicalRef: options.canonicalRef,
      })
    : await runRepair({
        corpus: options.corpus,
        resume: options.resume,
        dryRun: options.dryRun,
        repo: options.repo,
        canonicalRef: options.canonicalRef,
      });

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
  const options = parseEmbeddingRepairCliArgs(args);
  const stdout = deps?.stdout ?? process.stdout;
  const stderr = deps?.stderr ?? process.stderr;

  if (options.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  try {
    const { report, human, json } = await runEmbeddingRepairCli({
      args,
      runRepair: deps?.runRepair,
      getRepairStatus: deps?.getRepairStatus,
    });

    stdout.write(options.json ? json : human);

    if (!report.success) {
      stderr.write(
        `repair:embeddings failed: corpus=${report.corpus} status_code=${report.status_code} last_failure_class=${report.run.failure_summary.last_failure_class ?? "none"}\n`,
      );
      return 1;
    }

    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`repair:embeddings failed: ${message}\n`);
    return 1;
  }
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
