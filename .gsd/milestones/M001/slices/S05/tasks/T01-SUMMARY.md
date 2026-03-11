---
id: T01
parent: S05
milestone: M001
provides:
  - create_comment MCP tool for posting new comments on issues/PRs
  - MentionEvent interface normalizing all four comment surfaces
  - Three normalizer functions (normalizeIssueComment, normalizeReviewComment, normalizeReviewBody)
  - containsMention and stripMention helpers
  - buildConversationContext (fetches comments + PR metadata)
  - buildMentionPrompt (assembles prompt with context, question, response instructions)
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
# T01: 05-mention-handling 01

**# Phase 5 Plan 1: MCP Write Tool, MentionEvent Types, Mention Prompt Summary**

## What Happened

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
