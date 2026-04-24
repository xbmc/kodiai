import { formatPartialReviewComment } from "../src/lib/partial-review-formatter.ts";
import { formatReviewDetailsSummary } from "../src/lib/review-utils.ts";
import type { ReviewFirstPassPayload } from "../src/lib/review-first-pass.ts";
import { projectContributorExperienceContract } from "../src/contributor/experience-contract.ts";
import {
  evaluateScenario as evaluateS01Scenario,
  getDefaultScenarioMatrix as getS01DefaultScenarioMatrix,
  type M062S01ScenarioId,
} from "./verify-m062-s01.ts";

export type M062S03StatusCode =
  | "m062_s03_ok"
  | "m062_s03_invalid_arg"
  | "m062_s03_verifier_failed";

export type M062S03ScenarioStatusCode =
  | "bounded-parity-ok"
  | "dead-end-rejected"
  | "invalid-contract"
  | "parity-failed";

export type M062S03ParityCheck = {
  key:
    | "bounded-reason"
    | "covered-scope"
    | "remaining-scope"
    | "continuation-state"
    | "bounded-comment-rejection";
  status: "pass" | "fail" | "expected-negative";
  detail: string;
};

export type M062S03ScenarioRecord = {
  scenarioId: string;
  success: boolean;
  statusCode: M062S03ScenarioStatusCode;
  state: ReviewFirstPassPayload["state"] | null;
  boundedReason: ReviewFirstPassPayload["boundedReason"] | null;
  evidenceSource: ReviewFirstPassPayload["evidenceSource"] | null;
  boundedCommentEligible: boolean;
  boundedCommentRendered: boolean;
  reviewDetailsRendered: boolean;
  commentError: string | null;
  parityChecks: M062S03ParityCheck[];
  issues: string[];
};

export type M062S03Report = {
  command: "verify:m062:s03";
  generated_at: string;
  scenario_count: number;
  success: boolean;
  status_code: M062S03StatusCode;
  scenarios: M062S03ScenarioRecord[];
  issues: string[];
};

type VerifyM062S03Args = {
  help: boolean;
  json: boolean;
  scenarioId: string | null;
};

type ScenarioDefinition = ReturnType<typeof getS01DefaultScenarioMatrix>[number];

type EvaluateScenarioInput = ScenarioDefinition & {
  mutateNormalizedPayload?: (payload: ReviewFirstPassPayload | null) => ReviewFirstPassPayload | null;
};

const VALID_SCENARIO_IDS = new Set<M062S01ScenarioId>([
  "timeout-checkpoint",
  "max-turns-checkpoint",
  "large-pr-bounded",
  "zero-evidence-failure",
]);

const DEFAULT_COMPLETED_AT = "2026-04-24T04:00:00.000Z";
const DEFAULT_SUMMARY_DRAFT = [
  "## Summary",
  "- Deterministic verifier fixture summary.",
  "- This output exists only to exercise production formatter seams.",
].join("\n");

export function getDefaultScenarioMatrix(): ScenarioDefinition[] {
  return getS01DefaultScenarioMatrix();
}

function buildInvalidArgReport(params: { generatedAt?: string; issue: string }): M062S03Report {
  return {
    command: "verify:m062:s03",
    generated_at: params.generatedAt ?? new Date().toISOString(),
    scenario_count: 0,
    success: false,
    status_code: "m062_s03_invalid_arg",
    scenarios: [],
    issues: [params.issue],
  };
}

function validateNormalizedPayload(payload: ReviewFirstPassPayload | null): string[] {
  if (!payload) {
    return ["Normalized payload is missing."];
  }

  const issues: string[] = [];

  if (!payload.publication || typeof payload.publication.eligible !== "boolean" || typeof payload.publication.hasPublishedOutput !== "boolean") {
    issues.push("Missing normalized publication state.");
  }

  if (payload.state === "bounded-first-pass" && !payload.publication?.eligible) {
    issues.push("Bounded scenario lost publication eligibility.");
  }

  if (payload.state === "zero-evidence-failure" && payload.publication?.eligible) {
    issues.push("Zero-evidence scenario cannot remain publication eligible.");
  }

  return issues;
}

