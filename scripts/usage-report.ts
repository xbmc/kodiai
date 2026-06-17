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
import { renderUsageReportCsv, renderUsageReportText } from "./usage-report-render.ts";

export { renderUsageReportCsv, renderUsageReportText };

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
const REVIEW_CACHE_SIGNAL_ARRAY_LIMIT = 50;

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

type UsageFilters = {
  repo: string | null;
  since: string | null;
  deliveryId: string | null;
};

type UsageSqlParam = string | number | boolean | null;

function usageColumn(alias: string | null, column: "repo" | "delivery_id" | "created_at"): string {
  return alias ? `${alias}.${column}` : column;
}

function addUsagePredicates(params: UsageSqlParam[], filters: UsageFilters, alias: string | null): string[] {
  const predicates: string[] = [];
  if (filters.repo) {
    params.push(filters.repo);
    predicates.push(`${usageColumn(alias, "repo")} = $${params.length}`);
  }
  if (filters.deliveryId) {
    params.push(filters.deliveryId);
    predicates.push(`${usageColumn(alias, "delivery_id")} = $${params.length}`);
  }
  if (filters.since) {
    params.push(filters.since);
    predicates.push(`${usageColumn(alias, "created_at")} >= $${params.length}::timestamptz`);
  }
  return predicates;
}

function buildUsageWhere(filters: UsageFilters, alias: string | null, extraPredicates: string[] = []): { text: string; params: UsageSqlParam[] } {
  const params: UsageSqlParam[] = [];
  const predicates = [...extraPredicates, ...addUsagePredicates(params, filters, alias)];
  return {
    text: predicates.length > 0 ? `WHERE ${predicates.join("\n      AND ")}` : "",
    params,
  };
}

function buildUsageSinceJoin(params: UsageSqlParam[], since: string | null, alias: string): string {
  if (!since) return "";
  params.push(since);
  return `AND ${usageColumn(alias, "created_at")} >= $${params.length}::timestamptz`;
}

async function fetchSummary(sql: Sql, repo: string | null, since: string | null, deliveryId: string | null): Promise<UsageReportSummary> {
  const filters = buildUsageWhere({ repo, since, deliveryId }, null);
  const rows = await sql.unsafe(
    `
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
    ${filters.text}
    `,
    filters.params,
  ) as UsageReportSummary[];
  return rows[0] ?? emptySummary();
}

async function fetchTaskTypes(sql: Sql, repo: string | null, since: string | null, deliveryId: string | null): Promise<UsageTaskTypeRow[]> {
  const filters = buildUsageWhere({ repo, since, deliveryId }, null);
  const rows = await sql.unsafe(
    `
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
    ${filters.text}
    GROUP BY task_type
    ORDER BY "totalCostUsd" DESC, task_type ASC
    `,
    filters.params,
  ) as UsageTaskTypeRow[];

  return rows.map((row) => ({
    ...row,
    totalCostUsd: roundCurrency(row.totalCostUsd),
    cacheEffectiveness: roundRatio(row.cacheEffectiveness),
  }));
}

async function fetchDeliveryBreakdown(sql: Sql, repo: string | null, since: string | null, deliveryId: string | null): Promise<UsageDeliveryRow[]> {
  const params: UsageSqlParam[] = [];
  const promptSinceJoin = buildUsageSinceJoin(params, since, "p");
  const wherePredicates = ["l.delivery_id IS NOT NULL", ...addUsagePredicates(params, { repo, since, deliveryId }, "l")];
  const rows = await sql.unsafe(
    `
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
     ${promptSinceJoin}
    WHERE ${wherePredicates.join("\n      AND ")}
    GROUP BY l.delivery_id, l.repo, l.task_type
    ORDER BY "estimatedCostUsd" DESC, l.delivery_id ASC
    LIMIT 20
    `,
    params,
  ) as UsageDeliveryRow[];

  return rows.map((row) => ({
    ...row,
    promptKinds: [...row.promptKinds].sort(),
    estimatedCostUsd: roundCurrency(row.estimatedCostUsd),
  }));
}

