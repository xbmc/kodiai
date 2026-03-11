---
id: S12
parent: M007
milestone: M007
provides:
  - aggregateSuppressiblePatterns() filtering by thresholds (minThumbsDown, minDistinctReactors, minDistinctPRs)
  - isFeedbackSuppressionProtected() safety floor for CRITICAL and MAJOR security/correctness
  - adjustConfidenceForFeedback() score modifier with +10/-20 formula and [0,100] clamping
  - evaluateFeedbackSuppressions() orchestrator combining aggregation, safety guard, and fail-open error handling
  - Feedback-driven suppression wired into review pipeline between enforcement and config suppression
  - Confidence scores adjusted by feedback history (+10/-20 formula) in processedFindings
  - Review Details disclosure line showing feedback suppression count
  - Integration tests verifying end-to-end feedback suppression behavior
  - FeedbackPattern, FeedbackThresholds, FeedbackSuppressionResult, FeedbackSuppressionConfig types
  - KnowledgeStore aggregateFeedbackPatterns, clearFeedbackSuppressions, listFeedbackSuppressions methods
  - feedbackSchema with autoSuppress config section in .kodiai.yml
requires: []
affects: []
key_files: []
key_decisions:
  - "Safety guard protects CRITICAL (all categories) and MAJOR security/correctness from auto-suppression per FEED-04/FEED-05"
  - "Confidence adjustment uses +10 per thumbs-up, -20 per thumbs-down with [0,100] clamping"
  - "evaluateFeedbackSuppressions is fail-open: on store errors, logs warning and returns empty suppression set"
  - "Feedback evaluation placed after enforcement, before config suppression matching -- respects enforcement priority"
  - "Feedback suppression count always passed to Review Details (renders only when > 0)"
  - "No new deviation rules needed: existing fail-open in evaluateFeedbackSuppressions covers store errors"
  - "Duplicated FNV-1a hash into _feedbackFingerprint helper with fp- prefix to match review.ts fingerprintFindingTitle, avoiding circular imports"
  - "listFeedbackSuppressions delegates to aggregateFeedbackPatterns for identical logic with distinct API naming"
  - "autoSuppress.enabled defaults to false (opt-in per FEED-08), thresholds default to 3/3/2 per FEED-09"
patterns_established:
  - "Safety guard as pure predicate function: isFeedbackSuppressionProtected({ severity, category }) -> boolean"
  - "Orchestrator pattern: aggregate -> filter by safety guard -> build Set -> return result"
  - "Pipeline order: extraction -> enforcement -> feedback suppression -> config suppression -> dedup -> abbreviated -> confidence"
  - "Feedback suppression uses fingerprint matching against pre-computed suppression set (O(1) per finding)"
  - "Feedback types live in src/feedback/types.ts, imported by knowledge layer"
  - "SQL aggregation with correlated subquery for latest severity/category per title group"
observability_surfaces: []
drill_down_paths: []
duration: 4min
verification_result: passed
completed_at: 2026-02-14
blocker_discovered: false
---
# S12: Feedback Driven Learning

**# Phase 41 Plan 02: Feedback Aggregator and Safety Guard Summary**

## What Happened

# Phase 41 Plan 02: Feedback Aggregator and Safety Guard Summary

**Feedback aggregator with three-threshold filtering, safety guard preventing CRITICAL/MAJOR-security/correctness suppression, +10/-20 confidence adjuster, and fail-open orchestrator barrel**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-14T05:27:06Z
- **Completed:** 2026-02-14T05:30:03Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Built aggregateSuppressiblePatterns that filters feedback patterns by minThumbsDown, minDistinctReactors, and minDistinctPRs thresholds
- Implemented isFeedbackSuppressionProtected safety guard that protects CRITICAL (any category) and MAJOR security/correctness from auto-suppression
- Created adjustConfidenceForFeedback with +10/-20 formula clamped to [0, 100]
- Built evaluateFeedbackSuppressions orchestrator with config.enabled early-return, safety guard filtering, and fail-open error handling
- All 33 feedback tests passing, 611 total (no regressions from 578 baseline)

## Task Commits

Each task was committed atomically:

1. **Task 1: TDD aggregator and safety guard** - `13290432a8` (test/RED), `93847e45cf` (feat/GREEN)
2. **Task 2: TDD confidence adjuster and orchestrator** - `f06acbc3b5` (test/RED), `9db579039a` (feat/GREEN)

_Note: TDD tasks have two commits each (test -> feat)_

## Files Created/Modified
- `src/feedback/aggregator.ts` - Pure function filtering feedback patterns by three thresholds
- `src/feedback/aggregator.test.ts` - 8 test cases for threshold filtering (inclusion, exclusion, boundary, custom thresholds)
- `src/feedback/safety-guard.ts` - Pure predicate for CRITICAL/MAJOR-safety protection
- `src/feedback/safety-guard.test.ts` - 13 test cases covering all severity/category combinations
- `src/feedback/confidence-adjuster.ts` - Pure function applying +10/-20 feedback score adjustment
- `src/feedback/confidence-adjuster.test.ts` - 7 confidence tests + 5 orchestrator tests
- `src/feedback/index.ts` - Barrel exports and evaluateFeedbackSuppressions orchestrator

## Decisions Made
- Safety guard protects CRITICAL (all categories) and MAJOR security/correctness from auto-suppression per FEED-04/FEED-05
- Confidence adjustment uses +10 per thumbs-up, -20 per thumbs-down with [0,100] clamping
- evaluateFeedbackSuppressions is fail-open: on store errors, logs warning and returns empty suppression set
- EMPTY_RESULT constant shared across early-return and error paths to avoid repeated object creation

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All feedback business logic ready for 41-03 (pipeline integration)
- evaluateFeedbackSuppressions can be called from review handler with store, repo, config, and logger
- adjustConfidenceForFeedback ready to modify finding confidence scores in pipeline
- All 611 tests pass (33 new feedback tests + 578 existing)

