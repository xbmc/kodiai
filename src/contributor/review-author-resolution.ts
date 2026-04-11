import type { Logger } from "pino";
import { classifyAuthor, type AuthorTier } from "../lib/author-classifier.ts";
import {
  isSearchRateLimitError,
  resolveRateLimitBackoffMs,
} from "../lib/review-utils.ts";
import {
  buildSearchCacheKey,
  type SearchCache,
} from "../lib/search-cache.ts";
import type { AuthorCacheEntry, AuthorCacheTier, KnowledgeStore } from "../knowledge/types.ts";
import type {
  ContributorExpertise,
  ContributorProfileStore,
} from "./types.ts";
import {
  classifyContributorProfileTrust,
  type ContributorProfileTrust,
} from "./profile-trust.ts";
import {
  projectContributorExperienceContract,
  type ContributorExperienceContract,
  type ContributorExperienceSource,
} from "./experience-contract.ts";

export type AuthorTierSearchEnrichment = {
  degraded: boolean;
  retryAttempts: number;
  skippedQueries: number;
  degradationPath: "none" | "search-api-rate-limit";
};

export type ReviewAuthorClassification = {
  tier: AuthorTier;
  prCount: number | null;
  fromCache: boolean;
  searchCacheHit: boolean;
  searchEnrichment: AuthorTierSearchEnrichment;
  contract: ContributorExperienceContract;
  expertise?: ContributorExpertise[];
  storedProfileTrust: ContributorProfileTrust | null;
  fallbackPath: string;
};

const AUTHOR_PR_COUNT_SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;

function normalizeAuthorCacheTier(
  value: string | null | undefined,
): AuthorCacheTier | null {
  if (value === "first-time" || value === "regular" || value === "core") {
    return value;
  }
  return null;
}

function normalizeAuthorCacheEntry(
  entry: AuthorCacheEntry | null | undefined,
): AuthorCacheEntry | null {
  if (!entry) {
    return null;
  }

  const normalizedTier = normalizeAuthorCacheTier(entry.tier);
  if (!normalizedTier) {
    return null;
  }

  return {
    ...entry,
    tier: normalizedTier,
  };
}

function normalizeContributorProfileTier(
  value: string | null | undefined,
): AuthorTier | null {
  if (
    value === "newcomer" ||
    value === "developing" ||
    value === "established" ||
    value === "senior"
  ) {
    return value;
  }
  return null;
}

function hasAssociationFallbackSignal(authorAssociation: string): boolean {
  return [
    "MEMBER",
    "OWNER",
    "FIRST_TIMER",
    "FIRST_TIME_CONTRIBUTOR",
    "COLLABORATOR",
    "CONTRIBUTOR",
  ].includes(authorAssociation);
}

async function executeSearchWithRateLimitRetry(params: {
  operation: () => Promise<number>;
  logger: Logger;
  authorLogin: string;
}): Promise<{ value: number | null; retryAttempts: number; degraded: boolean }> {
  const { operation, logger, authorLogin } = params;

  try {
    return {
      value: await operation(),
      retryAttempts: 0,
      degraded: false,
    };
  } catch (err) {
    if (!isSearchRateLimitError(err)) {
      throw err;
    }

    const backoffMs = resolveRateLimitBackoffMs(err);
    logger.warn(
      { err, authorLogin, backoffMs, retryAttempts: 1 },
      "Search API rate limit detected; retrying author-tier enrichment once",
    );

    if (backoffMs > 0) {
      await Bun.sleep(backoffMs);
    }

    try {
      return {
        value: await operation(),
        retryAttempts: 1,
        degraded: false,
      };
    } catch (retryErr) {
      if (!isSearchRateLimitError(retryErr)) {
        throw retryErr;
      }

      logger.warn(
        { err: retryErr, authorLogin, retryAttempts: 1 },
        "Search API remained rate-limited after one retry; degrading enrichment",
      );

      return {
        value: null,
        retryAttempts: 1,
        degraded: true,
      };
    }
  }
}

function resolveFallbackTarget(contract: ContributorExperienceContract): string {
  if (contract.state === "coarse-fallback") {
    return contract.source;
  }
  return contract.state;
}

function resolveFallbackPath(params: {
  contract: ContributorExperienceContract;
  storedProfileTrust: ContributorProfileTrust | null;
  hadStoredProfile: boolean;
  optedOut: boolean;
}): string {
  const { contract, storedProfileTrust, hadStoredProfile, optedOut } = params;

  if (optedOut) {
    return "opted-out-stored-profile";
  }

  if (contract.state === "profile-backed") {
    return "trusted-stored-profile";
  }

  const target = resolveFallbackTarget(contract);

  if (hadStoredProfile && storedProfileTrust) {
    return `stored-profile-${storedProfileTrust.state}->${target}`;
  }

  if (hadStoredProfile) {
    return `stored-profile-unknown->${target}`;
  }

  return `no-stored-profile->${target}`;
}

