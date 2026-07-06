import type { Logger } from "pino";
import {
  attachReviewFindingLifecycle,
  type AttachReviewFindingLifecycleInput,
  type AttachReviewFindingLifecycleResult,
} from "../review-lifecycle/handler-lifecycle.ts";
import type { ReviewCandidateFindingExecutionResult } from "../review-orchestration/review-candidate-finding.ts";
import type { WebhookEvent } from "../webhook/types.ts";
import {
  projectExplicitMentionReviewValidationTruth,
  type ProjectExplicitMentionReviewValidationTruthParams,
} from "./mention-validation-truth.ts";
import type { MentionEvent } from "./mention-types.ts";

type ExplicitMentionReviewLifecycleLogger = Pick<Logger, "info">;

export function projectExplicitMentionReviewLifecycle(params: {
  explicitReviewRequest: boolean;
  eventName: WebhookEvent["name"];
  mention: MentionEvent;
  reviewOutputKey: string | undefined;
  deliveryId: string;
  headSha?: string | null;
  baseSha?: string | null;
  candidateFinding?: ReviewCandidateFindingExecutionResult | null;
  logger: ExplicitMentionReviewLifecycleLogger;
  attachLifecycle?: (input: AttachReviewFindingLifecycleInput) => AttachReviewFindingLifecycleResult;
  projectValidationTruth?: (
    params: ProjectExplicitMentionReviewValidationTruthParams,
  ) => ReturnType<typeof projectExplicitMentionReviewValidationTruth>;
}): AttachReviewFindingLifecycleResult | null {
  if (!params.explicitReviewRequest || params.mention.prNumber === undefined || !params.reviewOutputKey) {
    return null;
  }

  const lifecycleResult = (params.attachLifecycle ?? attachReviewFindingLifecycle)({
    source: "mention",
    trigger: resolveExplicitMentionReviewLifecycleTrigger(params.eventName),
    correlation: {
      repo: `${params.mention.owner}/${params.mention.repo}`,
      pullNumber: params.mention.prNumber,
      reviewOutputKey: params.reviewOutputKey,
      deliveryId: params.deliveryId,
      commitSha: params.headSha ?? params.mention.headRef,
      headSha: params.headSha,
      baseSha: params.baseSha,
      headRef: params.mention.headRef,
      baseRef: params.mention.baseRef,
    },
    findings: [],
    candidateFinding: params.candidateFinding,
  });

  params.logger.info(
    {
      surface: params.mention.surface,
      owner: params.mention.owner,
      repo: params.mention.repo,
      prNumber: params.mention.prNumber,
      ...lifecycleResult.logEvidence,
      source: "explicit-mention-review",
    },
    "Projected explicit mention review finding lifecycle evidence",
  );

  (params.projectValidationTruth ?? projectExplicitMentionReviewValidationTruth)({
    logger: params.logger as ProjectExplicitMentionReviewValidationTruthParams["logger"],
    surface: params.mention.surface,
    owner: params.mention.owner,
    repo: params.mention.repo,
    prNumber: params.mention.prNumber,
    reviewOutputKey: params.reviewOutputKey,
    deliveryId: params.deliveryId,
    headSha: params.headSha,
    baseSha: params.baseSha,
    headRef: params.mention.headRef,
    baseRef: params.mention.baseRef,
    lifecycleResult,
  });

  return lifecycleResult;
}

function resolveExplicitMentionReviewLifecycleTrigger(
  eventName: WebhookEvent["name"],
): AttachReviewFindingLifecycleInput["trigger"] {
  if (eventName === "issue_comment") {
    return "issue_comment";
  }
  if (eventName === "pull_request_review_comment" || eventName === "pull_request_review") {
    return "review_comment";
  }
  return "manual";
}
