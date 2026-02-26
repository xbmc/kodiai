/**
 * Cluster scheduler: weekly setInterval scheduler for running the
 * review pattern clustering pipeline. Follows wiki-staleness-detector.ts pattern.
 *
 * - 7-day interval with 120s startup delay (staggered after wiki staleness at 90s)
 * - Iterates over configured repos (fail-open per repo)
 * - On-demand trigger via runNow()
 */

import type { Logger } from "pino";
import type { Sql } from "../db/client.ts";
import type { TaskRouter } from "../llm/task-router.ts";
import type { ClusterScheduler } from "./cluster-types.ts";
import { createClusterStore } from "./cluster-store.ts";
import { runClusterPipeline } from "./cluster-pipeline.ts";

const DEFAULT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const DEFAULT_STARTUP_DELAY_MS = 120_000; // 2 minutes

export type ClusterSchedulerOptions = {
  sql: Sql;
  taskRouter: TaskRouter;
  logger: Logger;
  /** Repos to cluster. */
  repos: string[];
};

export function createClusterScheduler(
  opts: ClusterSchedulerOptions,
): ClusterScheduler {
  const { sql, taskRouter, logger, repos } = opts;
  const store = createClusterStore({ sql, logger });
  let startupTimer: ReturnType<typeof setTimeout> | null = null;
  let intervalTimer: ReturnType<typeof setInterval> | null = null;

  async function runAll(): Promise<void> {
    for (const repo of repos) {
      try {
        logger.info({ repo }, "Starting cluster pipeline for repo");
        await runClusterPipeline({ sql, store, taskRouter, logger, repo });
        logger.info({ repo }, "Cluster pipeline completed for repo");
      } catch (err) {
        // Fail-open: log and continue to next repo
        logger.error({ err, repo }, "Cluster pipeline failed for repo (fail-open)");
      }
    }
  }

  return {
    start() {
      startupTimer = setTimeout(() => {
        runAll().catch((err) => {
          logger.error({ err }, "Cluster scheduler initial run failed");
        });
        intervalTimer = setInterval(() => {
          runAll().catch((err) => {
            logger.error({ err }, "Cluster scheduler interval run failed");
          });
        }, DEFAULT_INTERVAL_MS);
      }, DEFAULT_STARTUP_DELAY_MS);
      logger.info(
        { intervalDays: 7, startupDelayMs: DEFAULT_STARTUP_DELAY_MS, repos },
        "Cluster scheduler started",
      );
    },
    stop() {
      if (startupTimer) clearTimeout(startupTimer);
      if (intervalTimer) clearInterval(intervalTimer);
      startupTimer = null;
      intervalTimer = null;
      logger.debug("Cluster scheduler stopped");
    },
    async runNow() {
      await runAll();
    },
  };
}