function formatReasonLabel(reason: ReviewFirstPassPayload["boundedReason"]): string {
  return reason === "large-pr" ? "large-PR triage" : reason;
}

function makeBaseReviewDetails(firstPass: ReviewFirstPassPayload) {
  const totalFiles = firstPass.coveredScope?.totalFiles ?? firstPass.remainingScope?.totalFiles ?? 0;
  const reviewedFiles = firstPass.coveredScope?.reviewedFiles ?? 0;

  return formatReviewDetailsSummary({
    reviewOutputKey: "m062-s03-review-output-key",
    filesReviewed: reviewedFiles,
    linesAdded: 20,
    linesRemoved: 5,
    findingCounts: {
      critical: 0,
      major: firstPass.findingCount ?? 0,
      medium: 0,
      minor: 0,
    },
    profileSelection: {
      selectedProfile: "minimal",
      source: "auto",
      autoBand: "large",
      linesChanged: 240,
    },
    contributorExperience: projectContributorExperienceContract({
      source: "author-cache",
      tier: "regular",
    }).reviewDetails,
    reviewFirstPass: firstPass,
    completedAt: DEFAULT_COMPLETED_AT,
  });
}

function evaluateBoundedScenario(firstPass: ReviewFirstPassPayload): Omit<M062S03ScenarioRecord, "scenarioId" | "success" | "statusCode" | "issues"> & { issues: string[] } {
  const issues: string[] = [];
  const reviewDetails = makeBaseReviewDetails(firstPass);
  let partialComment = "";
  let commentError: string | null = null;

  try {
    partialComment = formatPartialReviewComment({
      summaryDraft: DEFAULT_SUMMARY_DRAFT,
      firstPass,
    });
  } catch (error) {
    commentError = error instanceof Error ? error.message : String(error);
    issues.push(`Formatter error: ${commentError}`);
  }

  const parityChecks: M062S03ParityCheck[] = [];
  const reasonPhrase = formatReasonLabel(firstPass.boundedReason);
  const reasonPass = partialComment.includes(reasonPhrase) && reviewDetails.includes(reasonPhrase);
  parityChecks.push({
    key: "bounded-reason",
    status: reasonPass ? "pass" : "fail",
    detail: reasonPass
      ? `Both surfaces describe ${reasonPhrase}.`
      : `Bounded reason drifted; expected both surfaces to describe ${reasonPhrase}.`,
  });

  const coveredScope = firstPass.coveredScope;
  const coveredPass = Boolean(
    coveredScope
      && partialComment.includes(`covering ${coveredScope.reviewedFiles} of ${coveredScope.totalFiles} files`)
      && reviewDetails.includes(`- Covered scope: ${coveredScope.reviewedFiles}/${coveredScope.totalFiles} changed files`),
  );
  parityChecks.push({
    key: "covered-scope",
    status: coveredPass ? "pass" : "fail",
    detail: coveredPass
      ? `Both surfaces preserve covered scope ${coveredScope?.reviewedFiles ?? 0}/${coveredScope?.totalFiles ?? 0}.`
      : "Covered scope wording drifted between the bounded comment and Review Details.",
  });

  const remainingScope = firstPass.remainingScope;
  const remainingPass = remainingScope
    ? partialComment.includes(`${remainingScope.remainingFiles} of ${remainingScope.totalFiles} files remain unreviewed`)
      && reviewDetails.includes(`- Remaining scope: ${remainingScope.remainingFiles}/${remainingScope.totalFiles} changed files`)
    : partialComment.includes("remaining scope is not confirmed from structured evidence")
      && reviewDetails.includes("- Remaining scope: not confirmed from structured evidence");
  parityChecks.push({
    key: "remaining-scope",
    status: remainingPass ? "pass" : "fail",
    detail: remainingPass
      ? remainingScope
        ? `Both surfaces preserve remaining scope ${remainingScope.remainingFiles}/${remainingScope.totalFiles}.`
        : "Both surfaces degrade to explicit uncertainty when remaining scope is unavailable."
      : remainingScope
        ? "Remaining scope wording drifted between the bounded comment and Review Details."
        : "Missing remaining scope should degrade to explicit uncertainty, not exhaustive wording.",
  });

  const continuationPass = firstPass.continuationPending
    ? partialComment.includes("follow-up review is pending")
      && reviewDetails.includes("follow-up review pending")
    : partialComment.includes("no follow-up review is pending")
      && reviewDetails.includes("no follow-up review is pending");
  parityChecks.push({
    key: "continuation-state",
    status: continuationPass ? "pass" : "fail",
    detail: continuationPass
      ? `Both surfaces preserve continuation state: ${firstPass.continuationPending ? "pending" : "stopped"}.`
      : "Continuation-state wording drifted between the bounded comment and Review Details.",
  });

  for (const check of parityChecks) {
    if (check.status === "fail") {
      issues.push(`${check.key}: ${check.detail}`);
    }
  }

  return {
    state: firstPass.state,
    boundedReason: firstPass.boundedReason,
    evidenceSource: firstPass.evidenceSource,
    boundedCommentEligible: true,
    boundedCommentRendered: commentError === null,
    reviewDetailsRendered: true,
    commentError,
    parityChecks,
    issues,
  };
}

