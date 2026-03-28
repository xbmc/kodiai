# S03: Outgoing Secret Scan on All Publish Paths

**Goal:** Add scanOutgoingForSecrets() to src/lib/sanitizer.ts, reusing the named regex patterns from workspace.ts. Apply it at all MCP server publish points (comment-server.ts, inline-review-server.ts, review-comment-thread-server.ts, issue-comment-server.ts) and in assistant-handler.ts before every publishInThread call. Block publish with isError:true if any pattern fires. Also add missing sanitizeOutgoingMentions to issue-comment-server.ts.
**Demo:** After this: Unit test demonstrates a string containing 'ghp_abc123...' is blocked with { blocked: true, matchedPattern: 'github-pat' }. bun test src/lib/sanitizer.test.ts exits 0.

## Tasks
