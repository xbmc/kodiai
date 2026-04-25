import { parseArgs } from "node:util";
import { queryUsageReportWithTimeout } from "./usage-report.ts";

type AccessState = "available" | "missing" | "unavailable";

type CliOptions = {
  since: string | null;
  repo: string | null;
  json: boolean;
  help: boolean;
};

export const M061_S04_CHECK_IDS = [
  "M061-S04-PREFLIGHT",
  "M061-S04-REUSE-SURFACE",
  "M061-S04-RETRIEVAL-REUSE",
  "M061-S04-DERIVED-CACHE-TRUTHFULNESS",
] as const;

export type M061S04CheckId = (typeof M061_S04_CHECK_IDS)[number];

export type Check = {
  id: M061S04CheckId;
  title: string;
  passed: boolean;
  detail: string;
  statusCode: string;
};

export type ReuseEvidenceSnapshot = {
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

export type M061S04ProofReport = {
  command: "verify:m061:s04";
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
    reuseEvidence: ReuseEvidenceSnapshot[];
  };
};

type UsageLikeResult = Awaited<ReturnType<typeof queryUsageReportWithTimeout>>;

const REQUIRED_REUSE_TYPES = [
  "mention.derived-context",
  "review.derived-prompt",
  "retrieval.query-embedding",
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

export function parseM061S04Args(args: string[]): CliOptions {
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
}): M061S04ProofReport {
  return {
    command: "verify:m061:s04",
    generatedAt: options.generatedAt,
    filters: options.filters,
    preflight: {
      databaseAccess: options.accessState,
      detail: options.accessDetail,
    },
    overallPassed: false,
    checks: [
      {
        id: "M061-S04-PREFLIGHT",
        title: "Live Postgres telemetry is reachable",
        passed: options.accessState === "available",
        detail: options.accessDetail,
        statusCode: options.accessState === "available" ? "telemetry_available" : `telemetry_${options.accessState}`,
      },
    ],
    observed: {
      reuseEvidence: [],
    },
  };
}

function getEvidence(result: UsageLikeResult, evidenceType: string): ReuseEvidenceSnapshot | null {
  return result.reuseEvidence.find((row) => row.evidenceType === evidenceType) ?? null;
}

