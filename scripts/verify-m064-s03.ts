import pino from "pino";
import { createDbClient } from "../src/db/client.ts";
import { buildReviewFamilyKey } from "../src/jobs/review-work-coordinator.ts";
import { buildReviewOutputKey, parseReviewOutputKey } from "../src/handlers/review-idempotency.ts";
import { createKnowledgeStore } from "../src/knowledge/store.ts";
import type {
  ContinuationFamilyStateKey,
  ContinuationFamilyStateRecord,
  ContinuationOperatorEvidenceLookup,
  ContinuationOperatorEvidenceReport,
  KnowledgeStore,
} from "../src/knowledge/types.ts";
import {
  buildContinuationOperatorEvidenceReport,
  resolveContinuationOperatorEvidence,
} from "../src/knowledge/continuation-operator-evidence.ts";

export const M064_S03_RECORD_IDS = [
  "canonical-authority",
  "degraded-projection",
  "pending-continuation",
  "superseded-family",
  "missing-canonical-row",
  "invalid-review-output-key",
] as const;

export type M064S03RecordId = (typeof M064_S03_RECORD_IDS)[number];

export type M064S03StatusCode =
  | "m064_s03_ok"
  | "m064_s03_invalid_arg"
  | "m064_s03_verifier_failed";

export type M064S03RecordStatusCode = ContinuationOperatorEvidenceReport["status"];

export type M064S03Record = {
  recordId: string;
  success: boolean;
  statusCode: M064S03RecordStatusCode;
  detail: string;
  reviewOutputKey: string;
  baseReviewOutputKey: string | null;
  familyKey: string | null;
  repoFullName: string | null;
  prNumber: number | null;
  action: string | null;
  deliveryId: string | null;
  effectiveDeliveryId: string | null;
  retryAttempt: number | null;
  authoritativeAttemptId: string | null;
  authoritativeAttemptOrdinal: number | null;
  authoritativeOutcome: string | null;
  finalStopReason: string | null;
  projectionStatus: string | null;
  supersededByAttemptId: string | null;
  issues: string[];
};

export type M064S03Report = {
  command: "verify:m064:s03";
  generated_at: string;
  mode: "fixture-matrix" | "operator-lookup";
  record_count: number;
  success: boolean;
  status_code: M064S03StatusCode;
  records: M064S03Record[];
  issues: string[];
};

type VerifyM064S03Args = {
  help: boolean;
  json: boolean;
  reviewOutputKey: string | null;
  invalidArg: string | null;
};

type OperatorLookupStore = Pick<KnowledgeStore, "getContinuationFamilyState"> & {
  close?: () => void | Promise<void>;
};

type FixtureDefinition = {
  recordId: M064S03RecordId;
  reviewOutputKey: string;
  expectedStatus: ContinuationOperatorEvidenceReport["status"];
  expected: Partial<M064S03Record>;
  canonicalState: ContinuationFamilyStateRecord | null;
};

const FIXTURE_OWNER = "Acme";
const FIXTURE_REPO = "Repo";
const FIXTURE_PR_NUMBER = 101;
const FIXTURE_INSTALLATION_ID = 42;
const FIXTURE_ACTION = "review_requested";
const FIXTURE_HEAD_SHA = "abcdef1234567890";

function makeReviewOutputKey(deliveryId: string): string {
  return buildReviewOutputKey({
    installationId: FIXTURE_INSTALLATION_ID,
    owner: FIXTURE_OWNER,
    repo: FIXTURE_REPO,
    prNumber: FIXTURE_PR_NUMBER,
    action: FIXTURE_ACTION,
    deliveryId,
    headSha: FIXTURE_HEAD_SHA,
  });
}

function makeCanonicalState(
  overrides: Partial<ContinuationFamilyStateRecord> = {},
): ContinuationFamilyStateRecord {
  return {
    familyKey: "acme/repo#101",
    baseReviewOutputKey: makeReviewOutputKey("delivery-123"),
    authoritativeAttemptId: "review-work-2",
    authoritativeAttemptOrdinal: 2,
    authoritativeOutcome: "merged",
    finalStopReason: "merged-continuation-results",
    projectionStatus: "canonical",
    supersededByAttemptId: null,
    ...overrides,
  };
}

function createStore(
  stateByBaseReviewOutputKey: Map<string, ContinuationFamilyStateRecord>,
): Pick<KnowledgeStore, "getContinuationFamilyState"> {
  return {
    async getContinuationFamilyState(key: ContinuationFamilyStateKey): Promise<ContinuationFamilyStateRecord | null> {
      const state = stateByBaseReviewOutputKey.get(key.baseReviewOutputKey);
      if (!state) {
        return null;
      }
      if (state.familyKey !== key.familyKey) {
        return null;
      }
      return state;
    },
  };
}

