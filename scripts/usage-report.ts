import { parseArgs } from "node:util";
import {
  REVIEW_CACHE_TELEMETRY_REASONS,
  REVIEW_CACHE_TELEMETRY_STATUSES,
  REVIEW_CACHE_TELEMETRY_SURFACES,
  type ReviewCacheTelemetryReason,
  type ReviewCacheTelemetryStatus,
  type ReviewCacheTelemetrySurface,
} from "../src/review-cache-telemetry/cache-telemetry.ts";
import type { Sql } from "../src/db/client.ts";

type AccessState = "available" | "missing" | "unavailable";

type CliOptions = {
  since: string | null;
  repo: string | null;
  deliveryId: string | null;
  json: boolean;
  csv: boolean;
  help: boolean;
};

export const USAGE_REPORT_QUERY_TIMEOUT_MS = 5_000;

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

export type UsageSectionBudgetRow = {
  taskType: string;
  sectionName: string;
  executions: number;
  budgetChars: number;
  budgetTokens: number;
  avgIncludedChars: number;
  p50IncludedChars: number;
  p90IncludedChars: number;
  maxIncludedChars: number;
  avgIncludedTokens: number;
  p90IncludedTokens: number;
  trimmedExecutions: number;
  trimmedRate: number;
  budgetUtilizationP90: number;
};

export type UsageSectionBudgetResult = {
  rows: UsageSectionBudgetRow[];
  note: string | null;
};

export type UsageRateLimitRow = {
  taskType: string;
  executions: number;
  avgCacheHitRate: number;
  totalSkippedQueries: number;
  degradationCount: number;
};

export type UsageReuseEvidenceRow = {
  evidenceType: string;
  executions: number;
  hitExecutions: number;
  missExecutions: number;
  degradedExecutions: number;
  bypassExecutions: number;
  reusedUnits: number;
  primaryWorkUnits: number;
  avgReuseRate: number;
  statuses: string[];
};


export type UsageReviewCacheTelemetryRow = {
  cacheSurface: ReviewCacheTelemetrySurface;
  status: ReviewCacheTelemetryStatus;
  reason: ReviewCacheTelemetryReason | "none";
  executions: number;
  distinctDeliveries: number;
  affectedPrs: number;
  fingerprintVersions: string[];
  safetySignalNames: string[];
  missingSignalNames: string[];
  invalidationSignalNames: string[];
  bookkeepingErrorCount: number;
};

export type UsageReviewCacheTelemetryResult = {
  rows: UsageReviewCacheTelemetryRow[];
  note: string | null;
};

export type UsageReportQueryResult = {
  summary: UsageReportSummary;
  taskTypes: UsageTaskTypeRow[];
  deliveryBreakdown: UsageDeliveryRow[];
  promptSections: UsagePromptSectionRow[];
  sectionBudget?: UsageSectionBudgetResult;
  rateLimits: UsageRateLimitRow[];
  reuseEvidence: UsageReuseEvidenceRow[];
  reviewCacheTelemetry?: UsageReviewCacheTelemetryResult;
};

