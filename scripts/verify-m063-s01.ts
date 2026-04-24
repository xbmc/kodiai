import type { CheckpointRecord } from "../src/knowledge/types.ts";
import {
  planReviewContinuation,
  settleReviewContinuation,
  type ReviewContinuationPlanDecision,
  type ReviewContinuationSettlementDecision,
} from "../src/lib/review-continuation-lifecycle.ts";
import type { ReviewFirstPassPayload } from "../src/lib/review-first-pass.ts";
import type { FileRiskScore } from "../src/lib/file-risk-scorer.ts";
import {
  buildReviewFamilyKey,
  createReviewWorkCoordinator,
} from "../src/jobs/review-work-coordinator.ts";
import { buildReviewOutputKey } from "../src/handlers/review-idempotency.ts";

export const M063_S01_SCENARIO_IDS = [
  "schedule-continuation",
  "merge-continuation",
  "settle-no-delta",
  "no-follow-up",
  "stale-authority-suppressed",
] as const;

export type M063S01ScenarioId = (typeof M063_S01_SCENARIO_IDS)[number];

export type M063S01StatusCode =
  | "m063_s01_ok"
  | "m063_s01_invalid_arg"
  | "m063_s01_verifier_failed";

export type M063S01ScenarioStatusCode =
  | "continuation-scheduled"
  | "continuation-merged"
  | "continuation-settled-no-delta"
  | "continuation-not-needed"
  | "continuation-authority-suppressed"
  | "invalid-contract";

export type ContinuationStatus = "scheduled" | "not-needed";
export type SettlementStatus = "merge-ready" | "no-delta" | "not-run";
export type AuthorityStatus = "authoritative" | "suppressed";

export type M063S01ScenarioRecord = {
  scenarioId: string;
  success: boolean;
  statusCode: M063S01ScenarioStatusCode;
  continuationStatus: ContinuationStatus;
  settlementStatus: SettlementStatus;
  authorityStatus: AuthorityStatus;
  reviewOutputKey: string;
  continuationReviewOutputKey: string | null;
  continuationNumber: number | null;
  issues: string[];
};

export type M063S01Report = {
  command: "verify:m063:s01";
  generated_at: string;
  scenario_count: number;
  success: boolean;
  status_code: M063S01StatusCode;
  scenarios: M063S01ScenarioRecord[];
  issues: string[];
};

type VerifyM063S01Args = {
  help: boolean;
  json: boolean;
  scenarioId: string | null;
};

type ScenarioDefinition = {
  scenarioId: M063S01ScenarioId;
  reviewOutputKey: string;
  firstPass: ReviewFirstPassPayload;
  checkpoint: CheckpointRecord | null;
  riskScores: FileRiskScore[];
  hasPublishedInlineFindings: boolean;
  isChronicTimeout: boolean;
  timeoutSeconds: number;
  continuationCheckpoint: CheckpointRecord | null;
  continuationPublished: boolean;
  newerAttemptClaimsAuthority: boolean;
};

type EvaluateScenarioInput = ScenarioDefinition & {
  mutatePlan?: (plan: ReviewContinuationPlanDecision | null) => ReviewContinuationPlanDecision | null;
  mutateSettlement?: (settlement: ReviewContinuationSettlementDecision | null) => ReviewContinuationSettlementDecision | null;
};

const VALID_SCENARIO_IDS = new Set<string>(M063_S01_SCENARIO_IDS);

function makeReviewOutputKey(deliveryId: string): string {
  return buildReviewOutputKey({
    installationId: 42,
    owner: "acme",
    repo: "repo",
    prNumber: 101,
    action: "review_requested",
    deliveryId,
    headSha: "abcdef1234567890",
  });
}

function makeRiskScores(paths: string[]): FileRiskScore[] {
  return paths.map((filePath, index) => ({
    filePath,
    score: 90 - index * 10,
    breakdown: {
      linesChanged: 30,
      pathRisk: 20,
      fileCategory: 20,
      languageRisk: 10,
      fileExtension: 10,
    },
  }));
}

function makeFirstPass(params: {
  totalFiles: number;
  reviewedFiles: number;
  remainingFiles: number;
}): ReviewFirstPassPayload {
  return {
    state: "bounded-first-pass",
    boundedReason: "timeout",
    evidenceSource: "checkpoint",
    coveredScope: {
      reviewedFiles: params.reviewedFiles,
      totalFiles: params.totalFiles,
    },
    remainingScope: {
      remainingFiles: params.remainingFiles,
      totalFiles: params.totalFiles,
    },
    findingCount: 1,
    publication: {
      eligible: true,
      hasPublishedOutput: false,
    },
    continuationPending: true,
    zeroEvidenceFailure: false,
  };
}

