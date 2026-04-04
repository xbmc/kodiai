---
id: T01
parent: S01
milestone: M037
key_files:
  - src/db/migrations/036-suggestion-cluster-models.sql
  - src/knowledge/suggestion-cluster-store.ts
  - src/knowledge/suggestion-cluster-store.test.ts
key_decisions:
  - Centroids stored as JSONB number[][] (not pgvector) — ephemeral cache rows don't need ANN index
  - Standalone store module, not added to KnowledgeStore interface
  - getModel filters stale; getModelIncludingStale omits TTL filter for refresh job use
  - positiveMemberCount + negativeMemberCount tracked separately for cold-start gating diagnostics
duration: 
verification_result: passed
completed_at: 2026-04-04T23:24:50.378Z
blocker_discovered: false
---

# T01: Added suggestion_cluster_models table migration, SuggestionClusterStore factory, and 29 unit tests for cluster model persistence and retrieval

**Added suggestion_cluster_models table migration, SuggestionClusterStore factory, and 29 unit tests for cluster model persistence and retrieval**

## What Happened

Created the cluster-model schema (migration 036), a standalone SuggestionClusterStore with getModel/getModelIncludingStale/saveModel/deleteModel/listExpiredModelRepos, and 29 unit tests covering serialization, TTL filtering, error paths, and Float32Array round-trips. Centroids are stored as JSONB number[][] rather than pgvector to avoid a new column type dependency; the scoring path in T02 reads them sequentially. Store is kept separate from KnowledgeStore to isolate ephemeral cache concerns from durable record-keeping.

## Verification

bun test ./src/knowledge/suggestion-cluster-store.test.ts → 29 pass, 0 fail; bun run tsc --noEmit → exit 0

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/knowledge/suggestion-cluster-store.test.ts` | 0 | ✅ pass | 3900ms |
| 2 | `bun run tsc --noEmit` | 0 | ✅ pass | 6500ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `src/db/migrations/036-suggestion-cluster-models.sql`
- `src/knowledge/suggestion-cluster-store.ts`
- `src/knowledge/suggestion-cluster-store.test.ts`
