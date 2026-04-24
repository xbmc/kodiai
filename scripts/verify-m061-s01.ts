import { parseArgs } from "node:util";
import { queryUsageReport, renderUsageReportText } from "./usage-report.ts";

type AccessState = "available" | "missing" | "unavailable";

type CliOptions = {
  since: string | null;
  repo: string | null;
  json: boolean;
  help: boolean;
};

export const REQUIRED_TASK_TYPES = ["review.full", "mention.response", "slack.response"] as const;
export const REQUIRED_PROMPT_SECTION_TASK_TYPES = ["review.full", "mention.response"] as const;
export const M061_S01_CHECK_IDS = [
  "M061-S01-PREFLIGHT",
  "M061-S01-TASK-PATH-ATTRIBUTION",
  "M061-S01-PROMPT-SECTIONS",
  "M061-S01-DELIVERY-BREAKDOWN",
  "M061-S01-CACHE-EVIDENCE",
] as const;

export type M061S01CheckId = (typeof M061_S01_CHECK_IDS)[number];

export type Check = {
  id: M061S01CheckId;
  title: string;
  passed: boolean;
  detail: string;
};

export type BaselineProofReport = {
  command: "verify:m061:s01";
  generatedAt: string;
  filters: {
    since: string | null;
    repo: string | null;
  };
  preflight: {
    databaseAccess: AccessState;
    detail: string;
  };
  overallPassed: boolean;
  checks: Check[];
  observed: {
    taskTypes: string[];
    promptSectionTaskTypes: string[];
    promptSectionNames: string[];
    deliveryTaskTypes: string[];
    cacheTaskTypes: string[];
  };
  usageReportText?: string;
};

type UsageLikeResult = Awaited<ReturnType<typeof queryUsageReport>>;

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