function makeCheckpoint(params: {
  reviewOutputKey: string;
  filesReviewed: string[];
  totalFiles: number;
  findingCount?: number;
  summaryDraft?: string;
  partialCommentId?: number;
}): CheckpointRecord {
  return {
    reviewOutputKey: params.reviewOutputKey,
    repo: "acme/repo",
    prNumber: 101,
    filesReviewed: params.filesReviewed,
    findingCount: params.findingCount ?? 1,
    summaryDraft: params.summaryDraft ?? "Deterministic verifier checkpoint.",
    totalFiles: params.totalFiles,
    partialCommentId: params.partialCommentId,
  };
}

export function getDefaultScenarioMatrix(): ScenarioDefinition[] {
  const reviewOutputKey = makeReviewOutputKey("delivery-verify-m063-s01");
  const continuationReviewOutputKey = `${reviewOutputKey}-retry-1`;
  const riskScores = makeRiskScores(["README.md", "src/a.ts", "src/b.ts"]);

  return [
    {
      scenarioId: "schedule-continuation",
      reviewOutputKey,
      firstPass: makeFirstPass({ totalFiles: 3, reviewedFiles: 1, remainingFiles: 2 }),
      checkpoint: makeCheckpoint({ reviewOutputKey, filesReviewed: ["README.md"], totalFiles: 3, partialCommentId: 600 }),
      riskScores,
      hasPublishedInlineFindings: false,
      isChronicTimeout: false,
      timeoutSeconds: 120,
      continuationCheckpoint: null,
      continuationPublished: false,
      newerAttemptClaimsAuthority: false,
    },
    {
      scenarioId: "merge-continuation",
      reviewOutputKey,
      firstPass: makeFirstPass({ totalFiles: 3, reviewedFiles: 1, remainingFiles: 2 }),
      checkpoint: makeCheckpoint({ reviewOutputKey, filesReviewed: ["README.md"], totalFiles: 3, partialCommentId: 600 }),
      riskScores,
      hasPublishedInlineFindings: false,
      isChronicTimeout: false,
      timeoutSeconds: 120,
      continuationCheckpoint: makeCheckpoint({
        reviewOutputKey: continuationReviewOutputKey,
        filesReviewed: ["src/a.ts"],
        totalFiles: 3,
        findingCount: 1,
        summaryDraft: "Retry found another issue.",
      }),
      continuationPublished: false,
      newerAttemptClaimsAuthority: false,
    },
    {
      scenarioId: "settle-no-delta",
      reviewOutputKey,
      firstPass: makeFirstPass({ totalFiles: 3, reviewedFiles: 1, remainingFiles: 2 }),
      checkpoint: makeCheckpoint({ reviewOutputKey, filesReviewed: ["README.md"], totalFiles: 3, partialCommentId: 600 }),
      riskScores,
      hasPublishedInlineFindings: false,
      isChronicTimeout: false,
      timeoutSeconds: 120,
      continuationCheckpoint: makeCheckpoint({
        reviewOutputKey: continuationReviewOutputKey,
        filesReviewed: ["README.md"],
        totalFiles: 3,
        findingCount: 0,
        summaryDraft: "Retry found nothing new.",
      }),
      continuationPublished: false,
      newerAttemptClaimsAuthority: false,
    },
    {
      scenarioId: "no-follow-up",
      reviewOutputKey,
      firstPass: makeFirstPass({ totalFiles: 1, reviewedFiles: 1, remainingFiles: 0 }),
      checkpoint: makeCheckpoint({ reviewOutputKey, filesReviewed: ["README.md"], totalFiles: 1, partialCommentId: 600 }),
      riskScores: makeRiskScores(["README.md"]),
      hasPublishedInlineFindings: false,
      isChronicTimeout: false,
      timeoutSeconds: 120,
      continuationCheckpoint: null,
      continuationPublished: false,
      newerAttemptClaimsAuthority: false,
    },
    {
      scenarioId: "stale-authority-suppressed",
      reviewOutputKey,
      firstPass: makeFirstPass({ totalFiles: 3, reviewedFiles: 1, remainingFiles: 2 }),
      checkpoint: makeCheckpoint({ reviewOutputKey, filesReviewed: ["README.md"], totalFiles: 3, partialCommentId: 600 }),
      riskScores,
      hasPublishedInlineFindings: false,
      isChronicTimeout: false,
      timeoutSeconds: 120,
      continuationCheckpoint: makeCheckpoint({
        reviewOutputKey: continuationReviewOutputKey,
        filesReviewed: ["src/a.ts"],
        totalFiles: 3,
        findingCount: 1,
        summaryDraft: "Retry found another issue.",
      }),
      continuationPublished: false,
      newerAttemptClaimsAuthority: true,
    },
  ];
}

