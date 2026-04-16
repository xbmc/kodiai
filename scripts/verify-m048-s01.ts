import {
  discoverLogAnalyticsWorkspaceIds,
  queryReviewAuditLogs,
  type NormalizedLogAnalyticsRow,
} from "../src/review-audit/log-analytics.ts";
import {
  buildPhaseTimingEvidence,
  REVIEW_PHASE_TIMING_LOG_MESSAGE,
  type EvidenceAvailability,
  type PhaseTimingEvidence,
} from "../src/review-audit/phase-timing-evidence.ts";
import { parseReviewOutputKey } from "../src/handlers/review-idempotency.ts";
import type { ReviewPhaseTiming } from "../src/execution/types.ts";

const DEFAULT_TIMESPAN = "P14D";
const DEFAULT_QUERY_LIMIT = 20;
const DEFAULT_RESOURCE_GROUP = "rg-kodiai";

export type M048S01StatusCode =
  | "m048_s01_ok"
  | "m048_s01_skipped_missing_review_output_key"
  | "m048_s01_invalid_arg"
  | "m048_s01_azure_unavailable"
  | "m048_s01_no_matching_phase_timing"
  | "m048_s01_correlation_mismatch"
  | "m048_s01_invalid_phase_payload";

export type M048S01OutcomeClass = "success" | "timeout" | "timeout_partial" | "failure" | "unknown";

export type M048S01Outcome = {
  class: M048S01OutcomeClass;
  conclusion: string | null;
  published: boolean | null;
  summary: string;
};

export type M048S01Report = {
  command: "verify:m048:s01";
  generated_at: string;
  review_output_key: string | null;
  delivery_id: string | null;
  success: boolean;
  status_code: M048S01StatusCode;
  sourceAvailability: {
    azureLogs: EvidenceAvailability;
  };
  query: {
    text: string | null;
    timespan: string;
    workspaceCount: number;
    matchedRowCount: number;
    duplicateRowCount: number;
    driftedRowCount: number;
  };
  outcome: M048S01Outcome;
  evidence: PhaseTimingEvidence | null;
  issues: string[];
};

