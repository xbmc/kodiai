# S01: Pr Review Comment Ingestion

**Goal:** Create the PostgreSQL schema, store module, and chunking logic for PR review comment ingestion.
**Demo:** Create the PostgreSQL schema, store module, and chunking logic for PR review comment ingestion.

## Must-Haves


## Tasks

- [x] **T01: 89-pr-review-comment-ingestion 01** `est:2min`
  - Create the PostgreSQL schema, store module, and chunking logic for PR review comment ingestion.

Purpose: Establish the data layer that backfill (Plan 02), incremental sync (Plan 03), and retrieval (Plan 04) all depend on. Schema must support full metadata, vector search, and multi-repo scoping.
Output: Migration file, store module with write/read/search operations, type definitions, and thread-aware chunker.
- [x] **T02: 89-pr-review-comment-ingestion 02** `est:3min`
  - Build the backfill CLI that fetches 18 months of PR review comments from xbmc/xbmc via GitHub API, chunks them, embeds them, and stores them in the review_comments table.

Purpose: Populate the review comment corpus with historical human review patterns that the bot can reference when reviewing new PRs.
Output: Backfill engine module and CLI script (`npm run backfill:reviews`).
- [x] **T03: 89-pr-review-comment-ingestion 03** `est:2min`
  - Implement incremental sync of PR review comments via webhook handlers for create, edit, and delete events.

Purpose: Keep the review comment corpus up-to-date in real-time as new reviews happen, without requiring manual backfill re-runs.
Output: Webhook handler module registered on the event router, with background embedding via job queue.
- [x] **T04: 89-pr-review-comment-ingestion 04** `est:5min`
  - Wire the review comment corpus into the existing retrieval pipeline and add inline citation formatting so the bot can cite human review precedents in its responses.

Purpose: Make 18 months of human review patterns actionable — the bot should surface "reviewers have historically flagged this pattern" evidence when reviewing new PRs.
Output: Updated retrieval pipeline with review comment fan-out, and prompt builder with citation formatting.
- [x] **T05: 89-pr-review-comment-ingestion 05** `est:2min`
  - Fix embedding persistence across the review comment pipeline so generated embeddings are stored in PostgreSQL instead of discarded.

Purpose: Close the critical gap where VoyageAI embeddings are computed (incurring API cost) but thrown away, leaving all review_comments rows with NULL embedding and making vector search non-functional.
Output: Four coordinated file changes that complete the embedding data flow from generation through storage to search.

## Files Likely Touched

- `src/db/migrations/005-review-comments.sql`
- `src/db/migrations/005-review-comments.down.sql`
- `src/knowledge/review-comment-store.ts`
- `src/knowledge/review-comment-store.test.ts`
- `src/knowledge/review-comment-types.ts`
- `src/knowledge/review-comment-chunker.ts`
- `src/knowledge/review-comment-chunker.test.ts`
- `src/knowledge/review-comment-backfill.ts`
- `src/knowledge/review-comment-backfill.test.ts`
- `scripts/backfill-review-comments.ts`
- `src/knowledge/index.ts`
- `package.json`
- `src/handlers/review-comment-sync.ts`
- `src/handlers/review-comment-sync.test.ts`
- `src/index.ts`
- `src/knowledge/retrieval.ts`
- `src/knowledge/retrieval.test.ts`
- `src/knowledge/review-comment-retrieval.ts`
- `src/knowledge/review-comment-retrieval.test.ts`
- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`
- `src/knowledge/index.ts`
- `src/index.ts`
- `src/handlers/review.ts`
- `src/knowledge/review-comment-types.ts`
- `src/knowledge/review-comment-store.ts`
- `src/knowledge/review-comment-backfill.ts`
- `src/handlers/review-comment-sync.ts`
