import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const publicationResultHelpers = [
  "./mention-failure-publication.ts",
  "./mention-result-fallback-publication.ts",
  "./review-error-publication.ts",
  "./review-failure-publication.ts",
];

describe("publication result structure", () => {
  test("uses the shared Result constructors for publication helper failures", () => {
    for (const helper of publicationResultHelpers) {
      const source = readFileSync(new URL(helper, import.meta.url), "utf8");

      expect(source, helper).not.toMatch(/return\s*\{\s*\n\s*ok:\s*true,/);
      expect(source, helper).not.toMatch(/return\s*\{\s*\n\s*ok:\s*false,/);
      expect(source, helper).toContain("ok(");
      expect(source, helper).toContain("err(");
    }
  });
});
