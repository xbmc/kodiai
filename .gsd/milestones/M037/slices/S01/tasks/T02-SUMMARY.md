---
id: T02
parent: S01
milestone: M037
key_files:
  - src/knowledge/suggestion-cluster-builder.ts
  - src/knowledge/suggestion-cluster-builder.test.ts
key_decisions:
  - Builder queries learning_memories directly via sql — avoids coupling to LearningMemoryStore interface
  - Outcome classification via closed Set at module scope — unknown outcomes silently skipped
  - Two independent HDBSCAN runs per outcome class — positive/negative clustering fully decoupled
  - MIN_CLUSTER_MEMBERS threshold applied post-HDBSCAN to filter small clusters
  - Model saved even with zero centroids — supports cold-start where only one class has data
  - Fail-open pattern: buildClusterModel never throws, errors returned as built=false with skipReason
duration: 
verification_result: passed
completed_at: 2026-04-04T23:28:35.343Z
blocker_discovered: false
---

# T02: Add buildClusterModel function with HDBSCAN-based positive/negative centroid generation from learning memories

**Add buildClusterModel function with HDBSCAN-based positive/negative centroid generation from learning memories**

## What Happened

Created src/knowledge/suggestion-cluster-builder.ts with buildClusterModel(opts) that queries learning_memories, splits by outcome class (positive=accepted/thumbs_up, negative=suppressed/thumbs_down), runs HDBSCAN independently on each class, computes mean centroids per cluster (dropping clusters below MIN_CLUSTER_MEMBERS=3), and saves a SuggestionClusterModel via SuggestionClusterStore. Fail-open: never throws, unknown outcomes silently skipped. Model saved even when one class has zero centroids for cold-start support. Added 26 unit tests covering centroid generation, outcome splitting, min-member thresholds, embedding parsing, and all error paths.

## Verification

bun test ./src/knowledge/suggestion-cluster-builder.test.ts → 26 pass, 0 fail; bun run tsc --noEmit → exit 0

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/knowledge/suggestion-cluster-builder.test.ts` | 0 | ✅ pass | 21ms |
| 2 | `bun run tsc --noEmit` | 0 | ✅ pass | 6500ms |

## Deviations

Only hdbscan.ts reused directly (not cluster-pipeline.ts/cluster-matcher.ts) — meanEmbedding and HDBSCAN wiring implemented locally to avoid coupling cache-management module to review pipeline.

## Known Issues

None.

## Files Created/Modified

- `src/knowledge/suggestion-cluster-builder.ts`
- `src/knowledge/suggestion-cluster-builder.test.ts`