## Self-Check: PASSED

- All 7 source/test files exist
- All 4 task commits verified: 13290432a8, 93847e45cf, f06acbc3b5, 9db579039a
- SUMMARY.md created

---
*Phase: 41-feedback-driven-learning*
*Completed: 2026-02-14*

# Phase 41 Plan 03: Pipeline Integration Summary

**Feedback-driven suppression wired into review pipeline with fingerprint-based matching, feedback-adjusted confidence scores, and Review Details disclosure line**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-14T05:32:13Z
- **Completed:** 2026-02-14T05:36:52Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Wired evaluateFeedbackSuppressions into review pipeline between enforcement and config suppression matching
- Added feedback-driven suppression to processedFindings map: fingerprint lookup, feedbackSuppressed flag in suppressed calculation
- Replaced single-step confidence with two-step computation: base score + optional feedback adjustment
- Added feedbackSuppressionCount parameter to formatReviewDetailsSummary with conditional rendering
- 5 new integration tests covering: enabled suppression, disabled bypass, CRITICAL safety, fail-open, Review Details disclosure
- All 616 tests pass (5 new + 611 existing)

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire feedback suppression into review pipeline with confidence adjustment** - `1e61ef75b1` (feat)
2. **Task 2: Add integration tests for feedback suppression in review pipeline** - `1ce776d68d` (test)

## Files Created/Modified
- `src/handlers/review.ts` - Feedback suppression integration: import, pipeline evaluation, fingerprint matching, confidence adjustment, Review Details disclosure
- `src/handlers/review.test.ts` - 5 integration tests for feedback-driven suppression in the review pipeline

## Decisions Made
- Feedback evaluation placed after enforcement, before config suppression matching -- enforcement takes priority
- Feedback suppression count always passed to formatReviewDetailsSummary; conditional rendering only when count > 0
- Existing fail-open pattern in evaluateFeedbackSuppressions sufficient -- no additional try/catch needed in review handler (ternary guards undefined knowledgeStore)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- End-to-end feedback-driven learning pipeline is fully operational
- Phase 41 complete: foundation types (01), aggregator/safety/confidence (02), pipeline integration (03)
- Pipeline order: extraction -> enforcement -> feedback suppression -> config suppression -> dedup -> abbreviated -> confidence
- Default behavior unchanged: feedback.autoSuppress.enabled defaults to false
- All 616 tests pass

## Self-Check: PASSED

- All 2 modified files exist
- Both task commits verified: 1e61ef75b1, 1ce776d68d
- SUMMARY.md created

---
*Phase: 41-feedback-driven-learning*
*Completed: 2026-02-14*

# Phase 41 Plan 01: Foundation Types and Config Summary

**FeedbackPattern types, KnowledgeStore SQL aggregation with JOIN/DISTINCT counting, and .kodiai.yml feedback.autoSuppress config schema with section-level fallback**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-14T05:20:52Z
- **Completed:** 2026-02-14T05:24:45Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Created FeedbackPattern, FeedbackThresholds, FeedbackSuppressionResult, FeedbackSuppressionConfig types in src/feedback/types.ts
- Implemented aggregateFeedbackPatterns SQL query with JOIN to reviews table, DISTINCT counting for reactors/PRs, correlated subquery for latest severity/category
- Added clearFeedbackSuppressions (DELETE with count) and listFeedbackSuppressions (delegates to aggregate) to KnowledgeStore
- Added feedbackSchema with autoSuppress.enabled (default false) and thresholds (3/3/2) to config, with section-level fallback

## Task Commits

Each task was committed atomically:

1. **Task 1: Create feedback types and KnowledgeStore aggregation methods** - `a9e25a82c8` (feat)
2. **Task 2: Add feedback config schema with section-level fallback** - `d9ebed854d` (feat)

## Files Created/Modified
- `src/feedback/types.ts` - FeedbackPattern, FeedbackThresholds, FeedbackSuppressionResult, FeedbackSuppressionConfig type definitions
- `src/knowledge/types.ts` - Added aggregateFeedbackPatterns, clearFeedbackSuppressions, listFeedbackSuppressions to KnowledgeStore interface
- `src/knowledge/store.ts` - SQL aggregation query implementation, _feedbackFingerprint helper, idx_feedback_reactions_repo_title index
- `src/execution/config.ts` - feedbackAutoSuppressThresholdsSchema, feedbackAutoSuppressSchema, feedbackSchema, section-level fallback parsing

## Decisions Made
- Duplicated FNV-1a hash into `_feedbackFingerprint` helper with `fp-` prefix to match review.ts `fingerprintFindingTitle`, avoiding circular imports between handlers and knowledge layers
- `listFeedbackSuppressions` delegates to `aggregateFeedbackPatterns` -- identical logic with distinct API naming for clarity (list for viewing, aggregate for evaluation)
- autoSuppress.enabled defaults to false (opt-in per FEED-08), thresholds default to 3/3/2 per FEED-09

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Foundation types and store methods ready for 41-02 (feedback aggregator/safety guard)
- Config schema ready for 41-03 (pipeline integration to read feedback.autoSuppress settings)
- All 578 existing tests pass unchanged

## Self-Check: PASSED

- All 4 source files exist
- Both task commits verified: a9e25a82c8, d9ebed854d
- SUMMARY.md created

---
*Phase: 41-feedback-driven-learning*
*Completed: 2026-02-14*
