---
id: S01
parent: M037
milestone: M037
provides:
  - SuggestionClusterStore — persistence surface for S02 scoring and S03 staleness handling
  - buildClusterModel — centroid generation function for S02 to invoke at refresh time or on-demand
  - createClusterRefresh — background sweep entrypoint for S03 scheduler wiring
  - verify-m037-s01.ts proof harness — three deterministic checks (BUILD-AND-CACHE, REFRESH-SWEEP, FAIL-OPEN)
requires:
  []
affects:
  - S02
  - S03
key_files:
  - src/db/migrations/036-suggestion-cluster-models.sql
  - src/knowledge/suggestion-cluster-store.ts
  - src/knowledge/suggestion-cluster-store.test.ts
  - src/knowledge/suggestion-cluster-builder.ts
  - src/knowledge/suggestion-cluster-builder.test.ts
  - src/knowledge/suggestion-cluster-refresh.ts
  - src/knowledge/suggestion-cluster-refresh.test.ts
  - scripts/verify-m037-s01.ts
  - scripts/verify-m037-s01.test.ts
key_decisions:
  - Centroids stored as JSONB number[][] (not pgvector) — ephemeral cache rows don't need ANN index
  - SuggestionClusterStore is standalone, not part of KnowledgeStore interface — isolates ephemeral cache from durable record-keeping
  - getModel filters stale; getModelIncludingStale omits TTL filter — two surfaces serve live consumers and refresh job respectively
  - Builder queries learning_memories directly via sql, no LearningMemoryStore coupling — avoids coupling cache management to review-path interface evolution
  - Builder avoids cluster-pipeline.ts/cluster-matcher.ts import — those modules are live-review-path coupled
  - Fail-open in both builder (returns built=false, never throws) and refresh sweep (warn per crash, continue sweep)
  - Sequential sweep in createClusterRefresh — background work, logs ordered per-repo, no thundering-herd risk
  - Injectable _buildFn in createClusterRefresh — follows M032/S03 testable-executor pattern for unit testing without real DB
patterns_established:
  - SuggestionClusterStore dual-read surface (getModel TTL-filtered / getModelIncludingStale unfiltered) — use this pattern for any ephemeral cache table that has both live consumers and a background refresh job
  - Float32Array → JSONB round-trip requires Array.from() before serialization and new Float32Array(row) on deserialization — covered by centroid serialization round-trip tests
  - Injectable _buildFn on background sweep options for unit testing without DB — same pattern as M032/S03 createTestableExecutor
observability_surfaces:
  - createClusterRefresh emits structured logger.info on sweep completion with reposBuilt/reposSkipped/reposFailed/durationMs totals
  - createClusterRefresh emits logger.warn per failing repo with repo name and error message
  - buildClusterModel returns structured result with built, skipReason, positiveCentroidCount, negativeCentroidCount, memberCount, skippedClusters — callers can log or surface these
drill_down_paths:
  - .gsd/milestones/M037/slices/S01/tasks/T01-SUMMARY.md
  - .gsd/milestones/M037/slices/S01/tasks/T02-SUMMARY.md
  - .gsd/milestones/M037/slices/S01/tasks/T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-05T07:50:17.541Z
blocker_discovered: false
---

# S01: Cluster Model Build and Cache

**Built the cluster-model substrate: migration, standalone store, HDBSCAN builder, background refresh entrypoint, and three-check proof harness — 95 tests passing, tsc clean.**

## What Happened

Three tasks delivered the complete cluster-model substrate from schema through background refresh.

**T01 — Schema and Store:** Added `036-suggestion-cluster-models.sql` (ephemeral per-repo table with JSONB centroid columns and TTL expiry) and `SuggestionClusterStore` with five surface methods: `getModel` (TTL-filtered for live consumers), `getModelIncludingStale` (unfiltered for refresh job), `saveModel` (upsert with configurable TTL), `deleteModel`, and `listExpiredModelRepos`. Store is deliberately standalone — not added to `KnowledgeStore` — to isolate ephemeral cache concerns from durable record-keeping. Centroids stored as JSONB `number[][]` (not pgvector) because the scoring path reads a handful of centroids sequentially; no ANN index is needed. Float32Array serialization requires explicit `Array.from()` before JSON; the store handles this internally on both write and read paths. 29 unit tests.

