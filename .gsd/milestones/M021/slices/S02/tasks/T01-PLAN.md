# T01: 104-issue-mcp-tools 01

**Slice:** S02 — **Milestone:** M021

## Description

Implement the `github_issue_label` MCP tool using TDD.

Purpose: Give the triage agent the ability to apply labels to GitHub issues with pre-validation, case-insensitive matching, and partial application semantics.
Output: `issue-label-server.ts` and `issue-label-server.test.ts`

## Must-Haves

- [ ] "github_issue_label tool applies valid labels to an issue"
- [ ] "Invalid labels are reported but valid labels still applied (partial application)"
- [ ] "Label matching is case-insensitive against repo's canonical casing"
- [ ] "Missing labels produce LABEL_NOT_FOUND error code in response"
- [ ] "Closed issues get a warning flag but labels still applied"
- [ ] "Rate-limited requests retry with exponential backoff"

## Files

- `src/execution/mcp/issue-label-server.ts`
- `src/execution/mcp/issue-label-server.test.ts`
