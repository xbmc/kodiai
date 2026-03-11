# T01: 50-publish-path-mention-sanitization-completion 01

**Slice:** S09 — **Milestone:** M008

## Description

Introduce `botHandles` field on `ExecutionContext`, thread it through `buildMcpServers` to all three MCP server constructors, and apply `sanitizeOutgoingMentions` at every outbound publish point in MCP servers and the review handler.

Purpose: Close the defense-in-depth gap where MCP tool publish paths and review handler direct Octokit calls bypass mention sanitization, eliminating the risk of self-trigger loops from any outbound comment path.

Output: All outbound GitHub comment/review publish paths route through `sanitizeOutgoingMentions` with bot handles available at call time.

## Must-Haves

- [ ] "Every MCP server publish call sanitizes outgoing mentions before posting to GitHub"
- [ ] "Review handler direct Octokit publish calls sanitize outgoing mentions before posting"
- [ ] "Bot handles are threaded from handlers through executor to MCP servers"

## Files

- `src/execution/types.ts`
- `src/execution/executor.ts`
- `src/execution/mcp/index.ts`
- `src/execution/mcp/comment-server.ts`
- `src/execution/mcp/inline-review-server.ts`
- `src/execution/mcp/review-comment-thread-server.ts`
- `src/handlers/mention.ts`
- `src/handlers/review.ts`
