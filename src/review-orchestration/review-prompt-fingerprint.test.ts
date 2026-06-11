import { describe, expect, test } from "bun:test";
import { buildReviewPromptFingerprint } from "./review-prompt-fingerprint.ts";

describe("buildReviewPromptFingerprint", () => {
  test("returns null fingerprint when required prompt signals are missing", () => {
    const result = buildReviewPromptFingerprint({
      owner: "",
      repo: "kodiai",
      prNumber: 1,
      prTitle: "title",
      prBody: null,
      prAuthor: "author",
      baseBranch: "main",
      headBranch: "feature",
      changedFiles: [],
    } as unknown as Parameters<typeof buildReviewPromptFingerprint>[0]);

    expect(result.fingerprint).toBeNull();
    expect(result.missingSignals).toContain("repo-identity");
    expect(result.missingSignals).toContain("changed-files");
  });
});
