import { describe, expect, test } from "bun:test";
import {
  CONTRIBUTOR_PROFILE_TRUST_STALE_AFTER_DAYS,
  CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
} from "./profile-trust.ts";
import type { ContributorProfile } from "./types.ts";

const REFERENCE_TIME = new Date("2026-04-10T12:00:00.000Z");

function makeProfile(
  overrides: Partial<ContributorProfile> = {},
): ContributorProfile {
  return {
    id: 1,
    githubUsername: "octocat",
    slackUserId: "U123",
    displayName: "Octo Cat",
    overallTier: "newcomer",
    overallScore: 0,
    optedOut: false,
    createdAt: new Date("2026-04-01T00:00:00.000Z"),
    updatedAt: new Date("2026-04-01T00:00:00.000Z"),
    lastScoredAt: null,
    trustMarker: null,
    ...overrides,
  };
}

async function loadSurfaceModule() {
  const module = await import("./profile-surface-resolution.ts").catch(() => null);
  expect(module).not.toBeNull();
  return module as NonNullable<typeof module>;
}

describe("resolveContributorProfileSurface", () => {
  test("projects a calibrated stored profile as profile-backed with expertise enabled", async () => {
    const { resolveContributorProfileSurface } = await loadSurfaceModule();

    const resolution = resolveContributorProfileSurface(
      makeProfile({
        overallTier: "established",
        overallScore: 0.82,
        lastScoredAt: new Date("2026-04-09T00:00:00.000Z"),
        trustMarker: CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
      }),
      { referenceTime: REFERENCE_TIME },
    );

    expect(resolution).toMatchObject({
      shouldLookupExpertise: true,
      projection: {
        state: "profile-backed",
        statusLine: "Status: Linked contributor guidance is active.",
        summaryLine:
          "Kodiai can adapt review guidance using your linked contributor profile.",
        showExpertise: true,
      },
      trust: {
        state: "calibrated",
        trusted: true,
        reason: "current-trust-marker",
      },
    });
  });

  test("keeps opted-out rows generic even when the stored profile is otherwise calibrated", async () => {
    const { resolveContributorProfileSurface } = await loadSurfaceModule();

    const resolution = resolveContributorProfileSurface(
      makeProfile({
        overallTier: "senior",
        overallScore: 0.98,
        optedOut: true,
        lastScoredAt: new Date("2026-04-09T00:00:00.000Z"),
        trustMarker: CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
      }),
      { referenceTime: REFERENCE_TIME },
    );

    expect(resolution).toMatchObject({
      shouldLookupExpertise: false,
      projection: {
        state: "generic-opt-out",
        statusLine: "Status: Generic contributor guidance is active.",
        summaryLine:
          "You opted out of contributor-specific guidance. Kodiai will keep reviews generic until you opt back in.",
        showExpertise: false,
      },
      trust: {
        state: "calibrated",
        trusted: true,
      },
    });
  });

  test("collapses linked-unscored, legacy, stale, and malformed rows to generic-unknown Slack/profile copy", async () => {
    const { resolveContributorProfileSurface } = await loadSurfaceModule();
    const staleMs =
      (CONTRIBUTOR_PROFILE_TRUST_STALE_AFTER_DAYS + 1) * 24 * 60 * 60 * 1000;

    const cases = [
      {
        label: "linked-unscored",
        profile: makeProfile(),
        expectedTrustState: "linked-unscored",
      },
      {
        label: "legacy",
        profile: makeProfile({
          overallTier: "developing",
          overallScore: 0.41,
          lastScoredAt: new Date("2026-04-01T00:00:00.000Z"),
        }),
        expectedTrustState: "legacy",
      },
      {
        label: "stale",
        profile: makeProfile({
          overallTier: "established",
          overallScore: 0.82,
          lastScoredAt: new Date(REFERENCE_TIME.getTime() - staleMs),
          trustMarker: CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
        }),
        expectedTrustState: "stale",
      },
      {
        label: "malformed",
        profile: makeProfile({
          overallTier: "mystery-tier" as never,
          overallScore: 0.2,
          lastScoredAt: new Date("2026-04-01T00:00:00.000Z"),
          trustMarker: CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
        }),
        expectedTrustState: "malformed",
      },
    ] as const;

    for (const testCase of cases) {
      const resolution = resolveContributorProfileSurface(testCase.profile, {
        referenceTime: REFERENCE_TIME,
      });

      expect(resolution, testCase.label).toMatchObject({
        shouldLookupExpertise: false,
        projection: {
          state: "generic-unknown",
          statusLine: "Status: Generic contributor guidance is active.",
          summaryLine:
            "Kodiai does not have a reliable contributor signal for this profile yet, so reviews stay generic.",
          showExpertise: false,
        },
        trust: {
          state: testCase.expectedTrustState,
          trusted: false,
        },
      });
    }
  });

  test("fails open to generic-unknown copy when trust classification throws", async () => {
    const { resolveContributorProfileSurface } = await loadSurfaceModule();

    const resolution = resolveContributorProfileSurface(
      makeProfile({
        overallTier: "senior",
        overallScore: 0.98,
        lastScoredAt: new Date("2026-04-09T00:00:00.000Z"),
        trustMarker: CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
      }),
      {
        referenceTime: REFERENCE_TIME,
        classifyTrust: () => {
          throw new Error("boom");
        },
      },
    );

    expect(resolution).toMatchObject({
      shouldLookupExpertise: false,
      projection: {
        state: "generic-unknown",
        showExpertise: false,
      },
      trust: null,
    });
  });
});

