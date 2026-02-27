/**
 * Pure issue reference parser for PR bodies and commit messages.
 * Extracts GitHub-standard closing keywords (fixes, closes, resolves)
 * and non-closing references (relates-to) with cross-repo support.
 *
 * Zero I/O — fully unit-testable.
 *
 * @module issue-reference-parser
 * @phase 108 (PRLINK-01)
 */

export type IssueReference = {
  issueNumber: number;
  /** Normalized lowercase canonical form: "fixes", "closes", "resolves", "relates-to" */
  keyword: string;
  /** true for fixes/closes/resolves, false for relates-to */
  isClosing: boolean;
  /** "org/repo" for cross-repo refs, null for same-repo (#N) */
  crossRepo: string | null;
  source: "body" | "commit";
};

/**
 * GitHub-standard closing keywords + relates-to.
 * Matches patterns like: "fixes #42", "Closes org/repo#123", "relates-to #7"
 *
 * Group 1: keyword (fix|fixes|fixed|close|closes|closed|resolve|resolves|resolved|relate to|relates to|relate-to|relates-to)
 * Group 2: cross-repo prefix (org/repo) — optional
 * Group 3: issue number (when cross-repo)
 * Group 4: issue number (when same-repo)
 */
const ISSUE_REF_REGEX =
  /(?:^|[\s([])(?<keyword>fix(?:e[sd])?|close[sd]?|resolve[sd]?|relates?\s*[-\s]\s*to)\s+(?:(?<crossRepo>[a-z0-9_.-]+\/[a-z0-9_.-]+)#(?<crossNum>\d+)|#(?<sameNum>\d+))/gi;

/** Strip triple-backtick code blocks to prevent false positives from code examples. */
function stripCodeBlocks(text: string): string {
  return text.replace(/```[\s\S]*?```/g, "");
}

/** Normalize keyword variants to canonical forms. */
function normalizeKeyword(raw: string): string {
  const lower = raw.toLowerCase().trim();
  if (/^fix/.test(lower)) return "fixes";
  if (/^close/.test(lower)) return "closes";
  if (/^resolve/.test(lower)) return "resolves";
  if (/^relate/.test(lower)) return "relates-to";
  return lower;
}

/**
 * Extract issue references from text with deduplication tracking.
 * Returns new references found (not already in `seen`), and updates `seen` in place.
 */
function extractFromText(
  text: string,
  source: "body" | "commit",
  seen: Set<string>,
): IssueReference[] {
  const refs: IssueReference[] = [];
  const stripped = stripCodeBlocks(text);

  for (const match of stripped.matchAll(ISSUE_REF_REGEX)) {
    const groups = match.groups!;
    const crossRepo = groups.crossRepo ?? null;
    const issueNumber = parseInt(groups.crossNum ?? groups.sameNum ?? "0", 10);
    if (issueNumber === 0) continue;

    const key = `${crossRepo ?? ""}#${issueNumber}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const keyword = normalizeKeyword(groups.keyword);
    const isClosing = keyword !== "relates-to";

    refs.push({ issueNumber, keyword, isClosing, crossRepo, source });
  }

  return refs;
}

/**
 * Parse issue references from a PR body and commit messages.
 *
 * - Recognizes: fixes, closes, resolves (all variants, case-insensitive)
 * - Recognizes: relates-to / relates to (non-closing reference)
 * - Supports cross-repo: org/repo#N
 * - Strips code blocks before matching
 * - Deduplicates across body and commits (first occurrence wins)
 */
export function parseIssueReferences(params: {
  prBody: string;
  commitMessages: string[];
}): IssueReference[] {
  const { prBody, commitMessages } = params;
  const seen = new Set<string>();
  const refs: IssueReference[] = [];

  // Process PR body first (body refs take priority over commit refs)
  if (prBody) {
    refs.push(...extractFromText(prBody, "body", seen));
  }

  // Process commit messages
  for (const msg of commitMessages) {
    if (msg) {
      refs.push(...extractFromText(msg, "commit", seen));
    }
  }

  return refs;
}
