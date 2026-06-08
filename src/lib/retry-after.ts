export function parseRetryAfterDelayMs(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;

  const normalized = typeof value === "number" ? value : value.trim();
  if (normalized === "") return null;

  const seconds = Number(normalized);
  if (!Number.isFinite(seconds) || seconds < 0) return null;

  return Math.floor(seconds * 1000);
}
