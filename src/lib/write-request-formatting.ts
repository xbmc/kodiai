function normalizeWriteRequestText(request: string): string {
  return request
    .replace(/\s+/g, " ")
    .replace(/^[@`'"([{\s]+/, "")
    .replace(/[@`'"\])}\s]+$/, "");
}

function stripPolitePreamble(request: string): string {
  return request
    .replace(/^(?:can|could|would|will)\s+you\s+/i, "")
    .replace(/^(?:please\s+)+/i, "");
}

function finishWriteRequestSummary(request: string): string {
  const condensed = request
    .replace(/[?.!]+$/, "")
    .trim();

  const fallback = "requested update";
  const normalized = condensed.length > 0 ? condensed : fallback;
  const maxLen = 72;
  return normalized.length <= maxLen ? normalized : `${normalized.slice(0, maxLen - 3).trimEnd()}...`;
}

export function summarizeWriteRequest(request: string): string {
  return finishWriteRequestSummary(stripPolitePreamble(normalizeWriteRequestText(request)));
}

export function summarizeSlackWriteRequest(request: string): string {
  return finishWriteRequestSummary(normalizeWriteRequestText(request));
}

export function deriveCommitPrefix(
  text: string,
  fallback: "feat" | "fix" | "chore" = "feat",
): "feat" | "fix" | "refactor" | "chore" {
  const lower = text.toLowerCase();
  if (/\b(?:fix|bug|crash|broken|error)\b/.test(lower)) {
    return "fix";
  }
  if (/\brefactor\b/.test(lower)) {
    return "refactor";
  }
  if (/\b(?:add|support|implement|feature|new)\b/.test(lower)) {
    return "feat";
  }
  return fallback;
}

export function buildSlackWriteCommitMessage(params: {
  request: string;
  channel: string;
  threadTs: string;
}): string {
  const requestSummary = summarizeSlackWriteRequest(params.request);
  const prefix = deriveCommitPrefix(requestSummary, "feat");
  const commitSubject = `${prefix}: ${requestSummary}`;
  const maxSubjectLen = 72;
  const truncatedSubject = commitSubject.length <= maxSubjectLen
    ? commitSubject
    : `${commitSubject.slice(0, maxSubjectLen - 3).trimEnd()}...`;

  return [
    truncatedSubject,
    "",
    `source: slack channel ${params.channel} thread ${params.threadTs}`,
    `request: ${requestSummary}`,
  ].join("\n");
}
