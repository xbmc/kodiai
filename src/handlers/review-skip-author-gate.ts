import type { Logger } from "pino";

type ReviewSkipAuthorLogger = Pick<Logger, "info">;

export type ReviewSkipAuthorGateDecision =
  | { action: "continue" }
  | { action: "skip" };

export function evaluateReviewSkipAuthorGate(params: {
  prNumber: number;
  authorLogin: string;
  skipAuthors: readonly string[];
  logger: ReviewSkipAuthorLogger;
}): ReviewSkipAuthorGateDecision {
  if (!params.skipAuthors.includes(params.authorLogin)) {
    return { action: "continue" };
  }

  params.logger.info(
    { prNumber: params.prNumber, author: params.authorLogin },
    "PR author in skipAuthors, skipping review",
  );
  return { action: "skip" };
}
