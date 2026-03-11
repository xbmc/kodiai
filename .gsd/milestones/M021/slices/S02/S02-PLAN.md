# S02: Issue Mcp Tools

**Goal:** Implement the `github_issue_label` MCP tool using TDD.
**Demo:** Implement the `github_issue_label` MCP tool using TDD.

## Must-Haves


## Tasks

- [x] **T01: 104-issue-mcp-tools 01**
  - Implement the `github_issue_label` MCP tool using TDD.

Purpose: Give the triage agent the ability to apply labels to GitHub issues with pre-validation, case-insensitive matching, and partial application semantics.
Output: `issue-label-server.ts` and `issue-label-server.test.ts`
- [x] **T02: 104-issue-mcp-tools 02**
  - Implement the `github_issue_comment` MCP tool using TDD.

Purpose: Give the triage agent the ability to post and update comments on GitHub issues, supporting both raw markdown and structured input.
Output: `issue-comment-server.ts` and `issue-comment-server.test.ts`
- [x] **T03: 104-issue-mcp-tools 03**
  - Wire both issue MCP tools into the executor MCP server registry with config gating and integration tests.

Purpose: Make the issue label and comment tools available to the triage agent, controlled by per-repo `.kodiai.yml` configuration.
Output: Updated `index.ts` registry, `config.ts` schema, integration tests.

## Files Likely Touched

- `src/execution/mcp/issue-label-server.ts`
- `src/execution/mcp/issue-label-server.test.ts`
- `src/execution/mcp/issue-comment-server.ts`
- `src/execution/mcp/issue-comment-server.test.ts`
- `src/execution/mcp/index.ts`
- `src/execution/config.ts`
- `src/execution/config.test.ts`
- `src/execution/mcp/index.test.ts`
