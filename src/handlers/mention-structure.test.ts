import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

describe("mention handler structure", () => {
  test("keeps GitHub mention publication helpers out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");
    const publicationSource = readFileSync(new URL("./mention-publication.ts", import.meta.url), "utf8");

    expect(source).not.toContain("async function postMentionReply");
    expect(source).not.toContain("async function postMentionError");
    expect(source).not.toContain("async function postMentionHandlerError");
    expect(source).not.toContain("createReviewReplyWithPublicationPipeline");
    expect(source).not.toContain("createIssueCommentWithPublicationPipeline");
    expect(source).not.toContain("createPullReviewWithPublicationPipeline");
    expect(source).toContain("./mention-publication.ts");
    expect(publicationSource).toContain("export async function postMentionHandlerError");
    expect(publicationSource).toContain("export async function publishExplicitMentionReviewApproval");
  });

  test("keeps same-repo PR write idempotency helpers out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");
    const routingSource = readFileSync(new URL("./mention-write-output-routing.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const normalizeName =");
    expect(source).not.toContain("git -C ${workspace.dir} log -n 50");
    expect(source).toContain("./mention-write-output-routing.ts");
    expect(routingSource).toContain("./mention-pr-write.ts");
  });

  test("keeps write-mode preflight publication out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("Failed to look up existing PR for write idempotency; continuing");
    expect(source).not.toContain("const writeRateLimitCheck = writeRateLimit.check");
    expect(source).not.toContain("inFlightWriteKeys.add(writeOutputKey)");
    expect(source).toContain("evaluateMentionWritePreflight");
    expect(source).toContain("./mention-write-preflight.ts");
  });

  test("keeps explicit review work runtime helpers out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("function finalizeQueuedReviewWorkAttempt");
    expect(source).not.toContain("function setReviewWorkPhase");
    expect(source).not.toContain("function canPublishExplicitReviewOutput");
    expect(source).toContain("./mention-review-work-runtime.ts");
  });

  test("keeps handler-local review coordinator fallback policy out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const reviewWorkCoordinator = injectedReviewWorkCoordinator ?? createReviewWorkCoordinator();");
    expect(source).not.toContain("Review work coordinator not injected; using a private handler-local fallback");
    expect(source).toContain("resolveReviewWorkCoordinator");
    expect(source).toContain("./review-work-coordinator-fallback.ts");
  });

  test("keeps canonical explicit-review handle matching out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("mention.commentBody.toLowerCase().includes");
    expect(source).not.toContain("`@${appSlug.toLowerCase()}`");
    expect(source).not.toContain("mention.commentBody.toLowerCase().includes(\"@kodai\")");
    expect(source).toContain("usesCanonicalExplicitReviewHandle");
  });

  test("keeps write rate limit success key construction out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const recordWriteRateLimitSuccess =");
    expect(source).not.toContain("recordWriteRateLimitSuccess(event, mention.owner, mention.repo)");
    expect(source).not.toContain("const key = `${event.installationId}:${owner}/${repo}`;");
    expect(source).not.toContain("const key = `${event.installationId}:${mention.owner}/${mention.repo}`;");
    expect(source).not.toContain("writeRateLimitStore.getLastWriteAt(key)");
    expect(source).not.toContain("config.write.minIntervalSeconds * 1000");
    expect(source).toContain("createMentionWriteRateLimitRuntime");
    expect(source).toContain("./mention-write-rate-limit.ts");
  });

  test("keeps mention execution completion logging out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const logMentionExecutionCompleted = (): void =>");
    expect(source).not.toContain("buildMentionExecutionCompletedLogFields({");
    expect(source).toContain("createMentionExecutionCompletedLogger");
  });

  test("keeps mention execution publication state projection out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("let mentionOutputPublished = Boolean(result.published)");
    expect(source).not.toContain("let publishResolution: MentionPublishResolution");
    expect(source).not.toContain("let publishFailureCategory: ErrorCategory | null");
    expect(source).not.toContain("let publishFallbackDelivery: MentionErrorDelivery | null");
    expect(source).not.toContain("const mentionExecutionErrorCategory = result.errorMessage !== undefined");
    expect(source).not.toContain("const mentionFailureSubtype = result.failureSubtype");
    expect(source).not.toContain("const shouldDeferMentionCompletionLog =");
    expect(source).toContain("resolveMentionExecutionPublicationState");
  });

  test("keeps mention execution telemetry persistence out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("executionIdentity: `${event.id}:reuse.mention-derived-context`");
    expect(source).not.toContain("Mention reuse telemetry write failed (non-blocking)");
    expect(source).toContain("recordMentionExecutionTelemetry");
    expect(source).toContain("./mention-telemetry.ts");
  });

  test("keeps mention retrieval context assembly out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const variants = buildRetrievalVariants({");
    expect(source).not.toContain("await retriever.retrieve({");
    expect(source).not.toContain("Mention retrieval reuse telemetry write failed (non-blocking)");
    expect(source).not.toContain("Mention retrieval context generation failed (fail-open)");
    expect(source).toContain("buildMentionRetrievalContextForPrompt");
    expect(source).toContain("./mention-retrieval-context.ts");
  });

  test("keeps formatter visible diagnostic option binding out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const postFormatterVisibleDiagnostic = (");
    expect(source).not.toContain("postFormatterSuggestionVisibleDiagnostic({");
    expect(source).toContain("createFormatterSuggestionVisibleDiagnosticPoster");
  });

  test("keeps combined review-and-format log shaping out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");
    const dispatchSource = readFileSync(new URL("./mention-execution-dispatch.ts", import.meta.url), "utf8");
    const combinedFormatSource = readFileSync(new URL("./mention-combined-format-publication.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const reviewPartialFailure =");
    expect(source).not.toContain("const formatterPartialFailure =");
    expect(source).not.toContain("expectedBoundedCleanFormatter");
    expect(source).not.toContain("combinedPartialFailure: reviewPartialFailure");
    expect(source).not.toContain("formatterPartialFailure: formatterResult.partialFailure ?? false");
    expect(source).not.toContain("buildCombinedReviewAndFormatMentionLogFields");
    expect(combinedFormatSource).toContain("buildCombinedReviewAndFormatMentionLogFields");
    expect(dispatchSource).toContain("buildCombinedReviewAndFormatThrownMentionLogFields");
  });

  test("keeps combined review-and-format formatter completion orchestration out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("if (executorPlan.isCombinedFormatterSuggestionRequest)");
    expect(source).not.toContain("const formatterResult = await runFormatterSuggestionForMention(\"review-and-format\")");
    expect(source).not.toContain("Combined review-and-format mention request completed");
    expect(source).toContain("publishCombinedReviewAndFormatMentionFormatterResult");
    expect(source).toContain("./mention-combined-format-publication.ts");
  });

  test("keeps format-only formatter log shaping out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");
    const formatOnlySource = readFileSync(new URL("./mention-format-only-publication.ts", import.meta.url), "utf8");

    expect(source).not.toContain("partialFailure: formatterResult.partialFailure ?? false");
    expect(source).not.toContain("buildFormatOnlyMentionLogFields");
    expect(formatOnlySource).toContain("buildFormatOnlyMentionLogFields");
  });

  test("keeps format-only formatter completion orchestration out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("formatterSuggestionRequest?.mode === \"format-only\"");
    expect(source).not.toContain("const formatterResult = await runFormatterSuggestionForMention(\"format-only\")");
    expect(source).not.toContain("Format-only formatter suggestion request completed");
    expect(source).toContain("publishFormatOnlyMentionFormatterResult");
    expect(source).toContain("./mention-format-only-publication.ts");
  });

  test("keeps mention executor dispatch and combined formatter throw recovery out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("result = await executor.execute({");
    expect(source).not.toContain("Combined review-and-format review executor threw before formatter subflow");
    expect(source).not.toContain("Combined review-and-format formatter subflow completed after review executor threw");
    expect(source).toContain("executeMentionWithFormatterRecovery");
    expect(source).toContain("./mention-execution-dispatch.ts");
  });

  test("keeps mention executor planning policy out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const mentionMaxTurns =");
    expect(source).not.toContain("reviewOutputKey = explicitReviewRequest && mention.prNumber !== undefined");
    expect(source).not.toContain("eventType: `${event.name}.${action ?? \"\"}`.replace(/\\.$/, \"\")");
    expect(source).not.toContain("triggerBody: explicitReviewRequest ? userQuestion : mention.commentBody");
    expect(source).toContain("resolveMentionExecutorPlan");
    expect(source).toContain("./mention-executor-plan.ts");
  });

  test("keeps accepted mention handle normalization out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");
    const requestContextSource = readFileSync(new URL("./mention-request-context.ts", import.meta.url), "utf8");

    expect(source).not.toContain("acceptedBodyLower");
    expect(source).not.toContain(".map((h) => (h.startsWith(\"@\") ? h : `@${h}`))");
    expect(source).toContain("./mention-request-context.ts");
    expect(requestContextSource).toContain("./mention-handle-match.ts");
    expect(requestContextSource).toContain("buildAcceptedMentionHandles");
    expect(requestContextSource).toContain("mentionBodyMatchesAcceptedHandles");
  });

  test("keeps pre-queue mention trigger normalization out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("let mention: MentionEvent;");
    expect(source).not.toContain("normalizeIssueComment(event.payload");
    expect(source).not.toContain("normalizeReviewComment(");
    expect(source).not.toContain("normalizeReviewBody(payload)");
    expect(source).not.toContain("const provisionalUserQuestion = stripMention");
    expect(source).not.toContain("const provisionalFormatterSuggestionRequest = detectFormatterSuggestionRequest");
    expect(source).toContain("resolveMentionTriggerContext");
    expect(source).toContain("./mention-trigger-context.ts");
  });

  test("keeps post-config mention request context parsing out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const acceptedHandles = buildAcceptedMentionHandles({ appSlug, acceptClaudeAlias });");
    expect(source).not.toContain("const userQuestion = stripMention(mention.commentBody, acceptedHandles);");
    expect(source).not.toContain("const formatterSuggestionRequest = detectFormatterSuggestionRequest(userQuestion);");
    expect(source).not.toContain("userQuestion.trim().length === 0");
    expect(source).toContain("resolveMentionRequestContext");
    expect(source).toContain("./mention-request-context.ts");
  });

  test("keeps mention write request projection out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const isIssueThreadComment = event.name === \"issue_comment\"");
    expect(source).not.toContain("const isPrSurface = mention.prNumber !== undefined;");
    expect(source).not.toContain("const writeIntent = resolveMentionWriteIntent({");
    expect(source).not.toContain("const writeKeyword = writeIntent.keyword ?? \"apply\";");
    expect(source).not.toContain("buildMentionWriteContext({");
    expect(source).toContain("resolveMentionWriteRequestContext");
    expect(source).toContain("./mention-write-request-context.ts");
  });

  test("keeps allowed-users matching out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const normalizedAuthor =");
    expect(source).not.toContain("config.mention.allowedUsers.map((u) => u.toLowerCase())");
    expect(source).not.toContain("allowed.includes(normalizedAuthor)");
    expect(source).toContain("./mention-allowed-users.ts");
    expect(source).toContain("isMentionAuthorAllowed");
  });

  test("keeps conversation limit policy out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const conversationKey = `${mention.owner}/${mention.repo}#${mention.prNumber ?? mention.issueNumber}`;");
    expect(source).not.toContain("const turns = conversationTurnStore.getTurns(conversationKey);");
    expect(source).not.toContain("Conversation limit reached (${config.mention.conversation.maxTurnsPerPr} turns per PR).");
    expect(source).toContain("./mention-conversation-limit.ts");
    expect(source).toContain("evaluateMentionConversationLimit");
  });

  test("keeps successful conversation turn recording out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("conversationTurnStore.recordSuccessfulTurn(conversationKey)");
    expect(source).not.toContain("const conversationKey = buildMentionConversationKey({");
    expect(source).toContain("recordSuccessfulMentionConversationTurn");
    expect(source).toContain("./mention-conversation-recording.ts");
  });

  test("keeps finding lookup adapter binding out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("deps.knowledgeStore?.getFindingByCommentId");
    expect(source).not.toContain("deps.knowledgeStore!.getFindingByCommentId!({ repo, commentId })");
    expect(source).toContain("createMentionFindingLookup");
    expect(source).toContain("./mention-finding-context.ts");
  });

  test("keeps write request context gating out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("isWriteRequest && mention.prNumber === undefined && !isIssueThreadComment");
    expect(source).not.toContain("buildPrContextRequiredReply");
    expect(source).toContain("./mention-write-context-gate.ts");
    expect(source).toContain("evaluateMentionWriteContextGate");
  });

  test("keeps disabled write-mode refusal publication out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("Write intent detected but write-mode disabled; refusing to apply changes");
    expect(source).not.toContain("const retryCommand =");
    expect(source).not.toContain("buildWriteDisabledReply");
    expect(source).toContain("maybePublishDisabledWriteModeRefusal");
    expect(source).toContain("./mention-write-disabled.ts");
  });

  test("keeps write permission failure reply binding out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const maybeReplyWritePermissionFailure = async");
    expect(source).not.toContain("maybePostWritePermissionFailureReply");
    expect(source).toContain("maybeReplyWritePermissionFailure");
    expect(source).toContain("./mention-write-replies.ts");
  });

  test("keeps issue write failure poster binding out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");
    const routingSource = readFileSync(new URL("./mention-write-output-routing.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const postIssueWriteFailure = async");
    expect(source).toContain("routeMentionWriteOutput");
    expect(routingSource).toContain("createIssueWriteFailurePoster");
    expect(source).toContain("./mention-write-replies.ts");
  });

  test("keeps cost warning publication out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("This execution cost");
    expect(source).not.toContain("costWarningUsd: 5.0");
    expect(source).not.toContain("explicit mention review cost warning comment");
    expect(source).toContain("./mention-cost-warning.ts");
    expect(source).toContain("maybePostMentionCostWarning");
  });

  test("keeps execution failure fallback publication out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");
    const fallbackSource = readFileSync(new URL("./mention-execution-fallbacks.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const failureFallbackBody = buildMentionFailureFallbackBody");
    expect(source).not.toContain("publishResolution = \"turn-limit-fallback-failed\"");
    expect(source).not.toContain("publishResolution = \"failure-fallback-failed\"");
    expect(source).not.toContain("Failed to post turn-limit notice (non-blocking)");
    expect(source).not.toContain("Failed to post failure fallback notice (non-blocking)");
    expect(fallbackSource).toContain("publishMentionFailureFallback");
    expect(fallbackSource).toContain("./mention-failure-publication.ts");
  });

  test("keeps execution success and error fallback publication out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");
    const fallbackSource = readFileSync(new URL("./mention-execution-fallbacks.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const fallbackBody = buildMentionSuccessFallbackBody");
    expect(source).not.toContain("const errorBody = buildMentionErrorFallbackBody");
    expect(source).not.toContain("publishResolution = \"error-comment-failed\"");
    expect(fallbackSource).toContain("publishMentionSuccessFallback");
    expect(fallbackSource).toContain("publishMentionErrorFallback");
    expect(fallbackSource).toContain("./mention-result-fallback-publication.ts");
  });

  test("keeps post-execution fallback branching out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("publishResolution !== \"publish-failure-comment-failed\"");
    expect(source).not.toContain("const errorFallbackPublication = await publishMentionErrorFallback");
    expect(source).not.toContain("const fallbackPublication = await publishMentionFailureFallback");
    expect(source).toContain("publishMentionExecutionFallbacks");
    expect(source).toContain("./mention-execution-fallbacks.ts");
  });

  test("keeps explicit review approval publication recovery out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const explicitReviewLifecycleEvidenceLine = buildExplicitReviewLifecycleEvidenceLine");
    expect(source).not.toContain("const approvalEvidence = [");
    expect(source).not.toContain("publishResolution = \"duplicate-suppressed\"");
    expect(source).not.toContain("publishResolution = \"publish-failure-comment-failed\"");
    expect(source).not.toContain("Explicit mention review publish fallback could not be delivered");
    expect(source).toContain("publishExplicitMentionReviewResult");
    expect(source).toContain("./mention-explicit-review-publication.ts");
  });

  test("keeps explicit review validation-truth projection out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("attachReviewValidationTruth({");
    expect(source).not.toContain("Projected explicit mention review validation truth evidence");
    expect(source).not.toContain("Explicit mention review validation truth diagnostics failed; continuing review publication");
    expect(source).toContain("projectExplicitMentionReviewValidationTruth");
    expect(source).toContain("./mention-validation-truth.ts");
  });

  test("keeps explicit review finding lifecycle projection out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("attachReviewFindingLifecycle({");
    expect(source).not.toContain("Projected explicit mention review finding lifecycle evidence");
    expect(source).not.toContain("trigger: event.name === \"issue_comment\"");
    expect(source).toContain("projectExplicitMentionReviewLifecycle");
    expect(source).toContain("./mention-explicit-review-lifecycle.ts");
  });

  test("keeps explicit review publish eligibility and skip logging out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("evaluateExplicitMentionReviewPublish({");
    expect(source).not.toContain("logExplicitMentionReviewPublishSkipped({");
    expect(source).not.toContain("const explicitReviewResultFindingLines = explicitReviewPublishEvaluation.findingLines");
    expect(source).toContain("resolveExplicitMentionReviewPublishDecision");
    expect(source).toContain("./mention-explicit-review-publish-decision.ts");
  });

  test("keeps clone planning out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("let cloneOwner = mention.owner");
    expect(source).not.toContain("cloneDepth = 50");
    expect(source).not.toContain("const repository = repoPayload.repository");
    expect(source).toContain("./mention-clone-plan.ts");
    expect(source).toContain("resolveMentionClonePlan");
  });

  test("keeps mention reaction endpoint branching out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("createForPullRequestReviewComment");
    expect(source).not.toContain("createForIssueComment");
    expect(source).not.toContain("Failed to add eyes reaction");
    expect(source).toContain("postMentionEyesReaction");
    expect(source).toContain("./mention-reactions.ts");
  });

  test("keeps issue triage context cooldown and validation out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const cooldownKey = `${mention.owner}/${mention.repo}#${mention.issueNumber}`;");
    expect(source).not.toContain("generateGenericNudge()");
    expect(source).not.toContain("generateLabelRecommendation({");
    expect(source).not.toContain("Triage validation failed (fail-open)");
    expect(source).toContain("buildMentionTriageContext");
    expect(source).toContain("./mention-triage-context.ts");
  });

  test("keeps finding metadata hydration out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("let findingContext:");
    expect(source).not.toContain("Failed to hydrate finding context; proceeding without finding metadata");
    expect(source).not.toContain("findingLookup(`${mention.owner}/${mention.repo}`, mention.inReplyToId)");
    expect(source).toContain("hydrateMentionFindingContext");
    expect(source).toContain("./mention-finding-context.ts");
  });

  test("keeps mention agent instruction templates out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");
    const instructionsSource = readFileSync(new URL("./mention-agent-instructions.ts", import.meta.url), "utf8");

    expect(source).not.toContain("Plan-only request detected (plan:).");
    expect(source).not.toContain("NEVER fabricate checksums");
    expect(source).not.toContain("FORK_WRITE_POLICY_INSTRUCTIONS");
    expect(source).toContain("buildMentionAgentInstructions");
    expect(source).toContain("./mention-agent-instructions.ts");
    expect(instructionsSource).toContain("export function buildMentionAgentInstructions");
    expect(instructionsSource).toContain("FORK_WRITE_POLICY_INSTRUCTIONS");
  });

  test("keeps formatter suggestion runner binding out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const runFormatterSuggestionForMention = async");
    expect(source).toContain("createFormatterSuggestionMentionRunner");
    expect(source).toContain("./formatter-suggestion-orchestration.ts");
  });

  test("keeps explicit review prompt and routing assembly out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");
    const promptRuntimeSource = readFileSync(new URL("./mention-prompt-runtime.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const explicitReviewPrNumber = mention.prNumber");
    expect(source).not.toContain("const promptDiffContext = mention.baseRef");
    expect(source).not.toContain("const diffAnalysis = analyzeDiff({");
    expect(source).not.toContain("Mention review routing decision");
    expect(source).not.toContain("buildReviewPromptDetails({");
    expect(source).toContain("resolveMentionPromptRuntimeContext");
    expect(source).toContain("./mention-prompt-runtime.ts");
    expect(promptRuntimeSource).toContain("buildMentionExplicitReviewPrompt");
    expect(promptRuntimeSource).toContain("./mention-explicit-review-prompt.ts");
  });

  test("keeps mention prompt runtime branching out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("let prompt: string;");
    expect(source).not.toContain("let explicitReviewPromptFileCount: number | undefined;");
    expect(source).not.toContain("if (explicitReviewRequest && mention.prNumber !== undefined) {");
    expect(source).not.toContain("const mentionPromptResult = buildMentionPromptDetails({");
    expect(source).not.toContain("promptSections = [");
    expect(source).toContain("resolveMentionPromptRuntimeContext");
    expect(source).toContain("./mention-prompt-runtime.ts");
  });

  test("keeps PR diff prefetch fail-open orchestration out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("let prDiffContext: { stat: string; diff: string; truncated: boolean; fileCount: number } | undefined");
    expect(source).not.toContain("Pre-fetched PR diff for mention context");
    expect(source).not.toContain("collectCappedPrDiff({");
    expect(source).toContain("resolveMentionPrDiffContext");
    expect(source).toContain("./mention-pr-diff-context.ts");
  });

  test("keeps write-mode PR draft assembly out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");
    const routingSource = readFileSync(new URL("./mention-write-output-routing.ts", import.meta.url), "utf8");

    expect(source).not.toContain("git -C ${workspace.dir} diff --stat HEAD~1 HEAD");
    expect(source).not.toContain("scanDiffForFabricatedContent(workspace.dir)");
    expect(source).not.toContain("const prBody = generatePrBody({");
    expect(source).toContain("routeMentionWriteOutput");
    expect(routingSource).toContain("publishMentionBotWritePullRequest");
    expect(routingSource).toContain("publishMentionForkWriteOutput");
  });

  test("keeps write-mode PR publication out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");
    const routingSource = readFileSync(new URL("./mention-write-output-routing.ts", import.meta.url), "utf8");

    expect(source).not.toContain("createPullRequestWithPublicationPipeline");
    expect(source).toContain("routeMentionWriteOutput");
    expect(routingSource).toContain("publishMentionBotWritePullRequest");
    expect(routingSource).toContain("publishMentionForkWriteOutput");
  });

  test("keeps write-mode commit message assembly out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");
    const routingSource = readFileSync(new URL("./mention-write-output-routing.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const commitMessage = [");
    expect(source).not.toContain("deliveryId: ${event.id}");
    expect(source).toContain("routeMentionWriteOutput");
    expect(routingSource).toContain("publishMentionBotWritePullRequest");
    expect(routingSource).toContain("publishMentionForkWriteOutput");
  });

  test("keeps issue code pointer context assembly out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("## Candidate Code Pointers");
    expect(source).not.toContain("Failed to build issue code context; proceeding without code pointers");
    expect(source).not.toContain("sectionName: \"candidate-code-pointers\"");
    expect(source).toContain("appendMentionIssueCodePointers");
    expect(source).toContain("./mention-code-pointers.ts");
  });

  test("keeps mention prompt context routing policy out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const allowIssueCodePointers =");
    expect(source).not.toContain("const isPrMention = mention.prNumber !== undefined;");
    expect(source).not.toContain("const allowPrDiffContext = isPrMention;");
    expect(source).not.toContain("const includeIssueCorpus = !isPrMention;");
    expect(source).toContain("resolveMentionPromptContextRouting");
    expect(source).toContain("./mention-prompt-context-routing.ts");
  });

  test("keeps mention-derived context cache orchestration out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("buildMentionContextFingerprint(octokit, mention");
    expect(source).not.toContain("mentionDerivedContextCache.getOrLoad");
    expect(source).not.toContain("mentionDerivedContextCacheErrorCount > cacheErrorsBeforeLookup");
    expect(source).not.toContain("context-build-failed");
    expect(source).toContain("buildMentionDerivedContext");
    expect(source).toContain("./mention-derived-context.ts");
  });

  test("keeps same-repo PR write branch updates out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");
    const routingSource = readFileSync(new URL("./mention-write-output-routing.ts", import.meta.url), "utf8");

    expect(source).not.toContain("remoteHeadContainsMarker({");
    expect(source).not.toContain("commitAndPushToRemoteRef({");
    expect(source).not.toContain("pushHeadToRemoteRef({");
    expect(source).not.toContain("git -C ${workspace.dir} checkout -B pr-head");
    expect(source).not.toContain("Applied changes but failed to post confirmation reply");
    expect(source).toContain("routeMentionWriteOutput");
    expect(routingSource).toContain("attemptSameRepoPrWrite");
    expect(routingSource).toContain("./mention-same-repo-write.ts");
  });

  test("keeps bot-branch PR write publication out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");
    const routingSource = readFileSync(new URL("./mention-write-output-routing.ts", import.meta.url), "utf8");

    expect(source).not.toContain("Failed to look up existing PR after push failure");
    expect(source).not.toContain("Issue write-mode PR creation failed, retrying once");
    expect(source).not.toContain("GitHub pulls.create response did not include html_url");
    expect(source).not.toContain("outcome: \"created-pr\"");
    expect(source).toContain("routeMentionWriteOutput");
    expect(routingSource).toContain("publishMentionBotWritePullRequest");
    expect(routingSource).toContain("./mention-bot-pr-write.ts");
  });

  test("keeps fork/gist write output routing out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("getGitStatusPorcelain(workspace.dir)");
    expect(source).not.toContain("buildNoFileChangesReply()");
    expect(source).not.toContain("publishMentionForkWriteOutput({");
    expect(source).not.toContain("attemptSameRepoPrWrite({");
    expect(source).not.toContain("publishMentionBotWritePullRequest({");
    expect(source).not.toContain("const useGist = shouldUseGist({ keyword: writeIntent.keyword }, changedFiles);");
    expect(source).not.toContain("Gist creation failed; falling through to PR path");
    expect(source).not.toContain("outcome: \"created-gist\"");
    expect(source).not.toContain("outcome: \"created-cross-fork-pr\"");
    expect(source).not.toContain("Fork-based PR creation failed; falling back to gist");
    expect(source).not.toContain("Fork-based write mode failed completely; falling through to legacy direct-push path");
    expect(source).toContain("routeMentionWriteOutput");
    expect(source).toContain("./mention-write-output-routing.ts");
  });

  test("keeps pre-workspace fork setup orchestration out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("forkManager.ensureFork");
    expect(source).not.toContain("forkManager.syncFork");
    expect(source).not.toContain("Write-mode active without BOT_USER_PAT");
    expect(source).not.toContain("Fork setup failed; will fall back to gist or legacy mode");
    expect(source).toContain("resolveMentionForkContext");
    expect(source).toContain("./mention-fork-context.ts");
  });
});
