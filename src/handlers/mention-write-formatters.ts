export function parseWriteIntent(userQuestion: string): {
  writeIntent: boolean;
  keyword: "apply" | "change" | "plan" | undefined;
  request: string;
} {
  const trimmed = userQuestion.trimStart();
  const lower = trimmed.toLowerCase();

  for (const keyword of ["apply", "change", "plan"] as const) {
    const prefix = `${keyword}:`;
    if (lower.startsWith(prefix)) {
      return {
        writeIntent: true,
        keyword,
        request: trimmed.slice(prefix.length).trim(),
      };
    }
  }

  return { writeIntent: false, keyword: undefined, request: userQuestion.trim() };
}

export function summarizeWriteRequest(request: string): string {
  const condensed = request
    .replace(/\s+/g, " ")
    .replace(/^[@`'"([{\s]+/, "")
    .replace(/[@`'"\])}\s]+$/, "")
    .replace(/^(?:can|could|would|will)\s+you\s+/i, "")
    .replace(/^(?:please\s+)+/i, "")
    .replace(/[?.!]+$/, "")
    .trim();

  const fallback = "requested update";
  const normalized = condensed.length > 0 ? condensed : fallback;
  const maxLen = 72;
  return normalized.length <= maxLen ? normalized : `${normalized.slice(0, maxLen - 3).trimEnd()}...`;
}

export function generatePrTitle(issueTitle: string | null, requestSummary: string, isFromPr: boolean): string {
  const maxLen = 72;

  if (issueTitle && issueTitle.trim().length > 0) {
    const cleaned = issueTitle
      .replace(/^\[.*?\]\s*/g, "")
      .replace(/\s*#\d+\s*$/, "")
      .trim();

    const lower = cleaned.toLowerCase();
    let prefix: string;
    if (/\b(?:fix|bug|crash|broken|error)\b/.test(lower)) {
      prefix = "fix";
    } else if (/\brefactor\b/.test(lower)) {
      prefix = "refactor";
    } else if (/\b(?:add|support|implement|feature|new)\b/.test(lower)) {
      prefix = "feat";
    } else {
      prefix = isFromPr ? "fix" : "feat";
    }

    const full = `${prefix}: ${cleaned}`;
    return full.length <= maxLen ? full : `${full.slice(0, maxLen - 3).trimEnd()}...`;
  }

  const defaultPrefix = isFromPr ? "fix" : "feat";
  const full = `${defaultPrefix}: ${requestSummary}`;
  return full.length <= maxLen ? full : `${full.slice(0, maxLen - 3).trimEnd()}...`;
}

export function generateCommitSubject(params: {
  issueTitle: string | null | undefined;
  requestSummary: string;
  isFromPr: boolean;
  ref?: string;
}): string {
  const maxLen = 72;
  const { issueTitle, requestSummary, isFromPr, ref } = params;

  let subject: string;

  if (issueTitle && issueTitle.trim().length > 0) {
    const cleaned = issueTitle
      .replace(/^\[.*?\]\s*/g, "")
      .replace(/\s*#\d+\s*$/, "")
      .trim();

    const lower = cleaned.toLowerCase();
    let prefix: string;
    if (/\b(?:fix|bug|crash|broken|error)\b/.test(lower)) {
      prefix = "fix";
    } else if (/\brefactor\b/.test(lower)) {
      prefix = "refactor";
    } else if (/\b(?:add|support|implement|feature|new)\b/.test(lower)) {
      prefix = "feat";
    } else {
      prefix = isFromPr ? "fix" : "feat";
    }
    subject = `${prefix}: ${cleaned}`;
  } else {
    const defaultPrefix = isFromPr ? "fix" : "feat";
    subject = `${defaultPrefix}: ${requestSummary}`;
  }

  if (ref) {
    const withRef = `${subject} (${ref})`;
    if (withRef.length <= maxLen) {
      subject = withRef;
    } else {
      const refSuffix = ` (${ref})`;
      const available = maxLen - refSuffix.length - 3;
      if (available > 10) {
        subject = `${subject.slice(0, available).trimEnd()}...${refSuffix}`;
      }
    }
  }

  return subject.length <= maxLen ? subject : `${subject.slice(0, maxLen - 3).trimEnd()}...`;
}

export function generatePrBody(params: {
  summary: string;
  issueTitle: string | null;
  sourceUrl: string;
  triggerCommentUrl: string;
  deliveryId: string;
  headSha: string;
  isFromPr: boolean;
  issueNumber: number;
  prNumber: number | undefined;
  diffStat: string;
  warnings?: string[];
}): string {
  const {
    summary, issueTitle, sourceUrl, triggerCommentUrl,
    deliveryId, headSha, isFromPr, issueNumber, prNumber, diffStat,
  } = params;

  const summaryParagraph = issueTitle && issueTitle.trim().length > 0
    ? issueTitle.trim()
    : summary;

  const resolveOrRelate = isFromPr
    ? `Related to #${prNumber}`
    : `Resolves #${issueNumber}`;

  const lines: string[] = [
    summaryParagraph,
    "",
  ];

  if (diffStat) {
    lines.push("## Changes", "", diffStat, "");
  }

  if (params.warnings && params.warnings.length > 0) {
    lines.push(
      "## Automated warnings",
      "",
      ...params.warnings.map((w) => `- ${w}`),
      "",
    );
  }

  lines.push(
    "---",
    "",
    resolveOrRelate,
    "",
    "<details>",
    "<summary>Metadata</summary>",
    "",
    `- Source: ${sourceUrl}`,
    `- Trigger: ${triggerCommentUrl}`,
    `- Delivery: ${deliveryId}`,
    `- Commit: ${headSha}`,
    "",
    "</details>",
  );

  return lines.join("\n");
}
