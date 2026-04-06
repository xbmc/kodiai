import { buildReviewPrompt } from "../src/execution/review-prompt.ts";
import { formatReviewDetailsSummary } from "../src/lib/review-utils.ts";
import { resolveAuthorTierFromSources } from "../src/handlers/review.ts";
import type { ResolvedReviewProfile } from "../src/lib/auto-profile.ts";
import type { AuthorTier } from "../src/lib/author-classifier.ts";

export const M042_S02_CHECK_IDS = [
  "M042-S02-PROFILE-TIER-DRIVES-SURFACE",
  "M042-S02-PROMPT-ESTABLISHED-TRUTHFUL",
  "M042-S02-DETAILS-ESTABLISHED-TRUTHFUL",
  "M042-S02-CRYSTALP-SURFACES-STAY-ESTABLISHED",
] as const;

export type M042S02CheckId = (typeof M042_S02_CHECK_IDS)[number];

export type Check = {
  id: M042S02CheckId;
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail?: string;
};

export type EvaluationReport = {
  check_ids: readonly string[];
  overallPassed: boolean;
  checks: Check[];
};

type ReviewSurfaceFixtureResult = {
  resolvedTier: AuthorTier;
  resolvedSource: "contributor-profile" | "author-cache" | "fallback";
  promptAuthorSection: string;
  reviewDetailsBody: string;
};

const ESTABLISHED_REQUIRED_PROMPT_PHRASES = [
  "established contributor",
  "Keep explanations brief",
] as const;

const ESTABLISHED_BANNED_PROMPT_PHRASES = [
  "first-time or new contributor",
  "developing contributor",
  "Explain WHY each finding matters",
  "learning opportunities",
  "encouraging, welcoming",
  "Include doc links for project-specific patterns",
] as const;

const ESTABLISHED_REQUIRED_DETAILS_PHRASES = [
  "- Author tier: established (established contributor guidance)",
] as const;

const ESTABLISHED_BANNED_DETAILS_PHRASES = [
  "newcomer guidance",
  "developing guidance",
  "senior contributor guidance",
] as const;

function basePromptContext(overrides?: { prAuthor?: string; authorTier?: AuthorTier }) {
  return {
    owner: "xbmc",
    repo: "xbmc",
    prNumber: 4242,
    prTitle: "Fix CrystalP review surface regression",
    prBody: "Ensure established contributors do not receive newcomer guidance.",
    prAuthor: overrides?.prAuthor ?? "CrystalP",
    baseBranch: "master",
    headBranch: "crystalp/fix-review-surface",
    changedFiles: ["xbmc/utils/StringUtils.cpp"],
    mode: "standard" as const,
    severityMinLevel: "medium" as const,
    maxComments: 7,
    focusAreas: [],
    ignoredAreas: ["style"],
    suppressions: [],
    minConfidence: 0,
    authorTier: overrides?.authorTier,
  };
}

