export function parseRetryAfterDelayMs(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;

  const normalized = typeof value === "number" ? value : value.trim();
  if (normalized === "") return null;

  const seconds = Number(normalized);
  if (!Number.isFinite(seconds) || seconds < 0) return null;

  return Math.floor(seconds * 1000);
}

export function capRetryDelayMs(delayMs: number | null, maxDelayMs: number): number | null {
  if (delayMs === null) return null;
  if (!Number.isFinite(maxDelayMs) || maxDelayMs < 0) return delayMs;
  return Math.min(delayMs, Math.floor(maxDelayMs));
}
