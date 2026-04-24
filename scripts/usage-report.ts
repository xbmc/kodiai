import { parseArgs } from "node:util";
import type { Sql } from "../src/db/client.ts";

type AccessState = "available" | "missing" | "unavailable";

type CliOptions = {
  since: string | null;
  repo: string | null;
  json: boolean;
  csv: boolean;
  help: boolean;
};

export type UsageReportSummary = {
  totalExecutions: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  distinctDeliveries: number;
};

export type UsageTaskTypeRow = {
  taskType: string;
  executions: number;
  totalTokens: number;
  totalCostUsd: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cacheEffectiveness: number;
};

export type UsageDeliveryRow = {
  deliveryId: string;
  repo: string;
  taskType: string;
  promptKinds: string[];
  sectionCount: number;
  promptEstimatedTokens: number;
  llmInputTokens: number;
  llmOutputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  estimatedCostUsd: number;
};

export type UsagePromptSectionRow = {
  taskType: string;
  promptKind: string;
  sectionName: string;
  executions: number;
  totalEstimatedTokens: number;
  totalCharCount: number;
  truncatedExecutions: number;
};

export type UsageRateLimitRow = {
  taskType: string;
  executions: number;
  avgCacheHitRate: number;
  totalSkippedQueries: number;
  degradationCount: number;
};

export type UsageReportQueryResult = {
  summary: UsageReportSummary;
  taskTypes: UsageTaskTypeRow[];
  deliveryBreakdown: UsageDeliveryRow[];
  promptSections: UsagePromptSectionRow[];
  rateLimits: UsageRateLimitRow[];
};

export type UsageReport = {
  command: "report";
  generatedAt: string;
  filters: {
    since: string | null;
    repo: string | null;
  };
  preflight: {
    databaseAccess: AccessState;
    detail: string;
  };
  summary: UsageReportSummary & {
    cacheEffectiveness: number;
  };
  taskTypes: UsageTaskTypeRow[];
  deliveryBreakdown: UsageDeliveryRow[];
  promptSections: UsagePromptSectionRow[];
  rateLimits: UsageRateLimitRow[];
};

function emptySummary(): UsageReportSummary {
  return {
    totalExecutions: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheWriteTokens: 0,
    totalTokens: 0,
    totalCostUsd: 0,
    distinctDeliveries: 0,
  };
}

function computeCacheEffectiveness(summary: UsageReportSummary): number {
  if (summary.totalTokens <= 0) {
    return 0;
  }
  return Number((summary.totalCacheReadTokens / summary.totalTokens).toFixed(4));
}

function roundCurrency(value: number): number {
  return Number(value.toFixed(8));
}

function roundRatio(value: number): number {
  return Number(value.toFixed(4));
}

export function buildUsageReport(input: {
  generatedAt: string;
  filters: { since: string | null; repo: string | null };
  accessState: AccessState;
  accessDetail: string;
  result: UsageReportQueryResult | null;
}): UsageReport {
  const result = input.result ?? {
    summary: emptySummary(),
    taskTypes: [],
    deliveryBreakdown: [],
    promptSections: [],
    rateLimits: [],
  };

  return {
    command: "report",
    generatedAt: input.generatedAt,
    filters: input.filters,
    preflight: {
      databaseAccess: input.accessState,
      detail: input.accessDetail,
    },
    summary: {
      ...result.summary,
      cacheEffectiveness: computeCacheEffectiveness(result.summary),
    },
    taskTypes: result.taskTypes,
    deliveryBreakdown: result.deliveryBreakdown,
    promptSections: result.promptSections,
    rateLimits: result.rateLimits,
  };
}

function formatNumber(value: number): string {
  return value.toLocaleString();
}