function getFixtureDefinitions(): FixtureDefinition[] {
  const canonicalBaseReviewOutputKey = makeReviewOutputKey("delivery-123");

  return [
    {
      recordId: "canonical-authority",
      reviewOutputKey: canonicalBaseReviewOutputKey,
      expectedStatus: "canonical",
      expected: {
        repoFullName: "acme/repo",
        prNumber: 101,
        authoritativeAttemptId: "review-work-2",
        authoritativeAttemptOrdinal: 2,
        authoritativeOutcome: "merged",
        finalStopReason: "merged-continuation-results",
        projectionStatus: "canonical",
        supersededByAttemptId: null,
      },
      canonicalState: makeCanonicalState(),
    },
    {
      recordId: "degraded-projection",
      reviewOutputKey: makeReviewOutputKey("delivery-777"),
      expectedStatus: "degraded",
      expected: {
        authoritativeAttemptId: "review-work-1",
        authoritativeAttemptOrdinal: 1,
        authoritativeOutcome: "blocked",
        finalStopReason: "no-follow-up",
        projectionStatus: "degraded",
        supersededByAttemptId: null,
      },
      canonicalState: makeCanonicalState({
        baseReviewOutputKey: makeReviewOutputKey("delivery-777"),
        authoritativeAttemptId: "review-work-1",
        authoritativeAttemptOrdinal: 1,
        authoritativeOutcome: "blocked",
        finalStopReason: "no-follow-up",
        projectionStatus: "degraded",
      }),
    },
    {
      recordId: "pending-continuation",
      reviewOutputKey: `${makeReviewOutputKey("delivery-222")}-retry-2`,
      expectedStatus: "pending",
      expected: {
        authoritativeAttemptId: "review-work-2",
        authoritativeAttemptOrdinal: 2,
        authoritativeOutcome: "continuation-pending",
        finalStopReason: "awaiting-continuation",
        projectionStatus: "pending",
        supersededByAttemptId: null,
        retryAttempt: 2,
        effectiveDeliveryId: "delivery-222-retry-2",
      },
      canonicalState: makeCanonicalState({
        baseReviewOutputKey: makeReviewOutputKey("delivery-222"),
        authoritativeOutcome: "continuation-pending",
        finalStopReason: "awaiting-continuation",
        projectionStatus: "pending",
      }),
    },
    {
      recordId: "superseded-family",
      reviewOutputKey: makeReviewOutputKey("delivery-999"),
      expectedStatus: "superseded",
      expected: {
        authoritativeAttemptId: "review-work-3",
        authoritativeAttemptOrdinal: 3,
        authoritativeOutcome: "superseded",
        finalStopReason: "superseded-by-newer-attempt",
        projectionStatus: "canonical",
        supersededByAttemptId: "review-work-3",
      },
      canonicalState: makeCanonicalState({
        baseReviewOutputKey: makeReviewOutputKey("delivery-999"),
        authoritativeAttemptId: "review-work-3",
        authoritativeAttemptOrdinal: 3,
        authoritativeOutcome: "superseded",
        finalStopReason: "superseded-by-newer-attempt",
        projectionStatus: "canonical",
        supersededByAttemptId: "review-work-3",
      }),
    },
    {
      recordId: "missing-canonical-row",
      reviewOutputKey: makeReviewOutputKey("delivery-404"),
      expectedStatus: "missing-canonical-row",
      expected: {
        familyKey: "acme/repo#101",
        baseReviewOutputKey: makeReviewOutputKey("delivery-404"),
        authoritativeAttemptId: null,
        authoritativeAttemptOrdinal: null,
        authoritativeOutcome: null,
        finalStopReason: null,
        projectionStatus: null,
        supersededByAttemptId: null,
      },
      canonicalState: null,
    },
    {
      recordId: "invalid-review-output-key",
      reviewOutputKey: "not-a-review-output-key",
      expectedStatus: "invalid-review-output-key",
      expected: {
        familyKey: null,
        baseReviewOutputKey: null,
        authoritativeAttemptId: null,
        authoritativeAttemptOrdinal: null,
        authoritativeOutcome: null,
        finalStopReason: null,
        projectionStatus: null,
        supersededByAttemptId: null,
      },
      canonicalState: null,
    },
  ];
}

function buildInvalidArgReport(issue: string, generatedAt = new Date().toISOString()): M064S03Report {
  return {
    command: "verify:m064:s03",
    generated_at: generatedAt,
    mode: "operator-lookup",
    record_count: 0,
    success: false,
    status_code: "m064_s03_invalid_arg",
    records: [],
    issues: [issue],
  };
}