function evaluateZeroEvidenceScenario(firstPass: ReviewFirstPassPayload): Omit<M062S03ScenarioRecord, "scenarioId" | "success" | "statusCode" | "issues"> & { issues: string[] } {
  const reviewDetails = makeBaseReviewDetails(firstPass);
  let commentError: string | null = null;

  try {
    formatPartialReviewComment({
      summaryDraft: DEFAULT_SUMMARY_DRAFT,
      firstPass,
    });
  } catch (error) {
    commentError = error instanceof Error ? error.message : String(error);
  }

  const rejectionCheck: M062S03ParityCheck = {
    key: "bounded-comment-rejection",
    status: commentError ? "expected-negative" : "fail",
    detail: commentError
      ? "Zero-evidence failure stayed ineligible for bounded public comment."
      : "Zero-evidence failure unexpectedly rendered a bounded public comment.",
  };

  const issues = commentError
    ? []
    : ["Zero-evidence failure unexpectedly rendered a bounded public comment."];

  if (!reviewDetails.includes("zero-evidence hard failure")) {
    issues.push("Review Details stopped surfacing the zero-evidence hard failure classification.");
  }

  return {
    state: firstPass.state,
    boundedReason: firstPass.boundedReason,
    evidenceSource: firstPass.evidenceSource,
    boundedCommentEligible: false,
    boundedCommentRendered: false,
    reviewDetailsRendered: true,
    commentError,
    parityChecks: [rejectionCheck],
    issues,
  };
}

