import { describe, expect, test } from "bun:test";
import {
  M042_S03_CHECK_IDS,
  buildM042S03ProofHarness,
  evaluateM042S03,
  runCacheHitSurfaceFixture,
  runProfileOverridesContradictoryCacheFixture,
  runDegradedFallbackFixture,
  runCacheHitSurfaceTruthfulCheck,
  runProfileOverridesContradictoryCacheCheck,
  runDegradedFallbackNoncontradictoryCheck,
} from "./verify-m042-s03.ts";

type CacheHitFixture = ReturnType<typeof runCacheHitSurfaceFixture>;
type ProfileOverrideFixture = ReturnType<typeof runProfileOverridesContradictoryCacheFixture>;
type DegradedFallbackFixture = ReturnType<typeof runDegradedFallbackFixture>;
type FixtureResult = CacheHitFixture | ProfileOverrideFixture | DegradedFallbackFixture;

function makeFixture(overrides?: Partial<FixtureResult> & { scenario?: FixtureResult["scenario"] }): FixtureResult {
  return {
    scenario: overrides?.scenario ?? "cache-hit",
    resolvedTier: overrides?.resolvedTier ?? "core",
    resolvedSource: overrides?.resolvedSource ?? "author-cache",
    promptAuthorSection: overrides?.promptAuthorSection ?? [
      "## Author Experience Context",
      "",
      "The PR author (CrystalP) is a core/senior contributor of this repository.",
      "",
      "- Be concise and assume familiarity with the codebase",
    ].join("\n"),
    reviewDetailsBody: overrides?.reviewDetailsBody ?? [
      "<details>",
      "<summary>Review Details</summary>",
      "",
      "- Author tier: core (senior contributor guidance)",
      "</details>",
    ].join("\n"),
    summaryWithDisclosure: overrides?.summaryWithDisclosure,
  };
}

describe("runCacheHitSurfaceFixture", () => {
  test("uses author-cache precedence and renders senior-style surfaces for cached core tier", () => {
    const fixture = runCacheHitSurfaceFixture();

    expect(fixture.scenario).toBe("cache-hit");
    expect(fixture.resolvedSource).toBe("author-cache");
    expect(fixture.resolvedTier).toBe("core");
    expect(fixture.promptAuthorSection).toContain("core/senior contributor");
    expect(fixture.promptAuthorSection).not.toContain("first-time or new contributor");
    expect(fixture.promptAuthorSection).not.toContain("developing contributor");
    expect(fixture.reviewDetailsBody).toContain("- Author tier: core (senior contributor guidance)");
    expect(fixture.reviewDetailsBody).not.toContain("newcomer guidance");
    expect(fixture.reviewDetailsBody).not.toContain("developing guidance");
  });
});

describe("runProfileOverridesContradictoryCacheFixture", () => {
  test("prefers contributor profile over contradictory cached low-tier data", () => {
    const fixture = runProfileOverridesContradictoryCacheFixture();

    expect(fixture.scenario).toBe("profile-over-cache");
    expect(fixture.resolvedSource).toBe("contributor-profile");
    expect(fixture.resolvedTier).toBe("established");
    expect(fixture.promptAuthorSection).toContain("established contributor");
    expect(fixture.promptAuthorSection).not.toContain("first-time or new contributor");
    expect(fixture.reviewDetailsBody).toContain("- Author tier: established (established contributor guidance)");
    expect(fixture.reviewDetailsBody).not.toContain("newcomer guidance");
  });
});

describe("runDegradedFallbackFixture", () => {
  test("keeps fallback-tier wording truthful and includes degradation disclosure", () => {
    const fixture = runDegradedFallbackFixture();

    expect(fixture.scenario).toBe("degraded-fallback");
    expect(fixture.resolvedSource).toBe("fallback");
    expect(fixture.resolvedTier).toBe("regular");
    expect(fixture.promptAuthorSection).toContain("developing contributor");
    expect(fixture.promptAuthorSection).not.toContain("established contributor");
    expect(fixture.reviewDetailsBody).toContain("- Author tier: regular (developing guidance)");
    expect(fixture.summaryWithDisclosure).toContain("Analysis is partial due to API limits.");
  });
});

describe("M042-S03-CACHE-HIT-SURFACE-TRUTHFUL", () => {
  test("passes with the real deterministic fixture", async () => {
    const result = await runCacheHitSurfaceTruthfulCheck();

    expect(result.id).toBe("M042-S03-CACHE-HIT-SURFACE-TRUTHFUL");
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.status_code).toBe("cache_hit_surface_mapping_truthful");
  });

  test("fails when cached tier output regresses to developing guidance", async () => {
    const result = await runCacheHitSurfaceTruthfulCheck(() =>
      makeFixture({
        scenario: "cache-hit",
        resolvedSource: "author-cache",
        resolvedTier: "core",
        promptAuthorSection: [
          "## Author Experience Context",
          "",
          "The PR author (CrystalP) is a developing contributor with growing familiarity in this area.",
        ].join("\n"),
        reviewDetailsBody: "- Author tier: regular (developing guidance)",
      }),
    );

    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("cache_hit_surface_truthfulness_failed");
    expect(result.detail).toContain("missing required prompt phrases");
    expect(result.detail).toContain("unexpected review-details phrases present");
  });
});