function buildInvalidArgReport(issue: string, generatedAt = new Date().toISOString()): M063S01Report {
  return {
    command: "verify:m063:s01",
    generated_at: generatedAt,
    scenario_count: 0,
    success: false,
    status_code: "m063_s01_invalid_arg",
    scenarios: [],
    issues: [issue],
  };
}

function estimateContinuationTimeout(params: { timeoutSeconds: number; files: string[] }) {
  return {
    riskLevel: params.files.length > 1 ? "medium" : "low",
    dynamicTimeoutSeconds: params.timeoutSeconds,
    reasoning: `Deterministic verifier estimate for ${params.files.length} files.`,
    shouldReduceScope: false,
  } as const;
}

function validatePlan(plan: ReviewContinuationPlanDecision | null, issues: string[]): void {
  if (!plan) {
    issues.push("Continuation planner did not return a decision.");
    return;
  }

  if (plan.decision === "schedule-continuation") {
    if (!plan.continuationReviewOutputKey || plan.continuationReviewOutputKey.trim().length === 0) {
      issues.push("Scheduled continuation is missing a continuation review output key.");
    }
    if (plan.continuationNumber !== 1) {
      issues.push("Scheduled continuation no longer uses deterministic continuation number 1.");
    }
    if (!Array.isArray(plan.continuationFiles) || plan.continuationFiles.length === 0) {
      issues.push("Scheduled continuation is missing continuation files.");
    }
    if (!plan.continuationReviewOutputKey?.endsWith("-retry-1")) {
      issues.push("Scheduled continuation lost the stable -retry-1 pass identity.");
    }
  }
}

function validateSettlement(
  settlement: ReviewContinuationSettlementDecision | null,
  plan: ReviewContinuationPlanDecision | null,
  issues: string[],
): void {
  if (!settlement || !plan || plan.decision !== "schedule-continuation") {
    return;
  }

  const expectedCleanup = [plan.reviewOutputKey, plan.continuationReviewOutputKey];
  if (
    settlement.cleanupReviewOutputKeys[0] !== expectedCleanup[0]
    || settlement.cleanupReviewOutputKeys[1] !== expectedCleanup[1]
  ) {
    issues.push("Settlement cleanup keys no longer match the base and continuation identities.");
  }
}

function evaluateAuthority(params: {
  newerAttemptClaimsAuthority: boolean;
}): AuthorityStatus {
  const coordinator = createReviewWorkCoordinator({
    nowFn: (() => {
      let nowMs = 1_000;
      return () => ++nowMs;
    })(),
  });
  const familyKey = buildReviewFamilyKey("acme", "repo", 101);

  const parentAttempt = coordinator.claim({
    familyKey,
    source: "automatic-review",
    lane: "review",
    deliveryId: "delivery-parent",
    phase: "claimed",
  });
  coordinator.setPhase(parentAttempt.attemptId, "executor-dispatch");
  coordinator.complete(parentAttempt.attemptId);

  const retryAttempt = coordinator.claim({
    familyKey,
    source: "automatic-review",
    lane: "review",
    deliveryId: "delivery-parent-retry-1",
    phase: "claimed",
  });
  coordinator.setPhase(retryAttempt.attemptId, "executor-dispatch");

  if (params.newerAttemptClaimsAuthority) {
    const explicitAttempt = coordinator.claim({
      familyKey,
      source: "explicit-review",
      lane: "interactive-review",
      deliveryId: "delivery-explicit-newer",
      phase: "claimed",
    });
    coordinator.setPhase(explicitAttempt.attemptId, "executor-dispatch");
    return coordinator.canPublish(retryAttempt.attemptId) ? "authoritative" : "suppressed";
  }

  return coordinator.canPublish(retryAttempt.attemptId) ? "authoritative" : "suppressed";
}

