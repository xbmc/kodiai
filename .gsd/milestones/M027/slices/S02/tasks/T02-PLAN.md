---
estimated_steps: 5
estimated_files: 4
---

# T02: Implement bounded wiki repair engine and durable checkpoint state

**Slice:** S02 — Timeout-Hardened Wiki Repair Path
**Milestone:** M027

## Description

Build the reusable wiki repair engine that repairs only degraded rows, processes large pages in conservative contextual windows, persists sub-page checkpoints, and writes model-correct embeddings in batched durable units.

## Steps

1. Create `src/knowledge/wiki-embedding-repair.ts` with repair planning/execution primitives for target-row selection, page-window splitting, retry/fallback orchestration, and result reporting.
2. Extend `src/knowledge/wiki-store.ts` with repair-specific queries/state helpers for degraded wiki rows, dedicated repair checkpoint persistence, and batched embedding updates per bounded window.
3. Update `src/knowledge/embeddings.ts` or add a repair-specific wrapper so the engine can tell transient timeout/429/5xx failures apart from size/token pressure instead of treating every empty result the same.
4. Ensure the engine always writes `voyage-context-3`, skips already-correct rows, and resumes from persisted `page_id` plus `window_index` state rather than restarting from page 1.
5. Make `src/knowledge/wiki-embedding-repair.test.ts` pass.

## Must-Haves

- [ ] Repair state is persisted in a dedicated surface separate from `wiki_sync_state` and includes cursor, counts, last failure class, and timestamps.
- [ ] Large pages degrade hierarchically (bounded window -> smaller windows -> single chunk only as last resort) instead of immediate per-chunk explosion.
- [ ] Database writes occur in batches aligned to bounded work units, not one row update per chunk.

## Verification

- `bun test src/knowledge/wiki-embedding-repair.test.ts`
- Optional focused smoke during execution: invoke the engine through a local test helper to confirm checkpoint advancement after a simulated interruption.

## Observability Impact

- Signals added/changed: Durable checkpoint rows and structured repair result objects with counts, cursor, failure class, and retry metadata.
- How a future agent inspects this: Query the repair status surface through the CLI or store helpers to see exactly where a run stopped and why.
- Failure state exposed: Last failed window, failure class, and cumulative repaired/skipped/failed counts become inspectable instead of disappearing into timeout retries.

## Inputs

- `src/knowledge/wiki-store.ts` — existing authoritative wiki persistence and sync-state patterns.
- `src/knowledge/embeddings.ts` — current contextual embedding helper that hides failure classes.
- `T01-PLAN.md` — locked contracts for bounded windows, state advancement, and batched writes.

## Expected Output

- `src/knowledge/wiki-embedding-repair.ts` — reusable repair engine and result types.
- `src/knowledge/wiki-store.ts` — repair-target queries, dedicated checkpoint helpers, and batched update support.
- `src/knowledge/embeddings.ts` — repair-usable failure classification surface.
- `src/knowledge/wiki-embedding-repair.test.ts` — passing engine contract tests.
