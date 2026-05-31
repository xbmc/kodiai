import { formatPartialReviewComment, type ContinuationRevisionCounts } from "../src/lib/partial-review-formatter.ts";
import { formatReviewDetailsSummary } from "../src/lib/review-utils.ts";
import type { ReviewFirstPassPayload } from "../src/lib/review-first-pass.ts";
import {
  buildReviewOutputKey,
  buildReviewOutputMarker,
  extractReviewOutputKey,
} from "../src/review-orchestration/review-idempotency.ts";
import { buildReviewDetailsMarker } from "../src/lib/review-utils.ts";
import { projectContributorExperienceContract } from "../src/contributor/experience-contract.ts";

export const M063_S02_SCENARIO_IDS = [
  "timeout-first-pass",
  "merge-revisions",
  "settle-no-delta",
] as const;

export type M063S02ScenarioId = (typeof M063_S02_SCENARIO_IDS)[number];

export type M063S02StatusCode =
  | "m063_s02_ok"
  | "m063_s02_invalid_arg"
  | "m063_s02_verifier_failed";

export type M063S02ScenarioStatusCode =
  | "same-surface-pending"
  | "same-surface-revised"
  | "same-surface-quiet-settlement"
  | "contract-failed";

export type M063S02Check = {
  key:
    | "marker-continuity"
    | "review-details-attached"
    | "same-surface-ownership"
    | "revision-visibility"
    | "quiet-settlement";
  status: "pass" | "fail" | "expected-negative";
  detail: string;
};

export type M063S02ScenarioRecord = {
  scenarioId: string;
  success: boolean;
  statusCode: M063S02ScenarioStatusCode;
  sameSurface: boolean;
  revisionVisible: boolean;
  quietNoDelta: boolean;
  baseReviewOutputKey: string;
  visibleSurfaceCount: number;
  continuationSurfaceCount: number;
  issues: string[];
  checks: M063S02Check[];
};

export type M063S02Report = {
  command: "verify:m063:s02";
  generated_at: string;
  scenario_count: number;
  success: boolean;
  status_code: M063S02StatusCode;
  scenarios: M063S02ScenarioRecord[];
  issues: string[];
};

type VerifyM063S02Args = {
  help: boolean;
  json: boolean;
  scenarioId: string | null;
};

type ScenarioDefinition = {
  scenarioId: M063S02ScenarioId;
  reviewOutputKey: string;
  firstPass: ReviewFirstPassPayload;
  mergedFirstPass?: ReviewFirstPassPayload;
  summaryDraft: string;
  mergedSummaryDraft?: string;
  timedOutAfterSeconds: number;
  continuationRevisionCounts?: ContinuationRevisionCounts | null;
  expectRevisionVisible: boolean;
  expectQuietNoDelta: boolean;
};

type ScenarioBodies = {
  canonicalBody: string;
  visibleBodies: string[];
};

type EvaluateScenarioInput = ScenarioDefinition & {
  mutateBodies?: (
    bodies: ScenarioBodies,
    helpers: {
      baseMarker: string;
      retryMarker: string;
      reviewDetailsMarker: string;
    },
  ) => ScenarioBodies;
};

const VALID_SCENARIO_IDS = new Set<string>(M063_S02_SCENARIO_IDS);

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

function makeFirstPass(params: {
  reviewedFiles: number;
  remainingFiles: number;
  totalFiles: number;
  findingCount: number;
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
    findingCount: params.findingCount,
    publication: {
      eligible: true,
      hasPublishedOutput: false,
    },
    continuationPending: true,
    zeroEvidenceFailure: false,
  };
}

