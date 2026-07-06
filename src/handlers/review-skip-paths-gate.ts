import type { Logger } from "pino";
import picomatch from "picomatch";
import { normalizeSkipPattern } from "../lib/review-git-utils.ts";

type ReviewSkipPathsLogger = Pick<Logger, "info">;

export type ReviewSkipPathsGateDecision =
  | { action: "continue"; changedFiles: string[] }
  | { action: "skip" };

export function evaluateReviewSkipPathsGate(params: {
  prNumber: number;
  allChangedFiles: readonly string[];
  skipPaths: readonly string[];
  logger: ReviewSkipPathsLogger;
}): ReviewSkipPathsGateDecision {
  const skipMatchers = params.skipPaths
    .map(normalizeSkipPattern)
    .filter((p) => p.length > 0)
    .map((p) => picomatch(p, { dot: true }));

  const changedFiles = params.allChangedFiles.filter((file) => {
    return !skipMatchers.some((m) => m(file));
  });

  if (changedFiles.length > 0) {
    return { action: "continue", changedFiles };
  }

  params.logger.info(
    { prNumber: params.prNumber, totalFiles: params.allChangedFiles.length },
    "All changed files matched skipPaths, skipping review",
  );
  return { action: "skip" };
}
