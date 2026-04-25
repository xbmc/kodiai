import type {
  ContinuationFamilyFinalStopReason,
  ContinuationFamilyProjectionStatus,
  ContinuationFamilyStateKey,
  ContinuationFamilyStateRecord,
  KnowledgeStore,
} from "../src/knowledge/types.ts";

export const M064_S01_SCENARIO_IDS = [
  "merge-authority",
  "quiet-settlement",
  "blocked-no-follow-up",
  "superseded-stale-attempt",
] as const;

export type M064S01ScenarioId = (typeof M064_S01_SCENARIO_IDS)[number];

export type M064S01StatusCode =
  | "m064_s01_ok"
  | "m064_s01_invalid_arg"
  | "m064_s01_verifier_failed";

export type M064S01ScenarioStatusCode =
  | "canonical-merged"
  | "canonical-quiet-settled"
  | "canonical-blocked"
  | "canonical-superseded"
  | "invalid-contract";

export type M064S01Check = {
  key:
    | "canonical-row-present"
    | "authoritative-attempt"
    | "final-stop-reason"
    | "projection-status"
    | "supersession-shield";
  status: "pass" | "fail" | "expected-negative";
  detail: string;
};

export type M064S01ScenarioRecord = {
  scenarioId: string;
  success: boolean;
  statusCode: M064S01ScenarioStatusCode;
  familyKey: string;
  baseReviewOutputKey: string;
  authoritativeAttemptId: string | null;
  authoritativeAttemptOrdinal: number | null;
  authoritativeOutcome: string | null;
  finalStopReason: ContinuationFamilyFinalStopReason | null;
  projectionStatus: ContinuationFamilyProjectionStatus | null;
  supersededByAttemptId: string | null;
  checks: M064S01Check[];
  issues: string[];
};

export type M064S01Report = {
  command: "verify:m064:s01";
  generated_at: string;
  scenario_count: number;
  success: boolean;
  status_code: M064S01StatusCode;
  scenarios: M064S01ScenarioRecord[];
  issues: string[];
};

type VerifyM064S01Args = {
  help: boolean;
  json: boolean;
  scenarioId: string | null;
};

type ScenarioDefinition = {
  scenarioId: M064S01ScenarioId;
  familyKey: string;
  baseReviewOutputKey: string;
  expectedState: {
    authoritativeAttemptId: string;
    authoritativeAttemptOrdinal: number;
    authoritativeOutcome: ContinuationFamilyStateRecord["authoritativeOutcome"];
    finalStopReason: ContinuationFamilyStateRecord["finalStopReason"];
    projectionStatus: ContinuationFamilyStateRecord["projectionStatus"];
    supersededByAttemptId: string | null;
  };
  writes: ContinuationFamilyStateRecord[];
};

type EvaluateScenarioInput = ScenarioDefinition & {
  mutateState?: (state: ContinuationFamilyStateRecord | null) => ContinuationFamilyStateRecord | null;
};

const VALID_SCENARIO_IDS = new Set<string>(M064_S01_SCENARIO_IDS);

function makeBaseReviewOutputKey(deliveryId: string): string {
  return [
    "kodiai-review-output:v1",
    "inst-42",
    "acme/repo",
    "pr-101",
    "action-review_requested",
    `delivery-${deliveryId}`,
    "head-abcdef1234567890",
  ].join(":");
}

function createScenarioStore(): Pick<KnowledgeStore, "upsertContinuationFamilyState" | "getContinuationFamilyState"> {
  const rows = new Map<string, ContinuationFamilyStateRecord>();

  return {
    async upsertContinuationFamilyState(record: ContinuationFamilyStateRecord): Promise<void> {
      const key = `${record.familyKey}::${record.baseReviewOutputKey}`;
      const existing = rows.get(key);
      if (!existing || record.authoritativeAttemptOrdinal >= existing.authoritativeAttemptOrdinal) {
        rows.set(key, {
          ...record,
          supersededByAttemptId: record.supersededByAttemptId ?? null,
        });
      }
    },
    async getContinuationFamilyState(key: ContinuationFamilyStateKey): Promise<ContinuationFamilyStateRecord | null> {
      return rows.get(`${key.familyKey}::${key.baseReviewOutputKey}`) ?? null;
    },
  };
}