function buildReviewDetails(params: {
  reviewOutputKey: string;
  firstPass: ReviewFirstPassPayload;
}): string {
  return formatReviewDetailsSummary({
    reviewOutputKey: params.reviewOutputKey,
    filesReviewed: params.firstPass.coveredScope?.reviewedFiles ?? 0,
    linesAdded: 40,
    linesRemoved: 10,
    findingCounts: {
      critical: 0,
      major: params.firstPass.findingCount ?? 0,
      medium: 0,
      minor: 0,
    },
    profileSelection: {
      selectedProfile: "balanced",
      source: "auto",
      autoBand: null,
      linesChanged: 50,
    },
    contributorExperience: projectContributorExperienceContract({
      source: "author-cache",
      tier: "regular",
    }).reviewDetails,
    reviewFirstPass: params.firstPass,
    completedAt: "2026-04-24T06:00:00.000Z",
  });
}

function buildCanonicalBody(params: {
  reviewOutputKey: string;
  firstPass: ReviewFirstPassPayload;
  summaryDraft: string;
  timedOutAfterSeconds: number;
  continuationRevisionCounts?: ContinuationRevisionCounts | null;
}): string {
  const partial = formatPartialReviewComment({
    summaryDraft: params.summaryDraft,
    firstPass: params.firstPass,
    reviewOutputKey: params.reviewOutputKey,
    timedOutAfterSeconds: params.timedOutAfterSeconds,
    isRetryResult: Boolean(params.continuationRevisionCounts),
    retryFilesReviewed: params.firstPass.coveredScope?.reviewedFiles ?? 0,
    continuationRevisionCounts: params.continuationRevisionCounts,
  });

  return `${partial}\n${buildReviewDetails({ reviewOutputKey: params.reviewOutputKey, firstPass: params.firstPass })}`;
}

export function getDefaultScenarioMatrix(): ScenarioDefinition[] {
  const reviewOutputKey = makeReviewOutputKey("delivery-verify-m063-s02");

  return [
    {
      scenarioId: "timeout-first-pass",
      reviewOutputKey,
      firstPass: makeFirstPass({ reviewedFiles: 1, remainingFiles: 2, totalFiles: 3, findingCount: 2 }),
      summaryDraft: "Found two issues before timeout.",
      timedOutAfterSeconds: 90,
      continuationRevisionCounts: null,
      expectRevisionVisible: false,
      expectQuietNoDelta: false,
    },
    {
      scenarioId: "merge-revisions",
      reviewOutputKey,
      firstPass: makeFirstPass({ reviewedFiles: 1, remainingFiles: 2, totalFiles: 3, findingCount: 2 }),
      mergedFirstPass: makeFirstPass({ reviewedFiles: 2, remainingFiles: 1, totalFiles: 3, findingCount: 2 }),
      summaryDraft: "Retry found one more issue.",
      mergedSummaryDraft: "Retry found one more issue.",
      timedOutAfterSeconds: 90,
      continuationRevisionCounts: {
        new: 2,
        stillOpen: 0,
        resolved: 2,
      },
      expectRevisionVisible: true,
      expectQuietNoDelta: false,
    },
    {
      scenarioId: "settle-no-delta",
      reviewOutputKey,
      firstPass: makeFirstPass({ reviewedFiles: 1, remainingFiles: 2, totalFiles: 3, findingCount: 1 }),
      summaryDraft: "Found one issue before timeout.",
      timedOutAfterSeconds: 90,
      continuationRevisionCounts: null,
      expectRevisionVisible: false,
      expectQuietNoDelta: true,
    },
  ];
}

function buildInvalidArgReport(issue: string, generatedAt = new Date().toISOString()): M063S02Report {
  return {
    command: "verify:m063:s02",
    generated_at: generatedAt,
    scenario_count: 0,
    success: false,
    status_code: "m063_s02_invalid_arg",
    scenarios: [],
    issues: [issue],
  };
}

function countBodiesWithMarker(bodies: string[], marker: string): number {
  return bodies.filter((body) => body.includes(marker)).length;
}