function normalizeIdentifier(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

export function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${Math.round(durationMs)}ms`;
  }

  if (durationMs < 10_000) {
    return `${(durationMs / 1000).toFixed(1)}s`;
  }

  if (durationMs < 60_000) {
    return `${Math.round(durationMs / 1000)}s`;
  }

  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function formatPhaseLine(phase: ReviewPhaseTiming): string {
  if (phase.status === "unavailable") {
    return `- ${phase.name}: unavailable${phase.detail ? ` (${phase.detail})` : ""}`;
  }

  const durationText = typeof phase.durationMs === "number" ? formatDuration(phase.durationMs) : "unavailable";
  if (phase.status === "degraded") {
    return `- ${phase.name}: ${durationText}${phase.detail ? ` (degraded: ${phase.detail})` : " (degraded)"}`;
  }

  return `- ${phase.name}: ${durationText}`;
}

function readOptionValue(args: string[], index: number): { value: string | null; consumed: boolean } {
  const candidate = args[index + 1];
  if (typeof candidate !== "string" || candidate.startsWith("--")) {
    return {
      value: null,
      consumed: false,
    };
  }

  return {
    value: candidate,
    consumed: true,
  };
}

export function deriveM048S01Outcome(evidence: PhaseTimingEvidence | null | undefined): M048S01Outcome {
  const conclusion = evidence?.conclusion ?? null;
  const published = evidence?.published ?? null;

  if (!evidence) {
    return {
      class: "unknown",
      conclusion,
      published,
      summary: "no correlated phase evidence available",
    };
  }

  if (conclusion === "timeout_partial" || (conclusion === "timeout" && published === true)) {
    return {
      class: "timeout_partial",
      conclusion,
      published,
      summary: "timeout_partial (visible partial output published)",
    };
  }

  if (conclusion === "timeout") {
    return {
      class: "timeout",
      conclusion,
      published,
      summary: "timeout (no visible output published)",
    };
  }

  if (conclusion === "success") {
    return {
      class: "success",
      conclusion,
      published,
      summary: published === true ? "success (published output)" : "success (no published output)",
    };
  }

  return {
    class: conclusion ? "failure" : "unknown",
    conclusion,
    published,
    summary: conclusion
      ? `${conclusion} (${published === true ? "published output" : published === false ? "no published output" : "publication unknown"})`
      : "no correlated phase evidence available",
  };
}

export function parseVerifyM048S01Args(args: string[]): {
  help?: boolean;
  json?: boolean;
  reviewOutputKey: string | null;
  deliveryId: string | null;
} {
  let reviewOutputKey: string | null = null;
  let deliveryId: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--review-output-key") {
      const { value, consumed } = readOptionValue(args, index);
      reviewOutputKey = value;
      if (consumed) {
        index += 1;
      }
      continue;
    }

    if (arg === "--delivery-id") {
      const { value, consumed } = readOptionValue(args, index);
      deliveryId = value;
      if (consumed) {
        index += 1;
      }
      continue;
    }
  }

  return {
    help: args.includes("--help") || args.includes("-h"),
    json: args.includes("--json"),
    reviewOutputKey,
    deliveryId,
  };
}

function usage(): string {
  return [
    "Usage: bun run verify:m048:s01 -- --review-output-key <key> [--delivery-id <id>] [--json]",
    "",
    "Options:",
    "  --review-output-key  Required reviewOutputKey to verify",
    "  --delivery-id        Optional delivery id override; must match the encoded key when both are provided",
    "  --json               Print machine-readable JSON output",
    "  --help               Show this help",
    "",
    "Environment:",
    "  ACA_RESOURCE_GROUP / AZURE_LOG_WORKSPACE_IDS  Optional Azure workspace discovery overrides",
  ].join("\n");
}

function createBaseReport(params: {
  generatedAt?: string;
  reviewOutputKey?: string | null;
  deliveryId?: string | null;
  statusCode: M048S01StatusCode;
  success: boolean;
  sourceAvailability?: EvidenceAvailability;
  queryText?: string | null;
  workspaceCount?: number;
  matchedRowCount?: number;
  duplicateRowCount?: number;
  driftedRowCount?: number;
  evidence?: PhaseTimingEvidence | null;
  issues?: string[];
}): M048S01Report {
  const evidence = params.evidence ?? null;

  return {
    command: "verify:m048:s01",
    generated_at: params.generatedAt ?? new Date().toISOString(),
    review_output_key: params.reviewOutputKey ?? null,
    delivery_id: params.deliveryId ?? null,
    success: params.success,
    status_code: params.statusCode,
    sourceAvailability: {
      azureLogs: params.sourceAvailability ?? "missing",
    },
    query: {
      text: params.queryText ?? null,
      timespan: DEFAULT_TIMESPAN,
      workspaceCount: params.workspaceCount ?? 0,
      matchedRowCount: params.matchedRowCount ?? 0,
      duplicateRowCount: params.duplicateRowCount ?? 0,
      driftedRowCount: params.driftedRowCount ?? 0,
    },
    outcome: deriveM048S01Outcome(evidence),
    evidence,
    issues: params.issues ?? [],
  };
}

function validateArgs(options: ReturnType<typeof parseVerifyM048S01Args>): {
  reviewOutputKey: string;
  deliveryId: string;
} | {
  issues: string[];
} {
  const issues: string[] = [];
  const reviewOutputKey = normalizeIdentifier(options.reviewOutputKey);
  if (!reviewOutputKey) {
    issues.push("Missing required --review-output-key.");
    return { issues };
  }

  const parsedKey = parseReviewOutputKey(reviewOutputKey);
  const normalizedDeliveryId = normalizeIdentifier(options.deliveryId);
  const encodedDeliveryId = parsedKey?.effectiveDeliveryId ?? null;

  if (normalizedDeliveryId && encodedDeliveryId && normalizedDeliveryId !== encodedDeliveryId) {
    issues.push("Provided --delivery-id does not match the delivery id encoded in --review-output-key.");
  }

  const deliveryId = normalizedDeliveryId ?? encodedDeliveryId;
  if (!deliveryId) {
    issues.push("Could not determine delivery id from --review-output-key; provide --delivery-id explicitly.");
  }

  return issues.length > 0 ? { issues } : { reviewOutputKey, deliveryId: deliveryId! };
}

function getAzureLogResourceGroup(): string {
  return process.env.ACA_RESOURCE_GROUP ?? DEFAULT_RESOURCE_GROUP;
}

export async function discoverAuditWorkspaceIds(): Promise<string[]> {
  const explicitWorkspaceIds = process.env.AZURE_LOG_WORKSPACE_IDS
    ?.split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return discoverLogAnalyticsWorkspaceIds({
    resourceGroup: getAzureLogResourceGroup(),
    explicitWorkspaceIds,
  });
}

export async function evaluateM048S01(params: {
  reviewOutputKey: string;
  deliveryId: string;
  generatedAt?: string;
  workspaceIds?: string[];
  discoverWorkspaceIds?: () => Promise<string[]>;
  queryLogs?: (params: {
    workspaceIds: string[];
    reviewOutputKey: string;
    deliveryId: string;
    timespan: string;
    limit: number;
  }) => Promise<{ query: string; rows: NormalizedLogAnalyticsRow[] }>;
}): Promise<M048S01Report> {
  const generatedAt = params.generatedAt ?? new Date().toISOString();
  let workspaceIds = params.workspaceIds ?? [];

  if (!params.workspaceIds) {
    try {
      workspaceIds = await (params.discoverWorkspaceIds ?? discoverAuditWorkspaceIds)();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return createBaseReport({
        generatedAt,
        reviewOutputKey: params.reviewOutputKey,
        deliveryId: params.deliveryId,
        statusCode: "m048_s01_azure_unavailable",
        success: false,
        sourceAvailability: "unavailable",
        issues: [`Azure workspace discovery failed: ${message}`],
      });
    }
  }

  try {
    const queryResult = await (params.queryLogs ?? ((queryParams) => queryReviewAuditLogs({
      workspaceIds: queryParams.workspaceIds,
      reviewOutputKey: queryParams.reviewOutputKey,
      deliveryId: queryParams.deliveryId,
      timespan: queryParams.timespan,
      limit: queryParams.limit,
      messageContains: REVIEW_PHASE_TIMING_LOG_MESSAGE,
    })))(
      {
        workspaceIds,
        reviewOutputKey: params.reviewOutputKey,
        deliveryId: params.deliveryId,
        timespan: DEFAULT_TIMESPAN,
        limit: DEFAULT_QUERY_LIMIT,
      },
    );

    const evidenceResult = buildPhaseTimingEvidence({
      reviewOutputKey: params.reviewOutputKey,
      deliveryId: params.deliveryId,
      rows: queryResult.rows,
    });

    const statusCode = evidenceResult.status === "ok"
      ? "m048_s01_ok"
      : evidenceResult.status === "correlation-mismatch"
        ? "m048_s01_correlation_mismatch"
        : evidenceResult.status === "invalid-phase-payload"
          ? "m048_s01_invalid_phase_payload"
          : "m048_s01_no_matching_phase_timing";

    return createBaseReport({
      generatedAt,
      reviewOutputKey: params.reviewOutputKey,
      deliveryId: params.deliveryId,
      statusCode,
      success: evidenceResult.status === "ok",
      sourceAvailability: evidenceResult.sourceAvailability.azureLogs,
      queryText: queryResult.query,
      workspaceCount: workspaceIds.length,
      matchedRowCount: evidenceResult.correlation.matchedRowCount,
      duplicateRowCount: evidenceResult.correlation.duplicateRowCount,
      driftedRowCount: evidenceResult.correlation.driftedRowCount,
      evidence: evidenceResult.evidence,
      issues: evidenceResult.issues,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return createBaseReport({
      generatedAt,
      reviewOutputKey: params.reviewOutputKey,
      deliveryId: params.deliveryId,
      statusCode: "m048_s01_azure_unavailable",
      success: false,
      sourceAvailability: "unavailable",
      workspaceCount: workspaceIds.length,
      issues: [`Azure Log Analytics query failed: ${message}`],
    });
  }
}

export function renderM048S01Report(report: M048S01Report): string {
  const lines = [
    "# M048 S01 — Review Phase Timing Verifier",
    "",
    `Status: ${report.status_code}`,
    `Review output key: ${report.review_output_key ?? "unavailable"}`,
    `Delivery id: ${report.delivery_id ?? "unavailable"}`,
    `Azure logs: ${report.sourceAvailability.azureLogs}`,
    `Query: workspaces=${report.query.workspaceCount} matched_rows=${report.query.matchedRowCount} duplicates=${report.query.duplicateRowCount} drift=${report.query.driftedRowCount} timespan=${report.query.timespan}`,
    `Outcome class: ${report.outcome.class}`,
    `Outcome detail: ${report.outcome.summary}`,
  ];

  if (report.evidence) {
    lines.push(
      `Conclusion: ${report.evidence.conclusion ?? "unknown"}`,
      `Published: ${report.evidence.published === null ? "unknown" : String(report.evidence.published)}`,
    );

    if (typeof report.evidence.totalDurationMs === "number") {
      lines.push(`Total wall-clock: ${formatDuration(report.evidence.totalDurationMs)}`);
    }

    lines.push("", "Phase timings:");
    for (const phase of report.evidence.phases) {
      lines.push(formatPhaseLine(phase));
    }
  }

  if (report.issues.length > 0) {
    lines.push("", "Issues:");
    for (const issue of report.issues) {
      lines.push(`- ${issue}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export async function main(
  args: string[] = process.argv.slice(2),
  deps?: {
    stdout?: { write: (chunk: string) => void };
    stderr?: { write: (chunk: string) => void };
    evaluate?: (params: { reviewOutputKey: string; deliveryId: string }) => Promise<M048S01Report>;
  },
): Promise<number> {
  const stdout = deps?.stdout ?? process.stdout;
  const stderr = deps?.stderr ?? process.stderr;
  const options = parseVerifyM048S01Args(args);

  if (options.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  const reviewOutputKeyMissingValue = args.includes("--review-output-key")
    && normalizeIdentifier(options.reviewOutputKey) === null;
  if (reviewOutputKeyMissingValue) {
    const report = createBaseReport({
      reviewOutputKey: null,
      deliveryId: normalizeIdentifier(options.deliveryId),
      statusCode: "m048_s01_skipped_missing_review_output_key",
      success: true,
      issues: ["No review output key provided; skipped live Azure phase-timing verification."],
    });

    stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderM048S01Report(report));
    return 0;
  }

  const validated = validateArgs(options);
  if ("issues" in validated) {
    const report = createBaseReport({
      reviewOutputKey: normalizeIdentifier(options.reviewOutputKey),
      deliveryId: normalizeIdentifier(options.deliveryId),
      statusCode: "m048_s01_invalid_arg",
      success: false,
      issues: validated.issues,
    });

    stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderM048S01Report(report));
    return 1;
  }

  try {
    const report = await (deps?.evaluate ?? ((params) => evaluateM048S01(params)))({
      reviewOutputKey: validated.reviewOutputKey,
      deliveryId: validated.deliveryId,
    });

    stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderM048S01Report(report));
    return report.success ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`verify:m048:s01 failed: ${message}\n`);
    return 1;
  }
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
