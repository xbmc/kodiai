import { buildCanonicalReviewSurfaceKey, buildReviewOutputKey } from "../review-orchestration/review-idempotency.ts";
import type { MentionEvent } from "./mention-types.ts";

export type MentionExecutorPlan = {
  reviewOutputKey: string | undefined;
  /**
   * Trigger-agnostic identity for the GitHub-visible verdict surface -- the same
   * key an automatic push-triggered review of this PR/commit would use, so an
   * explicit @mention re-review finds/updates the same comment or PR review
   * instead of creating its own (see buildCanonicalReviewSurfaceKey).
   */
  canonicalReviewSurfaceKey: string | undefined;
  maxTurnsOverride: number | undefined;
  taskType: string;
  eventType: string;
  triggerBody: string;
  isCombinedFormatterSuggestionRequest: boolean;
  enableInlineTools: true | undefined;
  enableCandidateFindingTool: true | undefined;
};

export function resolveMentionExecutorPlan(params: {
  mention: Pick<MentionEvent, "owner" | "repo" | "prNumber" | "commentBody" | "headRef" | "headSha">;
  installationId: number;
  deliveryId: string;
  eventName: string;
  eventAction: string | undefined;
  explicitReviewRequest: boolean;
  explicitReviewTaskType: string;
  explicitReviewMaxTurnsOverride: number | undefined;
  formatterSuggestionMode: "format-only" | "review-and-format" | undefined;
  writeEnabled: boolean;
  hasPrDiffContext: boolean;
  userQuestion: string;
}): MentionExecutorPlan {
  const isPrMention = params.mention.prNumber !== undefined;
  const reviewOutputKey = params.explicitReviewRequest && params.mention.prNumber !== undefined
    ? buildReviewOutputKey({
        installationId: params.installationId,
        owner: params.mention.owner,
        repo: params.mention.repo,
        prNumber: params.mention.prNumber,
        action: "mention-review",
        deliveryId: params.deliveryId,
        headSha: params.mention.headRef ?? "unknown-head-sha",
      })
    : undefined;
  const canonicalReviewSurfaceKey = params.explicitReviewRequest && params.mention.prNumber !== undefined
    ? buildCanonicalReviewSurfaceKey({
        installationId: params.installationId,
        owner: params.mention.owner,
        repo: params.mention.repo,
        prNumber: params.mention.prNumber,
        headSha: params.mention.headSha ?? "unknown-head-sha",
      })
    : undefined;

  const maxTurnsOverride = params.explicitReviewRequest
    ? params.explicitReviewMaxTurnsOverride
    : (!params.writeEnabled && isPrMention)
      ? (params.hasPrDiffContext ? 12 : 20)
      : undefined;

  return {
    reviewOutputKey,
    canonicalReviewSurfaceKey,
    maxTurnsOverride,
    taskType: params.explicitReviewRequest ? params.explicitReviewTaskType : "mention.response",
    eventType: `${params.eventName}.${params.eventAction ?? ""}`.replace(/\.$/, ""),
    triggerBody: params.explicitReviewRequest ? params.userQuestion : params.mention.commentBody,
    isCombinedFormatterSuggestionRequest: isPrMention && params.formatterSuggestionMode === "review-and-format",
    enableInlineTools: params.explicitReviewRequest ? true : undefined,
    enableCandidateFindingTool: params.explicitReviewRequest ? true : undefined,
  };
}
