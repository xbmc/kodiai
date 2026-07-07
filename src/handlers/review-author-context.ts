import type { Logger } from "pino";
import type { GitHubApp } from "../auth/github-app.ts";
import type { ContributorProfileStore } from "../contributor/types.ts";
import type { ReviewAuthorClassification } from "../contributor/review-author-resolution.ts";
import { projectContributorExperienceContract } from "../contributor/experience-contract.ts";
import type { ReviewPromptBuildContext } from "../review-orchestration/review-prompt-fingerprint.ts";
import type { KnowledgeStore } from "../knowledge/types.ts";
import type { SearchCache } from "../lib/search-cache.ts";
import { resolveAuthorTier } from "../review-orchestration/review-author-tier.ts";
import type { RateLimitEventRecord, TelemetryStore } from "../telemetry/types.ts";
import { suggestIdentityLink } from "./identity-suggest.ts";

type ReviewOctokit = Awaited<ReturnType<GitHubApp["getInstallationOctokit"]>>;
type ResolveAuthorTier = typeof resolveAuthorTier;
type SuggestIdentityLink = typeof suggestIdentityLink;

function createDefaultAuthorClassification(): ReviewAuthorClassification {
  return {
    tier: "regular",
    prCount: null,
    fromCache: false,
    searchCacheHit: false,
    searchEnrichment: {
      degraded: false,
      retryAttempts: 0,
      skippedQueries: 0,
      degradationPath: "none",
    },
    contract: projectContributorExperienceContract({
      source: "none",
      tier: null,
    }),
    storedProfileTrust: null,
    fallbackPath: "no-stored-profile->generic-unknown",
  };
}

export function projectReviewAuthorExpertiseForPrompt(
  authorClassification: ReviewAuthorClassification,
): ReviewPromptBuildContext["authorExpertise"] {
  if (authorClassification.contract.state !== "profile-backed") {
    return undefined;
  }

  return authorClassification.expertise?.map((expertise) => ({
    dimension: expertise.dimension,
    topic: expertise.topic,
    score: expertise.score,
  }));
}

function logAuthorClassificationResolved(params: {
  logger: Pick<Logger, "info">;
  baseLog: Record<string, unknown>;
  authorClassification: ReviewAuthorClassification;
}): void {
  const { logger, baseLog, authorClassification } = params;
  logger.info(
    {
      ...baseLog,
      authorTier: authorClassification.tier,
      authorPrCount: authorClassification.prCount,
      fromCache: authorClassification.fromCache,
      searchCacheHit: authorClassification.searchCacheHit,
      storedProfileTrustState:
        authorClassification.storedProfileTrust?.state ?? null,
      storedProfileTrustReason:
        authorClassification.storedProfileTrust?.reason ?? null,
      storedProfileCalibrationMarker:
        authorClassification.storedProfileTrust?.calibrationMarker ?? null,
      storedProfileCalibrationVersion:
        authorClassification.storedProfileTrust?.calibrationVersion ?? null,
      storedProfileFallbackPath: authorClassification.fallbackPath,
      contributorExperienceState: authorClassification.contract.state,
      contributorExperienceSource: authorClassification.contract.source,
      contributorExperienceReviewBehavior: authorClassification.contract.reviewBehavior,
      contributorExperienceDegraded: authorClassification.contract.degraded,
      contributorExperienceDegradationPath: authorClassification.contract.degradationPath,
      searchEnrichmentDegraded: authorClassification.searchEnrichment.degraded,
      searchEnrichmentRetryAttempts: authorClassification.searchEnrichment.retryAttempts,
      searchEnrichmentSkippedQueries: authorClassification.searchEnrichment.skippedQueries,
      searchEnrichmentPath: authorClassification.searchEnrichment.degradationPath,
    },
    "Author experience classification resolved",
  );
}

async function maybeSuggestIdentityLink(params: {
  authorClassification: ReviewAuthorClassification;
  authorLogin: string;
  authorDisplayName: string | null;
  slackBotToken?: string;
  contributorProfileStore?: ContributorProfileStore;
  logger: Pick<Logger, "warn">;
  baseLog: Record<string, unknown>;
  suggestIdentity: SuggestIdentityLink;
}): Promise<void> {
  if (
    params.authorClassification.contract.state === "generic-opt-out" ||
    params.authorClassification.expertise ||
    !params.slackBotToken ||
    !params.contributorProfileStore
  ) {
    return;
  }

  try {
    await params.suggestIdentity({
      githubUsername: params.authorLogin,
      githubDisplayName: params.authorDisplayName,
      slackBotToken: params.slackBotToken,
      profileStore: params.contributorProfileStore,
      logger: params.logger as Logger,
    });
  } catch (err) {
    params.logger.warn(
      { ...params.baseLog, err },
      "Identity suggestion check failed (non-blocking)",
    );
  }
}

