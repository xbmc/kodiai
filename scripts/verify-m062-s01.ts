import { normalizeReviewFirstPass, type ReviewFirstPassOutcome, type ReviewFirstPassPayload } from "../src/lib/review-first-pass.ts";
import type { ReviewBoundednessContract } from "../src/lib/review-boundedness.ts";
import type { CheckpointRecord } from "../src/knowledge/types.ts";
import { buildReviewOutputKey, parseReviewOutputKey } from "../src/handlers/review-idempotency.ts";

export type M062S01StatusCode =
  | "m062_s01_ok"
  | "m062_s01_invalid_arg"
  | "m062_s01_invalid_payload";

export type M062S01ScenarioStatusCode =
  | "bounded-first-pass"
  | "dead-end-failure"
  | "invalid-payload";

export type M062S01ScenarioId =
  | "timeout-checkpoint"
  | "max-turns-checkpoint"
  | "large-pr-bounded"
  | "zero-evidence-failure";

export type M062S01ScenarioRecord = {
  scenarioId: string;
  success: boolean;
  statusCode: M062S01ScenarioStatusCode;
  reviewOutputKey: string | null;
  state: ReviewFirstPassPayload["state"] | null;
  boundedReason: ReviewFirstPassPayload["boundedReason"] | null;
  evidenceSource: ReviewFirstPassPayload["evidenceSource"] | null;
  publicationEligible: boolean | null;
  hasPublishedOutput: boolean | null;
  coveredFiles: number | null;
  remainingFiles: number | null;
  totalFiles: number | null;
  issues: string[];
};

export type M062S01Report = {
  command: "verify:m062:s01";
  generated_at: string;
  scenario_count: number;
  success: boolean;
  status_code: M062S01StatusCode;
  scenarios: M062S01ScenarioRecord[];
  issues: string[];
};

type VerifyM062S01Args = {
  help: boolean;
  json: boolean;
  scenarioId: string | null;
};

type ScenarioDefinition = {
  scenarioId: M062S01ScenarioId;
  checkpoint: CheckpointRecord | null;
  boundedness: ReviewBoundednessContract | null;
  outcome: ReviewFirstPassOutcome;
  reviewOutputKey: string;
};

type EvaluateScenarioInput = {
  scenarioId: string;
  checkpoint: CheckpointRecord | null;
  boundedness: ReviewBoundednessContract | null;
  outcome: ReviewFirstPassOutcome;
  reviewOutputKey: string | null;
  mutateNormalizedPayload?: (payload: ReviewFirstPassPayload | null) => ReviewFirstPassPayload | null;
};

const VALID_SCENARIO_IDS = new Set<M062S01ScenarioId>([
  "timeout-checkpoint",
  "max-turns-checkpoint",
  "large-pr-bounded",
  "zero-evidence-failure",
]);

function buildScenarioReviewOutputKey(deliveryId: string) {
  return buildReviewOutputKey({
    installationId: 42,
    owner: "acme",
    repo: "repo",
    prNumber: 101,
    action: "review_requested",
    deliveryId,
    headSha: "abc123",
  });
}

function createResolvedProfile(linesChanged: number) {
  return {
    selectedProfile: "minimal" as const,
    source: "auto" as const,
    autoBand: "large" as const,
    linesChanged,
  };
}

function createLargePRBoundedness(params: {
  reviewedCount: number;
  totalFiles: number;
  abbreviatedCount?: number;
  fullCount?: number;
}): ReviewBoundednessContract {
  const fullCount = params.fullCount ?? Math.max(params.reviewedCount - (params.abbreviatedCount ?? 1), 0);
  const abbreviatedCount = params.abbreviatedCount ?? 1;
  const reviewedCount = params.reviewedCount;
  const totalFiles = params.totalFiles;
  const notReviewedCount = totalFiles - reviewedCount;
  const requestedProfile = createResolvedProfile(240);
  const effectiveProfile = createResolvedProfile(240);

  return {
    requestedProfile,
    effectiveProfile,
    reasonCodes: ["large-pr-triage"],
    disclosureRequired: true,
    disclosureSentence: `Requested minimal review; effective review remained minimal and covered ${reviewedCount}/${totalFiles} changed files via large-PR triage (${fullCount} full, ${abbreviatedCount} abbreviated; ${notReviewedCount} not reviewed).`,
    largePR: {
      fullCount,
      abbreviatedCount,
      reviewedCount,
      totalFiles,
      notReviewedCount,
    },
    timeout: null,
  };
}

function createCheckpoint(params: {
  deliveryId: string;
  filesReviewed: string[];
  totalFiles: number;
  findingCount: number;
}): CheckpointRecord {
  const reviewOutputKey = buildScenarioReviewOutputKey(params.deliveryId);
  return {
    reviewOutputKey,
    repo: "acme/repo",
    prNumber: 101,
    filesReviewed: params.filesReviewed,
    findingCount: params.findingCount,
    summaryDraft: "checkpoint summary",
    totalFiles: params.totalFiles,
  };
}

