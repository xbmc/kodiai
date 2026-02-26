/**
 * Fallback trigger detection for LLM provider failures.
 *
 * Determines whether an error should trigger fallback to an alternative model.
 * Per user decision: 429 rate limits trigger immediate fallback (no retry).
 * 5xx errors and timeouts also trigger fallback.
 */

/**
 * Determines whether an error should trigger fallback to alternative model.
 */
export function isFallbackTrigger(err: unknown): boolean {
  if (!(err instanceof Error)) return false;

  // Check HTTP status in error properties (AI SDK wraps provider errors)
  const status =
    (err as any).status ?? (err as any).statusCode ?? (err as any).data?.status;

  if (status === 429) return true; // Rate limit -> immediate fallback
  if (typeof status === "number" && status >= 500 && status < 600) return true;

  // Timeout detection
  if (err.message.includes("timeout") || err.name === "AbortError") return true;

  return false;
}

/**
 * Extracts a human-readable fallback reason from the error.
 */
export function getFallbackReason(err: unknown): string {
  if (!(err instanceof Error)) return "unknown error";
  const status = (err as any).status ?? (err as any).statusCode;
  if (status === 429) return "rate limited (429)";
  if (typeof status === "number" && status >= 500)
    return `server error (${status})`;
  if (err.message.includes("timeout") || err.name === "AbortError")
    return "timeout";
  return err.message;
}