async function fetchPromptSections(sql: Sql, repo: string | null, since: string | null, deliveryId: string | null): Promise<UsagePromptSectionRow[]> {
  const filters = buildUsageWhere({ repo, since, deliveryId }, null);
  const rows = await sql.unsafe(
    `
    SELECT
      task_type AS "taskType",
      prompt_kind AS "promptKind",
      section_name AS "sectionName",
      COUNT(DISTINCT COALESCE(delivery_id, task_type || ':' || created_at::text))::int AS executions,
      COALESCE(SUM(estimated_tokens), 0)::int AS "totalEstimatedTokens",
      COALESCE(SUM(char_count), 0)::int AS "totalCharCount",
      COALESCE(SUM(CASE WHEN truncated THEN 1 ELSE 0 END), 0)::int AS "truncatedExecutions"
    FROM prompt_section_events
    ${filters.text}
    GROUP BY task_type, prompt_kind, section_name
    ORDER BY "totalEstimatedTokens" DESC, task_type ASC, prompt_kind ASC, section_name ASC
    LIMIT 30
    `,
    filters.params,
  ) as UsagePromptSectionRow[];
  return rows;
}

function isPostgresErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}

async function fetchSectionBudgetDistribution(sql: Sql, repo: string | null, since: string | null, deliveryId: string | null): Promise<UsageSectionBudgetResult> {
  try {
    const filters = buildUsageWhere({ repo, since, deliveryId }, null, ["budget_chars IS NOT NULL"]);
    const rows = await sql.unsafe(
      `
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
      ${filters.text}
      GROUP BY task_type, section_name
      ORDER BY "budgetChars" DESC, executions DESC, task_type ASC, section_name ASC
      LIMIT 30
      `,
      filters.params,
    ) as Array<Omit<UsageSectionBudgetRow, "trimmedRate" | "budgetUtilizationP90">>;

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
    if (isPostgresErrorCode(error, "42703")) {
      return { rows: [], note: "prompt_section_events budget columns are not available; section budget distribution failed open without blocking the usage report." };
    }
    throw error;
  }
}

async function fetchRateLimits(sql: Sql, repo: string | null, since: string | null, deliveryId: string | null): Promise<UsageRateLimitRow[]> {
  const params: UsageSqlParam[] = [];
  const llmSinceJoin = buildUsageSinceJoin(params, since, "l");
  const wherePredicates = [
    ...addUsagePredicates(params, { repo, since, deliveryId }, "r"),
    "r.event_type NOT LIKE 'reuse.%'",
  ];
  const rows = await sql.unsafe(
    `
    SELECT
      COALESCE(l.task_type, r.event_type) AS "taskType",
      COUNT(*)::int AS executions,
      COALESCE(AVG(r.cache_hit_rate), 0)::float8 AS "avgCacheHitRate",
      COALESCE(SUM(r.skipped_queries), 0)::int AS "totalSkippedQueries",
      COALESCE(SUM(CASE WHEN LOWER(COALESCE(r.degradation_path, 'none')) <> 'none' THEN 1 ELSE 0 END), 0)::int AS "degradationCount"
    FROM rate_limit_events r
    LEFT JOIN llm_cost_events l
      ON l.delivery_id = r.delivery_id
     ${llmSinceJoin}
    WHERE ${wherePredicates.join("\n      AND ")}
    GROUP BY COALESCE(l.task_type, r.event_type)
    ORDER BY executions DESC, "taskType" ASC
    `,
    params,
  ) as UsageRateLimitRow[];

  return rows.map((row) => ({
    ...row,
    avgCacheHitRate: roundRatio(row.avgCacheHitRate),
  }));
}

async function fetchReuseEvidence(sql: Sql, repo: string | null, since: string | null, deliveryId: string | null): Promise<UsageReuseEvidenceRow[]> {
  const filters = buildUsageWhere({ repo, since, deliveryId }, "r", ["r.event_type LIKE 'reuse.%'"]);
  const rows = await sql.unsafe(
    `
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
    ${filters.text}
    GROUP BY 1
    ORDER BY 1 ASC
    `,
    filters.params,
  ) as UsageReuseEvidenceRow[];

  return rows.map((row) => ({
    ...row,
    avgReuseRate: roundRatio(row.avgReuseRate),
    statuses: [...row.statuses].sort(),
  }));
}

function boundedArray(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, REVIEW_CACHE_SIGNAL_ARRAY_LIMIT);
}

