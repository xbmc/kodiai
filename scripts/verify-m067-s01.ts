import {
  buildReviewPlan,
  createDegradedReviewPlan,
  toReviewPlanDetailsSummary,
  type DegradedReviewPlan,
  type ReviewPlan,
  type ReviewPlanInput,
} from "../src/review-orchestration/review-plan.ts";
import { formatReviewDetailsSummary } from "../src/lib/review-utils.ts";
import { projectContributorExperienceContract } from "../src/contributor/experience-contract.ts";

export const M067_S01_CHECK_IDS = [
  "READY-PLAN-HASH",
  "READY-REVIEW-DETAILS-COMPACT",
  "DEGRADED-PLAN-RENDERING",
] as const;

export type M067S01CheckId = (typeof M067_S01_CHECK_IDS)[number];

export type M067S01StatusCode =
  | "m067_s01_ok"
  | "m067_s01_contract_failed"
  | "m067_s01_invalid_arg";

export type M067S01CheckStatusCode =
  | "ready_plan_hash_present"
  | "ready_plan_hash_missing"
  | "ready_review_details_compact"
  | "ready_review_details_not_compact"
  | "degraded_plan_rendered"
  | "degraded_plan_not_rendered";

export type M067S01Check = {
  id: M067S01CheckId;
  passed: boolean;
  status_code: M067S01CheckStatusCode;
  detail: string;
};

export type M067S01ReviewDetailsEvidence = {
  marker_count: number;
  review_plan_line_count: number;
  review_plan_line: string;
};

export type M067S01Report = {
  command: "verify:m067:s01";
  generated_at: string;
  success: boolean;
  status_code: M067S01StatusCode;
  check_ids: M067S01CheckId[];
  checks: M067S01Check[];
  failing_check_id: M067S01CheckId | null;
  issues: string[];
  ready_plan: Pick<ReviewPlan, "status" | "hash">;
  degraded_plan: Pick<DegradedReviewPlan, "status" | "hash">;
  review_details: {
    ready: M067S01ReviewDetailsEvidence;
    degraded: M067S01ReviewDetailsEvidence;
  };
};

type FormatReviewDetailsSummaryFn = typeof formatReviewDetailsSummary;

type EvaluateM067S01Params = {
  generatedAt?: string;
  overrides?: {
    formatReviewDetailsSummaryFn?: FormatReviewDetailsSummaryFn;
  };
};

type VerifyM067S01Args = {
  help: boolean;
  json: boolean;
};

const READY_REVIEW_OUTPUT_KEY = "m067-s01-ready";
const DEGRADED_REVIEW_OUTPUT_KEY = "m067-s01-degraded";
const RAW_LEAK_MARKERS = [
  "PROMPT_SECRET",
  "diff --git",
  "TOKEN=",
  "abc123",
  "{\"",
  "rawPrompt",
  "rawDiff",
  "secretToken",
];

function representativeReviewPlanInput(): ReviewPlanInput & Record<string, unknown> {
  return {
    task: {
      taskType: "review-full",
      routingReason: "standard",
    },
    change: {
      changedFileCount: 4,
      linesChanged: 212,
      linesChangedSource: "diff-numstat",
    },
    budget: {
      timeoutSeconds: 900,
      maxTurns: 50,
      maxTurnsSource: "default-review-budget",
    },
    context: {
      sources: ["pr-metadata", "diff-summary"],
      summary: "Representative tracked inline fixture summary.",
    },
    gates: {
      enabled: ["quality", "security"],
      current: ["quality"],
    },
    policy: {
      publish: "inline+summary",
      tools: "standard-review-tools",
      retry: "retry-on-transient-failure",
    },
    graphValidation: {
      status: "enabled",
      reason: "graph-blast-radius-available",
    },
    candidateFinding: {
      mode: "shadow",
      reason: "candidate-finding-shadow-mode",
    },
    // These intentionally model untrusted builder-adjacent data. The plan
    // contract must whitelist them away before hashing/projection.
    rawPrompt: "PROMPT_SECRET do not publish",
    rawDiff: "diff --git a/secret.ts b/secret.ts\n+TOKEN=abc123",
    secretToken: "abc123",
  };
}

function buildReviewDetails(params: {
  reviewOutputKey: string;
  reviewPlan: ReturnType<typeof toReviewPlanDetailsSummary>;
  formatter: FormatReviewDetailsSummaryFn;
}): string {
  return params.formatter({
    reviewOutputKey: params.reviewOutputKey,
    filesReviewed: 4,
    linesAdded: 150,
    linesRemoved: 62,
    findingCounts: {
      critical: 0,
      major: 1,
      medium: 1,
      minor: 0,
    },
    profileSelection: {
      selectedProfile: "balanced",
      source: "auto",
      autoBand: null,
      linesChanged: 212,
    },
    contributorExperience: projectContributorExperienceContract({
      source: "author-cache",
      tier: "regular",
    }).reviewDetails,
    reviewPlan: params.reviewPlan,
    completedAt: "2026-05-09T17:00:00.000Z",
  });
}

