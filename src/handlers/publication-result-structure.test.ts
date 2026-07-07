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
});
