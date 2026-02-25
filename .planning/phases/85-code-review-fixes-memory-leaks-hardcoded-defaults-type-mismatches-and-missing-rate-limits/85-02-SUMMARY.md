---
phase: 85-code-review-fixes-memory-leaks-hardcoded-defaults-type-mismatches-and-missing-rate-limits
plan: 02
subsystem: api
tags: [slack, telemetry, type-safety, rate-limiting, config]

requires:
  - phase: quick-6
    provides: code review findings C-1, H-4, H-5, H-8, H-10, M-2
provides:
  - Config-driven default repo via SLACK_DEFAULT_REPO env var
  - Structured logging in enforcement tooling detection
  - Typed GitHub Advisory/Release/Content API interfaces
  - Optimized telemetry purge without RETURNING clause
  - Slack client request timeout (10s default)
  - Per-channel sliding window rate limiter on Slack events
affects: [slack, enforcement, telemetry, dep-bump-enrichment]

tech-stack:
  added: []
  patterns:
    - "Config-driven defaults pattern: hardcoded values moved to env-backed config schema"
    - "Sliding window rate limiter: inline Map-based per-key with lazy cleanup"

key-files:
  created: []
  modified:
    - src/slack/repo-context.ts
    - src/config.ts
    - src/enforcement/tooling-detection.ts
    - src/enforcement/index.ts
    - src/slack/assistant-handler.ts
    - src/index.ts
    - src/lib/dep-bump-enrichment.ts
    - src/telemetry/store.ts
    - src/slack/client.ts
    - src/routes/slack-events.ts

key-decisions:
  - "Tooling detection logger parameter is optional to maintain backward compatibility with existing callers and tests"
  - "defaultRepo is a required dep in SlackAssistantHandlerDeps rather than optional, forcing explicit configuration"
  - "Rate limiter uses inline Map rather than external dependency for simplicity"

patterns-established:
  - "Config-driven defaults: Move hardcoded values to config.ts with env var backing and sensible defaults"

requirements-completed: []

duration: 6min
completed: 2026-02-20
---

# Phase 85 Plan 02: Hardcoded Defaults, Type Safety, Telemetry Purge, Slack Timeout, and Rate Limiting Summary

**Config-driven default repo, typed Octokit calls, efficient telemetry purge, 10s Slack timeout, and per-channel rate limiting (30/60s)**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-20T03:29:29Z
- **Completed:** 2026-02-20T03:35:29Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- Removed hardcoded DEFAULT_REPO constant; default repo now configurable via SLACK_DEFAULT_REPO env var (C-1)
- Replaced console.warn with structured logger in tooling detection (H-4)
- Added typed interfaces for GitHub Advisory, Release, and Content API responses, eliminating most `as any` casts (H-5)
- Optimized telemetry purge to use DELETE + changes() instead of RETURNING id (H-8)
- Added configurable request timeout (10s default) to all Slack client fetch calls (M-2)
- Added per-channel sliding window rate limiter (30 events / 60 seconds) on Slack event processing (H-10)

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix hardcoded default repo and structured logging** - `f3d26f205e` (fix)
2. **Task 2: Fix type safety, telemetry purge, Slack timeout, and rate limiting** - `371036c4f0` (fix)

## Files Created/Modified
- `src/config.ts` - Added slackDefaultRepo config field with SLACK_DEFAULT_REPO env var
- `src/slack/repo-context.ts` - Accepts defaultRepo parameter instead of hardcoded constant
- `src/slack/repo-context.test.ts` - Updated tests to pass defaultRepo, added custom default tests
- `src/enforcement/tooling-detection.ts` - Optional logger parameter, structured logging
- `src/enforcement/index.ts` - Passes logger to detectRepoTooling
- `src/slack/assistant-handler.ts` - Accepts and uses defaultRepo from deps
- `src/slack/assistant-handler.test.ts` - Updated all handler creations with defaultRepo
- `src/index.ts` - Passes config.slackDefaultRepo to assistant handler
- `src/lib/dep-bump-enrichment.ts` - Typed GitHub API responses, reduced `as any` casts
- `src/telemetry/store.ts` - Purge uses DELETE + changes() instead of RETURNING
- `src/slack/client.ts` - Added timeoutMs option with AbortSignal.timeout on all fetch calls
- `src/routes/slack-events.ts` - Per-channel sliding window rate limiter

## Decisions Made
- Tooling detection logger is optional to avoid breaking existing callers and tests that don't provide one
- defaultRepo is required in handler deps to force explicit configuration at the wiring point
- Rate limiter is inline (Map-based) rather than external library for simplicity and zero dependencies
- buildInstantReply updated to use defaultRepo instead of hardcoded "xbmc/xbmc" in ping response

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Updated buildInstantReply and instant reply result**
- **Found during:** Task 1 (Fix hardcoded default repo)
- **Issue:** buildInstantReply function and its caller hardcoded "xbmc/xbmc" in the ping response text and result
- **Fix:** Added defaultRepo parameter to buildInstantReply, updated caller to use defaultRepo in both response text and result object
- **Files modified:** src/slack/assistant-handler.ts
- **Verification:** All assistant-handler tests pass
- **Committed in:** f3d26f205e (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Essential for complete hardcoded default removal. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required. SLACK_DEFAULT_REPO env var defaults to "xbmc/xbmc" if not set.

## Next Phase Readiness
- All 6 code review findings addressed (C-1, H-4, H-5, H-8, H-10, M-2)
- Full test suite passes (1112 tests, 0 failures)
- Ready for production deployment

---
*Phase: 85-code-review-fixes-memory-leaks-hardcoded-defaults-type-mismatches-and-missing-rate-limits*
*Completed: 2026-02-20*
