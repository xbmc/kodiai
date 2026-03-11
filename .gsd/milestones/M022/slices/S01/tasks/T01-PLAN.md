# T01: 106-historical-corpus-population 01

**Slice:** S01 — **Milestone:** M022

## Description

Build the issue backfill engine: migration for sync state tracking, comment chunker with issue context prefix, and the core backfill function that paginates GitHub Issues API, filters PRs, embeds issues, and persists sync state for resume.

Purpose: Provides the reusable engine that both the CLI script (Plan 02) and nightly sync invoke.
Output: Migration 015, issue-backfill.ts, issue-comment-chunker.ts, and their tests.

## Must-Haves

- [ ] "Backfill engine paginates GitHub Issues API, filters PRs, embeds issues, and upserts via IssueStore"
- [ ] "Backfill engine persists sync state after each page for cursor-based resume"
- [ ] "Backfill engine logs structured progress (page count, issues processed, embeddings created, rate limit remaining)"
- [ ] "Long comments are chunked with overlap, not truncated"
- [ ] "Bot comments are filtered out before embedding"

## Files

- `src/db/migrations/015-issue-sync-state.sql`
- `src/db/migrations/015-issue-sync-state.down.sql`
- `src/knowledge/issue-backfill.ts`
- `src/knowledge/issue-backfill.test.ts`
- `src/knowledge/issue-comment-chunker.ts`
- `src/knowledge/issue-comment-chunker.test.ts`
