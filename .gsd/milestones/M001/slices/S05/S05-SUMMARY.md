---
id: S05
parent: M001
milestone: M001
provides:
  - createMentionHandler factory registering 3 webhook events for all 4 comment surfaces
  - Tracking comment lifecycle (post before enqueue, update on error)
  - mention.prompt config field for custom instructions
  - Server wiring for mention handler alongside review handler
  - create_comment MCP tool for posting new comments on issues/PRs
  - MentionEvent interface normalizing all four comment surfaces
  - Three normalizer functions (normalizeIssueComment, normalizeReviewComment, normalizeReviewBody)
  - containsMention and stripMention helpers
  - buildConversationContext (fetches comments + PR metadata)
  - buildMentionPrompt (assembles prompt with context, question, response instructions)
requires: []
affects: []
key_files: []
key_decisions:
  - "Tracking comment posted BEFORE jobQueue.enqueue for immediate user feedback"
  - "For issue_comment on PR, fetches PR details via pulls.get to get head/base refs for clone"
  - "Pure issue mentions clone default branch from payload.repository.default_branch with depth 1"
  - "PR mentions use depth 50 for diff context, matching review handler"
  - "mention.enabled config check is inside the job (after clone) to read repo config"
  - "containsMention check is outside the job to avoid unnecessary clones"
  - "Error paths update tracking comment so user always sees a result"
  - "mention.prompt optional field mirrors review.prompt for custom instructions"
  - "create_comment MCP tool follows same error handling pattern as update_comment"
  - "MentionEvent.headRef/baseRef left undefined for issue_comment on PR (must be fetched by handler via pulls.get)"
  - "containsMention uses case-insensitive includes check with @appSlug"
  - "stripMention uses regex with word boundary to avoid partial matches"
  - "buildConversationContext fetches max 30 comments (per_page: 30) -- sufficient context without rate limit risk"
  - "Bot tracking comments filtered by checking body starts with '> **Kodiai**'"
  - "PR review comment surface includes diffHunk in conversation context"
patterns_established:
  - "Tracking comment lifecycle: post immediately -> pass ID to executor -> Claude updates via MCP -> error fallback in handler"
  - "Lazy PR data fetch: issue_comment payload lacks PR head/base, so fetch only when needed"
  - "Unified event normalization: multiple webhook surfaces -> single MentionEvent shape"
  - "Conversation context pattern: fetch comments + PR metadata as structured text for prompt"
observability_surfaces: []
drill_down_paths: []
duration: 3min
verification_result: passed
completed_at: 2026-02-08
blocker_discovered: false
---
# S05: Mention Handling

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

# Phase 5 Plan 1: MCP Write Tool, MentionEvent Types, Mention Prompt Summary

**Building blocks for mention handling: MCP create_comment tool, MentionEvent types with normalizers, conversation context builder, and mention prompt generator**

## Performance

- **Duration:** 3 min
- **Tasks:** 2
- **Files created:** 2
- **Files modified:** 1

## Accomplishments
- Extended comment MCP server with `create_comment` tool for posting new issue/PR comments alongside existing `update_comment`
- Created MentionEvent interface normalizing all four comment surfaces (issue_comment, pr_comment, pr_review_comment, pr_review_body) into a single shape
- Built three normalizer functions mapping each webhook payload type to MentionEvent
- Created containsMention (case-insensitive @appSlug detection) and stripMention (removes @appSlug, trims) helpers
- Built buildConversationContext: fetches recent comments, PR metadata for PR surfaces, diff hunk for review comments
- Built buildMentionPrompt: assembles prompt with context header, conversation history, user question, response instructions, and optional custom instructions

## Files Created/Modified
- `src/execution/mcp/comment-server.ts` - Added create_comment tool (issueNumber, body params) alongside update_comment
- `src/handlers/mention-types.ts` - MentionEvent interface, normalizeIssueComment, normalizeReviewComment, normalizeReviewBody, containsMention, stripMention
- `src/execution/mention-prompt.ts` - buildConversationContext (async, fetches comments/PR data), buildMentionPrompt (sync, assembles prompt)

## Decisions Made
- MentionEvent leaves headRef/baseRef undefined for issue_comment payloads on PRs -- the handler must fetch via pulls.get() since the payload lacks this data
- Conversation context skips bot tracking comments (body starts with "> **Kodiai**") to avoid noise
- stripMention uses word-boundary regex to cleanly remove @appSlug without affecting surrounding text
- PR review comment context includes the diff_hunk showing the code being discussed

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## Self-Check: PASSED

- FOUND: src/execution/mcp/comment-server.ts (create_comment tool added)
- FOUND: src/handlers/mention-types.ts (MentionEvent, normalizers, helpers)
- FOUND: src/execution/mention-prompt.ts (buildConversationContext, buildMentionPrompt)
- bun build --no-bundle src/execution/mcp/comment-server.ts: PASS
- bun build --no-bundle src/handlers/mention-types.ts: PASS
- bun build --no-bundle src/execution/mention-prompt.ts: PASS
- bun build --no-bundle src/index.ts: PASS

---
*Phase: 05-mention-handling*
*Completed: 2026-02-08*
