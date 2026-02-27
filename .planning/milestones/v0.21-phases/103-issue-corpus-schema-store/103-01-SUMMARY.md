---
phase: 103-issue-corpus-schema-store
plan: 01
status: complete
started: 2026-02-26
completed: 2026-02-26
---

# Plan 103-01 Summary: Schema Migration & Types

## What was built
- Migration 014 creating `issues` and `issue_comments` tables with HNSW vector indexes (cosine, m=16) and tsvector GIN indexes
- Weighted tsvector triggers: title (A) + body (B) + labels (C) for issues, body for comments
- TypeScript type definitions: IssueStore interface, IssueRecord, IssueInput, IssueSearchResult, IssueCommentRecord, IssueCommentInput, IssueCommentSearchResult

## Key files

### key-files.created
- src/db/migrations/014-issues.sql
- src/db/migrations/014-issues.down.sql
- src/knowledge/issue-types.ts

## Self-Check: PASSED
- [x] Migration creates 2 tables (issues, issue_comments)
- [x] HNSW indexes on both tables
- [x] tsvector GIN indexes on both tables
- [x] All required metadata columns present (state, author_association, label_names, template_slug, comment_count)
- [x] IssueStore interface with findSimilar as first-class method
- [x] 7 exported types

## Decisions
- Used TEXT[] for label_names (better for @> containment queries + GIN index)
- Used trigger-based tsvector (matching review_comments pattern, not GENERATED ALWAYS AS)
- Included down migration for clean rollback