export function getDefaultScenarioMatrix(): ScenarioDefinition[] {
  const familyKey = "acme/repo#101";
  const baseReviewOutputKey = makeBaseReviewOutputKey("verify-m064-s01");

  return [
    {
      scenarioId: "merge-authority",
      familyKey,
      baseReviewOutputKey,
      expectedState: {
        authoritativeAttemptId: "review-work-2",
        authoritativeAttemptOrdinal: 2,
        authoritativeOutcome: "merged",
        finalStopReason: "merged-continuation-results",
        projectionStatus: "canonical",
        supersededByAttemptId: null,
      },
      writes: [
        {
          familyKey,
          baseReviewOutputKey,
          authoritativeAttemptId: "review-work-1",
          authoritativeAttemptOrdinal: 1,
          authoritativeOutcome: "continuation-pending",
          finalStopReason: "awaiting-continuation",
          projectionStatus: "pending",
          supersededByAttemptId: null,
        },
        {
          familyKey,
          baseReviewOutputKey,
          authoritativeAttemptId: "review-work-2",
          authoritativeAttemptOrdinal: 2,
          authoritativeOutcome: "merged",
          finalStopReason: "merged-continuation-results",
          projectionStatus: "canonical",
          supersededByAttemptId: null,
        },
      ],
    },
    {
      scenarioId: "quiet-settlement",
      familyKey,
      baseReviewOutputKey,
      expectedState: {
        authoritativeAttemptId: "review-work-2",
        authoritativeAttemptOrdinal: 2,
        authoritativeOutcome: "quiet-settled",
        finalStopReason: "settled-without-update",
        projectionStatus: "canonical",
        supersededByAttemptId: null,
      },
      writes: [
        {
          familyKey,
          baseReviewOutputKey,
          authoritativeAttemptId: "review-work-1",
          authoritativeAttemptOrdinal: 1,
          authoritativeOutcome: "continuation-pending",
          finalStopReason: "awaiting-continuation",
          projectionStatus: "pending",
          supersededByAttemptId: null,
        },
        {
          familyKey,
          baseReviewOutputKey,
          authoritativeAttemptId: "review-work-2",
          authoritativeAttemptOrdinal: 2,
          authoritativeOutcome: "quiet-settled",
          finalStopReason: "settled-without-update",
          projectionStatus: "canonical",
          supersededByAttemptId: null,
        },
      ],
    },
    {
      scenarioId: "blocked-no-follow-up",
      familyKey,
      baseReviewOutputKey,
      expectedState: {
        authoritativeAttemptId: "review-work-1",
        authoritativeAttemptOrdinal: 1,
        authoritativeOutcome: "blocked",
        finalStopReason: "no-follow-up",
        projectionStatus: "canonical",
        supersededByAttemptId: null,
      },
      writes: [
        {
          familyKey,
          baseReviewOutputKey,
          authoritativeAttemptId: "review-work-1",
          authoritativeAttemptOrdinal: 1,
          authoritativeOutcome: "blocked",
          finalStopReason: "no-follow-up",
          projectionStatus: "canonical",
          supersededByAttemptId: null,
        },
      ],
    },
    {
      scenarioId: "superseded-stale-attempt",
      familyKey,
      baseReviewOutputKey,
      expectedState: {
        authoritativeAttemptId: "review-work-3",
        authoritativeAttemptOrdinal: 3,
        authoritativeOutcome: "superseded",
        finalStopReason: "superseded-by-newer-attempt",
        projectionStatus: "degraded",
        supersededByAttemptId: "review-work-3",
      },
      writes: [
        {
          familyKey,
          baseReviewOutputKey,
          authoritativeAttemptId: "review-work-2",
          authoritativeAttemptOrdinal: 2,
          authoritativeOutcome: "merged",
          finalStopReason: "merged-continuation-results",
          projectionStatus: "canonical",
          supersededByAttemptId: null,
        },
        {
          familyKey,
          baseReviewOutputKey,
          authoritativeAttemptId: "review-work-3",
          authoritativeAttemptOrdinal: 3,
          authoritativeOutcome: "superseded",
          finalStopReason: "superseded-by-newer-attempt",
          projectionStatus: "degraded",
          supersededByAttemptId: "review-work-3",
        },
        {
          familyKey,
          baseReviewOutputKey,
          authoritativeAttemptId: "review-work-2",
          authoritativeAttemptOrdinal: 2,
          authoritativeOutcome: "merged",
          finalStopReason: "merged-continuation-results",
          projectionStatus: "canonical",
          supersededByAttemptId: null,
        },
      ],
    },
  ];
}

function buildInvalidArgReport(issue: string, generatedAt = new Date().toISOString()): M064S01Report {
  return {
    command: "verify:m064:s01",
    generated_at: generatedAt,
    scenario_count: 0,
    success: false,
    status_code: "m064_s01_invalid_arg",
    scenarios: [],
    issues: [issue],
  };
}

function statusCodeForOutcome(
  outcome: ContinuationFamilyStateRecord["authoritativeOutcome"] | null,
): M064S01ScenarioStatusCode {
  switch (outcome) {
    case "merged":
      return "canonical-merged";
    case "quiet-settled":
      return "canonical-quiet-settled";
    case "blocked":
      return "canonical-blocked";
    case "superseded":
      return "canonical-superseded";
    default:
      return "invalid-contract";
  }
}