async function fetchReviewCacheTelemetry(sql: Sql, repo: string | null, since: string | null, deliveryId: string | null): Promise<UsageReviewCacheTelemetryResult> {
  try {
    const filters = buildUsageWhere({ repo, since, deliveryId }, null);
    const rows = await sql.unsafe(
      `
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
        ${filters.text}
          ${filters.text ? "AND" : "WHERE"} cache_surface = ANY($${filters.params.length + 1}::text[])
          AND status = ANY($${filters.params.length + 2}::text[])
          AND COALESCE(reason, 'none') = ANY($${filters.params.length + 3}::text[])
      ), grouped AS (
        SELECT
          cache_surface AS "cacheSurface",
          status,
          reason,
          COUNT(*)::int AS executions,
          COUNT(DISTINCT delivery_id)::int AS "distinctDeliveries",
          COUNT(DISTINCT pr_number)::int AS "affectedPrs",
          COALESCE(ARRAY(
            SELECT value
            FROM (
              SELECT DISTINCT fingerprint_version AS value
              FROM filtered f2
              WHERE f2.cache_surface = filtered.cache_surface
                AND f2.status = filtered.status
                AND f2.reason = filtered.reason
                AND f2.fingerprint_version IS NOT NULL
              ORDER BY value
              LIMIT $${filters.params.length + 4}::int
            ) capped
          ), ARRAY[]::text[]) AS "fingerprintVersions",
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
        COALESCE(ARRAY(
          SELECT signal
          FROM (
            SELECT DISTINCT signal
            FROM filtered f2, unnest(f2.safety_signal_names) AS signal
            WHERE f2.cache_surface = g."cacheSurface"
              AND f2.status = g.status
              AND f2.reason = g.reason
            ORDER BY signal
            LIMIT $${filters.params.length + 4}::int
          ) capped
        ), ARRAY[]::text[]) AS "safetySignalNames",
        COALESCE(ARRAY(
          SELECT signal
          FROM (
            SELECT DISTINCT signal
            FROM filtered f2, unnest(f2.missing_signal_names) AS signal
            WHERE f2.cache_surface = g."cacheSurface"
              AND f2.status = g.status
              AND f2.reason = g.reason
            ORDER BY signal
            LIMIT $${filters.params.length + 4}::int
          ) capped
        ), ARRAY[]::text[]) AS "missingSignalNames",
        COALESCE(ARRAY(
          SELECT signal
          FROM (
            SELECT DISTINCT signal
            FROM filtered f2, unnest(f2.invalidation_signal_names) AS signal
            WHERE f2.cache_surface = g."cacheSurface"
              AND f2.status = g.status
              AND f2.reason = g.reason
            ORDER BY signal
            LIMIT $${filters.params.length + 4}::int
          ) capped
        ), ARRAY[]::text[]) AS "invalidationSignalNames",
        g."bookkeepingErrorCount"
      FROM grouped g
      ORDER BY g."cacheSurface" ASC, g.status ASC, g.reason ASC
      `,
      [
        ...filters.params,
        REVIEW_CACHE_TELEMETRY_SURFACES,
        REVIEW_CACHE_TELEMETRY_STATUSES,
        [...REVIEW_CACHE_TELEMETRY_REASONS, "none"],
        REVIEW_CACHE_SIGNAL_ARRAY_LIMIT,
      ],
    ) as UsageReviewCacheTelemetryRow[];

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
    if (isPostgresErrorCode(error, "42P01")) {
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
  const boundedTimeoutMs = Math.max(1, Math.floor(timeoutMs));
  const runQuery = async () => {
    const begin = (sql as unknown as { begin?: Function }).begin;
    if (typeof begin !== "function") {
      return queryUsageReport(sql, filters);
    }

    return begin.call(sql, "read only", async (tx: Sql) => {
      await tx.unsafe("SELECT set_config('statement_timeout', $1, true)", [`${boundedTimeoutMs}ms`]);
      return queryUsageReport(tx, filters);
    }) as Promise<UsageReportQueryResult>;
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      runQuery(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Timed out querying telemetry Postgres after ${boundedTimeoutMs}ms.`));
        }, boundedTimeoutMs);
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
