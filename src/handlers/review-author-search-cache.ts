import type { Logger } from "pino";
import { createSearchCache, type SearchCache } from "../lib/search-cache.ts";

type ReviewAuthorSearchCacheLogger = Pick<Logger, "warn">;

export function resolveReviewAuthorPrCountSearchCache(params: {
  injectedSearchCache: SearchCache<number> | undefined;
  searchCacheFactory: (() => SearchCache<number>) | undefined;
  logger: ReviewAuthorSearchCacheLogger;
}): SearchCache<number> | undefined {
  if (params.injectedSearchCache) {
    return params.injectedSearchCache;
  }

  try {
    return params.searchCacheFactory
      ? params.searchCacheFactory()
      : createSearchCache<number>();
  } catch (err) {
    params.logger.warn(
      { err },
      "Search cache initialization failed (fail-open, continuing without search cache)",
    );
    return undefined;
  }
}