export async function evaluateScenario(params: EvaluateScenarioInput): Promise<M064S01ScenarioRecord> {
  const store = createScenarioStore();
  for (const write of params.writes) {
    await store.upsertContinuationFamilyState?.(write);
  }

  let state = await store.getContinuationFamilyState?.({
    familyKey: params.familyKey,
    baseReviewOutputKey: params.baseReviewOutputKey,
  }) ?? null;

  if (params.mutateState) {
    state = params.mutateState(state);
  }

  const issues: string[] = [];
  const checks: M064S01Check[] = [];

  const rowPresent = state !== null;
  checks.push({
    key: "canonical-row-present",
    status: rowPresent ? "pass" : "fail",
    detail: rowPresent
      ? "Canonical family row was returned directly from durable-state queries."
      : "Canonical family row was missing for the requested family/base reviewOutputKey.",
  });
  if (!rowPresent) {
    issues.push("Canonical family row was missing for the requested family/base reviewOutputKey.");
  }

  const authoritativeAttemptPass = state?.authoritativeAttemptId === params.expectedState.authoritativeAttemptId
    && state?.authoritativeAttemptOrdinal === params.expectedState.authoritativeAttemptOrdinal;
  checks.push({
    key: "authoritative-attempt",
    status: authoritativeAttemptPass ? "pass" : "fail",
    detail: authoritativeAttemptPass
      ? `Authoritative attempt resolved to ${params.expectedState.authoritativeAttemptId}.`
      : `Expected authoritative attempt ${params.expectedState.authoritativeAttemptId} (#${params.expectedState.authoritativeAttemptOrdinal}) but received ${state?.authoritativeAttemptId ?? "missing"} (#${state?.authoritativeAttemptOrdinal ?? "missing"}).`,
  });
  if (!authoritativeAttemptPass) {
    issues.push(`Expected authoritative attempt ${params.expectedState.authoritativeAttemptId} (#${params.expectedState.authoritativeAttemptOrdinal}) but received ${state?.authoritativeAttemptId ?? "missing"} (#${state?.authoritativeAttemptOrdinal ?? "missing"}).`);
  }

  const stopReasonPass = state?.authoritativeOutcome === params.expectedState.authoritativeOutcome
    && state?.finalStopReason === params.expectedState.finalStopReason;
  checks.push({
    key: "final-stop-reason",
    status: stopReasonPass ? "pass" : "fail",
    detail: stopReasonPass
      ? `Canonical row reported outcome=${params.expectedState.authoritativeOutcome} stopReason=${params.expectedState.finalStopReason}.`
      : `Expected outcome=${params.expectedState.authoritativeOutcome} stopReason=${params.expectedState.finalStopReason} but received outcome=${state?.authoritativeOutcome ?? "missing"} stopReason=${state?.finalStopReason ?? "missing"}.`,
  });
  if (!stopReasonPass) {
    issues.push(`Expected outcome=${params.expectedState.authoritativeOutcome} stopReason=${params.expectedState.finalStopReason} but received outcome=${state?.authoritativeOutcome ?? "missing"} stopReason=${state?.finalStopReason ?? "missing"}.`);
  }

  const projectionPass = state?.projectionStatus === params.expectedState.projectionStatus;
  checks.push({
    key: "projection-status",
    status: projectionPass ? "pass" : "fail",
    detail: projectionPass
      ? `Projection status remained ${params.expectedState.projectionStatus}.`
      : `Expected projection status ${params.expectedState.projectionStatus} but received ${state?.projectionStatus ?? "missing"}.`,
  });
  if (!projectionPass) {
    issues.push(`Expected projection status ${params.expectedState.projectionStatus} but received ${state?.projectionStatus ?? "missing"}.`);
  }

  const supersessionExpected = params.expectedState.authoritativeOutcome === "superseded";
  const supersessionPass = supersessionExpected
    ? state?.supersededByAttemptId === params.expectedState.supersededByAttemptId
    : state?.supersededByAttemptId === null;
  checks.push({
    key: "supersession-shield",
    status: supersessionExpected
      ? supersessionPass ? "pass" : "fail"
      : "expected-negative",
    detail: supersessionExpected
      ? supersessionPass
        ? `Stale-attempt overwrite stayed suppressed by ${params.expectedState.supersededByAttemptId}.`
        : `Expected supersededByAttemptId=${params.expectedState.supersededByAttemptId} but received ${state?.supersededByAttemptId ?? "missing"}.`
      : "Scenario does not exercise superseded-state shielding.",
  });
  if (supersessionExpected && !supersessionPass) {
    issues.push(`Expected supersededByAttemptId=${params.expectedState.supersededByAttemptId} but received ${state?.supersededByAttemptId ?? "missing"}.`);
  }

  const statusCode = issues.length === 0
    ? statusCodeForOutcome(state?.authoritativeOutcome ?? null)
    : "invalid-contract";

  return {
    scenarioId: params.scenarioId,
    success: issues.length === 0,
    statusCode,
    familyKey: params.familyKey,
    baseReviewOutputKey: params.baseReviewOutputKey,
    authoritativeAttemptId: state?.authoritativeAttemptId ?? null,
    authoritativeAttemptOrdinal: state?.authoritativeAttemptOrdinal ?? null,
    authoritativeOutcome: state?.authoritativeOutcome ?? null,
    finalStopReason: state?.finalStopReason ?? null,
    projectionStatus: state?.projectionStatus ?? null,
    supersededByAttemptId: state?.supersededByAttemptId ?? null,
    checks,
    issues,
  };
}