function buildAuthorSectionPrompt(authorTier: AuthorTier, prAuthor = "CrystalP"): string {
  const prompt = buildReviewPrompt(basePromptContext({ prAuthor, authorTier }));
  const authorSectionMatch = prompt.match(/## Author Experience Context[\s\S]*?(?=\n## |$)/);
  return authorSectionMatch?.[0] ?? "";
}

function buildReviewDetails(authorTier: AuthorTier): string {
  const profileSelection: ResolvedReviewProfile = {
    selectedProfile: "balanced",
    source: "auto",
    linesChanged: 60,
    autoBand: null,
  };

  return formatReviewDetailsSummary({
    reviewOutputKey: "m042-s02-proof",
    filesReviewed: 1,
    linesAdded: 8,
    linesRemoved: 2,
    findingCounts: { critical: 0, major: 1, medium: 0, minor: 0 },
    profileSelection,
    authorTier,
  });
}

export function runEstablishedSurfaceFixture(): ReviewSurfaceFixtureResult {
  const resolved = resolveAuthorTierFromSources({
    contributorTier: "established",
    cachedTier: "first-time",
    fallbackTier: "first-time",
  });

  const promptAuthorSection = buildAuthorSectionPrompt(resolved.tier, "CrystalP");
  const reviewDetailsBody = buildReviewDetails(resolved.tier);

  return {
    resolvedTier: resolved.tier,
    resolvedSource: resolved.source,
    promptAuthorSection,
    reviewDetailsBody,
  };
}

function findMissing(text: string, phrases: readonly string[]): string[] {
  return phrases.filter((phrase) => !text.includes(phrase));
}

function findUnexpected(text: string, phrases: readonly string[]): string[] {
  return phrases.filter((phrase) => text.includes(phrase));
}

export async function runProfileTierDrivesSurfaceCheck(
  _runFn?: () => ReviewSurfaceFixtureResult,
): Promise<Check> {
  const result = _runFn ? _runFn() : runEstablishedSurfaceFixture();
  const problems: string[] = [];

  if (result.resolvedSource !== "contributor-profile") {
    problems.push(`resolvedSource=${result.resolvedSource} expected contributor-profile`);
  }
  if (result.resolvedTier !== "established") {
    problems.push(`resolvedTier=${result.resolvedTier} expected established`);
  }

  if (problems.length === 0) {
    return {
      id: "M042-S02-PROFILE-TIER-DRIVES-SURFACE",
      passed: true,
      skipped: false,
      status_code: "contributor_profile_tier_selected_for_surface_rendering",
      detail: `resolvedSource=${result.resolvedSource} resolvedTier=${result.resolvedTier}`,
    };
  }

  return {
    id: "M042-S02-PROFILE-TIER-DRIVES-SURFACE",
    passed: false,
    skipped: false,
    status_code: "profile_tier_surface_selection_failed",
    detail: problems.join("; "),
  };
}

export async function runPromptEstablishedTruthfulCheck(
  _runFn?: () => ReviewSurfaceFixtureResult,
): Promise<Check> {
  const result = _runFn ? _runFn() : runEstablishedSurfaceFixture();
  const missing = findMissing(result.promptAuthorSection, ESTABLISHED_REQUIRED_PROMPT_PHRASES);
  const unexpected = findUnexpected(result.promptAuthorSection, ESTABLISHED_BANNED_PROMPT_PHRASES);
  const problems: string[] = [];

  if (!result.promptAuthorSection) {
    problems.push("author experience section was not rendered");
  }
  if (missing.length > 0) {
    problems.push(`missing required prompt phrases: ${missing.join(", ")}`);
  }
  if (unexpected.length > 0) {
    problems.push(`unexpected prompt phrases present: ${unexpected.join(", ")}`);
  }

  if (problems.length === 0) {
    return {
      id: "M042-S02-PROMPT-ESTABLISHED-TRUTHFUL",
      passed: true,
      skipped: false,
      status_code: "prompt_established_guidance_truthful",
      detail: `required=${ESTABLISHED_REQUIRED_PROMPT_PHRASES.length} banned=${ESTABLISHED_BANNED_PROMPT_PHRASES.length}`,
    };
  }

  return {
    id: "M042-S02-PROMPT-ESTABLISHED-TRUTHFUL",
    passed: false,
    skipped: false,
    status_code: "prompt_established_truthfulness_failed",
    detail: problems.join("; "),
  };
}

export async function runDetailsEstablishedTruthfulCheck(
  _runFn?: () => ReviewSurfaceFixtureResult,
): Promise<Check> {
  const result = _runFn ? _runFn() : runEstablishedSurfaceFixture();
  const missing = findMissing(result.reviewDetailsBody, ESTABLISHED_REQUIRED_DETAILS_PHRASES);
  const unexpected = findUnexpected(result.reviewDetailsBody, ESTABLISHED_BANNED_DETAILS_PHRASES);
  const problems: string[] = [];

  if (missing.length > 0) {
    problems.push(`missing required review-details phrases: ${missing.join(", ")}`);
  }
  if (unexpected.length > 0) {
    problems.push(`unexpected review-details phrases present: ${unexpected.join(", ")}`);
  }

  if (problems.length === 0) {
    return {
      id: "M042-S02-DETAILS-ESTABLISHED-TRUTHFUL",
      passed: true,
      skipped: false,
      status_code: "review_details_established_guidance_truthful",
      detail: `authorTierLinePresent=true bannedAbsent=${ESTABLISHED_BANNED_DETAILS_PHRASES.length}`,
    };
  }

  return {
    id: "M042-S02-DETAILS-ESTABLISHED-TRUTHFUL",
    passed: false,
    skipped: false,
    status_code: "review_details_established_truthfulness_failed",
    detail: problems.join("; "),
  };
}

export async function runCrystalPSurfacesStayEstablishedCheck(
  _runFn?: () => ReviewSurfaceFixtureResult,
): Promise<Check> {
  const result = _runFn ? _runFn() : runEstablishedSurfaceFixture();
  const problems: string[] = [];

  if (!result.promptAuthorSection.includes("CrystalP")) {
    problems.push("prompt author section did not include CrystalP");
  }
  if (!result.promptAuthorSection.includes("established contributor")) {
    problems.push("prompt author section did not preserve established contributor wording");
  }
  if (!result.reviewDetailsBody.includes("- Author tier: established (established contributor guidance)")) {
    problems.push("review details did not preserve established contributor guidance line");
  }
  if (result.promptAuthorSection.includes("first-time or new contributor") || result.reviewDetailsBody.includes("newcomer guidance")) {
    problems.push("CrystalP repro regressed to newcomer guidance");
  }
  if (result.promptAuthorSection.includes("developing contributor") || result.reviewDetailsBody.includes("developing guidance")) {
    problems.push("CrystalP repro regressed to developing guidance");
  }

  if (problems.length === 0) {
    return {
      id: "M042-S02-CRYSTALP-SURFACES-STAY-ESTABLISHED",
      passed: true,
      skipped: false,
      status_code: "crystalp_review_surfaces_remain_established",
      detail: "prompt+review-details stayed established and excluded newcomer/developing guidance",
    };
  }

  return {
    id: "M042-S02-CRYSTALP-SURFACES-STAY-ESTABLISHED",
    passed: false,
    skipped: false,
    status_code: "crystalp_established_surface_regression_detected",
    detail: problems.join("; "),
  };
}

export async function evaluateM042S02(opts?: {
  _runFn?: () => ReviewSurfaceFixtureResult;
}): Promise<EvaluationReport> {
  const checks = await Promise.all([
    runProfileTierDrivesSurfaceCheck(opts?._runFn),
    runPromptEstablishedTruthfulCheck(opts?._runFn),
    runDetailsEstablishedTruthfulCheck(opts?._runFn),
    runCrystalPSurfacesStayEstablishedCheck(opts?._runFn),
  ]);

  return {
    check_ids: M042_S02_CHECK_IDS,
    overallPassed: checks.filter((check) => !check.skipped).every((check) => check.passed),
    checks,
  };
}

function renderReport(report: EvaluationReport): string {
  const lines = [
    "M042 S02 proof harness: review-surface truthfulness wiring",
    `Final verdict: ${report.overallPassed ? "PASS" : "FAIL"}`,
    "Checks:",
  ];

  for (const check of report.checks) {
    const verdict = check.skipped ? "SKIP" : check.passed ? "PASS" : "FAIL";
    lines.push(`- ${check.id} ${verdict} status_code=${check.status_code}${check.detail ? ` ${check.detail}` : ""}`);
  }

  return `${lines.join("\n")}\n`;
}

export async function buildM042S02ProofHarness(opts?: {
  _runFn?: () => ReviewSurfaceFixtureResult;
  stdout?: { write: (chunk: string) => void };
  stderr?: { write: (chunk: string) => void };
  json?: boolean;
}): Promise<{ exitCode: number }> {
  const stdout = opts?.stdout ?? process.stdout;
  const stderr = opts?.stderr ?? process.stderr;
  const report = await evaluateM042S02({ _runFn: opts?._runFn });

  if (opts?.json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    stdout.write(renderReport(report));
  }

  if (!report.overallPassed) {
    const failingCodes = report.checks
      .filter((check) => !check.passed && !check.skipped)
      .map((check) => `${check.id}:${check.status_code}`)
      .join(", ");
    stderr.write(`verify:m042:s02 failed: ${failingCodes}\n`);
  }

  return { exitCode: report.overallPassed ? 0 : 1 };
}

if (import.meta.main) {
  const useJson = process.argv.includes("--json");
  const { exitCode } = await buildM042S02ProofHarness({ json: useJson });
  process.exit(exitCode);
}
