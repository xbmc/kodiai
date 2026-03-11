# S01: Historical Corpus Population

**Goal:** Build the issue backfill engine: migration for sync state tracking, comment chunker with issue context prefix, and the core backfill function that paginates GitHub Issues API, filters PRs, embeds issues, and persists sync state for resume.
**Demo:** Build the issue backfill engine: migration for sync state tracking, comment chunker with issue context prefix, and the core backfill function that paginates GitHub Issues API, filters PRs, embeds issues, and persists sync state for resume.

## Must-Haves


## Tasks

- [x] **T01: 106-historical-corpus-population 01**
  - Build the issue backfill engine: migration for sync state tracking, comment chunker with issue context prefix, and the core backfill function that paginates GitHub Issues API, filters PRs, embeds issues, and persists sync state for resume.

Purpose: Provides the reusable engine that both the CLI script (Plan 02) and nightly sync invoke.
Output: Migration 015, issue-backfill.ts, issue-comment-chunker.ts, and their tests.
- [x] **T02: 106-historical-corpus-population 02**
  - Create the CLI script entry point and GitHub Actions nightly sync workflow. The script supports dual-mode: full backfill (default) and incremental sync (--sync flag).

Purpose: Makes the backfill engine from Plan 01 runnable as a CLI script and automatable via GitHub Actions.
Output: scripts/backfill-issues.ts and .github/workflows/nightly-issue-sync.yml.

## Files Likely Touched

- `src/db/migrations/015-issue-sync-state.sql`
- `src/db/migrations/015-issue-sync-state.down.sql`
- `src/knowledge/issue-backfill.ts`
- `src/knowledge/issue-backfill.test.ts`
- `src/knowledge/issue-comment-chunker.ts`
- `src/knowledge/issue-comment-chunker.test.ts`
- `scripts/backfill-issues.ts`
- `.github/workflows/nightly-issue-sync.yml`
