import { SEARCH_RATE_LIMIT_DISCLOSURE_SENTENCE } from "../src/execution/review-prompt.ts";
import { resolveAuthorTierFromSources } from "../src/handlers/review.ts";
import { projectContributorExperienceContract } from "../src/contributor/experience-contract.ts";
import {
  buildGitHubReviewContractFixture,
  getGitHubReviewContractScenario,
} from "./verify-m045-s01.ts";
import type { AuthorTier } from "../src/lib/author-classifier.ts";

export const M042_S03_CHECK_IDS = [
  "M042-S03-CACHE-HIT-SURFACE-TRUTHFUL",
  "M042-S03-PROFILE-OVERRIDES-CONTRADICTORY-CACHE",
  "M042-S03-DEGRADED-FALLBACK-NONCONTRADICTORY",
] as const;

export type M042S03CheckId = (typeof M042_S03_CHECK_IDS)[number];

export type Check = {
  id: M042S03CheckId;
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

type SurfaceFixtureResult = {
  scenario: "cache-hit" | "profile-over-cache" | "degraded-fallback";
  resolvedTier: AuthorTier;
  resolvedSource: "contributor-profile" | "author-cache" | "fallback";
  promptAuthorSection: string;
  reviewDetailsBody: string;
  summaryWithDisclosure?: string;
};

const COARSE_FALLBACK_SCENARIO = getGitHubReviewContractScenario("coarse-fallback");
const PROFILE_BACKED_SCENARIO = getGitHubReviewContractScenario("profile-backed");
const GENERIC_DEGRADED_SCENARIO = getGitHubReviewContractScenario("generic-degraded");

const CACHE_HIT_REQUIRED_PROMPT_PHRASES =
  COARSE_FALLBACK_SCENARIO.expectations.requiredPromptPhrases;
const CACHE_HIT_BANNED_PROMPT_PHRASES =
  COARSE_FALLBACK_SCENARIO.expectations.bannedPromptPhrases;
const CACHE_HIT_REQUIRED_DETAILS_PHRASES =
  COARSE_FALLBACK_SCENARIO.expectations.requiredReviewDetailsPhrases;
const CACHE_HIT_BANNED_DETAILS_PHRASES =
  COARSE_FALLBACK_SCENARIO.expectations.bannedReviewDetailsPhrases;

const PROFILE_OVERRIDE_REQUIRED_PROMPT_PHRASES =
  PROFILE_BACKED_SCENARIO.expectations.requiredPromptPhrases;
const PROFILE_OVERRIDE_BANNED_PROMPT_PHRASES =
  PROFILE_BACKED_SCENARIO.expectations.bannedPromptPhrases;
const PROFILE_OVERRIDE_REQUIRED_DETAILS_PHRASES =
  PROFILE_BACKED_SCENARIO.expectations.requiredReviewDetailsPhrases;
const PROFILE_OVERRIDE_BANNED_DETAILS_PHRASES =
  PROFILE_BACKED_SCENARIO.expectations.bannedReviewDetailsPhrases;

const DEGRADED_FALLBACK_REQUIRED_PROMPT_PHRASES =
  GENERIC_DEGRADED_SCENARIO.expectations.requiredPromptPhrases;
const DEGRADED_FALLBACK_BANNED_PROMPT_PHRASES =
  GENERIC_DEGRADED_SCENARIO.expectations.bannedPromptPhrases;
const DEGRADED_FALLBACK_REQUIRED_DETAILS_PHRASES =
  GENERIC_DEGRADED_SCENARIO.expectations.requiredReviewDetailsPhrases;
const DEGRADED_FALLBACK_BANNED_DETAILS_PHRASES =
  GENERIC_DEGRADED_SCENARIO.expectations.bannedReviewDetailsPhrases;

function buildSummaryWithDisclosure(): string {
  return [
    "## What Changed",
    "",
    SEARCH_RATE_LIMIT_DISCLOSURE_SENTENCE,
    "",
    "<details>",
    "<summary>Review Details</summary>",
    "",
    "- Search enrichment degraded after one retry.",
    "",
    "</details>",
  ].join("\n");
}

export function runCacheHitSurfaceFixture(): SurfaceFixtureResult {
  const resolved = resolveAuthorTierFromSources({
    contributorTier: null,
    cachedTier: "core",
    fallbackTier: "first-time",
  });
  const contract = projectContributorExperienceContract({
    source: "author-cache",
    tier: resolved.tier,
  });
  const fixture = buildGitHubReviewContractFixture({
    scenarioId: "coarse-fallback",
    prAuthor: "CrystalP",
    contract,
  });

  return {
    scenario: "cache-hit",
    resolvedTier: resolved.tier,
    resolvedSource: resolved.source,
    promptAuthorSection: fixture.promptSurfaceText,
    reviewDetailsBody: fixture.reviewDetailsBody,
  };
}

export function runProfileOverridesContradictoryCacheFixture(): SurfaceFixtureResult {
  const resolved = resolveAuthorTierFromSources({
    contributorTier: "established",
    cachedTier: "first-time",
    fallbackTier: "regular",
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
    scenario: "profile-over-cache",
    resolvedTier: resolved.tier,
    resolvedSource: resolved.source,
    promptAuthorSection: fixture.promptSurfaceText,
    reviewDetailsBody: fixture.reviewDetailsBody,
  };
}

export function runDegradedFallbackFixture(): SurfaceFixtureResult {
  const resolved = resolveAuthorTierFromSources({
    contributorTier: null,
    cachedTier: null,
    fallbackTier: "regular",
  });
  const contract = projectContributorExperienceContract({
    source: "github-search",
    tier: resolved.tier,
    degraded: true,
    degradationPath: "search-api-rate-limit",
  });
  const fixture = buildGitHubReviewContractFixture({
    scenarioId: "generic-degraded",
    prAuthor: "CrystalP",
    contract,
    searchRateLimitDegradation: {
      degraded: true,
      retryAttempts: 1,
      skippedQueries: 1,
      degradationPath: "search-api-rate-limit",
    },
  });

  return {
    scenario: "degraded-fallback",
    resolvedTier: resolved.tier,
    resolvedSource: resolved.source,
    promptAuthorSection: fixture.promptSurfaceText,
    reviewDetailsBody: fixture.reviewDetailsBody,
    summaryWithDisclosure: buildSummaryWithDisclosure(),
  };
}

function findMissing(text: string, phrases: readonly string[]): string[] {
  return phrases.filter((phrase) => !text.includes(phrase));
}

function findUnexpected(text: string, phrases: readonly string[]): string[] {
  return phrases.filter((phrase) => text.includes(phrase));
}

export async function runCacheHitSurfaceTruthfulCheck(
  _runFn?: () => SurfaceFixtureResult,
): Promise<Check> {
  const result = _runFn ? _runFn() : runCacheHitSurfaceFixture();
  const missingPrompt = findMissing(result.promptAuthorSection, CACHE_HIT_REQUIRED_PROMPT_PHRASES);
  const unexpectedPrompt = findUnexpected(result.promptAuthorSection, CACHE_HIT_BANNED_PROMPT_PHRASES);
  const missingDetails = findMissing(result.reviewDetailsBody, CACHE_HIT_REQUIRED_DETAILS_PHRASES);
  const unexpectedDetails = findUnexpected(result.reviewDetailsBody, CACHE_HIT_BANNED_DETAILS_PHRASES);
  const problems: string[] = [];

  if (result.resolvedSource !== "author-cache") {
    problems.push(`resolvedSource=${result.resolvedSource} expected author-cache`);
  }
  if (result.resolvedTier !== "core") {
    problems.push(`resolvedTier=${result.resolvedTier} expected core`);
  }
  if (!result.promptAuthorSection) {
    problems.push("author experience section was not rendered");
  }
  if (missingPrompt.length > 0) {
    problems.push(`missing required prompt phrases: ${missingPrompt.join(", ")}`);
  }
  if (unexpectedPrompt.length > 0) {
    problems.push(`unexpected prompt phrases present: ${unexpectedPrompt.join(", ")}`);
  }
  if (missingDetails.length > 0) {
    problems.push(`missing required review-details phrases: ${missingDetails.join(", ")}`);
  }
  if (unexpectedDetails.length > 0) {
    problems.push(`unexpected review-details phrases present: ${unexpectedDetails.join(", ")}`);
  }

  if (problems.length === 0) {
    return {
      id: "M042-S03-CACHE-HIT-SURFACE-TRUTHFUL",
      passed: true,
      skipped: false,
      status_code: "cache_hit_surface_mapping_truthful",
      detail: `resolvedSource=${result.resolvedSource} resolvedTier=${result.resolvedTier}`,
    };
  }

  return {
    id: "M042-S03-CACHE-HIT-SURFACE-TRUTHFUL",
    passed: false,
    skipped: false,
    status_code: "cache_hit_surface_truthfulness_failed",
    detail: problems.join("; "),
  };
}

export async function runProfileOverridesContradictoryCacheCheck(
  _runFn?: () => SurfaceFixtureResult,
): Promise<Check> {
  const result = _runFn ? _runFn() : runProfileOverridesContradictoryCacheFixture();
  const missingPrompt = findMissing(result.promptAuthorSection, PROFILE_OVERRIDE_REQUIRED_PROMPT_PHRASES);
  const unexpectedPrompt = findUnexpected(result.promptAuthorSection, PROFILE_OVERRIDE_BANNED_PROMPT_PHRASES);
  const missingDetails = findMissing(result.reviewDetailsBody, PROFILE_OVERRIDE_REQUIRED_DETAILS_PHRASES);
  const unexpectedDetails = findUnexpected(result.reviewDetailsBody, PROFILE_OVERRIDE_BANNED_DETAILS_PHRASES);
  const problems: string[] = [];

  if (result.resolvedSource !== "contributor-profile") {
    problems.push(`resolvedSource=${result.resolvedSource} expected contributor-profile`);
  }
  if (result.resolvedTier !== "established") {
    problems.push(`resolvedTier=${result.resolvedTier} expected established`);
  }
  if (missingPrompt.length > 0) {
    problems.push(`missing required prompt phrases: ${missingPrompt.join(", ")}`);
  }
  if (unexpectedPrompt.length > 0) {
    problems.push(`unexpected prompt phrases present: ${unexpectedPrompt.join(", ")}`);
  }
  if (missingDetails.length > 0) {
    problems.push(`missing required review-details phrases: ${missingDetails.join(", ")}`);
  }
  if (unexpectedDetails.length > 0) {
    problems.push(`unexpected review-details phrases present: ${unexpectedDetails.join(", ")}`);
  }

  if (problems.length === 0) {
    return {
      id: "M042-S03-PROFILE-OVERRIDES-CONTRADICTORY-CACHE",
      passed: true,
      skipped: false,
      status_code: "profile_precedence_over_cache_truthful",
      detail: `resolvedSource=${result.resolvedSource} resolvedTier=${result.resolvedTier}`,
    };
  }

  return {
    id: "M042-S03-PROFILE-OVERRIDES-CONTRADICTORY-CACHE",
    passed: false,
    skipped: false,
    status_code: "profile_override_cache_truthfulness_failed",
    detail: problems.join("; "),
  };
}

export async function runDegradedFallbackNoncontradictoryCheck(
  _runFn?: () => SurfaceFixtureResult,
): Promise<Check> {
  const result = _runFn ? _runFn() : runDegradedFallbackFixture();
  const missingPrompt = findMissing(result.promptAuthorSection, DEGRADED_FALLBACK_REQUIRED_PROMPT_PHRASES);
  const unexpectedPrompt = findUnexpected(result.promptAuthorSection, DEGRADED_FALLBACK_BANNED_PROMPT_PHRASES);
  const missingDetails = findMissing(result.reviewDetailsBody, DEGRADED_FALLBACK_REQUIRED_DETAILS_PHRASES);
  const unexpectedDetails = findUnexpected(result.reviewDetailsBody, DEGRADED_FALLBACK_BANNED_DETAILS_PHRASES);
  const problems: string[] = [];

  if (result.resolvedSource !== "fallback") {
    problems.push(`resolvedSource=${result.resolvedSource} expected fallback`);
  }
  if (result.resolvedTier !== "regular") {
    problems.push(`resolvedTier=${result.resolvedTier} expected regular`);
  }
  if (!result.summaryWithDisclosure?.includes(SEARCH_RATE_LIMIT_DISCLOSURE_SENTENCE)) {
    problems.push("degraded summary disclosure sentence missing");
  }
  if (missingPrompt.length > 0) {
    problems.push(`missing required prompt phrases: ${missingPrompt.join(", ")}`);
  }
  if (unexpectedPrompt.length > 0) {
    problems.push(`unexpected prompt phrases present: ${unexpectedPrompt.join(", ")}`);
  }
  if (missingDetails.length > 0) {
    problems.push(`missing required review-details phrases: ${missingDetails.join(", ")}`);
  }
  if (unexpectedDetails.length > 0) {
    problems.push(`unexpected review-details phrases present: ${unexpectedDetails.join(", ")}`);
  }

  if (problems.length === 0) {
    return {
      id: "M042-S03-DEGRADED-FALLBACK-NONCONTRADICTORY",
      passed: true,
      skipped: false,
      status_code: "degraded_fallback_surface_remains_truthful",
      detail: `resolvedSource=${result.resolvedSource} resolvedTier=${result.resolvedTier} disclosurePresent=true`,
    };
  }

  return {
    id: "M042-S03-DEGRADED-FALLBACK-NONCONTRADICTORY",
    passed: false,
    skipped: false,
    status_code: "degraded_fallback_truthfulness_failed",
    detail: problems.join("; "),
  };
}

export async function evaluateM042S03(opts?: {
  _cacheHitRunFn?: () => SurfaceFixtureResult;
  _profileOverrideRunFn?: () => SurfaceFixtureResult;
  _degradedFallbackRunFn?: () => SurfaceFixtureResult;
}): Promise<EvaluationReport> {
  const checks = await Promise.all([
    runCacheHitSurfaceTruthfulCheck(opts?._cacheHitRunFn),
    runProfileOverridesContradictoryCacheCheck(opts?._profileOverrideRunFn),
    runDegradedFallbackNoncontradictoryCheck(opts?._degradedFallbackRunFn),
  ]);

  return {
    check_ids: M042_S03_CHECK_IDS,
    overallPassed: checks.filter((check) => !check.skipped).every((check) => check.passed),
    checks,
  };
}

function renderReport(report: EvaluationReport): string {
  const lines = [
    "M042 S03 proof harness: cache and fallback author-tier truthfulness",
    `Final verdict: ${report.overallPassed ? "PASS" : "FAIL"}`,
    "Checks:",
  ];

  for (const check of report.checks) {
    const verdict = check.skipped ? "SKIP" : check.passed ? "PASS" : "FAIL";
    lines.push(`- ${check.id} ${verdict} status_code=${check.status_code}${check.detail ? ` ${check.detail}` : ""}`);
  }

  return `${lines.join("\n")}\n`;
}

export async function buildM042S03ProofHarness(opts?: {
  _cacheHitRunFn?: () => SurfaceFixtureResult;
  _profileOverrideRunFn?: () => SurfaceFixtureResult;
  _degradedFallbackRunFn?: () => SurfaceFixtureResult;
  stdout?: { write: (chunk: string) => boolean | void };
  stderr?: { write: (chunk: string) => boolean | void };
  json?: boolean;
}): Promise<{ exitCode: number }> {
  const stdout = opts?.stdout ?? process.stdout;
  const stderr = opts?.stderr ?? process.stderr;
  const report = await evaluateM042S03({
    _cacheHitRunFn: opts?._cacheHitRunFn,
    _profileOverrideRunFn: opts?._profileOverrideRunFn,
    _degradedFallbackRunFn: opts?._degradedFallbackRunFn,
  });

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
    stderr.write(`verify:m042:s03 failed: ${failingCodes}\n`);
  }

  return { exitCode: report.overallPassed ? 0 : 1 };
}

if (import.meta.main) {
  const useJson = process.argv.includes("--json");
  const { exitCode } = await buildM042S03ProofHarness({ json: useJson });
  process.exit(exitCode);
}
