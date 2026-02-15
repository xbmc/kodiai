import type { Logger } from "pino";
import { $ } from "bun";

export type IncrementalDiffResult = {
  mode: "incremental" | "full";
  changedFilesSinceLastReview: string[];
  lastReviewedHeadSha: string | null;
  reason: string;
};

/**
 * Compute the incremental diff between the last reviewed head SHA and the
 * current HEAD. Returns mode="incremental" with the list of changed files
 * when the prior SHA is reachable, or mode="full" with a reason string when
 * falling back to a full review.
 *
 * Fail-open: any unexpected error degrades to a full review rather than
 * blocking publication.
 */
export async function computeIncrementalDiff(params: {
  workspaceDir: string;
  repo: string;
  prNumber: number;
  getLastReviewedHeadSha: (params: { repo: string; prNumber: number }) => string | null;
  logger: Logger;
}): Promise<IncrementalDiffResult> {
  const { workspaceDir, repo, prNumber, getLastReviewedHeadSha, logger } = params;

  try {
    // Step 1: Look up the last completed review's head SHA
    const lastHeadSha = getLastReviewedHeadSha({ repo, prNumber });

    if (!lastHeadSha) {
      return {
        mode: "full",
        changedFilesSinceLastReview: [],
        lastReviewedHeadSha: null,
        reason: "no-prior-review",
      };
    }

    // Step 2: Check if the old head SHA is reachable in this workspace
    const reachCheck = await $`git -C ${workspaceDir} cat-file -t ${lastHeadSha}`
      .quiet()
      .nothrow();

    if (reachCheck.exitCode !== 0) {
      // Attempt to deepen history so the old SHA becomes available
      logger.debug(
        { repo, prNumber, lastHeadSha },
        "Prior SHA unreachable, attempting fetch --deepen=100",
      );
      await $`git -C ${workspaceDir} fetch --deepen=100`.quiet().nothrow();

      // Re-check reachability after deepening
      const recheck = await $`git -C ${workspaceDir} cat-file -t ${lastHeadSha}`
        .quiet()
        .nothrow();

      if (recheck.exitCode !== 0) {
        return {
          mode: "full",
          changedFilesSinceLastReview: [],
          lastReviewedHeadSha: lastHeadSha,
          reason: "prior-sha-unreachable",
        };
      }
    }

    // Step 3: Compute the diff between the last reviewed head and current HEAD
    const diffResult = await $`git -C ${workspaceDir} diff ${lastHeadSha}...HEAD --name-only`
      .quiet()
      .nothrow();

    if (diffResult.exitCode !== 0) {
      return {
        mode: "full",
        changedFilesSinceLastReview: [],
        lastReviewedHeadSha: lastHeadSha,
        reason: "diff-computation-failed",
      };
    }

    // Step 4: Parse the changed file list
    const changedFiles = diffResult
      .text()
      .split("\n")
      .filter((line) => line.trim().length > 0);

    const sha7 = lastHeadSha.slice(0, 7);
    return {
      mode: "incremental",
      changedFilesSinceLastReview: changedFiles,
      lastReviewedHeadSha: lastHeadSha,
      reason: `incremental-from-${sha7}`,
    };
  } catch (err) {
    // Fail-open: any unexpected error degrades to full review
    logger.warn(
      { err, repo, prNumber },
      "Incremental diff computation failed unexpectedly (fail-open, falling back to full review)",
    );
    return {
      mode: "full",
      changedFilesSinceLastReview: [],
      lastReviewedHeadSha: null,
      reason: "unexpected-error",
    };
  }
}
