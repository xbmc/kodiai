import { describe, expect, test } from "bun:test";
import {
  classifyContributorProfileTrust,
  CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
  CONTRIBUTOR_PROFILE_TRUST_STALE_AFTER_DAYS,
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

describe("classifyContributorProfileTrust", () => {
  test("classifies an unscored linked profile row as linked-unscored and untrusted", () => {
    const trust = classifyContributorProfileTrust(makeProfile(), {
      referenceTime: REFERENCE_TIME,
    });

    expect(trust).toMatchObject({
      state: "linked-unscored",
      trusted: false,
      reason: "never-scored",
      calibrationMarker: null,
      calibrationVersion: null,
    });
  });

  test("classifies a scored row without a trust marker as legacy and untrusted", () => {
    const trust = classifyContributorProfileTrust(
      makeProfile({
        overallTier: "established",
        overallScore: 0.82,
        lastScoredAt: new Date("2026-03-31T00:00:00.000Z"),
      }),
      { referenceTime: REFERENCE_TIME },
    );

    expect(trust).toMatchObject({
      state: "legacy",
      trusted: false,
      reason: "missing-trust-marker",
      calibrationMarker: null,
      calibrationVersion: null,
    });
  });

  test("trusts a freshly scored current-marker row even when the retained tier is newcomer", () => {
    const trust = classifyContributorProfileTrust(
      makeProfile({
        overallTier: "newcomer",
        overallScore: 0,
        lastScoredAt: new Date("2026-04-09T00:00:00.000Z"),
        trustMarker: CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
      }),
      { referenceTime: REFERENCE_TIME },
    );

    expect(trust).toMatchObject({
      state: "calibrated",
      trusted: true,
      reason: "current-trust-marker",
      calibrationMarker: CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
      calibrationVersion: "v1",
    });
  });

  test("classifies an older current-marker row as stale instead of trustworthy", () => {
    const staleMs =
      (CONTRIBUTOR_PROFILE_TRUST_STALE_AFTER_DAYS + 1) * 24 * 60 * 60 * 1000;
    const trust = classifyContributorProfileTrust(
      makeProfile({
        overallTier: "newcomer",
        overallScore: 0,
        lastScoredAt: new Date(REFERENCE_TIME.getTime() - staleMs),
        trustMarker: CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
      }),
      { referenceTime: REFERENCE_TIME },
    );

    expect(trust).toMatchObject({
      state: "stale",
      trusted: false,
      reason: "trust-marker-stale",
      calibrationMarker: CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
      calibrationVersion: "v1",
    });
  });

  test("classifies future lastScoredAt values as malformed instead of trusting the row", () => {
    const trust = classifyContributorProfileTrust(
      makeProfile({
        overallTier: "newcomer",
        overallScore: 0,
        lastScoredAt: new Date("2026-04-11T00:00:00.000Z"),
        trustMarker: CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
      }),
      { referenceTime: REFERENCE_TIME },
    );

    expect(trust).toMatchObject({
      state: "malformed",
      trusted: false,
      reason: "invalid-last-scored-at",
      calibrationMarker: CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
      calibrationVersion: "v1",
    });
  });

  test("classifies malformed tiers as malformed instead of trusting the row", () => {
    const trust = classifyContributorProfileTrust(
      makeProfile({
        overallTier: "mystery-tier" as never,
        overallScore: 0.42,
        lastScoredAt: new Date("2026-04-09T00:00:00.000Z"),
        trustMarker: CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
      }),
      { referenceTime: REFERENCE_TIME },
    );

    expect(trust).toMatchObject({
      state: "malformed",
      trusted: false,
      reason: "invalid-overall-tier",
    });
  });

  test("classifies unsupported trust markers and missing score timestamps as malformed", () => {
    expect(
      classifyContributorProfileTrust(
        makeProfile({
          overallTier: "newcomer",
          overallScore: 0,
          lastScoredAt: new Date("2026-04-09T00:00:00.000Z"),
          trustMarker: "m046-calibrated-v9",
        }),
        { referenceTime: REFERENCE_TIME },
      ),
    ).toMatchObject({
      state: "malformed",
      trusted: false,
      reason: "unsupported-trust-marker",
      calibrationMarker: "m046-calibrated-v9",
      calibrationVersion: null,
    });

    expect(
      classifyContributorProfileTrust(
        makeProfile({
          overallTier: "newcomer",
          overallScore: 0,
          lastScoredAt: null,
          trustMarker: CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
        }),
        { referenceTime: REFERENCE_TIME },
      ),
    ).toMatchObject({
      state: "malformed",
      trusted: false,
      reason: "missing-last-scored-at",
      calibrationMarker: CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
      calibrationVersion: "v1",
    });
  });
});
