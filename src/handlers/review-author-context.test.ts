import { describe, expect, mock, test } from "bun:test";
import type { Logger } from "pino";
import type { ReviewAuthorClassification } from "../contributor/review-author-resolution.ts";
import type { ContributorExpertise } from "../contributor/types.ts";
import type { RateLimitEventRecord } from "../telemetry/types.ts";
import {
  projectReviewAuthorExpertiseForPrompt,
  resolveReviewAuthorContext,
} from "./review-author-context.ts";

function createLogger() {
  const info = mock((_bindings: Record<string, unknown>, _message: string) => {});
  const warn = mock((_bindings: Record<string, unknown>, _message: string) => {});
  return {
    logger: { info, warn } as unknown as Pick<Logger, "info" | "warn">,
    info,
    warn,
  };
}

function createClassification(): ReviewAuthorClassification {
  return {
    tier: "regular" as const,
    prCount: 12,
    fromCache: true,
    searchCacheHit: true,
    searchEnrichment: {
      degraded: true,
      retryAttempts: 1,
      skippedQueries: 2,
      degradationPath: "search-api-rate-limit" as const,
    },
    contract: {
      state: "generic-degraded",
      source: "author-association",
      reviewBehavior: "generic",
      promptTier: null,
      promptPolicy: { kind: "generic-degraded" },
      reviewDetails: {
        state: "generic-degraded",
        text: "Generic contributor guidance",
      },
      degraded: true,
      degradationPath: "profile-unavailable",
    },
    storedProfileTrust: {
      state: "legacy" as const,
      trusted: false,
      reason: "missing-trust-marker",
      calibrationMarker: null,
      calibrationVersion: null,
    },
    fallbackPath: "legacy-profile->generic-known",
  };
}

function createExpertise(overrides: Partial<ContributorExpertise> = {}): ContributorExpertise {
  return {
    id: 1,
    profileId: 2,
    dimension: "language",
    topic: "typescript",
    score: 0.84,
    rawSignals: 12,
    lastActive: new Date("2026-07-07T00:00:00Z"),
    createdAt: new Date("2026-07-07T00:00:00Z"),
    updatedAt: new Date("2026-07-07T00:00:00Z"),
    ...overrides,
  };
}

describe("projectReviewAuthorExpertiseForPrompt", () => {
  test("projects expertise only for profile-backed contributor contracts", () => {
    const classification = createClassification();
    classification.contract = {
      ...classification.contract,
      state: "profile-backed",
    };
    classification.expertise = [
      createExpertise(),
      createExpertise({
        id: 2,
        dimension: "file_area",
        topic: "src/handlers/",
        score: 0.72,
      }),
    ];

    expect(projectReviewAuthorExpertiseForPrompt(classification)).toEqual([
      { dimension: "language", topic: "typescript", score: 0.84 },
      { dimension: "file_area", topic: "src/handlers/", score: 0.72 },
    ]);
  });

  test("hides expertise for generic contributor contracts", () => {
    const classification = createClassification();
    classification.expertise = [createExpertise()];

    expect(projectReviewAuthorExpertiseForPrompt(classification)).toBeUndefined();
  });
});

