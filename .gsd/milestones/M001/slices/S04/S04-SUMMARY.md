---
id: S04
parent: M001
milestone: M001
provides:
  - "Extended RepoConfig with review.skipAuthors, review.skipPaths, review.prompt"
  - "buildReviewPrompt() function for PR auto-review prompt generation"
  - createReviewHandler factory wiring PR events to execution engine
  - ExecutionContext.prompt override for pre-built prompts
  - Server entrypoint wiring (executor + review handler)
  - Fork PR clone support with deleted-fork fallback
  - Silent approval logic gated by config.review.autoApprove
requires: []
affects: []
key_files: []
key_decisions:
  - "Review prompt uses numbered (1), (2), (3) format to avoid GitHub issue link auto-linking from #N"
  - "Silent approval pattern: prompt tells Claude to do nothing on clean PRs, handler manages approval separately"
  - "Suggestion blocks documented with 4-backtick wrapper for proper markdown rendering in prompt"
  - "Handler uses prompt override (ExecutionContext.prompt) instead of triggerBody wrapping for review-specific prompts"
  - "Silent approval gated by config.review.autoApprove (defaults false) -- safe default, user opts in"
  - "skipPaths matching uses simple string matching: suffix for extensions (*.lock), prefix for directories (vendor/)"
  - "Clone depth 50 for review workspaces to provide adequate diff context"
  - "Deleted fork repos fall back to git fetch origin pull/N/head:pr-review"
patterns_established:
  - "Review prompt builder: standalone function taking context object, returning complete prompt string"
  - "Config extension: full default objects for Zod v4 nested schemas per decision [03-01]"
  - "Handler factory pattern: createXxxHandler(deps) registers events via eventRouter.register()"
  - "Prompt override: set context.prompt to bypass default buildPrompt() in executor"
observability_surfaces: []
drill_down_paths: []
duration: 3min
verification_result: passed
completed_at: 2026-02-08
blocker_discovered: false
---
# S04: Pr Auto Review

**# Phase 4 Plan 1: Review Config and Prompt Builder Summary**

## What Happened

# Phase 4 Plan 1: Review Config and Prompt Builder Summary

**Extended RepoConfig with skipAuthors/skipPaths/prompt fields and built review prompt with inline comment instructions, suggestion block syntax, and silent-approval-on-clean pattern**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-08T07:48:11Z
- **Completed:** 2026-02-08T07:50:23Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Extended RepoConfig schema with review.skipAuthors (string[]), review.skipPaths (string[]), and review.prompt (string?) with correct Zod v4 defaults
- Created buildReviewPrompt() that generates a complete, structured review prompt with all required sections
- Prompt instructs Claude to use MCP inline comment tool with suggestion blocks for concrete fixes
- Prompt enforces silent approval: do nothing on clean PRs, no summary comments, only actionable inline issues

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend review config schema** - `3c8aa86` (feat)
2. **Task 2: Create review prompt builder** - `12e5a91` (feat)

## Files Created/Modified
- `src/execution/config.ts` - Added skipAuthors, skipPaths, prompt fields to review schema
- `src/execution/config.test.ts` - Added 3 new tests for skipAuthors, skipPaths, prompt parsing
- `src/execution/review-prompt.ts` - New file: buildReviewPrompt() with 8 prompt sections

## Decisions Made
- Review prompt uses (1), (2), (3) numbered format instead of #1, #2, #3 to prevent GitHub auto-linking to issue numbers
- Silent approval pattern: prompt explicitly tells Claude "do nothing" on clean PRs -- the calling handler manages approval separately
- Suggestion block syntax documented with 4-backtick wrapper so the triple-backtick suggestion example renders correctly in the prompt
- Empty PR body is omitted entirely rather than showing an empty section

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Review config schema ready for use by PR review handler (04-02)
- buildReviewPrompt() ready for integration with executor (04-02/04-03)
- Prompt references mcp__github_inline_comment__create_inline_comment which is provided by inline-review-server.ts (03-02)

## Self-Check: PASSED

- All 3 files exist (config.ts, config.test.ts, review-prompt.ts)
- Both task commits verified (3c8aa86, 12e5a91)
- skipAuthors present in config.ts and config.test.ts
- buildReviewPrompt exported from review-prompt.ts

---
*Phase: 04-pr-auto-review*
*Completed: 2026-02-08*

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
