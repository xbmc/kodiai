# T03: 30-state-memory-and-isolation-foundation 03

**Slice:** S01 — **Milestone:** M007

## Description

Wire the learning memory infrastructure into the application: startup initialization, post-review memory writes, and integration tests.

Purpose: Connect the run state (Plan 01), learning memory store, embedding provider, and isolation layer (Plan 02) into the live review flow. After this plan, accepted/suppressed findings are automatically embedded and stored in repo-scoped learning memory after each review. This completes the LEARN-06 and REL-03 integration.
Output: Updated index.ts with learning memory initialization, updated review handler with async memory writes, integration tests for memory store.

## Must-Haves

- [ ] "Learning memory writes happen asynchronously after review completion, not in the review critical path"
- [ ] "sqlite-vec is loaded at startup with a health check logging the version"
- [ ] "If sqlite-vec fails to load, server starts normally with learning memory disabled"
- [ ] "Accepted and suppressed findings are written to learning_memories with embeddings after each review"
- [ ] "Run state is purged on startup following retention policy"
- [ ] "Retrieval for a repo cannot read memory from any other repo unless explicit sharing is enabled"

## Files

- `src/index.ts`
- `src/handlers/review.ts`
- `src/learning/memory-store.test.ts`