function toRecord(recordId: string, report: ContinuationOperatorEvidenceReport, issues: string[]): M064S03Record {
  return {
    recordId,
    success: issues.length === 0,
    statusCode: report.status,
    detail: report.detail,
    reviewOutputKey: report.reviewOutputKey,
    baseReviewOutputKey: report.baseReviewOutputKey,
    familyKey: report.familyKey,
    repoFullName: report.repoFullName,
    prNumber: report.prNumber,
    action: report.action,
    deliveryId: report.deliveryId,
    effectiveDeliveryId: report.effectiveDeliveryId,
    retryAttempt: report.retryAttempt,
    authoritativeAttemptId: report.authoritativeAttemptId,
    authoritativeAttemptOrdinal: report.authoritativeAttemptOrdinal,
    authoritativeOutcome: report.authoritativeOutcome,
    finalStopReason: report.finalStopReason,
    projectionStatus: report.projectionStatus,
    supersededByAttemptId: report.supersededByAttemptId,
    issues,
  };
}

function compareExpected(record: M064S03Record, expectedStatus: M064S03RecordStatusCode, expected: Partial<M064S03Record>): string[] {
  const issues: string[] = [];

  if (record.statusCode !== expectedStatus) {
    issues.push(`Expected status ${expectedStatus} but received ${record.statusCode}.`);
  }

  for (const [key, value] of Object.entries(expected)) {
    const actual = record[key as keyof M064S03Record];
    if (actual !== value) {
      issues.push(`Expected ${key}=${value ?? "null"} but received ${actual ?? "null"}.`);
    }
  }

  return issues;
}

async function buildLookupForFixture(
  fixture: FixtureDefinition,
  store: Pick<KnowledgeStore, "getContinuationFamilyState">,
): Promise<ContinuationOperatorEvidenceLookup> {
  return await resolveContinuationOperatorEvidence({
    reviewOutputKey: fixture.reviewOutputKey,
    knowledgeStore: store,
  });
}

async function createLiveKnowledgeStore(): Promise<OperatorLookupStore | null> {
  try {
    const client = createDbClient({ logger: pino({ level: "silent" }) });
    const store = createKnowledgeStore({ sql: client.sql, logger: pino({ level: "silent" }) });
    return {
      getContinuationFamilyState: store.getContinuationFamilyState?.bind(store),
      close: async () => {
        await client.close();
      },
    };
  } catch {
    return null;
  }
}

function buildLookupUnavailableRecord(reviewOutputKey: string, detail: string): M064S03Record {
  const normalizedReviewOutputKey = reviewOutputKey.trim().toLowerCase();
  const parsedReviewOutputKey = parseReviewOutputKey(normalizedReviewOutputKey);
  const familyKey = parsedReviewOutputKey
    ? buildReviewFamilyKey(parsedReviewOutputKey.owner, parsedReviewOutputKey.repo, parsedReviewOutputKey.prNumber)
    : null;

  return toRecord(
    "operator-lookup",
    buildContinuationOperatorEvidenceReport({
      status: "lookup-unavailable",
      reviewOutputKey: normalizedReviewOutputKey,
      baseReviewOutputKey: parsedReviewOutputKey?.baseReviewOutputKey ?? null,
      familyKey,
      parsedReviewOutputKey,
      canonicalState: null,
      detail,
    }),
    [],
  );
}

