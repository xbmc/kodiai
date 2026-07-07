import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import type { ExecutionResult } from "../execution/types.ts";
import type { PromptSectionRecord, TelemetryStore } from "../telemetry/types.ts";
import { maybePostReviewCostWarning } from "./review-cost-warning.ts";
import { recordReviewExecutionTelemetry } from "./review-telemetry.ts";

export async function recordReviewPostExecutionTelemetry(params: {
  telemetryEnabled: boolean;
  telemetryStore: TelemetryStore;
  logger: Pick<Logger, "warn">;
  deliveryId: string;
  owner: string;
  repo: string;
  prNumber: number;
  prAuthor: string;
  eventType: string;
  result: ExecutionResult;
  promptSections?: PromptSectionRecord[];
  derivedPromptCacheStatus: Parameters<typeof recordReviewExecutionTelemetry>[0]["derivedPromptCacheStatus"];
  derivedPromptCacheReason?: string | null;
  costWarningUsd: number;
  canPublishVisibleOutput: (reason: string) => boolean;
  setReviewWorkPhase: (phase: "publish") => void;
  getOctokit: () => Promise<Octokit>;
  botHandles: string[];
}): Promise<void> {
  if (!params.telemetryEnabled) return;

  await recordReviewExecutionTelemetry({
    telemetryStore: params.telemetryStore,
    logger: params.logger,
    deliveryId: params.deliveryId,
    repo: `${params.owner}/${params.repo}`,
    prNumber: params.prNumber,
    prAuthor: params.prAuthor,
    eventType: params.eventType,
    result: params.result,
    promptSections: params.result.promptSections ?? params.promptSections,
    derivedPromptCacheStatus: params.derivedPromptCacheStatus,
    derivedPromptCacheReason: params.derivedPromptCacheReason ?? undefined,
    warningPrefix: "Review",
  });

  await maybePostReviewCostWarning({
    costUsd: params.result.costUsd,
    thresholdUsd: params.costWarningUsd,
    owner: params.owner,
    repo: params.repo,
    prNumber: params.prNumber,
    canPublishVisibleOutput: params.canPublishVisibleOutput,
    setReviewWorkPhase: params.setReviewWorkPhase,
    getOctokit: params.getOctokit,
    botHandles: params.botHandles,
    logger: params.logger,
  });
}
