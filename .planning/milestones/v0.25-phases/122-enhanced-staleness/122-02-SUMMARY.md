---
phase: 122-enhanced-staleness
plan: 02
subsystem: knowledge
tags: [github-api, wiki-staleness, pr-pipeline, llm-evaluation, backfill]

# Dependency graph
requires:
  - phase: 122-enhanced-staleness plan 01
    provides: wiki_pr_evidence table, MergedPR/PREvidence types, fetchMergedPRs, storePREvidence, enhanced heuristicScore
provides:
  - PR-based staleness pipeline replacing commit-based pipeline in runScan
  - LLM evaluation with actual diff patches from stored PR evidence
  - 90-day PR evidence backfill script
  - Updated types with affectingPRNumbers, prNumber, lastMergedAt
affects: [123-wiki-update-suggestions]

# Tech tracking
tech-stack:
  added: []
  patterns: [pr-based-scan-window, diff-patch-grounded-llm-evaluation, rate-limited-backfill]

key-files:
  created:
    - scripts/backfill-pr-evidence.ts
  modified:
    - src/knowledge/wiki-staleness-types.ts
    - src/knowledge/wiki-staleness-detector.ts
    - src/knowledge/wiki-staleness-detector.test.ts

key-decisions:
  - "affectingCommitShas kept as empty array for backward compat during transition"
  - "Patch content capped at 3000 chars in LLM prompt to avoid token bloat"
  - "lastMergedAt stored as in-memory field derived from lastRunAt (no new DB column needed)"

patterns-established:
  - "PR evidence grounding: LLM staleness evaluation receives actual diff patches alongside file paths"
  - "Rate-limited backfill: 300ms delay between GitHub listFiles calls for secondary rate limit compliance"

requirements-completed: [STALE-01, STALE-02, STALE-03, STALE-04]

# Metrics
duration: 4min
completed: 2026-03-05
---

# Phase 122 Plan 02: PR Pipeline Integration Summary

**PR-based staleness pipeline with diff-grounded LLM evaluation, replacing commit-based scanning with merged-PR scanning and 90-day backfill script**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-05T02:22:55Z
- **Completed:** 2026-03-05T02:27:13Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Replaced commit-based fetchChangedFiles with PR-based fetchMergedPRs in runScan
- heuristicPass now stores PR evidence during matching via storePREvidence for all matched file/page combinations
- evaluateWithLlm queries wiki_pr_evidence table and includes actual diff patches (capped at 3000 chars) in the LLM prompt
- Created backfill-pr-evidence.ts script with 90-day default window, wiki page preloading, rate-limited PR fetching, and progress logging

## Task Commits

Each task was committed atomically:

1. **Task 1: Update types and wire PR-based pipeline into runScan** - `3d776883de` (feat)
2. **Task 2: Update tests and create backfill script** - `56045a9032` (feat)

## Files Created/Modified
- `src/knowledge/wiki-staleness-types.ts` - Added affectingPRNumbers to WikiPageCandidate, prNumber to StalePage, lastMergedAt to RunState
- `src/knowledge/wiki-staleness-detector.ts` - Replaced fetchChangedFiles with fetchMergedPRs, updated heuristicPass for MergedPR[], added patch evidence to LLM prompt
- `src/knowledge/wiki-staleness-detector.test.ts` - Updated mocks for PR-based API (rest.pulls.list/listFiles), renamed test description
- `scripts/backfill-pr-evidence.ts` - Standalone 90-day PR evidence backfill with rate limiting and progress logging

## Decisions Made
- Kept affectingCommitShas as empty array on candidates for backward compatibility during transition
- Capped patch content at 3000 characters in LLM prompt to prevent token bloat while still providing meaningful diff context
- lastMergedAt field derived from lastRunAt on load (no new DB column needed since last_run_at serves as primary cursor)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 122 complete: full PR-based staleness pipeline is wired and operational
- Backfill script ready to populate initial 90-day evidence window via `bun scripts/backfill-pr-evidence.ts`
- Phase 123 can use StalePage.prNumber for PR citations in wiki update suggestions

---
*Phase: 122-enhanced-staleness*
*Completed: 2026-03-05*
