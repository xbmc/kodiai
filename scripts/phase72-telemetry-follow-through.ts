import { parseArgs } from "node:util";
import pino from "pino";
import { createDbClient, type Sql } from "../src/db/client.ts";

const REVIEW_EVENT_TYPE_DEFAULT = "pull_request.review_requested";
const MENTION_EVENT_TYPE_DEFAULT = "issue_comment.created";
const FAILING_CONCLUSIONS = new Set(["error", "failed", "failure", "timeout"]);

export const LOCKED_CACHE_SEQUENCE = ["prime", "hit", "changed-query-miss"] as const;

type CacheOutcome = (typeof LOCKED_CACHE_SEQUENCE)[number];
type Surface = "review_requested" | "kodiai_mention";
type AccessState = "available" | "missing" | "unavailable";

export type ScenarioStep = {
  surface: Surface;
  outcome: CacheOutcome;
  deliveryId: string;
  eventType: string;
  queryLabel: string;
};

export type VerificationCheck = {
  id: string;
  title: string;
  passed: boolean;
  details: string;
};

export type Phase72VerificationReport = {
  overallPassed: boolean;
  checks: VerificationCheck[];
  scenario: ScenarioStep[];
};

export type Phase72QueryResult = {
  executions: Array<{ deliveryId: string; eventType: string; conclusion: string }>;
  rateLimits: Array<{ deliveryId: string; eventType: string; cacheHitRate: number }>;
  duplicates: Array<{ deliveryId: string; eventType: string; count: number }>;
};

export type Phase72Report = {
  command: "verify:phase72";
  generatedAt: string;
  preflight: {
    databaseAccess: AccessState;
    detail: string;
  };
  checks: VerificationCheck[];
  overallPassed: boolean;
  scenario: ScenarioStep[];
};

type BuildScenarioInput = {
  review: Record<CacheOutcome, string>;
  mention: Record<CacheOutcome, string>;
  reviewEventType?: string;
  mentionEventType?: string;
};

function expectedCacheHitRate(outcome: CacheOutcome): number {
  return outcome === "hit" ? 1 : 0;
}

function asOutcomeRecord(values: string[], label: string): Record<CacheOutcome, string> {
  if (values.length !== LOCKED_CACHE_SEQUENCE.length) {
    throw new Error(`${label} requires exactly ${LOCKED_CACHE_SEQUENCE.length} values`);
  }
  const [prime, hit, changed] = values;
  if (!prime || !hit || !changed) {
    throw new Error(`${label} values must all be non-empty`);
  }
  return { prime, hit, "changed-query-miss": changed };
}

export function buildDeterministicScenario(input: BuildScenarioInput): ScenarioStep[] {
  const reviewEventType = input.reviewEventType ?? REVIEW_EVENT_TYPE_DEFAULT;
  const mentionEventType = input.mentionEventType ?? MENTION_EVENT_TYPE_DEFAULT;

  const reviewSteps = LOCKED_CACHE_SEQUENCE.map((outcome) => ({
    surface: "review_requested" as const,
    outcome,
    deliveryId: input.review[outcome],
    eventType: reviewEventType,
    queryLabel: outcome === "changed-query-miss" ? "phase72-review-query-v2" : "phase72-review-query-v1",
  }));

  const mentionSteps = LOCKED_CACHE_SEQUENCE.map((outcome) => ({
    surface: "kodiai_mention" as const,
    outcome,
    deliveryId: input.mention[outcome],
    eventType: mentionEventType,
    queryLabel: outcome === "changed-query-miss" ? "phase72-mention-query-v2" : "phase72-mention-query-v1",
  }));

  return [...reviewSteps, ...mentionSteps];
}

export function assertLockedOrdering(steps: ScenarioStep[]): void {
  for (const surface of ["review_requested", "kodiai_mention"] as const) {
    const outcomes = steps.filter((step) => step.surface === surface).map((step) => step.outcome);
    if (
      outcomes.length !== LOCKED_CACHE_SEQUENCE.length
      || outcomes.some((value, index) => value !== LOCKED_CACHE_SEQUENCE[index])
    ) {
      throw new Error(
        `Locked cache ordering violated for ${surface}. Expected ${LOCKED_CACHE_SEQUENCE.join(" -> ")}, got ${outcomes.join(" -> ")}`,
      );
    }
  }
}