export async function evaluateM064S01(params?: {
  generatedAt?: string;
  scenarioId?: M064S01ScenarioId | null;
}): Promise<M064S01Report> {
  const generatedAt = params?.generatedAt ?? new Date().toISOString();
  const definitions = getDefaultScenarioMatrix();
  const selectedDefinitions = params?.scenarioId
    ? definitions.filter((definition) => definition.scenarioId === params.scenarioId)
    : definitions;
  const scenarios = await Promise.all(selectedDefinitions.map((definition) => evaluateScenario(definition)));
  const issues = scenarios.flatMap((scenario) => scenario.issues.map((issue) => `${scenario.scenarioId}: ${issue}`));

  return {
    command: "verify:m064:s01",
    generated_at: generatedAt,
    scenario_count: scenarios.length,
    success: issues.length === 0,
    status_code: issues.length === 0 ? "m064_s01_ok" : "m064_s01_verifier_failed",
    scenarios,
    issues,
  };
}

export function parseVerifyM064S01Args(args: string[]): VerifyM064S01Args {
  let scenarioId: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--scenario") {
      const candidate = args[index + 1];
      if (candidate && !candidate.startsWith("--")) {
        scenarioId = candidate;
        index += 1;
      }
    }
  }

  return {
    help: args.includes("--help") || args.includes("-h"),
    json: args.includes("--json"),
    scenarioId,
  };
}

function usage(): string {
  return [
    "Usage: bun run verify:m064:s01 -- [--scenario <id>] [--json]",
    "",
    "Scenario ids:",
    ...M064_S01_SCENARIO_IDS.map((id) => `  ${id}`),
    "",
    "Options:",
    "  --scenario   Run one deterministic canonical-state scenario instead of the full matrix",
    "  --json       Print machine-readable JSON output",
    "  --help       Show this help",
  ].join("\n");
}

export function renderM064S01Report(report: M064S01Report): string {
  const lines = [
    "# M064 S01 — Canonical Continuation Authority Verifier",
    "",
    `Status: ${report.status_code}`,
    `Scenarios: ${report.scenario_count}`,
  ];

  if (report.scenarios.length > 0) {
    lines.push("", "Scenario matrix:");
    for (const scenario of report.scenarios) {
      lines.push(`- ${scenario.scenarioId}: ${scenario.statusCode}`);
      lines.push(
        `  - familyKey=${scenario.familyKey} baseReviewOutputKey=${scenario.baseReviewOutputKey}`,
      );
      lines.push(
        `  - authoritativeAttemptId=${scenario.authoritativeAttemptId ?? "missing"} ordinal=${scenario.authoritativeAttemptOrdinal ?? "missing"} outcome=${scenario.authoritativeOutcome ?? "missing"}`,
      );
      lines.push(
        `  - finalStopReason=${scenario.finalStopReason ?? "missing"} projectionStatus=${scenario.projectionStatus ?? "missing"} supersededByAttemptId=${scenario.supersededByAttemptId ?? "none"}`,
      );
      for (const check of scenario.checks) {
        lines.push(`  - ${check.key}: ${check.status} — ${check.detail}`);
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
  const options = parseVerifyM064S01Args(args);

  if (options.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  if (options.scenarioId && !VALID_SCENARIO_IDS.has(options.scenarioId)) {
    const report = buildInvalidArgReport(`Unknown scenario id: ${options.scenarioId}.`);
    stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderM064S01Report(report));
    return 1;
  }

  const report = await evaluateM064S01({ scenarioId: (options.scenarioId as M064S01ScenarioId | null) ?? null });
  stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderM064S01Report(report));
  return report.success ? 0 : 1;
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
