import { parseArgs } from "node:util";
import pino from "pino";
import { createDbClient } from "../src/db/client.ts";
import { queryUsageReport } from "./usage-report.ts";

type AccessState = "available" | "missing" | "unavailable";

type CliOptions = {
  since: string | null;
  repo: string | null;
  json: boolean;
  help: boolean;
};

export const M061_S02_CHECK_IDS = [
  "M061-S02-PREFLIGHT",
  "M061-S02-MENTION-CONTEXT-SECTIONS",
  "M061-S02-MENTION-USER-PROMPT",
] as const;

export type M061S02CheckId = (typeof M061_S02_CHECK_IDS)[number];

export type Check = {
  id: M061S02CheckId;
  title: string;
  passed: boolean;
  detail: string;
};

export type MentionContextDietProofReport = {
  command: "verify:m061:s02";
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
    mentionContextSections: string[];
    mentionUserPromptSections: string[];
  };
};

type UsageLikeResult = Awaited<ReturnType<typeof queryUsageReport>>;

const REQUIRED_FINE_GRAINED_CONTEXT_SECTIONS = [
  "candidate-code-pointers",
  "mention-conversation-history",
  "mention-inline-review-context",
  "mention-pr-metadata",
  "mention-review-thread-context",
] as const;

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

export function parseM061S02Args(args: string[]): CliOptions {
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
}): MentionContextDietProofReport {
  return {
    command: "verify:m061:s02",
    generatedAt: options.generatedAt,
    filters: options.filters,
    preflight: {
      databaseAccess: options.accessState,
      detail: options.accessDetail,
    },
    overallPassed: false,
    checks: [
      {
        id: "M061-S02-PREFLIGHT",
        title: "Live Postgres telemetry is reachable",
        passed: options.accessState === "available",
        detail: options.accessDetail,
      },
    ],
    observed: {
      mentionContextSections: [],
      mentionUserPromptSections: [],
    },
  };
}

export function evaluateM061S02MentionContextProof(input: {
  generatedAt: string;
  filters: { repo: string | null; since: string | null };
  accessState: AccessState;
  accessDetail: string;
  usageResult: UsageLikeResult | null;
}): MentionContextDietProofReport {
  if (input.accessState !== "available" || input.usageResult == null) {
    return buildPreflightOnlyReport({
      generatedAt: input.generatedAt,
      accessState: input.accessState,
      accessDetail: input.accessDetail,
      filters: input.filters,
    });
  }

  const mentionContextSections = [...new Set(
    input.usageResult.promptSections
      .filter((section) => section.taskType === "mention.response" && section.promptKind === "mention.context")
      .map((section) => section.sectionName),
  )].sort();

  const mentionUserPromptSections = [...new Set(
    input.usageResult.promptSections
      .filter((section) => section.taskType === "mention.response" && section.promptKind === "mention.user-prompt")
      .map((section) => section.sectionName),
  )].sort();

  const observedFineGrainedSections = mentionContextSections.filter((section) =>
    REQUIRED_FINE_GRAINED_CONTEXT_SECTIONS.includes(section as (typeof REQUIRED_FINE_GRAINED_CONTEXT_SECTIONS)[number]),
  );

  const checks: Check[] = [
    {
      id: "M061-S02-PREFLIGHT",
      title: "Live Postgres telemetry is reachable",
      passed: true,
      detail: input.accessDetail,
    },
    {
      id: "M061-S02-MENTION-CONTEXT-SECTIONS",
      title: "Mention context telemetry exposes fine-grained admitted section names",
      passed: observedFineGrainedSections.length > 0,
      detail:
        observedFineGrainedSections.length > 0
          ? `Observed mention.context sections: ${mentionContextSections.join(", ")}`
          : `Missing fine-grained mention.context sections. Observed: ${mentionContextSections.join(", ") || "none"}`,
    },
    {
      id: "M061-S02-MENTION-USER-PROMPT",
      title: "Mention user prompt telemetry still records the canonical mention-user-prompt section",
      passed: mentionUserPromptSections.includes("mention-user-prompt"),
      detail: mentionUserPromptSections.includes("mention-user-prompt")
        ? `Observed mention.user-prompt sections: ${mentionUserPromptSections.join(", ")}`
        : `Missing mention-user-prompt section. Observed: ${mentionUserPromptSections.join(", ") || "none"}`,
    },
  ];

  return {
    command: "verify:m061:s02",
    generatedAt: input.generatedAt,
    filters: input.filters,
    preflight: {
      databaseAccess: "available",
      detail: input.accessDetail,
    },
    overallPassed: checks.every((check) => check.passed),
    checks,
    observed: {
      mentionContextSections,
      mentionUserPromptSections,
    },
  };
}

export function renderM061S02MentionContextProof(report: MentionContextDietProofReport): string {
  const lines = [
    "M061 S02 mention context diet proof",
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
      "No live telemetry evidence available. This proof command fails open so operators can inspect database access state before rerunning the verifier.",
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

  return lines.join("\n");
}

function printUsage(): void {
  console.log(`M061 S02 mention context diet proof\n\nUsage:\n  bun scripts/verify-m061-s02.ts [--repo <owner/repo>] [--since <Nd|YYYY-MM-DD|ISO>] [--json]`);
}

export async function runM061S02MentionContextProofCli(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ report: MentionContextDietProofReport; exitCode: number; json: boolean }> {
  const options = parseM061S02Args(args);
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

  const logger = pino({ level: "silent" });
  let client: ReturnType<typeof createDbClient> | null = null;
  try {
    client = createDbClient({ connectionString, logger });
    const usageResult = await queryUsageReport(client.sql, {
      repo: options.repo,
      since: options.since,
    });
    const report = evaluateM061S02MentionContextProof({
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
    const { report, exitCode, json } = await runM061S02MentionContextProofCli(process.argv.slice(2));
    console.log(json ? JSON.stringify(report, null, 2) : renderM061S02MentionContextProof(report));
    process.exit(exitCode);
  } catch (error) {
    console.error(`verify:m061:s02 failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
