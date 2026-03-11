---
id: S04
parent: M010
milestone: M010
provides:
  - Partial review disclaimer formatter for timeout + retry outcomes
  - Adaptive retry scope computation excluding already-reviewed files
  - Telemetry chronic timeout query per repo+author (7-day window)
  - KnowledgeStore checkpoint persistence keyed by reviewOutputKey
  - MCP tool to save partial review progress during execution
  - Timeout resilience path that publishes partial reviews and retries once with reduced scope
  - Conditional checkpoint tool wiring and prompt instruction for medium/high timeout risk
  - Chronic timeout skip behavior with guidance to split large PRs
requires: []
affects: []
key_files: []
key_decisions:
  - "None - followed plan as specified"
  - "None - followed plan as specified"
  - "Enable checkpoint MCP tool only when timeout risk is medium/high"
  - "Cap retries at exactly one attempt (-retry-1)"
patterns_established:
  - "Partial review disclaimers are blockquoted and prepend the draft body"
  - "Retry scope ratio adapts from 50%..100% of remaining based on reviewed fraction"
  - "Store checkpoint payload as JSON in sqlite with partial_comment_id as a separate column"
  - "Expose KnowledgeStore checkpoint methods as optional to preserve existing test mocks"
  - "Timeout with partial results publishes a partial summary comment and (optionally) queues a reduced-scope retry"
  - "Retry merges by editing the partial comment instead of posting a new one"
observability_surfaces: []
drill_down_paths: []
duration: 9min
verification_result: passed
completed_at: 2026-02-15
blocker_discovered: false
---
# S04: Resilience Layer

**# Phase 59 Plan 02: Partial Formatter + Retry Scope + Chronic Timeout Telemetry Summary**

## What Happened

# Phase 59 Plan 02: Partial Formatter + Retry Scope + Chronic Timeout Telemetry Summary

**Pure-function building blocks for timeout resilience: partial review disclaimers, adaptive retry scope reduction, and repo+author chronic timeout detection.**

## Performance

- **Duration:** 1 min
- **Started:** 2026-02-15T23:48:24Z
- **Completed:** 2026-02-15T23:49:19Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Added `formatPartialReviewComment()` for consistent partial review disclaimers (timeout, retry result, retry skipped)
- Added `computeRetryScope()` to select a reduced retry file set based on risk and reviewed fraction
- Extended telemetry to store PR author and query recent timeouts per repo+author (7 days)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create partial review formatter and retry scope reducer with tests** - `af003c5cfc` (feat)
2. **Task 2: Add pr_author column and countRecentTimeouts to telemetry store** - `4d7e44a407` (feat)

## Files Created/Modified
- `src/lib/partial-review-formatter.ts` - Formats partial review disclaimer header and body
- `src/lib/partial-review-formatter.test.ts` - Verifies disclaimer formatting across timeout/retry/skipped cases
- `src/lib/retry-scope-reducer.ts` - Computes reduced retry scope excluding already-reviewed files
- `src/lib/retry-scope-reducer.test.ts` - Verifies exclusion, sorting, and adaptive scope ratio behavior
- `src/telemetry/types.ts` - Adds `prAuthor` field and optional `countRecentTimeouts` method
- `src/telemetry/store.ts` - Adds `pr_author` column migration, records author, and implements `countRecentTimeouts`

## Decisions Made
None - followed plan as specified.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Handler integration can now format partial comments, compute retry file lists, and skip retry when chronic timeouts are detected

## Self-Check: PASSED
- Confirmed summary file exists on disk
- Confirmed task commits `af003c5cfc` and `4d7e44a407` exist in git history

---
*Phase: 59-resilience-layer*
*Completed: 2026-02-15*

# Phase 59 Plan 01: Checkpoint Accumulation Summary

**SQLite-backed review checkpoint persistence plus an MCP tool (save_review_checkpoint) to record partial progress during reviews.**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-15T23:42:07Z
- **Completed:** 2026-02-15T23:43:36Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Added `review_checkpoints` sqlite table and CRUD methods on `KnowledgeStore`
- Implemented upsert semantics for checkpoints keyed by `reviewOutputKey`
- Added `review_checkpoint` MCP server exposing `save_review_checkpoint` with tests and graceful degradation

## Task Commits

Each task was committed atomically:

1. **Task 1: Add checkpoint schema and CRUD methods to knowledge store** - `555e892e9e` (feat)
2. **Task 2: Create checkpoint MCP server with tests** - `c3f3df0516` (feat)

