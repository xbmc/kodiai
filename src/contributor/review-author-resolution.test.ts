import { describe, expect, test } from "bun:test";
import type { Logger } from "pino";
import type { ContributorProfile, ContributorProfileStore } from "./types.ts";
import { CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER } from "./profile-trust.ts";
import { resolveReviewAuthorClassification } from "./review-author-resolution.ts";

const REFERENCE_TIME = new Date("2026-04-10T12:00:00.000Z");

function createNoopLogger(): Logger {
  const noop = () => undefined;
  return {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: () => createNoopLogger(),
  } as unknown as Logger;
}

function makeProfile(
  overrides: Partial<ContributorProfile> & { overallTier?: string } = {},
): ContributorProfile {
  return {
    id: 1,
    githubUsername: "octocat",
    slackUserId: null,
    displayName: "Octo Cat",
    overallTier: "established",
    overallScore: 0.82,
    optedOut: false,
    createdAt: new Date("2026-04-01T00:00:00.000Z"),
    updatedAt: new Date("2026-04-01T00:00:00.000Z"),
    lastScoredAt: new Date("2026-04-09T00:00:00.000Z"),
    trustMarker: CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
    ...overrides,
  } as ContributorProfile;
}

function createContributorProfileStore(params: {
  profile: ContributorProfile | null;
  expertiseError?: Error;
}): ContributorProfileStore {
  return {
    getByGithubUsername: async () => params.profile,
    getBySlackUserId: async () => null,
    linkIdentity: async () => {
      throw new Error("not implemented in test");
    },
    unlinkSlack: async () => undefined,
    setOptedOut: async () => undefined,
    getExpertise: async () => {
      if (params.expertiseError) {
        throw params.expertiseError;
      }
      return [];
    },
    upsertExpertise: async () => undefined,
    updateTier: async () => undefined,
    getOrCreateByGithubUsername: async () => {
      throw new Error("not implemented in test");
    },
    getAllScores: async () => [],
  };
}

function createSearchRateLimitError(): unknown {
  return {
    status: 429,
    message: "secondary rate limit",
    response: {
      headers: {
        "retry-after": "0",
      },
      data: {
        message: "You have exceeded a secondary rate limit",
      },
    },
  };
}

