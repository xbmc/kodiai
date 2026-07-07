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
    expect(source).toMatch(/\bok\(/);
    expect(source).toContain("if (!fallbackPublication.ok)");
    expect(source).toContain("fallbackPublication.value");
  });

  test("keeps bounded first-pass timeout publication orchestration on shared Result shape", () => {
    const source = readFileSync(
      new URL("./review-bounded-first-pass-timeout-publication.ts", import.meta.url),
      "utf8",
    );
    const handlerSource = readFileSync(new URL("./review.ts", import.meta.url), "utf8");

    expect(source).toContain("type Result");
    expect(source).toContain("BoundedFirstPassTimeoutPublicationResult");
    expect(source).toContain("Result<BoundedFirstPassTimeoutPublicationValue");
    expect(source).toMatch(/\bok\(/);
    expect(source).toContain("if (!publication.ok)");
    expect(handlerSource).toContain("resolveBoundedFirstPassTimeoutPublicationState");
    expect(handlerSource).toContain("boundedFirstPassPublicationState.partialCommentId");
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
});
