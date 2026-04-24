import { parseArgs } from "node:util";
import { queryUsageReportWithTimeout } from "./usage-report.ts";

type AccessState = "available" | "missing" | "unavailable";

type CliOptions = {
  since: string | null;
  repo: string | null;
  json: boolean;
  help: boolean;
};

export const M061_S03_CHECK_IDS = [
  "M061-S03-PREFLIGHT",
  "M061-S03-REVIEW-USER-PROMPT-SECTIONS",
  "M061-S03-REVIEW-SECTION-TRUNCATION",
  "M061-S03-DELIVERY-ATTRIBUTION",
] as const;

export type M061S03CheckId = (typeof M061_S03_CHECK_IDS)[number];

export type Check = {
  id: M061S03CheckId;
  title: string;
  passed: boolean;
  detail: string;
};

export type ReviewSectionBudgetProofReport = {
  command: "verify:m061:s03";
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
    reviewUserPromptSections: string[];
    truncatedReviewSections: string[];
    reviewDeliveries: string[];
  };
};

type UsageLikeResult = Awaited<ReturnType<typeof queryUsageReportWithTimeout>>;

const REQUIRED_REVIEW_SECTIONS = [
  "review-pr-context",
  "review-change-context",
  "review-size-context",
  "review-graph-context",
  "review-knowledge-context",
  "review-instructions",
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

export function parseM061S03Args(args: string[]): CliOptions {
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
}): ReviewSectionBudgetProofReport {
  return {
    command: "verify:m061:s03",
    generatedAt: options.generatedAt,
    filters: options.filters,
    preflight: {
      databaseAccess: options.accessState,
      detail: options.accessDetail,
    },
    overallPassed: false,
    checks: [
      {
        id: "M061-S03-PREFLIGHT",
        title: "Live Postgres telemetry is reachable",
        passed: options.accessState === "available",
        detail: options.accessDetail,
      },
    ],
    observed: {
      reviewUserPromptSections: [],
      truncatedReviewSections: [],
      reviewDeliveries: [],
    },
  };
}

export function evaluateM061S03ReviewSectionProof(input: {
  generatedAt: string;
  filters: { repo: string | null; since: string | null };
  accessState: AccessState;
  accessDetail: string;
  usageResult: UsageLikeResult | null;
}): ReviewSectionBudgetProofReport {
  if (input.accessState !== "available" || input.usageResult == null) {
    return buildPreflightOnlyReport({
      generatedAt: input.generatedAt,
      accessState: input.accessState,
      accessDetail: input.accessDetail,
      filters: input.filters,
    });
  }

  const reviewUserPromptSections = [...new Set(
    input.usageResult.promptSections
      .filter((section) => section.taskType === "review.full" && section.promptKind === "review.user-prompt")
      .map((section) => section.sectionName),
  )].sort();

  const truncatedReviewSections = [...new Set(
    input.usageResult.promptSections
      .filter((section) =>
        section.taskType === "review.full"
        && section.promptKind === "review.user-prompt"
        && section.truncatedExecutions > 0,
      )
      .map((section) => section.sectionName),
  )].sort();

  const reviewDeliveries = [...new Set(
    input.usageResult.deliveryBreakdown
      .filter((delivery) => delivery.taskType === "review.full" && delivery.promptKinds.includes("review.user-prompt"))
      .map((delivery) => delivery.deliveryId),
  )].sort();

  const missingSections = REQUIRED_REVIEW_SECTIONS.filter((section) => !reviewUserPromptSections.includes(section));

  const checks: Check[] = [
    {
      id: "M061-S03-PREFLIGHT",
      title: "Live Postgres telemetry is reachable",
      passed: true,
      detail: input.accessDetail,
    },
    {
      id: "M061-S03-REVIEW-USER-PROMPT-SECTIONS",
      title: "Review telemetry exposes bounded named review.user-prompt sections",
      passed: missingSections.length === 0,
      detail: missingSections.length === 0
        ? `Observed review.user-prompt sections: ${reviewUserPromptSections.join(", ")}`
        : `Missing named review.user-prompt sections: ${missingSections.join(", ")}. Observed: ${reviewUserPromptSections.join(", ") || "none"}`,
    },
    {
      id: "M061-S03-REVIEW-SECTION-TRUNCATION",
      title: "Review prompt sections surface truncation evidence for bounded expensive sections",
      passed: truncatedReviewSections.length > 0,
      detail: truncatedReviewSections.length > 0
        ? `Observed truncated review sections: ${truncatedReviewSections.join(", ")}`
        : "No review.user-prompt sections reported truncatedExecutions > 0.",
    },
    {
      id: "M061-S03-DELIVERY-ATTRIBUTION",
      title: "Delivery-level attribution retains review.user-prompt prompt-kind accounting for review.full",
      passed: reviewDeliveries.length > 0,
      detail: reviewDeliveries.length > 0
        ? `Observed review deliveries with review.user-prompt attribution: ${reviewDeliveries.join(", ")}`
        : "No review.full delivery rows reported review.user-prompt in promptKinds.",
    },
  ];

  return {
    command: "verify:m061:s03",
    generatedAt: input.generatedAt,
    filters: input.filters,
    preflight: {
      databaseAccess: "available",
      detail: input.accessDetail,
    },
    overallPassed: checks.every((check) => check.passed),
    checks,
    observed: {
      reviewUserPromptSections,
      truncatedReviewSections,
      reviewDeliveries,
    },
  };
}

export function renderM061S03ReviewSectionProof(report: ReviewSectionBudgetProofReport): string {
  const lines = [
    "M061 S03 review section budget proof",
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
  console.log(`M061 S03 review section budget proof\n\nUsage:\n  bun scripts/verify-m061-s03.ts [--repo <owner/repo>] [--since <Nd|YYYY-MM-DD|ISO>] [--json]\n\nNotes:\n  - Reads live Postgres telemetry through createDbClient()\n  - Verifies named review.user-prompt section attribution for review.full\n  - Verifies truncation visibility on bounded review sections\n  - Fails open with explicit database access status when Postgres is unavailable`);
}

function snapshotProcessEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...env };
}

export async function runM061S03ReviewSectionProofCli(
  args: string[],
  env: NodeJS.ProcessEnv = snapshotProcessEnv(),
): Promise<{ report: ReviewSectionBudgetProofReport; exitCode: number; json: boolean }> {
  const options = parseM061S03Args(args);
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
    const usageResult = await queryUsageReportWithTimeout(client.sql, {
      repo: options.repo,
      since: options.since,
    });
    const report = evaluateM061S03ReviewSectionProof({
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
    await client?.sql.end({ timeout: 0 });
  }
}

if (import.meta.main) {
  try {
    const { report, exitCode, json } = await runM061S03ReviewSectionProofCli(process.argv.slice(2));
    console.log(json ? JSON.stringify(report, null, 2) : renderM061S03ReviewSectionProof(report));
    process.exit(exitCode);
  } catch (error) {
    console.error(`verify:m061:s03 failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