**T02 — Builder:** `buildClusterModel(opts)` in `suggestion-cluster-builder.ts` queries `learning_memories` directly via the tagged-template `sql` function (no LearningMemoryStore coupling), splits rows by outcome class (positive=accepted/thumbs_up, negative=suppressed/thumbs_down, unknown outcomes silently skipped), runs HDBSCAN independently on each class, computes mean centroids per cluster, drops clusters below `MIN_CLUSTER_MEMBERS=3`, and saves via `SuggestionClusterStore`. Fail-open: never throws — errors returned as `{ built: false, skipReason }`. Model is saved even when one class has zero centroids (cold-start support). Deliberately avoids importing `cluster-pipeline.ts` / `cluster-matcher.ts` from the live review path to prevent coupling cache management to review-time logic evolution. 26 unit tests.

**T03 — Refresh and Proof Harness:** `createClusterRefresh(opts)` in `suggestion-cluster-refresh.ts` provides the bounded background sweep entrypoint. Sweeps either an explicit repo list or the store's expired-repo list (capped at `maxReposPerRun`, default 50). Sequential sweep (not parallel) keeps logs ordered and prevents DB thundering-herd on large expired lists. Fail-open: per-repo errors emit `logger.warn` and continue the sweep. Injectable `_buildFn` follows the M032/S03 testable-executor pattern for testing without a real DB or HDBSCAN. `scripts/verify-m037-s01.ts` provides a three-check proof harness (BUILD-AND-CACHE, REFRESH-SWEEP, FAIL-OPEN) with 20 deterministic unit tests. All 95 tests across 4 files pass; `bun run tsc --noEmit` exits 0.

## Verification

Ran all slice test files in sequence: `bun test ./src/knowledge/suggestion-cluster-store.test.ts ./src/knowledge/suggestion-cluster-builder.test.ts ./src/knowledge/suggestion-cluster-refresh.test.ts ./scripts/verify-m037-s01.test.ts` → 95 pass, 0 fail, 255 expect() calls. `bun run tsc --noEmit` → exit 0 (no output). All task-level verification commands also previously confirmed exit 0 per task summary.

## Requirements Advanced

None.

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

T02 did not reuse cluster-pipeline.ts/cluster-matcher.ts as the plan mentioned — those modules are wired to the live review path. meanEmbedding and HDBSCAN wiring were implemented locally to avoid coupling. This is the correct call and is documented in D031.

## Known Limitations

The cluster builder produces centroids but the scoring path (S02) is not yet wired into reviews. The refresh entrypoint exists but is not connected to a scheduler or cron job — that wiring will happen in S03 or via operator invocation.

## Follow-ups

S02 needs to implement the scoring function that consumes `SuggestionClusterStore.getModel()` at review time. S03 needs to wire `createClusterRefresh` to a scheduler and prove stale/unavailable models degrade cleanly.

## Files Created/Modified

- `src/db/migrations/036-suggestion-cluster-models.sql` — New migration — ephemeral per-repo cluster model table with JSONB centroid columns, TTL expiry, and member counts
- `src/knowledge/suggestion-cluster-store.ts` — New — SuggestionClusterStore factory with getModel/getModelIncludingStale/saveModel/deleteModel/listExpiredModelRepos
- `src/knowledge/suggestion-cluster-store.test.ts` — New — 29 unit tests covering serialization, TTL filtering, error paths, Float32Array round-trips
- `src/knowledge/suggestion-cluster-builder.ts` — New — buildClusterModel with HDBSCAN-based positive/negative centroid generation, fail-open semantics
- `src/knowledge/suggestion-cluster-builder.test.ts` — New — 26 unit tests covering centroid generation, outcome splitting, min-member thresholds, embedding parsing, error paths
- `src/knowledge/suggestion-cluster-refresh.ts` — New — createClusterRefresh bounded background sweep entrypoint with injectable _buildFn
- `src/knowledge/suggestion-cluster-refresh.test.ts` — New — 20 unit tests covering explicit repos, store sweep, maxReposPerRun, fail-open, mixed outcomes, result shape
- `scripts/verify-m037-s01.ts` — New — three-check proof harness (BUILD-AND-CACHE, REFRESH-SWEEP, FAIL-OPEN) with structured JSON/text output
- `scripts/verify-m037-s01.test.ts` — New — 20 unit tests for all three harness checks and evaluateM037S01/buildM037S01ProofHarness
- `.gsd/PROJECT.md` — Updated current state to M037/S01 complete; added cluster model substrate to architecture section
- `.gsd/KNOWLEDGE.md` — Added Float32Array→JSONB round-trip pattern and injectable _buildFn background refresh pattern
- `.gsd/DECISIONS.md` — Added D031 (builder isolation) and D032 (JSONB centroid storage)
