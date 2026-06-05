type RetryLogger = {
  debug: (obj: Record<string, unknown>, msg: string) => void;
};

const DEFAULT_TRANSIENT_DB_ATTEMPTS = 2;

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
  } = {},
): Promise<T> {
  const attempts = opts.attempts ?? DEFAULT_TRANSIENT_DB_ATTEMPTS;
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
    }
  }

  throw lastErr;
}
