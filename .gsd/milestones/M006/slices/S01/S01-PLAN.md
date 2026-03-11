# S01: State Memory And Isolation Foundation

**Goal:** Add durable SHA-keyed run state to the knowledge store and integrate it into the review handler for idempotent webhook processing.
**Demo:** Add durable SHA-keyed run state to the knowledge store and integrate it into the review handler for idempotent webhook processing.

## Must-Haves


## Tasks

- [x] **T01: 30-state-memory-and-isolation-foundation 01** `est:3min`
  - Add durable SHA-keyed run state to the knowledge store and integrate it into the review handler for idempotent webhook processing.

Purpose: Replace the fragile in-memory delivery ID deduplicator (for review path) with a SQLite-backed run state table that survives restarts, handles force-push supersession, and prevents duplicate reviews for the same SHA pair. This satisfies REL-01.
Output: run_state table in knowledge DB, RunState types, checkAndClaimRun/completeRun/purgeOldRuns on KnowledgeStore, review handler integration.
- [x] **T02: 30-state-memory-and-isolation-foundation 02** `est:4min`
  - Create the learning memory infrastructure: embedding provider, vector-backed memory store, isolation logic, and config extensions.

Purpose: Build the LEARN-06 and REL-03 foundation -- sqlite-vec for vector storage with repo partition keys, Voyage AI for embedding generation (fail-open), and isolation enforcement with owner-level sharing opt-in. These modules are standalone and will be wired into the review handler in Plan 03.
Output: `src/learning/` module with types, embedding provider, memory store, and isolation; extended config schema.
- [x] **T03: 30-state-memory-and-isolation-foundation 03** `est:3min`
  - Wire the learning memory infrastructure into the application: startup initialization, post-review memory writes, and integration tests.

Purpose: Connect the run state (Plan 01), learning memory store, embedding provider, and isolation layer (Plan 02) into the live review flow. After this plan, accepted/suppressed findings are automatically embedded and stored in repo-scoped learning memory after each review. This completes the LEARN-06 and REL-03 integration.
Output: Updated index.ts with learning memory initialization, updated review handler with async memory writes, integration tests for memory store.

## Files Likely Touched

- `src/knowledge/types.ts`
- `src/knowledge/store.ts`
- `src/knowledge/store.test.ts`
- `src/handlers/review.ts`
- `package.json`
- `src/learning/types.ts`
- `src/learning/embedding-provider.ts`
- `src/learning/memory-store.ts`
- `src/learning/isolation.ts`
- `src/execution/config.ts`
- `src/execution/config.test.ts`
- `src/index.ts`
- `src/handlers/review.ts`
- `src/learning/memory-store.test.ts`