function countOccurrences(value: string, needle: string): number {
  if (!needle) {
    return 0;
  }
  return value.split(needle).length - 1;
}

function inspectReviewDetails(body: string, reviewOutputKey: string): M067S01ReviewDetailsEvidence {
  const reviewPlanLines = body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes("Review plan:"));

  return {
    marker_count: countOccurrences(body, `<!-- kodiai:review-details:${reviewOutputKey} -->`),
    review_plan_line_count: reviewPlanLines.length,
    review_plan_line: reviewPlanLines[0] ?? "",
  };
}

function hasRawLeak(value: string): boolean {
  return RAW_LEAK_MARKERS.some((marker) => value.includes(marker));
}

function buildReadyPlanHashCheck(plan: ReviewPlan): M067S01Check {
  const passed = /^[a-f0-9]{64}$/.test(plan.hash);
  return {
    id: "READY-PLAN-HASH",
    passed,
    status_code: passed ? "ready_plan_hash_present" : "ready_plan_hash_missing",
    detail: passed
      ? `ready plan hash present (${plan.hash.slice(0, 12)})`
      : "ready plan hash missing or malformed",
  };
}

function buildReadyReviewDetailsCheck(evidence: M067S01ReviewDetailsEvidence): M067S01Check {
  const hasExactlyOneLine = evidence.review_plan_line_count === 1;
  const hasMarker = evidence.marker_count === 1;
  const startsCompact = evidence.review_plan_line.startsWith("- Review plan: ready hash=");
  const withinBound = evidence.review_plan_line.length <= 242;
  const rawLeak = hasRawLeak(evidence.review_plan_line);
  const passed = hasExactlyOneLine && hasMarker && startsCompact && withinBound && !rawLeak;

  const failures = [
    ...(!hasExactlyOneLine ? [`expected exactly one compact Review plan line, found ${evidence.review_plan_line_count}`] : []),
    ...(!hasMarker ? [`expected exactly one Review Details marker, found ${evidence.marker_count}`] : []),
    ...(!startsCompact ? ["Review plan line does not use the compact ready prefix"] : []),
    ...(!withinBound ? [`Review plan line is too long (${evidence.review_plan_line.length} chars)`] : []),
    ...(rawLeak ? ["Review plan line leaked raw JSON, diff, prompt, token, or secret-like data"] : []),
  ];

  return {
    id: "READY-REVIEW-DETAILS-COMPACT",
    passed,
    status_code: passed ? "ready_review_details_compact" : "ready_review_details_not_compact",
    detail: passed
      ? "ready Review Details contains exactly one compact Review plan line and marker with no raw data leaks"
      : failures.join("; "),
  };
}

function buildDegradedPlanRenderingCheck(params: {
  plan: DegradedReviewPlan;
  evidence: M067S01ReviewDetailsEvidence;
}): M067S01Check {
  const hasDegradedHash = /^degraded-[a-f0-9]{16}$/.test(params.plan.hash);
  const hasExactlyOneLine = params.evidence.review_plan_line_count === 1;
  const hasMarker = params.evidence.marker_count === 1;
  const line = params.evidence.review_plan_line;
  const hasDegradedSignals = line.includes("Review plan: degraded")
    && line.includes("graph=skipped")
    && line.includes("candidates=unavailable");
  const rawLeak = hasRawLeak(line);
  const passed = hasDegradedHash && hasExactlyOneLine && hasMarker && hasDegradedSignals && !rawLeak;

  const failures = [
    ...(!hasDegradedHash ? ["degraded plan hash missing or malformed"] : []),
    ...(!hasExactlyOneLine ? [`expected one degraded Review plan line, found ${params.evidence.review_plan_line_count}`] : []),
    ...(!hasMarker ? [`expected one degraded Review Details marker, found ${params.evidence.marker_count}`] : []),
    ...(!hasDegradedSignals ? ["degraded Review plan line missing degraded/graph/candidate signals"] : []),
    ...(rawLeak ? ["degraded Review plan line leaked raw data"] : []),
  ];

  return {
    id: "DEGRADED-PLAN-RENDERING",
    passed,
    status_code: passed ? "degraded_plan_rendered" : "degraded_plan_not_rendered",
    detail: passed
      ? "degraded plan renders as fail-open Review Details metadata"
      : failures.join("; "),
  };
}

function deriveOutcome(checks: M067S01Check[]): Pick<M067S01Report, "success" | "status_code" | "failing_check_id" | "issues"> {
  const failingCheck = checks.find((check) => !check.passed);
  if (!failingCheck) {
    return {
      success: true,
      status_code: "m067_s01_ok",
      failing_check_id: null,
      issues: [],
    };
  }

  return {
    success: false,
    status_code: "m067_s01_contract_failed",
    failing_check_id: failingCheck.id,
    issues: [`${failingCheck.id}: ${failingCheck.detail}`],
  };
}

