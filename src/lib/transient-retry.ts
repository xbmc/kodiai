import { capRetryDelayMs } from "./retry-after.ts";

export type RetryableOperationOptions = {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  retryDelayMs?: (error: unknown) => number | null;
  onRetry?: (params: { error: unknown; attempt: number; delayMs: number }) => void;
};

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_INITIAL_DELAY_MS = 250;
const DEFAULT_MAX_DELAY_MS = 2_000;

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function retryTransient<T>(
  operation: () => Promise<T>,
  options: RetryableOperationOptions = {},
): Promise<T> {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS));
  const initialDelayMs = Math.max(0, Math.floor(options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS));
  const maxDelayMs = Math.max(0, Math.floor(options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS));
  const sleep = options.sleep ?? defaultSleep;
  const shouldRetry = options.shouldRetry ?? (() => false);

  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      return await operation();
    } catch (error) {
      if (attempt >= maxAttempts || !shouldRetry(error, attempt)) {
        throw error;
      }

      const fallbackDelayMs = Math.min(maxDelayMs, initialDelayMs * 2 ** (attempt - 1));
      const delayMs = capRetryDelayMs(options.retryDelayMs?.(error) ?? null, maxDelayMs) ?? fallbackDelayMs;
      options.onRetry?.({ error, attempt, delayMs });
      if (delayMs > 0) {
        await sleep(delayMs);
      }
    }
  }
}