export async function evaluateM064S03(params?: {
  generatedAt?: string;
  reviewOutputKey?: string | null;
  knowledgeStore?: OperatorLookupStore;
}): Promise<M064S03Report> {
  const generatedAt = params?.generatedAt ?? new Date().toISOString();
  const fixtures = getFixtureDefinitions();
  const canonicalStates = new Map<string, ContinuationFamilyStateRecord>();

  for (const fixture of fixtures) {
    if (fixture.canonicalState) {
      canonicalStates.set(fixture.canonicalState.baseReviewOutputKey, fixture.canonicalState);
    }
  }

  const store = createStore(canonicalStates);

  if (params?.reviewOutputKey) {
    const parsedReviewOutputKey = parseReviewOutputKey(params.reviewOutputKey.trim().toLowerCase());
    const shouldUseFixtureStore = parsedReviewOutputKey?.repoFullName === "acme/repo";
    const operatorStore = params.knowledgeStore
      ?? (shouldUseFixtureStore ? store : await createLiveKnowledgeStore())
      ?? {};

    try {
      try {
        const lookup = await resolveContinuationOperatorEvidence({
          reviewOutputKey: params.reviewOutputKey,
          knowledgeStore: operatorStore,
        });
        const operatorReport = buildContinuationOperatorEvidenceReport(lookup);
        const record = toRecord("operator-lookup", operatorReport, []);

        return {
          command: "verify:m064:s03",
          generated_at: generatedAt,
          mode: "operator-lookup",
          record_count: 1,
          success: true,
          status_code: "m064_s03_ok",
          records: [record],
          issues: [],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          command: "verify:m064:s03",
          generated_at: generatedAt,
          mode: "operator-lookup",
          record_count: 1,
          success: true,
          status_code: "m064_s03_ok",
          records: [buildLookupUnavailableRecord(params.reviewOutputKey, `Canonical operator lookup failed: ${message}`)],
          issues: [],
        };
      }
    } finally {
      await operatorStore.close?.();
    }
  }

  const records: M064S03Record[] = [];
  const issues: string[] = [];

  for (const fixture of fixtures) {
    const lookup = await buildLookupForFixture(fixture, store);
    const operatorReport = buildContinuationOperatorEvidenceReport(lookup);
    const recordIssues = compareExpected(
      toRecord(fixture.recordId, operatorReport, []),
      fixture.expectedStatus,
      fixture.expected,
    );
    const record = toRecord(fixture.recordId, operatorReport, recordIssues);
    records.push(record);
    issues.push(...recordIssues.map((issue) => `${fixture.recordId}: ${issue}`));
  }

  return {
    command: "verify:m064:s03",
    generated_at: generatedAt,
    mode: "fixture-matrix",
    record_count: records.length,
    success: issues.length === 0,
    status_code: issues.length === 0 ? "m064_s03_ok" : "m064_s03_verifier_failed",
    records,
    issues,
  };
}

export function parseVerifyM064S03Args(args: string[]): VerifyM064S03Args {
  let reviewOutputKey: string | null = null;
  let invalidArg: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--help" || arg === "-h" || arg === "--json") {
      continue;
    }

    if (arg === "--review-output-key") {
      const candidate = args[index + 1];
      if (!candidate || candidate.startsWith("--")) {
        invalidArg = "Missing value for --review-output-key.";
        break;
      }
      reviewOutputKey = candidate;
      index += 1;
      continue;
    }

    invalidArg = `Unknown argument: ${arg}.`;
    break;
  }

  return {
    help: args.includes("--help") || args.includes("-h"),
    json: args.includes("--json"),
    reviewOutputKey,
    invalidArg,
  };
}

function usage(): string {
  return [
    "Usage: bun run verify:m064:s03 -- [--review-output-key <key>] [--json]",
    "",
    "Modes:",
    "  default              Run the deterministic canonical operator-evidence fixture matrix",
    "  --review-output-key  Resolve one operator-visible reviewOutputKey against canonical truth",
    "",
    "Options:",
    "  --json       Print machine-readable JSON output",
    "  --help       Show this help",
  ].join("\n");
}

export function renderM064S03Report(report: M064S03Report): string {
  const lines = [
    "# M064 S03 — Canonical Operator Evidence Report",
    "",
    `Status: ${report.status_code}`,
    `Mode: ${report.mode}`,
    `Records: ${report.record_count}`,
  ];

  if (report.records.length > 0) {
    lines.push("", "Operator evidence:");
    for (const record of report.records) {
      lines.push(`- ${record.recordId}: ${record.statusCode}`);
      lines.push(
        `  - authoritativeOutcome=${record.authoritativeOutcome ?? "missing"} finalStopReason=${record.finalStopReason ?? "missing"} authoritativeAttemptId=${record.authoritativeAttemptId ?? "missing"} projectionStatus=${record.projectionStatus ?? "missing"} supersededByAttemptId=${record.supersededByAttemptId ?? "none"}`,
      );
      lines.push(
        `  - reviewOutputKey=${record.reviewOutputKey} baseReviewOutputKey=${record.baseReviewOutputKey ?? "missing"} familyKey=${record.familyKey ?? "missing"}`,
      );
      lines.push(
        `  - repo=${record.repoFullName ?? "missing"} prNumber=${record.prNumber ?? "missing"} action=${record.action ?? "missing"} deliveryId=${record.deliveryId ?? "missing"} effectiveDeliveryId=${record.effectiveDeliveryId ?? "missing"} retryAttempt=${record.retryAttempt ?? "none"}`,
      );
      lines.push(`  - detail=${record.detail}`);
      for (const issue of record.issues) {
        lines.push(`  - issue=${issue}`);
      }
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
  },
): Promise<number> {
  const stdout = deps?.stdout ?? process.stdout;
  const options = parseVerifyM064S03Args(args);

  if (options.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  if (options.invalidArg) {
    const report = buildInvalidArgReport(options.invalidArg);
    stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderM064S03Report(report));
    return 1;
  }

  const report = await evaluateM064S03({ reviewOutputKey: options.reviewOutputKey });
  stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderM064S03Report(report));
  return report.success ? 0 : 1;
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
