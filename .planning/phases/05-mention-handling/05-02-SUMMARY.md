---
phase: 05-mention-handling
plan: 02
subsystem: handlers, server
tags: [mention-handler, tracking-comment, event-registration, config, server-wiring]

# Dependency graph
requires:
  - phase: 05-mention-handling plan 01
    provides: MentionEvent types, normalizers, containsMention, stripMention, buildConversationContext, buildMentionPrompt, create_comment MCP tool
  - phase: 03-execution-engine
    provides: executor, workspace manager, job queue
provides:
  - createMentionHandler factory registering 3 webhook events for all 4 comment surfaces
  - Tracking comment lifecycle (post before enqueue, update on error)
  - mention.prompt config field for custom instructions
  - Server wiring for mention handler alongside review handler
affects: [06-content-safety, 07-operational-resilience]

# Tech tracking
tech-stack:
  added: []
  patterns: [tracking comment lifecycle (create-before-enqueue, update-on-error), PR data lazy-fetch for issue_comment on PR]

key-files:
  created: [src/handlers/mention.ts]
  modified: [src/execution/config.ts, src/index.ts]

key-decisions:
  - "Tracking comment posted BEFORE jobQueue.enqueue for immediate user feedback"
  - "For issue_comment on PR, fetches PR details via pulls.get to get head/base refs for clone"
  - "Pure issue mentions clone default branch from payload.repository.default_branch with depth 1"
  - "PR mentions use depth 50 for diff context, matching review handler"
  - "mention.enabled config check is inside the job (after clone) to read repo config"
  - "containsMention check is outside the job to avoid unnecessary clones"
  - "Error paths update tracking comment so user always sees a result"
  - "mention.prompt optional field mirrors review.prompt for custom instructions"

patterns-established:
  - "Tracking comment lifecycle: post immediately -> pass ID to executor -> Claude updates via MCP -> error fallback in handler"
  - "Lazy PR data fetch: issue_comment payload lacks PR head/base, so fetch only when needed"

# Metrics
duration: 3min
completed: 2026-02-08
---

# Phase 5 Plan 2: Mention Handler and Server Wiring Summary

**Mention handler covering all 4 comment surfaces with tracking comment lifecycle, conversation context, and server wiring**

## Performance

- **Duration:** 3 min
- **Tasks:** 2
- **Files created:** 1
- **Files modified:** 2

## Accomplishments
- Created createMentionHandler factory registering for issue_comment.created, pull_request_review_comment.created, and pull_request_review.submitted
- Tracking comment posted immediately before job enqueue for instant user feedback
- Full mention flow: normalize payload -> check mention -> strip mention -> post tracking -> enqueue job -> clone -> load config -> build context -> execute -> error fallback
- PR detection in issue_comment using payload.issue.pull_request field
- Lazy PR data fetch for issue_comment on PR (pulls.get for head/base refs)
- Pure issue mentions clone default branch with depth 1; PR mentions use depth 50
- Error handling updates tracking comment with descriptive error message
- Added mention.prompt optional config field for custom instructions
- Wired createMentionHandler into src/index.ts alongside createReviewHandler

## Files Created/Modified
- `src/handlers/mention.ts` - Mention handler factory with event registration, payload normalization, tracking comment lifecycle, conversation context building, executor invocation, and error handling
- `src/execution/config.ts` - Added optional `prompt` field to mention config schema
- `src/index.ts` - Added import and registration of createMentionHandler with same deps as review handler

## Decisions Made
- Tracking comment posted BEFORE enqueue (not inside job) so users see immediate feedback even with queue backlog
- containsMention check happens before enqueue to avoid cloning repos for non-mention comments
- mention.enabled check happens after clone (inside job) because it reads repo's .kodiai.yml
- Pure issue mentions extract default_branch from webhook payload for clone ref
- Both error paths (execution error + handler exception) update the tracking comment

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## Self-Check: PASSED

- FOUND: src/handlers/mention.ts
- FOUND: src/execution/config.ts (mention.prompt field)
- FOUND: src/index.ts (createMentionHandler wiring)
- bun build --no-bundle src/handlers/mention.ts: PASS
- bun build --no-bundle src/execution/config.ts: PASS
- bun build --no-bundle src/index.ts: PASS
- bun test src/execution/config.test.ts: 7/7 PASS

---
*Phase: 05-mention-handling*
*Completed: 2026-02-08*
