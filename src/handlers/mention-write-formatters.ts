import { deriveCommitPrefix, summarizeWriteRequest } from "../lib/write-request-formatting.ts";

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

export type MentionWriteIntent = ReturnType<typeof parseWriteIntent>;

export function resolveMentionWriteIntent(params: {
  userQuestion: string;
  isIssueThreadComment: boolean;
  isPrSurface: boolean;
  formatterSuggestionRequestMode?: string;
  detectImplicitIssueIntent: (request: string) => "apply" | "change" | "plan" | undefined;
  detectImplicitPrPatchIntent: (request: string) => "apply" | "change" | "plan" | undefined;
  isReviewRequest: (request: string) => boolean;
}): MentionWriteIntent {
  const parsedWriteIntent = parseWriteIntent(params.userQuestion);

  const implicitIntent =
    params.isIssueThreadComment && !parsedWriteIntent.writeIntent
      ? params.detectImplicitIssueIntent(parsedWriteIntent.request)
      : undefined;

  const prWriteIntent =
    params.isPrSurface
    && !params.isIssueThreadComment
    && !parsedWriteIntent.writeIntent
    && params.formatterSuggestionRequestMode === undefined
    && !params.isReviewRequest(parsedWriteIntent.request)
      ? params.detectImplicitPrPatchIntent(parsedWriteIntent.request)
      : undefined;

  const effectiveImplicit = implicitIntent ?? prWriteIntent;

  return effectiveImplicit !== undefined && !parsedWriteIntent.writeIntent
    ? {
        writeIntent: true,
        keyword: effectiveImplicit,
        request: parsedWriteIntent.request,
      }
    : parsedWriteIntent;
}

export function generatePrTitle(issueTitle: string | null, requestSummary: string, isFromPr: boolean): string {
  const maxLen = 72;

  if (issueTitle && issueTitle.trim().length > 0) {
    const cleaned = issueTitle
      .replace(/^\[.*?\]\s*/g, "")
      .replace(/\s*#\d+\s*$/, "")
      .trim();

    const prefix = deriveCommitPrefix(cleaned, isFromPr ? "fix" : "feat");

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

    const prefix = deriveCommitPrefix(cleaned, isFromPr ? "fix" : "feat");
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

export function buildMentionWriteCommitMessage(params: {
  issueTitle: string | null | undefined;
  request: string;
  isFromPr: boolean;
  sourceRef: string;
  marker: string;
  deliveryId: string;
}): string {
  const requestSummary = summarizeWriteRequest(params.request);
  const commitSubject = generateCommitSubject({
    issueTitle: params.issueTitle,
    requestSummary,
    isFromPr: params.isFromPr,
    ref: params.sourceRef,
  });

  return [
    commitSubject,
    "",
    params.marker,
    `deliveryId: ${params.deliveryId}`,
  ].join("\n");
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
