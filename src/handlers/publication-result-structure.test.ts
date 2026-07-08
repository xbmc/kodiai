import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const publicationResultHelpers = [
  "./mention-failure-publication.ts",
  "./mention-format-only-publication.ts",
  "./mention-combined-format-publication.ts",
  "./mention-explicit-review-publication.ts",
  "./mention-publication.ts",
  "./mention-result-fallback-publication.ts",
  "./review-clean-approval-publication.ts",
  "./review-depends-publication.ts",
  "./review-error-publication.ts",
  "./review-failure-publication.ts",
  "./review-partial-publication.ts",
];

describe("publication result structure", () => {
  test("uses the shared Result constructors for publication helper failures", () => {
    for (const helper of publicationResultHelpers) {
      const source = readFileSync(new URL(helper, import.meta.url), "utf8");

      expect(source, helper).not.toMatch(/return\s*\{\s*\n\s*ok:\s*true,/);
      expect(source, helper).not.toMatch(/return\s*\{\s*\n\s*ok:\s*false,/);
      expect(source, helper).toMatch(/\bok\(|resultOk\(/);
      expect(source, helper).toMatch(/\berr\(|resultErr\(/);
    }
  });

  test("keeps degraded Review Details fallback publication on Result shape", () => {
    const source = readFileSync(
      new URL("../review-orchestration/review-canonical-surface.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("DegradedReviewDetailsFallbackPublicationResult");
    expect(source).toContain("Result<");
    expect(source).not.toContain("Promise<number | undefined>");
    expect(source).toContain("return ok({ published: false, commentId: undefined })");
    expect(source).toContain("return err({ published: false, error })");
  });

  test("keeps mention write adapters on shared Result shape", () => {
    for (const helper of [
      "./mention-fork-write-output.ts",
      "./mention-same-repo-write.ts",
      "./mention-bot-pr-write.ts",
      "./mention-write-output-routing.ts",
    ]) {
      const source = readFileSync(new URL(helper, import.meta.url), "utf8");

      expect(source, helper).toContain("type Result");
      expect(source, helper).toMatch(/Promise<[^>]*Result/);
      expect(source, helper).toMatch(/\bok\(/);
    }
  });

  test("keeps formatter suggestion publisher on shared Result shape", () => {
    const source = readFileSync(
      new URL("../execution/formatter-suggestion-publisher.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("type Result");
    expect(source).toMatch(/Promise<[^>]*Result/);
    expect(source).not.toContain("failed?: boolean");
    expect(source).toMatch(/\bok\(/);
    expect(source).toMatch(/\berr\(/);
  });

  test("keeps review candidate publication adapter boundary on shared Result shape", () => {
    const source = readFileSync(
      new URL("../review-orchestration/review-candidate-publication-adapter.ts", import.meta.url),
      "utf8",
    );
    const contextSource = readFileSync(
      new URL("./review-candidate-approval-context.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("type Result");
    expect(source).toContain("ReviewCandidatePublicationAdapterOutcome");
    expect(source).toContain("Result<ReviewCandidatePublicationAdapterResult>");
    expect(source).toContain("adaptApprovedCandidatesForInlinePublicationResult");
    expect(source).toMatch(/\bok\(/);
    expect(contextSource).toContain("adaptApprovedCandidatesForInlinePublicationResult");
    expect(contextSource).toContain("if (!publicationAdapterResult.ok)");
  });

  test("keeps review candidate inline publication boundary on shared Result shape", () => {
    const source = readFileSync(
      new URL("./review-candidate-inline-publication.ts", import.meta.url),
      "utf8",
    );
    const preparationSource = readFileSync(
      new URL("./review-candidate-publication-preparation.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("type Result");
    expect(source).toContain("ReviewCandidateInlinePublicationResult = Result<");
    expect(source).toMatch(/\bok\(/);
    expect(source).toMatch(/\berr\(/);
    expect(preparationSource).toContain("if (!candidateInlinePublication.ok)");
  });

  test("keeps mention post-executor publication boundary on shared Result shape", () => {
    const source = readFileSync(
      new URL("./mention-post-executor-publication.ts", import.meta.url),
      "utf8",
    );
    const handlerSource = readFileSync(new URL("./mention.ts", import.meta.url), "utf8");

    expect(source).toContain("type Result");
    expect(source).toContain("MentionPostExecutorPublicationResult = Result<");
    expect(source).toMatch(/\bok\(/);
    expect(source).toMatch(/\berr\(/);
    expect(handlerSource).toContain("if (!postExecutorPublication.ok)");
    expect(handlerSource).toContain("postExecutorPublication.value.writeOutputHandled");
  });

  test("keeps mention execution fallback publication boundary on shared Result shape", () => {
    const source = readFileSync(new URL("./mention-execution-fallbacks.ts", import.meta.url), "utf8");
    const postExecutorSource = readFileSync(
      new URL("./mention-post-executor-publication.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("type Result");
    expect(source).toContain("MentionExecutionFallbackPublicationResult = Result<");
    expect(source).toMatch(/\bok\(/);
    expect(postExecutorSource).toContain("if (!fallbackPublication.ok)");
    expect(postExecutorSource).toContain("...fallbackPublication.value");
  });

  test("keeps explicit mention review publication orchestration on shared Result shape", () => {
    const source = readFileSync(
      new URL("./mention-explicit-review-publication-orchestration.ts", import.meta.url),
      "utf8",
    );
    const postExecutorSource = readFileSync(
      new URL("./mention-post-executor-publication.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("type Result");
    expect(source).toContain("ExplicitMentionReviewPublicationOrchestrationResult");
    expect(source).toContain("Result<ExplicitMentionReviewPublicationOrchestrationValue>");
    expect(source).toMatch(/\bok\(/);
    expect(postExecutorSource).toContain("if (!explicitReviewPublicationOrchestration.ok)");
    expect(postExecutorSource).toContain("explicitReviewPublicationOrchestration.value");
  });

  test("keeps review fallback publication orchestration on shared Result shape", () => {
    const source = readFileSync(
      new URL("./review-fallback-publication-orchestration.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("type Result");
    expect(source).toContain("ReviewFallbackPublicationResult");
    expect(source).toContain("Result<ReviewFallbackPublicationStatePatch");
    expect(source).toContain("): Promise<ReviewFallbackPublicationResult> {");
    expect(source).toMatch(/\bok\(/);
    expect(source).toContain("if (!fallbackPublication.ok)");
    expect(source).toContain("fallbackPublication.value");
  });

  test("keeps review post-execution knowledge orchestration on shared Result shape", () => {
    const source = readFileSync(new URL("./review-post-execution-knowledge.ts", import.meta.url), "utf8");

    expect(source).toContain("type Result");
    expect(source).toContain("ReviewPostExecutionKnowledgeResult");
    expect(source).toContain("Result<ReviewPostExecutionKnowledgeStatus");
    expect(source).toContain("): Promise<ReviewPostExecutionKnowledgeResult> {");
    expect(source).toMatch(/\bresultOk\(/);
    expect(source).toMatch(/\bresultErr\(/);
    expect(source).not.toContain("): Promise<number | undefined> {");
  });

  test("keeps review post-execution telemetry orchestration on shared Result shape", () => {
    const source = readFileSync(new URL("./review-post-execution-telemetry.ts", import.meta.url), "utf8");
    const contextSource = readFileSync(
      new URL("./review-post-execution-telemetry-context.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("type Result");
    expect(source).toContain("ReviewPostExecutionTelemetryResult");
    expect(source).toContain("Result<ReviewPostExecutionTelemetryStatus");
    expect(source).toContain("): Promise<ReviewPostExecutionTelemetryResult> {");
    expect(source).toMatch(/\bresultOk\(/);
    expect(source).toMatch(/\bresultErr\(/);
    expect(contextSource).toContain("ReviewPostExecutionTelemetryForInstallationResult");
    expect(contextSource).toContain("): Promise<ReviewPostExecutionTelemetryForInstallationResult> {");
    expect(contextSource).toMatch(/\bresultErr\(/);
  });

  test("keeps bounded first-pass timeout publication orchestration on shared Result shape", () => {
    const source = readFileSync(
      new URL("./review-bounded-first-pass-timeout-publication.ts", import.meta.url),
      "utf8",
    );
    const orchestrationSource = readFileSync(
      new URL("./review-timeout-continuation-orchestration.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("type Result");
    expect(source).toContain("BoundedFirstPassTimeoutPublicationResult");
    expect(source).toContain("Result<BoundedFirstPassTimeoutPublicationValue");
    expect(source).toMatch(/\bok\(/);
    expect(source).toContain("if (!publication.ok)");
    expect(orchestrationSource).toContain("resolveBoundedFirstPassTimeoutPublicationState");
    expect(orchestrationSource).toContain("boundedFirstPassPublicationState.partialCommentId");
  });

  test("keeps timeout Review Details publication on shared Result shape", () => {
    const source = readFileSync(
      new URL("./review-details-timeout-publication.ts", import.meta.url),
      "utf8",
    );
    const timeoutSource = readFileSync(
      new URL("./review-bounded-first-pass-timeout-publication.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("type Result");
    expect(source).toContain("TimeoutReviewDetailsPublicationResult");
    expect(source).toContain("Result<TimeoutReviewDetailsPublicationStatus");
    expect(source).toMatch(/\bok\(/);
    expect(timeoutSource).toContain("if (!timeoutReviewDetailsPublication.ok)");
    expect(timeoutSource).toContain("timeoutReviewDetailsPublication.value");
  });

  test("keeps first-pass Review Details publication on shared Result shape", () => {
    const source = readFileSync(
      new URL("./review-details-first-pass-publication.ts", import.meta.url),
      "utf8",
    );
    const handlerSource = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).toContain("type Result");
    expect(source).toContain("FirstPassReviewDetailsPublicationResult");
    expect(source).toContain("Result<FirstPassReviewDetailsPublicationValue");
    expect(source).toMatch(/\bok\(/);
    expect(source).toContain("resolveFirstPassReviewDetailsPublicationBody");
    expect(handlerSource).toContain("resolveFirstPassReviewDetailsPublicationBody");
    expect(handlerSource).toContain("firstPassReviewDetailsPublication");
  });

  test("keeps published-output Review Details merge on shared Result shape", () => {
    const source = readFileSync(
      new URL("./review-details-published-merge.ts", import.meta.url),
      "utf8",
    );
    const firstPassSource = readFileSync(
      new URL("./review-details-first-pass-publication.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("type Result");
    expect(source).toContain("PublishedReviewDetailsMergeResult");
    expect(source).toContain("Result<PublishedReviewDetailsMergeStatus");
    expect(source).toMatch(/\bok\(/);
    expect(firstPassSource).toContain("const publishedMerge = await publishPublished");
    expect(firstPassSource).toContain("if (!publishedMerge.ok)");
    expect(firstPassSource).toContain("publishedMerge.value");
  });

  test("keeps moved-to-details Review Details merge on shared Result shape", () => {
    const source = readFileSync(
      new URL("./review-details-moved-to-details-merge.ts", import.meta.url),
      "utf8",
    );
    const firstPassSource = readFileSync(
      new URL("./review-details-first-pass-publication.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("type Result");
    expect(source).toContain("MovedToDetailsReviewDetailsMergeResult");
    expect(source).toContain("Result<MovedToDetailsReviewDetailsMergeStatus");
    expect(source).toMatch(/\bok\(/);
    expect(firstPassSource).toContain("const movedToDetailsMerge = await publishMovedToDetails");
    expect(firstPassSource).toContain("if (!movedToDetailsMerge.ok)");
    expect(firstPassSource).toContain("movedToDetailsMerge.value");
  });

  test("keeps standalone Review Details fallback on shared Result shape", () => {
    const source = readFileSync(
      new URL("./review-details-standalone-fallback.ts", import.meta.url),
      "utf8",
    );
    const firstPassSource = readFileSync(
      new URL("./review-details-first-pass-publication.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("type Result");
    expect(source).toContain("StandaloneReviewDetailsFallbackResult");
    expect(source).toContain("Result<StandaloneReviewDetailsFallbackStatus");
    expect(source).toMatch(/\bok\(/);
    expect(firstPassSource).toContain("const standaloneFallback = await publishStandalone");
    expect(firstPassSource).toContain("if (!standaloneFallback.ok)");
    expect(firstPassSource).toContain("standaloneFallback.value");
  });

  test("keeps degraded Review Details fallback fail-open helper on shared Result shape", () => {
    const source = readFileSync(
      new URL("./review-details-degraded-fallback.ts", import.meta.url),
      "utf8",
    );
    const timeoutSource = readFileSync(
      new URL("./review-details-timeout-publication.ts", import.meta.url),
      "utf8",
    );
    const retrySource = readFileSync(
      new URL("./review-details-retry-publication.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("type Result");
    expect(source).toContain("DegradedReviewDetailsFallbackFailOpenResult");
    expect(source).toContain("Result<DegradedReviewDetailsFallbackFailOpenStatus");
    expect(source).toMatch(/\bok\(/);
    expect(timeoutSource).toContain("const fallbackPublication = await publishFallback");
    expect(timeoutSource).toContain("fallbackPublication.value");
    expect(retrySource).toContain("const fallbackPublication = await publishFallback");
    expect(retrySource).toContain("fallbackPublication.value");
  });

  test("keeps retry merge continuation publication orchestration on shared Result shape", () => {
    const source = readFileSync(
      new URL("./review-retry-merge-publication.ts", import.meta.url),
      "utf8",
    );
    const retrySettlementSource = readFileSync(
      new URL("./review-retry-continuation-settlement.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("type Result");
    expect(source).toContain("RetryMergeContinuationPublicationResult");
    expect(source).toContain("Result<RetryMergeContinuationPublicationStatus");
    expect(source).toMatch(/\bok\(/);
    expect(source).toContain("publishRetryReviewDetailsMergeFn");
    expect(retrySettlementSource).toContain("publishRetryMergeContinuationResults");
  });

  test("keeps retry continuation settlement orchestration on shared Result shape", () => {
    const source = readFileSync(
      new URL("./review-retry-continuation-settlement.ts", import.meta.url),
      "utf8",
    );
    const retryJobSource = readFileSync(new URL("./review-timeout-retry-job.ts", import.meta.url), "utf8");

    expect(source).toContain("type Result");
    expect(source).toContain("RetryContinuationSettlementResult");
    expect(source).toContain("Result<RetryContinuationSettlementStatus");
    expect(source).toMatch(/\bok\(/);
    expect(source).toContain("publishRetryMergeContinuationResultsFn");
    expect(retryJobSource).toContain("settleRetryContinuationResults");
  });

  test("keeps no-additional-results retry settlement on shared Result shape", () => {
    const source = readFileSync(new URL("./review-retry-settlement.ts", import.meta.url), "utf8");
    const continuationSource = readFileSync(
      new URL("./review-retry-continuation-settlement.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("type Result");
    expect(source).toContain("RetryNoAdditionalResultsSettlementResult");
    expect(source).toContain("Result<RetryNoAdditionalResultsSettlementStatus");
    expect(source).toMatch(/\bok\(/);
    expect(continuationSource).toContain("const quietSettlement = await settleRetryWithNoAdditionalResults");
    expect(continuationSource).toContain("quietSettlement.value");
  });

  test("keeps cost warning publication helpers on shared Result shape", () => {
    for (const helper of [
      "./review-cost-warning.ts",
      "./mention-cost-warning.ts",
    ]) {
      const source = readFileSync(new URL(helper, import.meta.url), "utf8");

      expect(source, helper).toContain("type Result");
      expect(source, helper).toContain("CostWarningPublicationResult");
      expect(source, helper).toMatch(/Result<\w+CostWarningPublicationStatus/);
      expect(source, helper).toMatch(/\bok\(/);
    }
  });

  test("keeps disabled write-mode refusal publication on shared Result shape", () => {
    const source = readFileSync(new URL("./mention-write-disabled.ts", import.meta.url), "utf8");
    const prePromptSource = readFileSync(
      new URL("./mention-pre-prompt-gates.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("type Result");
    expect(source).toContain("DisabledWriteModeRefusalResult");
    expect(source).toContain("Result<DisabledWriteModeRefusalStatus");
    expect(source).toMatch(/\bok\(/);
    expect(prePromptSource).toContain(
      "const disabledWriteRefusal = await maybePublishDisabledWriteModeRefusal",
    );
    expect(prePromptSource).toContain("if (!disabledWriteRefusal.ok)");
    expect(prePromptSource).toContain("disabledWriteRefusal.value.refused");
  });

  test("keeps mention write PR publication on shared Result shape", () => {
    const source = readFileSync(new URL("./mention-write-pr-publication.ts", import.meta.url), "utf8");
    const botSource = readFileSync(new URL("./mention-bot-pr-write.ts", import.meta.url), "utf8");
    const forkSource = readFileSync(new URL("./mention-fork-write-output.ts", import.meta.url), "utf8");

    expect(source).toContain("type Result");
    expect(source).toContain("MentionWritePullRequestPublicationResult");
    expect(source).toMatch(/Result<\s*MentionWritePullRequestPublicationResponse/);
    expect(source).toMatch(/\bok\(/);
    expect(source).toMatch(/\berr\(/);
    expect(botSource).toContain("if (!response.ok)");
    expect(botSource).toContain("createdPr = response.value.data");
    expect(forkSource).toContain("if (!response.ok)");
    expect(forkSource).toContain("const createdPrUrl = response.value.data.html_url");
  });

  test("keeps primary gist write publication on shared Result shape", () => {
    const source = readFileSync(new URL("./mention-fork-write-output.ts", import.meta.url), "utf8");

    expect(source).toContain("PrimaryGistPublicationResult");
    expect(source).toContain("Result<PrimaryGistPublicationStatus");
    expect(source).not.toContain("}): Promise<boolean> {");
    expect(source).not.toContain("const handled = await publishPrimaryGist");
    expect(source).toContain("const primaryGistPublication = await publishPrimaryGist");
    expect(source).toContain("if (!primaryGistPublication.ok)");
    expect(source).toContain("primaryGistPublication.value.handled");
  });

  test("keeps write permission remediation publication on shared Result shape", () => {
    const repliesSource = readFileSync(new URL("./mention-write-replies.ts", import.meta.url), "utf8");
    const routingSource = readFileSync(new URL("./mention-write-output-routing.ts", import.meta.url), "utf8");
    const sameRepoSource = readFileSync(new URL("./mention-same-repo-write.ts", import.meta.url), "utf8");
    const botSource = readFileSync(new URL("./mention-bot-pr-write.ts", import.meta.url), "utf8");

    expect(repliesSource).toContain("type Result");
    expect(repliesSource).toContain("WritePermissionFailureReplyResult");
    expect(repliesSource).toContain("Result<WritePermissionFailureReplyStatus");
    expect(repliesSource).toMatch(/\bok\(/);
    expect(repliesSource).not.toContain("}): Promise<boolean> {");
    expect(routingSource).toContain("WritePermissionFailureReplyResult");
    expect(sameRepoSource).toContain("WritePermissionFailureReplyResult");
    expect(botSource).toContain("WritePermissionFailureReplyResult");
    expect(sameRepoSource).toContain("permissionReply.value.status === \"handled\"");
    expect(botSource).toContain("permissionReply.value.status === \"handled\"");
  });

  test("keeps issue write failure publication on shared Result shape", () => {
    const repliesSource = readFileSync(new URL("./mention-write-replies.ts", import.meta.url), "utf8");
    const botSource = readFileSync(new URL("./mention-bot-pr-write.ts", import.meta.url), "utf8");
    const routingSource = readFileSync(new URL("./mention-write-output-routing.ts", import.meta.url), "utf8");

    expect(repliesSource).toContain("IssueWriteFailurePublicationResult");
    expect(repliesSource).toContain("Result<IssueWriteFailurePublicationStatus");
    expect(repliesSource).toMatch(/\bok\(/);
    expect(repliesSource).toMatch(/\berr\(/);
    expect(repliesSource).not.toContain("}): Promise<void> {");
    expect(botSource).toContain("IssueWriteFailurePublicationResult");
    expect(botSource).toContain("const issueWriteFailure = await params.postIssueWriteFailure");
    expect(botSource).toContain("if (!issueWriteFailure.ok)");
    expect(routingSource).toContain("if (!botWritePullRequest.ok)");
  });

  test("keeps mention write-output enabled routing on shared Result shape", () => {
    const routingSource = readFileSync(new URL("./mention-write-output-routing.ts", import.meta.url), "utf8");
    const postExecutorSource = readFileSync(
      new URL("./mention-post-executor-publication.ts", import.meta.url),
      "utf8",
    );

    expect(routingSource).toContain("MentionWriteOutputEnabledRoutingResult");
    expect(routingSource).toContain("Result<MentionWriteOutputEnabledRoutingStatus");
    expect(routingSource).not.toContain("}): Promise<boolean> {");
    expect(routingSource).toContain("const writeOutput = await routeMentionWriteOutput");
    expect(routingSource).toContain("if (!writeOutput.ok)");
    expect(postExecutorSource).toContain("const writeOutputRouting = await routeMentionWriteOutputIfEnabled");
    expect(postExecutorSource).toContain("if (!writeOutputRouting.ok)");
    expect(postExecutorSource).toContain("writeOutputRouting.value.routed");
  });
});
