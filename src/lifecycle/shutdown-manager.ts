import type { Logger } from "pino";
import type { JobSnapshot } from "../jobs/types.ts";
import type { RequestTracker, ShutdownManager } from "./types.ts";

interface ShutdownManagerDeps {
  logger: Logger;
  requestTracker: RequestTracker;
  closeDb: () => Promise<void>;
  graceMs?: number;
  maxTotalGraceMs?: number;
  /**
   * Returns the jobs still in flight, for use only after a drain has already
   * timed out and the process is about to be force-exited. Optional so
   * callers/tests that don't care about abandoned-job visibility can omit it.
   */
  getAbandonedJobs?: () => JobSnapshot[];
  /**
   * Best-effort notice (e.g. a PR comment) for jobs about to be abandoned by
   * a force-exit. Never allowed to block shutdown indefinitely -- awaited
   * once, with its own internal timeout, before the process exits.
   */
  notifyAbandonedJobs?: (jobs: JobSnapshot[]) => Promise<void>;
  /** Test-only: override process exit for deterministic shutdown tests. */
  __exitForTests?: (code: number) => void;
}

/**
 * Create a shutdown manager that handles SIGTERM/SIGINT with drain logic.
 *
 * On signal:
 * 1. Set shutting-down flag (new webhooks will be queued to PostgreSQL)
 * 2. Wait for in-flight requests and jobs to drain within grace window
 * 3. If drain times out, use the remaining total budget once, then force-exit with code 1
 * 4. On successful drain, close DB and exit 0
 */
export function createShutdownManager(deps: ShutdownManagerDeps): ShutdownManager {
  const { logger, requestTracker, closeDb } = deps;
  const graceMs = deps.graceMs ?? (parseInt(process.env.SHUTDOWN_GRACE_MS ?? "", 10) || 180_000);
  const maxTotalGraceMs = deps.maxTotalGraceMs ?? (parseInt(process.env.SHUTDOWN_MAX_TOTAL_GRACE_MS ?? "", 10) || 540_000);
  const exitProcess = deps.__exitForTests ?? ((code: number) => process.exit(code));
  let shuttingDown = false;

  async function beginShutdown(trigger: { kind: "signal"; signal: string } | { kind: "fault"; reason: string }): Promise<void> {
    if (shuttingDown) {
      if (trigger.kind === "signal") {
        logger.warn({ signal: trigger.signal }, "Shutdown already in progress, ignoring duplicate signal");
      }
      return;
    }

    shuttingDown = true;

    const counts = requestTracker.activeCount();
    if (trigger.kind === "signal") {
      logger.info(
        {
          signal: trigger.signal,
          activeRequests: counts.requests,
          activeJobs: counts.jobs,
          activeTotal: counts.total,
          graceMs,
        },
        "Shutdown signal received, starting graceful drain",
      );
    } else {
      logger.error(
        {
          shutdownReason: trigger.reason,
          activeRequests: counts.requests,
          activeJobs: counts.jobs,
          activeTotal: counts.total,
          graceMs,
        },
        "Fatal runtime fault received, starting graceful shutdown",
      );
    }

    async function safeCloseDb(): Promise<void> {
      try {
        await closeDb();
      } catch (err) {
        logger.error({ err }, "closeDb failed during shutdown (continuing to exit)");
      }
    }

    // Best-effort: before abandoning in-flight work, tell affected PRs their
    // review was interrupted rather than letting it vanish with no signal.
    // Never allowed to block the force-exit itself -- the notifier bounds its
    // own per-notice timeout, and any failure here is logged and swallowed.
    async function safeNotifyAbandonedJobs(): Promise<void> {
      if (!deps.getAbandonedJobs || !deps.notifyAbandonedJobs) {
        return;
      }
      const abandonedJobs = deps.getAbandonedJobs();
      if (abandonedJobs.length === 0) {
        return;
      }
      try {
        await deps.notifyAbandonedJobs(abandonedJobs);
      } catch (err) {
        logger.error({ err }, "notifyAbandonedJobs failed (continuing to exit)");
      }
    }

    // First drain attempt
    try {
      await requestTracker.waitForDrain(graceMs);
      logger.info("Graceful drain completed successfully");
      await safeCloseDb();
      exitProcess(0);
    } catch {
      // First drain timed out -- use the remaining total budget once. The
      // default total stays below ACA's 600s termination grace period.
      const extendedGraceMs = Math.max(0, maxTotalGraceMs - graceMs);
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

      if (extendedGraceMs <= 0) {
        const abandonedCounts = requestTracker.activeCount();
        logger.error(
          {
            abandonedRequests: abandonedCounts.requests,
            abandonedJobs: abandonedCounts.jobs,
            abandonedTotal: abandonedCounts.total,
          },
          "Force exit after shutdown grace budget exhausted, work abandoned",
        );
        await safeNotifyAbandonedJobs();
        await safeCloseDb();
        exitProcess(1);
        return;
      }

      try {
        await requestTracker.waitForDrain(extendedGraceMs);
        logger.info("Graceful drain completed after extended grace");
        await safeCloseDb();
        exitProcess(0);
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
        await safeNotifyAbandonedJobs();
        await safeCloseDb();
        exitProcess(1);
      }
    }
  }

  return {
    start() {
      process.on("SIGTERM", () => {
        void beginShutdown({ kind: "signal", signal: "SIGTERM" });
      });
      process.on("SIGINT", () => {
        void beginShutdown({ kind: "signal", signal: "SIGINT" });
      });
      logger.info({ graceMs }, "Shutdown manager registered SIGTERM/SIGINT handlers");
    },

    isShuttingDown() {
      return shuttingDown;
    },

    requestShutdown(reason: string) {
      void beginShutdown({ kind: "fault", reason });
    },
  };
}