export function getDefaultScenarioMatrix(): ScenarioDefinition[] {
  return [
    {
      scenarioId: "timeout-checkpoint",
      checkpoint: createCheckpoint({
        deliveryId: "delivery-timeout-checkpoint",
        filesReviewed: ["src/a.ts", "src/b.ts"],
        totalFiles: 5,
        findingCount: 3,
      }),
      boundedness: null,
      outcome: {
        isTimeout: true,
        published: false,
        conclusion: "failure",
      },
      reviewOutputKey: buildScenarioReviewOutputKey("delivery-timeout-checkpoint"),
    },
    {
      scenarioId: "max-turns-checkpoint",
      checkpoint: createCheckpoint({
        deliveryId: "delivery-max-turns-checkpoint",
        filesReviewed: ["src/a.ts", "src/b.ts", "src/c.ts"],
        totalFiles: 6,
        findingCount: 2,
      }),
      boundedness: null,
      outcome: {
        stopReason: "max_turns",
        failureSubtype: "error_max_turns",
        published: true,
        conclusion: "failure",
      },
      reviewOutputKey: buildScenarioReviewOutputKey("delivery-max-turns-checkpoint"),
    },
    {
      scenarioId: "large-pr-bounded",
      checkpoint: null,
      boundedness: createLargePRBoundedness({
        reviewedCount: 2,
        totalFiles: 5,
        fullCount: 1,
        abbreviatedCount: 1,
      }),
      outcome: {
        published: true,
        conclusion: "success",
      },
      reviewOutputKey: buildScenarioReviewOutputKey("delivery-large-pr-bounded"),
    },
    {
      scenarioId: "zero-evidence-failure",
      checkpoint: null,
      boundedness: null,
      outcome: {
        stopReason: "max_turns",
        failureSubtype: "error_max_turns",
        published: false,
        conclusion: "failure",
      },
      reviewOutputKey: buildScenarioReviewOutputKey("delivery-zero-evidence-failure"),
    },
  ];
}

function isValidBoundedReason(value: unknown): value is ReviewFirstPassPayload["boundedReason"] {
  return value === "timeout" || value === "max-turns" || value === "large-pr";
}

function isValidEvidenceSource(value: unknown): value is ReviewFirstPassPayload["evidenceSource"] {
  return value === "checkpoint" || value === "boundedness" || value === "none";
}

function validateScenarioIdentity(reviewOutputKey: string | null): string[] {
  if (!reviewOutputKey) {
    return ["Missing review output identity."];
  }

  return parseReviewOutputKey(reviewOutputKey) ? [] : ["Missing review output identity."];
}

function validateCoverage(payload: ReviewFirstPassPayload): string[] {
  const issues: string[] = [];
  const covered = payload.coveredScope;
  const remaining = payload.remainingScope;

  if (!covered && !remaining) {
    return issues;
  }

  if (!covered || !remaining) {
    issues.push("Covered/remaining scope counts are inconsistent.");
    return issues;
  }

  if (
    covered.reviewedFiles < 0 ||
    remaining.remainingFiles < 0 ||
    covered.totalFiles < 0 ||
    remaining.totalFiles < 0 ||
    covered.reviewedFiles > covered.totalFiles ||
    remaining.remainingFiles > remaining.totalFiles ||
    covered.totalFiles !== remaining.totalFiles ||
    covered.reviewedFiles + remaining.remainingFiles !== covered.totalFiles
  ) {
    issues.push("Covered/remaining scope counts are inconsistent.");
  }

  return issues;
}

function validateNormalizedPayload(params: {
  reviewOutputKey: string | null;
  payload: ReviewFirstPassPayload | null;
}): string[] {
  const issues = [...validateScenarioIdentity(params.reviewOutputKey)];
  const payload = params.payload;

  if (!payload) {
    issues.push("Normalized payload is missing.");
    return issues;
  }

  if (!isValidBoundedReason(payload.boundedReason)) {
    issues.push("Invalid bounded reason in normalized payload.");
  }

  if (!isValidEvidenceSource(payload.evidenceSource)) {
    issues.push("Invalid evidence source in normalized payload.");
  }

  issues.push(...validateCoverage(payload));

  if (payload.state === "bounded-first-pass") {
    if (payload.zeroEvidenceFailure) {
      issues.push("Bounded first-pass payload cannot declare zeroEvidenceFailure.");
    }

    if (!payload.publication.eligible) {
      issues.push("Bounded first-pass payload must remain publication eligible.");
    }
  }

  if (payload.state === "zero-evidence-failure") {
    if (payload.evidenceSource !== "none") {
      issues.push("Zero-evidence failure must use evidenceSource=none.");
    }

    if (payload.publication.eligible) {
      issues.push("Zero-evidence failure cannot remain publication eligible.");
    }
  }

  return issues;
}