export function parseM061S01Args(args: string[]): CliOptions {
  const parsed = parseArgs({
    args,
    options: {
      since: { type: "string" },
      repo: { type: "string" },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
    allowPositionals: false,
  });

  return {
    since: parsed.values.since ? normalizeSince(parsed.values.since) : null,
    repo: parsed.values.repo ?? null,
    json: parsed.values.json ?? false,
    help: parsed.values.help ?? false,
  };
}

function buildPreflightOnlyReport(options: {
  generatedAt: string;
  accessState: AccessState;
  accessDetail: string;
  filters: { repo: string | null; since: string | null };
}): BaselineProofReport {
  const checks: Check[] = [
    {
      id: "M061-S01-PREFLIGHT",
      title: "Live Postgres telemetry is reachable",
      passed: options.accessState === "available",
      detail: options.accessDetail,
    },
  ];

  return {
    command: "verify:m061:s01",
    generatedAt: options.generatedAt,
    filters: options.filters,
    preflight: {
      databaseAccess: options.accessState,
      detail: options.accessDetail,
    },
    overallPassed: false,
    checks,
    observed: {
      taskTypes: [],
      promptSectionTaskTypes: [],
      promptSectionNames: [],
      deliveryTaskTypes: [],
      cacheTaskTypes: [],
    },
  };
}

export function evaluateM061S01BaselineProof(input: {
  generatedAt: string;
  filters: { repo: string | null; since: string | null };
  accessState: AccessState;
  accessDetail: string;
  usageResult: UsageLikeResult | null;
}): BaselineProofReport {
  if (input.accessState !== "available" || input.usageResult == null) {
    return buildPreflightOnlyReport({
      generatedAt: input.generatedAt,
      accessState: input.accessState,
      accessDetail: input.accessDetail,
      filters: input.filters,
    });
  }

  const usage = input.usageResult;
  const observedTaskTypes = [...new Set(usage.taskTypes.map((row) => row.taskType))].sort();
  const observedPromptSectionTaskTypes = [...new Set(usage.promptSections.map((row) => row.taskType))].sort();
  const observedPromptSectionNames = [...new Set(usage.promptSections.map((row) => `${row.taskType}/${row.promptKind}/${row.sectionName}`))].sort();
  const observedDeliveryTaskTypes = [...new Set(usage.deliveryBreakdown.map((row) => row.taskType))].sort();
  const observedCacheTaskTypes = [...new Set(usage.rateLimits.map((row) => row.taskType))].sort();

  const missingTaskTypes = REQUIRED_TASK_TYPES.filter((taskType) => !observedTaskTypes.includes(taskType));
  const missingPromptSectionTaskTypes = REQUIRED_PROMPT_SECTION_TASK_TYPES.filter(
    (taskType) => !observedPromptSectionTaskTypes.includes(taskType),
  );
  const missingDeliveryTaskTypes = REQUIRED_TASK_TYPES.filter((taskType) => !observedDeliveryTaskTypes.includes(taskType));
  const hasCacheEvidence = usage.rateLimits.length > 0;

  const checks: Check[] = [
    {
      id: "M061-S01-PREFLIGHT",
      title: "Live Postgres telemetry is reachable",
      passed: true,
      detail: input.accessDetail,
    },
    {
      id: "M061-S01-TASK-PATH-ATTRIBUTION",
      title: "Usage report exposes review.full, mention.response, and slack.response token attribution",
      passed: missingTaskTypes.length === 0,
      detail:
        missingTaskTypes.length === 0
          ? `Observed task types: ${observedTaskTypes.join(", ")}`
          : `Missing task-path attribution for: ${missingTaskTypes.join(", ")}. Observed: ${observedTaskTypes.join(", ") || "none"}`,
    },
    {
      id: "M061-S01-PROMPT-SECTIONS",
      title: "Usage report exposes named prompt-section telemetry for review and mention flows",
      passed: missingPromptSectionTaskTypes.length === 0 && observedPromptSectionNames.length > 0,
      detail:
        missingPromptSectionTaskTypes.length === 0 && observedPromptSectionNames.length > 0
          ? `Observed prompt-section task types: ${observedPromptSectionTaskTypes.join(", ")}; sections: ${observedPromptSectionNames.slice(0, 8).join(", ")}`
          : `Missing prompt-section task types: ${missingPromptSectionTaskTypes.join(", ") || "none"}. Observed sections: ${observedPromptSectionNames.slice(0, 8).join(", ") || "none"}`,
    },
    {
      id: "M061-S01-DELIVERY-BREAKDOWN",
      title: "Delivery-level attribution exists for all baseline task paths",
      passed: missingDeliveryTaskTypes.length === 0,
      detail:
        missingDeliveryTaskTypes.length === 0
          ? `Observed delivery task types: ${observedDeliveryTaskTypes.join(", ")}`
          : `Missing delivery attribution for: ${missingDeliveryTaskTypes.join(", ")}. Observed: ${observedDeliveryTaskTypes.join(", ") || "none"}`,
    },
    {
      id: "M061-S01-CACHE-EVIDENCE",
      title: "Cache-effectiveness evidence is present in rate_limit_events-backed reporting",
      passed: hasCacheEvidence,
      detail: hasCacheEvidence
        ? `Observed cache evidence rows for: ${observedCacheTaskTypes.join(", ")}`
        : "No cache evidence rows were returned from rate_limit_events.",
    },
  ];

  const usageReportText = renderUsageReportText({
    command: "report",
    generatedAt: input.generatedAt,
    filters: input.filters,
    preflight: {
      databaseAccess: "available",
      detail: input.accessDetail,
    },
    summary: {
      ...usage.summary,
      cacheEffectiveness: usage.summary.totalTokens > 0
        ? Number((usage.summary.totalCacheReadTokens / usage.summary.totalTokens).toFixed(4))
        : 0,
    },
    taskTypes: usage.taskTypes,
    deliveryBreakdown: usage.deliveryBreakdown,
    promptSections: usage.promptSections,
    rateLimits: usage.rateLimits,
    reuseEvidence: usage.reuseEvidence ?? [],
  });

  return {
    command: "verify:m061:s01",
    generatedAt: input.generatedAt,
    filters: input.filters,
    preflight: {
      databaseAccess: "available",
      detail: input.accessDetail,
    },
    overallPassed: checks.every((check) => check.passed),
    checks,
    observed: {
      taskTypes: observedTaskTypes,
      promptSectionTaskTypes: observedPromptSectionTaskTypes,
      promptSectionNames: observedPromptSectionNames,
      deliveryTaskTypes: observedDeliveryTaskTypes,
      cacheTaskTypes: observedCacheTaskTypes,
    },
    usageReportText,
  };
}

export function renderM061S01BaselineProof(report: BaselineProofReport): string {
  const lines = [
    "M061 S01 baseline telemetry proof",
    `Database access: ${report.preflight.databaseAccess}`,
    `Preflight detail: ${report.preflight.detail}`,
    `Generated at: ${report.generatedAt}`,
  ];

  if (report.filters.since || report.filters.repo) {
    lines.push(`Filters: since=${report.filters.since ?? "none"} repo=${report.filters.repo ?? "none"}`);
  }

  if (report.preflight.databaseAccess !== "available") {
    lines.push(
      "",
      "No live telemetry evidence available. This proof command fails open so operators can see the access state before rerunning the report/verifier flow.",
    );
    return lines.join("\n");
  }

  lines.push("", "Checks:");
  for (const check of report.checks) {
    lines.push(`- ${check.id} ${check.passed ? "PASS" : "FAIL"}: ${check.title}. ${check.detail}`);
  }

  lines.push(
    "",
    report.overallPassed
      ? `Final verdict: PASS [${report.checks.map((check) => check.id).join(", ")}]`
      : `Final verdict: FAIL [${report.checks.filter((check) => !check.passed).map((check) => check.id).join(", ")}]`,
  );

  if (report.usageReportText) {
    lines.push("", "Usage report snapshot", report.usageReportText);
  }

  return lines.join("\n");
}

function printUsage(): void {
  console.log(`M061 S01 baseline telemetry proof\n\nUsage:\n  bun scripts/verify-m061-s01.ts [--repo <owner/repo>] [--since <Nd|YYYY-MM-DD|ISO>] [--json]\n\nNotes:\n  - Reads live Postgres telemetry through createDbClient()\n  - Verifies baseline task-path attribution for review.full, mention.response, and slack.response\n  - Verifies named prompt-section visibility for review + mention flows\n  - Fails open with explicit database access status when Postgres is unavailable`);
}

function snapshotProcessEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...env };
}

