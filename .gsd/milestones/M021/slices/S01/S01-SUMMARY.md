---
id: S01
parent: M021
milestone: M021
provides: []
requires: []
affects: []
key_files: []
key_decisions: []
patterns_established: []
observability_surfaces: []
drill_down_paths: []
duration: 
verification_result: passed
completed_at: 2026-02-26
blocker_discovered: false
---
# S01: Issue Corpus Schema Store

**# Plan 103-01 Summary: Schema Migration & Types**

## What Happened

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

# Plan 103-03 Summary: Application Wiring

## What was built
- Added IssueStore exports to knowledge barrel (src/knowledge/index.ts)
- Added issueStore instantiation in application entry point (src/index.ts)
- Issue store is NOT wired into cross-corpus retrieval (intentionally deferred to v0.22)

## Key files

### key-files.modified
- src/knowledge/index.ts
- src/index.ts

## Self-Check: PASSED
- [x] createIssueStore exported from knowledge barrel
- [x] All 7 issue types exported from knowledge barrel
- [x] issueStore instantiated in index.ts after migrations
- [x] issueStore NOT passed to createRetriever()
- [x] All existing tests still pass
- [x] Application transpiles without errors

## Decisions
- Imported createIssueStore directly (not via barrel) in index.ts, matching existing pattern for other stores
- issueStore declared but not passed to any handler yet -- Phase 105 triage agent will consume it

# Plan 103-02 Summary: IssueStore Implementation (TDD)

## What was built
- `createIssueStore` factory function implementing the full IssueStore interface
- 15 comprehensive tests covering all operations against real PostgreSQL
- Test suite: issue CRUD (5), issue search (4), comment CRUD (4), comment search (1), cascade delete (1)

## Key files

### key-files.created
- src/knowledge/issue-store.ts
- src/knowledge/issue-store.test.ts

## Self-Check: PASSED
- [x] All 15 tests pass
- [x] upsert creates and updates issues correctly
- [x] delete removes issues and cascades to comments
- [x] searchByEmbedding returns results sorted by cosine distance
- [x] searchByFullText uses weighted tsvector (title > body > labels)
- [x] findSimilar finds related issues and excludes self
- [x] Comment CRUD works correctly with ordering
- [x] searchCommentsByEmbedding returns comment results

## Decisions
- Used same `float32ArrayToVectorString` pattern as ReviewCommentStore
- ON CONFLICT DO UPDATE for upsert (not DO NOTHING) since issues are mutable
- findSimilar retrieves source embedding then queries, with configurable threshold (default 0.7)
- Delete cascade: comments deleted before issues in explicit order