function keyFor(deliveryId: string, eventType: string): string {
  return `${deliveryId}:${eventType}`;
}

export function evaluatePhase72Verification(result: Phase72QueryResult, steps: ScenarioStep[]): Phase72VerificationReport {
  assertLockedOrdering(steps);

  const executionMap = new Map<string, Array<{ conclusion: string }>>();
  for (const row of result.executions) {
    const key = keyFor(row.deliveryId, row.eventType);
    const existing = executionMap.get(key) ?? [];
    existing.push({ conclusion: row.conclusion });
    executionMap.set(key, existing);
  }

  const rateLimitMap = new Map<string, Array<{ cacheHitRate: number }>>();
  for (const row of result.rateLimits) {
    const key = keyFor(row.deliveryId, row.eventType);
    const existing = rateLimitMap.get(key) ?? [];
    existing.push({ cacheHitRate: row.cacheHitRate });
    rateLimitMap.set(key, existing);
  }

  const missingExecutions: string[] = [];
  const blockedExecutions: string[] = [];
  for (const step of steps) {
    const rows = executionMap.get(keyFor(step.deliveryId, step.eventType)) ?? [];
    if (rows.length === 0) {
      missingExecutions.push(keyFor(step.deliveryId, step.eventType));
      continue;
    }
    const hasNonBlockingConclusion = rows.some((row) => !FAILING_CONCLUSIONS.has(row.conclusion.toLowerCase()));
    if (!hasNonBlockingConclusion) {
      blockedExecutions.push(`${keyFor(step.deliveryId, step.eventType)} (${rows.map((row) => row.conclusion).join(",")})`);
    }
  }

  const reviewSteps = steps.filter((step) => step.surface === "review_requested");
  const missingRateRows: string[] = [];
  const wrongRateRows: string[] = [];
  const observedSequence: number[] = [];
  for (const step of reviewSteps) {
    const rows = rateLimitMap.get(keyFor(step.deliveryId, step.eventType)) ?? [];
    if (rows.length !== 1) {
      missingRateRows.push(`${keyFor(step.deliveryId, step.eventType)} (rows=${rows.length})`);
      continue;
    }
    const observed = rows[0]?.cacheHitRate ?? -1;
    observedSequence.push(observed);
    const expected = expectedCacheHitRate(step.outcome);
    if (observed !== expected) {
      wrongRateRows.push(`${keyFor(step.deliveryId, step.eventType)} expected=${expected} observed=${observed}`);
    }
  }

  const checks: VerificationCheck[] = [
    {
      id: "DB-C1",
      title: "Both trigger surfaces executed in locked scenario",
      passed: missingExecutions.length === 0,
      details:
        missingExecutions.length === 0
          ? `Found telemetry_events rows for all ${steps.length} deterministic runs across review_requested and @kodiai mention surfaces.`
          : `Missing execution evidence for identities: ${missingExecutions.join(", ")}`,
    },
    {
      id: "DB-C2",
      title: "Review trigger cache telemetry follows prime -> hit -> changed-query miss",
      passed: missingRateRows.length === 0 && wrongRateRows.length === 0,
      details:
        missingRateRows.length === 0 && wrongRateRows.length === 0
          ? `Observed cache_hit_rate sequence ${observedSequence.join(" -> ")} for review_requested deterministic run identities.`
          : [...missingRateRows, ...wrongRateRows].join("; "),
    },
    {
      id: "DB-C3",
      title: "No duplicate rate_limit_events per delivery_id + event_type identity",
      passed: result.duplicates.length === 0,
      details:
        result.duplicates.length === 0
          ? "No duplicate composite identities detected in rate_limit_events for this verification run."
          : result.duplicates.map((row) => `${row.deliveryId}:${row.eventType} (count=${row.count})`).join(", "),
    },
    {
      id: "DB-C4",
      title: "Execution conclusions confirm telemetry path stays non-blocking",
      passed: blockedExecutions.length === 0,
      details:
        blockedExecutions.length === 0
          ? "Every deterministic run has a non-failing telemetry_events conclusion, indicating telemetry persistence stayed non-blocking."
          : `Blocking/failed conclusions detected: ${blockedExecutions.join("; ")}`,
    },
  ];

  return {
    overallPassed: checks.every((check) => check.passed),
    checks,
    scenario: steps,
  };
}