export function evaluateScenario(params: EvaluateScenarioInput): M062S03ScenarioRecord {
  const normalized = evaluateS01Scenario({
    scenarioId: params.scenarioId,
    checkpoint: params.checkpoint,
    boundedness: params.boundedness,
    outcome: params.outcome,
    reviewOutputKey: params.reviewOutputKey,
  });

  const baseFirstPass = normalized.state && normalized.boundedReason && normalized.evidenceSource
    ? ({
        state: normalized.state,
        boundedReason: normalized.boundedReason,
        evidenceSource: normalized.evidenceSource,
        ...(normalized.coveredFiles !== null && normalized.totalFiles !== null
          ? { coveredScope: { reviewedFiles: normalized.coveredFiles, totalFiles: normalized.totalFiles } }
          : {}),
        ...(normalized.remainingFiles !== null && normalized.totalFiles !== null
          ? { remainingScope: { remainingFiles: normalized.remainingFiles, totalFiles: normalized.totalFiles } }
          : {}),
        publication: {
          eligible: normalized.publicationEligible ?? false,
          hasPublishedOutput: normalized.hasPublishedOutput ?? false,
        },
        continuationPending: normalized.state === "bounded-first-pass",
        zeroEvidenceFailure: normalized.state === "zero-evidence-failure",
      } satisfies ReviewFirstPassPayload)
    : null;

  const firstPass = params.mutateNormalizedPayload
    ? params.mutateNormalizedPayload(baseFirstPass)
    : baseFirstPass;

  const normalizedIssues = params.mutateNormalizedPayload ? [] : normalized.issues;
  const contractIssues = [...normalizedIssues, ...validateNormalizedPayload(firstPass)];
  if (contractIssues.length > 0 || !firstPass) {
    return {
      scenarioId: params.scenarioId,
      success: false,
      statusCode: "invalid-contract",
      state: firstPass?.state ?? normalized.state,
      boundedReason: firstPass?.boundedReason ?? normalized.boundedReason,
      evidenceSource: firstPass?.evidenceSource ?? normalized.evidenceSource,
      boundedCommentEligible: Boolean(firstPass?.publication?.eligible),
      boundedCommentRendered: false,
      reviewDetailsRendered: false,
      commentError: null,
      parityChecks: [],
      issues: contractIssues,
    };
  }

  const evaluated = firstPass.state === "zero-evidence-failure"
    ? evaluateZeroEvidenceScenario(firstPass)
    : evaluateBoundedScenario(firstPass);

  const statusCode: M062S03ScenarioStatusCode = firstPass.state === "zero-evidence-failure"
    ? evaluated.issues.length === 0
      ? "dead-end-rejected"
      : "parity-failed"
    : evaluated.issues.length === 0
      ? "bounded-parity-ok"
      : "parity-failed";

  return {
    scenarioId: params.scenarioId,
    success: evaluated.issues.length === 0,
    statusCode,
    ...evaluated,
  };
}

export function evaluateM062S03(params?: {
  generatedAt?: string;
  scenarioId?: M062S01ScenarioId | null;
}): M062S03Report {
  const generatedAt = params?.generatedAt ?? new Date().toISOString();
  const definitions = getDefaultScenarioMatrix();
  const selectedDefinitions = params?.scenarioId
    ? definitions.filter((definition) => definition.scenarioId === params.scenarioId)
    : definitions;

  const scenarios = selectedDefinitions.map((definition) => evaluateScenario(definition));
  const issues = scenarios.flatMap((scenario) => scenario.issues.map((issue) => `${scenario.scenarioId}: ${issue}`));

  return {
    command: "verify:m062:s03",
    generated_at: generatedAt,
    scenario_count: scenarios.length,
    success: issues.length === 0,
    status_code: issues.length === 0 ? "m062_s03_ok" : "m062_s03_verifier_failed",
    scenarios,
    issues,
  };
}

export function parseVerifyM062S03Args(args: string[]): VerifyM062S03Args {
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
    "Usage: bun run verify:m062:s03 -- [--scenario <id>] [--json]",
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

export function renderM062S03Report(report: M062S03Report): string {
  const lines = [
    "# M062 S03 — Large-PR Baseline Proof Harness",
    "",
    `Status: ${report.status_code}`,
    `Scenarios: ${report.scenario_count}`,
  ];

  if (report.scenarios.length > 0) {
    lines.push("", "Scenario matrix:");
    for (const scenario of report.scenarios) {
      lines.push(`- ${scenario.scenarioId}: ${scenario.statusCode}`);
      lines.push(
        `  - boundedCommentEligible=${String(scenario.boundedCommentEligible)} boundedCommentRendered=${String(scenario.boundedCommentRendered)} reviewDetailsRendered=${String(scenario.reviewDetailsRendered)}`,
      );
      if (scenario.commentError) {
        lines.push(`  - commentError=${scenario.commentError}`);
      }
      for (const check of scenario.parityChecks) {
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
  const options = parseVerifyM062S03Args(args);

  if (options.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  if (options.scenarioId && !VALID_SCENARIO_IDS.has(options.scenarioId as M062S01ScenarioId)) {
    const report = buildInvalidArgReport({ issue: `Unknown scenario id: ${options.scenarioId}.` });
    stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderM062S03Report(report));
    return 1;
  }

  const report = evaluateM062S03({ scenarioId: (options.scenarioId as M062S01ScenarioId | null) ?? null });
  stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderM062S03Report(report));
  return report.success ? 0 : 1;
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
