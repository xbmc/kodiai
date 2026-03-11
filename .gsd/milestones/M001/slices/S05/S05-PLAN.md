# S05: Mention Handling

**Goal:** Create the building blocks for mention handling: MCP write tool extension, MentionEvent types with normalizers for all four comment surfaces, conversation context builder, and mention-specific prompt.
**Demo:** Create the building blocks for mention handling: MCP write tool extension, MentionEvent types with normalizers for all four comment surfaces, conversation context builder, and mention-specific prompt.

## Must-Haves


## Tasks

- [x] **T01: 05-mention-handling 01** `est:3min`
  - Create the building blocks for mention handling: MCP write tool extension, MentionEvent types with normalizers for all four comment surfaces, conversation context builder, and mention-specific prompt.

Purpose: Provides the types, tools, and prompt generation that the mention handler (Plan 02) will orchestrate. Follows the same foundation-first pattern as Phase 4 (04-01 built config+prompt, 04-02 built the handler).

Output: Three source files providing types, MCP tooling, and prompt generation for mentions.
- [x] **T02: 05-mention-handling 02** `est:3min`
  - Create the mention handler that dispatches across all four comment surfaces, posts tracking comments for progress, builds conversation context, and invokes Claude with a mention-specific prompt. Wire into the server entrypoint.

Purpose: This is the core Phase 5 deliverable. Following the handler factory pattern from Phase 4, a single handler covers issue comments, PR comments, PR review comments, and PR review bodies. The tracking comment provides immediate user feedback before the job queue processes the request.

Output: Working mention handler wired into the server, covering all MENTION-01 through MENTION-05 requirements.

## Files Likely Touched

- `src/execution/mcp/comment-server.ts`
- `src/execution/mention-prompt.ts`
- `src/handlers/mention-types.ts`
- `src/handlers/mention.ts`
- `src/execution/config.ts`
- `src/index.ts`
