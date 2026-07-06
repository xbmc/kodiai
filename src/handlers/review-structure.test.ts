import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

describe("review handler structure", () => {
  test("keeps Review Details body assembly out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const buildReviewDetailsBody =");
    expect(source).toContain("./review-details-body.ts");
  });

  test("keeps Review Details publication runtime helpers out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const renderReviewDetailsBody =");
    expect(source).not.toContain("const finalizePublicationPhaseTiming =");
    expect(source).not.toContain("const logReviewDetailsPublicationCompleted =");
    expect(source).not.toContain("const logCanonicalReviewDetailsPublicationCompleted =");
    expect(source).toContain("./review-details-publication-runtime.ts");
  });

  test("keeps review work lifecycle helpers out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("function finalizeReviewWorkAttempt");
    expect(source).not.toContain("function setReviewWorkPhaseForAttempt");
    expect(source).not.toContain("function setReviewWorkPhase");
    expect(source).not.toContain("function canPublishVisibleOutput");
    expect(source).toContain("./review-work-runtime.ts");
  });

  test("keeps review execution completion log shaping out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("function logReviewExecutionCompleted");
    expect(source).not.toContain("let reviewExecutionLogged = false;");
    expect(source).not.toContain("const expectedTurnLimitOutcome = isExpectedTurnLimitOutcome(executorResult);");
    expect(source).toContain("createReviewExecutionCompletedLogger");
  });

  test("keeps review execution telemetry persistence out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("recordRateLimitEvent({\n              deliveryId: event.id");
    expect(source).not.toContain("recordRateLimitEvent({\n                          deliveryId: retryDeliveryId");
    expect(source).not.toContain("conclusion: result.isTimeout && result.published");
    expect(source).not.toContain("conclusion: retryResult.isTimeout && retryResult.published");
    expect(source).not.toContain("Retry derived-prompt reuse telemetry write failed (non-blocking)");
    expect(source).toContain("recordReviewExecutionTelemetry");
    expect(source).toContain("./review-telemetry.ts");
  });

  test("keeps review resilience telemetry persistence out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("await telemetryStore.recordResilienceEvent?.({");
    expect(source).toContain("recordReviewResilienceEventFailOpen");
    expect(source).toContain("./review-resilience-telemetry.ts");
  });

  test("keeps review knowledge persistence mechanics out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("knowledgeStore.recordReview({");
    expect(source).not.toContain("knowledgeStore.recordFindings(");
    expect(source).not.toContain("knowledgeStore.recordSuppressionLog(");
    expect(source).not.toContain("knowledgeStore.recordGlobalPattern({");
    expect(source).toContain("persistReviewKnowledge");
    expect(source).toContain("./review-knowledge-persistence.ts");
  });

  test("keeps review learning-memory batch orchestration out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("writeReviewLearningMemory({");
    expect(source).not.toContain("Learning memory write batch complete");
    expect(source).toContain("writeReviewLearningMemoryBatch");
    expect(source).toContain("./review-learning-memory.ts");
  });

  test("keeps post-execution side-effect mechanics out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("knowledgeStore.completeRun(runKey)");
    expect(source).not.toContain("updateExpertiseIncremental({");
    expect(source).not.toContain("const diffFiles = splitDiffByFile(diffContext.diffContent)");
    expect(source).not.toContain("embedReviewDiffHunks({");
    expect(source).toContain("completeReviewRunFailOpen");
    expect(source).toContain("scheduleContributorExpertiseUpdate");
    expect(source).toContain("scheduleReviewHunkEmbedding");
    expect(source).toContain("./review-post-execution-side-effects.ts");
  });

  test("keeps review cache telemetry fail-open helper out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("async function recordReviewCacheEventFailOpen");
    expect(source).not.toContain("Review cache telemetry store method unavailable (non-blocking)");
    expect(source).toContain("recordReviewCacheEventFailOpen");
  });

  test("keeps review prompt cache runtime out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("async function buildReviewPromptResultWithCache");
    expect(source).not.toContain("const cacheErrorsBeforeLookup = reviewPromptDerivedCacheErrorCount;");
    expect(source).toContain("./review-prompt-cache-runtime.ts");
  });

  test("keeps visible budget projection state out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const visibleReviewCacheObservations: ReviewCacheTelemetryObservation[] = [];");
    expect(source).not.toContain("const refreshReviewVisibleBudgetProjection = (): VisibleBudgetProjection | null =>");
    expect(source).not.toContain("buildVisibleBudgetProjectionFromEvidence({");
    expect(source).toContain("visibleBudgetState.refresh()");
    expect(source).toContain("./review-retrieval-context.ts");
  });

  test("keeps retrieval context assembly out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const variants = buildRetrievalVariants({");
    expect(source).not.toContain("const result = await retriever.retrieve({");
    expect(source).not.toContain("buildRetrievalReviewCacheEvent({");
    expect(source).not.toContain("await telemetryStore.recordRetrievalQuality({");
    expect(source).not.toContain("Retrieval context generation failed (fail-open, proceeding without retrieval)");
    expect(source).toContain("buildReviewRetrievalContext");
    expect(source).toContain("./review-retrieval-context.ts");
  });

  test("keeps dependency bump context assembly out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const detection = detectDepBump({");
    expect(source).not.toContain("depBumpContext.security = secResult.status === \"fulfilled\"");
    expect(source).not.toContain("depBumpContext.mergeConfidence = computeMergeConfidence(depBumpContext)");
    expect(source).not.toContain("depBumpContext.usageEvidence = result;");
    expect(source).not.toContain("depBumpContext.scopeGroups = groups;");
    expect(source).toContain("buildReviewDepBumpContext");
    expect(source).toContain("./review-dep-bump-context.ts");
  });

  test("keeps structural-impact graph selection out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const trivialCheck = isTrivialChange({");
    expect(source).not.toContain("const structuralImpact = await fetchReviewStructuralImpact");
    expect(source).not.toContain("summarizeStructuralImpactDegradation(structuralImpact.payload)");
    expect(source).not.toContain("Review structural-impact integration failed (fail-open, continuing with file-risk selection)");
    expect(source).toContain("resolveReviewStructuralImpactSelection");
    expect(source).toContain("./review-structural-impact-selection.ts");
  });

  test("keeps review runtime planning out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("let resolvedSeverityMinLevel = config.review.severity.minLevel");
    expect(source).not.toContain("const selectedPreset = PROFILE_PRESETS[profileSelection.selectedProfile]");
    expect(source).not.toContain("fileCount: changedFiles.length,\n          linesChanged: (diffAnalysis?.metrics.totalLinesAdded ?? 0)");
    expect(source).not.toContain("const reviewRouting = resolveReviewTaskRouting({\n          changedFileCount: changedFiles.length");
    expect(source).not.toContain("profileSelection.selectedProfile = \"minimal\"");
    expect(source).not.toContain("const reviewBoundedness = resolveReviewBoundedness({");
    expect(source).toContain("buildReviewRuntimePlan");
    expect(source).toContain("./review-runtime-plan.ts");
  });

  test("keeps prompt enrichment lookups out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const prText = [pr.title, pr.body ?? \"\", ...promptFiles.slice(0, 20)].join(\"\\n\")");
    expect(source).not.toContain("clusterPatternsForPrompt = await clusterMatcher({");
    expect(source).not.toContain("const diffSummaryParts: string[] = [];");
    expect(source).not.toContain("linkedIssueResult = await linkPRToIssues({");
    expect(source).toContain("buildReviewPromptEnrichment");
    expect(source).toContain("./review-prompt-enrichment.ts");
  });

  test("keeps no-review skip acknowledgment publication out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("Review skipped per `[no-review]` in PR title.");
    expect(source).not.toContain("Failed to post [no-review] acknowledgment");
    expect(source).toContain("./review-no-review-skip.ts");
    expect(source).toContain("postNoReviewSkipAcknowledgment");
  });

  test("keeps review cost warning publication out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("costWarningUsd: 5.0  # or 0 to disable");
    expect(source).not.toContain("Failed to post cost warning comment");
    expect(source).toContain("./review-cost-warning.ts");
    expect(source).toContain("maybePostReviewCostWarning");
  });

  test("keeps depends review publication out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const dependsFlowSource = readFileSync(new URL("./review-depends-flow.ts", import.meta.url), "utf8");

    expect(source).not.toContain("publishedDependsSummary = true");
    expect(source).not.toContain("publishedDependsInlineComments = true");
    expect(source).not.toContain("[depends] deep review inline comments");
    expect(source).toContain("./review-depends-flow.ts");
    expect(source).toContain("resolveReviewDependsFlow");
    expect(dependsFlowSource).toContain("./review-depends-publication.ts");
    expect(dependsFlowSource).toContain("publishDependsReviewOutput");
  });

  test("keeps bounded first-pass partial review publication out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const partialComment = await createIssueCommentWithPublicationPipeline");
    expect(source).not.toContain("partialCommentId = partialComment.data.id");
    expect(source).toContain("./review-partial-publication.ts");
    expect(source).toContain("publishBoundedFirstPassReview");
  });

  test("keeps review output idempotency gate out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const idempotencyCheck = await ensureReviewOutputNotPublished");
    expect(source).not.toContain("const canonicalSurfaceHasReviewDetails =");
    expect(source).not.toContain("Skipping review execution because output already published for key");
    expect(source).toContain("evaluateReviewOutputIdempotencyGate");
    expect(source).toContain("./review-idempotency-gate.ts");
  });

  test("keeps PR intent fetch/parse orchestration out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("fetchReviewCommitMessages(");
    expect(source).not.toContain("parsePRIntent(pr.title");
    expect(source).not.toContain("PR intent parsing failed (fail-open, proceeding without keywords)");
    expect(source).toContain("resolveReviewPrIntent");
    expect(source).toContain("./review-pr-intent.ts");
  });

  test("keeps author classification side-effect orchestration out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("let authorClassification: ReviewAuthorClassification =");
    expect(source).not.toContain("suggestIdentityLink({");
    expect(source).not.toContain("const rateLimitTelemetryEvent =");
    expect(source).toContain("resolveReviewAuthorContext");
    expect(source).toContain("./review-author-context.ts");
  });

  test("keeps depends deep-review pipeline orchestration out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("detectDependsBump(pr.title)");
    expect(source).not.toContain("buildDependsReviewContext({");
    expect(source).not.toContain("publishDependsReviewOutput({");
    expect(source).not.toContain("[depends] pipeline failed (fail-open, falling through to standard review)");
    expect(source).toContain("resolveReviewDependsFlow");
    expect(source).toContain("./review-depends-flow.ts");
  });

  test("keeps finalized Review Details timing updates out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("updateIssueCommentWithPublicationPipeline");
    expect(source).toContain("updateFinalizedReviewDetailsComment");
  });

  test("keeps retry custom instruction assembly out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("This is a retry of a timed-out review with reduced scope.");
    expect(source).not.toContain("This is a retry of a review that exhausted max turns with reduced scope.");
    expect(source).not.toContain("save_review_checkpoint with a summaryDraft");
    expect(source).toContain("buildReviewRetryCustomInstructions");
    expect(source).toContain("./review-retry-instructions.ts");
  });

  test("keeps clean review approval body assembly out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const cleanApprovalSource = readFileSync(new URL("./review-clean-approval.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const approvalEvidence = [");
    expect(source).not.toContain("Review prompt covered ${promptFiles.length} changed file");
    expect(source).not.toContain("renderApprovalConfidence(depBumpContext.mergeConfidence)");
    expect(source).not.toContain("buildCleanReviewApprovalBody");
    expect(cleanApprovalSource).toContain("buildCleanReviewApprovalBody");
    expect(source).toContain("./review-clean-approval-publication.ts");
  });

  test("keeps clean review approval publication orchestration out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const cleanReviewPublicationReason =");
    expect(source).not.toContain("const canonicalApprovalReview = await upsertCanonicalReviewSurface");
    expect(source).not.toContain("Skipping auto-approval because review output marker was published");
    expect(source).toContain("publishCleanReviewApproval");
    expect(source).toContain("./review-clean-approval-publication.ts");
  });

  test("keeps review execution error fallback body selection out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("let errorBody: string;");
    expect(source).not.toContain("errorBody = buildReviewTurnLimitFallbackBody");
    expect(source).not.toContain("errorBody = buildReviewRunErrorFallbackBody");
    expect(source).toContain("publishReviewExecutionErrorFallback");
  });

  test("keeps review execution error fallback publication out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const errorBody = buildReviewExecutionErrorFallbackBody");
    expect(source).not.toContain("reviewPublishResolution = exhaustedTurnBudget ? \"turn-limit-fallback\" : \"error-fallback\"");
    expect(source).not.toContain("reviewPublishResolution = exhaustedTurnBudget ? \"turn-limit-fallback-undelivered\" : \"error-comment-failed\"");
    expect(source).toContain("publishReviewExecutionErrorFallback");
    expect(source).toContain("./review-error-publication.ts");
  });

  test("keeps review handler failure error publication out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const errorBody = buildReviewHandlerFailureErrorBody");
    expect(source).not.toContain("await postOrUpdateErrorComment(errOctokit");
    expect(source).not.toContain("posted error comment after handler failure");
    expect(source).not.toContain("suppressed error comment after handler failure because publish rights were lost");
    expect(source).toContain("publishReviewHandlerFailureError");
    expect(source).toContain("./review-error-publication.ts");
  });

  test("keeps generic failure fallback publication out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const failureBody = buildReviewFailureFallbackBody();");
    expect(source).not.toContain("reviewPublishResolution = \"failure-fallback\"");
    expect(source).not.toContain("reviewPublishResolution = \"failure-fallback-failed\"");
    expect(source).toContain("publishReviewFailureFallback");
    expect(source).toContain("./review-failure-publication.ts");
  });

  test("keeps automatic review validation-truth projection out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("attachReviewValidationTruth({");
    expect(source).not.toContain("convertPublishedCandidateResultsToValidationTruthFixes({");
    expect(source).not.toContain("Projected review validation truth evidence");
    expect(source).not.toContain("Review validation truth diagnostics failed; continuing review publication");
    expect(source).toContain("projectAutomaticReviewValidationTruth");
    expect(source).toContain("./review-validation-truth.ts");
  });

  test("keeps review-requested reaction publication out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("createForIssue({");
    expect(source).not.toContain("Failed to add eyes reaction to PR");
    expect(source).toContain("postReviewRequestedEyesReaction");
    expect(source).toContain("./review-reactions.ts");
  });

  test("keeps review-requested target gating out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("\"requested_reviewer\" in reviewRequestedPayload");
    expect(source).not.toContain("normalizeReviewerLogin(requestedReviewerLogin)");
    expect(source).not.toContain("Skipping review_requested event for non-kodiai reviewer");
    expect(source).not.toContain("Skipping review_requested event because only a team was requested");
    expect(source).toContain("evaluateReviewRequestedGate");
    expect(source).toContain("./review-requested-gate.ts");
  });

  test("keeps review clone planning out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("let cloneOwner: string;");
    expect(source).not.toContain("const isDeletedFork = !headRepo;");
    expect(source).not.toContain("cloneRef = pr.base.ref;");
    expect(source).not.toContain("cloneRef = pr.head.ref;");
    expect(source).toContain("resolveReviewClonePlan");
    expect(source).toContain("./review-clone-plan.ts");
  });

  test("keeps review trigger config gating out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("gate: \"trigger-config\"");
    expect(source).not.toContain("if (!config.review.enabled)");
    expect(source).not.toContain("isReviewTriggerEnabled(action, config.review.triggers)");
    expect(source).not.toContain("Review trigger disabled in config, skipping");
    expect(source).toContain("evaluateReviewTriggerConfigGate");
    expect(source).toContain("./review-trigger-config-gate.ts");
  });

  test("keeps review skip-author gating out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("config.review.skipAuthors.includes(pr.user.login)");
    expect(source).not.toContain("PR author in skipAuthors, skipping review");
    expect(source).toContain("evaluateReviewSkipAuthorGate");
    expect(source).toContain("./review-skip-author-gate.ts");
  });

  test("keeps incremental diff fail-open orchestration out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("let incrementalResult: IncrementalDiffResult | null = null;");
    expect(source).not.toContain("computeIncrementalDiff({");
    expect(source).not.toContain("Incremental diff computation failed (fail-open, full review)");
    expect(source).toContain("resolveReviewIncrementalDiff");
    expect(source).toContain("./review-incremental-diff.ts");
  });

  test("keeps incremental review file filtering out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("let reviewFiles = changedFiles;");
    expect(source).not.toContain("new Set(incrementalResult.changedFilesSinceLastReview)");
    expect(source).not.toContain("Filtered to incremental changed files");
    expect(source).toContain("resolveReviewFilesForIncrementalReview");
    expect(source).toContain("./review-incremental-diff.ts");
  });

  test("keeps skipPaths matching and skip logging out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const skipMatchers = config.review.skipPaths");
    expect(source).not.toContain(".map(normalizeSkipPattern)");
    expect(source).not.toContain("picomatch(p, { dot: true })");
    expect(source).not.toContain("All changed files matched skipPaths, skipping review");
    expect(source).toContain("evaluateReviewSkipPathsGate");
    expect(source).toContain("./review-skip-paths-gate.ts");
  });

  test("keeps shadow specialist subflow orchestration out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("let shadowSpecialistResult");
    expect(source).not.toContain("buildShadowSpecialistDiffSnippet(diffContentForValidation)");
    expect(source).not.toContain("buildShadowSpecialistLogFields(shadowSpecialistResult)");
    expect(source).not.toContain("projectShadowSpecialistMetrics(shadowSpecialistResult)");
    expect(source).toContain("resolveReviewShadowSpecialistContext");
    expect(source).toContain("./review-shadow-specialist.ts");
  });
});
