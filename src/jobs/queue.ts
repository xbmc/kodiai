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
    async enqueue<T>(installationId: number, fn: () => Promise<T>): Promise<T> {
      const queue = getOrCreateQueue(installationId);

      logger.debug(
        {
          installationId,
          queueSize: queue.size,
          pendingCount: queue.pending,
        },
        "Enqueuing job for installation",
      );

      try {
        const result = await (queue.add(fn) as Promise<T>);
        return result;
      } finally {
        // Prune idle queue after job completes
        if (queue.size === 0 && queue.pending === 0) {
          queues.delete(installationId);
          logger.debug(
            { installationId },
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
