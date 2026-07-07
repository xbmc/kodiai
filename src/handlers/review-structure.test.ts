import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

describe("review handler structure", () => {
  test("keeps the review handler below the current decomposition line budget", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source.split("\n").length).toBeLessThanOrEqual(1800);
  });

  test("keeps Review Details body assembly out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const runtimeSource = readFileSync(new URL("./review-details-publication-runtime.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const buildReviewDetailsBody =");
    expect(source).toContain("createReviewDetailsPublicationRuntime");
    expect(source).toContain("./review-details-publication-runtime.ts");
    expect(runtimeSource).toContain("./review-details-body.ts");
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
    const eventRuntimeSource = readFileSync(new URL("./review-event-runtime.ts", import.meta.url), "utf8");

    expect(source).not.toContain("function finalizeReviewWorkAttempt");
    expect(source).not.toContain("function setReviewWorkPhaseForAttempt");
    expect(source).not.toContain("function setReviewWorkPhase");
    expect(source).not.toContain("function canPublishVisibleOutput");
    expect(source).toContain("./review-event-runtime.ts");
    expect(eventRuntimeSource).toContain("./review-work-runtime.ts");
  });

  test("keeps handler-local review coordinator fallback policy out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const reviewWorkCoordinator = injectedReviewWorkCoordinator ?? createReviewWorkCoordinator();");
    expect(source).not.toContain("Review work coordinator not injected; using a private handler-local fallback");
    expect(source).toContain("createReviewHandlerRuntime");
    expect(source).toContain("./review-handler-runtime.ts");
  });

  test("keeps handler-local review runtime setup out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const runtimeSource = readFileSync(new URL("./review-handler-runtime.ts", import.meta.url), "utf8");

    expect(source).not.toContain("createGuardrailAuditStore(sql)");
    expect(source).not.toContain("createStructuralImpactCache()");
    expect(source).not.toContain("createSearchCache<PromptBuildResult>");
    expect(source).not.toContain("let reviewPromptDerivedCacheErrorCount = 0;");
    expect(source).toContain("createReviewHandlerRuntime");
    expect(runtimeSource).toContain("createGuardrailAuditStore");
    expect(runtimeSource).toContain("createStructuralImpactCache");
    expect(runtimeSource).toContain("resolveReviewWorkCoordinator");
  });

  test("keeps review execution completion log shaping out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const runtimeSource = readFileSync(new URL("./review-job-runtime.ts", import.meta.url), "utf8");

    expect(source).not.toContain("function logReviewExecutionCompleted");
    expect(source).not.toContain("let reviewExecutionLogged = false;");
    expect(source).not.toContain("const expectedTurnLimitOutcome = isExpectedTurnLimitOutcome(executorResult);");
    expect(source).toContain("./review-job-runtime.ts");
    expect(runtimeSource).toContain("createReviewExecutionCompletedLogger");
  });

  test("keeps queued review job runtime setup out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const runtimeSource = readFileSync(new URL("./review-job-runtime.ts", import.meta.url), "utf8");

    expect(source).not.toContain("new Map<ReviewPhaseName, ReviewPhaseTiming>()");
    expect(source).not.toContain("buildQueueWaitPhase(queueMetadata)");
    expect(source).not.toContain("const totalPhaseStartAt = isValidQueueWaitMetadata(queueMetadata)");
    expect(source).not.toContain("let reviewPublishFallbackDelivery: string | undefined;");
    expect(source).not.toContain("createReviewContinuationFamilyStateManager({");
    expect(source).toContain("createReviewJobRuntime");
    expect(source).toContain("./review-job-runtime.ts");
    expect(runtimeSource).toContain("createReviewExecutionCompletedLogger");
    expect(runtimeSource).toContain("createReviewContinuationFamilyStateManager");
  });

  test("keeps review workspace phase hooks out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const hooksSource = readFileSync(new URL("./review-workspace-phase-hooks.ts", import.meta.url), "utf8");

    expect(source).not.toContain("setReviewWorkPhase(\"workspace-create\");\n        timingState.workspacePhaseStartedAt = Date.now();");
    expect(source).not.toContain("onBeforeFinalizeConfig: () => setReviewWorkPhase(\"load-config\")");
    expect(source).toContain("createReviewWorkspacePhaseHooks");
    expect(source).toContain("./review-workspace-phase-hooks.ts");
    expect(hooksSource).toContain("workspace-create");
    expect(hooksSource).toContain("load-config");
  });

  test("keeps review job queue context projection out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const jobContextSource = readFileSync(new URL("./review-job-context.ts", import.meta.url), "utf8");
    const retryEnqueueSource = readFileSync(new URL("./review-timeout-retry-enqueue.ts", import.meta.url), "utf8");

    expect(source).not.toContain("jobType: \"pull-request-review\"");
    expect(source).not.toContain("jobType: \"pull-request-review-retry\"");
    expect(source).not.toContain("action: `review-retry`");
    expect(source).toContain("buildReviewJobQueueContext");
    expect(source).toContain("./review-job-context.ts");
    expect(retryEnqueueSource).toContain("buildReviewRetryJobQueueContext");
    expect(jobContextSource).toContain("export function buildReviewJobQueueContext");
    expect(jobContextSource).toContain("export function buildReviewRetryJobQueueContext");
  });

  test("keeps review fallback publication orchestration out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const orchestrationSource = readFileSync(
      new URL("./review-fallback-publication-orchestration.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("const errorPublication = await publishReviewExecutionErrorFallback");
    expect(source).not.toContain("const failurePublication = await publishReviewFailureFallback");
    expect(source).not.toContain("const cleanReviewPublication = await publishCleanReviewApproval");
    expect(source).not.toContain("applyReviewFallbackPublicationStatePatch(");
    expect(source).not.toContain("getOctokit: () => githubApp.getInstallationOctokit(event.installationId),\n          getAppSlug: () => githubApp.getAppSlug(),");
    expect(source).not.toContain("refreshVisibleBudgetProjection: () => visibleBudgetState.refresh()");
    expect(source).toContain("buildReviewFallbackPublicationAdapters");
    expect(source).toContain("publishAndApplyReviewFallbackOutputs");
    expect(source).toContain("./review-fallback-publication-orchestration.ts");
    expect(orchestrationSource).toContain("export function buildReviewFallbackPublicationAdapters");
    expect(orchestrationSource).toContain("export async function publishAndApplyReviewFallbackOutputs");
    expect(orchestrationSource).toContain("export async function publishReviewFallbackOutputs");
    expect(orchestrationSource).toContain("export function applyReviewFallbackPublicationStatePatch");
  });

  test("keeps review execution outcome fallback policy out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const exhaustedTurnBudget =");
    expect(source).not.toContain("result.stopReason === \"max_turns\"");
    expect(source).not.toContain("result.failureSubtype === \"error_max_turns\"");
    expect(source).not.toContain("const category = exhaustedTurnBudget");
    expect(source).not.toContain("const timeoutDuration = appliedTimeoutBudget?.totalTimeoutSeconds ?? config.timeoutSeconds;");
    expect(source).toContain("resolveReviewExecutionOutcomeContext");
    expect(source).toContain("./review-execution-outcome.ts");
  });

  test("keeps review reducer fail-open runtime out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const runtimeSource = readFileSync(new URL("./review-reducer-runtime.ts", import.meta.url), "utf8");
    const preparationSource = readFileSync(
      new URL("./review-candidate-publication-preparation.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("malformed-review-reducer-result");
    expect(source).not.toContain("reducer-exception");
    expect(source).not.toContain("createDegradedReviewReducerResult");
    expect(source).not.toContain("logReviewReducerResult({");
    expect(source).toContain("resolveReviewCandidatePublicationPreparation");
    expect(preparationSource).toContain("runReviewReducerFailOpen");
    expect(preparationSource).toContain("./review-reducer-runtime.ts");
    expect(runtimeSource).toContain("createDegradedReviewReducerResult");
    expect(runtimeSource).toContain("logReviewReducerResult");
  });

  test("keeps review reducer input projection out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const inputSource = readFileSync(new URL("./review-reducer-input.ts", import.meta.url), "utf8");
    const preparationSource = readFileSync(
      new URL("./review-candidate-publication-preparation.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("const commentSlopFindings = toCommentSlopReducerFindings");
    expect(source).not.toContain("const candidateReducerFindings = toReviewCandidateReducerDrafts");
    expect(source).not.toContain("const reviewReducerInput: ReviewReducerInput = {");
    expect(source).toContain("resolveReviewCandidatePublicationPreparation");
    expect(preparationSource).toContain("buildReviewReducerInput");
    expect(preparationSource).toContain("./review-reducer-input.ts");
    expect(inputSource).toContain("export function buildReviewReducerInput");
    expect(inputSource).toContain("toCommentSlopReducerFindings");
    expect(inputSource).toContain("toReviewCandidateReducerDrafts");
  });

  test("keeps timeout progress context assembly out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const checkpoint = (await knowledgeStore?.getCheckpoint?.(reviewOutputKey)) ?? null;");
    expect(source).not.toContain("const timeoutInlineFindings = hasPublishedInlines");
    expect(source).not.toContain("const timeoutReviewedFiles = Array.from(new Set([");
    expect(source).not.toContain("const timeoutFirstPass = normalizeReviewFirstPass({");
    expect(source).not.toContain("getCheckpoint: async (key) => (await knowledgeStore?.getCheckpoint?.(key)) ?? null");
    expect(source).not.toContain("extractInlineFindings: async () => await extractFindingsFromReviewComments({");
    expect(source).toContain("buildReviewTimeoutProgressAdapters");
    expect(source).toContain("resolveReviewTimeoutProgressContext");
    expect(source).toContain("./review-timeout-progress-context.ts");
  });

  test("keeps timeout retry decision policy out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("let retryState = isChronicTimeout");
    expect(source).not.toContain("let retrySummaryNote: string | undefined;");
    expect(source).not.toContain("case \"zero-evidence-failure\": {");
    expect(source).not.toContain("const retryRemoteRuntimeBudgetSeconds = Math.max(30, Math.floor(timeoutDuration / 2));");
    expect(source).not.toContain("const retryScope = computeRetryScope({");
    expect(source).toContain("resolveReviewTimeoutRetryContext");
    expect(source).toContain("./review-timeout-retry-context.ts");
  });

  test("keeps timeout classification projection and logging out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const classificationSource = readFileSync(
      new URL("./review-timeout-classification-context.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("const retryClassificationInput =");
    expect(source).not.toContain("const timeoutClassification = classifyReviewTimeoutOutcome({");
    expect(source).not.toContain("const timeoutClassificationTelemetry = logReviewTimeoutClassification({");
    expect(source).toContain("resolveReviewTimeoutClassificationContext");
    expect(source).toContain("./review-timeout-classification-context.ts");
    expect(classificationSource).toContain("classifyReviewTimeoutOutcome");
    expect(classificationSource).toContain("logReviewTimeoutClassification");
  });

  test("keeps timeout publication summary and partial body policy out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const summaryDraftBase = checkpoint?.summaryDraft");
    expect(source).not.toContain("const summaryDraft = retrySummaryNote");
    expect(source).not.toContain("const timeoutReviewDetails = {");
    expect(source).not.toContain("deferredPublicOutputForContinuation = turnBudgetExhausted");
    expect(source).not.toContain("const partialBody = formatPartialReviewComment({");
    expect(source).toContain("resolveReviewTimeoutPublicationContext");
    expect(source).toContain("./review-timeout-publication-context.ts");
  });

  test("keeps timeout execution-conclusion projection out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const timeoutExecutionSource = readFileSync(new URL("./review-timeout-execution-context.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const recentTimeouts = await telemetryStore.countRecentTimeouts?.");
    expect(source).not.toContain("countRecentTimeouts: (repo, prAuthor) => telemetryStore.countRecentTimeouts?.(repo, prAuthor)");
    expect(source).not.toContain("const isChronicTimeout = recentTimeouts >= 3;");
    expect(source).not.toContain("const executionConclusion = result.isTimeout && result.published");
    expect(source).toContain("buildReviewTimeoutExecutionAdapters");
    expect(source).toContain("resolveReviewTimeoutExecutionContext");
    expect(source).toContain("./review-timeout-execution-context.ts");
    expect(timeoutExecutionSource).toContain("export function buildReviewTimeoutExecutionAdapters");
  });

  test("keeps partial review checkpoint persistence out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const orchestrationSource = readFileSync(
      new URL("./review-bounded-first-pass-timeout-publication.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("knowledgeStore?.updateCheckpointCommentId?.(reviewOutputKey, partialCommentId)");
    expect(source).not.toContain("Checkpoint comment id update failed (non-blocking)");
    expect(source).toContain("publishBoundedFirstPassTimeoutOutput");
    expect(orchestrationSource).toContain("persistPartialReviewCheckpoint");
    expect(orchestrationSource).toContain("./review-partial-checkpoint.ts");
  });

  test("keeps retry enqueue field projection out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const retryReviewOutputKey = retryPlan.continuationReviewOutputKey;");
    expect(source).not.toContain("const retryTimeout = retryPlan.timeoutSeconds;");
    expect(source).not.toContain("const retryFiles = retryPlan.continuationFiles;");
    expect(source).not.toContain("const retryDeliveryId = `${event.id}-retry-1`;");
    expect(source).toContain("resolveReviewRetryEnqueueContext");
    expect(source).toContain("./review-retry-enqueue-context.ts");
  });

  test("keeps timeout continuation-family state policy out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("if (timeoutFirstPass?.state === \"zero-evidence-failure\")");
    expect(source).not.toContain("if (retryPlan?.decision !== \"schedule-continuation\")");
    expect(source).not.toContain("authoritativeOutcome: \"blocked\"");
    expect(source).not.toContain("projectionStatus: continuationProjectionDegraded ? \"degraded\" : \"canonical\"");
    expect(source).toContain("resolveReviewTimeoutContinuationState");
    expect(source).toContain("./review-timeout-continuation-state.ts");
  });

  test("keeps retry continuation-family state projections out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const preEnqueueSource = readFileSync(
      new URL("./review-timeout-retry-pre-enqueue.ts", import.meta.url),
      "utf8",
    );
    const retrySettlementSource = readFileSync(new URL("./review-retry-settlement.ts", import.meta.url), "utf8");
    const retryMergeSource = readFileSync(new URL("./review-retry-merge-publication.ts", import.meta.url), "utf8");

    expect(source).not.toContain("authoritativeOutcome: \"continuation-pending\"");
    expect(source).not.toContain("authoritativeOutcome: \"quiet-settled\"");
    expect(source).not.toContain("authoritativeOutcome: \"merged\"");
    expect(source).not.toContain("finalStopReason: \"awaiting-continuation\"");
    expect(source).not.toContain("finalStopReason: \"settled-without-update\"");
    expect(source).not.toContain("finalStopReason: \"merged-continuation-results\"");
    expect(source).toContain("scheduleReviewTimeoutRetryContinuation");
    expect(preEnqueueSource).toContain("resolvePendingContinuationFamilyState");
    expect(preEnqueueSource).toContain("./review-continuation-family-state-projection.ts");
    expect(retrySettlementSource).toContain("resolveQuietSettledContinuationFamilyState");
    expect(retryMergeSource).toContain("resolveMergedContinuationFamilyState");
  });

  test("keeps retry no-additional-results settlement policy out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const retryContinuationSettlementSource = readFileSync(new URL("./review-retry-continuation-settlement.ts", import.meta.url), "utf8");
    const retryJobSource = readFileSync(new URL("./review-timeout-retry-job.ts", import.meta.url), "utf8");

    expect(source).not.toContain("Retry produced no additional results -- keeping original partial review");
    expect(source).not.toContain("resolveQuietSettledContinuationFamilyState({");
    expect(source).toContain("scheduleReviewTimeoutRetryContinuation");
    expect(retryJobSource).toContain("settleRetryContinuationResults");
    expect(retryContinuationSettlementSource).toContain("settleRetryWithNoAdditionalResults");

    const retrySettlementSource = readFileSync(new URL("./review-retry-settlement.ts", import.meta.url), "utf8");
    expect(retrySettlementSource).toContain("resolveQuietSettledContinuationFamilyState");
    expect(retrySettlementSource).toContain("Retry produced no additional results -- keeping original partial review");
  });

  test("keeps timeout retry job execution mechanics out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const retryJobSource = readFileSync(new URL("./review-timeout-retry-job.ts", import.meta.url), "utf8");

    expect(source).not.toContain("prepareReviewRetryWorkspace({");
    expect(source).not.toContain("const retryResult = await executor.execute(buildReviewRetryExecutionContext({");
    expect(source).not.toContain("await resolveReviewRetryExecutionOutcome({");
    expect(source).not.toContain("await settleRetryContinuationResults({");
    expect(source).toContain("scheduleReviewTimeoutRetryContinuation");
    expect(source).toContain("./review-timeout-retry-scheduling.ts");
    expect(retryJobSource).toContain("prepareReviewRetryWorkspace({");
    expect(retryJobSource).toContain("buildReviewRetryExecutionContext({");
    expect(retryJobSource).toContain("resolveReviewRetryExecutionOutcome({");
    expect(retryJobSource).toContain("settleRetryContinuationResults({");
  });

  test("keeps review execution telemetry persistence out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const postExecutionSource = readFileSync(new URL("./review-post-execution-telemetry.ts", import.meta.url), "utf8");

    expect(source).not.toContain("recordRateLimitEvent({\n              deliveryId: event.id");
    expect(source).not.toContain("recordRateLimitEvent({\n                          deliveryId: retryDeliveryId");
    expect(source).not.toContain("conclusion: result.isTimeout && result.published");
    expect(source).not.toContain("conclusion: retryResult.isTimeout && retryResult.published");
    expect(source).not.toContain("Retry derived-prompt reuse telemetry write failed (non-blocking)");
    expect(source).toContain("recordReviewPostExecutionTelemetry");
    expect(source).toContain("./review-post-execution-telemetry.ts");
    expect(postExecutionSource).toContain("recordReviewExecutionTelemetry");
    expect(postExecutionSource).toContain("./review-telemetry.ts");
  });

  test("keeps first-pass telemetry and cost-warning orchestration out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const postExecutionSource = readFileSync(new URL("./review-post-execution-telemetry.ts", import.meta.url), "utf8");

    expect(source).not.toContain("if (config.telemetry.enabled) {\n          await recordReviewExecutionTelemetry");
    expect(source).not.toContain("recordReviewExecutionTelemetry({");
    expect(source).not.toContain("maybePostReviewCostWarning({");
    expect(source).toContain("recordReviewPostExecutionTelemetry");
    expect(source).toContain("./review-post-execution-telemetry.ts");
    expect(postExecutionSource).toContain("recordReviewExecutionTelemetry");
    expect(postExecutionSource).toContain("maybePostReviewCostWarning");
  });

  test("keeps post-execution telemetry publication adapters out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const adapterSource = readFileSync(
      new URL("./review-post-execution-telemetry-context.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("getOctokit: () => githubApp.getInstallationOctokit(event.installationId),\n          botHandles: [githubApp.getAppSlug(), \"claude\"],");
    expect(source).toContain("buildReviewPostExecutionTelemetryPublicationContext");
    expect(source).toContain("./review-post-execution-telemetry-context.ts");
    expect(adapterSource).toContain("export function buildReviewPostExecutionTelemetryPublicationContext");
  });

  test("keeps author expertise prompt projection out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const authorContextSource = readFileSync(new URL("./review-author-context.ts", import.meta.url), "utf8");
    const initialPreparationSource = readFileSync(new URL("./review-initial-prompt-preparation.ts", import.meta.url), "utf8");
    const retryPreparationSource = readFileSync(new URL("./review-retry-prompt-preparation.ts", import.meta.url), "utf8");
    const retryJobSource = readFileSync(new URL("./review-timeout-retry-job.ts", import.meta.url), "utf8");

    expect(source).not.toContain("authorClassification.expertise?.map");
    expect(source).not.toContain("dimension: e.dimension");
    expect(source).not.toContain("topic: e.topic");
    expect(source).not.toContain("score: e.score");
    expect(source).toContain("prepareInitialReviewPrompt");
    expect(source).toContain("scheduleReviewTimeoutRetryContinuation");
    expect(retryJobSource).toContain("prepareRetryReviewPrompt");
    expect(initialPreparationSource).toContain("projectReviewAuthorExpertiseForPrompt");
    expect(retryPreparationSource).toContain("projectReviewAuthorExpertiseForPrompt");
    expect(authorContextSource).toContain("projectReviewAuthorExpertiseForPrompt");
  });

  test("keeps review resilience telemetry persistence out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const preEnqueueSource = readFileSync(
      new URL("./review-timeout-retry-pre-enqueue.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("await telemetryStore.recordResilienceEvent?.({");
    expect(source).not.toMatch(/recordReviewResilienceEventFailOpen\(\{[\s\S]{0,200}entry:\s*\{/);
    expect(source).toContain("scheduleReviewTimeoutRetryContinuation");
    expect(preEnqueueSource).toContain("recordReviewTimeoutResilienceTelemetry");
    expect(preEnqueueSource).toContain("./review-timeout-resilience-telemetry.ts");
  });

  test("keeps timeout resilience telemetry entry assembly out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const timeoutTelemetrySource = readFileSync(
      new URL("./review-timeout-resilience-telemetry.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("buildReviewTimeoutResilienceTelemetryEntry({");
    expect(source).not.toContain("recordReviewResilienceEventFailOpen({");
    expect(source).toContain("scheduleReviewTimeoutRetryContinuation");
    expect(timeoutTelemetrySource).toContain("recordReviewTimeoutResilienceTelemetry");
    expect(timeoutTelemetrySource).toContain("buildReviewTimeoutResilienceTelemetryEntry({");
    expect(timeoutTelemetrySource).toContain("recordReviewResilienceEventFailOpen({");
  });

  test("keeps review knowledge persistence mechanics out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const persistenceSource = readFileSync(new URL("./review-knowledge-persistence.ts", import.meta.url), "utf8");

    expect(source).not.toContain("knowledgeStore.recordReview({");
    expect(source).not.toContain("knowledgeStore.recordFindings(");
    expect(source).not.toContain("knowledgeStore.recordSuppressionLog(");
    expect(source).not.toContain("knowledgeStore.recordGlobalPattern({");
    expect(source).not.toContain("configSnapshot: JSON.stringify({");
    expect(source).not.toContain("reviewRecord: {");
    expect(source).not.toContain("buildReviewKnowledgeConfigSnapshot({");
    expect(source).not.toContain("const knowledgePersistence = await persistReviewKnowledge({");
    expect(source).not.toContain("buildReviewKnowledgeRecord({");
    expect(source).toContain("persistReviewKnowledgeIfAvailable");
    expect(source).toContain("./review-knowledge-persistence.ts");
    expect(persistenceSource).toContain("buildReviewKnowledgeConfigSnapshot");
    expect(persistenceSource).toContain("buildReviewKnowledgeRecord");
    expect(persistenceSource).toContain("persistReviewKnowledgeIfAvailable");
  });

  test("keeps review learning-memory batch orchestration out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const learningMemorySource = readFileSync(new URL("./review-learning-memory.ts", import.meta.url), "utf8");
    const sideEffectsSource = readFileSync(new URL("./review-post-execution-side-effects.ts", import.meta.url), "utf8");

    expect(source).not.toContain("writeReviewLearningMemory({");
    expect(source).not.toContain("Learning memory write batch complete");
    expect(source).not.toContain("Promise.resolve().then(async () =>");
    expect(source).not.toContain("Learning memory write pipeline failed (fail-open)");
    expect(source).not.toContain("scheduleReviewLearningMemoryBatch({");
    expect(source).toContain("recordReviewPostExecutionSideEffects");
    expect(sideEffectsSource).toContain("scheduleReviewLearningMemoryBatch");
    expect(sideEffectsSource).toContain("./review-learning-memory.ts");
    expect(learningMemorySource).toContain("writeReviewLearningMemoryBatch");
    expect(learningMemorySource).toContain("Learning memory write pipeline failed (fail-open)");
  });

  test("keeps post-execution side-effect mechanics out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const sideEffectsSource = readFileSync(new URL("./review-post-execution-side-effects.ts", import.meta.url), "utf8");

    expect(source).not.toContain("knowledgeStore.completeRun(runKey)");
    expect(source).not.toContain("updateExpertiseIncremental({");
    expect(source).not.toContain("const diffFiles = splitDiffByFile(diffContext.diffContent)");
    expect(source).not.toContain("embedReviewDiffHunks({");
    expect(source).not.toContain("completeReviewRunFailOpen({");
    expect(source).not.toContain("scheduleContributorExpertiseUpdate({");
    expect(source).not.toContain("scheduleReviewLearningMemoryBatch({");
    expect(source).not.toContain("scheduleReviewHunkEmbedding({");
    expect(source).toContain("recordReviewPostExecutionSideEffects");
    expect(source).toContain("./review-post-execution-side-effects.ts");
    expect(sideEffectsSource).toContain("completeReviewRunFailOpen");
    expect(sideEffectsSource).toContain("scheduleContributorExpertiseUpdate");
    expect(sideEffectsSource).toContain("scheduleReviewLearningMemoryBatch");
    expect(sideEffectsSource).toContain("scheduleReviewHunkEmbedding");
  });

  test("keeps published-output evidence bundle logging out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const evidenceSource = readFileSync(new URL("./review-published-output-evidence.ts", import.meta.url), "utf8");

    expect(source).not.toContain("outcome: \"published-output\"");
    expect(source).not.toContain("\"Evidence bundle\"");
    expect(source).toContain("logPublishedReviewOutputEvidence");
    expect(source).toContain("./review-published-output-evidence.ts");
    expect(evidenceSource).toContain("outcome: \"published-output\"");
    expect(evidenceSource).toContain("\"Evidence bundle\"");
  });

  test("keeps review cache telemetry fail-open helper out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const promptCacheRuntimeSource = readFileSync(new URL("./review-prompt-cache-runtime.ts", import.meta.url), "utf8");

    expect(source).not.toContain("async function recordReviewCacheEventFailOpen");
    expect(source).not.toContain("Review cache telemetry store method unavailable (non-blocking)");
    expect(promptCacheRuntimeSource).toContain("recordReviewCacheEventFailOpen");
  });

  test("keeps review prompt cache runtime out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const initialPreparationSource = readFileSync(new URL("./review-initial-prompt-preparation.ts", import.meta.url), "utf8");
    const retryPreparationSource = readFileSync(new URL("./review-retry-prompt-preparation.ts", import.meta.url), "utf8");
    const retryJobSource = readFileSync(new URL("./review-timeout-retry-job.ts", import.meta.url), "utf8");

    expect(source).not.toContain("async function buildReviewPromptResultWithCache");
    expect(source).not.toContain("const cacheErrorsBeforeLookup = reviewPromptDerivedCacheErrorCount;");
    expect(source).toContain("prepareInitialReviewPrompt");
    expect(source).toContain("scheduleReviewTimeoutRetryContinuation");
    expect(retryJobSource).toContain("prepareRetryReviewPrompt");
    expect(initialPreparationSource).toContain("./review-prompt-cache-runtime.ts");
    expect(retryPreparationSource).toContain("./review-prompt-cache-runtime.ts");
  });

  test("keeps retry review prompt cache runtime out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const promptCacheRuntimeSource = readFileSync(new URL("./review-prompt-cache-runtime.ts", import.meta.url), "utf8");
    const preparationSource = readFileSync(new URL("./review-retry-prompt-preparation.ts", import.meta.url), "utf8");
    const retryJobSource = readFileSync(new URL("./review-timeout-retry-job.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const retryPromptCacheState: ReviewPromptCacheState =");
    expect(source).not.toContain("const retryPromptCacheEvent = buildPromptReviewCacheEvent({");
    expect(source).not.toContain("\"Resolved retry review prompt derived-cache state\"");
    expect(source).toContain("scheduleReviewTimeoutRetryContinuation");
    expect(retryJobSource).toContain("prepareRetryReviewPrompt");
    expect(preparationSource).toContain("buildRetryReviewPromptRuntime");
    expect(promptCacheRuntimeSource).toContain("buildRetryReviewPromptRuntime");
    expect(promptCacheRuntimeSource).toContain("review-derived-prompt-cache");
  });

  test("keeps initial review prompt cache runtime out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const promptCacheRuntimeSource = readFileSync(new URL("./review-prompt-cache-runtime.ts", import.meta.url), "utf8");
    const preparationSource = readFileSync(new URL("./review-initial-prompt-preparation.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const reviewPromptCacheState: ReviewPromptCacheState =");
    expect(source).not.toContain("const reviewPromptCacheEvent = buildPromptReviewCacheEvent({");
    expect(source).not.toContain("\"Resolved review prompt derived-cache state\"");
    expect(source).toContain("prepareInitialReviewPrompt");
    expect(preparationSource).toContain("buildInitialReviewPromptRuntime");
    expect(promptCacheRuntimeSource).toContain("buildInitialReviewPromptRuntime");
    expect(promptCacheRuntimeSource).toContain("Resolved review prompt derived-cache state");
  });

  test("keeps author PR-count search cache fail-open setup out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const runtimeSource = readFileSync(new URL("./review-handler-runtime.ts", import.meta.url), "utf8");

    expect(source).not.toContain("let authorPrCountSearchCache: SearchCache<number> | undefined;");
    expect(source).not.toContain("authorPrCountSearchCache = injectedSearchCache;");
    expect(source).not.toContain("Search cache initialization failed (fail-open, continuing without search cache)");
    expect(source).toContain("createReviewHandlerRuntime");
    expect(runtimeSource).toContain("resolveReviewAuthorPrCountSearchCache");
    expect(runtimeSource).toContain("./review-author-search-cache.ts");
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

  test("keeps retrieval phase timing completion out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const phaseTimingSource = readFileSync(new URL("../review-orchestration/review-phase-timing.ts", import.meta.url), "utf8");
    const preparationSource = readFileSync(new URL("./review-initial-prompt-preparation.ts", import.meta.url), "utf8");

    expect(source).not.toContain("reviewPhaseTimings.set(\n          \"retrieval/context assembly\"");
    expect(source).not.toContain("name: \"retrieval/context assembly\",\n            status: \"completed\"");
    expect(source).toContain("prepareInitialReviewPrompt");
    expect(preparationSource).toContain("completeReviewRetrievalContextPhaseTiming");
    expect(phaseTimingSource).toContain("completeReviewRetrievalContextPhaseTiming");
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
    const changedFileContextSource = readFileSync(new URL("./review-changed-file-context.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const trivialCheck = isTrivialChange({");
    expect(source).not.toContain("const structuralImpact = await fetchReviewStructuralImpact");
    expect(source).not.toContain("summarizeStructuralImpactDegradation(structuralImpact.payload)");
    expect(source).not.toContain("Review structural-impact integration failed (fail-open, continuing with file-risk selection)");
    expect(source).toContain("resolveReviewChangedFileContext");
    expect(changedFileContextSource).toContain("resolveReviewStructuralImpactSelection");
    expect(changedFileContextSource).toContain("./review-structural-impact-selection.ts");
  });

  test("keeps large PR risk scoring and triage out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const changedFileContextSource = readFileSync(new URL("./review-changed-file-context.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const perFileStats = parseNumstatPerFile(numstatLines)");
    expect(source).not.toContain("const riskScores = computeFileRiskScores({");
    expect(source).not.toContain("let tieredFiles = triageFilesByRisk({");
    expect(source).not.toContain("gate: \"large-pr-triage\"");
    expect(source).toContain("resolveReviewChangedFileContext");
    expect(changedFileContextSource).toContain("buildReviewFileRiskScores");
    expect(changedFileContextSource).toContain("resolveReviewLargePrTriage");
    expect(changedFileContextSource).toContain("./review-large-pr-triage.ts");
  });

  test("keeps path instruction matching out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const changedFileContextSource = readFileSync(new URL("./review-changed-file-context.ts", import.meta.url), "utf8");

    expect(source).not.toContain("config.review.pathInstructions.length > 0");
    expect(source).not.toContain("matchPathInstructions(config.review.pathInstructions, changedFiles)");
    expect(source).toContain("resolveReviewChangedFileContext");
    expect(changedFileContextSource).toContain("resolveReviewPathInstructions");
    expect(changedFileContextSource).toContain("./review-path-instructions.ts");
  });

  test("keeps review runtime planning out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const planningSource = readFileSync(new URL("./review-planning-context.ts", import.meta.url), "utf8");

    expect(source).not.toContain("let resolvedSeverityMinLevel = config.review.severity.minLevel");
    expect(source).not.toContain("const selectedPreset = PROFILE_PRESETS[profileSelection.selectedProfile]");
    expect(source).not.toContain("fileCount: changedFiles.length,\n          linesChanged: (diffAnalysis?.metrics.totalLinesAdded ?? 0)");
    expect(source).not.toContain("const reviewRouting = resolveReviewTaskRouting({\n          changedFileCount: changedFiles.length");
    expect(source).not.toContain("profileSelection.selectedProfile = \"minimal\"");
    expect(source).not.toContain("const reviewBoundedness = resolveReviewBoundedness({");
    expect(source).toContain("resolveReviewPlanningContext");
    expect(planningSource).toContain("buildReviewRuntimePlan");
    expect(planningSource).toContain("./review-runtime-plan.ts");
  });

  test("keeps review plan publication context assembly out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const planningSource = readFileSync(new URL("./review-planning-context.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const reviewPlanLinesChangedSource =");
    expect(source).not.toContain("const reviewPlanGraphValidation = resolveGraphValidationPlanStatus({");
    expect(source).not.toContain("const reviewPlanPublication = buildReviewPlanPublicationContext({");
    expect(source).not.toContain("candidateFinding: {\n              mode: \"preferred\"");
    expect(source).toContain("resolveReviewPlanningContext");
    expect(planningSource).toContain("buildReviewPlanPublication");
    expect(planningSource).toContain("./review-plan-publication-context.ts");
  });

  test("keeps review plan publication logging policy out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const planningSource = readFileSync(new URL("./review-planning-context.ts", import.meta.url), "utf8");
    const planPublicationSource = readFileSync(new URL("./review-plan-publication-context.ts", import.meta.url), "utf8");

    expect(source).not.toContain("Review plan ready");
    expect(source).not.toContain("Review plan builder failed; continuing with degraded plan metadata");
    expect(source).not.toContain("serializeReviewPlanBuilderError(reviewPlanPublication.error)");
    expect(source).toContain("resolveReviewPlanningContext");
    expect(planningSource).toContain("logReviewPlanPublication");
    expect(planPublicationSource).toContain("logReviewPlanPublication");
    expect(planPublicationSource).toContain("serializeReviewPlanBuilderError");
  });

  test("keeps review planning orchestration out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const planningSource = readFileSync(new URL("./review-planning-context.ts", import.meta.url), "utf8");

    expect(source).not.toContain("buildReviewRuntimePlan({");
    expect(source).not.toContain("buildReviewPlanPublication({");
    expect(source).not.toContain("logReviewPlanPublication({");
    expect(source).not.toContain("toReviewPlanConfigSnapshot(reviewPlan)");
    expect(source).not.toContain("applyReviewPrIntentAreas({");
    expect(source).not.toContain("logReviewDiffAnalysisCompleted({");
    expect(source).toContain("resolveReviewPlanningContext");
    expect(source).toContain("./review-planning-context.ts");
    expect(planningSource).toContain("export function resolveReviewPlanningContext");
    expect(planningSource).toContain("buildReviewRuntimePlan({");
    expect(planningSource).toContain("buildReviewPlanPublication({");
    expect(planningSource).toContain("logReviewPlanPublication({");
    expect(planningSource).toContain("toReviewPlanConfigSnapshot(reviewPlan)");
    expect(planningSource).toContain("applyReviewPrIntentAreas({");
    expect(planningSource).toContain("logReviewDiffAnalysisCompleted({");
  });

  test("keeps executor result state projection out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("visibleBudgetState.promptSectionRecords = result.promptSections ?? visibleBudgetState.promptSectionRecords");
    expect(source).not.toContain("reviewPublishResolution = reviewOutputPublished ? \"executor\" : \"none\"");
    expect(source).not.toContain("executorPhaseTimings = result.executorPhaseTimings ?? buildExecutorUnavailablePhases");
    expect(source).not.toContain("publicationState.executorResult = executorState.executorResult");
    expect(source).not.toContain("visibleBudgetState.promptSectionRecords = executorState.promptSectionRecords");
    expect(source).not.toContain("timingState.executorPhaseTimings = executorState.executorPhaseTimings");
    expect(source).toContain("applyReviewExecutorState");
    expect(source).toContain("projectReviewExecutorState");
    expect(source).toContain("./review-executor-state.ts");
  });

  test("keeps initial review executor context projection out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const contextSource = readFileSync(new URL("./review-execution-context.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const result = await executor.execute({");
    expect(source).not.toContain("triggerBody: reviewPrompt,\n          prompt: reviewPrompt");
    expect(source).toContain("executor.execute(buildReviewExecutionContext({");
    expect(source).toContain("./review-execution-context.ts");
    expect(contextSource).toContain("export function buildReviewExecutionContext");
  });

  test("keeps retry review executor context projection out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const contextSource = readFileSync(new URL("./review-execution-context.ts", import.meta.url), "utf8");
    const retryJobSource = readFileSync(new URL("./review-timeout-retry-job.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const retryResult = await executor.execute({");
    expect(source).not.toContain("eventType: \"pull_request.review-retry\"");
    expect(source).not.toContain("triggerBody: \"\",\n                      prompt: retryPrompt");
    expect(source).not.toContain("buildShadowSpecialistCorrelationKey({\n                          deliveryId: retryDeliveryId");
    expect(source).toContain("scheduleReviewTimeoutRetryContinuation");
    expect(retryJobSource).toContain("executor.execute(buildReviewRetryExecutionContext({");
    expect(contextSource).toContain("export function buildReviewRetryExecutionContext");
  });

  test("keeps executor phase timing map mutation out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const phaseTimingSource = readFileSync(new URL("../review-orchestration/review-phase-timing.ts", import.meta.url), "utf8");

    expect(source).not.toContain("for (const phase of timingState.executorPhaseTimings)");
    expect(source).not.toContain("reviewPhaseTimings.set(phase.name, phase)");
    expect(source).toContain("recordReviewExecutorPhaseTimings");
    expect(phaseTimingSource).toContain("recordReviewExecutorPhaseTimings");
  });

  test("keeps candidate publication bridge projection out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("let handlerCandidatePublicationBridge: ReviewHandlerPublicationBridgeProjection;");
    expect(source).not.toContain("Review handler candidate-publication bridge projection failed; using bounded degraded evidence");
    expect(source).not.toContain("Projected review handler candidate-publication bridge evidence");
    expect(source).toContain("resolveReviewHandlerCandidatePublicationBridge");
    expect(source).toContain("./review-candidate-publication-bridge.ts");
  });

  test("keeps candidate finding extraction context out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const preparationSource = readFileSync(
      new URL("./review-candidate-publication-preparation.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("const reviewCandidateFindingResult = resolveReviewCandidateFindingResult({");
    expect(source).not.toContain("const extractedFindings = shouldProcessReviewOutput");
    expect(source).toContain("resolveReviewCandidatePublicationPreparation");
    expect(preparationSource).toContain("resolveReviewCandidateFindingContext");
    expect(preparationSource).toContain("./review-candidate-finding-context.ts");
  });

  test("keeps feedback suppression fallback policy out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const preparationSource = readFileSync(
      new URL("./review-candidate-publication-preparation.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("const feedbackSuppression = knowledgeStore");
    expect(source).not.toContain("suppressedFingerprints: new Set<string>()");
    expect(source).not.toContain("suppressedPatternCount: 0, patterns: []");
    expect(source).toContain("resolveReviewCandidatePublicationPreparation");
    expect(preparationSource).toContain("resolveReviewFeedbackSuppression");
    expect(preparationSource).toContain("./review-feedback-suppression.ts");
  });

  test("keeps graph-validation LLM routing out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const preparationSource = readFileSync(
      new URL("./review-candidate-publication-preparation.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("const graphValidationLLM = graphBlastRadius && config.review.graphValidation.enabled");
    expect(source).not.toContain("const { createTaskRouter } = await import(\"../llm/task-router.ts\")");
    expect(source).not.toContain("const genResult = await generateWithFallback({");
    expect(source).toContain("resolveReviewCandidatePublicationPreparation");
    expect(preparationSource).toContain("resolveReviewGraphValidationLLM");
    expect(preparationSource).toContain("./review-graph-validation-llm.ts");
  });

  test("keeps candidate approval adapter context out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const preparationSource = readFileSync(
      new URL("./review-candidate-publication-preparation.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("const directFallbackAllowed = reviewCandidateFindingResult.status !== \"shadow\"");
    expect(source).not.toContain("const reviewCandidateApprovalResult: ReviewCandidateApprovalResult = coordinateReviewCandidateApproval({");
    expect(source).not.toContain("adaptApprovedCandidatesForInlinePublication({");
    expect(source).toContain("resolveReviewCandidatePublicationPreparation");
    expect(preparationSource).toContain("resolveReviewCandidateApprovalContext");
    expect(preparationSource).toContain("./review-candidate-approval-context.ts");
  });

  test("keeps candidate inline publication orchestration out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const preparationSource = readFileSync(
      new URL("./review-candidate-publication-preparation.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("const candidatePublisherResults = new Map<string, InlineReviewPublicationResult>();");
    expect(source).not.toContain("createCandidateVerificationPublicationEvidenceCollector(");
    expect(source).not.toContain("candidate-approved inline review comments");
    expect(source).not.toContain("Candidate publication skipped because review publish rights were superseded.");
    expect(source).toContain("resolveReviewCandidatePublicationPreparation");
    expect(preparationSource).toContain("publishReviewCandidateInlineComments");
    expect(preparationSource).toContain("./review-candidate-inline-publication.ts");
  });

  test("keeps candidate publication preparation orchestration out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const preparationSource = readFileSync(
      new URL("./review-candidate-publication-preparation.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("resolveReviewCandidateFindingContext({");
    expect(source).not.toContain("resolveReviewFeedbackSuppression({");
    expect(source).not.toContain("resolveReviewGraphValidationLLM({");
    expect(source).not.toContain("buildReviewReducerInput({");
    expect(source).not.toContain("runReviewReducerFailOpen({");
    expect(source).not.toContain("resolveReviewCandidateApprovalContext({");
    expect(source).not.toContain("publishReviewCandidateInlineComments({");
    expect(source).not.toContain("} = await resolveReviewCandidatePublicationPreparation({\n          getOctokit: () => githubApp.getInstallationOctokit(event.installationId),");
    expect(source).toContain("buildReviewCandidatePublicationPreparationAdapters");
    expect(source).toContain("resolveReviewCandidatePublicationPreparation");
    expect(source).toContain("./review-candidate-publication-preparation.ts");
    expect(preparationSource).toContain("export function buildReviewCandidatePublicationPreparationAdapters");
    expect(preparationSource).toContain("export async function resolveReviewCandidatePublicationPreparation");
    expect(preparationSource).toContain("resolveReviewCandidateFindingContext({");
    expect(preparationSource).toContain("runReviewReducerFailOpen({");
    expect(preparationSource).toContain("publishReviewCandidateInlineComments({");
  });

  test("keeps candidate publication runtime projection out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("convertPublishedCandidateResultsToProcessedFindings({");
    expect(source).not.toContain("classifyReviewCandidatePublicationRuntime({");
    expect(source).not.toContain("createCandidatePublicationFlowEvidence({");
    expect(source).not.toContain("logReviewCandidatePublicationRuntime({");
    expect(source).not.toContain("toReviewCandidatePublicationAdapterSummary(reviewCandidatePublicationAdapter.summary)");
    expect(source).toContain("resolveReviewCandidatePublicationRuntimeContext");
    expect(source).toContain("./review-candidate-publication-runtime-context.ts");
  });

  test("keeps finding publication merge projection out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const directProcessedFindings = (reducerResult.findings as ProcessedReviewFinding[])");
    expect(source).not.toContain("mergeCandidatePublishedFindings(");
    expect(source).not.toContain("const filterResult = { filtered: reducerResult.filterRecords };");
    expect(source).toContain("resolveReviewFindingPublicationContext");
    expect(source).toContain("./review-finding-publication-context.ts");
  });

  test("keeps finding lifecycle and validation-truth context out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("attachReviewFindingLifecycle({");
    expect(source).not.toContain("Projected review finding lifecycle evidence");
    expect(source).not.toContain("projectAutomaticReviewValidationTruth({");
    expect(source).toContain("resolveReviewFindingLifecycleContext");
    expect(source).toContain("./review-finding-lifecycle-context.ts");
  });

  test("keeps candidate publication adapter summary logging out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("gate: \"review-fix-eligibility\"");
    expect(source).not.toContain("gate: \"review-candidate-publication-adapter\"");
    expect(source).not.toContain("Review candidate publication adapter summarized");
    expect(source).toContain("logReviewCandidatePublicationAdapterContext");
    expect(source).toContain("./review-candidate-publication-adapter-context.ts");
  });

  test("keeps prompt enrichment lookups out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const preparationSource = readFileSync(new URL("./review-initial-prompt-preparation.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const prText = [pr.title, pr.body ?? \"\", ...promptFiles.slice(0, 20)].join(\"\\n\")");
    expect(source).not.toContain("clusterPatternsForPrompt = await clusterMatcher({");
    expect(source).not.toContain("const diffSummaryParts: string[] = [];");
    expect(source).not.toContain("linkedIssueResult = await linkPRToIssues({");
    expect(source).toContain("prepareInitialReviewPrompt");
    expect(source).toContain("./review-initial-prompt-preparation.ts");
    expect(preparationSource).toContain("buildReviewPromptEnrichment");
    expect(preparationSource).toContain("./review-prompt-enrichment.ts");
  });

  test("keeps initial review prompt preparation orchestration out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const preparationSource = readFileSync(new URL("./review-initial-prompt-preparation.ts", import.meta.url), "utf8");

    expect(source).not.toContain("buildReviewPromptEnrichment({");
    expect(source).not.toContain("buildInitialReviewPromptContext({");
    expect(source).not.toContain("buildInitialReviewPromptRuntime({");
    expect(source).not.toContain("completeReviewRetrievalContextPhaseTiming({");
    expect(source).toContain("prepareInitialReviewPrompt");
    expect(source).toContain("./review-initial-prompt-preparation.ts");
    expect(preparationSource).toContain("export async function prepareInitialReviewPrompt");
    expect(preparationSource).toContain("buildReviewPromptEnrichment({");
    expect(preparationSource).toContain("buildInitialReviewPromptContext({");
    expect(preparationSource).toContain("buildInitialReviewPromptRuntime({");
    expect(preparationSource).toContain("completeReviewRetrievalContextPhaseTiming({");
    expect(preparationSource).toContain("projectReviewAuthorExpertiseForPrompt");
  });

  test("keeps initial review prompt context assembly out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const promptContextSource = readFileSync(new URL("./review-prompt-build-context.ts", import.meta.url), "utf8");
    const preparationSource = readFileSync(new URL("./review-initial-prompt-preparation.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const reviewPromptBuildContext = {");
    expect(source).toContain("prepareInitialReviewPrompt");
    expect(source).toContain("./review-initial-prompt-preparation.ts");
    expect(preparationSource).toContain("buildInitialReviewPromptContext");
    expect(preparationSource).toContain("./review-prompt-build-context.ts");
    expect(promptContextSource).toContain("ReviewPromptBuildContext");
    expect(promptContextSource).toContain("TASK_TYPES.REVIEW_SMALL_DIFF");
  });

  test("keeps retry review prompt context assembly out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const promptContextSource = readFileSync(new URL("./review-prompt-build-context.ts", import.meta.url), "utf8");
    const retryPromptContextSource = readFileSync(new URL("./review-retry-prompt-context.ts", import.meta.url), "utf8");
    const preparationSource = readFileSync(new URL("./review-retry-prompt-preparation.ts", import.meta.url), "utf8");
    const retryJobSource = readFileSync(new URL("./review-timeout-retry-job.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const retryPromptBuildContext = {");
    expect(source).not.toContain("buildRetryReviewPromptContext({");
    expect(source).not.toContain("cacheSafetySignalNames: visibleBudgetState.reviewCacheObservations.flatMap");
    expect(source).toContain("scheduleReviewTimeoutRetryContinuation");
    expect(source).toContain("./review-timeout-retry-scheduling.ts");
    expect(retryJobSource).toContain("prepareRetryReviewPrompt");
    expect(preparationSource).toContain("buildReviewRetryPromptBuildContext");
    expect(preparationSource).toContain("./review-retry-prompt-context.ts");
    expect(retryPromptContextSource).toContain("buildRetryReviewPromptContext");
    expect(retryPromptContextSource).toContain("./review-prompt-build-context.ts");
    expect(promptContextSource).toContain("buildRetryReviewPromptContext");
    expect(promptContextSource).toContain("retryPromptCompaction");
  });

  test("keeps retry review prompt preparation orchestration out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const preparationSource = readFileSync(new URL("./review-retry-prompt-preparation.ts", import.meta.url), "utf8");
    const retryJobSource = readFileSync(new URL("./review-timeout-retry-job.ts", import.meta.url), "utf8");

    expect(source).not.toContain("buildReviewRetryPromptBuildContext({");
    expect(source).not.toContain("buildRetryReviewPromptRuntime({");
    expect(source).not.toContain("const retryPromptRuntime = await");
    expect(source).toContain("scheduleReviewTimeoutRetryContinuation");
    expect(source).toContain("./review-timeout-retry-scheduling.ts");
    expect(retryJobSource).toContain("prepareRetryReviewPrompt");
    expect(preparationSource).toContain("export async function prepareRetryReviewPrompt");
    expect(preparationSource).toContain("buildReviewRetryPromptBuildContext({");
    expect(preparationSource).toContain("buildRetryReviewPromptRuntime({");
    expect(preparationSource).toContain("projectReviewAuthorExpertiseForPrompt");
  });

  test("keeps no-review skip acknowledgment publication out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const eventRuntimeSource = readFileSync(new URL("./review-event-runtime.ts", import.meta.url), "utf8");

    expect(source).not.toContain("/\\[no-review\\]/i.test(pr.title)");
    expect(source).not.toContain("gate: \"keyword-skip\"");
    expect(source).not.toContain("Review skipped per `[no-review]` in PR title.");
    expect(source).not.toContain("Failed to publish no-review skip acknowledgment");
    expect(source).toContain("./review-event-runtime.ts");
    expect(eventRuntimeSource).toContain("./review-no-review-skip.ts");
    expect(eventRuntimeSource).toContain("evaluateNoReviewSkipGate");
  });

  test("keeps review cost warning publication out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const postExecutionSource = readFileSync(new URL("./review-post-execution-telemetry.ts", import.meta.url), "utf8");

    expect(source).not.toContain("costWarningUsd: 5.0  # or 0 to disable");
    expect(source).not.toContain("Failed to post cost warning comment");
    expect(source).toContain("recordReviewPostExecutionTelemetry");
    expect(postExecutionSource).toContain("./review-cost-warning.ts");
    expect(postExecutionSource).toContain("maybePostReviewCostWarning");
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
    const orchestrationSource = readFileSync(
      new URL("./review-bounded-first-pass-timeout-publication.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("const partialComment = await createIssueCommentWithPublicationPipeline");
    expect(source).not.toContain("partialCommentId = partialComment.data.id");
    expect(source).toContain("publishBoundedFirstPassTimeoutOutput");
    expect(orchestrationSource).toContain("./review-partial-publication.ts");
    expect(orchestrationSource).toContain("publishBoundedFirstPassReview");
  });

  test("keeps bounded first-pass timeout publication orchestration out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const orchestrationSource = readFileSync(
      new URL("./review-bounded-first-pass-timeout-publication.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("const partialPublication = await publishBoundedFirstPassReview({");
    expect(source).not.toContain("await persistPartialReviewCheckpoint({");
    expect(source).not.toContain("logBoundedFirstPassReviewPublished({");
    expect(source).not.toContain("await publishTimeoutReviewDetailsMerge({");
    expect(source).toContain("publishBoundedFirstPassTimeoutOutput");
    expect(source).toContain("./review-bounded-first-pass-timeout-publication.ts");
    expect(orchestrationSource).toContain("publishBoundedFirstPassReview");
    expect(orchestrationSource).toContain("persistPartialReviewCheckpoint");
    expect(orchestrationSource).toContain("publishTimeoutReviewDetailsMerge");
  });

  test("keeps bounded first-pass timeout evidence logging out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const evidenceSource = readFileSync(new URL("./review-bounded-first-pass-evidence.ts", import.meta.url), "utf8");
    const orchestrationSource = readFileSync(
      new URL("./review-bounded-first-pass-timeout-publication.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("Published bounded first-pass review on timeout");
    expect(source).toContain("publishBoundedFirstPassTimeoutOutput");
    expect(orchestrationSource).toContain("logBoundedFirstPassReviewPublished");
    expect(orchestrationSource).toContain("./review-bounded-first-pass-evidence.ts");
    expect(evidenceSource).toContain("Published bounded first-pass review on timeout");
    expect(evidenceSource).toContain("boundedReason");
  });

  test("keeps timeout retry enqueue logging out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const evidenceSource = readFileSync(new URL("./review-timeout-retry-enqueue-log.ts", import.meta.url), "utf8");
    const preEnqueueSource = readFileSync(
      new URL("./review-timeout-retry-pre-enqueue.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("Enqueueing retry with reduced scope");
    expect(source).toContain("scheduleReviewTimeoutRetryContinuation");
    expect(preEnqueueSource).toContain("logReviewTimeoutRetryEnqueue");
    expect(preEnqueueSource).toContain("./review-timeout-retry-enqueue-log.ts");
    expect(evidenceSource).toContain("Enqueueing retry with reduced scope");
    expect(evidenceSource).toContain("retryRiskLevel");
  });

  test("keeps timeout retry pre-enqueue side effects out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const preEnqueueSource = readFileSync(
      new URL("./review-timeout-retry-pre-enqueue.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("const retryResilienceTelemetry = await recordReviewTimeoutResilienceTelemetry({");
    expect(source).not.toContain("await persistContinuationFamilyState(resolvePendingContinuationFamilyState({");
    expect(source).not.toContain("if (timeoutFirstPass?.zeroEvidenceFailure && knowledgeStore?.saveCheckpoint)");
    expect(source).toContain("scheduleReviewTimeoutRetryContinuation");
    expect(source).toContain("./review-timeout-retry-scheduling.ts");
    expect(preEnqueueSource).toContain("recordReviewTimeoutResilienceTelemetry");
    expect(preEnqueueSource).toContain("logReviewTimeoutRetryEnqueue");
    expect(preEnqueueSource).toContain("resolvePendingContinuationFamilyState");
  });

  test("keeps zero-evidence timeout warning logging out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const warningSource = readFileSync(new URL("./review-timeout-zero-evidence-log.ts", import.meta.url), "utf8");

    expect(source).not.toContain("Constrained timeout remained a zero-evidence hard failure");
    expect(source).toContain("logReviewTimeoutZeroEvidenceWarning");
    expect(source).toContain("./review-timeout-zero-evidence-log.ts");
    expect(warningSource).toContain("Constrained timeout remained a zero-evidence hard failure");
    expect(warningSource).toContain("zeroEvidenceWarning");
  });

  test("keeps bounded first-pass publication failure logging out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const warningSource = readFileSync(new URL("./review-bounded-first-pass-publication-failure-log.ts", import.meta.url), "utf8");
    const orchestrationSource = readFileSync(
      new URL("./review-bounded-first-pass-timeout-publication.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("Failed to publish bounded first-pass review");
    expect(source).toContain("publishBoundedFirstPassTimeoutOutput");
    expect(orchestrationSource).toContain("logBoundedFirstPassPublicationFailure");
    expect(orchestrationSource).toContain("./review-bounded-first-pass-publication-failure-log.ts");
    expect(warningSource).toContain("Failed to publish bounded first-pass review");
    expect(warningSource).toContain("error");
  });

  test("keeps review enqueue completion logging out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const logSource = readFileSync(new URL("./review-enqueue-completion-log.ts", import.meta.url), "utf8");

    expect(source).not.toContain("Review enqueue completed");
    expect(source).toContain("logReviewEnqueueCompleted");
    expect(source).toContain("./review-enqueue-completion-log.ts");
    expect(logSource).toContain("Review enqueue completed");
    expect(logSource).toContain("gateResult");
  });

  test("keeps diff-analysis completion logging out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const planningSource = readFileSync(new URL("./review-planning-context.ts", import.meta.url), "utf8");
    const logSource = readFileSync(new URL("./review-diff-analysis-completion-log.ts", import.meta.url), "utf8");

    expect(source).not.toContain("Diff analysis and context enrichment complete");
    expect(source).toContain("resolveReviewPlanningContext");
    expect(planningSource).toContain("logReviewDiffAnalysisCompleted");
    expect(planningSource).toContain("./review-diff-analysis-completion-log.ts");
    expect(logSource).toContain("Diff analysis and context enrichment complete");
    expect(logSource).toContain("diffCollectionAttempts");
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

  test("keeps PR intent focus/style area application out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const planningSource = readFileSync(new URL("./review-planning-context.ts", import.meta.url), "utf8");
    const intentAreasSource = readFileSync(new URL("./review-pr-intent-areas.ts", import.meta.url), "utf8");

    expect(source).not.toContain("parsedIntent.styleOk && !resolvedIgnoredAreas.includes(\"style\")");
    expect(source).not.toContain("for (const area of parsedIntent.focusAreas as ReviewArea[])");
    expect(source).not.toContain("resolvedFocusAreas.push(area)");
    expect(source).toContain("resolveReviewPlanningContext");
    expect(planningSource).toContain("applyReviewPrIntentAreas");
    expect(planningSource).toContain("./review-pr-intent-areas.ts");
    expect(intentAreasSource).toContain("styleOk");
    expect(intentAreasSource).toContain("focusAreas");
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
    expect(source).not.toContain("updateFinalizedReviewDetailsComment");
  });

  test("keeps Review Details runtime count projection out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const findingCounts = { critical: 0, major: 0, medium: 0, minor: 0 };");
    expect(source).not.toContain("let suppressionsApplied = 0;");
    expect(source).not.toContain("findingCounts[finding.severity] += 1;");
    expect(source).not.toContain("const hasReviewDetailsOperationalSignal =");
    expect(source).toContain("resolveReviewDetailsRuntimeContext");
    expect(source).toContain("./review-details-runtime-context.ts");
  });

  test("keeps Review Details body-base projection out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const projectionSource = readFileSync(new URL("./review-details-body-base.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const reviewDetailsBodyBase = {");
    expect(source).not.toContain("largePRTriage: tieredFiles.isLargePR ? {");
    expect(source).not.toContain("phaseTimingSummary: buildReviewDetailsPhaseTimingSummary({");
    expect(source).toContain("buildReviewDetailsBodyBase");
    expect(source).toContain("./review-details-body-base.ts");
    expect(projectionSource).toContain("export function buildReviewDetailsBodyBase");
    expect(projectionSource).toContain("buildReviewDetailsPhaseTimingSummary");
  });

  test("keeps published-output Review Details merge orchestration out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const firstPassSource = readFileSync(new URL("./review-details-first-pass-publication.ts", import.meta.url), "utf8");

    expect(source).not.toContain("if (result.published) {\n              if (canPublishVisibleOutput(\"canonical Review Details merge\"))");
    expect(source).not.toContain("Failed to update canonical review surface with Review Details; using degraded fallback comment");
    expect(source).not.toContain("Failed to refresh finalized canonical Review Details surface");
    expect(firstPassSource).toContain("publishPublishedReviewDetailsMerge");
    expect(firstPassSource).toContain("./review-details-published-merge.ts");
  });

  test("keeps moved-to-details Review Details merge orchestration out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const firstPassSource = readFileSync(new URL("./review-details-first-pass-publication.ts", import.meta.url), "utf8");

    expect(source).not.toContain("canonical Review Details moved-to-details preservation");
    expect(source).not.toContain("Failed to publish canonical Review Details for moved-to-details candidates; using degraded fallback comment");
    expect(source).not.toContain("Failed to refresh finalized moved-to-details Review Details surface");
    expect(firstPassSource).toContain("publishMovedToDetailsReviewDetailsMerge");
    expect(firstPassSource).toContain("./review-details-moved-to-details-merge.ts");
  });

  test("keeps standalone degraded Review Details fallback orchestration out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const firstPassSource = readFileSync(new URL("./review-details-first-pass-publication.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const reviewDetailsCommentId = await upsertDegradedReviewDetailsFallbackComment({");
    expect(source).not.toContain("await updateFinalizedReviewDetailsComment({");
    expect(firstPassSource).toContain("publishStandaloneReviewDetailsFallback");
    expect(firstPassSource).toContain("./review-details-standalone-fallback.ts");
  });

  test("keeps fail-open degraded Review Details fallback publication out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("await upsertDegradedReviewDetailsFallbackComment({");
    expect(source).toContain("publishDegradedReviewDetailsFallbackFailOpen");
    expect(source).toContain("./review-details-degraded-fallback.ts");
  });

  test("keeps timeout Review Details publication orchestration out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const orchestrationSource = readFileSync(
      new URL("./review-bounded-first-pass-timeout-publication.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("timeout canonical Review Details merge");
    expect(source).not.toContain("Failed to update timeout canonical review surface with Review Details");
    expect(source).toContain("publishBoundedFirstPassTimeoutOutput");
    expect(orchestrationSource).toContain("publishTimeoutReviewDetailsMerge");
    expect(orchestrationSource).toContain("./review-details-timeout-publication.ts");
  });

  test("keeps retry Review Details publication orchestration out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const retryJobSource = readFileSync(new URL("./review-timeout-retry-job.ts", import.meta.url), "utf8");
    const retryContinuationSettlementSource = readFileSync(new URL("./review-retry-continuation-settlement.ts", import.meta.url), "utf8");
    const retryMergeSource = readFileSync(new URL("./review-retry-merge-publication.ts", import.meta.url), "utf8");

    expect(source).not.toContain("retry canonical Review Details merge");
    expect(source).not.toContain("Failed to update retry canonical review surface with Review Details");
    expect(source).not.toContain("retry degraded Review Details fallback comment");
    expect(source).toContain("./review-timeout-retry-scheduling.ts");
    expect(retryJobSource).toContain("./review-retry-continuation-settlement.ts");
    expect(retryContinuationSettlementSource).toContain("./review-retry-merge-publication.ts");
    expect(retryMergeSource).toContain("./review-details-retry-publication.ts");
    expect(retryMergeSource).toContain("publishRetryReviewDetailsMerge");
  });

  test("keeps retry merge publication settlement out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const retryContinuationSettlementSource = readFileSync(new URL("./review-retry-continuation-settlement.ts", import.meta.url), "utf8");
    const retryJobSource = readFileSync(new URL("./review-timeout-retry-job.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const retryOctokit = await githubApp.getInstallationOctokit");
    expect(source).not.toContain("const retryReviewDetailsPublication = await publishRetryReviewDetailsMerge({");
    expect(source).not.toContain("resolveMergedContinuationFamilyState({");
    expect(source).not.toContain("Retry Review Details publication failed");
    expect(source).toContain("scheduleReviewTimeoutRetryContinuation");
    expect(retryJobSource).toContain("settleRetryContinuationResults");
    expect(retryContinuationSettlementSource).toContain("publishRetryMergeContinuationResults");

    const retryMergeSource = readFileSync(new URL("./review-retry-merge-publication.ts", import.meta.url), "utf8");
    expect(retryMergeSource).toContain("publishRetryReviewDetailsMerge");
    expect(retryMergeSource).toContain("resolveMergedContinuationFamilyState");
  });

  test("keeps retry continuation settlement orchestration out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const retrySettlementSource = readFileSync(new URL("./review-retry-continuation-settlement.ts", import.meta.url), "utf8");
    const retryJobSource = readFileSync(new URL("./review-timeout-retry-job.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const settlementDecision = settleReviewContinuation({");
    expect(source).not.toContain("const continuationRevisionCounts = await resolveReviewContinuationRevisionCounts({");
    expect(source).not.toContain("settlementReason: \"no-meaningful-delta\"");
    expect(source).not.toContain("Retry settlement skipped because the base checkpoint was missing");
    expect(source).not.toContain("Retry merge skipped because bounded first-pass state became non-publishable");
    expect(source).toContain("scheduleReviewTimeoutRetryContinuation");
    expect(source).toContain("./review-timeout-retry-scheduling.ts");
    expect(retryJobSource).toContain("settleRetryContinuationResults");
    expect(retrySettlementSource).toContain("settleReviewContinuation");
    expect(retrySettlementSource).toContain("publishRetryMergeContinuationResults");
  });

  test("keeps retry failure and enqueue cleanup out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const retryFailureSource = readFileSync(new URL("./review-retry-failure-handling.ts", import.meta.url), "utf8");
    const retryEnqueueSource = readFileSync(new URL("./review-timeout-retry-enqueue.ts", import.meta.url), "utf8");

    expect(source).not.toContain("\"Retry failed with error\"");
    expect(source).not.toContain("\"Failed to enqueue retry job\"");
    expect(source).not.toContain("reviewWorkCoordinator.complete(retryReviewWorkAttempt.attemptId)");
    expect(source).not.toContain("reviewWorkCoordinator.release(retryReviewWorkAttempt.attemptId)");
    expect(source).not.toContain("Best-effort checkpoint cleanup even on retry failure");
    expect(source).toContain("scheduleReviewTimeoutRetryContinuation");
    expect(source).toContain("./review-timeout-retry-scheduling.ts");
    expect(retryEnqueueSource).toContain("handleRetryJobFailure");
    expect(retryEnqueueSource).toContain("handleRetryEnqueueFailure");
    expect(retryEnqueueSource).toContain("finalizeRetryJobAttempt");
    expect(retryEnqueueSource).toContain("./review-retry-failure-handling.ts");
    expect(retryFailureSource).toContain("classifyRetryFailure");
    expect(retryFailureSource).toContain("discardCheckpointsFailOpen");
  });

  test("keeps first-pass Review Details publication branching out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const hasMovedToDetailsFindings =");
    expect(source).not.toContain("const approvalWillOwnCanonicalSurface =");
    expect(source).not.toContain("Failed to publish canonical-or-degraded Review Details output");
    expect(source).toContain("publishFirstPassReviewDetails");
    expect(source).toContain("./review-details-first-pass-publication.ts");
  });

  test("keeps first-pass Review Details attempt log projection out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const projectionSource = readFileSync(
      new URL("./review-details-attempt-log-fields.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("deltaNew: deltaClassification?.counts.new ?? null");
    expect(source).not.toContain("provenanceCount: retrievalCtx?.findings.length ?? null");
    expect(source).toContain("buildReviewDetailsAttemptLogFields");
    expect(source).toContain("./review-details-attempt-log-fields.ts");
    expect(projectionSource).toContain("export function buildReviewDetailsAttemptLogFields");
  });

  test("keeps retry custom instruction assembly out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const retryPromptContextSource = readFileSync(new URL("./review-retry-prompt-context.ts", import.meta.url), "utf8");
    const preparationSource = readFileSync(new URL("./review-retry-prompt-preparation.ts", import.meta.url), "utf8");
    const retryJobSource = readFileSync(new URL("./review-timeout-retry-job.ts", import.meta.url), "utf8");

    expect(source).not.toContain("This is a retry of a timed-out review with reduced scope.");
    expect(source).not.toContain("This is a retry of a review that exhausted max turns with reduced scope.");
    expect(source).not.toContain("save_review_checkpoint with a summaryDraft");
    expect(source).toContain("scheduleReviewTimeoutRetryContinuation");
    expect(retryJobSource).toContain("prepareRetryReviewPrompt");
    expect(preparationSource).toContain("buildReviewRetryPromptBuildContext");
    expect(retryPromptContextSource).toContain("buildReviewRetryCustomInstructions");
    expect(retryPromptContextSource).toContain("./review-retry-instructions.ts");
  });

  test("keeps retry execution outcome telemetry out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const retryJobSource = readFileSync(new URL("./review-timeout-retry-job.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const retryHasStructuredProgress =");
    expect(source).not.toContain("const retryHasResults =");
    expect(source).not.toContain("const retryTimeoutClassification = classifyReviewTimeoutOutcome({");
    expect(source).not.toContain("warningPrefix: \"Retry\"");
    expect(source).not.toContain("kind: \"retry\",\n                            reviewOutputKey: retryReviewOutputKey");
    expect(source).not.toContain("timeoutClassification: retryTimeoutClassification.classification");
    expect(source).toContain("scheduleReviewTimeoutRetryContinuation");
    expect(source).toContain("./review-timeout-retry-scheduling.ts");
    expect(retryJobSource).toContain("resolveReviewRetryExecutionOutcome");
  });

  test("keeps retry outcome checkpoint adapters out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const adaptersSource = readFileSync(new URL("./review-timeout-retry-adapters.ts", import.meta.url), "utf8");

    expect(source).not.toContain("getCheckpoint: (key) => knowledgeStore?.getCheckpoint?.(key) ?? Promise.resolve(null)");
    expect(source).toContain("buildReviewRetryOutcomeCheckpointLookup");
    expect(source).toContain("./review-timeout-retry-adapters.ts");
    expect(adaptersSource).toContain("export function buildReviewRetryOutcomeCheckpointLookup");
  });

  test("keeps review execution resource cleanup out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const cleanupSource = readFileSync(new URL("./review-execution-cleanup.ts", import.meta.url), "utf8");

    expect(source).not.toContain("await workspace.cleanup();");
    expect(source).toContain("cleanupReviewExecutionResources");
    expect(cleanupSource).toContain("export async function cleanupReviewExecutionResources");
  });

  test("keeps handler failure publication adapter binding out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const adapterSource = readFileSync(new URL("./review-handler-failure-publication-adapter.ts", import.meta.url), "utf8");

    expect(source).not.toContain("publishHandlerFailureError: async () => await publishReviewHandlerFailureError({");
    expect(source).not.toContain("publishHandlerFailureError: buildReviewHandlerFailurePublicationAdapter({\n            getOctokit: () => githubApp.getInstallationOctokit(event.installationId),");
    expect(source).toContain("buildReviewHandlerFailurePublicationAdapterFromHandlerDependencies");
    expect(source).toContain("buildReviewHandlerFailurePublicationAdapter");
    expect(source).toContain("./review-handler-failure-publication-adapter.ts");
    expect(adapterSource).toContain("export function buildReviewHandlerFailurePublicationAdapterFromHandlerDependencies");
    expect(adapterSource).toContain("export function buildReviewHandlerFailurePublicationAdapter");
  });

  test("keeps continuation revision delta classification out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const retryContinuationSettlementSource = readFileSync(new URL("./review-retry-continuation-settlement.ts", import.meta.url), "utf8");
    const retryJobSource = readFileSync(new URL("./review-timeout-retry-job.ts", import.meta.url), "utf8");

    expect(source).not.toContain("knowledgeStore.getPriorReviewFindings({\n                              repo: `${apiOwner}/${apiRepo}`");
    expect(source).not.toContain("currentFindings: currentFindings.map((finding) => ({");
    expect(source).not.toContain("Continuation delta classification failed (fail-open, merging without revision labels)");
    expect(source).toContain("scheduleReviewTimeoutRetryContinuation");
    expect(retryJobSource).toContain("settleRetryContinuationResults");
    expect(retryContinuationSettlementSource).toContain("resolveReviewContinuationRevisionCounts");
  });

  test("keeps first-pass finding delta classification out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const deltaSource = readFileSync(new URL("./review-delta-classification.ts", import.meta.url), "utf8");

    expect(source).not.toContain("knowledgeStore?.getPriorReviewFindings");
    expect(source).not.toContain("knowledgeStore.getPriorReviewFindings!({");
    expect(source).not.toContain("knowledgeStore!.getPriorReviewFindings({");
    expect(source).not.toContain("classifyFindingDeltas({");
    expect(source).not.toContain("Delta classification failed (fail-open, publishing without delta labels)");
    expect(source).toContain("resolveReviewDeltaClassification");
    expect(source).toContain("buildReviewDeltaPriorFindingLookup");
    expect(source).toContain("./review-delta-classification.ts");
    expect(deltaSource).toContain("classifyFindingDeltas");
    expect(deltaSource).toContain("fingerprintFindingTitle");
    expect(deltaSource).toContain("export function buildReviewDeltaPriorFindingLookup");
  });

  test("keeps retry continuation merge body context out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const retryContinuationSettlementSource = readFileSync(new URL("./review-retry-continuation-settlement.ts", import.meta.url), "utf8");
    const retryJobSource = readFileSync(new URL("./review-timeout-retry-job.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const mergedFirstPass = normalizeReviewFirstPass({");
    expect(source).not.toContain("const summaryDraftForMerge =");
    expect(source).not.toContain("const maxTurnsContinuationCompleted =");
    expect(source).not.toContain("const mergedBody = maxTurnsContinuationCompleted");
    expect(source).toContain("scheduleReviewTimeoutRetryContinuation");
    expect(retryJobSource).toContain("settleRetryContinuationResults");
    expect(retryContinuationSettlementSource).toContain("resolveReviewContinuationMergeContext");
  });

  test("keeps clean review approval body assembly out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const cleanApprovalSource = readFileSync(new URL("./review-clean-approval.ts", import.meta.url), "utf8");
    const orchestrationSource = readFileSync(
      new URL("./review-fallback-publication-orchestration.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("const approvalEvidence = [");
    expect(source).not.toContain("Review prompt covered ${promptFiles.length} changed file");
    expect(source).not.toContain("renderApprovalConfidence(depBumpContext.mergeConfidence)");
    expect(source).not.toContain("buildCleanReviewApprovalBody");
    expect(cleanApprovalSource).toContain("buildCleanReviewApprovalBody");
    expect(orchestrationSource).toContain("./review-clean-approval-publication.ts");
  });

  test("keeps clean review approval publication orchestration out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const orchestrationSource = readFileSync(
      new URL("./review-fallback-publication-orchestration.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("const cleanReviewPublicationReason =");
    expect(source).not.toContain("const canonicalApprovalReview = await upsertCanonicalReviewSurface");
    expect(source).not.toContain("Skipping auto-approval because review output marker was published");
    expect(source).toContain("publishAndApplyReviewFallbackOutputs");
    expect(orchestrationSource).toContain("publishCleanReviewApproval");
    expect(orchestrationSource).toContain("./review-clean-approval-publication.ts");
  });

  test("keeps review execution error fallback body selection out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const orchestrationSource = readFileSync(
      new URL("./review-fallback-publication-orchestration.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("let errorBody: string;");
    expect(source).not.toContain("errorBody = buildReviewTurnLimitFallbackBody");
    expect(source).not.toContain("errorBody = buildReviewRunErrorFallbackBody");
    expect(source).toContain("publishAndApplyReviewFallbackOutputs");
    expect(orchestrationSource).toContain("publishReviewExecutionErrorFallback");
  });

  test("keeps review execution error fallback publication out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const orchestrationSource = readFileSync(
      new URL("./review-fallback-publication-orchestration.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("const errorBody = buildReviewExecutionErrorFallbackBody");
    expect(source).not.toContain("reviewPublishResolution = exhaustedTurnBudget ? \"turn-limit-fallback\" : \"error-fallback\"");
    expect(source).not.toContain("reviewPublishResolution = exhaustedTurnBudget ? \"turn-limit-fallback-undelivered\" : \"error-comment-failed\"");
    expect(source).toContain("publishAndApplyReviewFallbackOutputs");
    expect(orchestrationSource).toContain("publishReviewExecutionErrorFallback");
    expect(orchestrationSource).toContain("./review-error-publication.ts");
  });

  test("keeps review handler failure error publication out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const adapterSource = readFileSync(new URL("./review-handler-failure-publication-adapter.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const errorBody = buildReviewHandlerFailureErrorBody");
    expect(source).not.toContain("await postOrUpdateErrorComment(errOctokit");
    expect(source).not.toContain("posted error comment after handler failure");
    expect(source).not.toContain("suppressed error comment after handler failure because publish rights were lost");
    expect(source).toContain("buildReviewHandlerFailurePublicationAdapter");
    expect(adapterSource).toContain("publishReviewHandlerFailureError");
    expect(adapterSource).toContain("./review-error-publication.ts");
  });

  test("keeps review handler failure recovery policy out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("workspace preparation failed");
    expect(source).not.toContain("retrieval/context assembly failed");
    expect(source).not.toContain("if (publicationPhaseStartedAt === undefined)");
    expect(source).not.toContain("Failed to post error comment to PR");
    expect(source).not.toContain("failed to publish error comment after handler failure");
    expect(source).toContain("handleReviewHandlerFailureRecovery");
    expect(source).toContain("./review-handler-failure-recovery.ts");
  });

  test("keeps review phase summary finalization out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const shouldLogPhaseSummary =");
    expect(source).not.toContain("buildOrderedReviewPhaseSummary(reviewPhaseTimings)");
    expect(source).not.toContain("buildReviewPhaseTimingSummaryLogFields({");
    expect(source).not.toContain("\"Review phase timing summary\"");
    expect(source).toContain("finalizeReviewPhaseSummary");
    expect(source).toContain("./review-phase-summary-finalization.ts");
  });

  test("keeps generic failure fallback publication out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const orchestrationSource = readFileSync(
      new URL("./review-fallback-publication-orchestration.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("const failureBody = buildReviewFailureFallbackBody();");
    expect(source).not.toContain("reviewPublishResolution = \"failure-fallback\"");
    expect(source).not.toContain("reviewPublishResolution = \"failure-fallback-failed\"");
    expect(source).toContain("publishAndApplyReviewFallbackOutputs");
    expect(orchestrationSource).toContain("publishReviewFailureFallback");
    expect(orchestrationSource).toContain("./review-failure-publication.ts");
  });

  test("keeps automatic review validation-truth projection out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const lifecycleContextSource = readFileSync(new URL("./review-finding-lifecycle-context.ts", import.meta.url), "utf8");

    expect(source).not.toContain("attachReviewValidationTruth({");
    expect(source).not.toContain("convertPublishedCandidateResultsToValidationTruthFixes({");
    expect(source).not.toContain("Projected review validation truth evidence");
    expect(source).not.toContain("Review validation truth diagnostics failed; continuing review publication");
    expect(source).not.toContain("projectAutomaticReviewValidationTruth({");
    expect(source).toContain("./review-finding-lifecycle-context.ts");
    expect(lifecycleContextSource).toContain("projectAutomaticReviewValidationTruth");
    expect(lifecycleContextSource).toContain("./review-validation-truth.ts");
  });

  test("keeps filtered inline comment cleanup policy out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const cleanupSource = readFileSync(new URL("./review-filtered-inline-cleanup.ts", import.meta.url), "utf8");

    expect(source).not.toContain("removeFilteredInlineComments({");
    expect(source).not.toContain("reviewOutputSucceeded && filteredInlineFindings.length > 0");
    expect(source).toContain("removeFilteredInlineCommentsForSuccessfulReview");
    expect(source).toContain("./review-filtered-inline-cleanup.ts");
    expect(cleanupSource).toContain("removeFilteredInlineComments");
  });

  test("keeps review-requested reaction publication out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("await postReviewRequestedEyesReaction({");
    expect(source).not.toContain("Add eyes reaction only for explicit re-review requests.");
    expect(source).not.toContain("createForIssue({");
    expect(source).not.toContain("Failed to add eyes reaction to PR");
    expect(source).toContain("maybePostReviewRequestedEyesReaction");
    expect(source).toContain("./review-reactions.ts");
  });

  test("keeps review-requested target gating out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const eventRuntimeSource = readFileSync(new URL("./review-event-runtime.ts", import.meta.url), "utf8");

    expect(source).not.toContain("\"requested_reviewer\" in reviewRequestedPayload");
    expect(source).not.toContain("normalizeReviewerLogin(requestedReviewerLogin)");
    expect(source).not.toContain("Skipping review_requested event for non-kodiai reviewer");
    expect(source).not.toContain("Skipping review_requested event because only a team was requested");
    expect(source).toContain("./review-event-runtime.ts");
    expect(eventRuntimeSource).toContain("evaluateReviewRequestedGate");
    expect(eventRuntimeSource).toContain("./review-requested-gate.ts");
  });

  test("keeps review clone planning out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const eventRuntimeSource = readFileSync(new URL("./review-event-runtime.ts", import.meta.url), "utf8");

    expect(source).not.toContain("let cloneOwner: string;");
    expect(source).not.toContain("const isDeletedFork = !headRepo;");
    expect(source).not.toContain("cloneRef = pr.base.ref;");
    expect(source).not.toContain("cloneRef = pr.head.ref;");
    expect(source).toContain("./review-event-runtime.ts");
    expect(eventRuntimeSource).toContain("resolveReviewClonePlan");
    expect(eventRuntimeSource).toContain("./review-clone-plan.ts");
  });

  test("keeps workspace preparation and trusted config loading out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("workspaceManager.create(event.installationId");
    expect(source).not.toContain("const trustedBaseRepoConfig = usesPrRef");
    expect(source).not.toContain("fetchAndCheckoutPullRequestHeadRef({");
    expect(source).not.toContain("fetchRemoteTrackingBranchFn({");
    expect(source).not.toContain("const { config, warnings } = trustedBaseRepoConfig");
    expect(source).toContain("prepareReviewWorkspace");
    expect(source).toContain("./review-workspace-preparation.ts");
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

  test("keeps draft PR tone decision and logging out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const eventRuntimeSource = readFileSync(new URL("./review-event-runtime.ts", import.meta.url), "utf8");

    expect(source).not.toContain("const isDraft = action === \"ready_for_review\" ? false : Boolean(pr.draft);");
    expect(source).not.toContain("Reviewing draft PR with draft tone");
    expect(source).toContain("./review-event-runtime.ts");
    expect(eventRuntimeSource).toContain("resolveReviewDraftToneContext");
    expect(eventRuntimeSource).toContain("./review-draft-tone.ts");
  });

  test("keeps durable run-state idempotency gating out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("knowledgeStore.checkAndClaimRun({");
    expect(source).not.toContain("gate: 'run-state-idempotency'");
    expect(source).not.toContain("Run state idempotency check failed (fail-open, proceeding with review)");
    expect(source).toContain("evaluateReviewRunStateGate");
    expect(source).toContain("./review-run-state-gate.ts");
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

  test("keeps review diff context collection out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("Build changed files and diff context, handling shallow-history merge-base gaps.");
    expect(source).not.toContain("const diffContext = await diffContextCollector({");
    expect(source).not.toContain("fallbackDiffProvider: async () => await fetchAllPullRequestFiles({");
    expect(source).not.toContain("buildPrDiffCommentabilityIndex(diffContentForValidation)");
    expect(source).toContain("resolveReviewDiffContext");
    expect(source).toContain("./review-diff-context.ts");
  });

  test("keeps incremental review file filtering out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("let reviewFiles = changedFiles;");
    expect(source).not.toContain("new Set(incrementalResult.changedFilesSinceLastReview)");
    expect(source).not.toContain("Filtered to incremental changed files");
    expect(source).toContain("resolveReviewFilesForIncrementalReview");
    expect(source).toContain("./review-incremental-diff.ts");
  });

  test("keeps prior finding context lookup out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const changedFileContextSource = readFileSync(new URL("./review-changed-file-context.ts", import.meta.url), "utf8");

    expect(source).not.toContain("let priorFindingCtx: PriorFindingContext | null = null;");
    expect(source).not.toContain("let priorFindings: PriorFinding[] = [];");
    expect(source).not.toContain("knowledgeStore.getPriorReviewFindings({\n              repo: `${apiOwner}/${apiRepo}`");
    expect(source).not.toContain("Prior finding context failed (fail-open, no dedup)");
    expect(source).toContain("resolveReviewChangedFileContext");
    expect(changedFileContextSource).toContain("resolveReviewPriorFindingContext");
    expect(changedFileContextSource).toContain("./review-prior-finding-context.ts");
  });

  test("keeps repo doctrine context resolution out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const changedFileContextSource = readFileSync(new URL("./review-changed-file-context.ts", import.meta.url), "utf8");

    expect(source).not.toContain("normalizeRepoDoctrineProjection(config.review.doctrine, changedFiles)");
    expect(source).not.toContain("toRepoDoctrineReviewSurfaceProjection(repoDoctrineProjection)");
    expect(source).not.toContain("Resolved bounded repository doctrine projection");
    expect(source).toContain("resolveReviewChangedFileContext");
    expect(changedFileContextSource).toContain("resolveReviewRepoDoctrineContext");
    expect(changedFileContextSource).toContain("./review-repo-doctrine-context.ts");
  });

  test("keeps changed-file review context orchestration out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const changedFileContextSource = readFileSync(new URL("./review-changed-file-context.ts", import.meta.url), "utf8");

    expect(source).not.toContain("analyzeDiff({");
    expect(source).not.toContain("buildReviewFileRiskScores({");
    expect(source).not.toContain("resolveReviewStructuralImpactSelection({");
    expect(source).not.toContain("resolveReviewLargePrTriage({");
    expect(source).not.toContain("resolveReviewPathInstructions({");
    expect(source).not.toContain("resolveReviewRepoDoctrineContext({");
    expect(source).not.toContain("resolveReviewPriorFindingContext({");
    expect(source).toContain("resolveReviewChangedFileContext");
    expect(source).toContain("./review-changed-file-context.ts");
    expect(changedFileContextSource).toContain("export async function resolveReviewChangedFileContext");
    expect(changedFileContextSource).toContain("analyzeDiff({");
    expect(changedFileContextSource).toContain("buildReviewFileRiskScores({");
    expect(changedFileContextSource).toContain("resolveReviewStructuralImpactSelection({");
    expect(changedFileContextSource).toContain("resolveReviewLargePrTriage({");
    expect(changedFileContextSource).toContain("resolveReviewPathInstructions({");
    expect(changedFileContextSource).toContain("resolveReviewRepoDoctrineContext({");
    expect(changedFileContextSource).toContain("resolveReviewPriorFindingContext({");
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

  test("keeps retry queue execution wrapper out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).not.toContain("void jobQueue.enqueue(event.installationId, async () =>");
    expect(source).not.toContain("handleRetryJobFailure({");
    expect(source).not.toContain("finalizeRetryJobAttempt({");
    expect(source).not.toContain("handleRetryEnqueueFailure({");
    expect(source).toContain("scheduleReviewTimeoutRetryContinuation");
    expect(source).toContain("./review-timeout-retry-scheduling.ts");
  });

  test("keeps retry continuation scheduling orchestration out of the monster handler", () => {
    const source = readFileSync(new URL("./review.ts", import.meta.url), "utf8");
    const schedulingSource = readFileSync(
      new URL("./review-timeout-retry-scheduling.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("const retryReviewWorkAttempt = reviewWorkCoordinator.claim({");
    expect(source).not.toContain("recordReviewTimeoutRetryPreEnqueueSideEffects({");
    expect(source).not.toContain("retryAttemptId: retryReviewWorkAttempt.attemptId");
    expect(source).toContain("scheduleReviewTimeoutRetryContinuation");
    expect(source).toContain("./review-timeout-retry-scheduling.ts");
    expect(schedulingSource).toContain("reviewWorkCoordinator.claim({");
    expect(schedulingSource).toContain("recordReviewTimeoutRetryPreEnqueueSideEffects({");
    expect(schedulingSource).toContain("enqueueRetryJob({");
  });
});
