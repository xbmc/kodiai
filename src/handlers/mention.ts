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
  summarizeErrorForDiagnostics,
} from "./mention-write-replies.ts";
import { evaluateMentionWriteContextGate } from "./mention-write-context-gate.ts";
import { routeAddonRuleReviewMention } from "./addon-review-routing.ts";
import { fetchAllPullRequestFiles } from "../lib/github-pr-files.ts";
import { classifyError } from "../lib/errors.ts";
import {
  type ExplicitMentionReviewPublishSkipReason,
} from "../review-orchestration/explicit-mention-review-publish.ts";
import { isMentionAuthorAllowed } from "./mention-allowed-users.ts";
import { resolveMentionClonePlan } from "./mention-clone-plan.ts";
import {
  evaluateMentionConversationLimit,
} from "./mention-conversation-limit.ts";
import { recordSuccessfulMentionConversationTurn } from "./mention-conversation-recording.ts";
import { maybePostMentionCostWarning } from "./mention-cost-warning.ts";
import {
  createFormatterSuggestionMentionRunner,
  createFormatterSuggestionVisibleDiagnosticPoster,
  runFormatterSuggestionSubflow,
} from "./formatter-suggestion-orchestration.ts";
import {
  createMentionExecutionCompletedLogger,
  type MentionExecutionFailureSubtype,
  resolveMentionExecutionPublicationState,
} from "./mention-publication-state.ts";
import {
  createMentionPublisher,
} from "./mention-publication.ts";
import {
  publishMentionHandlerFailureError,
} from "./mention-result-fallback-publication.ts";
import { publishExplicitMentionReviewResult } from "./mention-explicit-review-publication.ts";
import {
  prepareMentionCheckoutAndLoadConfig,
} from "./mention-workspace.ts";
import {
  createMentionReviewWorkRuntime,
  usesCanonicalExplicitReviewHandle,
} from "./mention-review-work-runtime.ts";
import { createMentionWriteRateLimitRuntime } from "./mention-write-rate-limit.ts";
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
import { recordMentionExecutionTelemetry } from "./mention-telemetry.ts";
import { projectExplicitMentionReviewValidationTruth } from "./mention-validation-truth.ts";
import {
  resolveMentionPrDiffContext,
  type MentionPrDiffContext,
} from "./mention-pr-diff-context.ts";
import { projectExplicitMentionReviewLifecycle } from "./mention-explicit-review-lifecycle.ts";
import { executeMentionWithFormatterRecovery } from "./mention-execution-dispatch.ts";
import { resolveExplicitMentionReviewPublishDecision } from "./mention-explicit-review-publish-decision.ts";
import { resolveMentionRequestContext } from "./mention-request-context.ts";
import { publishMentionExecutionFallbacks } from "./mention-execution-fallbacks.ts";
import { resolveMentionTriggerContext } from "./mention-trigger-context.ts";
import { resolveMentionExecutorPlan } from "./mention-executor-plan.ts";
import { resolveMentionPromptRuntimeContext } from "./mention-prompt-runtime.ts";
import { routeMentionWriteOutput } from "./mention-write-output-routing.ts";
import { publishFormatOnlyMentionFormatterResult } from "./mention-format-only-publication.ts";
import { publishCombinedReviewAndFormatMentionFormatterResult } from "./mention-combined-format-publication.ts";
import { resolveMentionForkContext } from "./mention-fork-context.ts";
import { resolveMentionWriteRequestContext } from "./mention-write-request-context.ts";
import { resolveMentionPromptContextRouting } from "./mention-prompt-context-routing.ts";
import { claimMentionReviewWorkAttempt } from "./mention-review-work-claim.ts";
import { createMentionHandlerRuntime, type MentionDerivedContextCacheOptions } from "./mention-handler-runtime.ts";

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

        logger.info(
          {
            surface: mention.surface,
            owner: mention.owner,
            repo: mention.repo,
            issueNumber: mention.issueNumber,
            prNumber: mention.prNumber,
            cloneOwner,
            cloneRepo,
            cloneRef,
            cloneDepth,
            usesPrRef,
            workspaceStrategy,
          },
          "Creating workspace for mention execution",
        );

        const forkContext = await resolveMentionForkContext({
          forkManager,
          appSlug,
          commentBody: mention.commentBody,
          owner: mention.owner,
          repo: mention.repo,
          cloneRef,
          usesPrRef,
          logger,
        });

        // Clone workspace
        if (explicitReviewUsesCanonicalHandle) {
          setReviewWorkPhase("workspace-create");
        }
        workspace = await workspaceManager.create(event.installationId, {
          owner: cloneOwner,
          repo: cloneRepo,
          ref: cloneRef!,
          depth: cloneDepth,
          forkContext,
        });

        if (explicitReviewUsesCanonicalHandle) {
          setReviewWorkPhase("load-config");
        }
        const { config, warnings } = await prepareMentionCheckoutAndLoadConfig({
          workspace,
          usesPrRef,
          mention,
          cloneDepth,
        });
        const writeRateLimit = createMentionWriteRateLimitRuntime({
          store: writeRateLimitStore,
          installationId: event.installationId,
          minIntervalSeconds: config.write.minIntervalSeconds,
        });
        for (const w of warnings) {
          logger.warn(
            { section: w.section, issues: w.issues },
            "Config warning detected",
          );
        }

        // Check mention.enabled
        if (!config.mention.enabled) {
          logger.info(
            { owner: mention.owner, repo: mention.repo },
            "Mentions disabled in config, skipping",
          );
          return;
        }

        const findingLookup = createMentionFindingLookup(deps.knowledgeStore);

        // Check mention.allowedUsers (CONFIG-07)
        if (!isMentionAuthorAllowed(mention.commentAuthor, config.mention.allowedUsers)) {
          logger.info(
            {
              owner: mention.owner,
              repo: mention.repo,
              commentAuthor: mention.commentAuthor,
              gate: "mention-allowed-users",
              gateResult: "skipped",
              skipReason: "user-not-allowlisted",
            },
            "Mention author not in allowedUsers, skipping",
          );
          return;
        }

        // Global alias: treat @claude as an always-on alias for mentions.
        // (Repo-level opt-out remains possible via mention.acceptClaudeAlias=false,
        // but the alias is enabled by default to support immediate cutover.)
        const acceptClaudeAlias = config.mention.acceptClaudeAlias !== false;
        const mentionRequestContext = resolveMentionRequestContext({
          appSlug,
          acceptClaudeAlias,
          commentBody: mention.commentBody,
        });
        const acceptedHandles = mentionRequestContext.acceptedHandles;
        if (mentionRequestContext.action === "skip" && mentionRequestContext.reason === "handle-mismatch") {
          logger.info(
            {
              surface: mention.surface,
              owner: mention.owner,
              repo: mention.repo,
              issueNumber: mention.issueNumber,
              prNumber: mention.prNumber,
              acceptClaudeAlias,
            },
            "Mention does not match accepted handles for repo; skipping",
          );
          return;
        }

        if (mentionRequestContext.action === "skip") {
          logger.info(
            {
              surface: mention.surface,
              owner: mention.owner,
              repo: mention.repo,
              issueNumber: mention.issueNumber,
              prNumber: mention.prNumber,
              acceptClaudeAlias,
            },
            "Mention contained no question after stripping mention; skipping",
          );
          return;
        }
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

        const runFormatterSuggestionForMention = createFormatterSuggestionMentionRunner({
          workspace,
          owner: mention.owner,
          repo: mention.repo,
          prNumber: mention.prNumber,
          baseRef: mention.baseRef,
          headRef: mention.headRef,
          formatterCommand: config.review.formatterSuggestions.command,
          maxSuggestions: config.review.formatterSuggestions.maxSuggestions,
          installationId: event.installationId,
          deliveryId: event.id,
          reviewOutputAction: FORMATTER_REVIEW_OUTPUT_ACTION,
          octokit: octokit as never,
          botHandles: possibleHandles,
          logger,
          logContext: {
            surface: mention.surface,
          },
          classifyFailure: (err) => classifyError(err, false),
          fetchPullRequestFiles: (params) => fetchAllPullRequestFiles({
            octokit,
            owner: params.owner,
            repo: params.repo,
            pullNumber: params.pullNumber,
          }),
          formatterSuggestionSubflow,
        });

        const postFormatterVisibleDiagnostic = createFormatterSuggestionVisibleDiagnosticPoster({
          postReply: postMentionReply,
          logger,
          logContext: {
            surface: mention.surface,
            owner: mention.owner,
            repo: mention.repo,
            prNumber: mention.prNumber,
          },
          classifyFailure: (err) => classifyError(err, false),
        });

        if (await publishFormatOnlyMentionFormatterResult({
          isPrSurface,
          formatterSuggestionMode: formatterSuggestionRequest?.mode,
          runFormatterSuggestionForMention,
          postFormatterVisibleDiagnostic,
          mention,
          deliveryId: event.id,
          reviewOutputAction: FORMATTER_REVIEW_OUTPUT_ACTION,
          logger,
        })) {
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

        logger.info(
          {
            surface: mention.surface,
            owner: mention.owner,
            repo: mention.repo,
            issueNumber: mention.issueNumber,
            prNumber: mention.prNumber,
            commentAuthor: mention.commentAuthor,
            acceptClaudeAlias,
          },
          "Processing mention",
        );

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
          context: {
            workspace,
            installationId: event.installationId,
            owner: mention.owner,
            repo: mention.repo,
            prNumber: mention.prNumber,
            issueNumber: mention.issueNumber,
            // For inline review comment mentions, provide the triggering review comment id
            // so the executor can enable the in-thread reply MCP tool.
            commentId: mention.surface === "pr_review_comment" ? mention.commentId : undefined,
            deliveryId: event.id,
            botHandles: possibleHandles,
            writeMode: writeEnabled,
            taskType: executorPlan.taskType,
            eventType: executorPlan.eventType,
            triggerBody: executorPlan.triggerBody,
            prompt,
            promptSections,
            reviewOutputKey,
            maxTurnsOverride: executorPlan.maxTurnsOverride,
            dynamicTimeoutSeconds: explicitReviewDynamicTimeoutSeconds,
            knowledgeStore: deps.knowledgeStore,
            formatterSuggestionRequest,
            totalFiles: explicitReviewPromptFileCount,
            enableInlineTools: executorPlan.enableInlineTools,
            enableCandidateFindingTool: executorPlan.enableCandidateFindingTool,
            prDiffCommentabilityIndex: explicitReviewRequest ? explicitReviewPrDiffCommentabilityIndex : undefined,
          },
          isCombinedFormatterSuggestionRequest: executorPlan.isCombinedFormatterSuggestionRequest,
          mention,
          deliveryId: event.id,
          reviewOutputAction: FORMATTER_REVIEW_OUTPUT_ACTION,
          runFormatterSuggestionForMention,
          postFormatterVisibleDiagnostic,
          classifyFailure: (err) => classifyError(err, false),
          logger,
        });

        // Explicit PR review mentions bypass the pull_request review handler's
        // deterministic clean-review publish path. Bridge that gap here so a
        // successful no-issues run still produces a GitHub-visible approval.
        const explicitReviewFindingLifecycleResult = projectExplicitMentionReviewLifecycle({
          explicitReviewRequest,
          eventName: event.name,
          mention,
          reviewOutputKey,
          deliveryId: event.id,
          headSha: explicitReviewHeadSha,
          baseSha: explicitReviewBaseSha,
          candidateFinding: result.candidateFinding,
          logger,
        });
        const explicitReviewPublishDecision = resolveExplicitMentionReviewPublishDecision({
          explicitReviewRequest,
          prNumber: mention.prNumber,
          reviewOutputKey,
          result: {
            conclusion: result.conclusion,
            published: result.published,
            usedRepoInspectionTools: result.usedRepoInspectionTools,
            resultText: result.resultText,
            toolUseNames: result.toolUseNames,
          },
          surface: mention.surface,
          owner: mention.owner,
          repo: mention.repo,
          autoApprove: config.review.autoApprove,
          logger,
        });
        const explicitReviewPublishEvaluation = explicitReviewPublishDecision.evaluation;
        const explicitReviewResultFindingLines = explicitReviewPublishDecision.findingLines;
        const explicitReviewPublishEligible = explicitReviewPublishDecision.eligible;
        let explicitReviewPublication: Awaited<ReturnType<typeof publishExplicitMentionReviewResult>> | null = null;

        if (explicitReviewPublishEligible && reviewOutputKey && mention.prNumber !== undefined) {
          const publishOctokit = await githubApp.getInstallationOctokit(event.installationId);
          explicitReviewPublication = await publishExplicitMentionReviewResult({
            octokit: publishOctokit,
            owner: mention.owner,
            repo: mention.repo,
            prNumber: mention.prNumber,
            surface: mention.surface,
            deliveryId: event.id,
            installationId: event.installationId,
            reviewOutputKey,
            appSlug,
            autoApprove: config.review.autoApprove,
            usedRepoInspectionTools: result.usedRepoInspectionTools === true,
            explicitReviewPromptFileCount,
            explicitReviewFindingLifecycleResult,
            canPublishExplicitReviewOutput,
            setReviewWorkPhase,
            postMentionError,
            summarizeError: summarizeErrorForDiagnostics,
            logger,
          });
        }

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

        const logMentionExecutionCompleted = createMentionExecutionCompletedLogger({
          logger,
          getState: () => ({
            surface: mention.surface,
            issueNumber: mention.issueNumber,
            result,
            mentionFailureSubtype,
            mentionExecutionErrorCategory,
            mentionOutputPublished,
            publishResolution,
            publishFailureCategory,
            publishFallbackDelivery,
            writeEnabled,
            mentionDerivedContextCacheStatus,
            mentionDerivedContextCacheReason,
            explicitReviewRequest,
            reviewOutputKey,
          }),
        });
        if (!shouldDeferCompletionLog) {
          logMentionExecutionCompleted();
        }

        recordSuccessfulMentionConversationTurn({
          owner: mention.owner,
          repo: mention.repo,
          issueNumber: mention.issueNumber,
          prNumber: mention.prNumber,
          inReplyToId: mention.inReplyToId,
          conclusion: result.conclusion,
          recordSuccessfulTurn: (key) => conversationTurnStore.recordSuccessfulTurn(key),
        });

        // Telemetry capture (TELEM-03, TELEM-05, CONFIG-10)
        if (config.telemetry.enabled) {
          await recordMentionExecutionTelemetry({
            telemetryStore,
            logger,
            deliveryId: event.id,
            repo: `${mention.owner}/${mention.repo}`,
            prNumber: mention.prNumber,
            eventType: `${event.name}.${action ?? ""}`,
            result,
            promptSections: result.promptSections ?? promptSections,
            derivedContextCacheStatus: mentionDerivedContextCacheStatus,
            derivedContextCacheReason: mentionDerivedContextCacheReason ?? undefined,
          });

          await maybePostMentionCostWarning({
            costUsd: result.costUsd,
            thresholdUsd: config.telemetry.costWarningUsd,
            owner: mention.owner,
            repo: mention.repo,
            issueNumber: mention.issueNumber,
            prNumber: mention.prNumber,
            explicitReviewRequest,
            reviewOutputKey,
            canPublishExplicitReviewOutput,
            getOctokit: () => githubApp.getInstallationOctokit(event.installationId),
            botHandles: possibleHandles,
            logger,
          });
        }

        // Write-mode: trusted code publishes the branch + PR and replies with a link.
        if (writeEnabled && writeOutputKey && writeBranchName) {
          await routeMentionWriteOutput({
            workspaceDir: workspace.dir,
            workspaceToken: workspace.token,
            octokit,
            mention,
            forkContext,
            gistPublisher,
            writeKeyword: writeIntent.keyword ?? "",
            writeBranchName,
            writeOutputKey,
            writeRequest: writeIntent.request,
            triggerCommentUrl,
            deliveryId: event.id,
            installationId: event.installationId,
            cloneRef,
            allowPaths: config.write.allowPaths,
            denyPaths: config.write.denyPaths,
            secretScanEnabled: config.write.secretScan.enabled,
            retryCommand,
            isIssueThreadComment,
            botHandles: [appSlug, "claude", "kodai"],
            logger,
            postMentionReply,
            maybeReplyWritePermissionFailure,
            recordWriteRateLimitSuccess: (owner, repo) => writeRateLimit.recordSuccess(owner, repo),
          });
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
          logMentionExecutionCompleted();
        }

        await publishCombinedReviewAndFormatMentionFormatterResult({
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
      } catch (err) {
        logger.error(
          { err, surface: mention.surface, issueNumber: mention.issueNumber },
          "Mention handler failed",
        );

        try {
          const handlerFailurePublication = await publishMentionHandlerFailureError({
            githubApp,
            installationId: event.installationId,
            mention,
            possibleHandles,
            logger,
            guardrailAuditStore,
            explicitReviewRequest,
            reviewOutputKey,
            canPublishExplicitReviewOutput,
            error: err,
          });
          if (!handlerFailurePublication.ok) {
            logger.error(
              { err: handlerFailurePublication.err.error },
              "Failed to post error comment",
            );
          }
        } catch (commentErr) {
          logger.error({ err: commentErr }, "Failed to post error comment");
        }
      } finally {
        if (acquiredWriteKey) {
          inFlightWriteKeys.delete(acquiredWriteKey);
        }
        if (workspace) {
          await workspace.cleanup();
        }
      }
      }, {
      deliveryId: event.id,
      eventName: event.name,
      action,
      lane: isExplicitReviewRequest ? "interactive-review" : "sync",
      key: mentionQueueKey,
      jobType: "mention",
      prNumber: mention.prNumber,
    });
    } finally {
      reviewWorkRuntime.finalize();
    }
  }

  // Register for all three mention-triggering events
  eventRouter.register("issue_comment.created", handleMention);
  eventRouter.register("pull_request_review_comment.created", handleMention);
  eventRouter.register("pull_request_review.submitted", handleMention);
}
