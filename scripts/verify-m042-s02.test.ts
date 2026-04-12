import { describe, expect, test } from "bun:test";
import {
  M042_S02_CHECK_IDS,
  buildM042S02ProofHarness,
  evaluateM042S02,
  runEstablishedSurfaceFixture,
  runProfileTierDrivesSurfaceCheck,
  runPromptEstablishedTruthfulCheck,
  runDetailsEstablishedTruthfulCheck,
  runCrystalPSurfacesStayEstablishedCheck,
} from "./verify-m042-s02.ts";

type FixtureResult = ReturnType<typeof runEstablishedSurfaceFixture>;

function makeFixture(overrides?: Partial<FixtureResult>): FixtureResult {
  return {
    resolvedTier: "established",
    resolvedSource: "contributor-profile",
    promptAuthorSection: [
      "## Author Experience Context",
      "",
      "Contributor-experience contract: profile-backed.",
      "The PR author (CrystalP) is an established contributor.",
      "",
      "- Keep explanations brief — one sentence on WHY, then the suggestion",
    ].join("\n"),
    reviewDetailsBody: [
      "<details>",
      "<summary>Review Details</summary>",
      "",
      "- Contributor experience: profile-backed (using linked contributor profile guidance)",
      "</details>",
    ].join("\n"),
    ...overrides,
  };
}

describe("runEstablishedSurfaceFixture", () => {
  test("uses contributor-profile precedence and renders established contract surfaces for CrystalP", () => {
    const fixture = runEstablishedSurfaceFixture();

    expect(fixture.resolvedSource).toBe("contributor-profile");
    expect(fixture.resolvedTier).toBe("established");
    expect(fixture.promptAuthorSection).toContain("CrystalP");
    expect(fixture.promptAuthorSection).toContain("Contributor-experience contract: profile-backed.");
    expect(fixture.promptAuthorSection).toContain("established contributor");
    expect(fixture.promptAuthorSection).not.toContain("first-time or new contributor");
    expect(fixture.promptAuthorSection).not.toContain("developing contributor");
    expect(fixture.reviewDetailsBody).toContain(
      "- Contributor experience: profile-backed (using linked contributor profile guidance)",
    );
    expect(fixture.reviewDetailsBody).not.toContain("- Author tier:");
    expect(fixture.reviewDetailsBody).not.toContain("generic-unknown");
  });
});

describe("M042-S02-PROFILE-TIER-DRIVES-SURFACE", () => {
  test("passes with the real deterministic fixture", async () => {
    const result = await runProfileTierDrivesSurfaceCheck();

    expect(result.id).toBe("M042-S02-PROFILE-TIER-DRIVES-SURFACE");
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.status_code).toBe("contributor_profile_tier_selected_for_surface_rendering");
  });

  test("fails when the surface resolves from fallback instead of contributor profile", async () => {
    const result = await runProfileTierDrivesSurfaceCheck(() =>
      makeFixture({ resolvedSource: "fallback", resolvedTier: "first-time" }),
    );

    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("profile_tier_surface_selection_failed");
    expect(result.detail).toContain("resolvedSource=fallback");
    expect(result.detail).toContain("resolvedTier=first-time");
  });
});

describe("M042-S02-PROMPT-ESTABLISHED-TRUTHFUL", () => {
  test("passes with the real deterministic fixture", async () => {
    const result = await runPromptEstablishedTruthfulCheck();

    expect(result.id).toBe("M042-S02-PROMPT-ESTABLISHED-TRUTHFUL");
    expect(result.passed).toBe(true);
    expect(result.status_code).toBe("prompt_established_guidance_truthful");
  });

  test("fails when established prompt section reintroduces newcomer guidance", async () => {
    const result = await runPromptEstablishedTruthfulCheck(() =>
      makeFixture({
        promptAuthorSection: [
          "## Author Experience Context",
          "",
          "Contributor-experience contract: profile-backed.",
          "The PR author (CrystalP) appears to be a first-time or new contributor to this repository.",
          "",
          "- Explain WHY each finding matters, not just WHAT is wrong",
        ].join("\n"),
      }),
    );

    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("prompt_established_truthfulness_failed");
    expect(result.detail).toContain("missing required prompt phrases");
    expect(result.detail).toContain("unexpected prompt phrases present");
  });
});

