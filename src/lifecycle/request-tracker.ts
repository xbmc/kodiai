import { rejectWithTimeout, scheduleInterval, type ScheduledInterval } from "../lib/with-timeout.ts";
import type { RequestTracker } from "./types.ts";

/**
 * Create a request tracker for counting in-flight HTTP requests and background jobs.
 *
 * Used by the shutdown manager to wait for drain before exiting.
 */
export function createRequestTracker(): RequestTracker {
  let activeRequests = 0;
  let activeJobs = 0;

  return {
    trackRequest() {
      activeRequests++;
      let called = false;
      return () => {
        if (!called) {
          called = true;
          activeRequests--;
        }
      };
    },

    trackJob() {
      activeJobs++;
      let called = false;
      return () => {
        if (!called) {
          called = true;
          activeJobs--;
        }
      };
    },

    activeCount() {
      return {
        requests: activeRequests,
        jobs: activeJobs,
        total: activeRequests + activeJobs,
      };
    },

    async waitForDrain(timeoutMs: number): Promise<void> {
      let interval: ScheduledInterval | undefined;
      const drain = new Promise<void>((resolve) => {
        const check = () => {
          const total = activeRequests + activeJobs;
          if (total === 0) {
            resolve();
          }
        };

        // Resolve immediately if already drained
        if (activeRequests + activeJobs === 0) {
          resolve();
          return;
        }

        interval = scheduleInterval(check, 500);
      });

      try {
        await rejectWithTimeout(drain, {
          timeoutMs,
          createTimeoutError: () => new Error(`Drain timeout after ${timeoutMs}ms`),
        });
      } finally {
        if (interval !== undefined) {
          interval.clear();
        }
      }
    },
  };
}
