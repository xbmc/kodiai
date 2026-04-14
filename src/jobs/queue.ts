import PQueue from "p-queue";
import type { Logger } from "pino";
import type {
  JobLane,
  JobQueue,
  JobQueueContext,
  JobQueueRunMetadata,
  JobSnapshot,
} from "./types.ts";

const DEFAULT_JOB_LANE: JobLane = "review";
const QUEUED_PHASE = "queued";
const RUNNING_PHASE = "running";

type InstallationLaneQueues = Map<JobLane, PQueue>;
type InstallationActiveJobs = Map<string, JobSnapshot>;

/**
 * Create a job queue with per-installation concurrency control.
 *
 * Each installation gets independent per-lane PQueue(concurrency: 1)
 * instances. Jobs in different lanes can run in parallel, while jobs in the
 * same lane remain serialized. Active job snapshots are tracked from enqueue
 * through completion so callers can inspect machine-readable queue state.
 */
export function createJobQueue(logger: Logger): JobQueue {
  const laneQueues = new Map<number, InstallationLaneQueues>();
  const activeJobs = new Map<number, InstallationActiveJobs>();
  let nextJobId = 1;

  function getOrCreateInstallationQueues(installationId: number): InstallationLaneQueues {
    let queues = laneQueues.get(installationId);
    if (!queues) {
      queues = new Map<JobLane, PQueue>();
      laneQueues.set(installationId, queues);
    }
    return queues;
  }

  function getOrCreateQueue(installationId: number, lane: JobLane): PQueue {
    const queues = getOrCreateInstallationQueues(installationId);
    let queue = queues.get(lane);
    if (!queue) {
      queue = new PQueue({ concurrency: 1 });
      queues.set(lane, queue);
      logger.debug(
        { installationId, lane },
        "Created new job queue lane for installation",
      );
    }
    return queue;
  }

  function getOrCreateActiveJobs(installationId: number): InstallationActiveJobs {
    let jobs = activeJobs.get(installationId);
    if (!jobs) {
      jobs = new Map<string, JobSnapshot>();
      activeJobs.set(installationId, jobs);
    }
    return jobs;
  }

  function sumQueueMetric(
    installationId: number,
    selector: (queue: PQueue) => number,
  ): number {
    const queues = laneQueues.get(installationId);
    if (!queues) {
      return 0;
    }

    let total = 0;
    for (const queue of queues.values()) {
      total += selector(queue);
    }
    return total;
  }

  function pruneLaneQueue(installationId: number, lane: JobLane): void {
    const queues = laneQueues.get(installationId);
    const queue = queues?.get(lane);
    if (!queues || !queue) {
      return;
    }

    if (queue.size === 0 && queue.pending === 0) {
      queues.delete(lane);
      logger.debug(
        { installationId, lane },
        "Pruned idle job queue lane for installation",
      );
    }

    if (queues.size === 0) {
      laneQueues.delete(installationId);
    }
  }

  function deleteActiveJob(installationId: number, jobId: string): void {
    const jobs = activeJobs.get(installationId);
    if (!jobs) {
      return;
    }

    jobs.delete(jobId);
    if (jobs.size === 0) {
      activeJobs.delete(installationId);
    }
  }

  function createSnapshot(
    installationId: number,
    jobId: string,
    lane: JobLane,
    key: string,
    queuedAtMs: number,
    context?: JobQueueContext,
  ): JobSnapshot {
    return {
      jobId,
      installationId,
      lane,
      key,
      jobType: context?.jobType,
      deliveryId: context?.deliveryId,
      prNumber: context?.prNumber,
      phase: QUEUED_PHASE,
      queuedAtMs,
      lastProgressAtMs: queuedAtMs,
    };
  }

  return {
    async enqueue<T>(
      installationId: number,
      fn: (metadata: JobQueueRunMetadata) => Promise<T>,
      context?: JobQueueContext,
    ): Promise<T> {
      const lane = context?.lane ?? DEFAULT_JOB_LANE;
      const queue = getOrCreateQueue(installationId, lane);
      const jobId = `${installationId}-${nextJobId++}`;
      const key = context?.key ?? jobId;
      const queuedAtMs = Date.now();
      const snapshot = createSnapshot(
        installationId,
        jobId,
        lane,
        key,
        queuedAtMs,
        context,
      );
      getOrCreateActiveJobs(installationId).set(jobId, snapshot);

      logger.info(
        {
          jobId,
          installationId,
          lane,
          key,
          deliveryId: context?.deliveryId,
          eventName: context?.eventName,
          action: context?.action,
          jobType: context?.jobType,
          prNumber: context?.prNumber,
          phase: snapshot.phase,
          queueSize: sumQueueMetric(installationId, (candidateQueue) => candidateQueue.size),
          pendingCount: sumQueueMetric(installationId, (candidateQueue) => candidateQueue.pending),
          laneQueueSize: queue.size,
          lanePendingCount: queue.pending,
          activeJobCount: activeJobs.get(installationId)?.size ?? 0,
        },
        "Enqueuing job for installation",
      );

      try {
        return await queue.add(async (): Promise<T> => {
          const startedAtMs = Date.now();
          snapshot.startedAtMs = startedAtMs;
          snapshot.phase = RUNNING_PHASE;
          snapshot.lastProgressAtMs = startedAtMs;

          const waitMetadata: JobQueueRunMetadata = {
            queuedAtMs,
            startedAtMs,
            waitMs: startedAtMs - queuedAtMs,
            jobId,
            lane,
            key,
            setPhase(phase: string): void {
              const progressAtMs = Date.now();
              snapshot.phase = phase;
              snapshot.lastProgressAtMs = progressAtMs;
              logger.debug(
                {
                  jobId,
                  installationId,
                  lane,
                  key,
                  phase,
                  lastProgressAtMs: progressAtMs,
                },
                "Job phase updated",
              );
            },
          };

          logger.info(
            {
              jobId,
              installationId,
              lane,
              key,
              deliveryId: context?.deliveryId,
              eventName: context?.eventName,
              action: context?.action,
              jobType: context?.jobType,
              prNumber: context?.prNumber,
              phase: snapshot.phase,
              waitMs: waitMetadata.waitMs,
              queueSize: sumQueueMetric(installationId, (candidateQueue) => candidateQueue.size),
              pendingCount: sumQueueMetric(installationId, (candidateQueue) => candidateQueue.pending),
              laneQueueSize: queue.size,
              lanePendingCount: queue.pending,
            },
            "Job execution started",
          );

          try {
            const value = await fn(waitMetadata);
            logger.info(
              {
                jobId,
                installationId,
                lane,
                key,
                deliveryId: context?.deliveryId,
                eventName: context?.eventName,
                action: context?.action,
                jobType: context?.jobType,
                prNumber: context?.prNumber,
                phase: snapshot.phase,
                durationMs: Date.now() - startedAtMs,
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
                lane,
                key,
                deliveryId: context?.deliveryId,
                eventName: context?.eventName,
                action: context?.action,
                jobType: context?.jobType,
                prNumber: context?.prNumber,
                phase: snapshot.phase,
                durationMs: Date.now() - startedAtMs,
              },
              "Job execution failed",
            );
            throw err;
          }
        });
      } finally {
        deleteActiveJob(installationId, jobId);
        pruneLaneQueue(installationId, lane);
      }
    },

    getQueueSize(installationId: number): number {
      return sumQueueMetric(installationId, (queue) => queue.size);
    },

    getPendingCount(installationId: number): number {
      return sumQueueMetric(installationId, (queue) => queue.pending);
    },

    getActiveJobs(installationId: number): JobSnapshot[] {
      return Array.from(activeJobs.get(installationId)?.values() ?? [])
        .sort((left, right) => left.queuedAtMs - right.queuedAtMs)
        .map((snapshot) => ({ ...snapshot }));
    },
  };
}
