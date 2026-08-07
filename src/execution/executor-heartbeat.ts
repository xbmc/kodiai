import type { Logger } from "pino";
import { scheduleInterval } from "../lib/with-timeout.ts";

/**
 * Periodic "still running" logger for a long, multi-stage operation.
 *
 * The job hard timeout in src/jobs/queue.ts has no visibility into the
 * executor's internals, so a stall on any unbounded I/O call (workspace
 * filesystem/git operations against a network mount, the ACA dispatch, or the
 * ACA poll loop) would otherwise produce total silence until the hard timeout
 * abandons the job. This guarantees at least one log line per interval
 * regardless of where execution is stuck, tagged with the current stage.
 *
 * Stages are recorded by wrapping the work (`run`) rather than by assigning to
 * a mutable variable at call sites: the label cannot drift out of sync with the
 * code it describes, and a stage cannot be silently forgotten when a new step
 * is inserted -- which matters precisely because this exists to be trustworthy
 * during an incident.
 */
export interface ExecutorHeartbeat {
  /** Run `work` labelled as `stage`, so a stall inside it is reported accurately. */
  run<T>(stage: string, work: () => Promise<T>): Promise<T>;
  /** Label the current stage without wrapping a single call. */
  enter(stage: string): void;
  /** Stop emitting. Safe to call more than once. */
  clear(): void;
}

export function startExecutorHeartbeat(params: {
  logger: Logger;
  intervalMs: number;
  startTime: number;
  bindings: Record<string, unknown>;
  initialStage: string;
}): ExecutorHeartbeat {
  let stage = params.initialStage;

  const timer = scheduleInterval(() => {
    params.logger.info(
      { ...params.bindings, stage, elapsedMs: Date.now() - params.startTime },
      "Executor still running, awaiting completion",
    );
  }, params.intervalMs);

  return {
    async run<T>(next: string, work: () => Promise<T>): Promise<T> {
      stage = next;
      return await work();
    },
    enter(next: string): void {
      stage = next;
    },
    clear(): void {
      timer.clear();
    },
  };
}
