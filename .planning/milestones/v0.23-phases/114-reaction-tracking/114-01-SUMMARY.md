---
phase: 114-reaction-tracking
plan: 01
subsystem: database, infra
tags: [postgres, github-actions, cron, reactions, threshold-learning, bayesian]

# Dependency graph
requires:
  - phase: 112-outcome-capture
    provides: issue_outcome_feedback table, comment_github_id column on issue_triage_state
  - phase: 113-threshold-learning
    provides: recordObservation function for Bayesian threshold updates
provides:
  - triage_comment_reactions table for storing reaction snapshots
  - sync-triage-reactions.ts standalone script for polling GitHub reactions
  - nightly-reaction-sync GitHub Actions workflow (3:30 AM UTC)
  - Secondary feedback signal for threshold learning via reactions
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: [reaction-based observation recording, closure dedup guard, UPSERT reaction snapshots]

key-files:
  created:
    - src/db/migrations/019-triage-comment-reactions.sql
    - src/db/migrations/019-triage-comment-reactions.down.sql
    - scripts/sync-triage-reactions.ts
    - .github/workflows/nightly-reaction-sync.yml
  modified: []

key-decisions:
  - "Observation dedup via observation_recorded + observation_direction columns -- re-records only if direction flips"
  - "Closure signal takes precedence -- skips reaction observation when issue_outcome_feedback record exists"
  - "kodiaiPredictedDuplicate always true for reaction observations (triage comment implies duplicate prediction)"

patterns-established:
  - "Reaction sync pattern: poll listForIssueComment, filter human thumbs, UPSERT counts, conditionally record observation"
  - "Nightly cron offset: reaction sync at 3:30 AM UTC, 30 min after issue sync at 3:00 AM UTC"

requirements-completed: [REACT-02, REACT-03]

# Metrics
duration: 2min
completed: 2026-03-01
---

# Phase 114 Plan 01: Reaction Tracking Summary

**Nightly reaction sync polling GitHub thumbs on triage comments with Bayesian threshold observation recording and closure dedup guard**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-01T16:26:51Z
- **Completed:** 2026-03-01T16:28:54Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments
- Migration 019 creates triage_comment_reactions table with FK to issue_triage_state, thumbs_up/down counts, and observation tracking columns
- Standalone sync script polls GitHub reactions, filters to human thumbs, UPSERTs counts, and conditionally records threshold observations
- GitHub Actions workflow runs nightly at 3:30 AM UTC with proper secrets (no VOYAGE_API_KEY needed)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create migration 019 for triage_comment_reactions table** - `7167c8890b` (feat)
2. **Task 2: Create sync-triage-reactions.ts standalone script** - `d24a9a4709` (feat)
3. **Task 3: Create GitHub Actions nightly-reaction-sync workflow** - `9687649abf` (chore)

## Files Created/Modified
- `src/db/migrations/019-triage-comment-reactions.sql` - Creates triage_comment_reactions table with reaction counts and observation tracking
- `src/db/migrations/019-triage-comment-reactions.down.sql` - Rollback drops the table
- `scripts/sync-triage-reactions.ts` - Standalone nightly sync script polling GitHub reactions on triage comments
- `.github/workflows/nightly-reaction-sync.yml` - GitHub Actions cron workflow at 3:30 AM UTC

## Decisions Made
- Observation dedup via observation_recorded + observation_direction columns -- only re-records if direction flips (e.g., was thumbs up, now thumbs down)
- Closure signal takes precedence over reaction signal -- skips reaction observation when issue_outcome_feedback record exists
- kodiaiPredictedDuplicate always true for reaction observations because triage comments only exist when duplicates were predicted

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required. The nightly-reaction-sync workflow uses the same secrets (DATABASE_URL, GITHUB_APP_ID, GITHUB_PRIVATE_KEY) already configured for nightly-issue-sync.

## Next Phase Readiness
- Phase 114 reaction tracking foundation is complete
- v0.23 milestone is fully implemented (phases 110-114 all complete)
- Ready for UAT and milestone wrap-up

---
*Phase: 114-reaction-tracking*
*Completed: 2026-03-01*
