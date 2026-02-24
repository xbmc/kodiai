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

    waitForDrain(timeoutMs: number): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        const check = () => {
          const total = activeRequests + activeJobs;
          if (total === 0) {
            clearInterval(interval);
            clearTimeout(timeout);
            resolve();
          }
        };

        // Resolve immediately if already drained
        if (activeRequests + activeJobs === 0) {
          resolve();
          return;
        }

        const interval = setInterval(check, 500);
        const timeout = setTimeout(() => {
          clearInterval(interval);
          reject(new Error(`Drain timeout after ${timeoutMs}ms`));
        }, timeoutMs);
      });
    },
  };
}