function buildInvalidArgReport(params: { generatedAt?: string; issue: string }): M067S01Report {
  return {
    command: "verify:m067:s01",
    generated_at: params.generatedAt ?? new Date().toISOString(),
    success: false,
    status_code: "m067_s01_invalid_arg",
    check_ids: [...M067_S01_CHECK_IDS],
    checks: [],
    failing_check_id: null,
    issues: [params.issue],
    ready_plan: { status: "ready", hash: "" },
    degraded_plan: { status: "degraded", hash: "degraded-0000000000000000" },
    review_details: {
      ready: { marker_count: 0, review_plan_line_count: 0, review_plan_line: "" },
      degraded: { marker_count: 0, review_plan_line_count: 0, review_plan_line: "" },
    },
  };
}

export function evaluateM067S01ReviewPlanContract(params?: EvaluateM067S01Params): M067S01Report {
  const generatedAt = params?.generatedAt ?? new Date().toISOString();
  const formatter = params?.overrides?.formatReviewDetailsSummaryFn ?? formatReviewDetailsSummary;
  const readyPlan = buildReviewPlan(representativeReviewPlanInput()).plan;
  const degradedPlan = createDegradedReviewPlan({
    reason: "canonicalization-error",
    message: "review plan builder failed with redacted diagnostic",
    taskType: "review-full",
    routingReason: "standard",
  });

  const readyReviewDetails = buildReviewDetails({
    reviewOutputKey: READY_REVIEW_OUTPUT_KEY,
    reviewPlan: toReviewPlanDetailsSummary(readyPlan),
    formatter,
  });
  const degradedReviewDetails = buildReviewDetails({
    reviewOutputKey: DEGRADED_REVIEW_OUTPUT_KEY,
    reviewPlan: toReviewPlanDetailsSummary(degradedPlan),
    formatter,
  });

  const readyEvidence = inspectReviewDetails(readyReviewDetails, READY_REVIEW_OUTPUT_KEY);
  const degradedEvidence = inspectReviewDetails(degradedReviewDetails, DEGRADED_REVIEW_OUTPUT_KEY);
  const checks = [
    buildReadyPlanHashCheck(readyPlan),
    buildReadyReviewDetailsCheck(readyEvidence),
    buildDegradedPlanRenderingCheck({ plan: degradedPlan, evidence: degradedEvidence }),
  ];
  const outcome = deriveOutcome(checks);

  return {
    command: "verify:m067:s01",
    generated_at: generatedAt,
    success: outcome.success,
    status_code: outcome.status_code,
    check_ids: [...M067_S01_CHECK_IDS],
    checks,
    failing_check_id: outcome.failing_check_id,
    issues: outcome.issues,
    ready_plan: {
      status: readyPlan.status,
      hash: readyPlan.hash,
    },
    degraded_plan: {
      status: degradedPlan.status,
      hash: degradedPlan.hash,
    },
    review_details: {
      ready: readyEvidence,
      degraded: degradedEvidence,
    },
  };
}

export function parseVerifyM067S01Args(args: string[]): VerifyM067S01Args {
  for (const arg of args) {
    if (arg === "--help" || arg === "-h" || arg === "--json") {
      continue;
    }

    throw new Error(`invalid_cli_args: Unknown argument: ${arg}`);
  }

  return {
    help: args.includes("--help") || args.includes("-h"),
    json: args.includes("--json"),
  };
}

function usage(): string {
  return [
    "Usage: bun run verify:m067:s01 -- [--json]",
    "",
    "Verifies the M067 S01 ReviewPlan contract using local inline fixtures only.",
    "",
    "Options:",
    "  --json       Print machine-readable JSON output",
    "  --help       Show this help",
  ].join("\n");
}

export function renderM067S01Report(report: M067S01Report): string {
  const lines = [
    "# M067 S01 — ReviewPlan Contract Verifier",
    "",
    `Status: ${report.status_code}`,
    `Overall success: ${String(report.success)}`,
    `Failing check: ${report.failing_check_id ?? "none"}`,
    `Ready plan hash: ${report.ready_plan.hash || "missing"}`,
    `Degraded plan hash: ${report.degraded_plan.hash}`,
    "",
    "Checks:",
  ];

  for (const check of report.checks) {
    lines.push(`- ${check.id}: ${check.status_code} (passed=${String(check.passed)})`);
    lines.push(`  - ${check.detail}`);
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
    evaluateFn?: typeof evaluateM067S01ReviewPlanContract;
  },
): Promise<number> {
  const stdout = deps?.stdout ?? process.stdout;
  const stderr = deps?.stderr ?? process.stderr;
  const evaluateFn = deps?.evaluateFn ?? evaluateM067S01ReviewPlanContract;

  try {
    const options = parseVerifyM067S01Args(args);

    if (options.help) {
      stdout.write(`${usage()}\n`);
      return 0;
    }

    const report = evaluateFn();
    stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderM067S01Report(report));

    if (!report.success) {
      stderr.write(`verify:m067:s01 failed: ${report.failing_check_id ?? report.status_code}\n`);
    }

    return report.success ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const report = buildInvalidArgReport({ issue: message });
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 1;
  }
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
