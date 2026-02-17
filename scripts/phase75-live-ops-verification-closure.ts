import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const DEFAULT_DB_PATH = "./data/kodiai-telemetry.db";
const REVIEW_EVENT_TYPE_DEFAULT = "pull_request.review_requested";
const MENTION_EVENT_TYPE_DEFAULT = "issue_comment.created";

const FAILING_CONCLUSIONS = new Set(["error", "failed", "failure", "timeout"]);

export const LOCKED_CACHE_SEQUENCE = ["prime", "hit", "changed-query-miss"] as const;

type CacheOutcome = (typeof LOCKED_CACHE_SEQUENCE)[number];
type Surface = "review_requested" | "kodiai_mention";

export type MatrixStep = {
  surface: Surface;
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
  degradedIdentities: Identity[];
  failOpenIdentities: Identity[];
};

type BuildMatrixInput = {
  review: Record<CacheOutcome, string>;
  mention: Record<CacheOutcome, string>;
  reviewEventType?: string;
  mentionEventType?: string;
};

type ExecutionRow = {
  delivery_id: string;
  event_type: string;
  conclusion: string;
};

type RateLimitRow = {
  delivery_id: string;
  event_type: string;
  cache_hit_rate: number;
  degradation_path: string;
};

type DuplicateRow = {
  delivery_id: string;
  event_type: string;
  cnt: number;
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

  return {
    prime,
    hit,
    "changed-query-miss": changed,
  };
}

export function parseIdentity(value: string): Identity {
  const [deliveryId, eventType, ...rest] = value.split(":");
  if (!deliveryId || !eventType || rest.length > 0) {
    throw new Error(`Identity '${value}' must use '<delivery-id>:<event-type>' format`);
  }
  return { deliveryId, eventType };
}

function makeInClauseFromValues(values: string[]): string {
  if (values.length === 0) {
    return "('')";
  }
  const quoted = values.map((value) => `'${value.replace(/'/g, "''")}'`);
  return `(${quoted.join(",")})`;
}

function mapExecutionRows(rows: ExecutionRow[]): Map<string, ExecutionRow[]> {
  const mapped = new Map<string, ExecutionRow[]>();
  for (const row of rows) {
    const key = makeIdentityKey(row.delivery_id, row.event_type);
    const existing = mapped.get(key);
    if (existing) {
      existing.push(row);
    } else {
      mapped.set(key, [row]);
    }
  }
  return mapped;
}

function mapRateRows(rows: RateLimitRow[]): Map<string, RateLimitRow[]> {
  const mapped = new Map<string, RateLimitRow[]>();
  for (const row of rows) {
    const key = makeIdentityKey(row.delivery_id, row.event_type);
    const existing = mapped.get(key);
    if (existing) {
      existing.push(row);
    } else {
      mapped.set(key, [row]);
    }
  }
  return mapped;
}

export function buildDeterministicMatrix(input: BuildMatrixInput): MatrixStep[] {
  const reviewEventType = input.reviewEventType ?? REVIEW_EVENT_TYPE_DEFAULT;
  const mentionEventType = input.mentionEventType ?? MENTION_EVENT_TYPE_DEFAULT;

  const review = LOCKED_CACHE_SEQUENCE.map((outcome) => ({
    surface: "review_requested" as const,
    outcome,
    deliveryId: input.review[outcome],
    eventType: reviewEventType,
    expectedCacheHitRate: outcome === "hit" ? 1 : 0,
  }));

  const mention = LOCKED_CACHE_SEQUENCE.map((outcome) => ({
    surface: "kodiai_mention" as const,
    outcome,
    deliveryId: input.mention[outcome],
    eventType: mentionEventType,
    expectedCacheHitRate: outcome === "hit" ? 1 : 0,
  }));

  return [...review, ...mention];
}

export function validateDeterministicMatrix(matrix: MatrixStep[]): void {
  const expectedPerSurface = [...LOCKED_CACHE_SEQUENCE];
  const surfaces: Surface[] = ["review_requested", "kodiai_mention"];

  for (const surface of surfaces) {
    const lane = matrix.filter((step) => step.surface === surface);
    const observed = lane.map((step) => step.outcome);
    if (
      lane.length !== expectedPerSurface.length
      || observed.some((value, index) => value !== expectedPerSurface[index])
    ) {
      throw new Error(
        `Locked matrix ordering violated for ${surface}. Expected ${expectedPerSurface.join(" -> ")}, got ${observed.join(" -> ")}`,
      );
    }

    for (const step of lane) {
      if (!step.deliveryId.trim()) {
        throw new Error(`Matrix lane ${surface}:${step.outcome} is missing identity input`);
      }
    }
  }
}

function hasNonBlockingConclusion(rows: ExecutionRow[]): boolean {
  return rows.some((row) => !FAILING_CONCLUSIONS.has(row.conclusion.toLowerCase()));
}

