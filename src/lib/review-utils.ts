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