export function evaluateScenario(params: EvaluateScenarioInput): M063S02ScenarioRecord {
  const mergedFirstPass = params.mergedFirstPass ?? params.firstPass;
  const canonicalBody = params.expectQuietNoDelta
    ? buildCanonicalBody({
        reviewOutputKey: params.reviewOutputKey,
        firstPass: params.firstPass,
        summaryDraft: params.summaryDraft,
        timedOutAfterSeconds: params.timedOutAfterSeconds,
      })
    : buildCanonicalBody({
        reviewOutputKey: params.reviewOutputKey,
        firstPass: mergedFirstPass,
        summaryDraft: params.mergedSummaryDraft ?? params.summaryDraft,
        timedOutAfterSeconds: params.timedOutAfterSeconds,
        continuationRevisionCounts: params.continuationRevisionCounts,
      });

  const baseMarker = buildReviewOutputMarker(params.reviewOutputKey);
  const retryMarker = buildReviewOutputMarker(`${params.reviewOutputKey}-retry-1`);
  const reviewDetailsMarker = buildReviewDetailsMarker(params.reviewOutputKey);

  let bodies: ScenarioBodies = {
    canonicalBody,
    visibleBodies: [canonicalBody],
  };

  if (params.mutateBodies) {
    bodies = params.mutateBodies(bodies, { baseMarker, retryMarker, reviewDetailsMarker });
  }

  const issues: string[] = [];
  const checks: M063S02Check[] = [];
  const visibleSurfaceCount = bodies.visibleBodies.length;
  const baseSurfaceCount = countBodiesWithMarker(bodies.visibleBodies, baseMarker);
  const continuationSurfaceCount = countBodiesWithMarker(bodies.visibleBodies, retryMarker);
  const canonicalKey = extractReviewOutputKey(bodies.canonicalBody);
  const reviewDetailsAttached = bodies.canonicalBody.includes("<summary>Review Details</summary>")
    && bodies.canonicalBody.includes(reviewDetailsMarker);
  const revisionVisible = bodies.canonicalBody.includes("Continuation revisions:");
  const quietNoDelta = params.expectQuietNoDelta && !revisionVisible && visibleSurfaceCount === 1;
  const sameSurface = baseSurfaceCount === 1 && continuationSurfaceCount === 0 && visibleSurfaceCount === 1;

  const markerContinuityPass = canonicalKey === params.reviewOutputKey && bodies.canonicalBody.includes(baseMarker);
  checks.push({
    key: "marker-continuity",
    status: markerContinuityPass ? "pass" : "fail",
    detail: markerContinuityPass
      ? "Canonical surface retains the base review-output marker."
      : "Canonical surface lost the base review-output marker.",
  });
  if (!markerContinuityPass) {
    issues.push("Canonical surface lost the base review-output marker.");
  }

  checks.push({
    key: "review-details-attached",
    status: reviewDetailsAttached ? "pass" : "fail",
    detail: reviewDetailsAttached
      ? "Review Details remain attached to the canonical visible surface."
      : "Review Details drifted away from the canonical visible surface.",
  });
  if (!reviewDetailsAttached) {
    issues.push("Review Details drifted away from the canonical visible surface.");
  }

  const sameSurfacePass = sameSurface;
  checks.push({
    key: "same-surface-ownership",
    status: sameSurfacePass ? "pass" : "fail",
    detail: sameSurfacePass
      ? "Continuation stayed on one visible review surface anchored to the base reviewOutputKey."
      : "Expected exactly one visible review surface for the base reviewOutputKey.",
  });
  if (!sameSurfacePass) {
    issues.push("Expected exactly one visible review surface for the base reviewOutputKey.");
  }

  const revisionCheckPass = params.expectRevisionVisible ? revisionVisible : !revisionVisible;
  checks.push({
    key: "revision-visibility",
    status: revisionCheckPass ? "pass" : "fail",
    detail: params.expectRevisionVisible
      ? revisionVisible
        ? "Continuation revisions remained visible on the canonical surface."
        : "Continuation revisions disappeared from the canonical surface."
      : revisionVisible
        ? "Continuation revisions should stay absent when there is no meaningful delta."
        : "Continuation revisions stayed absent when there was no meaningful delta.",
  });
  if (!revisionCheckPass) {
    issues.push(
      params.expectRevisionVisible
        ? "Continuation revisions disappeared from the canonical surface."
        : "Continuation revisions should stay absent when there is no meaningful delta.",
    );
  }

  const quietSettlementPass = params.expectQuietNoDelta ? quietNoDelta : true;
  checks.push({
    key: "quiet-settlement",
    status: quietSettlementPass ? (params.expectQuietNoDelta ? "pass" : "expected-negative") : "fail",
    detail: params.expectQuietNoDelta
      ? quietSettlementPass
        ? "No-delta continuation settled without public churn."
        : "No-delta continuation mutated the public surface."
      : "Not a no-delta settlement scenario.",
  });
  if (!quietSettlementPass) {
    issues.push("No-delta continuation mutated the public surface.");
  }

  const statusCode: M063S02ScenarioStatusCode = issues.length > 0
    ? "contract-failed"
    : params.expectQuietNoDelta
      ? "same-surface-quiet-settlement"
      : params.expectRevisionVisible
        ? "same-surface-revised"
        : "same-surface-pending";

  return {
    scenarioId: params.scenarioId,
    success: issues.length === 0,
    statusCode,
    sameSurface,
    revisionVisible,
    quietNoDelta,
    baseReviewOutputKey: params.reviewOutputKey,
    visibleSurfaceCount,
    continuationSurfaceCount,
    issues,
    checks,
  };
}

