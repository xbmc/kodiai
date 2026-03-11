# T02: 50-publish-path-mention-sanitization-completion 02

**Slice:** S09 — **Milestone:** M008

## Description

Add regression tests for mention sanitization across all ancillary MCP server publish paths and verify the milestone audit degraded flow is resolved.

Purpose: Lock the defense-in-depth guarantee with test coverage so future refactors cannot regress mention sanitization on any publish path. Close the CONV-05 audit gap.

Output: Regression tests for all 5 MCP publish points proving sanitization is applied, plus audit confirmation.

## Must-Haves

- [ ] "MCP server publish paths are covered by regression tests verifying mention sanitization"
- [ ] "Ancillary review handler publish paths are covered by regression tests verifying mention sanitization"
- [ ] "Milestone audit no longer reports degraded flow for outbound mention sanitization"

## Files

- `src/execution/mcp/comment-server.test.ts`
- `src/execution/mcp/inline-review-server.test.ts`
- `src/execution/mcp/review-comment-thread-server.test.ts`