export type UsageReport = {
  command: "report";
  generatedAt: string;
  filters: {
    since: string | null;
    repo: string | null;
    deliveryId?: string | null;
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
  sectionBudget?: UsageSectionBudgetResult;
  rateLimits: UsageRateLimitRow[];
  reuseEvidence: UsageReuseEvidenceRow[];
  reviewCacheTelemetry?: UsageReviewCacheTelemetryResult;
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
  filters: { since: string | null; repo: string | null; deliveryId?: string | null };
  accessState: AccessState;
  accessDetail: string;
  result: UsageReportQueryResult | null;
}): UsageReport {
  const result = input.result ?? {
    summary: emptySummary(),
    taskTypes: [],
    deliveryBreakdown: [],
    promptSections: [],
    sectionBudget: { rows: [], note: null },
    rateLimits: [],
    reuseEvidence: [],
    reviewCacheTelemetry: { rows: [], note: null },
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
    sectionBudget: result.sectionBudget ?? { rows: [], note: null },
    rateLimits: result.rateLimits,
    reuseEvidence: result.reuseEvidence,
    reviewCacheTelemetry: result.reviewCacheTelemetry ?? { rows: [], note: null },
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

  if (report.filters.since || report.filters.repo || report.filters.deliveryId) {
    lines.push(
      `Filters: since=${report.filters.since ?? "none"} repo=${report.filters.repo ?? "none"} delivery=${report.filters.deliveryId ?? "none"}`,
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

  const sectionBudget = report.sectionBudget ?? { rows: [], note: null };
  lines.push("", "Section budget distribution");
  if (sectionBudget.note) {
    lines.push(`- ${sectionBudget.note}`);
  }
  if (sectionBudget.rows.length === 0) {
    lines.push("- No budgeted prompt_section_events rows matched the requested filters.");
  } else {
    for (const row of sectionBudget.rows) {
      lines.push(
        `- ${row.taskType} / ${row.sectionName}: executions=${row.executions} budget_chars=${formatNumber(row.budgetChars)} included_chars(avg/p50/p90/max)=${formatNumber(row.avgIncludedChars)}/${formatNumber(row.p50IncludedChars)}/${formatNumber(row.p90IncludedChars)}/${formatNumber(row.maxIncludedChars)} included_tokens(avg/p90)=${formatNumber(row.avgIncludedTokens)}/${formatNumber(row.p90IncludedTokens)} trimmed=${row.trimmedExecutions} (${formatPercent(row.trimmedRate)}) p90_utilization=${formatPercent(row.budgetUtilizationP90)}`,
      );
    }
  }

  lines.push("", "Reuse evidence");
  if (report.reuseEvidence.length === 0) {
    lines.push("- No reuse evidence rows matched the requested filters.");
  } else {
    for (const row of report.reuseEvidence) {
      lines.push(
        `- ${row.evidenceType}: executions=${row.executions} hits=${row.hitExecutions} misses=${row.missExecutions} degraded=${row.degradedExecutions} bypass=${row.bypassExecutions} reused_units=${row.reusedUnits} primary_work_units=${row.primaryWorkUnits} avg_reuse_rate=${formatPercent(row.avgReuseRate)} statuses=${row.statuses.join(", ") || "none"}`,
      );
    }
  }

  const reviewCacheTelemetry = report.reviewCacheTelemetry ?? { rows: [], note: null };
  lines.push("", "Review cache telemetry");
  if (reviewCacheTelemetry.note) {
    lines.push(`- ${reviewCacheTelemetry.note}`);
  }
  if (reviewCacheTelemetry.rows.length === 0) {
    lines.push("- No review_cache_events rows matched the requested filters.");
  } else {
    for (const row of reviewCacheTelemetry.rows) {
      const signalBits = [
        row.fingerprintVersions.length > 0 ? `fingerprint_versions=${row.fingerprintVersions.join(",")}` : "fingerprint_versions=none",
        row.safetySignalNames.length > 0 ? `safety_signals=${row.safetySignalNames.join(",")}` : "safety_signals=none",
        row.missingSignalNames.length > 0 ? `missing_signals=${row.missingSignalNames.join(",")}` : "missing_signals=none",
        row.invalidationSignalNames.length > 0 ? `invalidation_signals=${row.invalidationSignalNames.join(",")}` : "invalidation_signals=none",
      ].join(" ");
      lines.push(
        `- ${row.cacheSurface} status=${row.status} reason=${row.reason}: executions=${row.executions} deliveries=${row.distinctDeliveries} prs=${row.affectedPrs} bookkeeping_errors=${row.bookkeepingErrorCount} ${signalBits}`,
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
  const sectionBudget = report.sectionBudget ?? { rows: [], note: null };
  for (const row of sectionBudget.rows) {
    lines.push(`section_budget,${JSON.stringify(`${row.taskType}/${row.sectionName}`)},${JSON.stringify(row)}`);
  }
  if (sectionBudget.note) {
    lines.push(`section_budget_note,note,${JSON.stringify(sectionBudget.note)}`);
  }
  for (const row of report.reuseEvidence) {
    lines.push(`reuse_evidence,${JSON.stringify(row.evidenceType)},${JSON.stringify(row)}`);
  }
  const reviewCacheTelemetry = report.reviewCacheTelemetry ?? { rows: [], note: null };
  for (const row of reviewCacheTelemetry.rows) {
    lines.push(`review_cache_telemetry,${JSON.stringify(`${row.cacheSurface}/${row.status}/${row.reason}`)},${JSON.stringify(row)}`);
  }
  if (reviewCacheTelemetry.note) {
    lines.push(`review_cache_telemetry_note,note,${JSON.stringify(reviewCacheTelemetry.note)}`);
  }
  for (const row of report.rateLimits) {
    lines.push(`rate_limit,${JSON.stringify(row.taskType)},${JSON.stringify(row)}`);
  }

  return lines.join("\n");
}

async function fetchSummary(sql: Sql, repo: string | null, since: string | null, deliveryId: string | null): Promise<UsageReportSummary> {
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
      AND (${deliveryId}::text IS NULL OR delivery_id = ${deliveryId})
      AND (${since}::timestamptz IS NULL OR created_at >= ${since}::timestamptz)
  `;
  return rows[0] ?? emptySummary();
}

async function fetchTaskTypes(sql: Sql, repo: string | null, since: string | null, deliveryId: string | null): Promise<UsageTaskTypeRow[]> {
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
      AND (${deliveryId}::text IS NULL OR delivery_id = ${deliveryId})
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

async function fetchDeliveryBreakdown(sql: Sql, repo: string | null, since: string | null, deliveryId: string | null): Promise<UsageDeliveryRow[]> {
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
      AND (${deliveryId}::text IS NULL OR l.delivery_id = ${deliveryId})
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

async function fetchPromptSections(sql: Sql, repo: string | null, since: string | null, deliveryId: string | null): Promise<UsagePromptSectionRow[]> {
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
      AND (${deliveryId}::text IS NULL OR delivery_id = ${deliveryId})
      AND (${since}::timestamptz IS NULL OR created_at >= ${since}::timestamptz)
    GROUP BY task_type, prompt_kind, section_name
    ORDER BY "totalEstimatedTokens" DESC, task_type ASC, prompt_kind ASC, section_name ASC
    LIMIT 30
  `;
  return rows;
}

function isMissingBudgetColumnError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "42703";
}

async function fetchSectionBudgetDistribution(sql: Sql, repo: string | null, since: string | null, deliveryId: string | null): Promise<UsageSectionBudgetResult> {
  try {
    const rows = await sql<Array<Omit<UsageSectionBudgetRow, "trimmedRate" | "budgetUtilizationP90">>>`
      SELECT
        task_type AS "taskType",
        section_name AS "sectionName",
        COUNT(*)::int AS executions,
        COALESCE(MAX(budget_chars), 0)::int AS "budgetChars",
        COALESCE(MAX(budget_tokens), 0)::int AS "budgetTokens",
        COALESCE(AVG(included_chars), 0)::float8 AS "avgIncludedChars",
        COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY included_chars), 0)::float8 AS "p50IncludedChars",
        COALESCE(percentile_cont(0.9) WITHIN GROUP (ORDER BY included_chars), 0)::float8 AS "p90IncludedChars",
        COALESCE(MAX(included_chars), 0)::int AS "maxIncludedChars",
        COALESCE(AVG(included_tokens), 0)::float8 AS "avgIncludedTokens",
        COALESCE(percentile_cont(0.9) WITHIN GROUP (ORDER BY included_tokens), 0)::float8 AS "p90IncludedTokens",
        COALESCE(SUM(CASE WHEN budget_status = 'trimmed' THEN 1 ELSE 0 END), 0)::int AS "trimmedExecutions"
      FROM prompt_section_events
      WHERE budget_chars IS NOT NULL
        AND (${repo}::text IS NULL OR repo = ${repo})
        AND (${deliveryId}::text IS NULL OR delivery_id = ${deliveryId})
        AND (${since}::timestamptz IS NULL OR created_at >= ${since}::timestamptz)
      GROUP BY task_type, section_name
      ORDER BY "budgetChars" DESC, executions DESC, task_type ASC, section_name ASC
      LIMIT 30
    `;

    return {
      note: null,
      rows: rows.map((row) => ({
        taskType: row.taskType,
        sectionName: row.sectionName,
        executions: row.executions,
        budgetChars: row.budgetChars,
        budgetTokens: row.budgetTokens,
        avgIncludedChars: Math.round(row.avgIncludedChars),
        p50IncludedChars: Math.round(row.p50IncludedChars),
        p90IncludedChars: Math.round(row.p90IncludedChars),
        maxIncludedChars: row.maxIncludedChars,
        avgIncludedTokens: Math.round(row.avgIncludedTokens),
        p90IncludedTokens: Math.round(row.p90IncludedTokens),
        trimmedExecutions: row.trimmedExecutions,
        trimmedRate: row.executions > 0 ? roundRatio(row.trimmedExecutions / row.executions) : 0,
        budgetUtilizationP90: row.budgetChars > 0 ? roundRatio(row.p90IncludedChars / row.budgetChars) : 0,
      })),
    };
  } catch (error) {
    if (isMissingBudgetColumnError(error)) {
      return { rows: [], note: "prompt_section_events budget columns are not available; section budget distribution failed open without blocking the usage report." };
    }
    throw error;
  }
}

async function fetchRateLimits(sql: Sql, repo: string | null, since: string | null, deliveryId: string | null): Promise<UsageRateLimitRow[]> {
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
      AND (${deliveryId}::text IS NULL OR r.delivery_id = ${deliveryId})
      AND (${since}::timestamptz IS NULL OR r.created_at >= ${since}::timestamptz)
      AND r.event_type NOT LIKE 'reuse.%'
    GROUP BY COALESCE(l.task_type, r.event_type)
    ORDER BY executions DESC, "taskType" ASC
  `;

  return rows.map((row) => ({
    ...row,
    avgCacheHitRate: roundRatio(row.avgCacheHitRate),
  }));
}

async function fetchReuseEvidence(sql: Sql, repo: string | null, since: string | null, deliveryId: string | null): Promise<UsageReuseEvidenceRow[]> {
  const rows = await sql<UsageReuseEvidenceRow[]>`
    SELECT
      CASE
        WHEN r.event_type LIKE 'reuse.retrieval-query-embedding%' THEN 'retrieval.query-embedding'
        WHEN r.event_type = 'reuse.mention-derived-context' THEN 'mention.derived-context'
        WHEN r.event_type = 'reuse.review-derived-prompt' THEN 'review.derived-prompt'
        ELSE r.event_type
      END AS "evidenceType",
      COUNT(*)::int AS executions,
      COALESCE(SUM(CASE WHEN split_part(COALESCE(r.degradation_path, 'unknown'), ':', 1) = 'hit' THEN 1 ELSE 0 END), 0)::int AS "hitExecutions",
      COALESCE(SUM(CASE WHEN split_part(COALESCE(r.degradation_path, 'unknown'), ':', 1) = 'miss' THEN 1 ELSE 0 END), 0)::int AS "missExecutions",
      COALESCE(SUM(CASE WHEN split_part(COALESCE(r.degradation_path, 'unknown'), ':', 1) = 'degraded' THEN 1 ELSE 0 END), 0)::int AS "degradedExecutions",
      COALESCE(SUM(CASE WHEN split_part(COALESCE(r.degradation_path, 'unknown'), ':', 1) = 'bypass' THEN 1 ELSE 0 END), 0)::int AS "bypassExecutions",
      COALESCE(SUM(r.skipped_queries), 0)::int AS "reusedUnits",
      COALESCE(SUM(r.retry_attempts), 0)::int AS "primaryWorkUnits",
      COALESCE(AVG(r.cache_hit_rate), 0)::float8 AS "avgReuseRate",
      COALESCE(array_remove(array_agg(DISTINCT split_part(COALESCE(r.degradation_path, 'unknown'), ':', 1)), NULL), ARRAY[]::text[]) AS statuses
    FROM rate_limit_events r
    WHERE (${repo}::text IS NULL OR r.repo = ${repo})
      AND (${deliveryId}::text IS NULL OR r.delivery_id = ${deliveryId})
      AND (${since}::timestamptz IS NULL OR r.created_at >= ${since}::timestamptz)
      AND r.event_type LIKE 'reuse.%'
    GROUP BY 1
    ORDER BY 1 ASC
  `;

  return rows.map((row) => ({
    ...row,
    avgReuseRate: roundRatio(row.avgReuseRate),
    statuses: [...row.statuses].sort(),
  }));
}

function isMissingReviewCacheTableError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "42P01";
}

function boundedArray(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values.filter((value): value is string => typeof value === "string" && value.length > 0).sort((a, b) => a.localeCompare(b));
}

async function fetchReviewCacheTelemetry(sql: Sql, repo: string | null, since: string | null, deliveryId: string | null): Promise<UsageReviewCacheTelemetryResult> {
  try {
    const rows = await sql<UsageReviewCacheTelemetryRow[]>`
      WITH filtered AS (
        SELECT
          cache_surface,
          status,
          COALESCE(reason, 'none') AS reason,
          delivery_id,
          pr_number,
          fingerprint_version,
          safety_signal_names,
          missing_signal_names,
          invalidation_signal_names,
          bookkeeping_error_count
        FROM review_cache_events
        WHERE (${repo}::text IS NULL OR repo = ${repo})
          AND (${deliveryId}::text IS NULL OR delivery_id = ${deliveryId})
          AND (${since}::timestamptz IS NULL OR created_at >= ${since}::timestamptz)
      ), grouped AS (
        SELECT
          cache_surface AS "cacheSurface",
          status,
          reason,
          COUNT(*)::int AS executions,
          COUNT(DISTINCT delivery_id)::int AS "distinctDeliveries",
          COUNT(DISTINCT pr_number)::int AS "affectedPrs",
          COALESCE(array_remove(array_agg(DISTINCT fingerprint_version), NULL), ARRAY[]::text[]) AS "fingerprintVersions",
          COALESCE(SUM(bookkeeping_error_count), 0)::int AS "bookkeepingErrorCount"
        FROM filtered
        GROUP BY cache_surface, status, reason
      )
      SELECT
        g."cacheSurface",
        g.status,
        g.reason,
        g.executions,
        g."distinctDeliveries",
        g."affectedPrs",
        g."fingerprintVersions",
        ARRAY(
          SELECT DISTINCT signal
          FROM filtered f, unnest(f.safety_signal_names) AS signal
          WHERE f.cache_surface = g."cacheSurface" AND f.status = g.status AND f.reason = g.reason
          ORDER BY signal
        ) AS "safetySignalNames",
        ARRAY(
          SELECT DISTINCT signal
          FROM filtered f, unnest(f.missing_signal_names) AS signal
          WHERE f.cache_surface = g."cacheSurface" AND f.status = g.status AND f.reason = g.reason
          ORDER BY signal
        ) AS "missingSignalNames",
        ARRAY(
          SELECT DISTINCT signal
          FROM filtered f, unnest(f.invalidation_signal_names) AS signal
          WHERE f.cache_surface = g."cacheSurface" AND f.status = g.status AND f.reason = g.reason
          ORDER BY signal
        ) AS "invalidationSignalNames",
        g."bookkeepingErrorCount"
      FROM grouped g
      ORDER BY g."cacheSurface" ASC, g.status ASC, g.reason ASC
    `;

    const allowedSurfaces = new Set<string>(REVIEW_CACHE_TELEMETRY_SURFACES);
    const allowedStatuses = new Set<string>(REVIEW_CACHE_TELEMETRY_STATUSES);
    const allowedReasons = new Set<string>([...REVIEW_CACHE_TELEMETRY_REASONS, "none"]);
    return {
      note: null,
      rows: rows
        .filter((row) => allowedSurfaces.has(row.cacheSurface) && allowedStatuses.has(row.status) && allowedReasons.has(row.reason))
        .map((row) => ({
          ...row,
          fingerprintVersions: boundedArray(row.fingerprintVersions),
          safetySignalNames: boundedArray(row.safetySignalNames),
          missingSignalNames: boundedArray(row.missingSignalNames),
          invalidationSignalNames: boundedArray(row.invalidationSignalNames),
        })),
    };
  } catch (error) {
    if (isMissingReviewCacheTableError(error)) {
      return { rows: [], note: "review_cache_events table is not available; cache telemetry section failed open without blocking the usage report." };
    }
    throw error;
  }
}

export async function queryUsageReport(sql: Sql, filters: { repo: string | null; since: string | null; deliveryId?: string | null }): Promise<UsageReportQueryResult> {
  const deliveryId = filters.deliveryId ?? null;
  const [summary, taskTypes, deliveryBreakdown, promptSections, sectionBudget, rateLimits, reuseEvidence, reviewCacheTelemetry] = await Promise.all([
    fetchSummary(sql, filters.repo, filters.since, deliveryId),
    fetchTaskTypes(sql, filters.repo, filters.since, deliveryId),
    fetchDeliveryBreakdown(sql, filters.repo, filters.since, deliveryId),
    fetchPromptSections(sql, filters.repo, filters.since, deliveryId),
    fetchSectionBudgetDistribution(sql, filters.repo, filters.since, deliveryId),
    fetchRateLimits(sql, filters.repo, filters.since, deliveryId),
    fetchReuseEvidence(sql, filters.repo, filters.since, deliveryId),
    fetchReviewCacheTelemetry(sql, filters.repo, filters.since, deliveryId),
  ]);

  return {
    summary,
    taskTypes,
    deliveryBreakdown,
    promptSections,
    sectionBudget,
    rateLimits,
    reuseEvidence,
    reviewCacheTelemetry,
  };
}

export async function queryUsageReportWithTimeout(
  sql: Sql,
  filters: { repo: string | null; since: string | null; deliveryId?: string | null },
  timeoutMs = USAGE_REPORT_QUERY_TIMEOUT_MS,
): Promise<UsageReportQueryResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      queryUsageReport(sql, filters),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Timed out querying telemetry Postgres after ${timeoutMs}ms.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
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
      delivery: { type: "string" },
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
    deliveryId: parsed.values.delivery ?? null,
    json: parsed.values.json ?? false,
    csv: parsed.values.csv ?? false,
    help: parsed.values.help ?? false,
  };
}

function printUsage(): void {
  console.log(`Kodiai telemetry usage report\n\nUsage:\n  bun scripts/usage-report.ts [--repo <owner/repo>] [--delivery <delivery-id>] [--since <Nd|YYYY-MM-DD|ISO>] [--json|--csv]\n\nNotes:\n  - Reads live Postgres telemetry through createDbClient()\n  - Fails open with explicit database access status when Postgres is unavailable\n  - Surfaces token totals, cost totals, cache effectiveness, task-path attribution, prompt-section summaries, per-section budget distribution (included-token percentiles + trim rate vs the budget cap), reuse evidence, and review cache telemetry`);
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
        filters: { repo: options.repo, since: options.since, deliveryId: options.deliveryId },
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
      filters: { repo: options.repo, since: options.since, deliveryId: options.deliveryId },
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
    const result = await queryUsageReportWithTimeout(client.sql, {
      repo: options.repo,
      since: options.since,
      deliveryId: options.deliveryId,
    });

    const report = buildUsageReport({
      generatedAt: new Date().toISOString(),
      filters: { repo: options.repo, since: options.since, deliveryId: options.deliveryId },
      accessState: "available",
      accessDetail: "Connected to telemetry Postgres.",
      result,
    });
    return { report, exitCode: 0 };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const report = buildUsageReport({
      generatedAt: new Date().toISOString(),
      filters: { repo: options.repo, since: options.since, deliveryId: options.deliveryId },
      accessState: "unavailable",
      accessDetail: message,
      result: null,
    });
    return { report, exitCode: 0 };
  } finally {
    await client?.sql.end({ timeout: 0 });
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
