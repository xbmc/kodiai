import type { Logger } from "pino";
import { isReviewTriggerEnabled } from "../lib/review-trigger-utils.ts";

type ReviewTriggerConfigLogger = Pick<Logger, "info">;

export type ReviewTriggerConfig = {
  enabled: boolean;
  triggers: {
    onOpened: boolean;
    onReadyForReview: boolean;
    onReviewRequested: boolean;
    onSynchronize?: boolean;
  };
};

export type ReviewTriggerConfigGateDecision =
  | { action: "continue" }
  | { action: "skip" };

export function evaluateReviewTriggerConfigGate(params: {
  action: string;
  reviewConfig: ReviewTriggerConfig;
  apiOwner: string;
  apiRepo: string;
  baseLog: Record<string, unknown>;
  logger: ReviewTriggerConfigLogger;
}): ReviewTriggerConfigGateDecision {
  params.logger.info(
    {
      ...params.baseLog,
      gate: "trigger-config",
      reviewEnabled: params.reviewConfig.enabled,
      triggers: params.reviewConfig.triggers,
    },
    "Evaluating review trigger configuration",
  );

  if (!params.reviewConfig.enabled) {
    params.logger.info(
      {
        ...params.baseLog,
        gate: "review-enabled",
        gateResult: "skipped",
        skipReason: "review-disabled",
        apiOwner: params.apiOwner,
        apiRepo: params.apiRepo,
      },
      "Review disabled in config, skipping",
    );
    return { action: "skip" };
  }

  if (!isReviewTriggerEnabled(params.action, params.reviewConfig.triggers)) {
    params.logger.info(
      {
        ...params.baseLog,
        gate: "review-trigger",
        gateResult: "skipped",
        skipReason: "trigger-disabled",
        triggers: params.reviewConfig.triggers,
      },
      "Review trigger disabled in config, skipping",
    );
    return { action: "skip" };
  }

  return { action: "continue" };
}
