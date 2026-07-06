import type {
  IssueCommentCreatedEvent,
  PullRequestReviewCommentCreatedEvent,
  PullRequestReviewSubmittedEvent,
} from "@octokit/webhooks-types";
import type { Logger } from "pino";
import type { EventRouter, WebhookEvent } from "../webhook/types.ts";
import type { JobQueue, WorkspaceManager, Workspace } from "../jobs/types.ts";
import type { ReviewWorkCoordinator } from "../jobs/review-work-coordinator.ts";
import type { GitHubApp } from "../auth/github-app.ts";
import type { createExecutor } from "../execution/executor.ts";
import type { TelemetryStore } from "../telemetry/types.ts";
import type { KnowledgeStore } from "../knowledge/types.ts";
import type { createRetriever } from "../knowledge/retrieval.ts";
import {
  getGitStatusPorcelain,
} from "../jobs/workspace.ts";
import type { ForkManager } from "../jobs/fork-manager.ts";
import type { GistPublisher } from "../jobs/gist-publisher.ts";
import {
  buildReviewFamilyKey,
  createReviewWorkCoordinator,
} from "../jobs/review-work-coordinator.ts";
import {
  type MentionEvent,
  normalizeIssueComment,
  normalizeReviewComment,
  normalizeReviewBody,
  stripMention,
} from "./mention-types.ts";
import {
  detectImplicitIssueIntent,
  detectImplicitPrPatchIntent,
  isCodeSeekingMentionRequest,
  isReviewRequest,
} from "./mention-request-classification.ts";
import {
  parseWriteIntent,
  resolveMentionWriteIntent,
} from "./mention-write-formatters.ts";
import {
  buildNoFileChangesReply,
  createIssueWriteFailurePoster,
  maybeReplyWritePermissionFailure,
  summarizeErrorForDiagnostics,
} from "./mention-write-replies.ts";
import {
  buildMentionWriteContext,
} from "./mention-write-keys.ts";
import { evaluateMentionWriteContextGate } from "./mention-write-context-gate.ts";
import { buildMentionPromptDetails } from "../execution/mention-prompt.ts";
import type { PrDiffCommentabilityIndex } from "../execution/formatter-suggestions.ts";
import { routeAddonRuleReviewMention } from "./addon-review-routing.ts";
import { TASK_TYPES } from "../llm/task-types.ts";
import {
  type ReviewTaskRouting,
} from "../lib/review-routing.ts";
import { buildPromptSectionRecord, type PromptBuildResult } from "../execution/prompt-section-metrics.ts";
import { fetchAllPullRequestFiles } from "../lib/github-pr-files.ts";
import { createSearchCache, type SearchCacheOptions } from "../lib/search-cache.ts";
import {
  type ErrorCategory,
  classifyError,
} from "../lib/errors.ts";
import { createGuardrailAuditStore } from "../lib/guardrail/audit-store.ts";
import {
  createConversationTurnStore,
  createTriageCooldownStore,
  createWriteRateLimitStore,
} from "../lib/mention-state-stores.ts";
import {
  buildReviewOutputKey,
} from "../review-orchestration/review-idempotency.ts";
import {
  type ExplicitMentionReviewPublishSkipReason,
} from "../review-orchestration/explicit-mention-review-publish.ts";
import { detectFormatterSuggestionRequest } from "./formatter-suggestion-intent.ts";
import { isMentionAuthorAllowed } from "./mention-allowed-users.ts";
import { resolveMentionClonePlan } from "./mention-clone-plan.ts";
import {
  evaluateMentionConversationLimit,
} from "./mention-conversation-limit.ts";
import { recordSuccessfulMentionConversationTurn } from "./mention-conversation-recording.ts";
import { maybePostMentionCostWarning } from "./mention-cost-warning.ts";
import {
  buildAcceptedMentionHandles,
  mentionBodyMatchesAcceptedHandles,
} from "./mention-handle-match.ts";
import {
  createFormatterSuggestionMentionRunner,
  createFormatterSuggestionVisibleDiagnosticPoster,
  runFormatterSuggestionSubflow,
} from "./formatter-suggestion-orchestration.ts";
import {
  buildCombinedReviewAndFormatMentionLogFields,
  buildFormatOnlyMentionLogFields,
  classifyMentionExecutionFailureSubtype,
  createMentionExecutionCompletedLogger,
  type MentionErrorDelivery,
  type MentionExecutionFailureSubtype,
  type MentionPublishResolution,
} from "./mention-publication-state.ts";
import {
  createMentionPublisher,
} from "./mention-publication.ts";
import {
  publishMentionErrorFallback,
  publishMentionHandlerFailureError,
  publishMentionSuccessFallback,
} from "./mention-result-fallback-publication.ts";
import { publishMentionFailureFallback } from "./mention-failure-publication.ts";
import { publishExplicitMentionReviewResult } from "./mention-explicit-review-publication.ts";
import {
  buildMentionQueueKey,
  findLatestReviewPredecessor,
  prepareMentionCheckoutAndLoadConfig,
} from "./mention-workspace.ts";
import {
  isSameRepoPrHead,
} from "./mention-pr-write.ts";
import { createMentionReviewWorkRuntime } from "./mention-review-work-runtime.ts";
import { createMentionWriteRateLimitRuntime } from "./mention-write-rate-limit.ts";
import { evaluateMentionWritePreflight } from "./mention-write-preflight.ts";
import { maybePublishDisabledWriteModeRefusal } from "./mention-write-disabled.ts";
import { postMentionEyesReaction } from "./mention-reactions.ts";
import { buildMentionTriageContext } from "./mention-triage-context.ts";
import { hydrateMentionFindingContext } from "./mention-finding-context.ts";
import { buildMentionAgentInstructions } from "./mention-agent-instructions.ts";
import { appendMentionIssueCodePointers } from "./mention-code-pointers.ts";
import { buildMentionDerivedContext } from "./mention-derived-context.ts";
import { attemptSameRepoPrWrite } from "./mention-same-repo-write.ts";
import { publishMentionBotWritePullRequest } from "./mention-bot-pr-write.ts";
import { publishMentionForkWriteOutput } from "./mention-fork-write-output.ts";
import {
  buildMentionRetrievalContextForPrompt,
  type MentionRetrievalContext,
} from "./mention-retrieval-context.ts";
import { recordMentionExecutionTelemetry } from "./mention-telemetry.ts";
import { projectExplicitMentionReviewValidationTruth } from "./mention-validation-truth.ts";
import { buildMentionExplicitReviewPrompt } from "./mention-explicit-review-prompt.ts";
import {
  resolveMentionPrDiffContext,
  type MentionPrDiffContext,
} from "./mention-pr-diff-context.ts";
import { projectExplicitMentionReviewLifecycle } from "./mention-explicit-review-lifecycle.ts";
import { executeMentionWithFormatterRecovery } from "./mention-execution-dispatch.ts";
import { resolveExplicitMentionReviewPublishDecision } from "./mention-explicit-review-publish-decision.ts";

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
  mentionDerivedContextCacheOptions?: Pick<
    SearchCacheOptions<PromptBuildResult>,
    "ttlMs" | "maxSize" | "now" | "store" | "inFlightStore"
  >;
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

  const guardrailAuditStore = sql ? createGuardrailAuditStore(sql) : undefined;
  const reviewWorkCoordinator = injectedReviewWorkCoordinator ?? createReviewWorkCoordinator();
  if (!injectedReviewWorkCoordinator) {
    logger.warn(
      {
        gate: "review-family-coordinator",
        gateResult: "private-fallback",
        coordinationScope: "handler-local",
        handler: "mention",
      },
      "Review work coordinator not injected; using a private handler-local fallback (cross-handler coordination disabled)",
    );
  }

  let mentionDerivedContextCacheErrorCount = 0;
  const mentionDerivedContextCache = createSearchCache<PromptBuildResult>({
    ...mentionDerivedContextCacheOptions,
    onError: (error) => {
      mentionDerivedContextCacheErrorCount += 1;
      logger.warn(
        {
          err: error,
          gate: "mention-derived-context-cache",
          gateResult: "degraded",
        },
        "Mention derived-context cache degraded; bypassing cache for this request",
      );
    },
  });

  const writeRateLimitStore = createWriteRateLimitStore();
  const conversationTurnStore = createConversationTurnStore();

  const inFlightWriteKeys = new Set<string>();

  const triageCooldownStore = createTriageCooldownStore();



  async function handleMention(event: WebhookEvent): Promise<void> {
    const appSlug = githubApp.getAppSlug();
    const possibleHandles = [appSlug, "kodai", "claude"];

    const action = (event.payload as Record<string, unknown>).action as string | undefined;

    // Normalize payload based on event type
    let mention: MentionEvent;

    if (event.name === "issue_comment") {
      if ((event.payload as Record<string, unknown>).action !== "created") return;
      mention = normalizeIssueComment(event.payload as unknown as IssueCommentCreatedEvent);
    } else if (event.name === "pull_request_review_comment") {
      if ((event.payload as Record<string, unknown>).action !== "created") return;
      mention = normalizeReviewComment(
        event.payload as unknown as PullRequestReviewCommentCreatedEvent,
      );
    } else if (event.name === "pull_request_review") {
      if ((event.payload as Record<string, unknown>).action !== "submitted") return;
      const payload = event.payload as unknown as PullRequestReviewSubmittedEvent;
      // Review body can be null (e.g. approval with no comment)
      if (!payload.review.body) return;
      mention = normalizeReviewBody(payload);
    } else {
      return;
    }

    // Fast filter: ignore if neither @appSlug nor @claude appear.
    // NOTE: Use a simple substring check here to avoid regex edge cases.
    // We still do the authoritative accepted-handles check inside the job after loading config.
    const bodyLower = mention.commentBody.toLowerCase();
    const appHandle = `@${appSlug.toLowerCase()}`;
    if (!bodyLower.includes(appHandle) && !bodyLower.includes("@kodai") && !bodyLower.includes("@claude")) return;

    const normalizedCommentAuthor = mention.commentAuthor.toLowerCase();
    if (
      normalizedCommentAuthor === appSlug.toLowerCase() ||
      normalizedCommentAuthor.endsWith("[bot]")
    ) {
      logger.debug(
        {
          owner: mention.owner,
          repo: mention.repo,
          commentAuthor: mention.commentAuthor,
          issueNumber: mention.issueNumber,
          prNumber: mention.prNumber,
        },
        "Skipping mention from self (comment-author defense)",
      );
      return;
    }

    // No tracking comment. Tracking is via eyes reaction only.
    // The response will be posted as a new comment.

    const provisionalUserQuestion = stripMention(mention.commentBody, possibleHandles);
    const provisionalFormatterSuggestionRequest = detectFormatterSuggestionRequest(provisionalUserQuestion);
    const reviewPrNumber = mention.prNumber;
    const isExplicitReviewRequest =
      reviewPrNumber !== undefined &&
      (isReviewRequest(provisionalUserQuestion) || provisionalFormatterSuggestionRequest?.mode === "review-and-format");
    const mentionQueueKey = buildMentionQueueKey(
      mention.owner,
      mention.repo,
      reviewPrNumber ?? mention.issueNumber,
    );
    const queuedReviewWorkAttempt = reviewPrNumber !== undefined && isExplicitReviewRequest
      ? reviewWorkCoordinator.claim({
          familyKey: buildReviewFamilyKey(mention.owner, mention.repo, reviewPrNumber),
          source: "explicit-review",
          lane: "interactive-review",
          deliveryId: event.id,
          phase: "claimed",
        })
      : undefined;
    if (queuedReviewWorkAttempt) {
      const predecessor = findLatestReviewPredecessor(
        reviewWorkCoordinator.getSnapshot(queuedReviewWorkAttempt.familyKey),
        queuedReviewWorkAttempt.attemptId,
      );
      if (predecessor) {
        logger.info(
          {
            surface: mention.surface,
            owner: mention.owner,
            repo: mention.repo,
            prNumber: reviewPrNumber,
            gate: "review-family-coordinator",
            gateResult: "claimed-with-predecessor",
            reviewFamilyKey: queuedReviewWorkAttempt.familyKey,
            reviewWorkAttemptId: queuedReviewWorkAttempt.attemptId,
            predecessorAttemptId: predecessor.attemptId,
            predecessorPhase: predecessor.phase,
            predecessorAgeMs: Math.max(
              0,
              queuedReviewWorkAttempt.claimedAtMs - predecessor.lastProgressAtMs,
            ),
          },
          "Explicit review claim found a stale predecessor attempt",
        );
      }
    }
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
      const explicitReviewUsesCanonicalHandle =
        reviewWorkAttempt !== undefined && (
          mention.commentBody.toLowerCase().includes(`@${appSlug.toLowerCase()}`)
          || mention.commentBody.toLowerCase().includes("@kodai")
        );

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

        // Fork-based write mode: ensure fork exists and sync before cloning (Phase 127)
        // Preliminary write intent check before config is available -- fork setup is
        // harmless if config later disables write, so we gate only on user intent.
        const prelimWriteIntent = parseWriteIntent(
          stripMention(mention.commentBody, [appSlug, "claude"]),
        );
        const maybeWriteMode = prelimWriteIntent.writeIntent && prelimWriteIntent.keyword !== "plan";
        let forkContext: { forkOwner: string; forkRepo: string; botPat: string } | undefined;
        if (maybeWriteMode && !forkManager?.enabled) {
          logger.warn(
            { owner: mention.owner, repo: mention.repo },
            "Write-mode active without BOT_USER_PAT; using legacy direct-push behavior",
          );
        }
        if (forkManager?.enabled && maybeWriteMode && !usesPrRef) {
          try {
            const fork = await forkManager.ensureFork(mention.owner, mention.repo);
            await forkManager.syncFork(fork.forkOwner, fork.forkRepo, cloneRef!);
            forkContext = {
              forkOwner: fork.forkOwner,
              forkRepo: fork.forkRepo,
              botPat: forkManager.getBotPat(),
            };
            logger.info(
              { owner: mention.owner, repo: mention.repo, forkOwner: fork.forkOwner, forkRepo: fork.forkRepo },
              "Fork ensured and synced for write-mode",
            );
          } catch (forkErr) {
            logger.warn(
              { err: forkErr, owner: mention.owner, repo: mention.repo },
              "Fork setup failed; will fall back to gist or legacy mode",
            );
            // forkContext stays undefined -- handled later in output routing
          }
        }

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

        const findingLookup = deps.knowledgeStore?.getFindingByCommentId
          ? async (repo: string, commentId: number) =>
              deps.knowledgeStore!.getFindingByCommentId!({ repo, commentId })
          : undefined;

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
        const acceptedHandles = buildAcceptedMentionHandles({ appSlug, acceptClaudeAlias });

        // Ensure the mention is actually allowed for this repo (e.g. @claude opt-out).
        // Use substring match to align with the fast filter.
        if (!mentionBodyMatchesAcceptedHandles(mention.commentBody, acceptedHandles)) {
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

        const userQuestion = stripMention(mention.commentBody, acceptedHandles);
        const formatterSuggestionRequest = detectFormatterSuggestionRequest(userQuestion);
        if (userQuestion.trim().length === 0) {
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

        const isIssueThreadComment = event.name === "issue_comment" && mention.prNumber === undefined;
        const isPrSurface = mention.prNumber !== undefined;
        explicitReviewRequest = isPrSurface && (
          isReviewRequest(userQuestion) || formatterSuggestionRequest?.mode === "review-and-format"
        );
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
        const writeIntent = resolveMentionWriteIntent({
          userQuestion,
          isIssueThreadComment,
          isPrSurface,
          formatterSuggestionRequestMode: formatterSuggestionRequest?.mode,
          detectImplicitIssueIntent,
          detectImplicitPrPatchIntent,
          isReviewRequest,
        });

        const isWriteRequest = writeIntent.writeIntent;
        const isPlanOnly = writeIntent.keyword === "plan";
        const writeEnabled = isWriteRequest && !isPlanOnly && config.write.enabled;
        const writeKeyword = writeIntent.keyword ?? "apply";
        const {
          retryCommand,
          triggerCommentUrl,
          writeBranchName,
          writeOutputKey,
          writeSource,
        } = buildMentionWriteContext({
          writeEnabled,
          writeKeyword,
          writeRequest: writeIntent.request,
          installationId: event.installationId,
          owner: mention.owner,
          repo: mention.repo,
          issueNumber: mention.issueNumber,
          prNumber: mention.prNumber,
          commentId: mention.commentId,
          appSlug,
        });

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

        if (isPrSurface && formatterSuggestionRequest?.mode === "format-only") {
          const formatterResult = await runFormatterSuggestionForMention("format-only");
          const { visibleReplyPosted, visibleReplyFailed } = await postFormatterVisibleDiagnostic({
            formatterResult,
            formatterMode: "format-only",
          });

          logger.info(
            buildFormatOnlyMentionLogFields({
              mention: {
                surface: mention.surface,
                owner: mention.owner,
                repo: mention.repo,
                issueNumber: mention.issueNumber,
                prNumber: mention.prNumber,
              },
              deliveryId: event.id,
              reviewOutputAction: FORMATTER_REVIEW_OUTPUT_ACTION,
              formatterResult,
              visibleReplyPosted,
              visibleReplyFailed,
            }),
            "Format-only formatter suggestion request completed",
          );
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

        // Build mention context (conversation + PR metadata + inline diff context)
        // Non-fatal: if context fails to load, still attempt an answer with minimal prompt.
        const allowIssueCodePointers = isIssueThreadComment && isCodeSeekingMentionRequest(writeIntent.request);
        // A mention on a PR is about that PR. Two consequences, both keyed off the
        // single fact "is this on a PR?":
        //  - always ground the reply in the PR diff — without it a vague follow-up
        //    ("provide additional details") had no code to anchor on and fixated on
        //    whatever retrieval surfaced (once an unrelated issue);
        //  - suppress the repo issue corpus — issue BM25 has no relevance floor and
        //    can inject an unrelated issue on common-word matches.
        const isPrMention = mention.prNumber !== undefined;
        const allowPrDiffContext = isPrMention;
        const includeIssueCorpus = !isPrMention;
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
          getCacheErrorCount: () => mentionDerivedContextCacheErrorCount,
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
        let prompt: string;
        let promptSections: import("../telemetry/types.ts").PromptSectionRecord[] = [];
        let explicitReviewPromptFileCount: number | undefined;
        let explicitReviewDynamicTimeoutSeconds: number | undefined;
        let explicitReviewMaxTurnsOverride: number | undefined;
        let explicitReviewPrDiffCommentabilityIndex: PrDiffCommentabilityIndex | undefined;
        let explicitReviewHeadSha: string | undefined;
        let explicitReviewBaseSha: string | undefined;
        let explicitReviewRouting: ReviewTaskRouting = {
          taskType: TASK_TYPES.REVIEW_FULL,
          routingReason: "standard",
        };
        if (explicitReviewRequest && mention.prNumber !== undefined) {
          const explicitReviewPrompt = await buildMentionExplicitReviewPrompt({
            mention: mention as MentionEvent & { prNumber: number },
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
          });
          prompt = explicitReviewPrompt.prompt;
          promptSections = explicitReviewPrompt.promptSections;
          explicitReviewPromptFileCount = explicitReviewPrompt.promptFileCount;
          explicitReviewDynamicTimeoutSeconds = explicitReviewPrompt.dynamicTimeoutSeconds;
          explicitReviewMaxTurnsOverride = explicitReviewPrompt.maxTurnsOverride;
          explicitReviewPrDiffCommentabilityIndex = explicitReviewPrompt.prDiffCommentabilityIndex;
          explicitReviewHeadSha = explicitReviewPrompt.headSha;
          explicitReviewBaseSha = explicitReviewPrompt.baseSha;
          explicitReviewRouting = explicitReviewPrompt.routing;
        } else {
          const mentionPromptResult = buildMentionPromptDetails({
            mention,
            mentionContext,
            retrievalContext,
            userQuestion: writeIntent.request,
            findingContext,
            customInstructions: [config.mention.prompt, planOnlyInstructions, writeInstructions]
              .filter((s) => (s ?? "").trim().length > 0)
              .join("\n\n"),
            outputLanguage: config.review.outputLanguage,
            unifiedResults: unifiedResultsForPrompt.length > 0 ? unifiedResultsForPrompt : undefined,
            contextWindow: contextWindowForPrompt,
            triageContext: triageContext.trim().length > 0 ? triageContext : undefined,
            prDiffContext,
          });
          prompt = mentionPromptResult.text;
          promptSections = [
            buildPromptSectionRecord({
              deliveryId: event.id,
              repo: `${mention.owner}/${mention.repo}`,
              taskType: "mention.response",
              promptKind: "mention.context",
              sections: mentionContextSectionMetrics,
            }),
            buildPromptSectionRecord({
              deliveryId: event.id,
              repo: `${mention.owner}/${mention.repo}`,
              taskType: "mention.response",
              promptKind: "mention.user-prompt",
              sections: mentionPromptResult.sections,
            }),
          ].filter((record) => record.sections.length > 0);
        }

        // Cap max turns for read-only conversational PR mentions.
        // Explicit `@kodiai review` requests should use the full review budget so
        // large PRs do not terminate mid-tool-call before any publish step occurs.
        const mentionMaxTurns =
          explicitReviewRequest
            ? explicitReviewMaxTurnsOverride
            : (!writeEnabled && mention.prNumber !== undefined)
              ? (prDiffContext !== undefined ? 12 : 20)
              : undefined; // undefined → falls through to config.maxTurns

        reviewOutputKey = explicitReviewRequest && mention.prNumber !== undefined
          ? buildReviewOutputKey({
              installationId: event.installationId,
              owner: mention.owner,
              repo: mention.repo,
              prNumber: mention.prNumber,
              action: "mention-review",
              deliveryId: event.id,
              headSha: mention.headRef ?? "unknown-head-sha",
            })
          : undefined;

        // Execute via Claude. Combined review-and-format requests run Claude first so
        // formatter workspace mutations cannot affect review prompt/executor context;
        // if Claude throws, the formatter subflow still gets an independent attempt.
        if (reviewWorkAttempt) {
          setReviewWorkPhase("executor-dispatch");
        }
        const isCombinedFormatterSuggestionRequest =
          isPrSurface && formatterSuggestionRequest?.mode === "review-and-format";
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
            taskType: explicitReviewRequest ? explicitReviewRouting.taskType : "mention.response",
            eventType: `${event.name}.${action ?? ""}`.replace(/\.$/, ""),
            triggerBody: explicitReviewRequest ? userQuestion : mention.commentBody,
            prompt,
            promptSections,
            reviewOutputKey,
            maxTurnsOverride: mentionMaxTurns,
            dynamicTimeoutSeconds: explicitReviewDynamicTimeoutSeconds,
            knowledgeStore: deps.knowledgeStore,
            formatterSuggestionRequest,
            totalFiles: explicitReviewPromptFileCount,
            enableInlineTools: explicitReviewRequest ? true : undefined,
            enableCandidateFindingTool: explicitReviewRequest ? true : undefined,
            prDiffCommentabilityIndex: explicitReviewRequest ? explicitReviewPrDiffCommentabilityIndex : undefined,
          },
          isCombinedFormatterSuggestionRequest,
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
        let mentionOutputPublished = Boolean(result.published);
        let publishResolution: MentionPublishResolution = mentionOutputPublished ? "executor" : "none";
        let publishFailureCategory: ErrorCategory | null = null;
        let publishFallbackDelivery: MentionErrorDelivery | null = null;
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

        if (explicitReviewPublishEligible && reviewOutputKey && mention.prNumber !== undefined) {
          const publishOctokit = await githubApp.getInstallationOctokit(event.installationId);
          const explicitReviewPublication = await publishExplicitMentionReviewResult({
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
          mentionOutputPublished = explicitReviewPublication.outputPublished;
          publishResolution = explicitReviewPublication.resolution;
          publishFailureCategory = explicitReviewPublication.failureCategory ?? publishFailureCategory;
          publishFallbackDelivery = explicitReviewPublication.fallbackDelivery;
        }

        const mentionExecutionErrorCategory = result.errorMessage !== undefined
          ? classifyError(new Error(result.errorMessage), result.isTimeout ?? false, result.published)
          : undefined;
        const mentionFailureSubtype = result.failureSubtype
          ?? classifyMentionExecutionFailureSubtype(result.errorMessage);

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
        const shouldDeferMentionCompletionLog =
          !mentionOutputPublished
          && !reviewWorkRuntime.reviewPublishRightsLost
          && (result.conclusion === "failure" || result.conclusion === "error");
        if (!shouldDeferMentionCompletionLog) {
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
          const isIssueWritePublishFlow = isIssueThreadComment;

          const postIssueWriteFailure = createIssueWriteFailurePoster({
            isIssueWritePublishFlow,
            retryCommand,
            postReply: postMentionReply,
            logger,
            logContext: {
              deliveryId: event.id,
              installationId: event.installationId,
              owner: mention.owner,
              repoName: mention.repo,
              repo: `${mention.owner}/${mention.repo}`,
              sourcePrNumber: mention.prNumber,
              triggerCommentId: mention.commentId,
              triggerCommentUrl,
              writeOutputKey,
            },
          });

          const status = await getGitStatusPorcelain(workspace.dir);
          if (status.trim().length === 0) {
            const replyBody = buildNoFileChangesReply();
            await postMentionReply(replyBody);
            return;
          }

          const forkWriteOutput = await publishMentionForkWriteOutput({
            workspaceDir: workspace.dir,
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
            botHandles: [appSlug, "claude", "kodai"],
            logger,
            postMentionReply,
            recordWriteRateLimitSuccess: (owner, repo) => writeRateLimit.recordSuccess(owner, repo),
          });
          if (forkWriteOutput.status === "handled") {
            return;
          }

          const sourcePrUrl =
            mention.prNumber !== undefined
              ? `https://github.com/${mention.owner}/${mention.repo}/pull/${mention.prNumber}`
              : undefined;

          const sameRepoHead = isSameRepoPrHead({
            owner: mention.owner,
            repo: mention.repo,
            headRepoOwner: mention.headRepoOwner,
            headRepoName: mention.headRepoName,
            headRef: mention.headRef,
          });

          // Preferred path: update existing PR branch when possible.
          const sameRepoPrWriteResult = await attemptSameRepoPrWrite({
            workspaceDir: workspace.dir,
            workspaceToken: workspace.token,
            mention,
            sameRepoHead,
            sourcePrUrl,
            writeOutputKey,
            writeBranchName,
            writeRequest: writeIntent.request,
            deliveryId: event.id,
            installationId: event.installationId,
            triggerCommentUrl,
            allowPaths: config.write.allowPaths,
            denyPaths: config.write.denyPaths,
            secretScanEnabled: config.write.secretScan.enabled,
            retryCommand,
            logger,
            postMentionReply,
            maybeReplyWritePermissionFailure,
          });
          if (sameRepoPrWriteResult.status === "handled") {
            return;
          }

          await publishMentionBotWritePullRequest({
            workspaceDir: workspace.dir,
            workspaceToken: workspace.token,
            octokit,
            mention,
            cloneRef,
            writeBranchName,
            writeOutputKey,
            writeRequest: writeIntent.request,
            triggerCommentUrl,
            deliveryId: event.id,
            installationId: event.installationId,
            allowPaths: config.write.allowPaths,
            denyPaths: config.write.denyPaths,
            secretScanEnabled: config.write.secretScan.enabled,
            retryCommand,
            isIssueWritePublishFlow,
            botHandles: [appSlug, "claude", "kodai"],
            logger,
            postMentionReply,
            postIssueWriteFailure,
            maybeReplyWritePermissionFailure,
            recordWriteRateLimitSuccess: (owner, repo) => writeRateLimit.recordSuccess(owner, repo),
          });
          return;
        }

        // If Claude finished successfully but did not publish any output, post a fallback reply.
        // This prevents "silent success" where the model chose not to call any comment tools.
        // Explicit review publish failures that already exhausted the comment fallback path must
        // not fall through here, or we spam the same broken comment surface with a less specific reply.
        if (
          !writeEnabled &&
          result.conclusion === "success" &&
          !mentionOutputPublished &&
          publishResolution !== "publish-failure-comment-failed" &&
          !reviewWorkRuntime.reviewPublishRightsLost
        ) {
          await publishMentionSuccessFallback({
            explicitReviewRequest,
            hasUnpublishedFindings: explicitReviewPublishEvaluation.hasUnpublishedFindings,
            findingLines: explicitReviewResultFindingLines,
            resultText: result.resultText,
            skipReason: explicitReviewPublishEvaluation.skipReason,
            reviewOutputKey,
            canPublishExplicitReviewOutput,
            postMentionReply,
          });
        }

        // If execution errored, post or update error comment with classified message
        if (result.conclusion === "error" && !reviewWorkRuntime.reviewPublishRightsLost) {
          const errorFallbackPublication = await publishMentionErrorFallback({
            explicitReviewRequest,
            isTimeout: result.isTimeout,
            errorMessage: result.errorMessage,
            reviewOutputKey,
            canPublishExplicitReviewOutput,
            postMentionError,
          });
          const errorFallbackPublicationState = errorFallbackPublication.ok
            ? errorFallbackPublication.value
            : errorFallbackPublication.err;
          if (errorFallbackPublicationState.resolution !== "skipped") {
            mentionOutputPublished = errorFallbackPublicationState.published;
            publishResolution = errorFallbackPublicationState.resolution;
            publishFallbackDelivery = errorFallbackPublicationState.fallbackDelivery;
          }
        }

        // If execution failed without publishing, always post a user-visible fallback.
        // The SDK can return conclusion="failure" with stop reasons other than max_turns,
        // and previously those paths could finish silently.
        if (
          result.conclusion === "failure"
          && !mentionOutputPublished
          && !reviewWorkRuntime.reviewPublishRightsLost
        ) {
          const fallbackPublication = await publishMentionFailureFallback({
            explicitReviewRequest,
            routingReason: explicitReviewRouting.routingReason,
            stopReason: result.stopReason,
            failureSubtype: result.failureSubtype,
            reviewOutputKey,
            surface: mention.surface,
            issueNumber: mention.issueNumber,
            canPublishExplicitReviewOutput,
            postMentionError,
            logger,
          });
          const fallbackPublicationState = fallbackPublication.ok ? fallbackPublication.value : fallbackPublication.err;
          if (fallbackPublicationState.resolution !== "skipped") {
            mentionOutputPublished = fallbackPublicationState.published;
            publishResolution = fallbackPublicationState.resolution;
            publishFallbackDelivery = fallbackPublicationState.fallbackDelivery;
          }
        }

        if (shouldDeferMentionCompletionLog) {
          logMentionExecutionCompleted();
        }

        if (isCombinedFormatterSuggestionRequest) {
          const formatterResult = await runFormatterSuggestionForMention("review-and-format");
          const { visibleReplyPosted, visibleReplyFailed } = await postFormatterVisibleDiagnostic({
            formatterResult,
            formatterMode: "review-and-format",
          });

          logger.info(
            buildCombinedReviewAndFormatMentionLogFields({
              mention: {
                surface: mention.surface,
                owner: mention.owner,
                repo: mention.repo,
                issueNumber: mention.issueNumber,
                prNumber: mention.prNumber,
              },
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
              formatterResult,
              visibleReplyPosted,
              visibleReplyFailed,
            }),
            "Combined review-and-format mention request completed",
          );
        }
      } catch (err) {
        logger.error(
          { err, surface: mention.surface, issueNumber: mention.issueNumber },
          "Mention handler failed",
        );

        try {
          await publishMentionHandlerFailureError({
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
