import type { Logger } from "pino";
import type { ReviewCacheEventRecord, TelemetryStore } from "../telemetry/types.ts";
import type { KnowledgeStore } from "../knowledge/types.ts";
import { err as resultErr, ok as resultOk, toError, type Result } from "../lib/result.ts";

const SHADOW_SPECIALIST_DIFF_SNIPPET_MAX_CHARS = 12_000;
export type ReviewCacheTelemetryWriteStatus = "recorded" | "skipped";
export type ReviewCacheTelemetryResult = Result<ReviewCacheTelemetryWriteStatus>;

/**
 * Best-effort checkpoint cleanup. deleteCheckpoint is raw SQL and can reject;
 * a floating rejection here would trip the fatal unhandledRejection handler,
 * so failures are logged and swallowed.
 */
export function discardCheckpointsFailOpen(
  knowledgeStore: KnowledgeStore | undefined,
  logger: Logger,
  reviewOutputKeys: string[],
): void {
  for (const reviewOutputKey of reviewOutputKeys) {
    void knowledgeStore?.deleteCheckpoint?.(reviewOutputKey)?.catch((err) => {
      logger.warn({ err, reviewOutputKey }, "Checkpoint cleanup failed (non-blocking)");
    });
  }
}

export function buildShadowSpecialistDiffSnippet(diffText: string): string {
  if (diffText.length <= SHADOW_SPECIALIST_DIFF_SNIPPET_MAX_CHARS) return diffText;

  const prefix = diffText.slice(0, SHADOW_SPECIALIST_DIFF_SNIPPET_MAX_CHARS);
  const lastNewline = prefix.lastIndexOf("\n");
  const bounded = lastNewline > 0 ? prefix.slice(0, lastNewline) : prefix;
  return `${bounded}\n...(shadow specialist diff snippet truncated)`;
}

export async function recordReviewCacheEventFailOpen(params: {
  telemetryStore: Pick<TelemetryStore, "recordReviewCacheEvent">;
  logger: Pick<Logger, "warn">;
  entry: ReviewCacheEventRecord;
}): Promise<ReviewCacheTelemetryResult> {
  const { telemetryStore, logger, entry } = params;
  try {
    if (!telemetryStore.recordReviewCacheEvent) {
      logger.warn(
        {
          deliveryId: entry.deliveryId,
          repo: entry.repo,
          prNumber: entry.prNumber,
          cacheSurface: entry.cacheSurface,
          status: entry.status,
          reason: entry.reason,
        },
        "Review cache telemetry store method unavailable (non-blocking)",
      );
      return resultOk("skipped");
    }
    await telemetryStore.recordReviewCacheEvent(entry);
    return resultOk("recorded");
  } catch (err) {
    const error = toError(err);
    logger.warn(
      {
        err: error,
        deliveryId: entry.deliveryId,
        repo: entry.repo,
        prNumber: entry.prNumber,
        cacheSurface: entry.cacheSurface,
        status: entry.status,
        reason: entry.reason,
        fingerprintVersion: entry.fingerprintVersion,
        safetySignalNames: entry.safetySignalNames,
        missingSignalNames: entry.missingSignalNames,
        invalidationSignalNames: entry.invalidationSignalNames,
        bookkeepingErrorCount: entry.bookkeepingErrorCount ?? 0,
      },
      "Review cache telemetry write failed (non-blocking)",
    );
    return resultErr(error);
  }
}
