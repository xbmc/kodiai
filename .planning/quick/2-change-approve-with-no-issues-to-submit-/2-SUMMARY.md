---
phase: quick-2
plan: 01
subsystem: mcp
tags: [github-api, pr-approval, comment-server, mcp-tools]

requires:
  - phase: none
    provides: existing comment-server MCP tool infrastructure
provides:
  - APPROVE-to-PR-review interception in create_comment MCP tool
  - prNumber parameter threading from buildMcpServers to createCommentServer
affects: [mention-handler, review-handler]

tech-stack:
  added: []
  patterns: [approve-interception-before-comment-fallthrough]

key-files:
  created: []
  modified:
    - src/execution/mcp/comment-server.ts
    - src/execution/mcp/index.ts
    - src/execution/mcp/comment-server.test.ts

key-decisions:
  - "Simple string-includes detection on sanitized body rather than regex for APPROVE pattern matching"
  - "PR approval body contains same sanitized+stamped content that would have been the comment"

patterns-established:
  - "APPROVE interception: sanitize first, detect APPROVE pattern, branch to pulls.createReview or fall through to issues.createComment"

duration: 1min
completed: 2026-02-12
---

# Quick Task 2: Change APPROVE with No Issues to Submit PR Approval Review

**Mention-triggered APPROVE decisions now submit GitHub PR approval reviews (green checkmark) instead of plain comments via pulls.createReview interception in the create_comment MCP tool**

## Performance

- **Duration:** 1 min
- **Started:** 2026-02-12T00:17:31Z
- **Completed:** 2026-02-12T00:18:53Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- createCommentServer now accepts optional prNumber parameter, threaded from buildMcpServers
- create_comment tool detects APPROVE+no-issues pattern on sanitized body and submits pulls.createReview instead of issues.createComment
- Non-APPROVE comments and issue-context (no prNumber) APPROVE comments fall through to regular comment posting unchanged
- Three new tests covering all branching paths: APPROVE+prNumber, APPROVE+no-prNumber, NOT APPROVED+prNumber

## Task Commits

Each task was committed atomically:

1. **Task 1: Pass prNumber to comment server and intercept APPROVE decisions** - `c9c307163a` (feat)
2. **Task 2: Add tests for APPROVE-to-review interception** - `7d875bc10d` (test)

## Files Created/Modified
- `src/execution/mcp/comment-server.ts` - Added prNumber parameter, APPROVE-to-review interception in create_comment handler
- `src/execution/mcp/index.ts` - Passes deps.prNumber to createCommentServer
- `src/execution/mcp/comment-server.test.ts` - Three new test cases for APPROVE interception branching

## Decisions Made
- Simple string-includes detection on the already-sanitized body rather than regex -- the sanitizeKodiaiDecisionResponse function already validates the structure, so simple includes checks are reliable and readable
- PR approval review body contains the same sanitized+marker-stamped content that would have been the comment, maintaining consistency with existing output

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- APPROVE decisions on mention-triggered reviews will now produce green checkmarks in PR reviewers panel
- No additional configuration needed; existing mention handler already passes prNumber through the executor

## Self-Check: PASSED

All files exist. All commits verified.

---
*Quick Task: 2-change-approve-with-no-issues-to-submit-*
*Completed: 2026-02-12*
