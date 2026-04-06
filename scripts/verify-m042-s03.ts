import { buildReviewPrompt, SEARCH_RATE_LIMIT_DISCLOSURE_SENTENCE } from "../src/execution/review-prompt.ts";
import { formatReviewDetailsSummary } from "../src/lib/review-utils.ts";
import { resolveAuthorTierFromSources } from "../src/handlers/review.ts";
import type { ResolvedReviewProfile } from "../src/lib/auto-profile.ts";
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

const CACHE_HIT_REQUIRED_PROMPT_PHRASES = [
  "core/senior contributor",
  "Be concise and assume familiarity with the codebase",
] as const;

const CACHE_HIT_BANNED_PROMPT_PHRASES = [
  "first-time or new contributor",
  "developing contributor",
  "established contributor",
  "Explain WHY each finding matters",
] as const;

const CACHE_HIT_REQUIRED_DETAILS_PHRASES = [
  "- Author tier: core (senior contributor guidance)",
] as const;

const CACHE_HIT_BANNED_DETAILS_PHRASES = [
  "newcomer guidance",
  "developing guidance",
  "established contributor guidance",
] as const;

const PROFILE_OVERRIDE_REQUIRED_PROMPT_PHRASES = [
  "established contributor",
  "Keep explanations brief",
] as const;

const PROFILE_OVERRIDE_BANNED_PROMPT_PHRASES = [
  "first-time or new contributor",
  "developing contributor",
  "core/senior contributor",
] as const;

const PROFILE_OVERRIDE_REQUIRED_DETAILS_PHRASES = [
  "- Author tier: established (established contributor guidance)",
] as const;

const PROFILE_OVERRIDE_BANNED_DETAILS_PHRASES = [
  "newcomer guidance",
  "developing guidance",
  "senior contributor guidance",
] as const;

const DEGRADED_FALLBACK_REQUIRED_PROMPT_PHRASES = [
  "developing contributor",
  "balanced, collaborative tone",
] as const;

const DEGRADED_FALLBACK_BANNED_PROMPT_PHRASES = [
  "first-time or new contributor",
  "established contributor",
  "core/senior contributor",
] as const;

const DEGRADED_FALLBACK_REQUIRED_DETAILS_PHRASES = [
  "- Author tier: regular (developing guidance)",
] as const;

const DEGRADED_FALLBACK_BANNED_DETAILS_PHRASES = [
  "newcomer guidance",
  "established contributor guidance",
  "senior contributor guidance",
] as const;

function basePromptContext(overrides?: { prAuthor?: string; authorTier?: AuthorTier }) {
  return {
    owner: "xbmc",
    repo: "xbmc",
    prNumber: 4243,
    prTitle: "Harden cache and fallback author-tier truthfulness",
    prBody: "Ensure cache hits and degraded fallbacks keep contributor labeling truthful.",
    prAuthor: overrides?.prAuthor ?? "CrystalP",
    baseBranch: "master",
    headBranch: "crystalp/cache-fallback-hardening",
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
    reviewOutputKey: "m042-s03-proof",
    filesReviewed: 1,
    linesAdded: 8,
    linesRemoved: 2,
    findingCounts: { critical: 0, major: 1, medium: 0, minor: 0 },
    profileSelection,
    authorTier,
  });
}

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

  return {
    scenario: "cache-hit",
    resolvedTier: resolved.tier,
    resolvedSource: resolved.source,
    promptAuthorSection: buildAuthorSectionPrompt(resolved.tier, "CrystalP"),
    reviewDetailsBody: buildReviewDetails(resolved.tier),
  };
}

export function runProfileOverridesContradictoryCacheFixture(): SurfaceFixtureResult {
  const resolved = resolveAuthorTierFromSources({
    contributorTier: "established",
    cachedTier: "first-time",
    fallbackTier: "regular",
  });

  return {
    scenario: "profile-over-cache",
    resolvedTier: resolved.tier,
    resolvedSource: resolved.source,
    promptAuthorSection: buildAuthorSectionPrompt(resolved.tier, "CrystalP"),
    reviewDetailsBody: buildReviewDetails(resolved.tier),
  };
}

export function runDegradedFallbackFixture(): SurfaceFixtureResult {
  const resolved = resolveAuthorTierFromSources({
    contributorTier: null,
    cachedTier: null,
    fallbackTier: "regular",
  });

  return {
    scenario: "degraded-fallback",
    resolvedTier: resolved.tier,
    resolvedSource: resolved.source,
    promptAuthorSection: buildAuthorSectionPrompt(resolved.tier, "CrystalP"),
    reviewDetailsBody: buildReviewDetails(resolved.tier),
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