export function evaluateM063S02(params?: {
  generatedAt?: string;
  scenarioId?: M063S02ScenarioId | null;
}): M063S02Report {
  const generatedAt = params?.generatedAt ?? new Date().toISOString();
  const definitions = getDefaultScenarioMatrix();
  const selectedDefinitions = params?.scenarioId
    ? definitions.filter((definition) => definition.scenarioId === params.scenarioId)
    : definitions;
  const scenarios = selectedDefinitions.map((definition) => evaluateScenario(definition));
  const issues = scenarios.flatMap((scenario) => scenario.issues.map((issue) => `${scenario.scenarioId}: ${issue}`));

  return {
    command: "verify:m063:s02",
    generated_at: generatedAt,
    scenario_count: scenarios.length,
    success: issues.length === 0,
    status_code: issues.length === 0 ? "m063_s02_ok" : "m063_s02_verifier_failed",
    scenarios,
    issues,
  };
}

export function parseVerifyM063S02Args(args: string[]): VerifyM063S02Args {
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
    "Usage: bun run verify:m063:s02 -- [--scenario <id>] [--json]",
    "",
    "Scenario ids:",
    ...M063_S02_SCENARIO_IDS.map((id) => `  ${id}`),
    "",
    "Options:",
    "  --scenario   Run one deterministic scenario instead of the full matrix",
    "  --json       Print machine-readable JSON output",
    "  --help       Show this help",
  ].join("\n");
}

export function renderM063S02Report(report: M063S02Report): string {
  const lines = [
    "# M063 S02 — Same-Surface Continuation Verifier",
    "",
    `Status: ${report.status_code}`,
    `Scenarios: ${report.scenario_count}`,
  ];

  if (report.scenarios.length > 0) {
    lines.push("", "Scenario matrix:");
    for (const scenario of report.scenarios) {
      lines.push(`- ${scenario.scenarioId}: ${scenario.statusCode}`);
      lines.push(
        `  - same-surface=${String(scenario.sameSurface)} revisions=${String(scenario.revisionVisible)} quiet-no-delta=${String(scenario.quietNoDelta)}`,
      );
      lines.push(
        `  - visible-surfaces=${scenario.visibleSurfaceCount} continuation-surfaces=${scenario.continuationSurfaceCount} base-key=${scenario.baseReviewOutputKey}`,
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
  const options = parseVerifyM063S02Args(args);

  if (options.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  if (options.scenarioId && !VALID_SCENARIO_IDS.has(options.scenarioId)) {
    const report = buildInvalidArgReport(`Unknown scenario id: ${options.scenarioId}.`);
    stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderM063S02Report(report));
    return 1;
  }

  const report = evaluateM063S02({ scenarioId: (options.scenarioId as M063S02ScenarioId | null) ?? null });
  stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderM063S02Report(report));
  return report.success ? 0 : 1;
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
