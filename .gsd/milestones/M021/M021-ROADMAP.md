# M021: Issue Triage Foundation

**Vision:** Kodiai is an installable GitHub App that provides AI-powered PR auto-reviews, conversational code assistance via `@kodiai` mentions, and a Slack assistant (`@kodiai` in `#kodiai`) for read-only code questions and write-mode PR creation.

## Success Criteria


## Slices

- [x] **S01: Issue Corpus Schema Store** `risk:medium` `depends:[]`
  > After this: Create the PostgreSQL migration for the issue corpus (issues + issue_comments tables) and the TypeScript type definitions.
- [x] **S02: Issue Mcp Tools** `risk:medium` `depends:[S01]`
  > After this: Implement the `github_issue_label` MCP tool using TDD.
- [x] **S03: Triage Agent Wiring** `risk:medium` `depends:[S02]`
  > After this: Implement the issue template parser using TDD.
