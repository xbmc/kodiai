import type { PromptBuildResult } from "../execution/prompt-section-metrics.ts";
import { buildSearchCacheKey, type SearchCache } from "../lib/search-cache.ts";
import {
  REVIEW_PROMPT_FINGERPRINT_VERSION,
  type ReviewPromptCacheState,
} from "../review-orchestration/review-prompt-cache-events.ts";

export type ReviewPromptCacheFingerprintResult = {
  fingerprint: string | null;
  missingSignals: string[];
};

export async function buildReviewPromptResultWithCache<Context extends { owner: string; repo: string }>(params: {
  cacheQuery: string;
  context: Context;
  statusTarget: ReviewPromptCacheState;
  promptBuilder: (context: Context) => PromptBuildResult | Promise<PromptBuildResult>;
  cache: SearchCache<PromptBuildResult>;
  getCacheErrorCount: () => number;
  buildFingerprint: (context: Context) => ReviewPromptCacheFingerprintResult;
  logger: {
    warn(fields: Record<string, unknown>, message?: string): void;
  };
}): Promise<PromptBuildResult> {
  const fingerprintResult = params.buildFingerprint(params.context);
  if (!fingerprintResult.fingerprint) {
    params.statusTarget.status = "bypass";
    params.statusTarget.reason = "incomplete-fingerprint";
    params.statusTarget.missingSignalNames = fingerprintResult.missingSignals;
    return params.promptBuilder(params.context);
  }

  const cacheKey = buildSearchCacheKey({
    repo: `${params.context.owner}/${params.context.repo}`,
    searchType: "review-derived-prompt",
    query: params.cacheQuery,
    extra: {
      fingerprint: fingerprintResult.fingerprint,
    },
  });

  const cacheErrorsBeforeLookup = params.getCacheErrorCount();
  let loaderExecuted = false;
  try {
    const result = await params.cache.getOrLoad(cacheKey, async () => {
      loaderExecuted = true;
      return params.promptBuilder(params.context);
    });
    const cacheErrorsAfterLookup = params.getCacheErrorCount();
    const cacheDegraded = cacheErrorsAfterLookup > cacheErrorsBeforeLookup;
    params.statusTarget.status = cacheDegraded ? "degraded" : loaderExecuted ? "miss" : "hit";
    params.statusTarget.reason = cacheDegraded ? "cache-bookkeeping-error" : null;
    params.statusTarget.fingerprintVersion = REVIEW_PROMPT_FINGERPRINT_VERSION;
    params.statusTarget.safetySignalNames = ["prompt-fingerprint-v1", "prompt-cache-query-head-sha"];
    if (cacheDegraded) {
      params.statusTarget.bookkeepingErrorCount = Math.max(1, cacheErrorsAfterLookup - cacheErrorsBeforeLookup);
    }
    return result;
  } catch (error) {
    params.statusTarget.status = "degraded";
    params.statusTarget.reason = "cache-bookkeeping-error";
    params.statusTarget.bookkeepingErrorCount = Math.max(1, params.getCacheErrorCount() - cacheErrorsBeforeLookup);
    params.logger.warn(
      {
        err: error,
        gate: "review-derived-prompt-cache",
        gateResult: "degraded",
        cacheQuery: params.cacheQuery,
      },
      "Review prompt cache lookup failed; rebuilding directly",
    );
    return params.promptBuilder(params.context);
  }
}