describe("M042-S02-DETAILS-ESTABLISHED-TRUTHFUL", () => {
  test("passes with the real deterministic fixture", async () => {
    const result = await runDetailsEstablishedTruthfulCheck();

    expect(result.id).toBe("M042-S02-DETAILS-ESTABLISHED-TRUTHFUL");
    expect(result.passed).toBe(true);
    expect(result.status_code).toBe("review_details_established_guidance_truthful");
  });

  test("fails when review details fall back to coarse fallback wording", async () => {
    const result = await runDetailsEstablishedTruthfulCheck(() =>
      makeFixture({
        reviewDetailsBody: [
          "<details>",
          "<summary>Review Details</summary>",
          "",
          "- Contributor experience: coarse-fallback (using coarse fallback signals only)",
          "</details>",
        ].join("\n"),
      }),
    );

    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("review_details_established_truthfulness_failed");
    expect(result.detail).toContain("missing required review-details phrases");
    expect(result.detail).toContain("unexpected review-details phrases present");
  });
});

describe("M042-S02-CRYSTALP-SURFACES-STAY-ESTABLISHED", () => {
  test("passes with the real deterministic fixture", async () => {
    const result = await runCrystalPSurfacesStayEstablishedCheck();

    expect(result.id).toBe("M042-S02-CRYSTALP-SURFACES-STAY-ESTABLISHED");
    expect(result.passed).toBe(true);
    expect(result.status_code).toBe("crystalp_review_surfaces_remain_established");
  });

  test("fails when either surface regresses to coarse fallback or generic guidance", async () => {
    const result = await runCrystalPSurfacesStayEstablishedCheck(() =>
      makeFixture({
        promptAuthorSection: [
          "## Author Experience Context",
          "",
          "Contributor-experience contract: coarse-fallback.",
          "The PR author (CrystalP) is being reviewed with only coarse fallback signals for this repository.",
        ].join("\n"),
        reviewDetailsBody: "- Contributor experience: coarse-fallback (using coarse fallback signals only)",
      }),
    );

    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("crystalp_established_surface_regression_detected");
    expect(result.detail).toContain("regressed to coarse fallback guidance");
  });
});

describe("evaluateM042S02", () => {
  test("returns the exported check ids and passes with the real deterministic fixture", async () => {
    const report = await evaluateM042S02();

    expect(report.check_ids).toEqual(M042_S02_CHECK_IDS);
    expect(report.checks).toHaveLength(4);
    expect(report.overallPassed).toBe(true);
    expect(report.checks.every((check) => check.passed)).toBe(true);
  });

  test("overallPassed is false when any check fails", async () => {
    const report = await evaluateM042S02({
      _runFn: () => makeFixture({ resolvedSource: "fallback", resolvedTier: "first-time" }),
    });

    expect(report.overallPassed).toBe(false);
    expect(report.checks.some((check) => !check.passed)).toBe(true);
  });
});

describe("buildM042S02ProofHarness", () => {
  test("returns exitCode=0 and text output when checks pass", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const { exitCode } = await buildM042S02ProofHarness({
      stdout: { write: (chunk) => void stdout.push(chunk) },
      stderr: { write: (chunk) => void stderr.push(chunk) },
    });

    expect(exitCode).toBe(0);
    expect(stderr.join("")).toBe("");
    expect(stdout.join("")).toContain("Final verdict: PASS");
    expect(stdout.join("")).toContain("M042-S02-CRYSTALP-SURFACES-STAY-ESTABLISHED PASS");
  });

  test("returns exitCode=1 and stderr failure summary when any check fails", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const { exitCode } = await buildM042S02ProofHarness({
      _runFn: () => makeFixture({ resolvedSource: "fallback", resolvedTier: "first-time" }),
      stdout: { write: (chunk) => void stdout.push(chunk) },
      stderr: { write: (chunk) => void stderr.push(chunk) },
    });

    expect(exitCode).toBe(1);
    expect(stderr.join("")).toContain("verify:m042:s02 failed");
    expect(stdout.join("")).toContain("Final verdict: FAIL");
  });

  test("emits JSON when json=true", async () => {
    const stdout: string[] = [];

    await buildM042S02ProofHarness({
      stdout: { write: (chunk) => void stdout.push(chunk) },
      stderr: { write: () => {} },
      json: true,
    });

    const parsed = JSON.parse(stdout.join(""));
    expect(parsed.check_ids).toEqual(M042_S02_CHECK_IDS);
    expect(parsed.overallPassed).toBe(true);
    expect(parsed.checks).toHaveLength(4);
  });
});
