import { wrapInDetails } from "../lib/formatting.ts";
import { formatErrorComment, type ErrorCategory } from "../lib/errors.ts";
import {
  buildExplicitReviewTextFallbackLines,
  type ExplicitMentionReviewPublishSkipReason,
} from "../review-orchestration/explicit-mention-review-publish.ts";
import { buildExplicitReviewNoOutputFallbackLines } from "./mention-publication-state.ts";

export type MentionSuccessFallbackBodyInput = {
  explicitReviewRequest: boolean;
  hasUnpublishedFindings: boolean;
  findingLines: string[];
  resultText: string | undefined;
  skipReason: ExplicitMentionReviewPublishSkipReason | undefined;
};

export type MentionFailureFallbackBodyInput = {
  explicitReviewRequest: boolean;
  exhaustedTurnBudget: boolean;
  routingReason: string | undefined;
};

export type MentionErrorFallbackBodyInput = {
  category: ErrorCategory;
  detail: string;
};

export function buildMentionSuccessFallbackBody(input: MentionSuccessFallbackBodyInput): string {
  const fallbackLines = input.explicitReviewRequest
    ? input.hasUnpublishedFindings
      ? input.findingLines.length > 0
        ? ["Decision: NOT APPROVED", "Issues:", ...input.findingLines]
        : buildExplicitReviewTextFallbackLines(input.resultText)
      : buildExplicitReviewNoOutputFallbackLines(input.skipReason)
    : [
        "I can answer this, but I need one detail first.",
        "",
        "Could you share the exact outcome you want and the primary file/path I should focus on first?",
      ];

  return wrapInDetails(
    fallbackLines.join("\n"),
    "kodiai response",
  );
}

export function buildMentionFailureFallbackBody(input: MentionFailureFallbackBodyInput): string {
  if (input.exhaustedTurnBudget) {
    return wrapInDetails(
      [
        "I ran out of steps analyzing this and wasn't able to post a complete response.",
        "",
        ...(input.routingReason === "tiny-diff"
          ? [
              "This was a tiny-diff review, so this indicates an execution-budget or tool-loop problem rather than PR size. The run has been recorded with small-diff routing diagnostics.",
            ]
          : [
              "No review findings were published for this request.",
              "",
              "This usually means the agent got stuck in tool use or exceeded its step budget for this run.",
              "Try a narrower request such as `@kodiai review path/to/file.cpp` if it repeats.",
            ]),
      ].join("\n"),
      "kodiai response",
    );
  }

  const detailLines = input.explicitReviewRequest
    ? [
        "I couldn't publish a trustworthy review result for this request.",
        "",
        "No code findings were published.",
        "",
        "The run was recorded with failure diagnostics for operators.",
        "Try a narrower request such as `@kodiai review path/to/file.cpp` if it repeats.",
      ]
    : [
        "I couldn't publish a response for this request.",
        "",
        "The run was recorded with failure diagnostics for operators.",
        "Try a more targeted question with the main file/path I should inspect first.",
      ];

  return wrapInDetails(detailLines.join("\n"), "kodiai response");
}

export function buildMentionErrorFallbackBody(input: MentionErrorFallbackBodyInput): string {
  return wrapInDetails(
    formatErrorComment(input.category, input.detail),
    "Kodiai encountered an error",
  );
}
