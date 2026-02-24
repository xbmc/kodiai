import type { Logger } from "pino";
import type { RequestTracker, ShutdownManager, WebhookQueueStore } from "./types.ts";

interface ShutdownManagerDeps {
  logger: Logger;
  requestTracker: RequestTracker;
  webhookQueueStore: WebhookQueueStore;
  closeDb: () => Promise<void>;
  graceMs?: number;
}

/**
 * Create a shutdown manager that handles SIGTERM/SIGINT with drain logic.
 *
 * On signal:
 * 1. Set shutting-down flag (new webhooks will be queued to PostgreSQL)
 * 2. Wait for in-flight requests and jobs to drain within grace window
 * 3. If drain times out, extend grace once (double), then force-exit with code 1
 * 4. On successful drain, close DB and exit 0
 */
export function createShutdownManager(deps: ShutdownManagerDeps): ShutdownManager {
  const { logger, requestTracker, webhookQueueStore: _webhookQueueStore, closeDb } = deps;
  const graceMs = deps.graceMs ?? (parseInt(process.env.SHUTDOWN_GRACE_MS ?? "", 10) || 300_000);
  let shuttingDown = false;

  async function handleSignal(signal: string): Promise<void> {
    if (shuttingDown) {
      logger.warn({ signal }, "Shutdown already in progress, ignoring duplicate signal");
      return;
    }

    shuttingDown = true;

    const counts = requestTracker.activeCount();
    logger.info(
      {
        signal,
        activeRequests: counts.requests,
        activeJobs: counts.jobs,
        activeTotal: counts.total,
        graceMs,
      },
      "Shutdown signal received, starting graceful drain",
    );

    // First drain attempt
    try {
      await requestTracker.waitForDrain(graceMs);
      logger.info("Graceful drain completed successfully");
      await closeDb();
      process.exit(0);
    } catch {
      // First drain timed out -- extend grace once (double)
      const extendedGraceMs = graceMs * 2;
      const remainingCounts = requestTracker.activeCount();
      logger.warn(
        {
          activeRequests: remainingCounts.requests,
          activeJobs: remainingCounts.jobs,
          activeTotal: remainingCounts.total,
          extendedGraceMs,
        },
        "Drain timeout, extending grace window once",
      );

      try {
        await requestTracker.waitForDrain(extendedGraceMs);
        logger.info("Graceful drain completed after extended grace");
        await closeDb();
        process.exit(0);
      } catch {
        // Extended drain also timed out -- force exit
        const abandonedCounts = requestTracker.activeCount();
        logger.error(
          {
            abandonedRequests: abandonedCounts.requests,
            abandonedJobs: abandonedCounts.jobs,
            abandonedTotal: abandonedCounts.total,
          },
          "Force exit after extended grace timeout, work abandoned",
        );
        await closeDb();
        process.exit(1);
      }
    }
  }

  return {
    start() {
      process.on("SIGTERM", () => {
        void handleSignal("SIGTERM");
      });
      process.on("SIGINT", () => {
        void handleSignal("SIGINT");
      });
      logger.info({ graceMs }, "Shutdown manager registered SIGTERM/SIGINT handlers");
    },

    isShuttingDown() {
      return shuttingDown;
    },
  };
}
