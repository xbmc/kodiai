import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const publicationResultHelpers = [
  "./mention-failure-publication.ts",
  "./mention-format-only-publication.ts",
  "./mention-combined-format-publication.ts",
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
      expect(source, helper).toContain("ok(");
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
});