export function evaluateScenario(params: EvaluateScenarioInput): M062S01ScenarioRecord {
  const normalizedPayload = normalizeReviewFirstPass({
    checkpoint: params.checkpoint,
    boundedness: params.boundedness,
    outcome: params.outcome,
  });
  const payload = params.mutateNormalizedPayload
    ? params.mutateNormalizedPayload(normalizedPayload)
    : normalizedPayload;
  const issues = validateNormalizedPayload({
    reviewOutputKey: params.reviewOutputKey,
    payload,
  });

  const statusCode: M062S01ScenarioStatusCode = issues.length > 0
    ? "invalid-payload"
    : payload?.state === "bounded-first-pass"
      ? "bounded-first-pass"
      : "dead-end-failure";

  return {
    scenarioId: params.scenarioId,
    success: issues.length === 0,
    statusCode,
    reviewOutputKey: params.reviewOutputKey,
    state: payload?.state ?? null,
    boundedReason: payload?.boundedReason ?? null,
    evidenceSource: payload?.evidenceSource ?? null,
    publicationEligible: payload?.publication.eligible ?? null,
    hasPublishedOutput: payload?.publication.hasPublishedOutput ?? null,
    coveredFiles: payload?.coveredScope?.reviewedFiles ?? null,
    remainingFiles: payload?.remainingScope?.remainingFiles ?? null,
    totalFiles: payload?.coveredScope?.totalFiles ?? payload?.remainingScope?.totalFiles ?? null,
    issues,
  };
}

function buildInvalidArgReport(params: { generatedAt?: string; issue: string }): M062S01Report {
  return {
    command: "verify:m062:s01",
    generated_at: params.generatedAt ?? new Date().toISOString(),
    scenario_count: 0,
    success: false,
    status_code: "m062_s01_invalid_arg",
    scenarios: [],
    issues: [params.issue],
  };
}

export function evaluateM062S01(params?: {
  generatedAt?: string;
  scenarioId?: M062S01ScenarioId | null;
}): M062S01Report {
  const generatedAt = params?.generatedAt ?? new Date().toISOString();
  const definitions = getDefaultScenarioMatrix();
  const selectedDefinitions = params?.scenarioId
    ? definitions.filter((definition) => definition.scenarioId === params.scenarioId)
    : definitions;

  const scenarios = selectedDefinitions.map((definition) => evaluateScenario(definition));
  const issues = scenarios.flatMap((scenario) => scenario.issues.map((issue) => `${scenario.scenarioId}: ${issue}`));

  return {
    command: "verify:m062:s01",
    generated_at: generatedAt,
    scenario_count: scenarios.length,
    success: issues.length === 0,
    status_code: issues.length === 0 ? "m062_s01_ok" : "m062_s01_invalid_payload",
    scenarios,
    issues,
  };
}

export function parseVerifyM062S01Args(args: string[]): VerifyM062S01Args {
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
    "Usage: bun run verify:m062:s01 -- [--scenario <id>] [--json]",
    "",
    "Scenario ids:",
    "  timeout-checkpoint",
    "  max-turns-checkpoint",
    "  large-pr-bounded",
    "  zero-evidence-failure",
    "",
    "Options:",
    "  --scenario   Run one deterministic scenario instead of the full matrix",
    "  --json       Print machine-readable JSON output",
    "  --help       Show this help",
  ].join("\n");
}

export function renderM062S01Report(report: M062S01Report): string {
  const lines = [
    "# M062 S01 — Bounded First-Pass Verifier",
    "",
    `Status: ${report.status_code}`,
    `Scenarios: ${report.scenario_count}`,
  ];

  if (report.scenarios.length > 0) {
    lines.push("", "Scenario matrix:");
    for (const scenario of report.scenarios) {
      const coverage = scenario.totalFiles === null
        ? "coverage=unavailable"
        : `coverage=${scenario.coveredFiles ?? 0}/${scenario.totalFiles} remaining=${scenario.remainingFiles ?? 0}`;
      lines.push(
        `- ${scenario.scenarioId}: ${scenario.statusCode}`,
        `  - reason=${scenario.boundedReason ?? "unknown"} evidence=${scenario.evidenceSource ?? "unknown"} publicationEligible=${scenario.publicationEligible === null ? "unknown" : String(scenario.publicationEligible)} hasPublishedOutput=${scenario.hasPublishedOutput === null ? "unknown" : String(scenario.hasPublishedOutput)}`,
        `  - ${coverage}`,
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
  const options = parseVerifyM062S01Args(args);

  if (options.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  if (options.scenarioId && !VALID_SCENARIO_IDS.has(options.scenarioId as M062S01ScenarioId)) {
    const report = buildInvalidArgReport({ issue: `Unknown scenario id: ${options.scenarioId}.` });
    stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderM062S01Report(report));
    return 1;
  }

  const report = evaluateM062S01({ scenarioId: (options.scenarioId as M062S01ScenarioId | null) ?? null });
  stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderM062S01Report(report));
  return report.success ? 0 : 1;
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
