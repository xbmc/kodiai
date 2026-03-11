# T03: 11-mention-ux-parity 03

**Slice:** S01 — **Milestone:** M002

## Description

Add inline thread replies for PR review comment mentions so responses show up in the exact review comment thread (parity with xbmc/xbmc @claude UX).

Purpose: Developers expect replies to inline comments to stay in-thread.
Output: New MCP tool + routing + tests.

## Must-Haves

- [ ] "Inline PR review comment mentions produce a reply in the same thread"
- [ ] "Non-inline mentions remain top-level issue/PR comment replies"
- [ ] "The mention prompt instructs the correct tool for inline thread replies"

## Files

- `src/execution/mcp/review-comment-thread-server.ts`
- `src/execution/mcp/index.ts`
- `src/execution/mention-prompt.ts`
- `src/handlers/mention.ts`
- `src/execution/mcp/review-comment-thread-server.test.ts`
