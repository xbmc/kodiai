import type { Logger } from "pino";
import type { ReviewWorkCoordinator } from "../jobs/review-work-coordinator.ts";
import type { PromptBuildResult } from "../execution/prompt-section-metrics.ts";
import { createGuardrailAuditStore, type GuardrailAuditStore } from "../lib/guardrail/audit-store.ts";
import { createSearchCache, type SearchCache, type SearchCacheOptions } from "../lib/search-cache.ts";
import {
  createConversationTurnStore,
  createTriageCooldownStore,
  createWriteRateLimitStore,
  type ConversationTurnStore,
  type TriageCooldownStore,
  type WriteRateLimitStore,
} from "../lib/mention-state-stores.ts";
import { resolveReviewWorkCoordinator } from "./review-work-coordinator-fallback.ts";

export type MentionDerivedContextCacheOptions = Pick<
  SearchCacheOptions<PromptBuildResult>,
  "ttlMs" | "maxSize" | "now" | "store" | "inFlightStore"
>;

export type MentionHandlerRuntime = {
  guardrailAuditStore: GuardrailAuditStore | undefined;
  reviewWorkCoordinator: ReviewWorkCoordinator;
  mentionDerivedContextCache: SearchCache<PromptBuildResult>;
  getMentionDerivedContextCacheErrorCount: () => number;
  writeRateLimitStore: WriteRateLimitStore;
  conversationTurnStore: ConversationTurnStore;
  inFlightWriteKeys: Set<string>;
  triageCooldownStore: TriageCooldownStore;
};

export function createMentionHandlerRuntime(params: {
  sql?: import("../db/client.ts").Sql;
  reviewWorkCoordinator?: ReviewWorkCoordinator;
  mentionDerivedContextCacheOptions?: MentionDerivedContextCacheOptions;
  logger: Logger;
}): MentionHandlerRuntime {
  const guardrailAuditStore = params.sql ? createGuardrailAuditStore(params.sql) : undefined;
  const reviewWorkCoordinator = resolveReviewWorkCoordinator({
    injected: params.reviewWorkCoordinator,
    handler: "mention",
    logger: params.logger,
  });

  let mentionDerivedContextCacheErrorCount = 0;
  const mentionDerivedContextCache = createSearchCache<PromptBuildResult>({
    ...params.mentionDerivedContextCacheOptions,
    onError: (error) => {
      mentionDerivedContextCacheErrorCount += 1;
      params.logger.warn(
        {
          err: error,
          gate: "mention-derived-context-cache",
          gateResult: "degraded",
        },
        "Mention derived-context cache degraded; bypassing cache for this request",
      );
    },
  });

  return {
    guardrailAuditStore,
    reviewWorkCoordinator,
    mentionDerivedContextCache,
    getMentionDerivedContextCacheErrorCount: () => mentionDerivedContextCacheErrorCount,
    writeRateLimitStore: createWriteRateLimitStore(),
    conversationTurnStore: createConversationTurnStore(),
    inFlightWriteKeys: new Set<string>(),
    triageCooldownStore: createTriageCooldownStore(),
  };
}
