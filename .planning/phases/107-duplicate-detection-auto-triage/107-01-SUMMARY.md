---
phase: 107-duplicate-detection-auto-triage
plan: 01
subsystem: triage
tags: [pgvector, embeddings, duplicate-detection, zod]

requires:
  - phase: 106-historical-corpus-population
    provides: Populated issue corpus with searchByEmbedding support
provides:
  - issue_triage_state migration for idempotency tracking
  - Extended triageSchema with autoTriageOnOpen, duplicateThreshold, maxDuplicateCandidates, duplicateLabel
  - findDuplicateCandidates function for vector similarity search with fail-open semantics
  - formatTriageComment and buildTriageMarker for triage comment formatting
affects: [107-02, issue-opened-handler]

tech-stack:
  added: []
  patterns: [fail-open-duplicate-detection, triage-comment-marker]

key-files:
  created:
    - src/db/migrations/016-issue-triage-state.sql
    - src/triage/duplicate-detector.ts
    - src/triage/duplicate-detector.test.ts
    - src/triage/triage-comment.ts
    - src/triage/triage-comment.test.ts
  modified:
    - src/execution/config.ts

key-decisions:
  - "75% default similarity threshold (0.25 cosine distance) -- most permissive band, configurable per-repo"
  - "Client-side filtering for self-match exclusion rather than modifying IssueStore interface"
  - "Closed candidates sorted before open in triage comment table"

patterns-established:
  - "Triage comment marker: <!-- kodiai:triage:{repo}:{issueNumber} --> for idempotency fallback"
  - "Fail-open duplicate detection: returns [] on any embedding or search error"

requirements-completed: [DUPL-01, DUPL-02, DUPL-03, DUPL-04]

duration: 5min
completed: 2026-02-27
---

# Plan 107-01 Summary

**Triage state migration, config extension with 4 new fields, fail-open duplicate detector, and compact markdown triage comment formatter**

## Performance

- **Duration:** 5 min
- **Tasks:** 2
- **Files created:** 5
- **Files modified:** 1

## Accomplishments
- Created issue_triage_state table with UNIQUE(repo, issue_number) for atomic idempotency
- Extended triageSchema with autoTriageOnOpen, duplicateThreshold, maxDuplicateCandidates, duplicateLabel
- Built findDuplicateCandidates with fail-open semantics -- returns [] on any error
- Built formatTriageComment with closed-first sorting, "all closed" note, and HTML marker
- 14 unit tests covering all edge cases

## Task Commits

1. **Task 1: Create DB migration and extend config schema** - `a2041e7db8` (feat)
2. **Task 2: Implement duplicate detector and triage comment formatter with tests** - `b3c6844150` (feat)

## Files Created/Modified
- `src/db/migrations/016-issue-triage-state.sql` - Triage state table for idempotency tracking
- `src/execution/config.ts` - Extended triageSchema with 4 new fields
- `src/triage/duplicate-detector.ts` - findDuplicateCandidates with fail-open semantics
- `src/triage/duplicate-detector.test.ts` - 6 tests for duplicate detection
- `src/triage/triage-comment.ts` - formatTriageComment and buildTriageMarker
- `src/triage/triage-comment.test.ts` - 8 tests for comment formatting

## Decisions Made
None - followed plan as specified

## Deviations from Plan
None - plan executed exactly as written

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All building blocks ready for Plan 02 (issue-opened handler)
- findDuplicateCandidates, formatTriageComment, buildTriageMarker, TRIAGE_MARKER_PREFIX all exported
- Config schema includes all fields the handler needs

---
*Phase: 107-duplicate-detection-auto-triage*
*Completed: 2026-02-27*
