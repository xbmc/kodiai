---
id: S03
parent: M025
milestone: M025
provides:
  - wiki_pr_evidence table schema with indexes
  - MergedPR and PREvidence types
  - Enhanced heuristicScore with domain stopwords and heading weights
  - fetchMergedPRs function for PR fetching with file details
  - storePREvidence function for evidence persistence with upsert
  - PR-based staleness pipeline replacing commit-based pipeline in runScan
  - LLM evaluation with actual diff patches from stored PR evidence
  - 90-day PR evidence backfill script
  - Updated types with affectingPRNumbers, prNumber, lastMergedAt
requires: []
affects: []
key_files: []
key_decisions:
  - "parseIssueReferences called with {prBody, commitMessages} object signature (actual API) not (text, source) as plan assumed"
  - "Stopwords filtered from both chunk tokens AND path tokens to prevent any contribution from ubiquitous domain terms"
  - "Heading tokens take priority: if a token appears in both heading and body, heading weight (3x) applies"
  - "affectingCommitShas kept as empty array for backward compat during transition"
  - "Patch content capped at 3000 chars in LLM prompt to avoid token bloat"
  - "lastMergedAt stored as in-memory field derived from lastRunAt (no new DB column needed)"
patterns_established:
  - "Domain stopword set for Kodi wiki<->code matching quality"
  - "MediaWiki heading regex for section-aware scoring"
  - "PR evidence grounding: LLM staleness evaluation receives actual diff patches alongside file paths"
  - "Rate-limited backfill: 300ms delay between GitHub listFiles calls for secondary rate limit compliance"
observability_surfaces: []
drill_down_paths: []
duration: 4min
verification_result: passed
completed_at: 2026-03-05
blocker_discovered: false
---
# S03: Enhanced Staleness

**# Phase 122 Plan 01: PR Evidence Data Layer Summary**

## What Happened

# Phase 122 Plan 01: PR Evidence Data Layer Summary

**PR evidence table schema, enhanced heuristic scoring with domain stopwords and 3x heading weights, plus PR fetching and evidence persistence functions**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-05T02:17:30Z
- **Completed:** 2026-03-05T02:20:34Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments
- Migration 022 creates wiki_pr_evidence with composite unique constraint (pr_number, file_path, matched_page_id) and 3 indexes
- heuristicScore enhanced to filter 20 domain stopwords and weight MediaWiki heading tokens 3x
- fetchMergedPRs paginates GitHub pulls.list with listFiles enrichment and fail-open error handling
- storePREvidence persists evidence rows with ON CONFLICT upsert and parseIssueReferences extraction

## Task Commits

Each task was committed atomically:

1. **Task 1: Create PR evidence migration and extend staleness types** - `8cb16281aa` (feat)
2. **Task 2: Enhance heuristicScore with domain stopwords and section-heading weighting** - `d58ad8ccf0` (test/RED), `aa736bf76b` (feat/GREEN)
3. **Task 3: Build fetchMergedPRs and storePREvidence functions** - `f0313fee36` (feat)

## Files Created/Modified
- `src/db/migrations/022-wiki-pr-evidence.sql` - PR evidence table with columns, indexes, composite unique
- `src/db/migrations/022-wiki-pr-evidence.down.sql` - Rollback migration
- `src/knowledge/wiki-staleness-types.ts` - Added MergedPR and PREvidence exported types
- `src/knowledge/wiki-staleness-detector.ts` - DOMAIN_STOPWORDS, enhanced heuristicScore, fetchMergedPRs, storePREvidence
- `src/knowledge/wiki-staleness-detector.test.ts` - Added stopword/heading tests, updated existing tests for stopword compat

## Decisions Made
- parseIssueReferences uses actual `{prBody, commitMessages}` object signature, not the `(text, source)` form the plan assumed
- Heading tokens take priority over body tokens when a token appears in both contexts
- Stopwords filtered from both chunk and path token sets to fully prevent false positive contribution

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected parseIssueReferences call signature**
- **Found during:** Task 3 (storePREvidence implementation)
- **Issue:** Plan assumed `parseIssueReferences(text, source)` signature but actual API is `parseIssueReferences({prBody, commitMessages})`
- **Fix:** Used correct object-based signature `parseIssueReferences({ prBody: pr.body ?? "", commitMessages: [] })`
- **Files modified:** src/knowledge/wiki-staleness-detector.ts
- **Verification:** TypeScript compilation succeeds, tests pass
- **Committed in:** f0313fee36 (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Essential correctness fix for matching actual API. No scope creep.

## Issues Encountered
- Existing test "scores positively when file path tokens appear in chunk text" used tokens (audio, player) that became stopwords -- updated test to use non-stopword tokens (playback, settings)
- Existing test "scores multiple overlapping tokens" used stopword tokens (video, player) -- updated to use (rendering, pipeline, codec)

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Migration 022, types, enhanced heuristic, and PR functions all ready for Plan 02 pipeline integration
- fetchMergedPRs and storePREvidence are internal functions awaiting wiring into runScan

## Self-Check: PASSED

All 6 files verified present. All 4 commits verified in git log.

---
*Phase: 122-enhanced-staleness*
*Completed: 2026-03-05*

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
