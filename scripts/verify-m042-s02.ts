import { resolveAuthorTierFromSources } from "../src/handlers/review.ts";
import { projectContributorExperienceContract } from "../src/contributor/experience-contract.ts";
import {
  buildGitHubReviewContractFixture,
  getGitHubReviewContractScenario,
} from "./verify-m045-s01.ts";
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

const PROFILE_BACKED_SCENARIO = getGitHubReviewContractScenario("profile-backed");
const ESTABLISHED_REQUIRED_PROMPT_PHRASES =
  PROFILE_BACKED_SCENARIO.expectations.requiredPromptPhrases;
const ESTABLISHED_BANNED_PROMPT_PHRASES =
  PROFILE_BACKED_SCENARIO.expectations.bannedPromptPhrases;
const ESTABLISHED_REQUIRED_DETAILS_PHRASES =
  PROFILE_BACKED_SCENARIO.expectations.requiredReviewDetailsPhrases;
const ESTABLISHED_BANNED_DETAILS_PHRASES =
  PROFILE_BACKED_SCENARIO.expectations.bannedReviewDetailsPhrases;

export function runEstablishedSurfaceFixture(): ReviewSurfaceFixtureResult {
  const resolved = resolveAuthorTierFromSources({
    contributorTier: "established",
    cachedTier: "first-time",
    fallbackTier: "first-time",
  });
  const contract = projectContributorExperienceContract({
    source: "contributor-profile",
    tier: resolved.tier,
  });
  const fixture = buildGitHubReviewContractFixture({
    scenarioId: "profile-backed",
    prAuthor: "CrystalP",
    contract,
  });

  return {
    resolvedTier: resolved.tier,
    resolvedSource: resolved.source,
    promptAuthorSection: fixture.promptAuthorSection,
    reviewDetailsBody: fixture.reviewDetailsBody,
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
      detail: `contractLinePresent=true bannedAbsent=${ESTABLISHED_BANNED_DETAILS_PHRASES.length}`,
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
  if (!result.promptAuthorSection.includes("Contributor-experience contract: profile-backed.")) {
    problems.push("prompt author section did not preserve the profile-backed contract line");
  }
  if (!result.promptAuthorSection.includes("established contributor")) {
    problems.push("prompt author section did not preserve established contributor wording");
  }
  if (
    !result.reviewDetailsBody.includes(
      "- Contributor experience: profile-backed (using linked contributor profile guidance)",
    )
  ) {
    problems.push("review details did not preserve the profile-backed contract line");
  }
  if (
    result.promptAuthorSection.includes("Contributor-experience contract: coarse-fallback.")
    || result.reviewDetailsBody.includes("coarse-fallback")
  ) {
    problems.push("CrystalP repro regressed to coarse fallback guidance");
  }
  if (
    result.promptAuthorSection.includes("Contributor-experience contract: generic-")
    || result.reviewDetailsBody.includes("generic-")
  ) {
    problems.push("CrystalP repro regressed to generic guidance");
  }
  if (result.promptAuthorSection.includes("first-time or new contributor")) {
    problems.push("CrystalP repro regressed to newcomer guidance");
  }

  if (problems.length === 0) {
    return {
      id: "M042-S02-CRYSTALP-SURFACES-STAY-ESTABLISHED",
      passed: true,
      skipped: false,
      status_code: "crystalp_review_surfaces_remain_established",
      detail:
        "prompt stayed profile-backed/established and review-details stayed profile-backed without coarse or generic regressions",
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
