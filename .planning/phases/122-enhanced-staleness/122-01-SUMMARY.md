---
phase: 122-enhanced-staleness
plan: 01
subsystem: knowledge
tags: [postgres, github-api, wiki-staleness, heuristic-scoring, mediawiki]

# Dependency graph
requires:
  - phase: 108-pr-link
    provides: parseIssueReferences utility for PR body extraction
provides:
  - wiki_pr_evidence table schema with indexes
  - MergedPR and PREvidence types
  - Enhanced heuristicScore with domain stopwords and heading weights
  - fetchMergedPRs function for PR fetching with file details
  - storePREvidence function for evidence persistence with upsert
affects: [122-enhanced-staleness plan 02 pipeline integration]

# Tech tracking
tech-stack:
  added: []
  patterns: [domain-stopword-filtering, mediawiki-heading-weighting, pr-evidence-upsert]

key-files:
  created:
    - src/db/migrations/022-wiki-pr-evidence.sql
    - src/db/migrations/022-wiki-pr-evidence.down.sql
  modified:
    - src/knowledge/wiki-staleness-types.ts
    - src/knowledge/wiki-staleness-detector.ts
    - src/knowledge/wiki-staleness-detector.test.ts

key-decisions:
  - "parseIssueReferences called with {prBody, commitMessages} object signature (actual API) not (text, source) as plan assumed"
  - "Stopwords filtered from both chunk tokens AND path tokens to prevent any contribution from ubiquitous domain terms"
  - "Heading tokens take priority: if a token appears in both heading and body, heading weight (3x) applies"

patterns-established:
  - "Domain stopword set for Kodi wiki<->code matching quality"
  - "MediaWiki heading regex for section-aware scoring"

requirements-completed: [STALE-01, STALE-03, STALE-04]

# Metrics
duration: 3min
completed: 2026-03-05
---

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
