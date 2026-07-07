import type { Logger } from "pino";
import type { ReviewWorkCoordinator } from "../jobs/review-work-coordinator.ts";
import type { PromptBuildResult } from "../execution/prompt-section-metrics.ts";
import { createGuardrailAuditStore, type GuardrailAuditStore } from "../lib/guardrail/audit-store.ts";
import { createSearchCache, type SearchCache, type SearchCacheOptions } from "../lib/search-cache.ts";
import { createStructuralImpactCache, type StructuralImpactCache } from "../structural-impact/cache.ts";
import { resolveReviewWorkCoordinator } from "./review-work-coordinator-fallback.ts";
import { resolveReviewAuthorPrCountSearchCache } from "./review-author-search-cache.ts";

export type ReviewPromptDerivedCacheOptions = Pick<
  SearchCacheOptions<PromptBuildResult>,
  "ttlMs" | "maxSize" | "now" | "store" | "inFlightStore"
>;

export type ReviewHandlerRuntime = {
  guardrailAuditStore: GuardrailAuditStore | undefined;
  structuralImpactCache: StructuralImpactCache;
  reviewWorkCoordinator: ReviewWorkCoordinator;
  reviewPromptDerivedCache: SearchCache<PromptBuildResult>;
  getReviewPromptDerivedCacheErrorCount: () => number;
  authorPrCountSearchCache: SearchCache<number> | undefined;
};

export function createReviewHandlerRuntime(params: {
  sql?: import("../db/client.ts").Sql;
  reviewWorkCoordinator?: ReviewWorkCoordinator;
  injectedSearchCache?: SearchCache<number>;
  searchCacheFactory?: () => SearchCache<number>;
  reviewPromptDerivedCacheOptions?: ReviewPromptDerivedCacheOptions;
  logger: Logger;
}): ReviewHandlerRuntime {
  const guardrailAuditStore = params.sql ? createGuardrailAuditStore(params.sql) : undefined;
  const structuralImpactCache = createStructuralImpactCache();
  const reviewWorkCoordinator = resolveReviewWorkCoordinator({
    injected: params.reviewWorkCoordinator,
    handler: "review",
    logger: params.logger,
  });

  let reviewPromptDerivedCacheErrorCount = 0;
  const reviewPromptDerivedCache = createSearchCache<PromptBuildResult>({
    ...params.reviewPromptDerivedCacheOptions,
    onError: (error) => {
      reviewPromptDerivedCacheErrorCount += 1;
      params.logger.warn(
        {
          err: error,
          gate: "review-derived-prompt-cache",
          gateResult: "degraded",
        },
        "Review derived prompt cache degraded; bypassing cache for this request",
      );
    },
  });

  const authorPrCountSearchCache = resolveReviewAuthorPrCountSearchCache({
    injectedSearchCache: params.injectedSearchCache,
    searchCacheFactory: params.searchCacheFactory,
    logger: params.logger,
  });

  return {
    guardrailAuditStore,
    structuralImpactCache,
    reviewWorkCoordinator,
    reviewPromptDerivedCache,
    getReviewPromptDerivedCacheErrorCount: () => reviewPromptDerivedCacheErrorCount,
    authorPrCountSearchCache,
  };
}
