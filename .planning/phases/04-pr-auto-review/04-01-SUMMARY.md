---
phase: 04-pr-auto-review
plan: 01
subsystem: execution
tags: [zod, config, prompt-engineering, code-review, github-api]

requires:
  - phase: 03-execution-engine
    provides: "RepoConfig schema, execution types, MCP inline review server"
provides:
  - "Extended RepoConfig with review.skipAuthors, review.skipPaths, review.prompt"
  - "buildReviewPrompt() function for PR auto-review prompt generation"
affects: [04-pr-auto-review, 05-mention-handling]

tech-stack:
  added: []
  patterns:
    - "Review prompt builder pattern (context object -> structured prompt string)"
    - "Config schema extension with Zod nested object defaults"

key-files:
  created:
    - src/execution/review-prompt.ts
  modified:
    - src/execution/config.ts
    - src/execution/config.test.ts

key-decisions:
  - "Review prompt uses numbered (1), (2), (3) format to avoid GitHub issue link auto-linking from #N"
  - "Silent approval pattern: prompt tells Claude to do nothing on clean PRs, handler manages approval separately"
  - "Suggestion blocks documented with 4-backtick wrapper for proper markdown rendering in prompt"

patterns-established:
  - "Review prompt builder: standalone function taking context object, returning complete prompt string"
  - "Config extension: full default objects for Zod v4 nested schemas per decision [03-01]"

duration: 2min
completed: 2026-02-08
---

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
