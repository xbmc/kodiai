import { describe, expect, test } from "bun:test";
import type { ExtractedFinding } from "./review-comment-finding-extraction.ts";

describe("ExtractedFinding shape", () => {
  test("accepts structured inline review comment metadata", () => {
    const finding: ExtractedFinding = {
      commentId: 1,
      filePath: "src/example.ts",
      title: "Missing null check",
      severity: "major",
      category: "correctness",
      startLine: 10,
      endLine: 12,
    };

    expect(finding.commentId).toBe(1);
    expect(finding.severity).toBe("major");
  });
});
