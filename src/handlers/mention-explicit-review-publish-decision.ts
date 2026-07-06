import type { Logger } from "pino";
import {
  evaluateExplicitMentionReviewPublish,
  logExplicitMentionReviewPublishSkipped,
  type ExplicitMentionReviewExecutionSnapshot,
  type ExplicitMentionReviewPublishEvaluation,
} from "../review-orchestration/explicit-mention-review-publish.ts";
import type { MentionEvent } from "./mention-types.ts";

export type ExplicitMentionReviewPublishDecision = {
  evaluation: ExplicitMentionReviewPublishEvaluation;
  findingLines: string[];
  eligible: boolean;
};

export function resolveExplicitMentionReviewPublishDecision(params: {
  explicitReviewRequest: boolean;
  prNumber: number | undefined;
  reviewOutputKey: string | undefined;
  result: ExplicitMentionReviewExecutionSnapshot;
  surface: MentionEvent["surface"];
  owner: string;
  repo: string;
  autoApprove: boolean;
  logger: Logger;
  evaluatePublish?: typeof evaluateExplicitMentionReviewPublish;
  logSkipped?: typeof logExplicitMentionReviewPublishSkipped;
}): ExplicitMentionReviewPublishDecision {
  const evaluation = (params.evaluatePublish ?? evaluateExplicitMentionReviewPublish)({
    explicitReviewRequest: params.explicitReviewRequest,
    prNumber: params.prNumber,
    reviewOutputKey: params.reviewOutputKey,
    result: params.result,
  });

  if (params.explicitReviewRequest && params.prNumber !== undefined && !evaluation.eligible) {
    (params.logSkipped ?? logExplicitMentionReviewPublishSkipped)({
      logger: params.logger,
      baseLog: {
        surface: params.surface,
        owner: params.owner,
        repo: params.repo,
        prNumber: params.prNumber,
      },
      evaluation,
      reviewOutputKey: params.reviewOutputKey,
      result: {
        conclusion: params.result.conclusion,
        published: params.result.published,
        usedRepoInspectionTools: params.result.usedRepoInspectionTools,
        toolUseNames: params.result.toolUseNames,
      },
      autoApprove: params.autoApprove,
    });
  }

  return {
    evaluation,
    findingLines: evaluation.findingLines,
    eligible: evaluation.eligible,
  };
}
