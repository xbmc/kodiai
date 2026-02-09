---
phase: 11-mention-ux-parity
plan: 03
subsystem: mention
tags: [mcp, octokit, github, mention-routing]

# Dependency graph
requires:
  - phase: 11-mention-ux-parity
    provides: Mention handling pipeline + mention prompt/context (11-01, 11-02)
provides:
  - In-thread replies for inline PR review comment mentions via MCP tool
  - Mention prompt routing that selects thread replies for pr_review_comment surface
affects: [mention-handling, mcp, execution-prompts]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "MCP server per GitHub surface with explicit registry key"
    - "Mention prompt selects publishing tool based on surface"

key-files:
  created:
    - src/execution/mcp/review-comment-thread-server.ts
    - src/execution/mcp/review-comment-thread-server.test.ts
  modified:
    - src/execution/mcp/index.ts
    - src/execution/mention-prompt.ts
    - src/handlers/mention.ts

key-decisions:
  - "Expose thread reply tool via MCP server key 'reviewCommentThread' and tool name reply_to_pr_review_comment"
  - "Wrap thread reply bodies with wrapInDetails() to enforce collapsed-bot UX even if the model forgets"

patterns-established:
  - "If a tool should only be available for a surface, gate its MCP server registration on the required identifiers (PR number + comment id)"

# Metrics
duration: 5 min
completed: 2026-02-09
---

# Phase 11 Plan 03: Inline Review Comment Thread Replies Summary

**Inline PR review comment mentions now reply in-thread via a dedicated MCP tool (with prompt routing), while other mention surfaces remain top-level PR/issue comments.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-09T23:06:32Z
- **Completed:** 2026-02-09T23:12:29Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Added `reply_to_pr_review_comment` MCP tool that posts replies into the exact PR review comment thread.
- Wired MCP registry + mention handler context so inline review comment mentions enable and use the thread reply tool.
- Updated mention prompt instructions so `pr_review_comment` uses thread replies and everything else uses top-level `create_comment`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement MCP tool to reply to a PR review comment thread** - `2517338f73` (feat)
2. **Task 2: Wire thread reply tool into MCP registry and mention prompt routing** - `4ffff90bff` (feat)

## Files Created/Modified

- `src/execution/mcp/review-comment-thread-server.ts` - MCP server exposing `reply_to_pr_review_comment` using Octokit PR review comment reply endpoint.
- `src/execution/mcp/review-comment-thread-server.test.ts` - Stubbed Octokit test asserting correct REST call + wrapped body.
- `src/execution/mcp/index.ts` - Registers `reviewCommentThread` server when PR number + triggering comment id are available.
- `src/execution/mention-prompt.ts` - Routes `pr_review_comment` to thread reply tool; other surfaces remain top-level comment replies.
- `src/handlers/mention.ts` - Passes triggering review comment id into executor context for inline review mentions.

## Decisions Made

- Used a surface-gated MCP server (`reviewCommentThread`) so the thread reply tool only appears when the executor has both `prNumber` and the triggering review `commentId`.
- Enforced `<details>` wrapping at the tool layer for thread replies via `wrapInDetails()` to guarantee collapsed UX.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- `bun test` exceeded the default 120s command timeout once; reran with an extended timeout and the full suite passed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Inline mention publishing now has parity with in-thread reply expectations; ready to proceed to `11-04-PLAN.md`.

## Self-Check: PASSED

- FOUND: `.planning/phases/11-mention-ux-parity/11-03-SUMMARY.md`
- FOUND commits: `2517338f73`, `4ffff90bff`
