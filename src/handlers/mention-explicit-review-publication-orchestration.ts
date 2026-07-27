import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import { ok, type Result } from "../lib/result.ts";
import type { WebhookEvent } from "../webhook/types.ts";
import { summarizeErrorForDiagnostics } from "./mention-write-replies.ts";
import { projectExplicitMentionReviewLifecycle } from "./mention-explicit-review-lifecycle.ts";
import { resolveExplicitMentionReviewPublishDecision } from "./mention-explicit-review-publish-decision.ts";
import {
  publishExplicitMentionReviewResult,
  type ExplicitMentionReviewPublicationStatus,
} from "./mention-explicit-review-publication.ts";
import type { MentionEvent } from "./mention-types.ts";

export type ExplicitMentionReviewPublicationOrchestrationValue = {
  explicitReviewPublishEvaluation: ReturnType<typeof resolveExplicitMentionReviewPublishDecision>["evaluation"];
  explicitReviewResultFindingLines: string[];
  explicitReviewPublication: ExplicitMentionReviewPublicationStatus | null;
};

export type ExplicitMentionReviewPublicationOrchestrationResult =
  Result<ExplicitMentionReviewPublicationOrchestrationValue>;

export async function publishExplicitMentionReviewIfEligible(params: {
  explicitReviewRequest: boolean;
  eventName: WebhookEvent["name"];
  mention: MentionEvent;
  reviewOutputKey: string | undefined;
  canonicalReviewSurfaceKey: string | undefined;
  deliveryId: string;
  installationId: number;
  headSha?: string | null;
  baseSha?: string | null;
  result: Parameters<typeof resolveExplicitMentionReviewPublishDecision>[0]["result"] & {
    candidateFinding?: Parameters<typeof projectExplicitMentionReviewLifecycle>[0]["candidateFinding"];
  };
  appSlug: string;
  autoApprove: boolean;
  explicitReviewPromptFileCount: number | undefined;
  getOctokit: () => Promise<Octokit>;
  canPublishExplicitReviewOutput: Parameters<typeof publishExplicitMentionReviewResult>[0]["canPublishExplicitReviewOutput"];
  setReviewWorkPhase: Parameters<typeof publishExplicitMentionReviewResult>[0]["setReviewWorkPhase"];
  postMentionError: Parameters<typeof publishExplicitMentionReviewResult>[0]["postMentionError"];
  logger: Logger;
  projectLifecycle?: typeof projectExplicitMentionReviewLifecycle;
  resolvePublishDecision?: typeof resolveExplicitMentionReviewPublishDecision;
  publishReview?: typeof publishExplicitMentionReviewResult;
}): Promise<ExplicitMentionReviewPublicationOrchestrationResult> {
  const projectLifecycle = params.projectLifecycle ?? projectExplicitMentionReviewLifecycle;
  const resolvePublishDecision = params.resolvePublishDecision ?? resolveExplicitMentionReviewPublishDecision;
  const publishReview = params.publishReview ?? publishExplicitMentionReviewResult;

  const explicitReviewFindingLifecycleResult = projectLifecycle({
    explicitReviewRequest: params.explicitReviewRequest,
    eventName: params.eventName,
    mention: params.mention,
    reviewOutputKey: params.reviewOutputKey,
    deliveryId: params.deliveryId,
    headSha: params.headSha,
    baseSha: params.baseSha,
    candidateFinding: params.result.candidateFinding,
    logger: params.logger,
  });
  const explicitReviewPublishDecision = resolvePublishDecision({
    explicitReviewRequest: params.explicitReviewRequest,
    prNumber: params.mention.prNumber,
    reviewOutputKey: params.reviewOutputKey,
    result: {
      conclusion: params.result.conclusion,
      published: params.result.published,
      usedRepoInspectionTools: params.result.usedRepoInspectionTools,
      resultText: params.result.resultText,
      toolUseNames: params.result.toolUseNames,
    },
    surface: params.mention.surface,
    owner: params.mention.owner,
    repo: params.mention.repo,
    autoApprove: params.autoApprove,
    logger: params.logger,
  });

  let explicitReviewPublication: ExplicitMentionReviewPublicationStatus | null = null;
  if (
    explicitReviewPublishDecision.eligible
    && params.reviewOutputKey
    && params.canonicalReviewSurfaceKey
    && params.mention.prNumber !== undefined
  ) {
    explicitReviewPublication = await publishReview({
      octokit: await params.getOctokit(),
      owner: params.mention.owner,
      repo: params.mention.repo,
      prNumber: params.mention.prNumber,
      surface: params.mention.surface,
      deliveryId: params.deliveryId,
      installationId: params.installationId,
      reviewOutputKey: params.reviewOutputKey,
      canonicalReviewSurfaceKey: params.canonicalReviewSurfaceKey,
      appSlug: params.appSlug,
      autoApprove: params.autoApprove,
      usedRepoInspectionTools: params.result.usedRepoInspectionTools === true,
      explicitReviewPromptFileCount: params.explicitReviewPromptFileCount,
      explicitReviewFindingLifecycleResult,
      canPublishExplicitReviewOutput: params.canPublishExplicitReviewOutput,
      setReviewWorkPhase: params.setReviewWorkPhase,
      postMentionError: params.postMentionError,
      summarizeError: summarizeErrorForDiagnostics,
      logger: params.logger,
    });
  }

  return ok({
    explicitReviewPublishEvaluation: explicitReviewPublishDecision.evaluation,
    explicitReviewResultFindingLines: explicitReviewPublishDecision.findingLines,
    explicitReviewPublication,
  });
}