describe("resolveReviewAuthorClassification", () => {
  test("keeps a trustworthy calibrated stored profile as profile-backed despite contradictory cached low-tier data", async () => {
    const result = await resolveReviewAuthorClassification({
      authorLogin: "octocat",
      authorAssociation: "NONE",
      repo: "repo",
      owner: "acme",
      repoSlug: "acme/repo",
      searchIssuesAndPullRequests: async () => {
        throw new Error("search should not execute when a trustworthy stored profile exists");
      },
      knowledgeStore: {
        getAuthorCache: async () => ({
          tier: "regular",
          prCount: 4,
        }),
        upsertAuthorCache: async () => undefined,
      } as never,
      contributorProfileStore: createContributorProfileStore({
        profile: makeProfile({
          overallTier: "established",
        }),
      }),
      logger: createNoopLogger(),
      referenceTime: REFERENCE_TIME,
    });

    expect(result.contract.state).toBe("profile-backed");
    expect(result.contract.source).toBe("contributor-profile");
    expect(result.contract.reviewDetails.text).toBe(
      "profile-backed (using linked contributor profile guidance)",
    );
    expect(result.storedProfileTrust).toMatchObject({
      state: "calibrated",
      trusted: true,
      reason: "current-trust-marker",
      calibrationMarker: CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
      calibrationVersion: "v1",
    });
    expect(result.fallbackPath).toBe("trusted-stored-profile");
  });

  test("fails open from a linked-unscored stored row into github-search coarse fallback", async () => {
    const result = await resolveReviewAuthorClassification({
      authorLogin: "octocat",
      authorAssociation: "NONE",
      repo: "repo",
      owner: "acme",
      repoSlug: "acme/repo",
      searchIssuesAndPullRequests: async () => ({
        data: { total_count: 4 },
      }),
      contributorProfileStore: createContributorProfileStore({
        profile: makeProfile({
          overallTier: "newcomer",
          overallScore: 0,
          lastScoredAt: null,
          trustMarker: null,
        }),
      }),
      logger: createNoopLogger(),
      referenceTime: REFERENCE_TIME,
    });

    expect(result.contract.state).toBe("coarse-fallback");
    expect(result.contract.source).toBe("github-search");
    expect(result.storedProfileTrust).toMatchObject({
      state: "linked-unscored",
      trusted: false,
      reason: "never-scored",
    });
    expect(result.fallbackPath).toBe(
      "stored-profile-linked-unscored->github-search",
    );
  });

  test("fails open from a legacy stored row into author-cache coarse fallback", async () => {
    const result = await resolveReviewAuthorClassification({
      authorLogin: "octocat",
      authorAssociation: "NONE",
      repo: "repo",
      owner: "acme",
      repoSlug: "acme/repo",
      searchIssuesAndPullRequests: async () => {
        throw new Error("search should not execute when author cache resolves the fallback");
      },
      knowledgeStore: {
        getAuthorCache: async () => ({
          tier: "regular",
          prCount: 4,
        }),
        upsertAuthorCache: async () => undefined,
      } as never,
      contributorProfileStore: createContributorProfileStore({
        profile: makeProfile({
          overallTier: "established",
          trustMarker: null,
        }),
      }),
      logger: createNoopLogger(),
      referenceTime: REFERENCE_TIME,
    });

    expect(result.contract.state).toBe("coarse-fallback");
    expect(result.contract.source).toBe("author-cache");
    expect(result.storedProfileTrust).toMatchObject({
      state: "legacy",
      trusted: false,
      reason: "missing-trust-marker",
    });
    expect(result.fallbackPath).toBe("stored-profile-legacy->author-cache");
  });

  test("keeps opt-out precedence even when the stored row is otherwise trustworthy", async () => {
    const result = await resolveReviewAuthorClassification({
      authorLogin: "octocat",
      authorAssociation: "NONE",
      repo: "repo",
      owner: "acme",
      repoSlug: "acme/repo",
      searchIssuesAndPullRequests: async () => {
        throw new Error("search should not execute for opted-out profiles");
      },
      knowledgeStore: {
        getAuthorCache: async () => ({
          tier: "core",
          prCount: 12,
        }),
        upsertAuthorCache: async () => undefined,
      } as never,
      contributorProfileStore: createContributorProfileStore({
        profile: makeProfile({
          overallTier: "established",
          optedOut: true,
        }),
      }),
      logger: createNoopLogger(),
      referenceTime: REFERENCE_TIME,
    });

    expect(result.contract.state).toBe("generic-opt-out");
    expect(result.contract.source).toBe("contributor-profile");
    expect(result.storedProfileTrust).toMatchObject({
      state: "calibrated",
      trusted: true,
    });
    expect(result.fallbackPath).toBe("opted-out-stored-profile");
  });

  test("fails open when expertise lookup breaks after a trustworthy stored profile was found", async () => {
    const result = await resolveReviewAuthorClassification({
      authorLogin: "octocat",
      authorAssociation: "NONE",
      repo: "repo",
      owner: "acme",
      repoSlug: "acme/repo",
      searchIssuesAndPullRequests: async () => {
        throw new Error("search should not execute when author cache resolves the fallback");
      },
      knowledgeStore: {
        getAuthorCache: async () => ({
          tier: "regular",
          prCount: 4,
        }),
        upsertAuthorCache: async () => undefined,
      } as never,
      contributorProfileStore: createContributorProfileStore({
        profile: makeProfile({
          overallTier: "established",
        }),
        expertiseError: new Error("expertise store unavailable"),
      }),
      logger: createNoopLogger(),
      referenceTime: REFERENCE_TIME,
    });

    expect(result.contract.state).toBe("coarse-fallback");
    expect(result.contract.source).toBe("author-cache");
    expect(result.storedProfileTrust).toMatchObject({
      state: "calibrated",
      trusted: true,
    });
    expect(result.expertise).toBeUndefined();
    expect(result.fallbackPath).toBe("stored-profile-calibrated->author-cache");
  });

  test("degrades to generic when a stale stored profile is bypassed and search is rate-limited", async () => {
    const result = await resolveReviewAuthorClassification({
      authorLogin: "octocat",
      authorAssociation: "NONE",
      repo: "repo",
      owner: "acme",
      repoSlug: "acme/repo",
      searchIssuesAndPullRequests: async () => {
        throw createSearchRateLimitError();
      },
      contributorProfileStore: createContributorProfileStore({
        profile: makeProfile({
          overallTier: "established",
          lastScoredAt: new Date("2025-09-01T00:00:00.000Z"),
        }),
      }),
      logger: createNoopLogger(),
      referenceTime: REFERENCE_TIME,
    });

    expect(result.contract.state).toBe("generic-degraded");
    expect(result.contract.source).toBe("github-search");
    expect(result.searchEnrichment.degraded).toBe(true);
    expect(result.searchEnrichment.degradationPath).toBe("search-api-rate-limit");
    expect(result.storedProfileTrust).toMatchObject({
      state: "stale",
      trusted: false,
      reason: "trust-marker-stale",
    });
    expect(result.fallbackPath).toBe("stored-profile-stale->generic-degraded");
  });
});
