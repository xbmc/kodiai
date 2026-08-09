/**
 * Backward-compatible review utility surface.
 *
 * New production code should import from the focused modules directly.
 */

export type {
  ConfidenceBand,
  FindingCategory,
  FindingSeverity,
  ReviewArea,
} from "./review-finding-metadata.ts";
export {
  fingerprintFindingTitle,
  normalizeCategory,
  normalizeSeverity,
  parseInlineCommentMetadata,
  parseSeverityCountsFromBody,
  toConfidenceBand,
} from "./review-finding-metadata.ts";

/**
 * Extract changed regions from diff hunks with surrounding context.
 * Returns file paths and line ranges for areas that changed.
 *
 * @param diffContent - Raw git diff output
 * @param contextLines - Lines of context to include before/after changes (default 50)
 * @returns Array of {file, startLine, endLine} for changed regions
 */
export function extractDeltaRegions(
  diffContent: string,
  contextLines: number = 50,
): Array<{ file: string; startLine: number; endLine: number }> {
  if (!diffContent) return [];

  const regions: Array<{ file: string; startLine: number; endLine: number }> = [];
  const hunkRegex = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/gm;
  let currentFile = "";
  let fileStartLine = -1;

  for (const line of diffContent.split("\n")) {
    if (line.startsWith("diff --git a/")) {
      const match = line.match(/diff --git a\/(.+) b\/(.+)$/);
      if (match) {
        currentFile = match[2]!;
      }
    } else if (line.startsWith("@@")) {
      const match = line.match(hunkRegex);
      if (match) {
        const newLineStart = parseInt(match[2]!, 10);
        fileStartLine = Math.max(1, newLineStart - contextLines);
        const endLine = newLineStart + contextLines;

        if (currentFile) {
          regions.push({
            file: currentFile,
            startLine: fileStartLine,
            endLine,
          });
        }
      }
    }
  }

  return regions;
}
export {
  SEARCH_RATE_LIMIT_BACKOFF_MAX_MS,
  SEARCH_RATE_LIMIT_DISCLOSURE_LINE,
  SEARCH_RATE_LIMIT_ERROR_MARKERS,
  ensureSearchRateLimitDisclosureInSummary,
  extractSearchErrorStatus,
  extractSearchErrorText,
  isSearchRateLimitError,
  resolveRateLimitBackoffMs,
} from "./search-rate-limit.ts";
export {
  normalizeSkipPattern,
  splitDiffByFile,
  splitGitLines,
} from "./review-git-utils.ts";
export {
  isReviewTriggerEnabled,
  normalizeReviewerLogin,
} from "./review-trigger-utils.ts";
export { renderApprovalConfidence } from "./merge-confidence-format.ts";
export {
  PROFILE_PRESETS,
} from "./review-profile-presets.ts";
export {
  buildReviewDetailsMarker,
  buildReviewFirstPassPublicSummary,
  classifyRetryFailure,
  describeReviewFirstPass,
  formatReviewDetailsSummary,
  resolveReviewDetailsLineCounts,
  type CandidatePublicationBridgeReviewDetails,
  type CandidateVerificationPublicationEvidenceReviewDetails,
  type ReviewDetailsLineCountSource,
  type ReviewDetailsPhaseTimingSummary,
  type TimeoutBudgetDetails,
  type TimeoutReviewDetailsProgress,
} from "./review-details-formatting.ts";
