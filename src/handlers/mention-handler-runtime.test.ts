import { describe, expect, test } from "bun:test";
import { createReviewWorkCoordinator } from "../jobs/review-work-coordinator.ts";
import { createMentionHandlerRuntime } from "./mention-handler-runtime.ts";

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

describe("createMentionHandlerRuntime", () => {
  test("centralizes handler-local stores and derived-context cache error accounting", async () => {
    const { logger, warnings } = makeLogger();
    const runtime = createMentionHandlerRuntime({
      logger: logger as never,
      reviewWorkCoordinator: createReviewWorkCoordinator(),
      mentionDerivedContextCacheOptions: {
        store: {
          get: () => {
            throw new Error("cache unavailable");
          },
          set: () => undefined,
          purgeExpired: () => 0,
        },
      },
    });

    expect(runtime.getMentionDerivedContextCacheErrorCount()).toBe(0);
    await expect(runtime.mentionDerivedContextCache.getOrLoad(
      "key",
      async () => ({ text: "value", sections: [] }),
    )).resolves.toEqual({ text: "value", sections: [] });

    expect(runtime.getMentionDerivedContextCacheErrorCount()).toBe(1);
    expect(warnings).toEqual([
      {
        bindings: {
          err: expect.any(Error),
          gate: "mention-derived-context-cache",
          gateResult: "degraded",
        },
        message: "Mention derived-context cache degraded; bypassing cache for this request",
      },
    ]);

    runtime.writeRateLimitStore.recordWrite("install:owner/repo");
    expect(typeof runtime.writeRateLimitStore.getLastWriteAt("install:owner/repo")).toBe("number");

    expect(runtime.conversationTurnStore.recordSuccessfulTurn("owner/repo#1")).toBe(1);
    expect(runtime.conversationTurnStore.getTurns("owner/repo#1")).toBe(1);

    runtime.triageCooldownStore.set("owner/repo#2", { lastTriagedAt: 123, bodyHash: "abc" });
    expect(runtime.triageCooldownStore.get("owner/repo#2")).toEqual({ lastTriagedAt: 123, bodyHash: "abc" });

    runtime.inFlightWriteKeys.add("write-key");
    expect(runtime.inFlightWriteKeys.has("write-key")).toBe(true);
  });
});
