import type { Logger } from "pino";

type ReviewSkipAuthorLogger = Pick<Logger, "info">;

const DEFAULT_SKIPPED_AUTHORS = new Set(["weblate", "weblate[bot]"]);

export type ReviewSkipAuthorGateDecision =
  | { action: "continue" }
  | { action: "skip" };

export function evaluateReviewSkipAuthorGate(params: {
  prNumber: number;
  authorLogin: string;
  skipAuthors: readonly string[];
  logger: ReviewSkipAuthorLogger;
}): ReviewSkipAuthorGateDecision {
  const normalizedAuthorLogin = params.authorLogin.toLowerCase();

  if (DEFAULT_SKIPPED_AUTHORS.has(normalizedAuthorLogin)) {
    params.logger.info(
      {
        prNumber: params.prNumber,
        author: params.authorLogin,
        skipReason: "weblate-author",
      },
      "PR author is Weblate, skipping review",
    );
    return { action: "skip" };
  }

  if (params.skipAuthors.includes(params.authorLogin)) {
    params.logger.info(
      { prNumber: params.prNumber, author: params.authorLogin },
      "PR author in skipAuthors, skipping review",
    );
    return { action: "skip" };
  }

  return { action: "continue" };
}
