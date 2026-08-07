import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import { createIssueCommentWithPublicationPipeline } from "../lib/github-publication.ts";
import { err, ok, type Result } from "../lib/result.ts";

/**
 * Publishes "the review ran and found nothing" as its own outcome.
 *
 * A review that completes cleanly with zero findings still has to say so when
 * nothing else reached the PR -- otherwise the reader cannot distinguish a
 * clean result from a review that was dropped, which is the ambiguity this
 * whole area exists to remove.
 *
 * Deliberately NOT part of review-error-publication.ts: that module emits
 * `ErrorCategory` comments, and routing a successful run through it produced
 * exactly the false "internal_error -- did not produce a publishable result"
 * notice on healthy reviews that prompted this module. Success is not an error
 * category, so it does not borrow the error taxonomy.
 */
export type ReviewNoFindingsPublicationValue = {
  published: boolean;
  resolution: "no-findings-notice" | "skipped";
};

export type ReviewNoFindingsPublicationError = {
  published: false;
  resolution: "no-findings-notice-undelivered";
};

export type ReviewNoFindingsPublicationResult = Result<
  ReviewNoFindingsPublicationValue,
  ReviewNoFindingsPublicationError
>;

export function buildReviewNoFindingsBody(params: {
  /** Set when an earlier attempt timed out and a retry produced the clean result. */
  afterRetry: boolean;
}): string {
  const preamble = params.afterRetry
    ? "An earlier attempt did not finish, so the review was re-run."
    : "The review ran to completion.";

  return [
    "**Review complete — no findings.**",
    "",
    `${preamble} No issues were raised for this diff.`,
    "",
    "This notice exists so a clean result is never mistaken for a dropped review.",
  ].join("\n");
}

export async function publishReviewNoFindingsNotice(params: {
  octokit: Octokit;
  owner: string;
  repo: string;
  prNumber: number;
  botHandles: string[];
  afterRetry: boolean;
  logger: Logger;
  canPublishVisibleOutput: (reason: string) => boolean;
  setReviewWorkPhase: (phase: "publish") => void;
}): Promise<ReviewNoFindingsPublicationResult> {
  if (!params.canPublishVisibleOutput("no-findings notice")) {
    return ok({ published: false, resolution: "skipped" });
  }

  params.setReviewWorkPhase("publish");

  try {
    await createIssueCommentWithPublicationPipeline(params.octokit, {
      owner: params.owner,
      repo: params.repo,
      issue_number: params.prNumber,
      body: buildReviewNoFindingsBody({ afterRetry: params.afterRetry }),
      botHandles: params.botHandles,
    });
  } catch (error) {
    params.logger.error(
      { err: error, owner: params.owner, repo: params.repo, prNumber: params.prNumber },
      "Failed to publish review no-findings notice",
    );
    return err({ published: false, resolution: "no-findings-notice-undelivered" });
  }

  return ok({ published: true, resolution: "no-findings-notice" });
}
