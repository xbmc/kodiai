---
id: S07
parent: M001
milestone: M001
provides:
  - "Error classification into 5 user-facing categories (timeout, api_error, config_error, clone_error, internal_error)"
  - "Markdown error comment formatter with token redaction"
  - "postOrUpdateErrorComment() utility for GitHub comment posting (never throws)"
  - "AbortController-based timeout enforcement in executor"
  - "Configurable timeoutSeconds in .kodiai.yml (default 300, range 30-1800)"
  - "isTimeout field on ExecutionResult for downstream handler detection"
  - "Review handler with error comment posting on all failure paths"
  - "Mention handler with classified error reporting via shared errors module"
  - "No more silent failures in either handler"
requires: []
affects: []
key_files: []
key_decisions:
  - "API error patterns checked before clone patterns in classifyError to avoid 'rate limit' matching 'git'"
  - "postOrUpdateErrorComment never throws -- error reporting must not mask the original error (Pitfall 6)"
  - "AbortController + manual setTimeout used instead of AbortSignal.timeout() for clearTimeout on success (Pitfall 5)"
  - "timeoutId/controller/timeoutSeconds hoisted outside try block for catch block access"
  - "Review handler creates new error comments (no tracking comment) -- the review itself is the output"
  - "Mention handler passes trackingCommentId to postOrUpdateErrorComment for update-or-create behavior"
  - "Both handlers catch error comment posting failures separately so they never mask the original error"
patterns_established:
  - "Never-throw error reporting: postOrUpdateErrorComment catches all errors internally"
  - "Defense-in-depth token redaction: formatErrorComment always sanitizes detail strings"
  - "AbortController timeout: create outside try, clearTimeout on both success and catch paths"
  - "Error comment pattern: classifyError -> formatErrorComment -> postOrUpdateErrorComment on all failure paths"
  - "Defense-in-depth: outer catch wraps error comment posting in its own try/catch"
observability_surfaces: []
drill_down_paths: []
duration: 2min
verification_result: passed
completed_at: 2026-02-08
blocker_discovered: false
---
# S07: Operational Resilience

**# Phase 7 Plan 1: Error Classification and Timeout Summary**

## What Happened

# Phase 7 Plan 1: Error Classification and Timeout Summary

**Error classification into 5 categories with markdown formatting, token redaction, and AbortController-based executor timeout (default 300s, configurable via .kodiai.yml)**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-08T16:19:12Z
- **Completed:** 2026-02-08T16:22:54Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Error classification module with 5 categories mapping errors to user-friendly messages and actionable suggestions
- Defense-in-depth token redaction in error formatting via redactGitHubTokens
- AbortController-based timeout enforcement in executor with configurable duration (30-1800s, default 300)
- postOrUpdateErrorComment utility that never throws (Pitfall 6 compliance)
- 17 passing tests covering classification, formatting, and token redaction

## Task Commits

Each task was committed atomically:

1. **Task 1: Error classification module and config/type extensions** - `9f43e58` (feat)
2. **Task 2: AbortController-based timeout in executor** - `1492e52` (feat)

## Files Created/Modified
- `src/lib/errors.ts` - Error classification, formatting, and comment posting utility (classifyError, formatErrorComment, postOrUpdateErrorComment)
- `src/lib/errors.test.ts` - 17 tests for error classification and formatting with token redaction
- `src/execution/types.ts` - Added `isTimeout?: boolean` to ExecutionResult
- `src/execution/config.ts` - Added `timeoutSeconds` (default 300, min 30, max 1800) to repoConfigSchema
- `src/execution/executor.ts` - AbortController timeout enforcement with clearTimeout on both paths

## Decisions Made
- [07-01]: API error patterns checked before clone patterns in classifyError -- "rate limit" contains "git" which would incorrectly match clone_error
- [07-01]: postOrUpdateErrorComment never throws -- error reporting must not mask original error (research Pitfall 6)
- [07-01]: Manual setTimeout + AbortController used instead of AbortSignal.timeout() to allow clearTimeout on success (research Pitfall 5)
- [07-01]: timeoutId, controller, and timeoutSeconds hoisted outside try block with let declarations for catch block access

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed classifyError pattern ordering**
- **Found during:** Task 1 (error classification tests)
- **Issue:** "rate limit" message matched clone_error before api_error because "git" appears in "GitHub rate limit"
- **Fix:** Reordered classifyError to check API error patterns (rate limit, API, status codes) before clone patterns (clone, git)
- **Files modified:** src/lib/errors.ts
- **Verification:** All 17 tests pass including "rate limit" -> api_error
- **Committed in:** 9f43e58 (part of Task 1 commit)

**2. [Rule 1 - Bug] Fixed variable scoping for catch block access**
- **Found during:** Task 2 (executor timeout)
- **Issue:** timeoutId, controller, and config.timeoutSeconds were declared inside try block but needed in catch for cleanup and timeout detection
- **Fix:** Hoisted timeoutId, controller, and timeoutSeconds as let declarations before try block
- **Files modified:** src/execution/executor.ts
- **Verification:** Compiles without errors, both success and catch paths access variables correctly
- **Committed in:** 1492e52 (part of Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both fixes essential for correctness. No scope creep.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Error classification and formatting module ready for Plan 02 to wire into handlers
- Executor timeout enforcement active -- handlers will receive `isTimeout: true` on timeout
- postOrUpdateErrorComment ready for handlers to call on any error path
- Config `timeoutSeconds` available for users to customize in `.kodiai.yml`

---
*Phase: 07-operational-resilience*
*Completed: 2026-02-08*

# Phase 7 Plan 2: Error Reporting Wiring Summary

**Wired classified error comments into review and mention handlers so every failure path posts an actionable user-visible message**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-08T16:27:29Z
- **Completed:** 2026-02-08T16:29:42Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Review handler now posts classified error comments on PR for execution errors, timeouts, clone failures, and unhandled exceptions
- Mention handler replaced hardcoded `trackingError` function with shared `formatErrorComment` from errors module
- Removed "Something went wrong" generic message, replaced with category-specific headers and actionable suggestions
- Both handlers handle failed error comment posting gracefully (catch, log, never mask original error)

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire error reporting into review handler** - `47c3594` (feat)
2. **Task 2: Upgrade mention handler error reporting** - `bd35d66` (feat)

**Plan metadata:** (pending)

## Files Created/Modified
- `src/handlers/review.ts` - Added error imports, executor error path posting, outer catch error comment posting
- `src/handlers/mention.ts` - Replaced trackingError with shared errors module, upgraded both error paths

## Decisions Made
- Review handler does NOT use a tracking comment -- per research, the review itself is the output; only post a comment when something goes wrong
- Mention handler passes `trackingCommentId` through to `postOrUpdateErrorComment` so it updates the existing tracking comment (or creates a new one if tracking comment creation failed)
- Error comment posting failures are caught in their own try/catch blocks to prevent masking the original error (Pitfall 6 from research)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 7 (Operational Resilience) is now complete
- All error paths in both handlers post user-visible, actionable error comments
- Ready for Phase 8 (Deployment) -- Docker packaging and Azure Container Apps
- Blockers for Phase 8: Azure Container Apps not yet provisioned, Claude CLI on Alpine untested

## Self-Check: PASSED

- FOUND: src/handlers/review.ts
- FOUND: src/handlers/mention.ts
- FOUND: commit 47c3594 (Task 1)
- FOUND: commit bd35d66 (Task 2)

---
*Phase: 07-operational-resilience*
*Completed: 2026-02-08*