function formatCurrency(value: number): string {
  return `$${value.toFixed(4)}`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function renderUsageReportText(report: UsageReport): string {
  const lines = [
    "Kodiai Telemetry Usage Report",
    "",
    `Database access: ${report.preflight.databaseAccess}`,
    `Preflight detail: ${report.preflight.detail}`,
    `Generated at: ${report.generatedAt}`,
  ];

  if (report.filters.since || report.filters.repo) {
    lines.push(
      `Filters: since=${report.filters.since ?? "none"} repo=${report.filters.repo ?? "none"}`,
    );
  }

  if (report.preflight.databaseAccess !== "available") {
    lines.push("", "No live telemetry data available. The report failed open so operators can see the access state without relying on stale SQLite data.");
    return lines.join("\n");
  }

  lines.push(
    "",
    "Summary",
    `- Executions: ${formatNumber(report.summary.totalExecutions)}`,
    `- Distinct deliveries: ${formatNumber(report.summary.distinctDeliveries)}`,
    `- Input tokens: ${formatNumber(report.summary.totalInputTokens)}`,
    `- Output tokens: ${formatNumber(report.summary.totalOutputTokens)}`,
    `- Cache read tokens: ${formatNumber(report.summary.totalCacheReadTokens)}`,
    `- Cache write tokens: ${formatNumber(report.summary.totalCacheWriteTokens)}`,
    `- Total tokens: ${formatNumber(report.summary.totalTokens)}`,
    `- Total cost: ${formatCurrency(report.summary.totalCostUsd)}`,
    `- Cache effectiveness: ${formatPercent(report.summary.cacheEffectiveness)}`,
    "",
    "Task-path attribution",
  );

  if (report.taskTypes.length === 0) {
    lines.push("- No llm_cost_events rows matched the requested filters.");
  } else {
    for (const row of report.taskTypes) {
      lines.push(
        `- ${row.taskType}: executions=${row.executions} tokens=${formatNumber(row.totalTokens)} cost=${formatCurrency(row.totalCostUsd)} cache_read=${formatNumber(row.cacheReadTokens)} cache_write=${formatNumber(row.cacheWriteTokens)} cache_effectiveness=${formatPercent(row.cacheEffectiveness)}`,
      );
    }
  }

  lines.push("", "Delivery breakdown");
  if (report.deliveryBreakdown.length === 0) {
    lines.push("- No delivery-level attribution rows matched the requested filters.");
  } else {
    for (const row of report.deliveryBreakdown) {
      lines.push(
        `- ${row.deliveryId} ${row.taskType} repo=${row.repo} prompt_kinds=${row.promptKinds.join(", ")} sections=${row.sectionCount} prompt_tokens=${row.promptEstimatedTokens} input=${row.llmInputTokens} output=${row.llmOutputTokens} cache_read=${row.cacheReadTokens} cache_write=${row.cacheWriteTokens} cost=${formatCurrency(row.estimatedCostUsd)}`,
      );
    }
  }

  lines.push("", "Prompt-section summaries");
  if (report.promptSections.length === 0) {
    lines.push("- No prompt_section_events rows matched the requested filters.");
  } else {
    for (const row of report.promptSections) {
      lines.push(
        `- ${row.taskType} / ${row.promptKind} / ${row.sectionName}: executions=${row.executions} estimated_tokens=${row.totalEstimatedTokens} chars=${row.totalCharCount} truncated=${row.truncatedExecutions}`,
      );
    }
  }

  lines.push("", "Cache effectiveness");
  if (report.rateLimits.length === 0) {
    lines.push("- No rate_limit_events rows matched the requested filters.");
  } else {
    for (const row of report.rateLimits) {
      lines.push(
        `- ${row.taskType}: executions=${row.executions} avg_cache_hit_rate=${formatPercent(row.avgCacheHitRate)} skipped_queries=${row.totalSkippedQueries} degraded=${row.degradationCount}`,
      );
    }
  }

  return lines.join("\n");
}

export function renderUsageReportCsv(report: UsageReport): string {
  const lines = [
    "section,key,value",
    `preflight,database_access,${report.preflight.databaseAccess}`,
    `preflight,detail,${JSON.stringify(report.preflight.detail)}`,
    `summary,total_executions,${report.summary.totalExecutions}`,
    `summary,distinct_deliveries,${report.summary.distinctDeliveries}`,
    `summary,total_input_tokens,${report.summary.totalInputTokens}`,
    `summary,total_output_tokens,${report.summary.totalOutputTokens}`,
    `summary,total_cache_read_tokens,${report.summary.totalCacheReadTokens}`,
    `summary,total_cache_write_tokens,${report.summary.totalCacheWriteTokens}`,
    `summary,total_tokens,${report.summary.totalTokens}`,
    `summary,total_cost_usd,${report.summary.totalCostUsd}`,
    `summary,cache_effectiveness,${report.summary.cacheEffectiveness}`,
  ];

  for (const row of report.taskTypes) {
    lines.push(`task_type,${JSON.stringify(row.taskType)},${JSON.stringify(row)}`);
  }
  for (const row of report.deliveryBreakdown) {
    lines.push(`delivery,${JSON.stringify(row.deliveryId)},${JSON.stringify(row)}`);
  }
  for (const row of report.promptSections) {
    lines.push(`prompt_section,${JSON.stringify(`${row.taskType}/${row.promptKind}/${row.sectionName}`)},${JSON.stringify(row)}`);
  }
  for (const row of report.rateLimits) {
    lines.push(`rate_limit,${JSON.stringify(row.taskType)},${JSON.stringify(row)}`);
  }

  return lines.join("\n");
}

async function fetchSummary(sql: Sql, repo: string | null, since: string | null): Promise<UsageReportSummary> {
  const rows = await sql<UsageReportSummary[]>`
    SELECT
      COUNT(*)::int AS "totalExecutions",
      COALESCE(SUM(input_tokens), 0)::int AS "totalInputTokens",
      COALESCE(SUM(output_tokens), 0)::int AS "totalOutputTokens",
      COALESCE(SUM(cache_read_tokens), 0)::int AS "totalCacheReadTokens",
      COALESCE(SUM(cache_write_tokens), 0)::int AS "totalCacheWriteTokens",
      COALESCE(SUM(input_tokens + output_tokens), 0)::int AS "totalTokens",
      COALESCE(SUM(estimated_cost_usd), 0)::float8 AS "totalCostUsd",
      COUNT(DISTINCT COALESCE(delivery_id, task_type || ':' || created_at::text))::int AS "distinctDeliveries"
    FROM llm_cost_events
    WHERE (${repo}::text IS NULL OR repo = ${repo})
      AND (${since}::timestamptz IS NULL OR created_at >= ${since}::timestamptz)
  `;
  return rows[0] ?? emptySummary();
}

async function fetchTaskTypes(sql: Sql, repo: string | null, since: string | null): Promise<UsageTaskTypeRow[]> {
  const rows = await sql<UsageTaskTypeRow[]>`
    SELECT
      task_type AS "taskType",
      COUNT(*)::int AS "executions",
      COALESCE(SUM(input_tokens + output_tokens), 0)::int AS "totalTokens",
      COALESCE(SUM(estimated_cost_usd), 0)::float8 AS "totalCostUsd",
      COALESCE(SUM(cache_read_tokens), 0)::int AS "cacheReadTokens",
      COALESCE(SUM(cache_write_tokens), 0)::int AS "cacheWriteTokens",
      COALESCE(
        SUM(cache_read_tokens)::float8 / NULLIF(SUM(input_tokens + output_tokens), 0)::float8,
        0
      )::float8 AS "cacheEffectiveness"
    FROM llm_cost_events
    WHERE (${repo}::text IS NULL OR repo = ${repo})
      AND (${since}::timestamptz IS NULL OR created_at >= ${since}::timestamptz)
    GROUP BY task_type
    ORDER BY "totalCostUsd" DESC, task_type ASC
  `;

  return rows.map((row) => ({
    ...row,
    totalCostUsd: roundCurrency(row.totalCostUsd),
    cacheEffectiveness: roundRatio(row.cacheEffectiveness),
  }));
}

async function fetchDeliveryBreakdown(sql: Sql, repo: string | null, since: string | null): Promise<UsageDeliveryRow[]> {
  const rows = await sql<UsageDeliveryRow[]>`
    SELECT
      l.delivery_id AS "deliveryId",
      l.repo AS repo,
      l.task_type AS "taskType",
      COALESCE(array_remove(array_agg(DISTINCT p.prompt_kind), NULL), ARRAY[]::text[]) AS "promptKinds",
      COALESCE(COUNT(p.id), 0)::int AS "sectionCount",
      COALESCE(SUM(p.estimated_tokens), 0)::int AS "promptEstimatedTokens",
      COALESCE(SUM(l.input_tokens), 0)::int AS "llmInputTokens",
      COALESCE(SUM(l.output_tokens), 0)::int AS "llmOutputTokens",
      COALESCE(SUM(l.cache_read_tokens), 0)::int AS "cacheReadTokens",
      COALESCE(SUM(l.cache_write_tokens), 0)::int AS "cacheWriteTokens",
      COALESCE(SUM(l.estimated_cost_usd), 0)::float8 AS "estimatedCostUsd"
    FROM llm_cost_events l
    LEFT JOIN prompt_section_events p
      ON p.delivery_id = l.delivery_id
     AND p.task_type = l.task_type
     AND (${since}::timestamptz IS NULL OR p.created_at >= ${since}::timestamptz)
    WHERE l.delivery_id IS NOT NULL
      AND (${repo}::text IS NULL OR l.repo = ${repo})
      AND (${since}::timestamptz IS NULL OR l.created_at >= ${since}::timestamptz)
    GROUP BY l.delivery_id, l.repo, l.task_type
    ORDER BY "estimatedCostUsd" DESC, l.delivery_id ASC
    LIMIT 20
  `;

  return rows.map((row) => ({
    ...row,
    promptKinds: [...row.promptKinds].sort(),
    estimatedCostUsd: roundCurrency(row.estimatedCostUsd),
  }));
}

async function fetchPromptSections(sql: Sql, repo: string | null, since: string | null): Promise<UsagePromptSectionRow[]> {
  const rows = await sql<UsagePromptSectionRow[]>`
    SELECT
      task_type AS "taskType",
      prompt_kind AS "promptKind",
      section_name AS "sectionName",
      COUNT(DISTINCT COALESCE(delivery_id, task_type || ':' || created_at::text))::int AS executions,
      COALESCE(SUM(estimated_tokens), 0)::int AS "totalEstimatedTokens",
      COALESCE(SUM(char_count), 0)::int AS "totalCharCount",
      COALESCE(SUM(CASE WHEN truncated THEN 1 ELSE 0 END), 0)::int AS "truncatedExecutions"
    FROM prompt_section_events
    WHERE (${repo}::text IS NULL OR repo = ${repo})
      AND (${since}::timestamptz IS NULL OR created_at >= ${since}::timestamptz)
    GROUP BY task_type, prompt_kind, section_name
    ORDER BY "totalEstimatedTokens" DESC, task_type ASC, prompt_kind ASC, section_name ASC
    LIMIT 30
  `;
  return rows;
}

async function fetchRateLimits(sql: Sql, repo: string | null, since: string | null): Promise<UsageRateLimitRow[]> {
  const rows = await sql<UsageRateLimitRow[]>`
    SELECT
      COALESCE(l.task_type, r.event_type) AS "taskType",
      COUNT(*)::int AS executions,
      COALESCE(AVG(r.cache_hit_rate), 0)::float8 AS "avgCacheHitRate",
      COALESCE(SUM(r.skipped_queries), 0)::int AS "totalSkippedQueries",
      COALESCE(SUM(CASE WHEN LOWER(COALESCE(r.degradation_path, 'none')) <> 'none' THEN 1 ELSE 0 END), 0)::int AS "degradationCount"
    FROM rate_limit_events r
    LEFT JOIN llm_cost_events l
      ON l.delivery_id = r.delivery_id
     AND (${since}::timestamptz IS NULL OR l.created_at >= ${since}::timestamptz)
    WHERE (${repo}::text IS NULL OR r.repo = ${repo})
      AND (${since}::timestamptz IS NULL OR r.created_at >= ${since}::timestamptz)
    GROUP BY COALESCE(l.task_type, r.event_type)
    ORDER BY executions DESC, "taskType" ASC
  `;

  return rows.map((row) => ({
    ...row,
    avgCacheHitRate: roundRatio(row.avgCacheHitRate),
  }));
}

export async function queryUsageReport(sql: Sql, filters: { repo: string | null; since: string | null }): Promise<UsageReportQueryResult> {
  const [summary, taskTypes, deliveryBreakdown, promptSections, rateLimits] = await Promise.all([
    fetchSummary(sql, filters.repo, filters.since),
    fetchTaskTypes(sql, filters.repo, filters.since),
    fetchDeliveryBreakdown(sql, filters.repo, filters.since),
    fetchPromptSections(sql, filters.repo, filters.since),
    fetchRateLimits(sql, filters.repo, filters.since),
  ]);

  return {
    summary,
    taskTypes,
    deliveryBreakdown,
    promptSections,
    rateLimits,
  };
}

function normalizeSince(value: string): string {
  const relativeMatch = value.match(/^(\d+)d$/);
  if (relativeMatch) {
    const days = Number.parseInt(relativeMatch[1] ?? "0", 10);
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - days);
    return date.toISOString();
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${value}T00:00:00.000Z`;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid --since format: '${value}'. Use Nd, YYYY-MM-DD, or ISO-8601.`);
  }

  return parsed.toISOString();
}

