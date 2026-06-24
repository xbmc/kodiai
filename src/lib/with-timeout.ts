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