describe("resolveReviewAuthorContext", () => {
  test("resolves author classification, logs diagnostics, suggests identity, and records rate-limit telemetry", async () => {
    const { logger, info, warn } = createLogger();
    const classification = createClassification();
    const resolveAuthor = mock(async () => classification);
    const suggestIdentity = mock(async () => {});
    const rateLimitEvents: RateLimitEventRecord[] = [];

    const result = await resolveReviewAuthorContext({
      authorLogin: "octocat",
      authorDisplayName: "The Octocat",
      authorAssociation: "CONTRIBUTOR",
      owner: "acme",
      repo: "widgets",
      repoSlug: "acme/widgets",
      prNumber: 42,
      deliveryId: "delivery-1",
      eventType: "pull_request.opened",
      octokit: {} as never,
      baseLog: { deliveryId: "delivery-1", prNumber: 42 },
      logger,
      telemetryEnabled: true,
      telemetryStore: {
        recordRateLimitEvent: async (entry) => {
          rateLimitEvents.push(entry);
        },
      },
      contributorProfileStore: {} as never,
      slackBotToken: "xoxb-token",
      resolveAuthor,
      suggestIdentity,
    });

    expect(result).toBe(classification);
    expect(resolveAuthor).toHaveBeenCalledWith(expect.objectContaining({
      authorLogin: "octocat",
      authorAssociation: "CONTRIBUTOR",
      owner: "acme",
      repo: "widgets",
      repoSlug: "acme/widgets",
    }));
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]?.[0]).toMatchObject({
      deliveryId: "delivery-1",
      prNumber: 42,
      authorTier: "regular",
      authorPrCount: 12,
      fromCache: true,
      searchCacheHit: true,
      storedProfileTrustState: "legacy",
      storedProfileFallbackPath: "legacy-profile->generic-known",
      contributorExperienceState: "generic-degraded",
      contributorExperienceDegraded: true,
      searchEnrichmentDegraded: true,
      searchEnrichmentRetryAttempts: 1,
      searchEnrichmentSkippedQueries: 2,
      searchEnrichmentPath: "search-api-rate-limit",
    });
    expect(info.mock.calls[0]?.[1]).toBe("Author experience classification resolved");
    expect(suggestIdentity).toHaveBeenCalledWith({
      githubUsername: "octocat",
      githubDisplayName: "The Octocat",
      slackBotToken: "xoxb-token",
      profileStore: {},
      logger,
    });
    expect(rateLimitEvents).toEqual([{
      deliveryId: "delivery-1",
      executionIdentity: "delivery-1",
      repo: "acme/widgets",
      prNumber: 42,
      eventType: "pull_request.opened",
      cacheHitRate: 1,
      skippedQueries: 2,
      retryAttempts: 1,
      degradationPath: "search-api-rate-limit",
    }]);
    expect(warn).not.toHaveBeenCalled();
  });

  test("keeps classification fail-open and logs non-blocking side-effect failures", async () => {
    const { logger, info, warn } = createLogger();
    const classifyErr = new Error("classification failed");
    const suggestErr = new Error("dm failed");
    const telemetryErr = new Error("telemetry failed");

    const result = await resolveReviewAuthorContext({
      authorLogin: "octocat",
      authorDisplayName: null,
      authorAssociation: "NONE",
      owner: "acme",
      repo: "widgets",
      repoSlug: "acme/widgets",
      prNumber: 42,
      deliveryId: "delivery-1",
      eventType: "pull_request.opened",
      octokit: {} as never,
      baseLog: { deliveryId: "delivery-1", prNumber: 42 },
      logger,
      telemetryEnabled: true,
      telemetryStore: {
        recordRateLimitEvent: async () => {
          throw telemetryErr;
        },
      },
      contributorProfileStore: {} as never,
      slackBotToken: "xoxb-token",
      resolveAuthor: mock(async () => {
        throw classifyErr;
      }),
      suggestIdentity: mock(async () => {
        throw suggestErr;
      }),
    });

    expect(result.contract.state).toBe("generic-unknown");
    expect(result.fallbackPath).toBe("no-stored-profile->generic-unknown");
    expect(info).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(3);
    expect(warn.mock.calls[0]?.[0]).toMatchObject({ err: classifyErr });
    expect(warn.mock.calls[0]?.[1]).toBe(
      "Author classification failed (fail-open, using generic unknown contract)",
    );
    expect(warn.mock.calls[1]?.[0]).toMatchObject({ err: suggestErr });
    expect(warn.mock.calls[1]?.[1]).toBe("Identity suggestion check failed (non-blocking)");
    expect(warn.mock.calls[2]?.[0]).toMatchObject({
      err: telemetryErr,
      executionIdentity: "delivery-1",
      telemetryEventType: "pull_request.opened",
    });
    expect(warn.mock.calls[2]?.[1]).toBe("Rate-limit telemetry write failed (non-blocking)");
  });
});
