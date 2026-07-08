import type { Octokit } from "@octokit/rest";
import { err as resultErr, toError, type Result } from "../lib/result.ts";
import {
  recordReviewPostExecutionTelemetry,
  type ReviewPostExecutionTelemetryStatus,
} from "./review-post-execution-telemetry.ts";

export function buildReviewPostExecutionTelemetryPublicationContext<TOctokit>(params: {
  installationId: number;
  getInstallationOctokit: (installationId: number) => Promise<TOctokit>;
  appSlug: string;
}): {
  getOctokit: () => Promise<TOctokit>;
  botHandles: string[];
} {
  return {
    getOctokit: () => params.getInstallationOctokit(params.installationId),
    botHandles: [params.appSlug, "claude"],
  };
}

type RecordReviewPostExecutionTelemetry = typeof recordReviewPostExecutionTelemetry;
export type ReviewPostExecutionTelemetryForInstallationResult =
  Result<ReviewPostExecutionTelemetryStatus>;

export async function recordReviewPostExecutionTelemetryForInstallation(params: Omit<
  Parameters<RecordReviewPostExecutionTelemetry>[0],
  "getOctokit" | "botHandles" | "eventType"
> & {
  installationId: number;
  getInstallationOctokit: (installationId: number) => Promise<Octokit>;
  appSlug: string;
  eventAction: string | undefined;
  recordTelemetry?: RecordReviewPostExecutionTelemetry;
}): Promise<ReviewPostExecutionTelemetryForInstallationResult> {
  const recordTelemetry = params.recordTelemetry ?? recordReviewPostExecutionTelemetry;
  const publicationContext = buildReviewPostExecutionTelemetryPublicationContext({
    installationId: params.installationId,
    getInstallationOctokit: params.getInstallationOctokit,
    appSlug: params.appSlug,
  });

  try {
    return await recordTelemetry({
      telemetryEnabled: params.telemetryEnabled,
      telemetryStore: params.telemetryStore,
      logger: params.logger,
      deliveryId: params.deliveryId,
      owner: params.owner,
      repo: params.repo,
      prNumber: params.prNumber,
      prAuthor: params.prAuthor,
      eventType: `pull_request.${params.eventAction}`,
      result: params.result,
      promptSections: params.promptSections,
      derivedPromptCacheStatus: params.derivedPromptCacheStatus,
      derivedPromptCacheReason: params.derivedPromptCacheReason,
      costWarningUsd: params.costWarningUsd,
      canPublishVisibleOutput: params.canPublishVisibleOutput,
      setReviewWorkPhase: params.setReviewWorkPhase,
      getOctokit: publicationContext.getOctokit,
      botHandles: publicationContext.botHandles,
    });
  } catch (err) {
    const error = toError(err);
    params.logger.warn({ err: error }, "Review post-execution telemetry failed (non-blocking)");
    return resultErr(error);
  }
}
