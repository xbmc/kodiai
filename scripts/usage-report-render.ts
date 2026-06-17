import type {
  UsageDeliveryRow,
  UsagePromptSectionRow,
  UsageRateLimitRow,
  UsageReport,
  UsageReuseEvidenceRow,
  UsageReviewCacheTelemetryRow,
  UsageSectionBudgetRow,
  UsageTaskTypeRow,
} from "./usage-report.ts";

function formatNumber(value: number): string {
  return value.toLocaleString();
}

function formatCurrency(value: number): string {
  return `$${value.toFixed(4)}`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

type UsageReportSectionSpec<T> = {
  title: string;
  emptyText: string;
  csvLabel: string;
  rows: (report: UsageReport) => readonly T[];
  note?: (report: UsageReport) => string | null;
  line: (row: T) => string;
  csvKey: (row: T) => string;
};

type RenderableUsageReportSection = {
  textLines: (report: UsageReport) => string[];
  csvLines: (report: UsageReport) => string[];
};

function defineUsageReportSection<T>(spec: UsageReportSectionSpec<T>): RenderableUsageReportSection {
  return {
    textLines: (report) => {
      const lines = ["", spec.title];
      const note = spec.note?.(report) ?? null;
      if (note) lines.push(`- ${note}`);
      const rows = spec.rows(report);
      if (rows.length === 0) {
        lines.push(`- ${spec.emptyText}`);
      } else {
        for (const row of rows) lines.push(`- ${spec.line(row)}`);
      }
      return lines;
    },
    csvLines: (report) => {
      const lines: string[] = [];
      for (const row of spec.rows(report)) {
        lines.push(`${spec.csvLabel},${JSON.stringify(spec.csvKey(row))},${JSON.stringify(row)}`);
      }
      const note = spec.note?.(report) ?? null;
      if (note) lines.push(`${spec.csvLabel}_note,note,${JSON.stringify(note)}`);
      return lines;
    },
  };
}

const USAGE_REPORT_SECTIONS: readonly RenderableUsageReportSection[] = [
  defineUsageReportSection<UsageTaskTypeRow>({
    title: "Task-path attribution",
    emptyText: "No llm_cost_events rows matched the requested filters.",
    csvLabel: "task_type",
    rows: (report) => report.taskTypes,
    csvKey: (row) => row.taskType,
    line: (row) =>
      `${row.taskType}: executions=${row.executions} tokens=${formatNumber(row.totalTokens)} cost=${formatCurrency(row.totalCostUsd)} cache_read=${formatNumber(row.cacheReadTokens)} cache_write=${formatNumber(row.cacheWriteTokens)} cache_effectiveness=${formatPercent(row.cacheEffectiveness)}`,
  }),
  defineUsageReportSection<UsageDeliveryRow>({
    title: "Delivery breakdown",
    emptyText: "No delivery-level attribution rows matched the requested filters.",
    csvLabel: "delivery",
    rows: (report) => report.deliveryBreakdown,
    csvKey: (row) => row.deliveryId,
    line: (row) =>
      `${row.deliveryId} ${row.taskType} repo=${row.repo} prompt_kinds=${row.promptKinds.join(", ")} sections=${row.sectionCount} prompt_tokens=${row.promptEstimatedTokens} input=${row.llmInputTokens} output=${row.llmOutputTokens} cache_read=${row.cacheReadTokens} cache_write=${row.cacheWriteTokens} cost=${formatCurrency(row.estimatedCostUsd)}`,
  }),
  defineUsageReportSection<UsagePromptSectionRow>({
    title: "Prompt-section summaries",
    emptyText: "No prompt_section_events rows matched the requested filters.",
    csvLabel: "prompt_section",
    rows: (report) => report.promptSections,
    csvKey: (row) => `${row.taskType}/${row.promptKind}/${row.sectionName}`,
    line: (row) =>
      `${row.taskType} / ${row.promptKind} / ${row.sectionName}: executions=${row.executions} estimated_tokens=${row.totalEstimatedTokens} chars=${row.totalCharCount} truncated=${row.truncatedExecutions}`,
  }),
  defineUsageReportSection<UsageSectionBudgetRow>({
    title: "Section budget distribution",
    emptyText: "No budgeted prompt_section_events rows matched the requested filters.",
    csvLabel: "section_budget",
    rows: (report) => report.sectionBudget?.rows ?? [],
    note: (report) => report.sectionBudget?.note ?? null,
    csvKey: (row) => `${row.taskType}/${row.sectionName}`,
    line: (row) =>
      `${row.taskType} / ${row.sectionName}: executions=${row.executions} budget_chars=${formatNumber(row.budgetChars)} included_chars(avg/p50/p90/max)=${formatNumber(row.avgIncludedChars)}/${formatNumber(row.p50IncludedChars)}/${formatNumber(row.p90IncludedChars)}/${formatNumber(row.maxIncludedChars)} included_tokens(avg/p90)=${formatNumber(row.avgIncludedTokens)}/${formatNumber(row.p90IncludedTokens)} trimmed=${row.trimmedExecutions} (${formatPercent(row.trimmedRate)}) p90_utilization=${formatPercent(row.budgetUtilizationP90)}`,
  }),
  defineUsageReportSection<UsageReuseEvidenceRow>({
    title: "Reuse evidence",
    emptyText: "No reuse evidence rows matched the requested filters.",
    csvLabel: "reuse_evidence",
    rows: (report) => report.reuseEvidence,
    csvKey: (row) => row.evidenceType,
    line: (row) =>
      `${row.evidenceType}: executions=${row.executions} hits=${row.hitExecutions} misses=${row.missExecutions} degraded=${row.degradedExecutions} bypass=${row.bypassExecutions} reused_units=${row.reusedUnits} primary_work_units=${row.primaryWorkUnits} avg_reuse_rate=${formatPercent(row.avgReuseRate)} statuses=${row.statuses.join(", ") || "none"}`,
  }),
  defineUsageReportSection<UsageReviewCacheTelemetryRow>({
    title: "Review cache telemetry",
    emptyText: "No review_cache_events rows matched the requested filters.",
    csvLabel: "review_cache_telemetry",
    rows: (report) => report.reviewCacheTelemetry?.rows ?? [],
    note: (report) => report.reviewCacheTelemetry?.note ?? null,
    csvKey: (row) => `${row.cacheSurface}/${row.status}/${row.reason}`,
    line: (row) => {
      const signalBits = [
        row.fingerprintVersions.length > 0 ? `fingerprint_versions=${row.fingerprintVersions.join(",")}` : "fingerprint_versions=none",
        row.safetySignalNames.length > 0 ? `safety_signals=${row.safetySignalNames.join(",")}` : "safety_signals=none",
        row.missingSignalNames.length > 0 ? `missing_signals=${row.missingSignalNames.join(",")}` : "missing_signals=none",
        row.invalidationSignalNames.length > 0 ? `invalidation_signals=${row.invalidationSignalNames.join(",")}` : "invalidation_signals=none",
      ].join(" ");
      return `${row.cacheSurface} status=${row.status} reason=${row.reason}: executions=${row.executions} deliveries=${row.distinctDeliveries} prs=${row.affectedPrs} bookkeeping_errors=${row.bookkeepingErrorCount} ${signalBits}`;
    },
  }),
  defineUsageReportSection<UsageRateLimitRow>({
    title: "Cache effectiveness",
    emptyText: "No rate_limit_events rows matched the requested filters.",
    csvLabel: "rate_limit",
    rows: (report) => report.rateLimits,
    csvKey: (row) => row.taskType,
    line: (row) =>
      `${row.taskType}: executions=${row.executions} avg_cache_hit_rate=${formatPercent(row.avgCacheHitRate)} skipped_queries=${row.totalSkippedQueries} degraded=${row.degradationCount}`,
  }),
];

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
  );

  for (const section of USAGE_REPORT_SECTIONS) {
    lines.push(...section.textLines(report));
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

  for (const section of USAGE_REPORT_SECTIONS) {
    lines.push(...section.csvLines(report));
  }

  return lines.join("\n");
}