async function recordAuthorRateLimitTelemetry(params: {
  authorClassification: ReviewAuthorClassification;
  telemetryEnabled: boolean;
  telemetryStore: Pick<TelemetryStore, "recordRateLimitEvent">;
  deliveryId: string;
  repoSlug: string;
  prNumber: number;
  eventType: string;
  logger: Pick<Logger, "warn">;
  baseLog: Record<string, unknown>;
}): Promise<void> {
  const rateLimitTelemetryEvent: RateLimitEventRecord = {
    deliveryId: params.deliveryId,
    executionIdentity: params.deliveryId,
    repo: params.repoSlug,
    prNumber: params.prNumber,
    eventType: params.eventType,
    cacheHitRate: params.authorClassification.searchCacheHit ? 1 : 0,
    skippedQueries: params.authorClassification.searchEnrichment.skippedQueries,
    retryAttempts: params.authorClassification.searchEnrichment.retryAttempts,
    degradationPath: params.authorClassification.searchEnrichment.degradationPath,
  };

  if (!params.telemetryEnabled) return;

  try {
    await params.telemetryStore.recordRateLimitEvent(rateLimitTelemetryEvent);
  } catch (err) {
    params.logger.warn(
      {
        ...params.baseLog,
        err,
        executionIdentity: rateLimitTelemetryEvent.executionIdentity,
        telemetryEventType: rateLimitTelemetryEvent.eventType,
      },
      "Rate-limit telemetry write failed (non-blocking)",
    );
  }
}

export async function resolveReviewAuthorContext(params: {
  authorLogin: string;
  authorDisplayName: string | null;
  authorAssociation: string;
  owner: string;
  repo: string;
  repoSlug: string;
  prNumber: number;
  deliveryId: string;
  eventType: string;
  octokit: ReviewOctokit;
  knowledgeStore?: KnowledgeStore;
  searchCache?: SearchCache<number>;
  contributorProfileStore?: ContributorProfileStore;
  slackBotToken?: string;
  telemetryEnabled: boolean;
  telemetryStore: Pick<TelemetryStore, "recordRateLimitEvent">;
  baseLog: Record<string, unknown>;
  logger: Pick<Logger, "info" | "warn">;
  resolveAuthor?: ResolveAuthorTier;
  suggestIdentity?: SuggestIdentityLink;
}): Promise<ReviewAuthorClassification> {
  const resolveAuthor = params.resolveAuthor ?? resolveAuthorTier;
  const suggestIdentity = params.suggestIdentity ?? suggestIdentityLink;
  let authorClassification = createDefaultAuthorClassification();

  try {
    authorClassification = await resolveAuthor({
      authorLogin: params.authorLogin,
      authorAssociation: params.authorAssociation,
      repo: params.repo,
      owner: params.owner,
      repoSlug: params.repoSlug,
      octokit: params.octokit,
      knowledgeStore: params.knowledgeStore,
      searchCache: params.searchCache,
      contributorProfileStore: params.contributorProfileStore,
      logger: params.logger as Logger,
    });
    logAuthorClassificationResolved({
      logger: params.logger,
      baseLog: params.baseLog,
      authorClassification,
    });
  } catch (err) {
    params.logger.warn(
      { ...params.baseLog, err },
      "Author classification failed (fail-open, using generic unknown contract)",
    );
  }

  await maybeSuggestIdentityLink({
    authorClassification,
    authorLogin: params.authorLogin,
    authorDisplayName: params.authorDisplayName,
    slackBotToken: params.slackBotToken,
    contributorProfileStore: params.contributorProfileStore,
    logger: params.logger,
    baseLog: params.baseLog,
    suggestIdentity,
  });

  await recordAuthorRateLimitTelemetry({
    authorClassification,
    telemetryEnabled: params.telemetryEnabled,
    telemetryStore: params.telemetryStore,
    deliveryId: params.deliveryId,
    repoSlug: params.repoSlug,
    prNumber: params.prNumber,
    eventType: params.eventType,
    logger: params.logger,
    baseLog: params.baseLog,
  });

  return authorClassification;
}
