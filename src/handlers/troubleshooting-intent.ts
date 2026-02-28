/**
 * Troubleshooting intent classifier and comment-scoped marker dedup.
 *
 * Pure logic layer with no handler wiring or LLM calls.
 * Used by the troubleshooting handler (Phase 111 plan 02) to gate
 * activation and prevent duplicate responses.
 */

/** Problem indicators checked against issue title + body. */
export const PROBLEM_KEYWORDS = [
  "crash",
  "error",
  "bug",
  "broken",
  "fail",
  "not working",
  "doesn't work",
  "does not work",
  "won't start",
  "will not",
  "exception",
  "segfault",
  "hang",
  "freeze",
  "timeout",
  "undefined",
  "null pointer",
  "stack trace",
  "panic",
];

/** Help-seeking patterns checked against mention text. */
export const HELP_KEYWORDS = [
  "troubleshoot",
  "debug",
  "diagnose",
  "help",
  "how to fix",
  "any ideas",
  "suggestions",
  "workaround",
  "similar issue",
  "same problem",
  "has anyone",
  "known issue",
  "what could cause",
  "why is",
  "why does",
];

/**
 * Classify whether a mention on an issue has troubleshooting intent.
 *
 * Uses compound keyword heuristic: requires problem signal in the issue
 * context (title + body) AND help-seeking signal in the mention text.
 * No LLM call (TSHOOT-06).
 */
export function classifyTroubleshootingIntent(params: {
  mentionText: string;
  issueTitle: string;
  issueBody: string | null;
}): boolean {
  const { mentionText, issueTitle, issueBody } = params;

  const contextLower = `${issueTitle} ${issueBody ?? ""}`.toLowerCase();
  const mentionLower = mentionText.toLowerCase();

  const hasProblemInContext = PROBLEM_KEYWORDS.some((k) =>
    contextLower.includes(k),
  );
  const hasHelpInMention = HELP_KEYWORDS.some((k) =>
    mentionLower.includes(k),
  );

  return hasProblemInContext && hasHelpInMention;
}

/** Marker prefix for troubleshooting comment dedup. */
export const TROUBLESHOOT_MARKER_PREFIX = "kodiai:troubleshoot";

/**
 * Build an HTML comment marker keyed by repo, issue number, and trigger comment ID.
 * Comment-scoped so the same issue can receive multiple troubleshooting responses
 * for different @kodiai mentions (TSHOOT-08).
 */
export function buildTroubleshootMarker(
  repo: string,
  issueNumber: number,
  triggerCommentId: number,
): string {
  return `<!-- ${TROUBLESHOOT_MARKER_PREFIX}:${repo}:${issueNumber}:comment-${triggerCommentId} -->`;
}

/**
 * Check whether a troubleshooting response has already been posted for a
 * specific trigger comment ID.
 */
export function hasTroubleshootMarker(
  comments: Array<{ body?: string | null }>,
  triggerCommentId: number,
): boolean {
  const needle = `comment-${triggerCommentId}`;
  return comments.some(
    (c) =>
      c.body?.includes(needle) &&
      c.body?.includes(TROUBLESHOOT_MARKER_PREFIX),
  );
}