export function buildPhase72Report(input: {
  generatedAt: string;
  accessState: AccessState;
  accessDetail: string;
  scenario: ScenarioStep[];
  verification: Phase72VerificationReport | null;
}): Phase72Report {
  return {
    command: "verify:phase72",
    generatedAt: input.generatedAt,
    preflight: {
      databaseAccess: input.accessState,
      detail: input.accessDetail,
    },
    overallPassed: input.accessState === "available" ? (input.verification?.overallPassed ?? false) : false,
    checks: input.verification?.checks ?? [],
    scenario: input.scenario,
  };
}

export function renderOperatorSummary(report: Phase72Report): string {
  const header = [
    "Phase 72 telemetry follow-through verifier",
    `Database access: ${report.preflight.databaseAccess}`,
    `Preflight detail: ${report.preflight.detail}`,
  ];

  if (report.preflight.databaseAccess !== "available") {
    return [
      ...header,
      "",
      "No live telemetry evidence available. This verifier failed open so operators can see the Postgres access state instead of relying on stale SQLite data.",
    ].join("\n");
  }

  const passedIds = report.checks.filter((check) => check.passed).map((check) => check.id);
  const failedChecks = report.checks.filter((check) => !check.passed);
  const failureList = failedChecks.map((check) => check.id).join(", ");

  const analysisHeader =
    "Analysis: This run evaluates live telemetry evidence for exactly-once and non-blocking behavior across review_requested and explicit @kodiai mention surfaces.";
  const riskLine =
    "Risk note: Residual operational risk can still emerge from unexercised inputs, so this scenario is release evidence for the locked sequence only and should run once per milestone.";
  const evidenceLines = report.checks.map((check) =>
    `- ${check.id} ${check.passed ? "PASS" : "FAIL"}: ${check.title}. ${check.details}`,
  );
  const verdict = report.overallPassed
    ? `Final verdict: PASS - Evidence-backed reliability checks [${passedIds.join(", ")}] passed for this milestone verification run.`
    : `Final verdict: FAIL - Evidence-backed reliability checks are incomplete; failed checks [${failureList}] require investigation before milestone sign-off.`;

  return [...header, "", analysisHeader, riskLine, "", "Evidence:", ...evidenceLines, "", verdict].join("\n");
}

