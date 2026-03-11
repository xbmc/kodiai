# T02: 104-issue-mcp-tools 02

**Slice:** S02 — **Milestone:** M021

## Description

Implement the `github_issue_comment` MCP tool using TDD.

Purpose: Give the triage agent the ability to post and update comments on GitHub issues, supporting both raw markdown and structured input.
Output: `issue-comment-server.ts` and `issue-comment-server.test.ts`

## Must-Haves

- [ ] "github_issue_comment tool creates comments on issues"
- [ ] "github_issue_comment tool updates existing comments by ID"
- [ ] "Supports both raw markdown and structured input (title/body/suggestions)"
- [ ] "No bot branding or signature on comments"
- [ ] "Truncates with note when comment exceeds max length"
- [ ] "Closed issues get a warning but comment still posts"

## Files

- `src/execution/mcp/issue-comment-server.ts`
- `src/execution/mcp/issue-comment-server.test.ts`
