---
id: S01
parent: M010
milestone: M010
provides:
  - "Keyword parsing output renders unrecognized bracket tags as focus hints"
  - "Review prompt includes a Focus Hints section when unrecognized tags are present"
  - "Review handler threads parsedIntent.unrecognized into buildReviewPrompt focusHints"
  - Knowledge DB table `dep_bump_merge_history` with idempotent insert API
  - `pull_request.closed` handler that records merged dependency bump outcomes (fail-open)
  - "SQLite retrieval_quality telemetry table with idempotent delivery_id inserts"
  - "TelemetryStore.recordRetrievalQuality() write API"
  - "Review handler wiring that records retrieval quality metrics from reranked results"
requires: []
affects: []
key_files: []
key_decisions:
  - "None - followed plan as specified"
  - "Store dep bump merge history in knowledge DB keyed by (repo, pr_number) using INSERT OR IGNORE to handle redeliveries"
  - "Use a partial unique index on retrieval_quality(delivery_id) with INSERT OR IGNORE to dedupe webhook redeliveries without failing writes"
  - "Compute avg_distance and language_match_ratio from reranked adjustedDistance/languageMatch (not raw retrieval distances)"
patterns_established:
  - "Unrecognized bracket tags are treated as review focus hints, not ignored metadata"
  - "Dep bump merge history recording is asynchronous (jobQueue) and never posts comments/reviews"
  - "Telemetry table additions are additive-only migrations with indexes created at store init"
  - "Telemetry writes increment a shared write counter to keep WAL checkpoint cadence stable"
observability_surfaces: []
drill_down_paths: []
duration: 9m
verification_result: passed
completed_at: 2026-02-15
blocker_discovered: false
---
# S01: Foundation Layer

**# Phase 56 Plan 03: Focus Hints from Unrecognized Tags Summary**

## What Happened

# Phase 56 Plan 03: Focus Hints from Unrecognized Tags Summary

**Unrecognized bracket tags in PR titles/commits are surfaced as Focus Hints in both the prompt and deterministic Review Details output.**

## Performance

- **Duration:** 4m
- **Started:** 2026-02-15T19:17:07Z
- **Completed:** 2026-02-15T19:20:44Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Updated Review Details keyword parsing UX to render unrecognized bracket tags as `focus hints` (instead of labeling them as ignored)
- Added a first-class `## Focus Hints` section to the review prompt with guardrails to avoid hallucinated context
- Threaded parsed unrecognized tags from `src/handlers/review.ts` into `buildReviewPrompt({ focusHints })`

## Task Commits

Each task was committed atomically:

1. **Task 1: Render unrecognized bracket tags as focus hints (not "ignored")** - `f5d4b514a2` (feat)
2. **Task 2: Add Focus Hints section to buildReviewPrompt and thread through handler** - `13920daf10` (feat)

## Files Created/Modified

- `src/lib/pr-intent-parser.ts` - Renders unrecognized bracket tags as `focus hints: [TAG]` in Review Details keyword parsing
- `src/execution/review-prompt.ts` - Adds optional `focusHints?: string[]` support and a `## Focus Hints` section
- `src/execution/review-prompt.test.ts` - Verifies Focus Hints section is present/absent based on input
- `src/handlers/review.ts` - Passes `parsedIntent.unrecognized` into `buildReviewPrompt({ focusHints })`
- `src/lib/pr-intent-parser.test.ts` - Aligns keyword parsing section expectation with focus hints rendering

## Decisions Made

None - followed plan as specified.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated keyword parsing unit test to match new focus hints rendering**
- **Found during:** Overall verification (`bun test`)
- **Issue:** `src/lib/pr-intent-parser.test.ts` expected the old `ignored [...]` output string
- **Fix:** Updated assertion to expect `focus hints: [FOOBAR]`
- **Files modified:** `src/lib/pr-intent-parser.test.ts`
- **Verification:** `bun test`
- **Committed in:** `c6db12bb78`

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Minimal; test-only update to keep suite aligned with the planned output change.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Intent UX improvements are in place for downstream prompt tuning and review behavior work.

---
*Phase: 56-foundation-layer*
*Completed: 2026-02-15*

## Self-Check: PASSED

- Summary file exists
- Task commits `f5d4b514a2`, `13920daf10`, and `c6db12bb78` present in git history

# Phase 56 Plan 01: Foundation Layer Summary

**Knowledge DB now captures merged dependency bump outcomes via an idempotent dep_bump_merge_history table and a fail-open pull_request.closed handler.**

## Performance

