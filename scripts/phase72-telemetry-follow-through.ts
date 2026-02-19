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

export type VerificationReport = {
  overallPassed: boolean;
  checks: VerificationCheck[];
  scenario: ScenarioStep[];
};

type BuildScenarioInput = {
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

  return {
    prime,
    hit,
    "changed-query-miss": changed,
  };
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
  const surfaces: Surface[] = ["review_requested", "kodiai_mention"];
  for (const surface of surfaces) {
    const outcomes = steps.filter((step) => step.surface === surface).map((step) => step.outcome);
    const expected = [...LOCKED_CACHE_SEQUENCE];
    if (outcomes.length !== expected.length || outcomes.some((value, index) => value !== expected[index])) {
      throw new Error(
        `Locked cache ordering violated for ${surface}. Expected ${expected.join(" -> ")}, got ${outcomes.join(" -> ")}`,
      );
    }
  }
}

function makeInClauseFromValues(values: string[]): string {
  const quoted = values.map((value) => `'${value.replace(/'/g, "''")}'`);
  return `(${quoted.join(",")})`;
}

function mapExecRows(rows: ExecutionRow[]): Map<string, ExecutionRow[]> {
  const mapped = new Map<string, ExecutionRow[]>();
  for (const row of rows) {
    const key = `${row.delivery_id}:${row.event_type}`;
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
    const key = `${row.delivery_id}:${row.event_type}`;
    const existing = mapped.get(key);
    if (existing) {
      existing.push(row);
    } else {
      mapped.set(key, [row]);
    }
  }
  return mapped;
}

export function evaluateVerification(db: Database, steps: ScenarioStep[]): VerificationReport {
  assertLockedOrdering(steps);

  const allDeliveryIds = steps.map((step) => step.deliveryId);
  const reviewSteps = steps.filter((step) => step.surface === "review_requested");
  const reviewDeliveryIds = reviewSteps.map((step) => step.deliveryId);

  const executionRows = db
    .query<ExecutionRow, []>(
      `SELECT delivery_id, event_type, conclusion
       FROM executions
       WHERE delivery_id IN ${makeInClauseFromValues(allDeliveryIds)}`,
    )
    .all();

  const rateRows = db
    .query<RateLimitRow, []>(
      `SELECT delivery_id, event_type, cache_hit_rate
       FROM rate_limit_events
       WHERE delivery_id IN ${makeInClauseFromValues(reviewDeliveryIds)}`,
    )
    .all();

  const execByIdentity = mapExecRows(executionRows);
  const rateByIdentity = mapRateRows(rateRows);

  const missingExecutions: string[] = [];
  const blockedExecutions: string[] = [];

  for (const step of steps) {
    const key = `${step.deliveryId}:${step.eventType}`;
    const rows = execByIdentity.get(key) ?? [];
    if (rows.length === 0) {
      missingExecutions.push(key);
      continue;
    }

    const hasNonBlockingConclusion = rows.some((row) => !FAILING_CONCLUSIONS.has(row.conclusion.toLowerCase()));
    if (!hasNonBlockingConclusion) {
      blockedExecutions.push(`${key} (${rows.map((row) => row.conclusion).join(",")})`);
    }
  }

  const checkSurfaceCoverage: VerificationCheck = {
    id: "DB-C1",
    title: "Both trigger surfaces executed in locked scenario",
    passed: missingExecutions.length === 0,
    details:
      missingExecutions.length === 0
        ? `Found execution rows for all ${steps.length} deterministic runs across review_requested and @kodiai mention surfaces.`
        : `Missing executions for identities: ${missingExecutions.join(", ")}`,
  };

  const missingRateRows: string[] = [];
  const wrongRateRows: string[] = [];
  const observedSequence: number[] = [];

  for (const step of reviewSteps) {
    const key = `${step.deliveryId}:${step.eventType}`;
    const rows = rateByIdentity.get(key) ?? [];
    if (rows.length !== 1) {
      missingRateRows.push(`${key} (rows=${rows.length})`);
      continue;
    }

    const firstRow = rows[0];
    if (!firstRow) {
      missingRateRows.push(`${key} (rows=0)`);
      continue;
    }

    const observed = firstRow.cache_hit_rate;
    const expected = expectedCacheHitRate(step.outcome);
    observedSequence.push(observed);
    if (observed !== expected) {
      wrongRateRows.push(`${key} expected=${expected} observed=${observed}`);
    }
  }

  const checkCacheSequence: VerificationCheck = {
    id: "DB-C2",
    title: "Review trigger cache telemetry follows prime -> hit -> changed-query miss",
    passed: missingRateRows.length === 0 && wrongRateRows.length === 0,
    details:
      missingRateRows.length === 0 && wrongRateRows.length === 0
        ? `Observed cache_hit_rate sequence ${observedSequence.join(" -> ")} for review_requested deterministic run identities.`
        : [
            missingRateRows.length > 0 ? `Missing once-per-run rows: ${missingRateRows.join("; ")}` : "",
            wrongRateRows.length > 0 ? `Mismatched cache_hit_rate values: ${wrongRateRows.join("; ")}` : "",
          ]
            .filter(Boolean)
            .join(" "),
  };

  const duplicateRows = db
    .query<{ delivery_id: string; event_type: string; cnt: number }, []>(
      `SELECT delivery_id, event_type, COUNT(*) AS cnt
       FROM rate_limit_events
       WHERE delivery_id IN ${makeInClauseFromValues(reviewDeliveryIds)}
       GROUP BY delivery_id, event_type
       HAVING COUNT(*) > 1`,
    )
    .all();

  const checkExactlyOnce: VerificationCheck = {
    id: "DB-C3",
    title: "No duplicate rate_limit_events per delivery_id + event_type identity",
    passed: duplicateRows.length === 0,
    details:
      duplicateRows.length === 0
        ? "No duplicate composite identities detected in rate_limit_events for this verification run."
        : `Duplicate composite identities: ${duplicateRows
            .map((row) => `${row.delivery_id}:${row.event_type} (count=${row.cnt})`)
            .join(", ")}`,
  };

  const checkNonBlocking: VerificationCheck = {
    id: "DB-C4",
    title: "Execution conclusions confirm telemetry path stays non-blocking",
    passed: blockedExecutions.length === 0,
    details:
      blockedExecutions.length === 0
        ? "Every deterministic run has a non-failing execution conclusion, indicating telemetry persistence paths did not block completion."
        : `Blocking/failed conclusions detected: ${blockedExecutions.join("; ")}`,
  };

  const checks = [checkSurfaceCoverage, checkCacheSequence, checkExactlyOnce, checkNonBlocking];

  return {
    overallPassed: checks.every((check) => check.passed),
    checks,
    scenario: steps,
  };
}