export function parseUsageReportArgs(args: string[]): CliOptions {
  const parsed = parseArgs({
    args,
    options: {
      since: { type: "string" },
      repo: { type: "string" },
      json: { type: "boolean", default: false },
      csv: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
    allowPositionals: false,
  });

  return {
    since: parsed.values.since ? normalizeSince(parsed.values.since) : null,
    repo: parsed.values.repo ?? null,
    json: parsed.values.json ?? false,
    csv: parsed.values.csv ?? false,
    help: parsed.values.help ?? false,
  };
}

function printUsage(): void {
  console.log(`Kodiai telemetry usage report\n\nUsage:\n  bun scripts/usage-report.ts [--repo <owner/repo>] [--since <Nd|YYYY-MM-DD|ISO>] [--json|--csv]\n\nNotes:\n  - Reads live Postgres telemetry through createDbClient()\n  - Fails open with explicit database access status when Postgres is unavailable\n  - Surfaces token totals, cost totals, cache effectiveness, task-path attribution, and prompt-section summaries`);
}

function snapshotProcessEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...env };
}

export async function runUsageReportCli(args: string[], env: NodeJS.ProcessEnv = snapshotProcessEnv()): Promise<{ report: UsageReport; exitCode: number }> {
  const options = parseUsageReportArgs(args);
  if (options.help) {
    printUsage();
    return {
      report: buildUsageReport({
        generatedAt: new Date().toISOString(),
        filters: { repo: options.repo, since: options.since },
        accessState: "missing",
        accessDetail: "Help requested.",
        result: null,
      }),
      exitCode: 0,
    };
  }

  const connectionString = env.TEST_DATABASE_URL ?? env.DATABASE_URL ?? null;
  if (!connectionString) {
    const report = buildUsageReport({
      generatedAt: new Date().toISOString(),
      filters: { repo: options.repo, since: options.since },
      accessState: "missing",
      accessDetail: "Neither TEST_DATABASE_URL nor DATABASE_URL is set.",
      result: null,
    });
    return { report, exitCode: 0 };
  }

  const [{ default: pino }, { createDbClient }] = await Promise.all([
    import("pino"),
    import("../src/db/client.ts"),
  ]);
  const logger = pino({ level: "silent" });
  let client: ReturnType<typeof createDbClient> | null = null;
  try {
    client = createDbClient({ connectionString, logger });
    const result = await queryUsageReport(client.sql, {
      repo: options.repo,
      since: options.since,
    });

    const report = buildUsageReport({
      generatedAt: new Date().toISOString(),
      filters: { repo: options.repo, since: options.since },
      accessState: "available",
      accessDetail: "Connected to telemetry Postgres.",
      result,
    });
    return { report, exitCode: 0 };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const report = buildUsageReport({
      generatedAt: new Date().toISOString(),
      filters: { repo: options.repo, since: options.since },
      accessState: "unavailable",
      accessDetail: message,
      result: null,
    });
    return { report, exitCode: 0 };
  } finally {
    await client?.close();
  }
}

if (import.meta.main) {
  const { report, exitCode } = await runUsageReportCli(process.argv.slice(2));
  const options = parseUsageReportArgs(process.argv.slice(2));
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else if (options.csv) {
    console.log(renderUsageReportCsv(report));
  } else {
    console.log(renderUsageReportText(report));
  }
  process.exit(exitCode);
}
