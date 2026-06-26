type RetryLogger = {
  debug: (obj: Record<string, unknown>, msg: string) => void;
};

const DEFAULT_TRANSIENT_DB_ATTEMPTS = 2;
const DEFAULT_INITIAL_DELAY_MS = 100;
const DEFAULT_MAX_DELAY_MS = 1_000;

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export function isTransientDbConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: unknown }).code;
  return code === "CONNECTION_ENDED" || err.message.includes("CONNECTION_ENDED");
}

export async function withTransientDbRetry<T>(
  operation: () => Promise<T>,
  opts: {
    logger?: RetryLogger;
    context?: Record<string, unknown>;
    attempts?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    sleep?: (delayMs: number) => Promise<void>;
    random?: () => number;
  } = {},
): Promise<T> {
  const attempts = opts.attempts ?? DEFAULT_TRANSIENT_DB_ATTEMPTS;
  const initialDelayMs = Math.max(0, Math.floor(opts.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS));
  const maxDelayMs = Math.max(0, Math.floor(opts.maxDelayMs ?? DEFAULT_MAX_DELAY_MS));
  const sleep = opts.sleep ?? defaultSleep;
  const random = opts.random ?? Math.random;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastErr = err;
      if (!isTransientDbConnectionError(err) || attempt === attempts) {
        throw err;
      }
      opts.logger?.debug(
        {
          ...(opts.context ?? {}),
          attempt,
          retryReason: "connection-ended",
        },
        "Retrying transient database operation",
      );
      const delayCeilingMs = Math.min(maxDelayMs, initialDelayMs * 2 ** (attempt - 1));
      const delayMs = Math.floor(delayCeilingMs * random());
      if (delayMs > 0) {
        await sleep(delayMs);
      }
    }
  }

  throw lastErr;
}