export function evaluateClosureVerification(
  db: Database,
  matrix: MatrixStep[],
  degradedIdentities: Identity[],
  failOpenIdentities: Identity[],
): ClosureReport {
  validateDeterministicMatrix(matrix);

  const matrixDeliveryIds = matrix.map((step) => step.deliveryId);
  const degradedDeliveryIds = degradedIdentities.map((identity) => identity.deliveryId);
  const failOpenDeliveryIds = failOpenIdentities.map((identity) => identity.deliveryId);

  const allDeliveryIds = Array.from(new Set([...matrixDeliveryIds, ...degradedDeliveryIds, ...failOpenDeliveryIds]));
  const inClause = makeInClauseFromValues(allDeliveryIds);

  const executionRows = db
    .query<ExecutionRow, []>(
      `SELECT delivery_id, event_type, conclusion
       FROM executions
       WHERE delivery_id IN ${inClause}`,
    )
    .all();

  const rateRows = db
    .query<RateLimitRow, []>(
      `SELECT delivery_id, event_type, cache_hit_rate, degradation_path
       FROM rate_limit_events
       WHERE delivery_id IN ${inClause}`,
    )
    .all();

  const executionByIdentity = mapExecutionRows(executionRows);
  const rateByIdentity = mapRateRows(rateRows);

  const cacheFailures: string[] = [];
  const checkIdsBySurface = new Map<Surface, string>([
    ["review_requested", "OPS75-CACHE-01"],
    ["kodiai_mention", "OPS75-CACHE-02"],
  ]);

  const cacheChecks: VerificationCheck[] = [];
  for (const surface of ["review_requested", "kodiai_mention"] as const) {
    const lane = matrix.filter((step) => step.surface === surface);
    const observedSequence: number[] = [];
    const laneFailures: string[] = [];
    for (const step of lane) {
      const key = makeIdentityKey(step.deliveryId, step.eventType);
      const rows = rateByIdentity.get(key) ?? [];
      if (rows.length !== 1) {
        laneFailures.push(`${key} expected=1-row observed=${rows.length}`);
        continue;
      }
      const row = rows[0];
      if (!row) {
        laneFailures.push(`${key} expected=row observed=missing`);
        continue;
      }
      observedSequence.push(row.cache_hit_rate);
      if (row.cache_hit_rate !== step.expectedCacheHitRate) {
        laneFailures.push(`${key} expected=${step.expectedCacheHitRate} observed=${row.cache_hit_rate}`);
      }
    }

    if (laneFailures.length > 0) {
      cacheFailures.push(...laneFailures);
    }

    cacheChecks.push({
      id: checkIdsBySurface.get(surface) ?? "OPS75-CACHE-XX",
      title: `${surface} cache telemetry follows prime -> hit -> changed-query miss`,
      passed: laneFailures.length === 0,
      details:
        laneFailures.length === 0
          ? `Observed cache_hit_rate sequence ${observedSequence.join(" -> ")} for ${surface} deterministic identities.`
          : laneFailures.join("; "),
    });
  }

  const degradedMissingOrWrong: string[] = [];
  for (const identity of degradedIdentities) {
    const key = makeIdentityKey(identity.deliveryId, identity.eventType);
    const rows = (rateByIdentity.get(key) ?? []).filter((row) => row.degradation_path.toLowerCase() !== "none");
    if (rows.length !== 1) {
      degradedMissingOrWrong.push(`${key} expected=1 degraded row observed=${rows.length}`);
    }
  }

  const degradedIdentitySet = new Set(degradedIdentities.map((identity) => makeIdentityKey(identity.deliveryId, identity.eventType)));
  const degradedDuplicates = db
    .query<DuplicateRow, []>(
      `SELECT delivery_id, event_type, COUNT(*) AS cnt
       FROM rate_limit_events
       WHERE delivery_id IN ${makeInClauseFromValues(degradedDeliveryIds)}
         AND LOWER(COALESCE(degradation_path, 'none')) <> 'none'
       GROUP BY delivery_id, event_type
       HAVING COUNT(*) > 1`,
    )
    .all()
    .filter((row) => degradedIdentitySet.has(makeIdentityKey(row.delivery_id, row.event_type)));

  const failOpenTelemetryLeaks: string[] = [];
  const failOpenExecutionFailures: string[] = [];

  for (const identity of failOpenIdentities) {
    const key = makeIdentityKey(identity.deliveryId, identity.eventType);
    const telemetryRows = rateByIdentity.get(key) ?? [];
    if (telemetryRows.length > 0) {
      failOpenTelemetryLeaks.push(`${key} expected=0 telemetry rows observed=${telemetryRows.length}`);
    }

    const execRows = executionByIdentity.get(key) ?? [];
    if (execRows.length === 0) {
      failOpenExecutionFailures.push(`${key} execution row missing`);
      continue;
    }

    if (!hasNonBlockingConclusion(execRows)) {
      failOpenExecutionFailures.push(`${key} conclusions=${execRows.map((row) => row.conclusion).join(",")}`);
    }
  }

  const checks: VerificationCheck[] = [
    ...cacheChecks,
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
      passed: degradedDuplicates.length === 0,
      details:
        degradedDuplicates.length === 0
          ? "No duplicate degraded telemetry identities detected in rate_limit_events."
          : degradedDuplicates
              .map((row) => `${row.delivery_id}:${row.event_type} count=${row.cnt}`)
              .join("; "),
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
          ? `Verified non-blocking execution conclusions for ${failOpenIdentities.length} forced-failure identities.`
          : failOpenExecutionFailures.join("; "),
    },
  ];

  return {
    overallPassed: checks.every((check) => check.passed),
    checks,
    matrix,
    degradedIdentities,
    failOpenIdentities,
  };
}