## Files Created/Modified
- `src/knowledge/types.ts` - Add `CheckpointRecord` and optional checkpoint CRUD methods on `KnowledgeStore`
- `src/knowledge/store.ts` - Create `review_checkpoints` table and implement save/get/delete/updateCommentId
- `src/execution/mcp/checkpoint-server.ts` - MCP server providing `save_review_checkpoint` tool
- `src/execution/mcp/checkpoint-server.test.ts` - Unit tests for checkpoint server tool handler

## Decisions Made
None - followed plan as specified.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Checkpoint persistence and MCP reporting are available for wiring into the review handler timeout path
- Ready to build partial review publishing + retry scope reduction logic on top of stored checkpoints

## Self-Check: PASSED
- Confirmed summary file exists on disk
- Confirmed task commits `555e892e9e` and `c3f3df0516` exist in git history

---
*Phase: 59-resilience-layer*
*Completed: 2026-02-15*

# Phase 59 Plan 03: Timeout Resilience Integration Summary

**On review timeout, Kodiai now publishes a partial review with a clear disclaimer and silently queues a single reduced-scope retry (skipped for chronic repo+author timeouts).**

## Performance

- **Duration:** 9 min
- **Started:** 2026-02-15T23:52:02Z
- **Completed:** 2026-02-16T00:00:25Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Wired `review_checkpoint` MCP server into the executor MCP builder behind `enableCheckpointTool`
- Added prompt-level instruction to call `save_review_checkpoint` only when checkpointing is enabled
- Replaced timeout error comment path with partial-review publishing + one-shot reduced-scope retry + merged comment edit
- Added chronic timeout gating (3+ timeouts in 7 days per repo+author) to skip retry with splitting guidance
- Recorded `pr_author` in telemetry for both primary and retry executions

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire checkpoint MCP server into executor and add prompt instruction** - `980d1f8ba3` (feat)
2. **Task 2: Implement timeout resilience path in review handler** - `b309f11e15` (feat)

## Files Created/Modified
- `src/execution/mcp/index.ts` - Conditionally adds `review_checkpoint` MCP server when enabled
- `src/execution/review-prompt.ts` - Adds checkpoint tool instructions when `checkpointEnabled === true`
- `src/handlers/review.ts` - Publishes partial reviews on timeout, enqueues one retry, merges via comment edit, and uses chronic timeout detection
- `src/execution/executor.ts` - Plumbs checkpoint tool deps and preserves `published` on timeout (needed for timeout_partial semantics)
- `src/execution/types.ts` - Adds optional execution fields for checkpoint + MCP tool-surface overrides

## Decisions Made
- Enable checkpoint tool only for medium/high timeout risk reviews (keeps tool surface small on low-risk reviews)
- Retry is always capped to exactly one attempt and uses a distinct `reviewOutputKey` suffix `-retry-1`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Preserved `published` flag on timeout results**
- **Found during:** Task 2 (timeout partial result detection)
- **Issue:** `executor.execute()` always returned `published: false` on timeout, making `timeout_partial` and partial-result publishing unreachable
- **Fix:** Hoisted `published` state and returned it for timeout/error outcomes
- **Files modified:** `src/execution/executor.ts`
- **Verification:** `bun test` and `bunx tsc --noEmit`
- **Committed in:** `b309f11e15` (Task 2 commit)

**2. [Rule 3 - Blocking] Added ExecutionContext plumbing for checkpoint + tool toggles**
- **Found during:** Task 2 (executor needs handler-provided enablement + knowledge store)
- **Issue:** Review handler could not pass checkpoint enablement/KnowledgeStore into `buildMcpServers()` (called inside executor)
- **Fix:** Added optional fields to `ExecutionContext` and forwarded into `buildMcpServers()`
- **Files modified:** `src/execution/types.ts`, `src/execution/executor.ts`
- **Verification:** `bun test` and `bunx tsc --noEmit`
- **Committed in:** `b309f11e15` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** Both changes were necessary to make the planned integration path work and to correctly detect partial publications.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- End-to-end timeout resilience path is wired and guarded (checkpoint tool only on medium/high risk; retry skips chronic timeouts)
- Ready for verification against real-world timeout scenarios (large PRs, fork PRs, and retry outcomes)

## Self-Check: PASSED
- Confirmed summary file exists on disk
- Confirmed task commits `980d1f8ba3` and `b309f11e15` exist in git history

---
*Phase: 59-resilience-layer*
*Completed: 2026-02-15*