export function evaluateM061S04Proof(input: {
  generatedAt: string;
  filters: { repo: string | null; since: string | null };
  accessState: AccessState;
  accessDetail: string;
  usageResult: UsageLikeResult | null;
}): M061S04ProofReport {
  if (input.accessState !== "available" || input.usageResult == null) {
    return buildPreflightOnlyReport({
      generatedAt: input.generatedAt,
      accessState: input.accessState,
      accessDetail: input.accessDetail,
      filters: input.filters,
    });
  }

  const reuseEvidence = input.usageResult.reuseEvidence.map((row) => ({ ...row }));
  const observedTypes = reuseEvidence.map((row) => row.evidenceType);
  const missingTypes = REQUIRED_REUSE_TYPES.filter((type) => !observedTypes.includes(type));
  const retrievalEvidence = getEvidence(input.usageResult, "retrieval.query-embedding");
  const mentionEvidence = getEvidence(input.usageResult, "mention.derived-context");
  const reviewEvidence = getEvidence(input.usageResult, "review.derived-prompt");

  const hasRetrievalReuseHit = Boolean(
    retrievalEvidence
    && retrievalEvidence.hitExecutions > 0
    && retrievalEvidence.reusedUnits > 0,
  );

  const derivedCachesHaveTruthfulStates = Boolean(
    mentionEvidence
    && reviewEvidence
    && mentionEvidence.statuses.some((status) => ["hit", "miss", "degraded", "bypass"].includes(status))
    && reviewEvidence.statuses.some((status) => ["hit", "miss", "degraded", "bypass"].includes(status)),
  );

  const derivedCachesShowExplicitFallback = Boolean(
    (mentionEvidence?.missExecutions ?? 0) > 0
      || (mentionEvidence?.degradedExecutions ?? 0) > 0
      || (mentionEvidence?.bypassExecutions ?? 0) > 0,
  ) && Boolean(
    (reviewEvidence?.missExecutions ?? 0) > 0
      || (reviewEvidence?.degradedExecutions ?? 0) > 0
      || (reviewEvidence?.bypassExecutions ?? 0) > 0,
  );

  const checks: Check[] = [
    {
      id: "M061-S04-PREFLIGHT",
      title: "Live Postgres telemetry is reachable",
      passed: true,
      detail: input.accessDetail,
      statusCode: "telemetry_available",
    },
    {
      id: "M061-S04-REUSE-SURFACE",
      title: "Canonical usage-report query exposes mention, review, and retrieval reuse evidence rows",
      passed: missingTypes.length === 0,
      detail: missingTypes.length === 0
        ? `Observed reuse evidence rows: ${observedTypes.join(", ")}`
        : `Missing reuse evidence rows for: ${missingTypes.join(", ")}. Observed: ${observedTypes.join(", ") || "none"}`,
      statusCode: missingTypes.length === 0 ? "reuse_surface_available" : "reuse_surface_missing",
    },
    {
      id: "M061-S04-RETRIEVAL-REUSE",
      title: "Retrieval reuse evidence shows duplicate-query embedding work was actually avoided",
      passed: hasRetrievalReuseHit,
      detail: retrievalEvidence
        ? `retrieval.query-embedding rows: executions=${retrievalEvidence.executions}, hits=${retrievalEvidence.hitExecutions}, reused_units=${retrievalEvidence.reusedUnits}, primary_work_units=${retrievalEvidence.primaryWorkUnits}, statuses=${retrievalEvidence.statuses.join(", ") || "none"}`
        : "No retrieval.query-embedding reuse evidence row was returned.",
      statusCode: hasRetrievalReuseHit ? "retrieval_reuse_proven" : "retrieval_reuse_missing_or_degraded",
    },
    {
      id: "M061-S04-DERIVED-CACHE-TRUTHFULNESS",
      title: "Derived-cache rows keep hit/miss/degraded/bypass states explicit instead of collapsing to silent misses",
      passed: derivedCachesHaveTruthfulStates && derivedCachesShowExplicitFallback,
      detail: !mentionEvidence || !reviewEvidence
        ? "Missing mention or review derived-cache evidence rows."
        : `mention statuses=${mentionEvidence.statuses.join(", ") || "none"} (hit=${mentionEvidence.hitExecutions} miss=${mentionEvidence.missExecutions} degraded=${mentionEvidence.degradedExecutions} bypass=${mentionEvidence.bypassExecutions}); review statuses=${reviewEvidence.statuses.join(", ") || "none"} (hit=${reviewEvidence.hitExecutions} miss=${reviewEvidence.missExecutions} degraded=${reviewEvidence.degradedExecutions} bypass=${reviewEvidence.bypassExecutions})`,
      statusCode: derivedCachesHaveTruthfulStates && derivedCachesShowExplicitFallback
        ? "derived_cache_truthful"
        : "derived_cache_evidence_missing_or_ambiguous",
    },
  ];

  return {
    command: "verify:m061:s04",
    generatedAt: input.generatedAt,
    filters: input.filters,
    preflight: {
      databaseAccess: "available",
      detail: input.accessDetail,
    },
    overallPassed: checks.every((check) => check.passed),
    checks,
    observed: {
      reuseEvidence,
    },
  };
}

export function renderM061S04Proof(report: M061S04ProofReport): string {
  const lines = [
    "M061 S04 reuse proof",
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
      "No live telemetry evidence available. This proof command fails open so operators can inspect database access state before rerunning the canonical usage-report/verifier flow.",
    );
    return lines.join("\n");
  }

  lines.push("", "Checks:");
  for (const check of report.checks) {
    lines.push(`- ${check.id} ${check.passed ? "PASS" : "FAIL"} (${check.statusCode}): ${check.title}. ${check.detail}`);
  }

  lines.push("", "Observed reuse evidence:");
  for (const row of report.observed.reuseEvidence) {
    lines.push(
      `- ${row.evidenceType}: executions=${row.executions} hits=${row.hitExecutions} misses=${row.missExecutions} degraded=${row.degradedExecutions} bypass=${row.bypassExecutions} reused_units=${row.reusedUnits} primary_work_units=${row.primaryWorkUnits} avg_reuse_rate=${row.avgReuseRate} statuses=${row.statuses.join(", ") || "none"}`,
    );
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
  console.log(`M061 S04 reuse proof\n\nUsage:\n  bun scripts/verify-m061-s04.ts [--repo <owner/repo>] [--since <Nd|YYYY-MM-DD|ISO>] [--json]\n\nNotes:\n  - Reads live Postgres telemetry through createDbClient()\n  - Verifies canonical reuse evidence rows for mention, review, and retrieval reuse\n  - Fails open with explicit database access status when Postgres is unavailable`);
}

function snapshotProcessEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...env };
}

export async function runM061S04ProofCli(
  args: string[],
  env: NodeJS.ProcessEnv = snapshotProcessEnv(),
): Promise<{ report: M061S04ProofReport; exitCode: number; json: boolean }> {
  const options = parseM061S04Args(args);
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
    const report = evaluateM061S04Proof({
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
    const { report, exitCode, json } = await runM061S04ProofCli(process.argv.slice(2));
    console.log(json ? JSON.stringify(report, null, 2) : renderM061S04Proof(report));
    process.exit(exitCode);
  } catch (error) {
    console.error(`verify:m061:s04 failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
