---
phase: 99-wiki-staleness-detection
plan: 02
subsystem: knowledge
tags: [staleness, heuristic, llm, github, slack, wiki]

requires:
  - phase: 99-wiki-staleness-detection
    provides: migration 012 (wiki_staleness_run_state), AppConfig wiki env vars, SlackClient.postStandaloneMessage
provides:
  - createWikiStalenessDetector factory with two-tier pipeline
  - heuristicScore function for token-overlap scoring
  - Slack report delivery (summary + thread replies)
  - WikiStalenessScheduler (start/stop/runScan)
affects: [99-03, index-wiring, wiki-staleness-scheduling]

requirements-completed: [WIKI-01, WIKI-02, WIKI-05]

tech-stack:
  added: []
  patterns: [two-tier-heuristic-llm-pipeline, recency-first-sorting, cap-and-defer]

key-files:
  created:
    - src/knowledge/wiki-staleness-types.ts
    - src/knowledge/wiki-staleness-detector.ts
    - src/knowledge/wiki-staleness-detector.test.ts
  modified: []

key-decisions:
  - "Inline report delivery in detector module rather than separate module"
  - "Top 5 pages inline in summary, remainder as thread replies"
  - "Fail-open on individual commit detail fetch and LLM evaluation failures"

patterns-established:
  - "Two-tier pipeline: fast heuristic filter then LLM evaluation with cap"
  - "Recency-first sorting: sortableRecencyMs DESC primary, heuristicScore DESC secondary"

requirements-completed: [WIKI-01, WIKI-02, WIKI-05]

duration: 8min
completed: 2026-02-25
---

# Plan 99-02: Core Staleness Detector Summary

**Two-tier wiki staleness pipeline: heuristic token-overlap scoring + LLM evaluation (cap 20) with Slack report delivery (top 5 inline, rest threaded)**

## Performance

- **Duration:** 8 min
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments
- Created complete type system for wiki staleness detection (candidates, stale pages, scan results, run state)
- Implemented createWikiStalenessDetector with GitHub commit fetching, heuristic pass, LLM evaluation, and Slack delivery
- Heuristic scoring exported for testability; sorts by recency-first then score
- 7/7 unit tests passing (heuristic scoring edge cases + pipeline skip behavior)

## Task Commits

Each task was committed atomically:

1. **Task 99-02-A: Wiki staleness types** - `0d69c5b4c8` (feat)
2. **Task 99-02-B: Core detector module** - `854270d248` (feat)
3. **Task 99-02-C: Unit tests** - `9519cc3d13` (test)

## Files Created/Modified
- `src/knowledge/wiki-staleness-types.ts` - All type definitions for the staleness system
- `src/knowledge/wiki-staleness-detector.ts` - Main detector module with factory, helpers, Slack delivery
- `src/knowledge/wiki-staleness-detector.test.ts` - Unit tests for heuristic scoring and scan behavior

## Decisions Made
- Implemented Slack report delivery inline in the detector module rather than deferring to plan 99-03
- Used in-memory chunk grouping (fetch up to 5000 rows, group by page_id) for simplicity

## Deviations from Plan
None - plan executed exactly as written

## Issues Encountered
None

## Next Phase Readiness
- Detector module ready to be wired into index.ts (plan 99-03)
- All types, factory, and scheduler interface ready for integration

---
*Phase: 99-wiki-staleness-detection*
*Completed: 2026-02-25*
