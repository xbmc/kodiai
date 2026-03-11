# T01: 30-state-memory-and-isolation-foundation 01

**Slice:** S01 — **Milestone:** M006

## Description

Add durable SHA-keyed run state to the knowledge store and integrate it into the review handler for idempotent webhook processing.

Purpose: Replace the fragile in-memory delivery ID deduplicator (for review path) with a SQLite-backed run state table that survives restarts, handles force-push supersession, and prevents duplicate reviews for the same SHA pair. This satisfies REL-01.
Output: run_state table in knowledge DB, RunState types, checkAndClaimRun/completeRun/purgeOldRuns on KnowledgeStore, review handler integration.

## Must-Haves

- [ ] "Re-running the same webhook delivery for the same base/head SHA pair does not create duplicate published review state"
- [ ] "Force-pushed PRs mark prior run state as superseded with audit trail"
- [ ] "Run identity is keyed by SHA pair, not delivery ID, so GitHub retries are caught"
- [ ] "Run state survives process restarts (durable SQLite, not in-memory Map)"

## Files

- `src/knowledge/types.ts`
- `src/knowledge/store.ts`
- `src/knowledge/store.test.ts`
- `src/handlers/review.ts`
