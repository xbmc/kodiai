---
phase: 04-pr-auto-review
plan: 02
subsystem: api
tags: [github-webhooks, pr-review, octokit, fork-pr, silent-approval, event-handler]

# Dependency graph
requires:
  - phase: 03-execution-engine
    provides: executor, MCP servers, prompt builder, agent SDK integration
  - phase: 04-pr-auto-review plan 01
    provides: review config schema (enabled, autoApprove, skipAuthors, skipPaths), buildReviewPrompt()
provides:
  - createReviewHandler factory wiring PR events to execution engine
  - ExecutionContext.prompt override for pre-built prompts
  - Server entrypoint wiring (executor + review handler)
  - Fork PR clone support with deleted-fork fallback
  - Silent approval logic gated by config.review.autoApprove
affects: [05-mention-handler, 06-content-safety]

# Tech tracking
tech-stack:
  added: []
  patterns: [handler factory pattern (createXxxHandler), prompt override via ExecutionContext.prompt, fork-aware cloning]

key-files:
  created: [src/handlers/review.ts]
  modified: [src/execution/types.ts, src/execution/executor.ts, src/index.ts]

key-decisions:
  - "Handler uses prompt override (ExecutionContext.prompt) instead of triggerBody wrapping for review-specific prompts"
  - "Silent approval gated by config.review.autoApprove (defaults false) -- safe default, user opts in"
  - "skipPaths matching uses simple string matching: suffix for extensions (*.lock), prefix for directories (vendor/)"
  - "Clone depth 50 for review workspaces to provide adequate diff context"
  - "Deleted fork repos fall back to git fetch origin pull/N/head:pr-review"

patterns-established:
  - "Handler factory pattern: createXxxHandler(deps) registers events via eventRouter.register()"
  - "Prompt override: set context.prompt to bypass default buildPrompt() in executor"

# Metrics
duration: 3min
completed: 2026-02-08
---

# Phase 4 Plan 2: PR Review Handler Summary

**Review handler wiring PR opened/ready_for_review events to Claude executor with fork PR support, config-based skip logic, and silent approval**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-08T07:54:43Z
- **Completed:** 2026-02-08T07:57:29Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Created review handler factory with event registration for pull_request.opened and pull_request.ready_for_review
- Fork PR support: clones from head.repo for code, posts comments to base repo, handles deleted forks via PR ref fallback
- Config-driven skip logic: review.enabled, review.skipAuthors, review.skipPaths all checked before execution
- Silent approval submitted only when autoApprove is enabled AND no bot inline comments found
- Added optional prompt field to ExecutionContext for pre-built prompts (backward-compatible)
- Wired executor and review handler into server entrypoint, replacing Phase 3 placeholder comments

## Task Commits

Each task was committed atomically:

1. **Task 1: Create review handler** - `4cf343d` (feat)
2. **Task 2: Add prompt override and wire review handler** - `80543c5` (feat)

## Files Created/Modified
- `src/handlers/review.ts` - Review handler factory with event registration, fork PR support, config skip logic, executor invocation, silent approval
- `src/execution/types.ts` - Added optional `prompt` field to ExecutionContext
- `src/execution/executor.ts` - Uses `context.prompt ?? buildPrompt(context)` for prompt override support
- `src/index.ts` - Creates executor, registers review handler, removes placeholder comments

## Decisions Made
- Used ExecutionContext.prompt override (Option A from plan) instead of putting review prompt in triggerBody -- cleaner separation, review gets full control of prompt
- Silent approval defaults to OFF (autoApprove: false) -- users must opt in, safe default
- skipPaths uses simple string matching (suffix for extensions, prefix for directories) -- adequate for v1, avoids glob library dependency
- Clone depth 50 chosen for review workspaces to ensure sufficient commit history for meaningful diffs

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 4 (PR Auto-Review) is complete: config schema, review prompt builder, and review handler are all wired together
- Phase 5 (Mention Handler) can proceed: same handler factory pattern, same executor with prompt override
- Phase 6 (Content Safety) can proceed: review handler is the primary consumer of sanitization

## Self-Check: PASSED

- FOUND: src/handlers/review.ts
- FOUND: src/execution/types.ts
- FOUND: src/execution/executor.ts
- FOUND: src/index.ts
- COMMIT: 4cf343d (Task 1)
- COMMIT: 80543c5 (Task 2)
- bun build --no-bundle src/index.ts: PASS
- bun build --no-bundle src/handlers/review.ts: PASS
- bun test src/execution/config.test.ts: 7/7 PASS

---
*Phase: 04-pr-auto-review*
*Completed: 2026-02-08*
