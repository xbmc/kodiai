# S09: Publish Path Mention Sanitization Completion

**Goal:** Introduce `botHandles` field on `ExecutionContext`, thread it through `buildMcpServers` to all three MCP server constructors, and apply `sanitizeOutgoingMentions` at every outbound publish point in MCP servers and the review handler.
**Demo:** Introduce `botHandles` field on `ExecutionContext`, thread it through `buildMcpServers` to all three MCP server constructors, and apply `sanitizeOutgoingMentions` at every outbound publish point in MCP servers and the review handler.

## Must-Haves


## Tasks

- [x] **T01: 50-publish-path-mention-sanitization-completion 01** `est:6min`
  - Introduce `botHandles` field on `ExecutionContext`, thread it through `buildMcpServers` to all three MCP server constructors, and apply `sanitizeOutgoingMentions` at every outbound publish point in MCP servers and the review handler.

Purpose: Close the defense-in-depth gap where MCP tool publish paths and review handler direct Octokit calls bypass mention sanitization, eliminating the risk of self-trigger loops from any outbound comment path.

Output: All outbound GitHub comment/review publish paths route through `sanitizeOutgoingMentions` with bot handles available at call time.
- [x] **T02: 50-publish-path-mention-sanitization-completion 02** `est:3min`
  - Add regression tests for mention sanitization across all ancillary MCP server publish paths and verify the milestone audit degraded flow is resolved.

Purpose: Lock the defense-in-depth guarantee with test coverage so future refactors cannot regress mention sanitization on any publish path. Close the CONV-05 audit gap.

Output: Regression tests for all 5 MCP publish points proving sanitization is applied, plus audit confirmation.

## Files Likely Touched

- `src/execution/types.ts`
- `src/execution/executor.ts`
- `src/execution/mcp/index.ts`
- `src/execution/mcp/comment-server.ts`
- `src/execution/mcp/inline-review-server.ts`
- `src/execution/mcp/review-comment-thread-server.ts`
- `src/handlers/mention.ts`
- `src/handlers/review.ts`
- `src/execution/mcp/comment-server.test.ts`
- `src/execution/mcp/inline-review-server.test.ts`
- `src/execution/mcp/review-comment-thread-server.test.ts`