- **Duration:** 5m 31s
- **Started:** 2026-02-15T18:02:28Z
- **Completed:** 2026-02-15T18:07:59Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Added `dep_bump_merge_history` SQLite table + indexes and a typed `recordDepBumpMergeHistory()` insert API.
- Implemented a dedicated `pull_request.closed` handler that records merged dependency bump PRs only.
- Ensured best-effort enrichment and GitHub API calls are fail-open and do not block webhook processing.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add dep bump merge history table + insert API** - `ee1ffba0e5` (feat)
2. **Task 2: Record merged dep bump PRs on pull_request.closed** - `cb41eb6e6f` (feat)

## Files Created/Modified

- `src/knowledge/store.ts` - Adds table/index creation and `recordDepBumpMergeHistory()` prepared statement.
- `src/knowledge/types.ts` - Adds `DepBumpMergeHistoryRecord` + `KnowledgeStore.recordDepBumpMergeHistory()`.
- `src/knowledge/store.test.ts` - Verifies persistence + idempotency under redelivery.
- `src/handlers/dep-bump-merge-history.ts` - Enqueued `pull_request.closed` handler that records merged dep bump history (no comments/reviews).
- `src/handlers/dep-bump-merge-history.test.ts` - Unit tests for merged dep bump vs non-dep behavior.
- `src/index.ts` - Registers `createDepBumpMergeHistoryHandler(...)`.

## Decisions Made

- Used `(repo, pr_number)` uniqueness with `INSERT OR IGNORE` to make webhook redeliveries idempotent without extra read queries.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Merge history persistence is in place; Phase 56-02 can log retrieval quality metrics without touching this schema.
- Handler is non-invasive (no executor, no comments), safe to enable in production webhook stream.

## Self-Check: PASSED

- FOUND: `.planning/phases/56-foundation-layer/56-01-SUMMARY.md`
- FOUND COMMIT: `ee1ffba0e5`
- FOUND COMMIT: `cb41eb6e6f`

# Phase 56 Plan 02: Retrieval Quality Telemetry Summary

**Retrieval-quality observability via SQLite with idempotent delivery_id writes, recorded from reranked retrieval results during review execution.**

## Performance

- **Duration:** 9m
- **Started:** 2026-02-15T18:13:47Z
- **Completed:** 2026-02-15T18:22:58Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Added `retrieval_quality` telemetry table + indexes with webhook redelivery dedupe via partial unique `delivery_id`
- Extended `TelemetryStore` with `recordRetrievalQuality()` and shared WAL checkpointing across write paths
- Wired review-time logging to record result count, avg adjusted distance, threshold/topK used, and language match ratio (fail-open)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add retrieval quality table + TelemetryStore write API** - `855d8edef4` (feat)
2. **Task 2: Wire retrieval quality logging in review handler** - `7ce79e8c65` (feat)

## Files Created/Modified

- `src/telemetry/store.ts` - Adds `retrieval_quality` schema + prepared insert and shared checkpoint counter
- `src/telemetry/types.ts` - Adds `RetrievalQualityRecord` and `TelemetryStore.recordRetrievalQuality()`
- `src/telemetry/store.test.ts` - Verifies row insert, delivery_id idempotency, and checkpoint counter behavior
- `src/handlers/review.ts` - Records retrieval-quality metrics after retrieval/rerank (telemetry.enabled-gated, fail-open)
- `src/handlers/review.test.ts` - Adds focused RET-05 tests and updates telemetry/knowledge stubs

## Decisions Made

- Used `INSERT OR IGNORE` + partial unique index on `delivery_id` to keep writes non-blocking and idempotent under webhook redelivery
- Derived distance metrics from reranked `adjustedDistance` to match what the prompt actually uses (avoids raw-distance mismatch)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated KnowledgeStore test stub to match required interface**
- **Found during:** Task 2 (test updates)
- **Issue:** `KnowledgeStore` added a required `recordDepBumpMergeHistory()` method; test stub was missing it
- **Fix:** Added a no-op `recordDepBumpMergeHistory` to `createKnowledgeStoreStub`
- **Files modified:** `src/handlers/review.test.ts`
- **Verification:** `bun test src/handlers/review.test.ts`
- **Committed in:** `7ce79e8c65`

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Minimal; test-only stub fix to keep interface consistent.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Retrieval-quality metrics are captured for any review that attempts retrieval, ready for downstream tuning/adaptive threshold work.

---
*Phase: 56-foundation-layer*
*Completed: 2026-02-15*

## Self-Check: PASSED

- Summary file exists
- Task commits `855d8edef4` and `7ce79e8c65` present in git history