export function evaluateScenario(params: EvaluateScenarioInput): M063S01ScenarioRecord {
  const issues: string[] = [];

  let plan = planReviewContinuation({
    reviewOutputKey: params.reviewOutputKey,
    firstPass: params.firstPass,
    checkpoint: params.checkpoint,
    riskScores: params.riskScores,
    timeoutSeconds: params.timeoutSeconds,
    hasPublishedInlineFindings: params.hasPublishedInlineFindings,
    isChronicTimeout: params.isChronicTimeout,
    estimateContinuationTimeout,
  });

  if (params.mutatePlan) {
    plan = params.mutatePlan(plan);
  }

  validatePlan(plan, issues);

  let settlement: ReviewContinuationSettlementDecision | null = null;
  if (plan?.decision === "schedule-continuation" && params.continuationCheckpoint !== null) {
    settlement = settleReviewContinuation({
      reviewOutputKey: params.reviewOutputKey,
      continuationReviewOutputKey: plan.continuationReviewOutputKey,
      baseCheckpoint: params.checkpoint,
      continuationCheckpoint: params.continuationCheckpoint,
      continuationPublished: params.continuationPublished,
    });
  }

  if (params.mutateSettlement) {
    settlement = params.mutateSettlement(settlement);
  }

  validateSettlement(settlement, plan, issues);

  const continuationStatus: ContinuationStatus = plan?.decision === "schedule-continuation"
    ? "scheduled"
    : "not-needed";
  const settlementStatus: SettlementStatus = settlement === null
    ? "not-run"
    : settlement.decision === "merge-continuation"
      ? "merge-ready"
      : "no-delta";
  const authorityStatus = evaluateAuthority({
    newerAttemptClaimsAuthority: params.newerAttemptClaimsAuthority,
  });

  let statusCode: M063S01ScenarioStatusCode;
  if (issues.length > 0) {
    statusCode = "invalid-contract";
  } else if (authorityStatus === "suppressed") {
    statusCode = "continuation-authority-suppressed";
  } else if (settlementStatus === "merge-ready") {
    statusCode = "continuation-merged";
  } else if (settlementStatus === "no-delta") {
    statusCode = "continuation-settled-no-delta";
  } else if (continuationStatus === "scheduled") {
    statusCode = "continuation-scheduled";
  } else {
    statusCode = "continuation-not-needed";
  }

  return {
    scenarioId: params.scenarioId,
    success: issues.length === 0,
    statusCode,
    continuationStatus,
    settlementStatus,
    authorityStatus,
    reviewOutputKey: params.reviewOutputKey,
    continuationReviewOutputKey: plan?.decision === "schedule-continuation" ? plan.continuationReviewOutputKey : null,
    continuationNumber: plan?.decision === "schedule-continuation" ? plan.continuationNumber : null,
    issues,
  };
}

export function evaluateM063S01(params?: {
  generatedAt?: string;
  scenarioId?: M063S01ScenarioId | null;
}): M063S01Report {
  const generatedAt = params?.generatedAt ?? new Date().toISOString();
  const definitions = getDefaultScenarioMatrix();
  const selectedDefinitions = params?.scenarioId
    ? definitions.filter((definition) => definition.scenarioId === params.scenarioId)
    : definitions;
  const scenarios = selectedDefinitions.map((definition) => evaluateScenario(definition));
  const issues = scenarios.flatMap((scenario) => scenario.issues.map((issue) => `${scenario.scenarioId}: ${issue}`));

  return {
    command: "verify:m063:s01",
    generated_at: generatedAt,
    scenario_count: scenarios.length,
    success: issues.length === 0,
    status_code: issues.length === 0 ? "m063_s01_ok" : "m063_s01_verifier_failed",
    scenarios,
    issues,
  };
}

export function parseVerifyM063S01Args(args: string[]): VerifyM063S01Args {
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
    "Usage: bun run verify:m063:s01 -- [--scenario <id>] [--json]",
    "",
    "Scenario ids:",
    ...M063_S01_SCENARIO_IDS.map((id) => `  ${id}`),
    "",
    "Options:",
    "  --scenario   Run one deterministic scenario instead of the full matrix",
    "  --json       Print machine-readable JSON output",
    "  --help       Show this help",
  ].join("\n");
}

export function renderM063S01Report(report: M063S01Report): string {
  const lines = [
    "# M063 S01 — Automatic Continuation Lifecycle Verifier",
    "",
    `Status: ${report.status_code}`,
    `Scenarios: ${report.scenario_count}`,
  ];

  if (report.scenarios.length > 0) {
    lines.push("", "Scenario matrix:");
    for (const scenario of report.scenarios) {
      lines.push(`- ${scenario.scenarioId}: ${scenario.statusCode}`);
      lines.push(
        `  - continuation=${scenario.continuationStatus} settlement=${scenario.settlementStatus} authority=${scenario.authorityStatus}`,
      );
      lines.push(
        `  - reviewOutputKey=${scenario.reviewOutputKey} continuationReviewOutputKey=${scenario.continuationReviewOutputKey ?? "none"}`,
      );
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
  const options = parseVerifyM063S01Args(args);

  if (options.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  if (options.scenarioId && !VALID_SCENARIO_IDS.has(options.scenarioId)) {
    const report = buildInvalidArgReport(`Unknown scenario id: ${options.scenarioId}.`);
    stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderM063S01Report(report));
    return 1;
  }

  const report = evaluateM063S01({ scenarioId: (options.scenarioId as M063S01ScenarioId | null) ?? null });
  stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderM063S01Report(report));
  return report.success ? 0 : 1;
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
