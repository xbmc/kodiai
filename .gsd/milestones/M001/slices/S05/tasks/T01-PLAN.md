# T01: 05-mention-handling 01

**Slice:** S05 — **Milestone:** M001

## Description

Create the building blocks for mention handling: MCP write tool extension, MentionEvent types with normalizers for all four comment surfaces, conversation context builder, and mention-specific prompt.

Purpose: Provides the types, tools, and prompt generation that the mention handler (Plan 02) will orchestrate. Follows the same foundation-first pattern as Phase 4 (04-01 built config+prompt, 04-02 built the handler).

Output: Three source files providing types, MCP tooling, and prompt generation for mentions.

## Must-Haves

- [ ] "MCP comment server exposes create_comment tool alongside existing update_comment"
- [ ] "MentionEvent type normalizes all four comment surfaces into a single shape"
- [ ] "Mention prompt includes conversation context, PR metadata when applicable, and the user question"
- [ ] "Conversation context builder fetches recent issue/PR comments and PR details"

## Files

- `src/execution/mcp/comment-server.ts`
- `src/execution/mention-prompt.ts`
- `src/handlers/mention-types.ts`
