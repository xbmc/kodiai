# Phase 1: Review Comment Backfill Reliability - Context

**Gathered:** 2026-03-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Improve the robustness and reliability of the review comment backfill pipeline — the system that fetches historical PR review comments from GitHub, chunks them, generates embeddings, and stores them in PostgreSQL for retrieval. Covers error handling, incremental sync, embedding recovery, and performance. Does NOT add new corpora or retrieval capabilities.

</domain>

<decisions>
## Implementation Decisions

### Error handling & retry
- Retry GitHub API page fetches with exponential backoff (3 retries), then abort the run — sync state preserves progress so next run resumes
- Isolate errors per-thread: if one thread fails to store, log the failure and continue processing remaining threads on the page
- Track failures via structured pino logs only (no separate failure table) — make log entries detailed and consistent
- Webhook sync handler stays fail-open as-is (already enqueued via jobQueue); focus retry improvements on batch backfill path

### Incremental sync gaps
- Add scheduled catch-up sync (similar to issue-backfill nightly pattern) that fetches comments since last_synced_at after initial backfill completes
- Webhooks handle real-time; catch-up is the safety net for missed deliveries or downtime
- Keep single-repo backfill design — orchestration of which repos to run lives elsewhere

### Embedding backfill
- Add periodic sweep job for chunks with null embeddings — query for embedding IS NULL, generate, update
- Model changes (voyage-code-3 → newer) handled via manual re-embed trigger, not automated detection

### Claude's Discretion
- Edit detection during catch-up sync (compare github_updated_at vs stored version)
- Dedup strategy for catch-up (ON CONFLICT DO NOTHING vs skip-if-exists check to save embedding API calls)
- Embedding sweep rate limiting (batch size, delays between batches)
- Embedding health observability (dedicated store method vs structured logs)
- Batch INSERT vs individual writes for store throughput
- Parallel embedding generation (concurrent promises vs batch API vs sequential)
- Page pipelining (fetch N+1 while processing N) vs sequential
- Progress reporting approach (enhanced logs vs callback)

</decisions>

<specifics>
## Specific Ideas

- Follow the existing issue-backfill nightly sync pattern for the catch-up job
- Fail-open philosophy is established and should be maintained — reliability improvements should make the pipeline more resilient, not more strict
- The embedding_model column already exists per chunk for audit purposes

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `review-comment-backfill.ts`: Main backfill with pagination, thread grouping, resume via sync state, adaptive rate limiting
- `review-comment-sync.ts`: Real-time webhook handler (created/edited/deleted) with jobQueue integration
- `review-comment-store.ts`: PostgreSQL store with pgvector, ON CONFLICT dedup, soft delete, sync state tracking
- `review-comment-chunker.ts`: Thread-based chunking logic
- `issue-backfill.ts`: Reference implementation for nightly sync pattern (can mirror for catch-up)

### Established Patterns
- Fail-open: embedding failures logged but never block critical path (null embeddings stored)
- Sync state table: cursor-based resume with `backfill_complete` flag and `last_synced_at`
- Job queue: webhook handlers enqueue work via `jobQueue.enqueue()` with structured metadata
- Adaptive rate delay: checks `x-ratelimit-remaining` headers and adds sleep when low

### Integration Points
- `backfillReviewComments()` called during app initialization or manually
- `createReviewCommentSyncHandler()` registered on event router for webhook events
- Store injected via `createReviewCommentStore()` factory
- VoyageAI embedding provider injected via `EmbeddingProvider` interface

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-review-comment-backfill-reliability*
*Context gathered: 2026-03-01*
