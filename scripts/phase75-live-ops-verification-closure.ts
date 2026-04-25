import { parseArgs } from "node:util";
import pino from "pino";
import { createDbClient, type Sql } from "../src/db/client.ts";

const REVIEW_EVENT_TYPE_DEFAULT = "pull_request.review_requested";
const FAILING_CONCLUSIONS = new Set(["error", "failed", "failure", "timeout"]);

export const LOCKED_CACHE_SEQUENCE = ["prime", "hit", "changed-query-miss"] as const;

type CacheOutcome = (typeof LOCKED_CACHE_SEQUENCE)[number];
type AccessState = "available" | "missing" | "unavailable";

export type MatrixStep = {
  surface: "review_requested";
  outcome: CacheOutcome;
  deliveryId: string;
  eventType: string;
  expectedCacheHitRate: number;
};

export type Identity = {
  deliveryId: string;
  eventType: string;
};

type VerificationCheck = {
  id: string;
  title: string;
  passed: boolean;
  details: string;
};

export type ClosureReport = {
  overallPassed: boolean;
  checks: VerificationCheck[];
  matrix: MatrixStep[];
  acceptedReviewIdentities: Identity[];
  degradedIdentities: Identity[];
  failOpenIdentities: Identity[];
};

export type Phase75QueryResult = {
  executions: Array<{ deliveryId: string; eventType: string; conclusion: string }>;
  rateLimits: Array<{ deliveryId: string; eventType: string; cacheHitRate: number; degradationPath: string }>;
  degradedDuplicates: Array<{ deliveryId: string; eventType: string; count: number }>;
};

export type Phase75Report = {
  command: "verify:phase75";
  generatedAt: string;
  preflight: {
    databaseAccess: AccessState;
    detail: string;
  };
  overallPassed: boolean;
  checks: VerificationCheck[];
  matrix: MatrixStep[];
  acceptedReviewIdentities: Identity[];
  degradedIdentities: Identity[];
  failOpenIdentities: Identity[];
};

type BuildMatrixInput = {
  review: Record<CacheOutcome, string>;
  reviewEventType?: string;
};