export function renderFinalVerdict(report: ClosureReport): string {
  const evidenceLines = report.checks.map(
    (check) => `- ${check.id} ${check.passed ? "PASS" : "FAIL"}: ${check.title}. ${check.details}`,
  );

  const failedIds = report.checks.filter((check) => !check.passed).map((check) => check.id);
  const passedIds = report.checks.filter((check) => check.passed).map((check) => check.id);

  const matrixLines = report.matrix.map(
    (step) => `- ${step.surface}:${step.outcome} => ${step.deliveryId}:${step.eventType}`,
  );

  const verdict = report.overallPassed
    ? `Final verdict: PASS [${passedIds.join(", ")}]`
    : `Final verdict: FAIL [${failedIds.join(", ")}]`;

  return [
    "Phase 75 live OPS closure verification",
    "",
    "Deterministic matrix identities:",
    ...matrixLines,
    "",
    "Checks:",
    ...evidenceLines,
    "",
    verdict,
  ].join("\n");
}

function printUsage(): void {
  console.log(`Phase 75 live OPS verification closure

Runs deterministic OPS-04/OPS-05 closure checks with machine-checkable check IDs.

Usage:
  bun scripts/phase75-live-ops-verification-closure.ts \\
    --review <prime> <hit> <changed> \\
    --mention <prime> <hit> <changed> \\
    --degraded <delivery:event-type> [...more] \\
    --failopen <delivery:event-type> [...more] [options]

Required:
  --review <prime> <hit> <changed>      review_requested identities in locked order
  --mention <prime> <hit> <changed>     explicit @kodiai mention identities in locked order
  --degraded <delivery:event-type>      degraded telemetry identities (repeatable)
  --failopen <delivery:event-type>      forced telemetry failure identities (repeatable)

Options:
  --db <path>                           telemetry DB path (default: ./data/kodiai-telemetry.db)
  --review-event-type <value>           default: pull_request.review_requested
  --mention-event-type <value>          default: issue_comment.created
  --json                                print machine-readable report JSON
  -h, --help                            show this help

Check IDs:
  OPS75-CACHE-*    deterministic cache prime->hit->miss checks per surface
  OPS75-ONCE-*     exactly-once degraded telemetry identity checks
  OPS75-FAILOPEN-* fail-open completion checks under forced telemetry persistence failure`);
}

function main(): void {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    options: {
      review: { type: "string", multiple: true },
      mention: { type: "string", multiple: true },
      degraded: { type: "string", multiple: true },
      failopen: { type: "string", multiple: true },
      db: { type: "string", default: DEFAULT_DB_PATH },
      "review-event-type": { type: "string", default: REVIEW_EVENT_TYPE_DEFAULT },
      "mention-event-type": { type: "string", default: MENTION_EVENT_TYPE_DEFAULT },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
    allowPositionals: false,
  });

  if (parsed.values.help) {
    printUsage();
    process.exit(0);
  }

  const review = asOutcomeRecord(parsed.values.review ?? [], "--review");
  const mention = asOutcomeRecord(parsed.values.mention ?? [], "--mention");

  const degradedValues = parsed.values.degraded ?? [];
  const failOpenValues = parsed.values.failopen ?? [];
  if (degradedValues.length === 0) {
    throw new Error("--degraded requires at least one <delivery:event-type> identity");
  }
  if (failOpenValues.length === 0) {
    throw new Error("--failopen requires at least one <delivery:event-type> identity");
  }

  const degradedIdentities = degradedValues.map(parseIdentity);
  const failOpenIdentities = failOpenValues.map(parseIdentity);

  const dbPath = resolve(parsed.values.db);
  if (!existsSync(dbPath)) {
    throw new Error(`Telemetry database not found at ${dbPath}`);
  }

  const matrix = buildDeterministicMatrix({
    review,
    mention,
    reviewEventType: parsed.values["review-event-type"],
    mentionEventType: parsed.values["mention-event-type"],
  });

  const db = new Database(dbPath, { readonly: true });
  db.run("PRAGMA busy_timeout = 5000");
  const report = evaluateClosureVerification(db, matrix, degradedIdentities, failOpenIdentities);
  db.close();

  if (parsed.values.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderFinalVerdict(report));
  }

  if (!report.overallPassed) {
    process.exit(1);
  }
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Phase 75 closure verification failed: ${message}`);
    process.exit(1);
  }
}
