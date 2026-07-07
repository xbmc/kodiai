import type { GitHubApp } from "../auth/github-app.ts";
import type { createExecutor } from "../execution/executor.ts";
import type { ForkManager } from "../jobs/fork-manager.ts";
import type { GistPublisher } from "../jobs/gist-publisher.ts";
import type { JobQueue, WorkspaceManager } from "../jobs/types.ts";
import type { ReviewWorkCoordinator } from "../jobs/review-work-coordinator.ts";
import type { KnowledgeStore } from "../knowledge/types.ts";
import type { createRetriever } from "../knowledge/retrieval.ts";
import type { TelemetryStore } from "../telemetry/types.ts";
import type { EventRouter, WebhookEvent } from "../webhook/types.ts";
import type { Logger } from "pino";
import type { Sql } from "../db/client.ts";
import type { MentionDerivedContextCacheOptions } from "./mention-handler-runtime.ts";
import type { runFormatterSuggestionSubflow } from "./formatter-suggestion-orchestration.ts";

export type MentionHandlerDependencies = {
  eventRouter: EventRouter;
  jobQueue: JobQueue;
  workspaceManager: WorkspaceManager;
  githubApp: GitHubApp;
  executor: ReturnType<typeof createExecutor>;
  telemetryStore: TelemetryStore;
  knowledgeStore?: KnowledgeStore;
  retriever?: ReturnType<typeof createRetriever>;
  /** Fork manager for fork-based write mode (Phase 127). */
  forkManager?: ForkManager;
  /** Gist publisher for patch output mode (Phase 127). */
  gistPublisher?: GistPublisher;
  /** Optional SQL client for guardrail audit logging (GUARD-06). */
  sql?: Sql;
  /** Optional in-memory coordinator for same-PR review-family publish rights. */
  reviewWorkCoordinator?: ReviewWorkCoordinator;
  /** Optional derived-context cache store overrides for mention-context reuse tests/fail-open wiring. */
  mentionDerivedContextCacheOptions?: MentionDerivedContextCacheOptions;
  /** Optional formatter-suggestion subflow override for mention orchestration tests. */
  formatterSuggestionSubflow?: typeof runFormatterSuggestionSubflow;
  /** Optional addon-review dispatcher override for addon-repo explicit review routing tests. */
  addonReviewDispatcher?: (event: WebhookEvent) => Promise<void>;
  /** Configured addon repositories that should route `@kodiai review` to addon-rule review. */
  addonRepos?: readonly string[];
  logger: Logger;
};
