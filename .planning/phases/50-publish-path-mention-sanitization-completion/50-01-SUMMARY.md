---
phase: 50-publish-path-mention-sanitization-completion
plan: 01
subsystem: execution
tags: [sanitization, mentions, mcp, defense-in-depth, self-trigger-prevention]

# Dependency graph
requires:
  - phase: 46-conversational-intelligence
    provides: sanitizeOutgoingMentions function in sanitizer.ts
provides:
  - botHandles field on ExecutionContext threaded to all MCP server constructors
  - sanitizeOutgoingMentions applied at every outbound GitHub comment/review publish point
affects: [review-handler, mention-handler, mcp-servers]

# Tech tracking
tech-stack:
  added: []
  patterns: [defense-in-depth mention sanitization at publish boundary]

key-files:
  created: []
  modified:
    - src/execution/types.ts
    - src/execution/executor.ts
    - src/execution/mcp/index.ts
    - src/execution/mcp/comment-server.ts
    - src/execution/mcp/inline-review-server.ts
    - src/execution/mcp/review-comment-thread-server.ts
    - src/handlers/mention.ts
    - src/handlers/review.ts

key-decisions:
  - "Use githubApp.getAppSlug() at review handler call sites instead of caching appSlug (synchronous, always in scope)"
  - "Sanitize at the utility function level (upsertReviewDetailsComment, appendReviewDetailsToSummary) rather than at every call site for DRY coverage"

patterns-established:
  - "All outbound GitHub publish paths must apply sanitizeOutgoingMentions before Octokit calls"

# Metrics
duration: 6min
completed: 2026-02-14
---

# Phase 50 Plan 01: Publish Path Mention Sanitization Summary

**Defense-in-depth sanitizeOutgoingMentions applied at all 12 outbound GitHub publish points across MCP servers (5) and review handler (7), with botHandles threaded from handlers through ExecutionContext**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-14T20:16:32Z
- **Completed:** 2026-02-14T20:23:05Z
- **Tasks:** 2
- **Files modified:** 11

## Accomplishments
- Added `botHandles` field to `ExecutionContext` and threaded it from mention/review handlers through executor to all three MCP server constructors
- Applied `sanitizeOutgoingMentions` at all 5 MCP server publish points (update_comment, create_comment, approval create_review, create_inline_comment, reply_to_pr_review_comment)
- Applied `sanitizeOutgoingMentions` at all 7 review handler direct Octokit publish points ([no-review] skip, cost warning, 2 error comments, auto-approval, upsertReviewDetailsComment, appendReviewDetailsToSummary)

## Task Commits

Each task was committed atomically:

1. **Task 1: Thread botHandles through ExecutionContext to MCP servers** - `65813b5d1d` (feat)
2. **Task 2: Apply sanitizeOutgoingMentions to review handler publish paths** - `2b22a7290c` (feat)

## Files Created/Modified
- `src/execution/types.ts` - Added botHandles field to ExecutionContext
- `src/execution/executor.ts` - Threads botHandles from context to buildMcpServers
- `src/execution/mcp/index.ts` - Accepts botHandles and passes to all server constructors
- `src/execution/mcp/comment-server.ts` - Sanitizes update_comment, create_comment, and approval review body
- `src/execution/mcp/inline-review-server.ts` - Sanitizes create_inline_comment body
- `src/execution/mcp/review-comment-thread-server.ts` - Sanitizes reply_to_pr_review_comment body
- `src/handlers/mention.ts` - Passes possibleHandles as botHandles in execute context
- `src/handlers/review.ts` - Import sanitizeOutgoingMentions, apply at all 7 direct Octokit publish points
- `src/execution/mcp/comment-server.test.ts` - Updated for new botHandles parameter
- `src/execution/mcp/inline-review-server.test.ts` - Updated for new botHandles parameter
- `src/execution/mcp/review-comment-thread-server.test.ts` - Updated for new botHandles parameter

## Decisions Made
- Used `githubApp.getAppSlug()` (synchronous) at review handler call sites instead of caching in a variable, since `appSlug` from the review_requested gate check was not in scope at the job callback
- Applied sanitization inside utility functions (upsertReviewDetailsComment, appendReviewDetailsToSummary) by adding a botHandles parameter, keeping call sites clean

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed appSlug not in scope at review handler execute call**
- **Found during:** Task 1 (threading botHandles)
- **Issue:** Plan assumed `appSlug` was in scope at the executor.execute() call in review.ts, but it was only defined inside the `review_requested` conditional block
- **Fix:** Used `githubApp.getAppSlug()` directly instead of referencing the `appSlug` variable
- **Files modified:** src/handlers/review.ts
- **Verification:** TypeScript compiles cleanly
- **Committed in:** 65813b5d1d (Task 1 commit)

**2. [Rule 3 - Blocking] Updated test files for new botHandles parameter**
- **Found during:** Task 1 (after adding botHandles parameter)
- **Issue:** Existing tests for comment-server, inline-review-server, and review-comment-thread-server did not pass the new required botHandles parameter
- **Fix:** Added `[]` (empty array) as botHandles argument to all test constructor calls
- **Files modified:** comment-server.test.ts, inline-review-server.test.ts, review-comment-thread-server.test.ts
- **Verification:** All 730 tests pass
- **Committed in:** 65813b5d1d (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** Both fixes necessary for correctness and compilation. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All outbound GitHub comment/review publish paths now protected by sanitizeOutgoingMentions
- Ready for Phase 50 Plan 02 (testing/verification)

---
*Phase: 50-publish-path-mention-sanitization-completion*
*Completed: 2026-02-14*
