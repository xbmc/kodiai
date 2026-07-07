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
import {
  maybeReplyWritePermissionFailure,
} from "./mention-write-replies.ts";
import { evaluateMentionWriteContextGate } from "./mention-write-context-gate.ts";
import { routeAddonRuleReviewMention } from "./addon-review-routing.ts";
import { fetchAllPullRequestFiles } from "../lib/github-pr-files.ts";
import { classifyError } from "../lib/errors.ts";
import { resolveMentionClonePlan } from "./mention-clone-plan.ts";
import {
  evaluateMentionConversationLimit,
} from "./mention-conversation-limit.ts";
import {
  runFormatterSuggestionSubflow,
} from "./formatter-suggestion-orchestration.ts";
import {
  type MentionExecutionFailureSubtype,
  resolveMentionExecutionPublicationState,
} from "./mention-publication-state.ts";
import {
  createMentionPublisher,
} from "./mention-publication.ts";
import { handleMentionHandlerFailureRecovery } from "./mention-handler-failure-recovery.ts";
import {
  createMentionWorkspaceRuntime,
} from "./mention-workspace-runtime.ts";
import {
  createMentionReviewWorkRuntime,
  usesCanonicalExplicitReviewHandle,
} from "./mention-review-work-runtime.ts";
import { evaluateMentionWritePreflight } from "./mention-write-preflight.ts";
import { maybePublishDisabledWriteModeRefusal } from "./mention-write-disabled.ts";
import { postMentionEyesReaction } from "./mention-reactions.ts";
import { buildMentionTriageContext } from "./mention-triage-context.ts";
import {
  createMentionFindingLookup,
  hydrateMentionFindingContext,
} from "./mention-finding-context.ts";
import { buildMentionAgentInstructions } from "./mention-agent-instructions.ts";
import { appendMentionIssueCodePointers } from "./mention-code-pointers.ts";
import { buildMentionDerivedContext } from "./mention-derived-context.ts";
import {
  buildMentionRetrievalContextForPrompt,
  type MentionRetrievalContext,
} from "./mention-retrieval-context.ts";
import {
  resolveMentionPrDiffContext,
  type MentionPrDiffContext,
} from "./mention-pr-diff-context.ts";
import { executeMentionWithFormatterRecovery } from "./mention-execution-dispatch.ts";
import { publishExplicitMentionReviewIfEligible } from "./mention-explicit-review-publication-orchestration.ts";
import { publishMentionExecutionFallbacks } from "./mention-execution-fallbacks.ts";
import { resolveMentionTriggerContext } from "./mention-trigger-context.ts";
import { resolveMentionExecutorPlan } from "./mention-executor-plan.ts";
import { buildMentionExecutionContext } from "./mention-execution-context.ts";
import { resolveMentionPromptRuntimeContext } from "./mention-prompt-runtime.ts";
import { routeMentionWriteOutputIfEnabled } from "./mention-write-output-routing.ts";
import { publishFormatOnlyMentionFormatterResult } from "./mention-format-only-publication.ts";
import { publishCombinedReviewAndFormatMentionFormatterResult } from "./mention-combined-format-publication.ts";
import { resolveMentionWriteRequestContext } from "./mention-write-request-context.ts";
import { resolveMentionPromptContextRouting } from "./mention-prompt-context-routing.ts";
import { claimMentionReviewWorkAttempt } from "./mention-review-work-claim.ts";
import { createMentionHandlerRuntime, type MentionDerivedContextCacheOptions } from "./mention-handler-runtime.ts";
import { cleanupMentionExecutionResources } from "./mention-execution-cleanup.ts";
import { buildMentionJobQueueContext } from "./mention-job-context.ts";
import { resolveMentionConfigRequestGate } from "./mention-config-request-gate.ts";
import { handleMentionPostExecution } from "./mention-post-execution.ts";
import { logMentionProcessing } from "./mention-processing-log.ts";
import { createMentionFormatterRuntime } from "./mention-formatter-runtime.ts";

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
    const queuedReviewWorkAttempt = claimMentionReviewWorkAttempt({
      coordinator: reviewWorkCoordinator,
      mention,
      reviewPrNumber,
      isExplicitReviewRequest,
      deliveryId: event.id,
      logger,
    });
    const reviewWorkRuntime = createMentionReviewWorkRuntime({
      attempt: queuedReviewWorkAttempt,
      coordinator: reviewWorkCoordinator,
      mention,
      logger,
    });
    const {
      setPhase: setReviewWorkPhase,
      canPublishExplicitReviewOutput,
    } = reviewWorkRuntime;

    try {
      await jobQueue.enqueue(event.installationId, async () => {
      let workspace: Workspace | undefined;
      let acquiredWriteKey: string | undefined;
      const reviewWorkAttempt = reviewWorkRuntime.attempt;
      let explicitReviewRequest = false;
      let reviewOutputKey: string | undefined;
      const explicitReviewUsesCanonicalHandle = usesCanonicalExplicitReviewHandle({
        attempt: reviewWorkAttempt,
        appSlug,
        commentBody: mention.commentBody,
      });

      try {
        const octokit = await githubApp.getInstallationOctokit(event.installationId);
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

        if (explicitReviewUsesCanonicalHandle) {
          setReviewWorkPhase("workspace-create");
        }
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
          beforeLoadConfig: explicitReviewUsesCanonicalHandle
            ? () => setReviewWorkPhase("load-config")
            : undefined,
          logger,
        });
        workspace = workspaceRuntime.workspace;
        const {
          forkContext,
          config,
          writeRateLimit,
        } = workspaceRuntime;

        const findingLookup = createMentionFindingLookup(deps.knowledgeStore);

        const mentionConfigRequestGate = resolveMentionConfigRequestGate({
          mention,
          mentionConfig: config.mention,
          appSlug,
          logger,
        });
        if (mentionConfigRequestGate.action === "stop") return;
        const { acceptClaudeAlias, requestContext: mentionRequestContext } = mentionConfigRequestGate;
        const acceptedHandles = mentionRequestContext.acceptedHandles;
        const { userQuestion, formatterSuggestionRequest } = mentionRequestContext;

        const mentionWriteRequestContext = resolveMentionWriteRequestContext({
          eventName: event.name,
          installationId: event.installationId,
          appSlug,
          mention,
          userQuestion,
          formatterSuggestionRequestMode: formatterSuggestionRequest?.mode,
          writeConfigEnabled: config.write.enabled,
        });
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
        if (explicitReviewRequest && mention.prNumber !== undefined && await routeAddonRuleReviewMention({
          event,
          owner: mention.owner,
          repo: mention.repo,
          prNumber: mention.prNumber,
          addonRepos,
          getPullRequest: (args) => octokit.rest.pulls.get(args),
          dispatch: addonReviewDispatcher,
          logger,
        })) {
          return;
        }

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

        const writePreflight = await evaluateMentionWritePreflight({
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
        });
        acquiredWriteKey = writePreflight.acquiredWriteKey;
        if (writePreflight.action === "stop") return;

        const writeContextGate = evaluateMentionWriteContextGate({
          isWriteRequest,
          isIssueThreadComment,
          prNumber: mention.prNumber,
        });
        if (!writeContextGate.allowed) {
          await postMentionReply(writeContextGate.replyBody, writeContextGate.replyOptions);
          return;
        }

        if (await maybePublishDisabledWriteModeRefusal({
          isWriteRequest,
          isPlanOnly,
          writeEnabled: config.write.enabled,
          mention,
          keyword: writeIntent.keyword,
          writeKeyword,
          writeRequest: writeIntent.request,
          appSlug,
          logger,
          postMentionReply,
        })) return;

        const conversationLimit = evaluateMentionConversationLimit({
          owner: mention.owner,
          repo: mention.repo,
          issueNumber: mention.issueNumber,
          prNumber: mention.prNumber,
          inReplyToId: mention.inReplyToId,
          maxTurnsPerPr: config.mention.conversation.maxTurnsPerPr,
          getTurns: (key) => conversationTurnStore.getTurns(key),
        });
        if (conversationLimit.limited) {
          await postMentionReply(conversationLimit.replyBody);
          return;
        }

        logMentionProcessing({
          logger,
          mention,
          acceptClaudeAlias,
        });

        await postMentionEyesReaction({ octokit, mention, logger });

        const {
          allowIssueCodePointers,
          allowPrDiffContext,
          includeIssueCorpus,
        } = resolveMentionPromptContextRouting({
          isIssueThreadComment,
          prNumber: mention.prNumber,
          writeRequest: writeIntent.request,
        });
        let {
          mentionContext,
          mentionContextSectionMetrics,
          mentionAdmissionPolicy,
          mentionDerivedContextCacheStatus,
          mentionDerivedContextCacheReason,
        } = await buildMentionDerivedContext({
          octokit,
          mention,
          explicitReviewRequest,
          mentionAdmission: config.mention.admission,
          maxThreadChars: config.mention.conversation.contextBudgetChars,
          findingLookup,
          cache: mentionDerivedContextCache,
          getCacheErrorCount: getMentionDerivedContextCacheErrorCount,
          logger,
        });

        ({
          mentionContext,
          mentionContextSectionMetrics,
        } = await appendMentionIssueCodePointers({
          enabled: allowIssueCodePointers,
          mentionContext,
          mentionContextSectionMetrics,
          workspaceDir: workspace.dir,
          question: writeIntent.request,
          logger,
          logContext: { surface: mention.surface, issueNumber: mention.issueNumber },
        }));

        const triageContext = await buildMentionTriageContext({
          enabled: config.triage.enabled,
          isIssueThreadComment,
          owner: mention.owner,
          repo: mention.repo,
          issueNumber: mention.issueNumber,
          issueBody: mention.issueBody,
          workspaceDir: workspace.dir,
          cooldownMinutes: config.triage.cooldownMinutes,
          labelAllowlist: config.triage.labelAllowlist,
          cooldownStore: triageCooldownStore,
          logger,
        });

        const findingContext = await hydrateMentionFindingContext({
          owner: mention.owner,
          repo: mention.repo,
          inReplyToId: mention.inReplyToId,
          findingLookup,
          logger,
        });

        let retrievalContext: MentionRetrievalContext | undefined;
        let unifiedResultsForPrompt: import("../knowledge/cross-corpus-rrf.ts").UnifiedRetrievalChunk[] = [];
        let contextWindowForPrompt: string | undefined;
        let reviewPrecedentsForPrompt: import("../knowledge/review-comment-retrieval.ts").ReviewCommentMatch[] = [];
        let wikiKnowledgeForPrompt: import("../knowledge/wiki-retrieval.ts").WikiKnowledgeMatch[] = [];
        ({
          retrievalContext,
          unifiedResultsForPrompt,
          contextWindowForPrompt,
          reviewPrecedentsForPrompt,
          wikiKnowledgeForPrompt,
        } = await buildMentionRetrievalContextForPrompt({
          retriever,
          retrievalEnabled: config.knowledge?.retrieval?.enabled === true,
          topK: config.knowledge?.retrieval?.topK,
          telemetryEnabled: config.telemetry.enabled,
          telemetryStore,
          deliveryId: event.id,
          owner: mention.owner,
          repo: mention.repo,
          surface: mention.surface,
          issueNumber: mention.issueNumber,
          prNumber: mention.prNumber,
          baseRef: mention.baseRef,
          workspaceDir: workspace.dir,
          writeRequest: writeIntent.request,
          mentionContext,
          allowHeavyContext: allowIssueCodePointers,
          allowDiffContext: allowPrDiffContext,
          explicitReviewRequest,
          inReplyToId: mention.inReplyToId,
          includeIssueCorpus,
          logger,
        }));

        const { planOnlyInstructions, writeInstructions } = buildMentionAgentInstructions({
          isPlanOnly,
          isWriteRequest,
          writeEnabled,
        });

        const prDiffContext: MentionPrDiffContext | undefined = await resolveMentionPrDiffContext({
          allowPrDiffContext,
          writeEnabled,
          mention,
          workspaceDir: workspace.dir,
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

        const executorPlan = resolveMentionExecutorPlan({
          mention,
          installationId: event.installationId,
          deliveryId: event.id,
          eventName: event.name,
          eventAction: action,
          explicitReviewRequest,
          explicitReviewTaskType: explicitReviewRouting.taskType,
          explicitReviewMaxTurnsOverride,
          formatterSuggestionMode: formatterSuggestionRequest?.mode,
          writeEnabled,
          hasPrDiffContext: prDiffContext !== undefined,
          userQuestion,
        });
        reviewOutputKey = executorPlan.reviewOutputKey;

        // Execute via Claude. Combined review-and-format requests run Claude first so
        // formatter workspace mutations cannot affect review prompt/executor context;
        // if Claude throws, the formatter subflow still gets an independent attempt.
        if (reviewWorkAttempt) {
          setReviewWorkPhase("executor-dispatch");
        }
        const result = await executeMentionWithFormatterRecovery({
          execute: (context) => executor.execute(context),
          context: buildMentionExecutionContext({
            workspace,
            installationId: event.installationId,
            mention,
            deliveryId: event.id,
            botHandles: possibleHandles,
            writeEnabled,
            executorPlan,
            prompt,
            promptSections,
            knowledgeStore: deps.knowledgeStore,
            formatterSuggestionRequest,
            explicitReviewPromptFileCount,
            explicitReviewRequest,
            explicitReviewDynamicTimeoutSeconds,
            explicitReviewPrDiffCommentabilityIndex,
          }),
          isCombinedFormatterSuggestionRequest: executorPlan.isCombinedFormatterSuggestionRequest,
          mention,
          deliveryId: event.id,
          reviewOutputAction: FORMATTER_REVIEW_OUTPUT_ACTION,
          runFormatterSuggestionForMention,
          postFormatterVisibleDiagnostic,
          classifyFailure: (err) => classifyError(err, false),
          logger,
        });

        const {
          explicitReviewPublishEvaluation,
          explicitReviewResultFindingLines,
          explicitReviewPublication,
        } = await publishExplicitMentionReviewIfEligible({
          explicitReviewRequest,
          eventName: event.name,
          mention,
          reviewOutputKey,
          deliveryId: event.id,
          installationId: event.installationId,
          headSha: explicitReviewHeadSha,
          baseSha: explicitReviewBaseSha,
          result: {
            conclusion: result.conclusion,
            published: result.published,
            usedRepoInspectionTools: result.usedRepoInspectionTools,
            resultText: result.resultText,
            toolUseNames: result.toolUseNames,
            candidateFinding: result.candidateFinding,
          },
          appSlug,
          autoApprove: config.review.autoApprove,
          explicitReviewPromptFileCount,
          getOctokit: () => githubApp.getInstallationOctokit(event.installationId),
          canPublishExplicitReviewOutput,
          setReviewWorkPhase,
          postMentionError,
          logger,
        });

        let {
          mentionOutputPublished,
          publishResolution,
          publishFailureCategory,
          publishFallbackDelivery,
          mentionExecutionErrorCategory,
          mentionFailureSubtype,
          shouldDeferCompletionLog,
        } = resolveMentionExecutionPublicationState({
          result,
          explicitReviewPublication,
          reviewPublishRightsLost: reviewWorkRuntime.reviewPublishRightsLost,
        });

        const mentionPostExecution = await handleMentionPostExecution({
          logger,
          mention,
          result,
          getPublicationState: () => ({
            mentionFailureSubtype,
            mentionExecutionErrorCategory,
            mentionOutputPublished,
            publishResolution,
            publishFailureCategory,
            publishFallbackDelivery,
          }),
          writeEnabled,
          mentionDerivedContextCacheStatus,
          mentionDerivedContextCacheReason,
          explicitReviewRequest,
          reviewOutputKey,
          shouldDeferCompletionLog,
          recordSuccessfulTurn: (key) => conversationTurnStore.recordSuccessfulTurn(key),
          telemetryEnabled: config.telemetry.enabled,
          telemetryStore,
          deliveryId: event.id,
          eventType: `${event.name}.${action ?? ""}`,
          promptSections,
          costWarningUsd: config.telemetry.costWarningUsd,
          canPublishExplicitReviewOutput,
          getOctokit: () => githubApp.getInstallationOctokit(event.installationId),
          botHandles: possibleHandles,
        });

        if (await routeMentionWriteOutputIfEnabled({
          workspace,
          workspaceToken: workspace.token,
          octokit,
          mention,
          forkContext,
          gistPublisher,
          writeContext: mentionWriteRequestContext,
          cloneRef,
          writeConfig: config.write,
          deliveryId: event.id,
          installationId: event.installationId,
          appSlug,
          logger,
          postMentionReply,
          maybeReplyWritePermissionFailure,
          writeRateLimit,
        })) {
          return;
        }

        ({
          mentionOutputPublished,
          publishResolution,
          publishFallbackDelivery,
        } = await publishMentionExecutionFallbacks({
          writeEnabled,
          reviewPublishRightsLost: reviewWorkRuntime.reviewPublishRightsLost,
          mentionOutputPublished,
          publishResolution,
          publishFallbackDelivery,
          result,
          explicitReviewRequest,
          hasUnpublishedFindings: explicitReviewPublishEvaluation.hasUnpublishedFindings,
          findingLines: explicitReviewResultFindingLines,
          skipReason: explicitReviewPublishEvaluation.skipReason,
          routingReason: explicitReviewRouting.routingReason,
          reviewOutputKey,
          surface: mention.surface,
          issueNumber: mention.issueNumber,
          canPublishExplicitReviewOutput,
          postMentionReply,
          postMentionError,
          logger,
        }));

        if (shouldDeferCompletionLog) {
          mentionPostExecution.logMentionExecutionCompleted();
        }

        const combinedFormatterPublication = await publishCombinedReviewAndFormatMentionFormatterResult({
          enabled: executorPlan.isCombinedFormatterSuggestionRequest,
          runFormatterSuggestionForMention,
          postFormatterVisibleDiagnostic,
          mention,
          deliveryId: event.id,
          reviewOutputAction: FORMATTER_REVIEW_OUTPUT_ACTION,
          result: {
            conclusion: result.conclusion,
            stopReason: result.stopReason,
            failureSubtype: result.failureSubtype,
          },
          publishResolution,
          publishFailureCategory,
          publishFallbackDelivery,
          logger,
        });
        if (!combinedFormatterPublication.ok) {
          throw combinedFormatterPublication.err.error;
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
