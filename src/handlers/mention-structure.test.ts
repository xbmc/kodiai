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

    expect(source).not.toContain("const normalizeName =");
    expect(source).not.toContain("git -C ${workspace.dir} log -n 50");
    expect(source).toContain("./mention-pr-write.ts");
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

    expect(source).not.toContain("const reviewPartialFailure =");
    expect(source).not.toContain("const formatterPartialFailure =");
    expect(source).not.toContain("expectedBoundedCleanFormatter");
    expect(source).not.toContain("combinedPartialFailure: reviewPartialFailure");
    expect(source).not.toContain("formatterPartialFailure: formatterResult.partialFailure ?? false");
    expect(source).toContain("buildCombinedReviewAndFormatMentionLogFields");
    expect(source).toContain("buildCombinedReviewAndFormatThrownMentionLogFields");
  });

  test("keeps format-only formatter log shaping out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("partialFailure: formatterResult.partialFailure ?? false");
    expect(source).toContain("buildFormatOnlyMentionLogFields");
  });

  test("keeps accepted mention handle normalization out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("acceptedBodyLower");
    expect(source).not.toContain(".map((h) => (h.startsWith(\"@\") ? h : `@${h}`))");
    expect(source).toContain("./mention-handle-match.ts");
    expect(source).toContain("buildAcceptedMentionHandles");
    expect(source).toContain("mentionBodyMatchesAcceptedHandles");
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

    expect(source).not.toContain("const postIssueWriteFailure = async");
    expect(source).toContain("createIssueWriteFailurePoster");
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

    expect(source).not.toContain("const failureFallbackBody = buildMentionFailureFallbackBody");
    expect(source).not.toContain("publishResolution = \"turn-limit-fallback-failed\"");
    expect(source).not.toContain("publishResolution = \"failure-fallback-failed\"");
    expect(source).not.toContain("Failed to post turn-limit notice (non-blocking)");
    expect(source).not.toContain("Failed to post failure fallback notice (non-blocking)");
    expect(source).toContain("publishMentionFailureFallback");
    expect(source).toContain("./mention-failure-publication.ts");
  });

  test("keeps execution success and error fallback publication out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const fallbackBody = buildMentionSuccessFallbackBody");
    expect(source).not.toContain("const errorBody = buildMentionErrorFallbackBody");
    expect(source).not.toContain("publishResolution = \"error-comment-failed\"");
    expect(source).toContain("publishMentionSuccessFallback");
    expect(source).toContain("publishMentionErrorFallback");
    expect(source).toContain("./mention-result-fallback-publication.ts");
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

    expect(source).not.toContain("const explicitReviewPrNumber = mention.prNumber");
    expect(source).not.toContain("const promptDiffContext = mention.baseRef");
    expect(source).not.toContain("const diffAnalysis = analyzeDiff({");
    expect(source).not.toContain("Mention review routing decision");
    expect(source).not.toContain("buildReviewPromptDetails({");
    expect(source).toContain("buildMentionExplicitReviewPrompt");
    expect(source).toContain("./mention-explicit-review-prompt.ts");
  });

  test("keeps write-mode PR draft assembly out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("git -C ${workspace.dir} diff --stat HEAD~1 HEAD");
    expect(source).not.toContain("scanDiffForFabricatedContent(workspace.dir)");
    expect(source).not.toContain("const prBody = generatePrBody({");
    expect(source).toContain("publishMentionBotWritePullRequest");
    expect(source).toContain("publishMentionForkWriteOutput");
  });

  test("keeps write-mode PR publication out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("createPullRequestWithPublicationPipeline");
    expect(source).toContain("publishMentionBotWritePullRequest");
    expect(source).toContain("publishMentionForkWriteOutput");
  });

  test("keeps write-mode commit message assembly out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const commitMessage = [");
    expect(source).not.toContain("deliveryId: ${event.id}");
    expect(source).toContain("publishMentionBotWritePullRequest");
    expect(source).toContain("publishMentionForkWriteOutput");
  });

  test("keeps issue code pointer context assembly out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("## Candidate Code Pointers");
    expect(source).not.toContain("Failed to build issue code context; proceeding without code pointers");
    expect(source).not.toContain("sectionName: \"candidate-code-pointers\"");
    expect(source).toContain("appendMentionIssueCodePointers");
    expect(source).toContain("./mention-code-pointers.ts");
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

    expect(source).not.toContain("remoteHeadContainsMarker({");
    expect(source).not.toContain("commitAndPushToRemoteRef({");
    expect(source).not.toContain("pushHeadToRemoteRef({");
    expect(source).not.toContain("git -C ${workspace.dir} checkout -B pr-head");
    expect(source).not.toContain("Applied changes but failed to post confirmation reply");
    expect(source).toContain("attemptSameRepoPrWrite");
    expect(source).toContain("./mention-same-repo-write.ts");
  });

  test("keeps bot-branch PR write publication out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("Failed to look up existing PR after push failure");
    expect(source).not.toContain("Issue write-mode PR creation failed, retrying once");
    expect(source).not.toContain("GitHub pulls.create response did not include html_url");
    expect(source).not.toContain("outcome: \"created-pr\"");
    expect(source).toContain("publishMentionBotWritePullRequest");
    expect(source).toContain("./mention-bot-pr-write.ts");
  });

  test("keeps fork/gist write output routing out of the monster handler", () => {
    const source = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const useGist = shouldUseGist({ keyword: writeIntent.keyword }, changedFiles);");
    expect(source).not.toContain("Gist creation failed; falling through to PR path");
    expect(source).not.toContain("outcome: \"created-gist\"");
    expect(source).not.toContain("outcome: \"created-cross-fork-pr\"");
    expect(source).not.toContain("Fork-based PR creation failed; falling back to gist");
    expect(source).not.toContain("Fork-based write mode failed completely; falling through to legacy direct-push path");
    expect(source).toContain("publishMentionForkWriteOutput");
    expect(source).toContain("./mention-fork-write-output.ts");
  });
});
