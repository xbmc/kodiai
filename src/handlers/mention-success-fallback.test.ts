import { describe, expect, test } from "bun:test";
import {
  buildMentionErrorFallbackBody,
  buildMentionFailureFallbackBody,
  buildMentionSuccessFallbackBody,
} from "./mention-success-fallback.ts";

describe("buildMentionSuccessFallbackBody", () => {
  test("formats explicit review findings as a not-approved kodiai response", () => {
    const body = buildMentionSuccessFallbackBody({
      explicitReviewRequest: true,
      hasUnpublishedFindings: true,
      findingLines: ["- (1) [major] src/auth.cpp (42): validates the wrong token"],
      resultText: "unused",
      skipReason: "result-text-findings",
    });

    expect(body).toContain("<summary>kodiai response</summary>");
    expect(body).toContain("Decision: NOT APPROVED");
    expect(body).toContain("Issues:");
    expect(body).toContain("validates the wrong token");
  });

  test("surfaces unparseable explicit review text instead of generic guidance", () => {
    const body = buildMentionSuccessFallbackBody({
      explicitReviewRequest: true,
      hasUnpublishedFindings: true,
      findingLines: [],
      resultText: "The patch still breaks login.",
      skipReason: "result-text-findings",
    });

    expect(body).toContain("Decision: NOT APPROVED");
    expect(body).toContain("The patch still breaks login.");
    expect(body).not.toContain("Could you share the exact outcome");
  });

  test("asks for clarification for non-review mentions", () => {
    const body = buildMentionSuccessFallbackBody({
      explicitReviewRequest: false,
      hasUnpublishedFindings: false,
      findingLines: [],
      resultText: undefined,
      skipReason: undefined,
    });

    expect(body).toContain("I can answer this, but I need one detail first.");
    expect(body).toContain("Could you share the exact outcome");
  });
});

describe("buildMentionFailureFallbackBody", () => {
  test("formats turn-limit failure for tiny-diff explicit reviews", () => {
    const body = buildMentionFailureFallbackBody({
      explicitReviewRequest: true,
      exhaustedTurnBudget: true,
      routingReason: "tiny-diff",
    });

    expect(body).toContain("<summary>kodiai response</summary>");
    expect(body).toContain("I ran out of steps analyzing this");
    expect(body).toContain("small-diff routing diagnostics");
    expect(body).not.toContain("Try a narrower request");
  });

  test("formats normal turn-limit failure with narrower review guidance", () => {
    const body = buildMentionFailureFallbackBody({
      explicitReviewRequest: true,
      exhaustedTurnBudget: true,
      routingReason: "llm",
    });

    expect(body).toContain("No review findings were published for this request.");
    expect(body).toContain("Try a narrower request such as `@kodiai review path/to/file.cpp`");
  });

  test("formats non-turn-limit failure for non-review mentions", () => {
    const body = buildMentionFailureFallbackBody({
      explicitReviewRequest: false,
      exhaustedTurnBudget: false,
      routingReason: undefined,
    });

    expect(body).toContain("I couldn't publish a response for this request.");
    expect(body).toContain("Try a more targeted question");
    expect(body).not.toContain("No code findings were published.");
  });
});

describe("buildMentionErrorFallbackBody", () => {
  test("wraps classified mention errors in the public error details block", () => {
    const body = buildMentionErrorFallbackBody({
      category: "internal_error",
      detail: "boom in /tmp/private-checkout",
    });

    expect(body).toContain("<summary>Kodiai encountered an error</summary>");
    expect(body).toContain("Kodiai could not complete the request");
    expect(body).toContain("failed before KodiAI could publish");
    expect(body).not.toContain("boom");
    expect(body).not.toContain("/tmp/private-checkout");
  });

  test("preserves timeout-specific public guidance", () => {
    const body = buildMentionErrorFallbackBody({
      category: "timeout",
      detail: "timed out after 900s with raw diagnostics",
    });

    expect(body).toContain("Kodiai timed out");
    expect(body).toContain("exceeded its execution time");
    expect(body).toContain("@kodiai review path/to/file.cpp");
    expect(body).not.toContain("raw diagnostics");
  });
});