export function renderOperatorSummary(report: VerificationReport): string {
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

  return [analysisHeader, riskLine, "", "Evidence:", ...evidenceLines, "", verdict].join("\n");
}

export function validateSummaryLanguage(summary: string): string[] {
  const errors: string[] = [];
  const verdictLine = summary
    .split("\n")
    .find((line) => line.startsWith("Final verdict:"));

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

  const certaintyWords = /(guaranteed|certain|definitive|proven|proof-positive)/i;
  if (certaintyWords.test(verdictLine) && !/\[DB-C\d+/.test(verdictLine)) {
    errors.push("Final verdict certainty language requires explicit evidence citations.");
  }

  const analysisLine = summary
    .split("\n")
    .find((line) => line.startsWith("Analysis:"));
  if (!analysisLine || !/evidence/i.test(analysisLine)) {
    errors.push("Analysis section must anchor claims in evidence.");
  }

  return errors;
}

function printUsage(): void {
  console.log(`Phase 72 telemetry follow-through verifier

Runs one deterministic verification sequence with locked cache order:
  prime -> hit -> changed-query miss

Usage:
  bun scripts/phase72-telemetry-follow-through.ts \\
    --review prime-delivery hit-delivery changed-delivery \\
    --mention prime-delivery hit-delivery changed-delivery [options]

Required:
  --review <prime> <hit> <changed>    delivery IDs for review_requested runs
  --mention <prime> <hit> <changed>   delivery IDs for explicit @kodiai mention runs

Options:
  --db <path>                         telemetry DB path (default: ./data/kodiai-telemetry.db)
  --review-event-type <value>         default: pull_request.review_requested
  --mention-event-type <value>        default: issue_comment.created
  --json                              print machine-readable report JSON
  -h, --help                          show this help

Cadence:
  Run once per milestone and attach output to release evidence.`);
}

function main(): void {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    options: {
      review: { type: "string", multiple: true },
      mention: { type: "string", multiple: true },
      db: { type: "string", default: DEFAULT_DB_PATH },
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
    process.exit(0);
  }

  const review = asOutcomeRecord(parsed.values.review ?? [], "--review");
  const mention = asOutcomeRecord(parsed.values.mention ?? [], "--mention");
  const dbPath = resolve(parsed.values.db);

  if (!existsSync(dbPath)) {
    throw new Error(`Telemetry database not found at ${dbPath}`);
  }

  const scenario = buildDeterministicScenario({
    review,
    mention,
    reviewEventType: parsed.values["review-event-type"],
    mentionEventType: parsed.values["mention-event-type"],
  });

  const db = new Database(dbPath, { readonly: true });
  db.run("PRAGMA busy_timeout = 5000");
  const report = evaluateVerification(db, scenario);
  db.close();

  const summary = renderOperatorSummary(report);
  const languageErrors = validateSummaryLanguage(summary);
  if (languageErrors.length > 0) {
    throw new Error(`Summary language guardrails failed: ${languageErrors.join(" | ")}`);
  }

  if (parsed.values.json) {
    console.log(
      JSON.stringify(
        {
          report,
          summary,
          languageGuardrails: { passed: true, errors: [] },
        },
        null,
        2,
      ),
    );
  } else {
    console.log(summary);
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
    console.error(`Phase 72 verification failed: ${message}`);
    process.exit(1);
  }
}
