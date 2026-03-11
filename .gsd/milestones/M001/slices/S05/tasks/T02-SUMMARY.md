---
id: T02
parent: S05
milestone: M001
provides:
  - createMentionHandler factory registering 3 webhook events for all 4 comment surfaces
  - Tracking comment lifecycle (post before enqueue, update on error)
  - mention.prompt config field for custom instructions
  - Server wiring for mention handler alongside review handler
requires: []
affects: []
key_files: []
key_decisions: []
patterns_established: []
observability_surfaces: []
drill_down_paths: []
duration: 3min
verification_result: passed
completed_at: 2026-02-08
blocker_discovered: false
---
# T02: 05-mention-handling 02

**# Phase 5 Plan 2: Mention Handler and Server Wiring Summary**

## What Happened

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
