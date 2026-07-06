/**
 * Race a promise against a timeout, without throwing.
 *
 * Returns `{ timedOut: true }` if `timeoutMs` elapses first, otherwise
 * `{ timedOut: false, value }`. The losing `work` promise is left running and
 * its rejection is swallowed, so a slow handler that rejects after we have
 * already acted can never surface as an unhandledRejection.
 *
 * This is the canonical no-throw timeout primitive. (Several modules predate it
 * with their own private `withTimeout` clones — some sentinel-based like this,
 * some that reject on timeout; those can migrate here over time.)
 */
export async function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
): Promise<{ timedOut: true } | { timedOut: false; value: T }> {
  work.catch(() => {});
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutSignal = Symbol("with-timeout");
  const timeoutPromise = new Promise<typeof timeoutSignal>((resolve) => {
    timeoutHandle = setTimeout(() => resolve(timeoutSignal), timeoutMs);
  });
  try {
    const outcome = await Promise.race([work, timeoutPromise]);
    return outcome === timeoutSignal
      ? { timedOut: true }
      : { timedOut: false, value: outcome as T };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

export type RaceWithTimeoutOptions<TimedOut> = {
  timeoutMs: number;
  timeoutValue: TimedOut;
  onTimeout?: () => void;
};

/**
 * Race an operation against a deadline and return a caller-supplied sentinel.
 *
 * This keeps older sentinel-shaped call sites behavior-compatible while moving
 * their timer handling onto the same timeout primitive module.
 */
export async function raceWithTimeout<T, TimedOut>(
  work: Promise<T>,
  options: RaceWithTimeoutOptions<TimedOut>,
): Promise<T | TimedOut> {
  work.catch(() => {});
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<TimedOut>((resolve) => {
    timeoutHandle = setTimeout(() => {
      options.onTimeout?.();
      resolve(options.timeoutValue);
    }, options.timeoutMs);
  });

  try {
    return await Promise.race([work, timeoutPromise]);
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }
}

/**
 * Race an AbortSignal-aware operation against a deadline and return a
 * caller-supplied sentinel on timeout.
 */
export async function raceWithAbortSignalTimeout<T, TimedOut>(
  label: string,
  timeoutMs: number,
  timeoutValue: TimedOut,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T | TimedOut> {
  const controller = new AbortController();
  const work = Promise.resolve().then(() => run(controller.signal));
  return await raceWithTimeout(work, {
    timeoutMs,
    timeoutValue,
    onTimeout: () => {
      controller.abort(new Error(`${label} timed out after ${timeoutMs}ms`));
    },
  });
}

export type RejectWithTimeoutOptions = {
  timeoutMs: number;
  createTimeoutError: () => Error;
};

/**
 * Race an operation against a deadline and reject with a caller-supplied error.
 *
 * This preserves call sites that semantically need timeout-as-exception while
 * centralizing the timer cleanup and late-rejection handling.
 */
export async function rejectWithTimeout<T>(
  work: Promise<T>,
  options: RejectWithTimeoutOptions,
): Promise<T> {
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    return await work;
  }

  work.catch(() => {});
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => reject(options.createTimeoutError()), options.timeoutMs);
  });

  try {
    return await Promise.race([work, timeoutPromise]);
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }
}

/**
 * Run an operation with an AbortSignal that aborts at the deadline.
 *
 * If the operation fails after the signal has been aborted, the failure is
 * wrapped in a consistent timeout error while preserving the original cause.
 */
export async function runWithAbortSignalTimeout<T>(
  label: string,
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const timeout = createAbortControllerWithTimeout(label, timeoutMs);

  try {
    return await run(timeout.controller.signal);
  } catch (error) {
    if (timeout.controller.signal.aborted) {
      throw new Error(`${label}: request timed out after ${timeoutMs}ms`, {
        cause: error,
      });
    }
    throw error;
  } finally {
    timeout.clear();
  }
}

export function abortSignalWithTimeout(timeoutMs: number): AbortSignal {
  return createAbortControllerWithTimeout("abort signal", timeoutMs).controller.signal;
}

export type AbortControllerTimeout = {
  controller: AbortController;
  clear: () => void;
};

export function createAbortControllerWithTimeout(
  label: string,
  timeoutMs: number,
): AbortControllerTimeout {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => {
    controller.abort(new Error(`${label} timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  return {
    controller,
    clear: () => clearTimeout(timeoutHandle),
  };
}

export async function sleep(ms: number): Promise<void> {
  await sleepWithAbortSignal(ms);
}

export type ScheduledTimeout = {
  clear: () => void;
};

export function scheduleTimeout(run: () => void, timeoutMs: number): ScheduledTimeout {
  const timeoutHandle = setTimeout(run, timeoutMs);
  return {
    clear: () => clearTimeout(timeoutHandle),
  };
}

export type ScheduledInterval = {
  clear: () => void;
};

export function scheduleInterval(run: () => void, intervalMs: number): ScheduledInterval {
  const intervalHandle = setInterval(run, intervalMs);
  return {
    clear: () => clearInterval(intervalHandle),
  };
}

/**
 * Sleep until a deadline unless the caller's signal aborts first.
 *
 * Returns true when the timer completes and false when the signal wins. This is
 * useful for retry backoffs that should stop quietly once the parent operation
 * has been cancelled.
 */
export function sleepWithAbortSignal(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (signal?.aborted) {
      resolve(false);
      return;
    }

    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener?.("abort", onAbort);
      resolve(true);
    }, ms);

    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}
