# S01: Issue Corpus Schema Store

**Goal:** Create the PostgreSQL migration for the issue corpus (issues + issue_comments tables) and the TypeScript type definitions.
**Demo:** Create the PostgreSQL migration for the issue corpus (issues + issue_comments tables) and the TypeScript type definitions.

## Must-Haves


## Tasks

- [x] **T01: 103-issue-corpus-schema-store 01**
  - Create the PostgreSQL migration for the issue corpus (issues + issue_comments tables) and the TypeScript type definitions.

Purpose: Foundation for the issue vector store — schema + contracts first, implementation in Plan 02.
Output: Migration 014, rollback, and issue-types.ts with all store interfaces.
- [x] **T02: 103-issue-corpus-schema-store 02**
  - Implement the IssueStore using TDD — tests first, then implementation.

Purpose: The store is the typed interface for all issue corpus operations. Phase 105 triage agent depends on this.
Output: issue-store.ts factory and comprehensive test suite.
- [x] **T03: 103-issue-corpus-schema-store 03**
  - Wire the IssueStore into the application — export from knowledge barrel and instantiate in index.ts.

Purpose: Makes the issue store available for Phase 105 triage agent wiring.
Output: Modified index.ts and knowledge/index.ts with issue store exports and initialization.

## Files Likely Touched

- `src/db/migrations/014-issues.sql`
- `src/db/migrations/014-issues.down.sql`
- `src/knowledge/issue-types.ts`
- `src/knowledge/issue-store.ts`
- `src/knowledge/issue-store.test.ts`
- `src/knowledge/index.ts`
- `src/index.ts`
