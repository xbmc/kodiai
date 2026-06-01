export function boundedReviewDetailsValue(value: unknown, maxLength = 160): string | null {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    return null;
  }
  const text = String(value).trim();
  if (!text) return null;
  return text.replace(/[\r\n|]/g, " ").slice(0, maxLength);
}

export function isReviewDetailsRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readNonNegativeCount(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
}

export function formatCountFields(value: unknown, keys: readonly string[]): string | null {
  if (!isReviewDetailsRecord(value)) return null;
  return keys.map((key) => `${key}:${readNonNegativeCount(value, key)}`).join(",");
}

export function formatStringArray(value: unknown, maxItems = 8): string {
  if (!Array.isArray(value)) return "none";
  const entries = value
    .map((entry) => boundedReviewDetailsValue(entry, 64))
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, maxItems);
  return entries.length > 0 ? entries.join(",") : "none";
}

export function formatReasonCountFields(value: unknown, maxItems = 8): string {
  if (!isReviewDetailsRecord(value)) return "none";
  const entries = Object.entries(value)
    .map(([key, count]) => {
      const boundedKey = boundedReviewDetailsValue(key, 64);
      if (!boundedKey || typeof count !== "number" || !Number.isFinite(count) || count < 0) return null;
      return `${boundedKey}:${Math.trunc(count)}`;
    })
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, maxItems);
  return entries.length > 0 ? entries.join(",") : "none";
}

export function boundedBridgeToken(value: unknown, fallback = "unavailable", maxLength = 160): string {
  const text = boundedReviewDetailsValue(value, maxLength);
  if (!text || !/^[a-z0-9][a-z0-9:._-]*$/.test(text)) return fallback;
  return text;
}

export function formatBridgeTokenArray(value: unknown, maxItems = 8): string {
  if (!Array.isArray(value)) return "none";
  const entries = value
    .map((entry) => boundedBridgeToken(entry, "", 64))
    .filter((entry) => entry.length > 0)
    .slice(0, maxItems);
  return entries.length > 0 ? entries.join(",") : "none";
}
