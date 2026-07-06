import { describe, expect, test } from "bun:test";
import { buildReviewRetryCustomInstructions } from "./review-retry-instructions.ts";

describe("buildReviewRetryCustomInstructions", () => {
  test("builds timeout retry instructions without checkpoint guidance", () => {
    expect(buildReviewRetryCustomInstructions({
      basePrompt: "",
      isTimeout: true,
      checkpointEnabled: false,
    })).toBe([
      "This is a retry of a timed-out review with reduced scope.",
      "Focus ONLY on the changed files listed above.",
      "Do NOT post a top-level summary comment; only publish inline comments.",
    ].join("\n"));
  });

  test("builds max-turns retry instructions with checkpoint guidance", () => {
    expect(buildReviewRetryCustomInstructions({
      basePrompt: "",
      isTimeout: false,
      checkpointEnabled: true,
    })).toBe([
      "This is a retry of a review that exhausted max turns with reduced scope.",
      "Focus ONLY on the changed files listed above.",
      "Do NOT post a top-level summary comment; only publish inline comments.",
      "At the end, call save_review_checkpoint with a summaryDraft that summarizes findings so far and a findingCount total.",
    ].join("\n"));
  });

  test("preserves base review prompt before retry instructions", () => {
    expect(buildReviewRetryCustomInstructions({
      basePrompt: "  Prefer concise comments.  ",
      isTimeout: true,
      checkpointEnabled: false,
    })).toBe([
      "Prefer concise comments.",
      "",
      "This is a retry of a timed-out review with reduced scope.",
      "Focus ONLY on the changed files listed above.",
      "Do NOT post a top-level summary comment; only publish inline comments.",
    ].join("\n"));
  });
});
