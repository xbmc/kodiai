import type { Logger } from "pino";
import type { GitHubApp } from "../auth/github-app.ts";
import type { ContributorProfileStore } from "../contributor/types.ts";
import type { createExecutor } from "../execution/executor.ts";
import { buildReviewPromptDetails } from "../execution/review-prompt.ts";
import type { JobQueue, WorkspaceManager } from "../jobs/types.ts";
import type { ReviewWorkCoordinator } from "../jobs/review-work-coordinator.ts";
import { fetchRemoteTrackingBranch } from "../jobs/workspace.ts";
import type { CodeSnippetStore } from "../knowledge/code-snippet-types.ts";
import type { ClusterPatternMatch } from "../knowledge/cluster-types.ts";
import type { IssueStore } from "../knowledge/issue-types.ts";
import type { createRetriever } from "../knowledge/retrieval.ts";
import type { SuggestionClusterStore } from "../knowledge/suggestion-cluster-store.ts";
import type { EmbeddingProvider, KnowledgeStore, LearningMemoryStore } from "../knowledge/types.ts";
import type { analyzePackageUsage } from "../lib/usage-analyzer.ts";
import type { detectScopeCoordination } from "../lib/scope-coordinator.ts";
import type { SearchCache } from "../lib/search-cache.ts";
import { collectDiffContext } from "../review-orchestration/review-diff-collection.ts";
import { buildReviewPlan, type ReviewPlanBuilder } from "../review-orchestration/review-plan.ts";
import type { ReviewGraphBlastRadiusResult } from "../review-graph/query.ts";
import {
  reduceReviewFindings,
  type ReviewReducerInput,
  type ReviewReducerResult,
} from "../review-orchestration/review-reducer.ts";
import type {
  ShadowSpecialistSubflowInput,
  ShadowSpecialistSubflowResult,
} from "../specialists/shadow-specialist-subflow.ts";
import { runShadowSpecialistSubflow } from "../specialists/shadow-specialist-subflow.ts";
import type { TelemetryStore } from "../telemetry/types.ts";
import type { EventRouter } from "../webhook/types.ts";
import type { ReviewPromptDerivedCacheOptions } from "./review-handler-runtime.ts";

export type ReviewReducer = (input: ReviewReducerInput) => Promise<ReviewReducerResult>;

export type ReviewHandlerDependencies = {
  eventRouter: EventRouter;
  jobQueue: JobQueue;
  workspaceManager: WorkspaceManager;
  githubApp: GitHubApp;
  executor: ReturnType<typeof createExecutor>;
  telemetryStore: TelemetryStore;
  knowledgeStore?: KnowledgeStore;
  learningMemoryStore?: LearningMemoryStore;
  embeddingProvider?: EmbeddingProvider;
  retriever?: ReturnType<typeof createRetriever>;
  /** Configured repositories handled by the specialized Kodi add-on reviewer. */
  addonRepos?: readonly string[];
  /** Optional injection for deterministic tests. */
  usageAnalyzer?: { analyzePackageUsage: typeof analyzePackageUsage };
  /** Optional injection for deterministic tests. */
  scopeCoordinator?: { detectScopeCoordination: typeof detectScopeCoordination };
  /** Optional injection for deterministic tests. */
  searchCache?: SearchCache<number>;
  /** Optional injection for deterministic tests. */
  searchCacheFactory?: () => SearchCache<number>;
  /** Optional derived prompt cache store overrides for review prompt reuse tests/fail-open wiring. */
  reviewPromptDerivedCacheOptions?: ReviewPromptDerivedCacheOptions;
  /** Optional prompt builder override for review prompt reuse tests. */
  reviewPromptBuilder?: typeof buildReviewPromptDetails;
  /** Optional code snippet store for hunk embedding. */
  codeSnippetStore?: CodeSnippetStore;
  /** Optional contributor profile store for 4-tier expertise-based reviews. */
  contributorProfileStore?: ContributorProfileStore;
  /** Optional Slack bot token for identity suggestion DMs. */
  slackBotToken?: string;
  /** Optional cluster pattern matcher (Phase 100: CLST-03). */
  clusterMatcher?: (opts: { prEmbedding: Float32Array | null; prFilePaths: string[]; repo: string }) => Promise<ClusterPatternMatch[]>;
  /** Optional issue store for PR-issue linking (Phase 108: PRLINK). */
  issueStore?: IssueStore;
  /** Optional review-graph blast-radius query for graph-aware large-PR selection. */
  reviewGraphQuery?: (input: {
    repo: string;
    workspaceKey: string;
    changedPaths: string[];
    limit?: number;
  }) => Promise<ReviewGraphBlastRadiusResult>;
  /** Optional SQL client for guardrail audit logging (GUARD-06). */
  sql?: import("../db/client.ts").Sql;
  /** Optional in-memory coordinator for same-PR review-family publish rights. */
  reviewWorkCoordinator?: ReviewWorkCoordinator;
  /** Optional cluster model store for thematic finding scoring (M037/S02). */
  clusterModelStore?: SuggestionClusterStore;
  /** Optional base-branch fetch override for deterministic tests. */
  fetchRemoteTrackingBranchFn?: typeof fetchRemoteTrackingBranch;
  /** Optional diff context collector for deterministic tests and bounded fallback behavior. */
  diffContextCollector?: typeof collectDiffContext;
  /** Optional same-job read-only shadow specialist subflow; fail-open and private by contract. */
  shadowSpecialistSubflow?: (input: ShadowSpecialistSubflowInput) => Promise<ShadowSpecialistSubflowResult>;
  /** Optional review plan builder override for fail-open contract tests. */
  reviewPlanBuilder?: ReviewPlanBuilder;
  /** Optional review reducer override for fail-open contract tests. */
  reviewReducer?: ReviewReducer;
  logger: Logger;
};

export type ResolvedReviewHandlerDependencies = ReviewHandlerDependencies & Required<Pick<
  ReviewHandlerDependencies,
  | "reviewPromptBuilder"
  | "fetchRemoteTrackingBranchFn"
  | "diffContextCollector"
  | "shadowSpecialistSubflow"
  | "reviewPlanBuilder"
  | "reviewReducer"
>>;

export function resolveReviewHandlerDependencies(
  deps: ReviewHandlerDependencies,
): ResolvedReviewHandlerDependencies {
  return {
    ...deps,
    reviewPromptBuilder: deps.reviewPromptBuilder ?? buildReviewPromptDetails,
    fetchRemoteTrackingBranchFn: deps.fetchRemoteTrackingBranchFn ?? fetchRemoteTrackingBranch,
    diffContextCollector: deps.diffContextCollector ?? collectDiffContext,
    shadowSpecialistSubflow: deps.shadowSpecialistSubflow ?? runShadowSpecialistSubflow,
    reviewPlanBuilder: deps.reviewPlanBuilder ?? buildReviewPlan,
    reviewReducer: deps.reviewReducer ?? reduceReviewFindings,
  };
}