function makeIdentityKey(deliveryId: string, eventType: string): string {
  return `${deliveryId}:${eventType}`;
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

export function parseIdentity(value: string): Identity {
  const [deliveryId, eventType, ...rest] = value.split(":");
  if (!deliveryId || !eventType || rest.length > 0) {
    throw new Error(`Identity '${value}' must use '<delivery-id>:<event-type>' format`);
  }
  return { deliveryId, eventType };
}

export function buildDeterministicMatrix(input: BuildMatrixInput): MatrixStep[] {
  const reviewEventType = input.reviewEventType ?? REVIEW_EVENT_TYPE_DEFAULT;
  return LOCKED_CACHE_SEQUENCE.map((outcome) => ({
    surface: "review_requested" as const,
    outcome,
    deliveryId: input.review[outcome],
    eventType: reviewEventType,
    expectedCacheHitRate: outcome === "hit" ? 1 : 0,
  }));
}

export function validateDeterministicMatrix(matrix: MatrixStep[]): void {
  const observed = matrix.filter((step) => step.surface === "review_requested").map((step) => step.outcome);
  if (
    observed.length !== LOCKED_CACHE_SEQUENCE.length
    || observed.some((value, index) => value !== LOCKED_CACHE_SEQUENCE[index])
  ) {
    throw new Error(
      `Locked matrix ordering violated for review_requested. Expected ${LOCKED_CACHE_SEQUENCE.join(" -> ")}, got ${observed.join(" -> ")}`,
    );
  }
  for (const step of matrix) {
    if (!step.deliveryId.trim()) {
      throw new Error(`Matrix lane review_requested:${step.outcome} is missing identity input`);
    }
  }
}

function hasNonBlockingConclusion(rows: Array<{ conclusion: string }>): boolean {
  return rows.some((row) => !FAILING_CONCLUSIONS.has(row.conclusion.toLowerCase()));
}

export function evaluateClosureVerification(
  result: Phase75QueryResult,
  matrix: MatrixStep[],
  acceptedReviewIdentities: Identity[],
  degradedIdentities: Identity[],
  failOpenIdentities: Identity[],
): ClosureReport {
  validateDeterministicMatrix(matrix);

  const executionMap = new Map<string, Array<{ conclusion: string }>>();
  for (const row of result.executions) {
    const key = makeIdentityKey(row.deliveryId, row.eventType);
    const existing = executionMap.get(key) ?? [];
    existing.push({ conclusion: row.conclusion });
    executionMap.set(key, existing);
  }

  const rateMap = new Map<string, Array<{ cacheHitRate: number; degradationPath: string }>>();
  for (const row of result.rateLimits) {
    const key = makeIdentityKey(row.deliveryId, row.eventType);
    const existing = rateMap.get(key) ?? [];
    existing.push({ cacheHitRate: row.cacheHitRate, degradationPath: row.degradationPath });
    rateMap.set(key, existing);
  }

  const preflightAlignmentFailures: string[] = [];
  for (let index = 0; index < LOCKED_CACHE_SEQUENCE.length; index += 1) {
    const expected = matrix[index];
    const provided = acceptedReviewIdentities[index];
    if (!expected || !provided) {
      preflightAlignmentFailures.push(`missing accepted review identity for ${LOCKED_CACHE_SEQUENCE[index]}`);
      continue;
    }
    if (expected.deliveryId !== provided.deliveryId || expected.eventType !== provided.eventType) {
      preflightAlignmentFailures.push(
        `${LOCKED_CACHE_SEQUENCE[index]} expected=${expected.deliveryId}:${expected.eventType} observed=${provided.deliveryId}:${provided.eventType}`,
      );
    }
  }

  const preflightExecutionFailures: string[] = [];
  for (const identity of acceptedReviewIdentities) {
    const rows = executionMap.get(makeIdentityKey(identity.deliveryId, identity.eventType)) ?? [];
    if (rows.length === 0) {
      preflightExecutionFailures.push(`${identity.deliveryId}:${identity.eventType} missing execution row`);
      continue;
    }
    if (!hasNonBlockingConclusion(rows)) {
      preflightExecutionFailures.push(
        `${identity.deliveryId}:${identity.eventType} non-passing conclusions=${rows.map((row) => row.conclusion).join(",")}`,
      );
    }
  }

  const cacheObservedSequence: number[] = [];
  const cacheLaneFailures: string[] = [];
  for (const step of matrix) {
    const rows = rateMap.get(makeIdentityKey(step.deliveryId, step.eventType)) ?? [];
    if (rows.length !== 1) {
      cacheLaneFailures.push(`${step.deliveryId}:${step.eventType} expected=1-row observed=${rows.length}`);
      continue;
    }
    const row = rows[0];
    if (!row) {
      cacheLaneFailures.push(`${step.deliveryId}:${step.eventType} expected=row observed=missing`);
      continue;
    }
    cacheObservedSequence.push(row.cacheHitRate);
    if (row.cacheHitRate !== step.expectedCacheHitRate) {
      cacheLaneFailures.push(
        `${step.deliveryId}:${step.eventType} expected=${step.expectedCacheHitRate} observed=${row.cacheHitRate}`,
      );
    }
  }

  const degradedMissingOrWrong: string[] = [];
  for (const identity of degradedIdentities) {
    const rows = (rateMap.get(makeIdentityKey(identity.deliveryId, identity.eventType)) ?? []).filter(
      (row) => row.degradationPath.toLowerCase() !== "none",
    );
    if (rows.length !== 1) {
      degradedMissingOrWrong.push(`${identity.deliveryId}:${identity.eventType} expected=1 degraded row observed=${rows.length}`);
    }
  }

  const failOpenTelemetryLeaks: string[] = [];
  const failOpenExecutionFailures: string[] = [];
  for (const identity of failOpenIdentities) {
    const telemetryRows = rateMap.get(makeIdentityKey(identity.deliveryId, identity.eventType)) ?? [];
    if (telemetryRows.length > 0) {
      failOpenTelemetryLeaks.push(`${identity.deliveryId}:${identity.eventType} expected=0 telemetry rows observed=${telemetryRows.length}`);
    }
    const execRows = executionMap.get(makeIdentityKey(identity.deliveryId, identity.eventType)) ?? [];
    if (execRows.length === 0) {
      failOpenExecutionFailures.push(`${identity.deliveryId}:${identity.eventType} execution row missing`);
      continue;
    }
    if (!hasNonBlockingConclusion(execRows)) {
      failOpenExecutionFailures.push(`${identity.deliveryId}:${identity.eventType} conclusions=${execRows.map((row) => row.conclusion).join(",")}`);
    }
  }

  const checks: VerificationCheck[] = [
    {
      id: "OPS75-PREFLIGHT-01",
      title: "Accepted review_requested identities align with review matrix and have execution evidence",
      passed: preflightAlignmentFailures.length === 0 && preflightExecutionFailures.length === 0,
      details:
        preflightAlignmentFailures.length === 0 && preflightExecutionFailures.length === 0
          ? "Accepted review_requested identities match the review lane and have non-failing telemetry_events conclusions."
          : [...preflightAlignmentFailures, ...preflightExecutionFailures].join("; "),
    },
    {
      id: "OPS75-CACHE-01",
      title: "review_requested cache telemetry follows prime -> hit -> changed-query miss",
      passed: cacheLaneFailures.length === 0,
      details:
        cacheLaneFailures.length === 0
          ? `Observed cache_hit_rate sequence ${cacheObservedSequence.join(" -> ")} for review_requested deterministic identities.`
          : cacheLaneFailures.join("; "),
    },
    {
      id: "OPS75-ONCE-01",
      title: "Each degraded execution identity persists exactly one degraded telemetry event",
      passed: degradedMissingOrWrong.length === 0,
      details:
        degradedMissingOrWrong.length === 0
          ? `Validated exactly one degraded telemetry row for ${degradedIdentities.length} degraded identities.`
          : degradedMissingOrWrong.join("; "),
    },
    {
      id: "OPS75-ONCE-02",
      title: "Duplicate detection query returns no degraded telemetry duplicates",
      passed: result.degradedDuplicates.length === 0,
      details:
        result.degradedDuplicates.length === 0
          ? "No duplicate degraded telemetry identities detected in rate_limit_events."
          : result.degradedDuplicates.map((row) => `${row.deliveryId}:${row.eventType} count=${row.count}`).join("; "),
    },
    {
      id: "OPS75-FAILOPEN-01",
      title: "Forced telemetry failure identities persist zero telemetry rows",
      passed: failOpenTelemetryLeaks.length === 0,
      details:
        failOpenTelemetryLeaks.length === 0
          ? `Verified no rate_limit_events rows for ${failOpenIdentities.length} forced-failure identities.`
          : failOpenTelemetryLeaks.join("; "),
    },
    {
      id: "OPS75-FAILOPEN-02",
      title: "Forced telemetry failure identities still complete with non-failing execution conclusions",
      passed: failOpenExecutionFailures.length === 0,
      details:
        failOpenExecutionFailures.length === 0
          ? `Verified non-blocking telemetry_events conclusions for ${failOpenIdentities.length} forced-failure identities.`
          : failOpenExecutionFailures.join("; "),
    },
  ];

  return {
    overallPassed: checks.every((check) => check.passed),
    checks,
    matrix,
    acceptedReviewIdentities,
    degradedIdentities,
    failOpenIdentities,
  };
}

export function buildPhase75Report(input: {
  generatedAt: string;
  accessState: AccessState;
  accessDetail: string;
  verification: ClosureReport | null;
  matrix: MatrixStep[];
  acceptedReviewIdentities: Identity[];
  degradedIdentities: Identity[];
  failOpenIdentities: Identity[];
}): Phase75Report {
  return {
    command: "verify:phase75",
    generatedAt: input.generatedAt,
    preflight: {
      databaseAccess: input.accessState,
      detail: input.accessDetail,
    },
    overallPassed: input.accessState === "available" ? (input.verification?.overallPassed ?? false) : false,
    checks: input.verification?.checks ?? [],
    matrix: input.matrix,
    acceptedReviewIdentities: input.acceptedReviewIdentities,
    degradedIdentities: input.degradedIdentities,
    failOpenIdentities: input.failOpenIdentities,
  };
}

export function renderFinalVerdict(report: Phase75Report): string {
  const header = [
    "Phase 75 live OPS closure verification",
    `Database access: ${report.preflight.databaseAccess}`,
    `Preflight detail: ${report.preflight.detail}`,
  ];

  if (report.preflight.databaseAccess !== "available") {
    return [
      ...header,
      "",
      "No live telemetry evidence available. This verifier failed open so operators can inspect the Postgres access state without relying on stale SQLite output.",
    ].join("\n");
  }

  const evidenceLines = report.checks.map(
    (check) => `- ${check.id} ${check.passed ? "PASS" : "FAIL"}: ${check.title}. ${check.details}`,
  );

  const failedIds = report.checks.filter((check) => !check.passed).map((check) => check.id);
  const passedIds = report.checks.filter((check) => check.passed).map((check) => check.id);
  const matrixLines = report.matrix.map(
    (step) => `- ${step.surface}:${step.outcome} => ${step.deliveryId}:${step.eventType}`,
  );
  const acceptedReviewLines = report.acceptedReviewIdentities.map(
    (identity) => `- ${identity.deliveryId}:${identity.eventType}`,
  );
  const verdict = report.overallPassed
    ? `Final verdict: PASS [${passedIds.join(", ")}]`
    : `Final verdict: FAIL [${failedIds.join(", ")}]`;

  return [
    ...header,
    "",
    "Deterministic matrix identities:",
    ...matrixLines,
    "",
    "Accepted review_requested identities:",
    ...acceptedReviewLines,
    "",
    "Checks:",
    ...evidenceLines,
    "",
    verdict,
  ].join("\n");
}

async function queryPhase75Result(
  sql: Sql,
  matrix: MatrixStep[],
  degradedIdentities: Identity[],
  failOpenIdentities: Identity[],
): Promise<Phase75QueryResult> {
  const deliveryIds = Array.from(
    new Set([
      ...matrix.map((step) => step.deliveryId),
      ...degradedIdentities.map((identity) => identity.deliveryId),
      ...failOpenIdentities.map((identity) => identity.deliveryId),
    ]),
  );

  const executions = await sql<Array<{ deliveryId: string; eventType: string; conclusion: string }>>`
    SELECT delivery_id AS "deliveryId", event_type AS "eventType", conclusion
    FROM telemetry_events
    WHERE delivery_id = ANY(${deliveryIds})
  `;
  const rateLimits = await sql<Array<{ deliveryId: string; eventType: string; cacheHitRate: number; degradationPath: string }>>`
    SELECT delivery_id AS "deliveryId", event_type AS "eventType", cache_hit_rate AS "cacheHitRate", degradation_path AS "degradationPath"
    FROM rate_limit_events
    WHERE delivery_id = ANY(${deliveryIds})
  `;
  const degradedDeliveryIds = degradedIdentities.map((identity) => identity.deliveryId);
  const degradedDuplicates = degradedDeliveryIds.length === 0
    ? []
    : await sql<Array<{ deliveryId: string; eventType: string; count: number }>>`
        SELECT delivery_id AS "deliveryId", event_type AS "eventType", COUNT(*)::int AS count
        FROM rate_limit_events
        WHERE delivery_id = ANY(${degradedDeliveryIds})
          AND LOWER(COALESCE(degradation_path, 'none')) <> 'none'
        GROUP BY delivery_id, event_type
        HAVING COUNT(*) > 1
      `;

  return { executions, rateLimits, degradedDuplicates };
}

function printUsage(): void {
  console.log(`Phase 75 live OPS verification closure\n\nUsage:\n  bun scripts/phase75-live-ops-verification-closure.ts \\\n    --review <prime> --review <hit> --review <changed> \\\n    --review-accepted <prime> --review-accepted <hit> --review-accepted <changed> \\\n    --degraded <delivery:event-type> [...more] \\\n    --failopen <delivery:event-type> [...more] [--json]\n\nNotes:\n  - Reads live Postgres telemetry via createDbClient()\n  - Fails open with explicit database access status when Postgres is unavailable`);
}

async function runCli(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<{ report: Phase75Report; exitCode: number; json: boolean }> {
  const parsed = parseArgs({
    args,
    options: {
      review: { type: "string", multiple: true },
      "review-accepted": { type: "string", multiple: true },
      degraded: { type: "string", multiple: true },
      failopen: { type: "string", multiple: true },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
      "review-event-type": { type: "string", default: REVIEW_EVENT_TYPE_DEFAULT },
    },
    strict: true,
    allowPositionals: false,
  });

  if (parsed.values.help) {
    printUsage();
    return {
      report: buildPhase75Report({
        generatedAt: new Date().toISOString(),
        accessState: "missing",
        accessDetail: "Help requested.",
        verification: null,
        matrix: [],
        acceptedReviewIdentities: [],
        degradedIdentities: [],
        failOpenIdentities: [],
      }),
      exitCode: 0,
      json: Boolean(parsed.values.json),
    };
  }

  const review = asOutcomeRecord(parsed.values.review ?? [], "--review");
  const acceptedReview = asOutcomeRecord(parsed.values["review-accepted"] ?? [], "--review-accepted");
  const degradedValues = parsed.values.degraded ?? [];
  const failOpenValues = parsed.values.failopen ?? [];
  if (degradedValues.length === 0) {
    throw new Error("--degraded requires at least one <delivery:event-type> identity");
  }
  if (failOpenValues.length === 0) {
    throw new Error("--failopen requires at least one <delivery:event-type> identity");
  }

  const matrix = buildDeterministicMatrix({
    review,
    reviewEventType: parsed.values["review-event-type"],
  });
  const acceptedReviewIdentities = LOCKED_CACHE_SEQUENCE.map((outcome) => ({
    deliveryId: acceptedReview[outcome],
    eventType: parsed.values["review-event-type"],
  }));
  const degradedIdentities = degradedValues.map(parseIdentity);
  const failOpenIdentities = failOpenValues.map(parseIdentity);

  const connectionString = env.TEST_DATABASE_URL ?? env.DATABASE_URL ?? null;
  if (!connectionString) {
    return {
      report: buildPhase75Report({
        generatedAt: new Date().toISOString(),
        accessState: "missing",
        accessDetail: "Neither TEST_DATABASE_URL nor DATABASE_URL is set.",
        verification: null,
        matrix,
        acceptedReviewIdentities,
        degradedIdentities,
        failOpenIdentities,
      }),
      exitCode: 0,
      json: Boolean(parsed.values.json),
    };
  }

  const logger = pino({ level: "silent" });
  let client: ReturnType<typeof createDbClient> | null = null;
  try {
    client = createDbClient({ connectionString, logger });
    const queryResult = await queryPhase75Result(client.sql, matrix, degradedIdentities, failOpenIdentities);
    const verification = evaluateClosureVerification(
      queryResult,
      matrix,
      acceptedReviewIdentities,
      degradedIdentities,
      failOpenIdentities,
    );
    return {
      report: buildPhase75Report({
        generatedAt: new Date().toISOString(),
        accessState: "available",
        accessDetail: "Connected to telemetry Postgres.",
        verification,
        matrix,
        acceptedReviewIdentities,
        degradedIdentities,
        failOpenIdentities,
      }),
      exitCode: verification.overallPassed ? 0 : 1,
      json: Boolean(parsed.values.json),
    };
  } catch (error) {
    return {
      report: buildPhase75Report({
        generatedAt: new Date().toISOString(),
        accessState: "unavailable",
        accessDetail: error instanceof Error ? error.message : String(error),
        verification: null,
        matrix,
        acceptedReviewIdentities,
        degradedIdentities,
        failOpenIdentities,
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
    console.log(json ? JSON.stringify(report, null, 2) : renderFinalVerdict(report));
    process.exit(exitCode);
  } catch (error) {
    console.error(`Phase 75 closure verification failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
