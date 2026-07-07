import type { Logger } from "pino";
import type { EventRouter, WebhookEvent } from "../webhook/types.ts";
import type { JobQueue, WorkspaceManager, Workspace } from "../jobs/types.ts";
import type { ReviewWorkCoordinator } from "../jobs/review-work-coordinator.ts";
import type { GitHubApp } from "../auth/github-app.ts";
import type { createExecutor } from "../execution/executor.ts";
import type { TelemetryStore } from "../telemetry/types.ts";
import type { KnowledgeStore } from "../knowledge/types.ts";
import type { createRetriever } from "../knowledge/retrieval.ts";
import type { ForkManager } from "../jobs/fork-manager.ts";
import type { GistPublisher } from "../jobs/gist-publisher.ts";
import { fetchAllPullRequestFiles } from "../lib/github-pr-files.ts";
import { resolveMentionClonePlan } from "./mention-clone-plan.ts";
import {
  runFormatterSuggestionSubflow,
} from "./formatter-suggestion-orchestration.ts";
import {
  createMentionPublisher,
} from "./mention-publication.ts";
import { handleMentionHandlerFailureRecovery } from "./mention-handler-failure-recovery.ts";
import {
  createMentionWorkspaceRuntime,
} from "./mention-workspace-runtime.ts";
import { createMentionWorkspacePhaseHooks } from "./mention-workspace-phase-hooks.ts";
import { createMentionReviewWorkSession } from "./mention-review-work-session.ts";
import { createMentionFindingLookup } from "./mention-finding-context.ts";
import { resolveMentionTriggerContext } from "./mention-trigger-context.ts";
import { resolveMentionPromptRuntimeContext } from "./mention-prompt-runtime.ts";
import { publishFormatOnlyMentionFormatterResult } from "./mention-format-only-publication.ts";
import { createMentionHandlerRuntime, type MentionDerivedContextCacheOptions } from "./mention-handler-runtime.ts";
import { cleanupMentionExecutionResources } from "./mention-execution-cleanup.ts";
import { buildMentionJobQueueContext } from "./mention-job-context.ts";
import { createMentionFormatterRuntime } from "./mention-formatter-runtime.ts";
import { runMentionPrePromptGates } from "./mention-pre-prompt-gates.ts";
import { prepareMentionPromptInputs } from "./mention-prompt-preparation.ts";
import { runMentionExecutorDispatchPhase } from "./mention-executor-dispatch-phase.ts";
import { prepareMentionRequestExecutionContext } from "./mention-request-preparation.ts";
import { buildMentionSetupOctokitAdapters } from "./mention-setup-octokit.ts";
import {
  buildMentionPostExecutorPublicationAdapters,
  publishMentionPostExecutorOutputs,
} from "./mention-post-executor-publication.ts";

const FORMATTER_REVIEW_OUTPUT_ACTION = "mention-format-suggestions";




/**
 * Create the mention handler and register it with the event router.
 *
 * Handles @kodiai mentions across all four comment surfaces:
 * - issue_comment.created (issues and PR general comments)
 * - pull_request_review_comment.created (inline diff comments)
 * - pull_request_review.submitted (review body)
 */