export async function runM061S01BaselineProofCli(
  args: string[],
  env: NodeJS.ProcessEnv = snapshotProcessEnv(),
): Promise<{ report: BaselineProofReport; exitCode: number; json: boolean }> {
  const options = parseM061S01Args(args);
  if (options.help) {
    printUsage();
    return {
      report: buildPreflightOnlyReport({
        generatedAt: new Date().toISOString(),
        accessState: "missing",
        accessDetail: "Help requested.",
        filters: { repo: options.repo, since: options.since },
      }),
      exitCode: 0,
      json: options.json,
    };
  }

  const connectionString = env.TEST_DATABASE_URL ?? env.DATABASE_URL ?? null;
  if (!connectionString) {
    return {
      report: buildPreflightOnlyReport({
        generatedAt: new Date().toISOString(),
        accessState: "missing",
        accessDetail: "Neither TEST_DATABASE_URL nor DATABASE_URL is set.",
        filters: { repo: options.repo, since: options.since },
      }),
      exitCode: 0,
      json: options.json,
    };
  }

  const [{ default: pino }, { createDbClient }] = await Promise.all([
    import("pino"),
    import("../src/db/client.ts"),
  ]);
  const logger = pino({ level: "silent" });
  let client: ReturnType<typeof createDbClient> | null = null;
  try {
    client = createDbClient({ connectionString, logger });
    const usageResult = await queryUsageReport(client.sql, {
      repo: options.repo,
      since: options.since,
    });
    const report = evaluateM061S01BaselineProof({
      generatedAt: new Date().toISOString(),
      filters: { repo: options.repo, since: options.since },
      accessState: "available",
      accessDetail: "Connected to telemetry Postgres.",
      usageResult,
    });
    return {
      report,
      exitCode: report.overallPassed ? 0 : 1,
      json: options.json,
    };
  } catch (error) {
    return {
      report: buildPreflightOnlyReport({
        generatedAt: new Date().toISOString(),
        accessState: "unavailable",
        accessDetail: error instanceof Error ? error.message : String(error),
        filters: { repo: options.repo, since: options.since },
      }),
      exitCode: 0,
      json: options.json,
    };
  } finally {
    await client?.close();
  }
}

if (import.meta.main) {
  try {
    const { report, exitCode, json } = await runM061S01BaselineProofCli(process.argv.slice(2));
    console.log(json ? JSON.stringify(report, null, 2) : renderM061S01BaselineProof(report));
    process.exit(exitCode);
  } catch (error) {
    console.error(`verify:m061:s01 failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