describe("stored-profile continuity copy", () => {
  test("renders active link and opt-in copy only for trusted profile-backed surfaces", async () => {
    const {
      resolveContributorProfileSurface,
      renderLinkedProfileContinuityMessage,
      renderProfileOptInContinuityMessage,
    } = await loadSurfaceModule();

    const trustedSurface = resolveContributorProfileSurface(
      makeProfile({
        overallTier: "established",
        overallScore: 0.82,
        lastScoredAt: new Date("2026-04-09T00:00:00.000Z"),
        trustMarker: CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
      }),
      { referenceTime: REFERENCE_TIME },
    );

    expect(
      renderLinkedProfileContinuityMessage({
        githubUsername: "octocat",
        surface: trustedSurface,
      }),
    ).toBe(
      "Linked your Slack account to GitHub user `octocat`. Linked contributor guidance is active for your profile. Use `/kodiai profile` to review your status.",
    );

    expect(
      renderProfileOptInContinuityMessage({
        surface: trustedSurface,
      }),
    ).toBe(
      "Contributor-specific guidance is now on for your linked profile. Use `/kodiai profile` to review your status, or `/kodiai profile opt-out` to return to generic guidance.",
    );
  });

  test("renders generic continuity copy for linked-unscored surfaces without claiming active linked guidance", async () => {
    const {
      resolveContributorProfileSurface,
      renderLinkedProfileContinuityMessage,
      renderProfileOptInContinuityMessage,
    } = await loadSurfaceModule();

    const untrustedSurface = resolveContributorProfileSurface(makeProfile(), {
      referenceTime: REFERENCE_TIME,
    });

    expect(
      renderLinkedProfileContinuityMessage({
        githubUsername: "octocat",
        surface: untrustedSurface,
      }),
    ).toBe(
      "Linked your Slack account to GitHub user `octocat`. Kodiai will keep your reviews generic until your linked profile has current contributor signals. Use `/kodiai profile` to review your status.",
    );

    expect(
      renderProfileOptInContinuityMessage({
        surface: untrustedSurface,
      }),
    ).toBe(
      "Contributor-specific guidance is now on for your linked profile, but Kodiai will keep reviews generic until current contributor signals are available. Use `/kodiai profile` to review your status, or `/kodiai profile opt-out` to return to generic guidance.",
    );
  });
});
