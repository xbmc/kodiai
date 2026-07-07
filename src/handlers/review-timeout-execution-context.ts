export type ReviewTimeoutExecutionConclusion =
  | "timeout_partial"
  | "timeout"
  | "max_turns"
  | string;

export type ReviewTimeoutExecutionContext = {
  recentTimeouts: number;
  isChronicTimeout: boolean;
  executionConclusion: ReviewTimeoutExecutionConclusion;
};

export async function resolveReviewTimeoutExecutionContext(params: {
  repo: string;
  prAuthor: string;
  outcome: {
    isTimeout?: boolean;
    published?: boolean;
    conclusion: string;
  };
  turnBudgetExhausted: boolean;
  countRecentTimeouts?: (repo: string, prAuthor: string) => Promise<number | undefined> | number | undefined;
}): Promise<ReviewTimeoutExecutionContext> {
  const recentTimeouts = (await params.countRecentTimeouts?.(params.repo, params.prAuthor)) ?? 0;
  const isChronicTimeout = recentTimeouts >= 3;
  const executionConclusion = params.outcome.isTimeout && params.outcome.published
    ? "timeout_partial"
    : params.outcome.isTimeout
      ? "timeout"
      : params.turnBudgetExhausted
        ? "max_turns"
        : params.outcome.conclusion;

  return {
    recentTimeouts,
    isChronicTimeout,
    executionConclusion,
  };
}
