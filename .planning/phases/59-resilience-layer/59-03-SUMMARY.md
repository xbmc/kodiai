---
phase: 59-resilience-layer
plan: 03
subsystem: review-handler
tags: [timeout, partial-review, retry, checkpoint, mcp]

# Dependency graph
requires:
  - phase: 59-resilience-layer
    provides: KnowledgeStore review checkpoints and review_checkpoint MCP tool
  - phase: 59-resilience-layer
    provides: Partial review formatter, retry scope reducer, telemetry chronic timeout query
provides:
  - Timeout resilience path that publishes partial reviews and retries once with reduced scope
  - Conditional checkpoint tool wiring and prompt instruction for medium/high timeout risk
  - Chronic timeout skip behavior with guidance to split large PRs
affects: [executor, telemetry, knowledge-store, job-queue]

# Tech tracking
tech-stack:
  added: []
  patterns: [buffer-and-flush on timeout, fire-and-forget retry enqueue, edit partial comment to merge retry]

key-files:
  created: []
  modified:
    - src/handlers/review.ts
    - src/execution/mcp/index.ts
    - src/execution/review-prompt.ts
    - src/execution/executor.ts
    - src/execution/types.ts

key-decisions:
  - "Enable checkpoint MCP tool only when timeout risk is medium/high"
  - "Cap retries at exactly one attempt (-retry-1)"

patterns-established:
  - "Timeout with partial results publishes a partial summary comment and (optionally) queues a reduced-scope retry"
  - "Retry merges by editing the partial comment instead of posting a new one"

# Metrics
duration: 9min
completed: 2026-02-15
---

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
