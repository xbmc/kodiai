import PQueue from "p-queue";
import type { Logger } from "pino";
import type { JobQueue } from "./types.ts";

/**
 * Create a job queue with per-installation concurrency control.
 *
 * Each installation gets its own PQueue(concurrency: 1), ensuring
 * only one job runs per installation at a time. Queues for different
 * installations run in parallel. Idle queues are pruned to prevent
 * the map from growing unbounded.
 */
export function createJobQueue(logger: Logger): JobQueue {
  const queues = new Map<number, PQueue>();
  let nextJobId = 1;

  function getOrCreateQueue(installationId: number): PQueue {
    let queue = queues.get(installationId);
    if (!queue) {
      queue = new PQueue({ concurrency: 1 });
      queues.set(installationId, queue);
      logger.debug({ installationId }, "Created new job queue for installation");
    }
    return queue;
  }

  return {
    async enqueue<T>(
      installationId: number,
      fn: () => Promise<T>,
      context?: {
        deliveryId?: string;
        eventName?: string;
        action?: string;
        jobType?: string;
        prNumber?: number;
      },
    ): Promise<T> {
      const queue = getOrCreateQueue(installationId);
      const jobId = `${installationId}-${nextJobId++}`;
      const queuedAt = Date.now();

      logger.info(
        {
          jobId,
          installationId,
          deliveryId: context?.deliveryId,
          eventName: context?.eventName,
          action: context?.action,
          jobType: context?.jobType,
          prNumber: context?.prNumber,
          queueSize: queue.size,
          pendingCount: queue.pending,
        },
        "Enqueuing job for installation",
      );

      try {
        const result = await (queue.add(async () => {
          const startedAt = Date.now();
          logger.info(
            {
              jobId,
              installationId,
              deliveryId: context?.deliveryId,
              eventName: context?.eventName,
              action: context?.action,
              jobType: context?.jobType,
              prNumber: context?.prNumber,
              waitMs: startedAt - queuedAt,
              queueSize: queue.size,
              pendingCount: queue.pending,
            },
            "Job execution started",
          );

          try {
            const value = await fn();
            logger.info(
              {
                jobId,
                installationId,
                deliveryId: context?.deliveryId,
                eventName: context?.eventName,
                action: context?.action,
                jobType: context?.jobType,
                prNumber: context?.prNumber,
                durationMs: Date.now() - startedAt,
              },
              "Job execution completed",
            );
            return value;
          } catch (err) {
            logger.error(
              {
                err,
                jobId,
                installationId,
                deliveryId: context?.deliveryId,
                eventName: context?.eventName,
                action: context?.action,
                jobType: context?.jobType,
                prNumber: context?.prNumber,
                durationMs: Date.now() - startedAt,
              },
              "Job execution failed",
            );
            throw err;
          }
        }) as Promise<T>);
        return result;
      } finally {
        // Prune idle queue after job completes
        if (queue.size === 0 && queue.pending === 0) {
          queues.delete(installationId);
          logger.debug(
            { installationId, jobId },
            "Pruned idle job queue for installation",
          );
        }
      }
    },

    getQueueSize(installationId: number): number {
      return queues.get(installationId)?.size ?? 0;
    },

    getPendingCount(installationId: number): number {
      return queues.get(installationId)?.pending ?? 0;
    },
  };
}
