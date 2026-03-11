# T02: 30-state-memory-and-isolation-foundation 02

**Slice:** S01 — **Milestone:** M005

## Description

Create the learning memory infrastructure: embedding provider, vector-backed memory store, isolation logic, and config extensions.

Purpose: Build the LEARN-06 and REL-03 foundation -- sqlite-vec for vector storage with repo partition keys, Voyage AI for embedding generation (fail-open), and isolation enforcement with owner-level sharing opt-in. These modules are standalone and will be wired into the review handler in Plan 03.
Output: `src/learning/` module with types, embedding provider, memory store, and isolation; extended config schema.

## Must-Haves

- [ ] "Learning memory writes are stored with embeddings and metadata scoped to the originating repository"
- [ ] "Embedding generation fails open -- review publishes without memory if Voyage AI call fails"
- [ ] "Retrieval for a repo cannot read memory from any other repo unless explicit sharing is enabled"
- [ ] "Owner-level sharing opt-in retrieves from shared pool filtered by owner"
- [ ] "Full provenance is logged showing which repos contributed to each retrieval result"

## Files

- `package.json`
- `src/learning/types.ts`
- `src/learning/embedding-provider.ts`
- `src/learning/memory-store.ts`
- `src/learning/isolation.ts`
- `src/execution/config.ts`
- `src/execution/config.test.ts`