export function validateSummaryLanguage(summary: string): string[] {
  const errors: string[] = [];
  const verdictLine = summary.split("\n").find((line) => line.startsWith("Final verdict:"));
  if (!verdictLine) {
    errors.push("Summary is missing a Final verdict line.");
    return errors;
  }

  if (!summary.toLowerCase().includes("risk note:")) {
    errors.push("Summary must include explicit risk framing in analysis section.");
  }
  if (/(risk|uncertain|partial|demurral)/i.test(verdictLine)) {
    errors.push("Final verdict line must not include demurral or risk language.");
  }
  if (verdictLine.includes("PASS") && !/\[DB-C\d+(,\s*DB-C\d+)*\]/.test(verdictLine)) {
    errors.push("PASS verdict must cite evidence check IDs.");
  }
  if (/(guaranteed|certain|definitive|proven|proof-positive)/i.test(verdictLine) && !/\[DB-C\d+/.test(verdictLine)) {
    errors.push("Final verdict certainty language requires explicit evidence citations.");
  }
  const analysisLine = summary.split("\n").find((line) => line.startsWith("Analysis:"));
  if (!analysisLine || !/evidence/i.test(analysisLine)) {
    errors.push("Analysis section must anchor claims in evidence.");
  }
  return errors;
}

async function queryPhase72Result(sql: Sql, steps: ScenarioStep[]): Promise<Phase72QueryResult> {
  const deliveryIds = [...new Set(steps.map((step) => step.deliveryId))];
  const executions = await sql<Array<{ deliveryId: string; eventType: string; conclusion: string }>>`
    SELECT delivery_id AS "deliveryId", event_type AS "eventType", conclusion
    FROM telemetry_events
    WHERE delivery_id = ANY(${deliveryIds})
  `;
  const rateLimits = await sql<Array<{ deliveryId: string; eventType: string; cacheHitRate: number }>>`
    SELECT delivery_id AS "deliveryId", event_type AS "eventType", cache_hit_rate AS "cacheHitRate"
    FROM rate_limit_events
    WHERE delivery_id = ANY(${deliveryIds})
  `;
  const duplicates = await sql<Array<{ deliveryId: string; eventType: string; count: number }>>`
    SELECT delivery_id AS "deliveryId", event_type AS "eventType", COUNT(*)::int AS count
    FROM rate_limit_events
    WHERE delivery_id = ANY(${deliveryIds})
    GROUP BY delivery_id, event_type
    HAVING COUNT(*) > 1
  `;

  return { executions, rateLimits, duplicates };
}

function printUsage(): void {
  console.log(`Phase 72 telemetry follow-through verifier\n\nUsage:\n  bun scripts/phase72-telemetry-follow-through.ts \\\n    --review <prime> --review <hit> --review <changed> \\\n    --mention <prime> --mention <hit> --mention <changed> [--json]\n\nNotes:\n  - Reads live Postgres telemetry via createDbClient()\n  - Fails open with explicit database access status when Postgres is unavailable`);
}

async function runCli(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<{ report: Phase72Report; exitCode: number; json: boolean }> {
  const parsed = parseArgs({
    args,
    options: {
      review: { type: "string", multiple: true },
      mention: { type: "string", multiple: true },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
      "review-event-type": { type: "string", default: REVIEW_EVENT_TYPE_DEFAULT },
      "mention-event-type": { type: "string", default: MENTION_EVENT_TYPE_DEFAULT },
    },
    strict: true,
    allowPositionals: false,
  });

  if (parsed.values.help) {
    printUsage();
    return {
      report: buildPhase72Report({
        generatedAt: new Date().toISOString(),
        accessState: "missing",
        accessDetail: "Help requested.",
        scenario: [],
        verification: null,
      }),
      exitCode: 0,
      json: Boolean(parsed.values.json),
    };
  }

  const scenario = buildDeterministicScenario({
    review: asOutcomeRecord(parsed.values.review ?? [], "--review"),
    mention: asOutcomeRecord(parsed.values.mention ?? [], "--mention"),
    reviewEventType: parsed.values["review-event-type"],
    mentionEventType: parsed.values["mention-event-type"],
  });

  const connectionString = env.TEST_DATABASE_URL ?? env.DATABASE_URL ?? null;
  if (!connectionString) {
    return {
      report: buildPhase72Report({
        generatedAt: new Date().toISOString(),
        accessState: "missing",
        accessDetail: "Neither TEST_DATABASE_URL nor DATABASE_URL is set.",
        scenario,
        verification: null,
      }),
      exitCode: 0,
      json: Boolean(parsed.values.json),
    };
  }

  const logger = pino({ level: "silent" });
  let client: ReturnType<typeof createDbClient> | null = null;
  try {
    client = createDbClient({ connectionString, logger });
    const queryResult = await queryPhase72Result(client.sql, scenario);
    const verification = evaluatePhase72Verification(queryResult, scenario);
    return {
      report: buildPhase72Report({
        generatedAt: new Date().toISOString(),
        accessState: "available",
        accessDetail: "Connected to telemetry Postgres.",
        scenario,
        verification,
      }),
      exitCode: verification.overallPassed ? 0 : 1,
      json: Boolean(parsed.values.json),
    };
  } catch (error) {
    return {
      report: buildPhase72Report({
        generatedAt: new Date().toISOString(),
        accessState: "unavailable",
        accessDetail: error instanceof Error ? error.message : String(error),
        scenario,
        verification: null,
      }),
      exitCode: 0,
      json: Boolean(parsed.values.json),
    };
  } finally {
    await client?.close();
  }
}

if (import.meta.main) {
  try {
    const { report, exitCode, json } = await runCli(process.argv.slice(2));
    const output = json
      ? JSON.stringify(report, null, 2)
      : renderOperatorSummary(report);
    const languageErrors = report.preflight.databaseAccess === "available" ? validateSummaryLanguage(output) : [];
    if (languageErrors.length > 0) {
      throw new Error(`Summary language guardrails failed: ${languageErrors.join(" | ")}`);
    }
    console.log(output);
    process.exit(exitCode);
  } catch (error) {
    console.error(`Phase 72 verification failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
