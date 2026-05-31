import type { Logger } from "pino";
import type { GitHubApp } from "../auth/github-app.ts";
import type { AuthorTier } from "../lib/author-classifier.ts";
import {
  resolveReviewAuthorClassification,
  type ReviewAuthorClassification,
} from "../contributor/review-author-resolution.ts";
import type { AuthorCacheTier, KnowledgeStore } from "../knowledge/types.ts";
import type { ContributorProfileStore } from "../contributor/types.ts";
import type { SearchCache } from "../lib/search-cache.ts";

export function resolveAuthorTierFromSources(params: {
  contributorTier?: AuthorTier | null;
  cachedTier?: AuthorCacheTier | null;
  fallbackTier: AuthorTier;
}): { tier: AuthorTier; source: "contributor-profile" | "author-cache" | "fallback" } {
  const { contributorTier, cachedTier, fallbackTier } = params;

  if (contributorTier) {
    return { tier: contributorTier, source: "contributor-profile" };
  }

  if (cachedTier) {
    return { tier: cachedTier, source: "author-cache" };
  }

  return { tier: fallbackTier, source: "fallback" };
}

export function resolveAuthorTier(params: {
  authorLogin: string;
  authorAssociation: string;
  repo: string;
  owner: string;
  repoSlug: string;
  octokit: Awaited<ReturnType<GitHubApp["getInstallationOctokit"]>>;
  knowledgeStore?: KnowledgeStore;
  searchCache?: SearchCache<number>;
  contributorProfileStore?: ContributorProfileStore;
  logger: Logger;
}): Promise<ReviewAuthorClassification> {
  const {
    authorLogin,
    authorAssociation,
    repo,
    owner,
    repoSlug,
    octokit,
    knowledgeStore,
    searchCache,
    contributorProfileStore,
    logger,
  } = params;

  return resolveReviewAuthorClassification({
    authorLogin,
    authorAssociation,
    repo,
    owner,
    repoSlug,
    searchIssuesAndPullRequests: (searchParams) =>
      octokit.rest.search.issuesAndPullRequests(searchParams),
    knowledgeStore,
    searchCache,
    contributorProfileStore,
    logger,
  });
}