describe("M042-S03-PROFILE-OVERRIDES-CONTRADICTORY-CACHE", () => {
  test("passes with the real deterministic fixture", async () => {
    const result = await runProfileOverridesContradictoryCacheCheck();

    expect(result.id).toBe("M042-S03-PROFILE-OVERRIDES-CONTRADICTORY-CACHE");
    expect(result.passed).toBe(true);
    expect(result.status_code).toBe("profile_precedence_over_cache_truthful");
  });

  test("fails when contradictory cache wins over contributor profile", async () => {
    const result = await runProfileOverridesContradictoryCacheCheck(() =>
      makeFixture({
        scenario: "profile-over-cache",
        resolvedSource: "author-cache",
        resolvedTier: "first-time",
        promptAuthorSection: [
          "## Author Experience Context",
          "",
          "The PR author (CrystalP) appears to be a first-time or new contributor to this repository.",
        ].join("\n"),
        reviewDetailsBody: "- Author tier: first-time (newcomer guidance)",
      }),
    );

    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("profile_override_cache_truthfulness_failed");
    expect(result.detail).toContain("resolvedSource=author-cache");
    expect(result.detail).toContain("resolvedTier=first-time");
  });
});

describe("M042-S03-DEGRADED-FALLBACK-NONCONTRADICTORY", () => {
  test("passes with the real deterministic fixture", async () => {
    const result = await runDegradedFallbackNoncontradictoryCheck();

    expect(result.id).toBe("M042-S03-DEGRADED-FALLBACK-NONCONTRADICTORY");
    expect(result.passed).toBe(true);
    expect(result.status_code).toBe("degraded_fallback_surface_remains_truthful");
  });

  test("fails when degraded fallback contradicts itself or drops disclosure", async () => {
    const result = await runDegradedFallbackNoncontradictoryCheck(() =>
      makeFixture({
        scenario: "degraded-fallback",
        resolvedSource: "fallback",
        resolvedTier: "regular",
        promptAuthorSection: [
          "## Author Experience Context",
          "",
          "The PR author (CrystalP) is an established contributor.",
        ].join("\n"),
        reviewDetailsBody: "- Author tier: established (established contributor guidance)",
        summaryWithDisclosure: "## What Changed\n\nSearch enrichment degraded.",
      }),
    );

    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("degraded_fallback_truthfulness_failed");
    expect(result.detail).toContain("degraded summary disclosure sentence missing");
    expect(result.detail).toContain("unexpected prompt phrases present");
  });
});

describe("evaluateM042S03", () => {
  test("returns the exported check ids and passes with the real deterministic fixtures", async () => {
    const report = await evaluateM042S03();

    expect(report.check_ids).toEqual(M042_S03_CHECK_IDS);
    expect(report.checks).toHaveLength(3);
    expect(report.overallPassed).toBe(true);
    expect(report.checks.every((check) => check.passed)).toBe(true);
  });

  test("overallPassed is false when any check fails", async () => {
    const report = await evaluateM042S03({
      _degradedFallbackRunFn: () =>
        makeFixture({
          scenario: "degraded-fallback",
          resolvedSource: "fallback",
          resolvedTier: "regular",
          promptAuthorSection: "## Author Experience Context\n\nThe PR author (CrystalP) is an established contributor.",
          reviewDetailsBody: "- Author tier: established (established contributor guidance)",
          summaryWithDisclosure: "## What Changed\n\nMissing sentence.",
        }),
    });

    expect(report.overallPassed).toBe(false);
    expect(report.checks.some((check) => !check.passed)).toBe(true);
  });
});

describe("buildM042S03ProofHarness", () => {
  test("returns exitCode=0 and text output when checks pass", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const { exitCode } = await buildM042S03ProofHarness({
      stdout: { write: (chunk) => (stdout.push(chunk), true) },
      stderr: { write: (chunk) => (stderr.push(chunk), true) },
    });

    expect(exitCode).toBe(0);
    expect(stderr.join("")).toBe("");
    expect(stdout.join("")).toContain("Final verdict: PASS");
    expect(stdout.join("")).toContain("M042-S03-DEGRADED-FALLBACK-NONCONTRADICTORY PASS");
  });

  test("returns exitCode=1 and stderr failure summary when any check fails", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const { exitCode } = await buildM042S03ProofHarness({
      _profileOverrideRunFn: () =>
        makeFixture({
          scenario: "profile-over-cache",
          resolvedSource: "author-cache",
          resolvedTier: "first-time",
          promptAuthorSection: "## Author Experience Context\n\nThe PR author (CrystalP) appears to be a first-time or new contributor to this repository.",
          reviewDetailsBody: "- Author tier: first-time (newcomer guidance)",
        }),
      stdout: { write: (chunk) => (stdout.push(chunk), true) },
      stderr: { write: (chunk) => (stderr.push(chunk), true) },
    });

    expect(exitCode).toBe(1);
    expect(stderr.join("")).toContain("verify:m042:s03 failed");
    expect(stdout.join("")).toContain("Final verdict: FAIL");
  });

  test("emits JSON when json=true", async () => {
    const stdout: string[] = [];

    await buildM042S03ProofHarness({
      stdout: { write: (chunk) => (stdout.push(chunk), true) },
      stderr: { write: () => true },
      json: true,
    });

    const parsed = JSON.parse(stdout.join(""));
    expect(parsed.check_ids).toEqual(M042_S03_CHECK_IDS);
    expect(parsed.overallPassed).toBe(true);
    expect(parsed.checks).toHaveLength(3);
  });
});
