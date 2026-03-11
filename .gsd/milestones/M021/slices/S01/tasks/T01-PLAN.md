# T01: 103-issue-corpus-schema-store 01

**Slice:** S01 — **Milestone:** M021

## Description

Create the PostgreSQL migration for the issue corpus (issues + issue_comments tables) and the TypeScript type definitions.

Purpose: Foundation for the issue vector store — schema + contracts first, implementation in Plan 02.
Output: Migration 014, rollback, and issue-types.ts with all store interfaces.

## Must-Haves

- [ ] Migration 014 creates `issues` table with HNSW vector index (cosine, m=16) and tsvector GIN index
- [ ] Migration 014 creates `issue_comments` table with HNSW vector index and tsvector GIN index
- [ ] Issues table includes state, author_association, label_names, template_slug, comment_count columns
- [ ] TypeScript types define IssueStore interface with upsert, delete, getByNumber, search, and findSimilar methods

## Files

- `src/db/migrations/014-issues.sql`
- `src/db/migrations/014-issues.down.sql`
- `src/knowledge/issue-types.ts`
