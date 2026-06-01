import { SEARCH_RATE_LIMIT_DISCLOSURE_SENTENCE } from "../execution/review-prompt.ts";

export const SEARCH_RATE_LIMIT_ERROR_MARKERS = [
  "rate limit",
  "secondary rate limit",
  "abuse detection",
  "too many requests",
];
export const SEARCH_RATE_LIMIT_BACKOFF_MAX_MS = 1_500;
export const SEARCH_RATE_LIMIT_DISCLOSURE_LINE = `> ${SEARCH_RATE_LIMIT_DISCLOSURE_SENTENCE}`;

export function ensureSearchRateLimitDisclosureInSummary(summaryBody: string): string {
  if (summaryBody.includes(SEARCH_RATE_LIMIT_DISCLOSURE_SENTENCE)) {
    return summaryBody;
  }

  const closingTag = "</details>";
  const lastCloseIdx = summaryBody.lastIndexOf(closingTag);

  if (lastCloseIdx === -1) {
    return `${summaryBody}\n\n${SEARCH_RATE_LIMIT_DISCLOSURE_LINE}`;
  }

  const before = summaryBody.slice(0, lastCloseIdx).trimEnd();
  const after = summaryBody.slice(lastCloseIdx);
  return `${before}\n\n${SEARCH_RATE_LIMIT_DISCLOSURE_LINE}\n\n${after}`;
}

export function extractSearchErrorStatus(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const status = (err as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

export function extractSearchErrorText(err: unknown): string {
  if (typeof err !== "object" || err === null) return "";

  const message = (err as { message?: unknown }).message;
  const responseData = (err as { response?: { data?: { message?: unknown } } }).response?.data;
  const responseMessage = responseData && typeof responseData === "object"
    ? (responseData as { message?: unknown }).message
    : undefined;

  const parts = [message, responseMessage]
    .filter((part): part is string => typeof part === "string")
    .map((part) => part.toLowerCase());

  return parts.join(" ");
}

export function isSearchRateLimitError(err: unknown): boolean {
  const status = extractSearchErrorStatus(err);
  const text = extractSearchErrorText(err);
  return (status === 403 || status === 429)
    && SEARCH_RATE_LIMIT_ERROR_MARKERS.some((marker) => text.includes(marker));
}

export function resolveRateLimitBackoffMs(err: unknown): number {
  if (typeof err !== "object" || err === null) return 0;

  const headers = (err as { response?: { headers?: Record<string, unknown> } }).response?.headers;
  if (!headers) return 0;

  const retryAfterRaw = headers["retry-after"];
  if (typeof retryAfterRaw === "string") {
    const retryAfterSeconds = Number.parseInt(retryAfterRaw, 10);
    if (!Number.isNaN(retryAfterSeconds) && retryAfterSeconds >= 0) {
      return Math.min(retryAfterSeconds * 1000, SEARCH_RATE_LIMIT_BACKOFF_MAX_MS);
    }
  }

  const resetRaw = headers["x-ratelimit-reset"];
  if (typeof resetRaw === "string") {
    const resetSeconds = Number.parseInt(resetRaw, 10);
    if (!Number.isNaN(resetSeconds)) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const deltaMs = Math.max(0, (resetSeconds - nowSeconds) * 1000);
      return Math.min(deltaMs, SEARCH_RATE_LIMIT_BACKOFF_MAX_MS);
    }
  }

  return 250;
}