export function createMentionHandler(deps: {
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
  sql?: import("../db/client.ts").Sql;
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
}): void {
  const {
    eventRouter,
    jobQueue,
    workspaceManager,
    githubApp,
    executor,
    telemetryStore,
    retriever,
    forkManager,
    gistPublisher,
    sql,
    reviewWorkCoordinator: injectedReviewWorkCoordinator,
    mentionDerivedContextCacheOptions,
    formatterSuggestionSubflow = runFormatterSuggestionSubflow,
    addonReviewDispatcher = (addonEvent: WebhookEvent) => eventRouter.dispatch(addonEvent),
    addonRepos = [],
    logger,
  } = deps;

  const {
    guardrailAuditStore,
    reviewWorkCoordinator,
    mentionDerivedContextCache,
    getMentionDerivedContextCacheErrorCount,
    writeRateLimitStore,
    conversationTurnStore,
    inFlightWriteKeys,
    triageCooldownStore,
  } = createMentionHandlerRuntime({
    sql,
    reviewWorkCoordinator: injectedReviewWorkCoordinator,
    mentionDerivedContextCacheOptions,
    logger,
  });



  async function handleMention(event: WebhookEvent): Promise<void> {
    const appSlug = githubApp.getAppSlug();
    const triggerContext = resolveMentionTriggerContext({ event, appSlug });
    if (triggerContext.action === "skip") {
      if (triggerContext.reason === "self-authored") {
        logger.debug(
          triggerContext.logContext,
          "Skipping mention from self (comment-author defense)",
        );
      }
      return;
    }

    // No tracking comment. Tracking is via eyes reaction only.
    // The response will be posted as a new comment.
    const {
      mention,
      possibleHandles,
      eventAction: action,
      reviewPrNumber,
      isExplicitReviewRequest,
      mentionQueueKey,
    } = triggerContext;
    const reviewWorkSession = createMentionReviewWorkSession({
      coordinator: reviewWorkCoordinator,
      mention,
      reviewPrNumber,
      isExplicitReviewRequest,
      deliveryId: event.id,
      appSlug,
      logger,
    });
    const {
      runtime: reviewWorkRuntime,
      reviewWorkAttempt,
      explicitReviewUsesCanonicalHandle,
      setReviewWorkPhase,
      canPublishExplicitReviewOutput,
    } = reviewWorkSession;

    try {
      await jobQueue.enqueue(event.installationId, async () => {
      let workspace: Workspace | undefined;
      let acquiredWriteKey: string | undefined;
      let explicitReviewRequest = false;
      let reviewOutputKey: string | undefined;

      try {
        const mentionSetupOctokitAdapters = buildMentionSetupOctokitAdapters({
          installationId: event.installationId,
          getInstallationOctokit: (installationId) => githubApp.getInstallationOctokit(installationId),
        });
        const octokit = await mentionSetupOctokitAdapters.getOctokit();
        const { postMentionReply, postMentionError } = createMentionPublisher({
          octokit,
          mention,
          possibleHandles,
          logger,
          guardrailAuditStore,
        });

        const {
          cloneOwner,
          cloneRepo,
          cloneRef,
          cloneDepth,
          usesPrRef,
          workspaceStrategy,
        } = await resolveMentionClonePlan({
          mention,
          payload: event.payload as Record<string, unknown>,
          octokit,
        });

        const workspacePhaseHooks = createMentionWorkspacePhaseHooks({
          explicitReviewUsesCanonicalHandle,
          setReviewWorkPhase,
        });
        const workspaceRuntime = await createMentionWorkspaceRuntime({
          workspaceManager,
          installationId: event.installationId,
          forkManager,
          appSlug,
          mention,
          cloneOwner,
          cloneRepo,
          cloneRef,
          cloneDepth,
          usesPrRef,
          workspaceStrategy,
          writeRateLimitStore,
          beforeLoadConfig: workspacePhaseHooks.beforeLoadConfig,
          logger,
        });
        workspace = workspaceRuntime.workspace;
        const {
          forkContext,
          config,
          writeRateLimit,
        } = workspaceRuntime;

        const findingLookup = createMentionFindingLookup(deps.knowledgeStore);

        const mentionRequestPreparation = await prepareMentionRequestExecutionContext({
          event,
          appSlug,
          mention,
          config,
          addonRepos,
          getPullRequest: (args) => octokit.rest.pulls.get(args),
          dispatchAddonReview: addonReviewDispatcher,
          logger,
        });
        if (mentionRequestPreparation.action === "stop") return;
        const {
          acceptClaudeAlias,
          acceptedHandles,
          userQuestion,
          formatterSuggestionRequest,
          mentionWriteRequestContext,
        } = mentionRequestPreparation;
        const {
          isIssueThreadComment,
          isPrSurface,
          writeIntent,
          isWriteRequest,
          isPlanOnly,
          writeEnabled,
          writeKeyword,
          retryCommand,
          triggerCommentUrl,
          writeBranchName,
          writeOutputKey,
          writeSource,
        } = mentionWriteRequestContext;
        explicitReviewRequest = mentionWriteRequestContext.explicitReviewRequest;

        const {
          runFormatterSuggestionForMention,
          postFormatterVisibleDiagnostic,
        } = createMentionFormatterRuntime({
          workspace,
          mention,
          formatterCommand: config.review.formatterSuggestions.command,
          maxSuggestions: config.review.formatterSuggestions.maxSuggestions,
          installationId: event.installationId,
          deliveryId: event.id,
          reviewOutputAction: FORMATTER_REVIEW_OUTPUT_ACTION,
          octokit,
          botHandles: possibleHandles,
          postReply: postMentionReply,
          logger,
          formatterSuggestionSubflow,
        });

        const formatOnlyPublication = await publishFormatOnlyMentionFormatterResult({
          isPrSurface,
          formatterSuggestionMode: formatterSuggestionRequest?.mode,
          runFormatterSuggestionForMention,
          postFormatterVisibleDiagnostic,
          mention,
          deliveryId: event.id,
          reviewOutputAction: FORMATTER_REVIEW_OUTPUT_ACTION,
          logger,
        });
        if (!formatOnlyPublication.ok) {
          throw formatOnlyPublication.err.error;
        }
        if (formatOnlyPublication.value.handled) {
          return;
        }

        const prePromptGates = await runMentionPrePromptGates({
          writeEnabled,
          writeOutputKey,
          writeBranchName,
          octokit,
          mention,
          deliveryId: event.id,
          installationId: event.installationId,
          triggerCommentUrl,
          inFlightWriteKeys,
          writeRateLimit,
          postMentionReply,
          logger,
          isWriteRequest,
          isIssueThreadComment,
          isPlanOnly,
          writeConfigEnabled: config.write.enabled,
          writeIntentKeyword: writeIntent.keyword,
          writeKeyword,
          writeRequest: writeIntent.request,
          appSlug,
          maxTurnsPerPr: config.mention.conversation.maxTurnsPerPr,
          getConversationTurns: (key) => conversationTurnStore.getTurns(key),
          acceptClaudeAlias,
        });
        acquiredWriteKey = prePromptGates.acquiredWriteKey;
        if (prePromptGates.action === "stop") return;

        const {
          mentionContext,
          mentionContextSectionMetrics,
          mentionDerivedContextCacheStatus,
          mentionDerivedContextCacheReason,
          retrievalContext,
          unifiedResultsForPrompt,
          contextWindowForPrompt,
          reviewPrecedentsForPrompt,
          wikiKnowledgeForPrompt,
          planOnlyInstructions,
          writeInstructions,
          triageContext,
          findingContext,
          prDiffContext,
        } = await prepareMentionPromptInputs({
          octokit,
          mention,
          explicitReviewRequest,
          config,
          findingLookup,
          mentionDerivedContextCache,
          getMentionDerivedContextCacheErrorCount,
          retriever,
          telemetryStore,
          deliveryId: event.id,
          workspaceDir: workspace.dir,
          writeRequest: writeIntent.request,
          isIssueThreadComment,
          isPlanOnly,
          isWriteRequest,
          writeEnabled,
          triageCooldownStore,
          logger,
        });

        setReviewWorkPhase("prompt-build");
        const mentionPromptRuntime = await resolveMentionPromptRuntimeContext({
          explicitReviewRequest,
          mention,
          config,
          deliveryId: event.id,
          workspaceDir: workspace.dir,
          workspaceToken: workspace.token,
          retrievalContext,
          reviewPrecedents: reviewPrecedentsForPrompt,
          wikiKnowledge: wikiKnowledgeForPrompt,
          unifiedResults: unifiedResultsForPrompt,
          contextWindow: contextWindowForPrompt,
          logger,
          getPullRequest: async (args) => {
            const { data } = await octokit.rest.pulls.get(args);
            return data;
          },
          fetchPullRequestFiles: async (args) => await fetchAllPullRequestFiles({
            octokit,
            owner: args.owner,
            repo: args.repo,
            pullNumber: args.pullNumber,
          }),
          mentionContext,
          mentionContextSectionMetrics,
          userQuestion: writeIntent.request,
          findingContext,
          planOnlyInstructions,
          writeInstructions,
          outputLanguage: config.review.outputLanguage,
          triageContext,
          prDiffContext,
        });
        const {
          prompt,
          promptSections,
          explicitReviewPromptFileCount,
          explicitReviewDynamicTimeoutSeconds,
          explicitReviewMaxTurnsOverride,
          explicitReviewPrDiffCommentabilityIndex,
          explicitReviewHeadSha,
          explicitReviewBaseSha,
          explicitReviewRouting,
        } = mentionPromptRuntime;

        // Execute via Claude. Combined review-and-format requests run Claude first so
        // formatter workspace mutations cannot affect review prompt/executor context;
        // if Claude throws, the formatter subflow still gets an independent attempt.
        const mentionExecutorDispatch = await runMentionExecutorDispatchPhase({
          executor,
          workspace,
          installationId: event.installationId,
          deliveryId: event.id,
          eventName: event.name,
          eventAction: action,
          mention,
          possibleHandles,
          explicitReviewRequest,
          explicitReviewTaskType: explicitReviewRouting.taskType,
          explicitReviewMaxTurnsOverride,
          formatterSuggestionRequest,
          writeEnabled,
          hasPrDiffContext: prDiffContext !== undefined,
          userQuestion,
          prompt,
          promptSections,
          knowledgeStore: deps.knowledgeStore,
          explicitReviewPromptFileCount,
          explicitReviewDynamicTimeoutSeconds,
          explicitReviewPrDiffCommentabilityIndex,
          reviewWorkAttempt,
          setReviewWorkPhase,
          reviewOutputAction: FORMATTER_REVIEW_OUTPUT_ACTION,
          runFormatterSuggestionForMention,
          postFormatterVisibleDiagnostic,
          logger,
        });
        reviewOutputKey = mentionExecutorDispatch.reviewOutputKey;

        const postExecutorPublicationAdapters = buildMentionPostExecutorPublicationAdapters({
          installationId: event.installationId,
          getInstallationOctokit: (installationId) => githubApp.getInstallationOctokit(installationId),
        });
        const postExecutorPublication = await publishMentionPostExecutorOutputs({
          executorDispatch: mentionExecutorDispatch,
          explicitReviewRequest,
          eventName: event.name,
          eventAction: action,
          mention,
          reviewOutputKey,
          deliveryId: event.id,
          installationId: event.installationId,
          explicitReviewHeadSha,
          explicitReviewBaseSha,
          appSlug,
          autoApprove: config.review.autoApprove,
          explicitReviewPromptFileCount,
          getOctokit: postExecutorPublicationAdapters.getOctokit,
          canPublishExplicitReviewOutput,
          setReviewWorkPhase,
          postMentionError,
          logger,
          reviewPublishRightsLost: reviewWorkRuntime.reviewPublishRightsLost,
          writeEnabled,
          mentionDerivedContextCacheStatus,
          mentionDerivedContextCacheReason,
          recordSuccessfulTurn: (key) => conversationTurnStore.recordSuccessfulTurn(key),
          telemetryEnabled: config.telemetry.enabled,
          telemetryStore,
          promptSections,
          costWarningUsd: config.telemetry.costWarningUsd,
          botHandles: possibleHandles,
          workspace,
          workspaceToken: workspace.token,
          octokit,
          forkContext,
          gistPublisher,
          writeContext: mentionWriteRequestContext,
          cloneRef,
          writeConfig: config.write,
          postMentionReply,
          writeRateLimit,
          explicitReviewRoutingReason: explicitReviewRouting.routingReason,
          runFormatterSuggestionForMention,
          postFormatterVisibleDiagnostic,
          reviewOutputAction: FORMATTER_REVIEW_OUTPUT_ACTION,
        });
        if (postExecutorPublication.writeOutputHandled) {
          return;
        }
      } catch (err) {
        await handleMentionHandlerFailureRecovery({
          error: err,
          githubApp,
          installationId: event.installationId,
          mention,
          possibleHandles,
          logger,
          guardrailAuditStore,
          explicitReviewRequest,
          reviewOutputKey,
          canPublishExplicitReviewOutput,
        });
      } finally {
        await cleanupMentionExecutionResources({
          acquiredWriteKey,
          releaseWriteKey: (key) => inFlightWriteKeys.delete(key),
          workspace,
        });
      }
      }, buildMentionJobQueueContext({
        deliveryId: event.id,
        eventName: event.name,
        action,
        isExplicitReviewRequest,
        mentionQueueKey,
        prNumber: mention.prNumber,
      }));
    } finally {
      reviewWorkRuntime.finalize();
    }
  }

  // Register for all three mention-triggering events
  eventRouter.register("issue_comment.created", handleMention);
  eventRouter.register("pull_request_review_comment.created", handleMention);
  eventRouter.register("pull_request_review.submitted", handleMention);
}
