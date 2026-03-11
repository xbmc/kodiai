# T02: 103-issue-corpus-schema-store 02

**Slice:** S01 — **Milestone:** M021

## Description

Implement the IssueStore using TDD — tests first, then implementation.

Purpose: The store is the typed interface for all issue corpus operations. Phase 105 triage agent depends on this.
Output: issue-store.ts factory and comprehensive test suite.

## Must-Haves

- [ ] IssueStore provides typed CRUD (upsert, delete, getByNumber) for issues
- [ ] IssueStore provides hybrid search (vector + BM25) matching ReviewCommentStore pattern
- [ ] IssueStore provides findSimilar method for duplicate detection
- [ ] IssueStore provides comment CRUD (upsertComment, deleteComment, getCommentsByIssue)
- [ ] All store methods have passing tests against real PostgreSQL

## Files

- `src/knowledge/issue-store.ts`
- `src/knowledge/issue-store.test.ts`
