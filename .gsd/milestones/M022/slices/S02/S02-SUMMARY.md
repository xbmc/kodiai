---
id: S02
parent: M022
milestone: M022
provides:
  - issue_triage_state migration for idempotency tracking
  - Extended triageSchema with autoTriageOnOpen, duplicateThreshold, maxDuplicateCandidates, duplicateLabel
  - findDuplicateCandidates function for vector similarity search with fail-open semantics
  - formatTriageComment and buildTriageMarker for triage comment formatting
  - createIssueOpenedHandler factory registered on issues.opened
  - Three-layer idempotency for auto-triage
  - Handler wired in src/index.ts with dependency guards
requires: []
affects: []
key_files: []
key_decisions:
  - "75% default similarity threshold (0.25 cosine distance) -- most permissive band, configurable per-repo"
  - "Client-side filtering for self-match exclusion rather than modifying IssueStore interface"
  - "Closed candidates sorted before open in triage comment table"
  - "Use workspaceManager for config loading (consistent with review/mention handlers)"
  - "Comment marker scan before DB claim (Layer 3 before Layer 2) for cheapest check first"
patterns_established:
  - "Triage comment marker: <!-- kodiai:triage:{repo}:{issueNumber} --> for idempotency fallback"
  - "Fail-open duplicate detection: returns [] on any embedding or search error"
  - "Three-layer idempotency: delivery-ID dedup + atomic DB claim + comment marker scan"
  - "Config-gated handler: registration always happens, config check inside handler"
observability_surfaces: []
drill_down_paths: []
duration: 8min
verification_result: passed
completed_at: 2026-02-27
blocker_discovered: false
---
# S02: Duplicate Detection Auto Triage

**# Plan 107-01 Summary**

## What Happened

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

# Plan 107-02 Summary

**Issue-opened handler with three-layer idempotency, config gating, and bootstrap registration for auto-triage on issues.opened**

## Performance

- **Duration:** 8 min
- **Tasks:** 2
- **Files created:** 2
- **Files modified:** 1

## Accomplishments
- Created createIssueOpenedHandler factory with full handler flow
- Implemented three-layer idempotency: delivery-ID dedup (existing), atomic DB INSERT claim, comment marker scan fallback
- Config-gated behind triage.enabled and autoTriageOnOpen (default false)
- Handler posts triage comment only when candidates found (zero noise)
- Label application with fail-open error handling
- Registered in src/index.ts with issueStore + embeddingProvider guards
- 9 unit tests covering all code paths

## Task Commits

1. **Task 1: Implement issue-opened handler with idempotency and tests** - `63ae592d4a` (feat)
2. **Task 2: Register handler in application bootstrap** - `f64d63891d` (feat)

## Files Created/Modified
- `src/handlers/issue-opened.ts` - Handler factory with three-layer idempotency
- `src/handlers/issue-opened.test.ts` - 9 tests covering all code paths
- `src/index.ts` - Handler registration with dependency guards

## Decisions Made
- Used workspaceManager for config loading (shallow clone + loadRepoConfig) for consistency with existing handlers
- Comment marker scan happens before DB claim to use the cheapest idempotency check first

## Deviations from Plan
None - plan executed exactly as written

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 107 complete: duplicate detection and auto-triage fully operational
- Ready for Phase 108 (PR-Issue Linking) and Phase 109 (Retrieval Integration)

---
*Phase: 107-duplicate-detection-auto-triage*
*Completed: 2026-02-27*
