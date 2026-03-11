---
id: S03
parent: M020
milestone: M020
provides:
  - wiki_staleness_run_state DB table (migration 012)
  - AppConfig wiki env vars (slackWikiChannelId, wikiStalenessThresholdDays, wikiGithubOwner, wikiGithubRepo)
  - SlackClient.postStandaloneMessage() for top-level Slack messages with ts return
  - createWikiStalenessDetector factory with two-tier pipeline
  - heuristicScore function for token-overlap scoring
  - Slack report delivery (summary + thread replies)
  - WikiStalenessScheduler (start/stop/runScan)
  - Wiki staleness detector wired into application startup
  - @kodiai wiki-check on-demand trigger in Slack
  - Shutdown cleanup for staleness detector
requires: []
affects: []
key_files: []
key_decisions:
  - "All wiki config fields have defaults so startup never fails due to missing wiki env vars"
  - "postStandaloneMessage returns { ts } for thread-reply anchoring pattern"
  - "Inline report delivery in detector module rather than separate module"
  - "Top 5 pages inline in summary, remainder as thread replies"
  - "Fail-open on individual commit detail fetch and LLM evaluation failures"
  - "Guard detector instantiation on slackWikiChannelId being truthy"
  - "Use fire-and-forget with requestTracker.trackJob() for wiki-check trigger"
patterns_established:
  - "Standalone message pattern: post without thread_ts, return ts for subsequent thread replies"
  - "Two-tier pipeline: fast heuristic filter then LLM evaluation with cap"
  - "Recency-first sorting: sortableRecencyMs DESC primary, heuristicScore DESC secondary"
  - "Feature guard: only instantiate scheduler when channel ID is configured"
observability_surfaces: []
drill_down_paths: []
duration: 3min
verification_result: passed
completed_at: 2026-02-25
blocker_discovered: false
---
# S03: Wiki Staleness Detection

**# Plan 99-01: Foundation Summary**

## What Happened

# Plan 99-01: Foundation Summary

**DB migration 012 for wiki scan state, AppConfig wiki env vars, and SlackClient.postStandaloneMessage() for top-level report threading**

## Performance

- **Duration:** 5 min
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments
- Created migration 012 with wiki_staleness_run_state single-row table for scan window tracking
- Extended AppConfig with 4 wiki env vars (all with defaults, never required)
- Added postStandaloneMessage to SlackClient interface and implementation with ts return value
- Test for postStandaloneMessage passing (6/6 tests in client.test.ts)

## Task Commits

Each task was committed atomically:

1. **Task 99-01-A: DB migration 012** - `c1382dc074` (feat)
2. **Task 99-01-B: Config extension** - `7ec3ba27ba` (feat)
3. **Task 99-01-C: postStandaloneMessage** - `9e7ba66b76` (feat)

## Files Created/Modified
- `src/db/migrations/012-wiki-staleness-run-state.sql` - Single-row table for scan state tracking
- `src/config.ts` - Added slackWikiChannelId, wikiStalenessThresholdDays, wikiGithubOwner, wikiGithubRepo
- `src/slack/client.ts` - Added SlackStandaloneMessageInput interface and postStandaloneMessage method
- `src/slack/client.test.ts` - Added test for postStandaloneMessage returning ts

## Decisions Made
None - followed plan as specified

## Deviations from Plan
None - plan executed exactly as written

## Issues Encountered
None

## Next Phase Readiness
- Migration 012 ready for the staleness detector module (plan 99-02)
- Config fields available for wiring in index.ts (plan 99-03)
- postStandaloneMessage ready for report delivery in the detector

---
*Phase: 99-wiki-staleness-detection*
*Completed: 2026-02-25*

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

# Plan 99-03: Wiring Summary

**Wiki staleness detector wired into index.ts with conditional startup, shutdown cleanup, and @kodiai wiki-check on-demand Slack trigger**

## Performance

- **Duration:** 3 min
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Wired createWikiStalenessDetector into index.ts with all dependencies
- Conditional instantiation: only when SLACK_WIKI_CHANNEL_ID is configured
- Registered shutdown cleanup via _wikiStalenessDetectorRef
- Added @kodiai wiki-check intercept in onAllowedBootstrap (regex, fire-and-forget)
- Falls through to slackAssistantHandler when detector is null or text doesn't match

## Task Commits

Each task was committed atomically:

1. **Task 99-03-A: Wire detector + wiki-check trigger** - `517c6eb418` (feat)

## Files Created/Modified
- `src/index.ts` - Added imports, mutable ref, shutdown cleanup, detector instantiation, and wiki-check trigger

## Decisions Made
None - followed plan as specified

## Deviations from Plan
None - plan executed exactly as written

## Issues Encountered
None

## Next Phase Readiness
- Wiki staleness detection feature complete and ready for production
- All phase 99 requirements addressed

---
*Phase: 99-wiki-staleness-detection*
*Completed: 2026-02-25*
