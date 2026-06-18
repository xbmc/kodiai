import { parseRetryAfterDelayMs } from "./retry-after.ts";
import { retryTransient, type RetryableOperationOptions } from "./transient-retry.ts";

type GitHubRetryOptions = Omit<RetryableOperationOptions, "retryDelayMs">;

function headerValue(headers: unknown, name: string): unknown {
  if (!headers || typeof headers !== "object") return null;
  if (headers instanceof Headers) return headers.get(name);

  const record = headers as Record<string, unknown>;
  return record[name] ?? record[name.toLowerCase()] ?? record[name.toUpperCase()] ?? null;
}

export function githubRetryAfterDelayMs(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const record = error as Record<string, unknown>;
  const response = record.response;
  const responseHeaders =
    response && typeof response === "object"
      ? (response as Record<string, unknown>).headers
      : null;

  return parseRetryAfterDelayMs(
    headerValue(record.headers, "retry-after") ?? headerValue(responseHeaders, "retry-after"),
  );
}

/**
 * True when GitHub rejected the request for rate-limiting (429, or 403 with a
 * retry-after header / secondary-rate message) — i.e. the request was
 * definitively NOT applied and is always safe to retry, even for mutations.
 */
export function isGitHubRateLimitRejection(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  const status = Number(record.status ?? (record.response as Record<string, unknown> | undefined)?.status);
  if (status === 429) return true;
  if (status === 403) {
    return githubRetryAfterDelayMs(error) !== null
      || /secondary rate|rate limit|abuse/i.test(String(record.message ?? ""));
  }
  return false;
}

export function isRetryableGitHubError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if (isGitHubRateLimitRejection(error)) return true;
  const record = error as Record<string, unknown>;
  const status = Number(record.status ?? (record.response as Record<string, unknown> | undefined)?.status);
  if (!Number.isFinite(status)) return false;
  return status === 408 || (status >= 500 && status <= 599);
}

export function retryGitHubTransient<T>(
  operation: () => Promise<T>,
  options: GitHubRetryOptions = {},
): Promise<T> {
  return retryTransient(operation, {
    ...options,
    shouldRetry: options.shouldRetry ?? isRetryableGitHubError,
    retryDelayMs: githubRetryAfterDelayMs,
  });
}

export function retryGitHubRateLimitOnly<T>(
  operation: () => Promise<T>,
  options: Omit<GitHubRetryOptions, "shouldRetry"> = {},
): Promise<T> {
  return retryGitHubTransient(operation, {
    maxAttempts: 4,
    initialDelayMs: 1_000,
    maxDelayMs: 30_000,
    ...options,
    shouldRetry: isGitHubRateLimitRejection,
  });
}
