import type { Logger } from "pino";
import type { RunStateCheck } from "../knowledge/types.ts";

type ReviewRunStateGateLogger = Pick<Logger, "info" | "warn">;

type ReviewRunStateKnowledgeStore = {
  checkAndClaimRun(params: {
    repo: string;
    prNumber: number;
    baseSha: string;
    headSha: string;
    deliveryId: string;
    action: string;
  }): Promise<RunStateCheck>;
};

export type ReviewRunStateGateDecision =
  | { action: "continue" }
  | { action: "skip" };

export async function evaluateReviewRunStateGate(params: {
  knowledgeStore: ReviewRunStateKnowledgeStore | undefined;
  repo: string;
  prNumber: number;
  baseSha: string;
  headSha: string;
  deliveryId: string;
  action: string;
  baseLog: Record<string, unknown>;
  logger: ReviewRunStateGateLogger;
}): Promise<ReviewRunStateGateDecision> {
  if (!params.knowledgeStore) {
    return { action: "continue" };
  }

  try {
    const runCheck = await params.knowledgeStore.checkAndClaimRun({
      repo: params.repo,
      prNumber: params.prNumber,
      baseSha: params.baseSha,
      headSha: params.headSha,
      deliveryId: params.deliveryId,
      action: params.action,
    });

    if (!runCheck.shouldProcess) {
      params.logger.info(
        {
          ...params.baseLog,
          gate: "run-state-idempotency",
          gateResult: "skipped",
          skipReason: runCheck.reason,
          runKey: runCheck.runKey,
        },
        "Skipping review: run state indicates duplicate or already processed",
      );
      return { action: "skip" };
    }

    if (runCheck.supersededRunKeys.length > 0) {
      params.logger.info(
        {
          ...params.baseLog,
          gate: "run-state-idempotency",
          gateResult: "accepted",
          runKey: runCheck.runKey,
          supersededRunKeys: runCheck.supersededRunKeys,
        },
        "New run superseded prior runs (force-push detected)",
      );
    }
  } catch (err) {
    params.logger.warn(
      { ...params.baseLog, err },
      "Run state idempotency check failed (fail-open, proceeding with review)",
    );
  }

  return { action: "continue" };
}
