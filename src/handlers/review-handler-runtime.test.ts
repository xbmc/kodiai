import { describe, expect, test } from "bun:test";
import { createReviewWorkCoordinator } from "../jobs/review-work-coordinator.ts";
import { createSearchCache } from "../lib/search-cache.ts";
import { createReviewHandlerRuntime } from "./review-handler-runtime.ts";

function makeLogger() {
  const warnings: Array<{ bindings: Record<string, unknown>; message: string }> = [];
  return {
    warnings,
    logger: {
      warn(bindings: Record<string, unknown>, message: string) {
        warnings.push({ bindings, message });
      },
    },
  };
}

describe("createReviewHandlerRuntime", () => {
  test("centralizes review runtime caches and derived-prompt cache error accounting", async () => {
    const { logger, warnings } = makeLogger();
    const injectedAuthorCache = createSearchCache<number>();
    const injectedCoordinator = createReviewWorkCoordinator();
    const runtime = createReviewHandlerRuntime({
      logger: logger as never,
      reviewWorkCoordinator: injectedCoordinator,
      injectedSearchCache: injectedAuthorCache,
      reviewPromptDerivedCacheOptions: {
        store: {
          get: () => {
            throw new Error("prompt cache unavailable");
          },
          set: () => undefined,
          purgeExpired: () => 0,
        },
      },
    });

    expect(runtime.reviewWorkCoordinator).toBe(injectedCoordinator);
    expect(runtime.authorPrCountSearchCache).toBe(injectedAuthorCache);
    expect(runtime.getReviewPromptDerivedCacheErrorCount()).toBe(0);

    await expect(runtime.reviewPromptDerivedCache.getOrLoad(
      "review-prompt-key",
      async () => ({ text: "prompt", sections: [] }),
    )).resolves.toEqual({ text: "prompt", sections: [] });

    expect(runtime.getReviewPromptDerivedCacheErrorCount()).toBe(1);
    expect(warnings).toEqual([
      {
        bindings: {
          err: expect.any(Error),
          gate: "review-derived-prompt-cache",
          gateResult: "degraded",
        },
        message: "Review derived prompt cache degraded; bypassing cache for this request",
      },
    ]);
    expect(runtime.structuralImpactCache).toBeDefined();
    expect(runtime.guardrailAuditStore).toBeUndefined();
  });
});
