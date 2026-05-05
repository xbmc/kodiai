export type FormatterSuggestionRequestMode = "format-only" | "review-and-format";

export interface FormatterSuggestionRequest {
  requested: true;
  mode: FormatterSuggestionRequestMode;
  source: "explicit-mention";
  normalizedRequest: string;
}

const REVIEW_AND_FORMAT_PATTERN = /^(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?review\s*(?:&|\+|and|with)\s*format\s+suggestions\b/;

const FORMAT_ONLY_PATTERNS = [
  /^format\s+suggestions\b/,
  /^formatting\s+suggestions\b/,
  /^suggest\s+formatting\s+(?:fixes|changes)\b/,
];

export function detectFormatterSuggestionRequest(
  userQuestion: string,
): FormatterSuggestionRequest | undefined {
  const normalizedRequest = normalizeFormatterSuggestionRequest(userQuestion);
  if (normalizedRequest.length === 0) {
    return undefined;
  }

  if (REVIEW_AND_FORMAT_PATTERN.test(normalizedRequest)) {
    return {
      requested: true,
      mode: "review-and-format",
      source: "explicit-mention",
      normalizedRequest,
    };
  }

  if (FORMAT_ONLY_PATTERNS.some((pattern) => pattern.test(normalizedRequest))) {
    return {
      requested: true,
      mode: "format-only",
      source: "explicit-mention",
      normalizedRequest,
    };
  }

  return undefined;
}

function normalizeFormatterSuggestionRequest(userQuestion: string): string {
  return userQuestion
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[?.!]+$/, "")
    .trim()
    .toLowerCase();
}
