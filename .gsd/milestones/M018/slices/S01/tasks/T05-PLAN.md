# T05: 89-pr-review-comment-ingestion 05

**Slice:** S01 — **Milestone:** M018

## Description

Fix embedding persistence across the review comment pipeline so generated embeddings are stored in PostgreSQL instead of discarded.

Purpose: Close the critical gap where VoyageAI embeddings are computed (incurring API cost) but thrown away, leaving all review_comments rows with NULL embedding and making vector search non-functional.
Output: Four coordinated file changes that complete the embedding data flow from generation through storage to search.

## Must-Haves

- [ ] "ReviewCommentChunk type carries an optional embedding field (Float32Array | null)"
- [ ] "writeChunks() INSERT includes the embedding column when chunk.embedding is present"
- [ ] "updateChunks() INSERT includes the embedding column when chunk.embedding is present"
- [ ] "embedChunks() in backfill assigns generated embedding to chunk.embedding instead of discarding it"
- [ ] "embedChunks() in sync handler assigns generated embedding to chunk.embedding instead of discarding it"
- [ ] "searchByEmbedding() filters out rows with NULL embedding to avoid NaN distances"

## Files

- `src/knowledge/review-comment-types.ts`
- `src/knowledge/review-comment-store.ts`
- `src/knowledge/review-comment-backfill.ts`
- `src/handlers/review-comment-sync.ts`
