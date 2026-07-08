import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import type { ExecutionResult } from "../execution/types.ts";
import { err as resultErr, ok as resultOk, toError, type Result } from "../lib/result.ts";
import type { PromptSectionRecord, TelemetryStore } from "../telemetry/types.ts";
import {
  maybePostMentionCostWarning,
  type MentionCostWarningPublicationStatus,
} from "./mention-cost-warning.ts";
import { recordMentionExecutionTelemetry } from "./mention-telemetry.ts";

export type MentionPostExecutionTelemetryStatus = {
  telemetryRecorded: boolean;
  costWarningStatus: MentionCostWarningPublicationStatus["status"];
  costWarningPublished: boolean;
};

export type MentionPostExecutionTelemetryResult = Result<MentionPostExecutionTelemetryStatus>;

export async function recordMentionPostExecutionTelemetry(params: {
  telemetryEnabled: boolean;
  telemetryStore: TelemetryStore;
  logger: Pick<Logger, "warn">;
  deliveryId: string;
  owner: string;
  repo: string;
  issueNumber: number;
  prNumber?: number;
  eventType: string;
  result: ExecutionResult;
  promptSections?: PromptSectionRecord[];
  derivedContextCacheStatus: Parameters<typeof recordMentionExecutionTelemetry>[0]["derivedContextCacheStatus"];
  derivedContextCacheReason?: string | null;
  costWarningUsd: number;
  explicitReviewRequest: boolean;
  reviewOutputKey?: string;
  canPublishExplicitReviewOutput: (reason: string, reviewOutputKey?: string) => boolean;
  getOctokit: () => Promise<Octokit>;
  botHandles: string[];
}): Promise<MentionPostExecutionTelemetryResult> {
  if (!params.telemetryEnabled) {
    return resultOk({
      telemetryRecorded: false,
      costWarningStatus: "skipped",
      costWarningPublished: false,
    });
  }

  try {
    const telemetry = await recordMentionExecutionTelemetry({
      telemetryStore: params.telemetryStore,
      logger: params.logger,
      deliveryId: params.deliveryId,
      repo: `${params.owner}/${params.repo}`,
      prNumber: params.prNumber,
      eventType: params.eventType,
      result: params.result,
      promptSections: params.result.promptSections ?? params.promptSections,
      derivedContextCacheStatus: params.derivedContextCacheStatus,
      derivedContextCacheReason: params.derivedContextCacheReason ?? undefined,
    });

    const costWarning = await maybePostMentionCostWarning({
      costUsd: params.result.costUsd,
      thresholdUsd: params.costWarningUsd,
      owner: params.owner,
      repo: params.repo,
      issueNumber: params.issueNumber,
      prNumber: params.prNumber,
      explicitReviewRequest: params.explicitReviewRequest,
      reviewOutputKey: params.reviewOutputKey,
      canPublishExplicitReviewOutput: params.canPublishExplicitReviewOutput,
      getOctokit: params.getOctokit,
      botHandles: params.botHandles,
      logger: params.logger,
    });

    if (!telemetry.ok) {
      return resultErr(telemetry.err);
    }

    if (!costWarning.ok) {
      return resultErr(costWarning.err);
    }

    return resultOk({
      telemetryRecorded: true,
      costWarningStatus: costWarning.value.status,
      costWarningPublished: costWarning.value.published,
    });
  } catch (err) {
    const error = toError(err);
    params.logger.warn({ err: error }, "Mention post-execution telemetry failed (non-blocking)");
    return resultErr(error);
  }
}
