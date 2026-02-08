---
phase: 05-mention-handling
plan: 01
subsystem: execution, handlers
tags: [mcp-tools, mention-types, conversation-context, mention-prompt, normalization]

# Dependency graph
requires:
  - phase: 03-execution-engine
    provides: MCP server framework (createSdkMcpServer, tool), ExecutionContext, executor
  - phase: 04-pr-auto-review
    provides: handler factory pattern, review prompt structure as template
provides:
  - create_comment MCP tool for posting new comments on issues/PRs
  - MentionEvent interface normalizing all four comment surfaces
  - Three normalizer functions (normalizeIssueComment, normalizeReviewComment, normalizeReviewBody)
  - containsMention and stripMention helpers
  - buildConversationContext (fetches comments + PR metadata)
  - buildMentionPrompt (assembles prompt with context, question, response instructions)
affects: [05-02-mention-handler, 06-content-safety]

# Tech tracking
tech-stack:
  added: []
  patterns: [unified event normalization, conversation context building, tracking comment lifecycle]

key-files:
  created: [src/handlers/mention-types.ts, src/execution/mention-prompt.ts]
  modified: [src/execution/mcp/comment-server.ts]

key-decisions:
  - "create_comment MCP tool follows same error handling pattern as update_comment"
  - "MentionEvent.headRef/baseRef left undefined for issue_comment on PR (must be fetched by handler via pulls.get)"
  - "containsMention uses case-insensitive includes check with @appSlug"
  - "stripMention uses regex with word boundary to avoid partial matches"
  - "buildConversationContext fetches max 30 comments (per_page: 30) -- sufficient context without rate limit risk"
  - "Bot tracking comments filtered by checking body starts with '> **Kodiai**'"
  - "PR review comment surface includes diffHunk in conversation context"

patterns-established:
  - "Unified event normalization: multiple webhook surfaces -> single MentionEvent shape"
  - "Conversation context pattern: fetch comments + PR metadata as structured text for prompt"

# Metrics
duration: 3min
completed: 2026-02-08
---

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