export async function resolveReviewAuthorClassification(params: {
  authorLogin: string;
  authorAssociation: string;
  repo: string;
  owner: string;
  repoSlug: string;
  searchIssuesAndPullRequests: (params: {
    q: string;
    per_page: number;
  }) => Promise<{ data: { total_count: number } }>;
  knowledgeStore?: Pick<KnowledgeStore, "getAuthorCache" | "upsertAuthorCache">;
  searchCache?: SearchCache<number>;
  contributorProfileStore?: ContributorProfileStore;
  logger: Logger;
  referenceTime?: Date;
}): Promise<ReviewAuthorClassification> {
  const {
    authorLogin,
    authorAssociation,
    repo,
    owner,
    repoSlug,
    searchIssuesAndPullRequests,
    knowledgeStore,
    searchCache,
    contributorProfileStore,
    logger,
    referenceTime,
  } = params;

  const searchEnrichment: AuthorTierSearchEnrichment = {
    degraded: false,
    retryAttempts: 0,
    skippedQueries: 0,
    degradationPath: "none",
  };
  let searchCacheHit = false;
  let storedProfileTrust: ContributorProfileTrust | null = null;
  let hadStoredProfile = false;
  let storedProfileOptedOut = false;

  if (contributorProfileStore) {
    try {
      const profile = await contributorProfileStore.getByGithubUsername(authorLogin, {
        includeOptedOut: true,
      });

      if (profile) {
        hadStoredProfile = true;
        storedProfileOptedOut = profile.optedOut;

        try {
          storedProfileTrust = classifyContributorProfileTrust(profile, {
            referenceTime,
          });
        } catch (trustErr) {
          logger.warn(
            { err: trustErr, authorLogin },
            "Stored contributor profile trust classification failed (fail-open)",
          );
          storedProfileTrust = null;
        }

        const normalizedProfileTier = normalizeContributorProfileTier(
          profile.overallTier,
        );

        if (profile.optedOut) {
          const contract = projectContributorExperienceContract({
            source: "contributor-profile",
            tier: normalizedProfileTier,
            optedOut: true,
          });

          return {
            tier: normalizedProfileTier ?? "regular",
            prCount: null,
            fromCache: false,
            searchCacheHit: false,
            searchEnrichment,
            contract,
            storedProfileTrust,
            fallbackPath: resolveFallbackPath({
              contract,
              storedProfileTrust,
              hadStoredProfile,
              optedOut: true,
            }),
          };
        }

        if (storedProfileTrust?.trusted && normalizedProfileTier) {
          try {
            const expertise = await contributorProfileStore.getExpertise(profile.id);
            const contract = projectContributorExperienceContract({
              source: "contributor-profile",
              tier: normalizedProfileTier,
            });

            return {
              tier: normalizedProfileTier,
              prCount: null,
              fromCache: false,
              searchCacheHit: false,
              searchEnrichment,
              contract,
              expertise,
              storedProfileTrust,
              fallbackPath: resolveFallbackPath({
                contract,
                storedProfileTrust,
                hadStoredProfile,
                optedOut: false,
              }),
            };
          } catch (err) {
            logger.warn(
              { err, authorLogin },
              "Contributor expertise lookup failed (fail-open)",
            );
          }
        } else if (profile.overallTier && !normalizedProfileTier) {
          logger.warn(
            { authorLogin, overallTier: profile.overallTier },
            "Ignoring malformed contributor profile tier; continuing with lower-confidence resolution",
          );
        }
      }
    } catch (err) {
      logger.warn({ err, authorLogin }, "Contributor profile lookup failed (fail-open)");
    }
  }

  let cached: AuthorCacheEntry | null = null;
  if (knowledgeStore) {
    try {
      const rawCached = await knowledgeStore.getAuthorCache?.({
        repo: repoSlug,
        authorLogin,
      });
      cached = normalizeAuthorCacheEntry(rawCached);
      if (rawCached && !cached) {
        logger.warn(
          { authorLogin, cachedTier: rawCached.tier },
          "Ignoring unsupported author cache tier; only fallback taxonomy tiers may be reused from cache",
        );
      }
    } catch (err) {
      logger.warn({ err, authorLogin }, "Author cache read failed (fail-open)");
    }
  }

  if (cached) {
    const contract = projectContributorExperienceContract({
      source: "author-cache",
      tier: cached.tier,
    });

    return {
      tier: cached.tier,
      prCount: cached.prCount ?? null,
      fromCache: true,
      searchCacheHit,
      searchEnrichment,
      contract,
      storedProfileTrust,
      fallbackPath: resolveFallbackPath({
        contract,
        storedProfileTrust,
        hadStoredProfile,
        optedOut: storedProfileOptedOut,
      }),
    };
  }

  const ambiguousAssociations = new Set([
    "NONE",
    "MANNEQUIN",
    "COLLABORATOR",
    "CONTRIBUTOR",
  ]);
  const normalizedAssociation = (authorAssociation || "NONE").toUpperCase();
  let prCount: number | null = null;
  let fallbackSource: ContributorExperienceSource = hasAssociationFallbackSignal(
    normalizedAssociation,
  )
    ? "author-association"
    : "none";

  if (ambiguousAssociations.has(normalizedAssociation)) {
    const query = `repo:${owner}/${repo} type:pr author:${authorLogin} is:merged`;

    const loadPrCount = async (): Promise<number> => {
      const { data } = await searchIssuesAndPullRequests({
        q: query,
        per_page: 1,
      });
      return data.total_count;
    };

    try {
      if (searchCache) {
        const cacheKey = buildSearchCacheKey({
          repo: repoSlug,
          searchType: "issuesAndPullRequests",
          query,
          extra: { per_page: 1 },
        });

        const searchOutcome = await executeSearchWithRateLimitRetry({
          operation: async () => {
            let loaderExecuted = false;
            const value = await searchCache.getOrLoad(
              cacheKey,
              async () => {
                loaderExecuted = true;
                return loadPrCount();
              },
              AUTHOR_PR_COUNT_SEARCH_CACHE_TTL_MS,
            );
            searchCacheHit = !loaderExecuted;
            return value;
          },
          logger,
          authorLogin,
        });

        searchEnrichment.retryAttempts += searchOutcome.retryAttempts;
        searchEnrichment.degraded = searchOutcome.degraded;
        prCount = searchOutcome.value;

        if (searchOutcome.degraded) {
          searchCacheHit = false;
        }
      } else {
        const searchOutcome = await executeSearchWithRateLimitRetry({
          operation: () => loadPrCount(),
          logger,
          authorLogin,
        });

        searchEnrichment.retryAttempts += searchOutcome.retryAttempts;
        searchEnrichment.degraded = searchOutcome.degraded;
        prCount = searchOutcome.value;
      }

      if (searchEnrichment.degraded) {
        searchEnrichment.skippedQueries = 1;
        searchEnrichment.degradationPath = "search-api-rate-limit";
      }
    } catch (err) {
      if (searchCache) {
        logger.warn(
          { err, authorLogin },
          "Author PR-count cache failed (fail-open, falling back to direct lookup)",
        );

        try {
          const searchOutcome = await executeSearchWithRateLimitRetry({
            operation: () => loadPrCount(),
            logger,
            authorLogin,
          });

          searchEnrichment.retryAttempts += searchOutcome.retryAttempts;
          searchEnrichment.degraded = searchOutcome.degraded;
          prCount = searchOutcome.value;

          if (searchEnrichment.degraded) {
            searchEnrichment.skippedQueries = 1;
            searchEnrichment.degradationPath = "search-api-rate-limit";
          }
        } catch (fallbackErr) {
          logger.warn(
            { err: fallbackErr, authorLogin },
            "Author PR count lookup failed (fail-open, proceeding without enrichment)",
          );
        }
      } else {
        logger.warn(
          { err, authorLogin },
          "Author PR count lookup failed (fail-open, proceeding without enrichment)",
        );
      }
    }

    if (prCount !== null || searchEnrichment.degraded) {
      fallbackSource = "github-search";
    }
  }

  const tier = classifyAuthor({
    authorAssociation: normalizedAssociation,
    prCount,
  }).tier;

  const contract = projectContributorExperienceContract({
    source: fallbackSource,
    tier: fallbackSource === "none" ? null : tier,
    degraded: searchEnrichment.degraded,
    degradationPath: searchEnrichment.degraded
      ? searchEnrichment.degradationPath
      : null,
  });

  if (knowledgeStore && contract.state === "coarse-fallback") {
    const cacheTier: AuthorCacheTier =
      tier === "core"
        ? "core"
        : tier === "regular"
          ? "regular"
          : "first-time";

    try {
      await knowledgeStore.upsertAuthorCache?.({
        repo: repoSlug,
        authorLogin,
        tier: cacheTier,
        authorAssociation: normalizedAssociation,
        prCount,
      });
    } catch (err) {
      logger.warn({ err, authorLogin }, "Author cache write failed (non-fatal)");
    }
  }

  return {
    tier,
    prCount,
    fromCache: false,
    searchCacheHit,
    searchEnrichment,
    contract,
    storedProfileTrust,
    fallbackPath: resolveFallbackPath({
      contract,
      storedProfileTrust,
      hadStoredProfile,
      optedOut: storedProfileOptedOut,
    }),
  };
}
