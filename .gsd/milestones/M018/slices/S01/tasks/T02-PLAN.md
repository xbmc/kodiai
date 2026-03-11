# T02: 89-pr-review-comment-ingestion 02

**Slice:** S01 — **Milestone:** M018

## Description

Build the backfill CLI that fetches 18 months of PR review comments from xbmc/xbmc via GitHub API, chunks them, embeds them, and stores them in the review_comments table.

Purpose: Populate the review comment corpus with historical human review patterns that the bot can reference when reviewing new PRs.
Output: Backfill engine module and CLI script (`npm run backfill:reviews`).

## Must-Haves

- [ ] "CLI command fetches all PR review comments from xbmc/xbmc for the past 18 months via GitHub API"
- [ ] "Backfill is cursor-based resumable: re-running picks up where it left off using sync_state"
- [ ] "GitHub API rate consumption is throttled to ~2500 req/hour (50% of authenticated limit) to leave room for normal operations"
- [ ] "Verbose logging reports every batch with counts, PR numbers, and running totals"
- [ ] "Bot-authored PRs are skipped during backfill per user decision"
- [ ] "Each fetched comment is chunked, embedded via VoyageAI, and stored in review_comments table"

## Files

- `src/knowledge/review-comment-backfill.ts`
- `src/knowledge/review-comment-backfill.test.ts`
- `scripts/backfill-review-comments.ts`
- `src/knowledge/index.ts`
- `package.json`
