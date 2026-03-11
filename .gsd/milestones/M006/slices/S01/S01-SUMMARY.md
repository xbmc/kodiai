---
id: S01
parent: M006
milestone: M006
provides:
  - Learning memory store initialized at application startup with sqlite-vec health check
  - Embedding provider wired from VOYAGE_API_KEY (or no-op fallback)
  - Async fire-and-forget memory writes in review handler after review completion
  - Run state purge at startup (30-day retention)
  - Integration tests for memory store write, retrieval, repo isolation, stale management
  - LearningMemoryRecord, EmbeddingProvider, LearningMemoryStore type contracts
  - Voyage AI embedding provider with fail-open semantics
  - sqlite-vec backed memory store with vec0 virtual table and repo partition key
  - Isolation layer with repo-scoped retrieval and optional owner-level sharing
  - Extended config schema with knowledge.embeddings and knowledge.sharing sections
  - run_state SQLite table with UNIQUE constraint on run_key for durable idempotency
  - RunStatus, RunStateCheck, RunStateRecord types
  - checkAndClaimRun, completeRun, purgeOldRuns methods on KnowledgeStore
  - SHA-keyed run identity integrated into review handler before workspace creation
requires: []
affects: []
key_files: []
key_decisions:
  - "Learning memory store uses its own Database connection to the shared knowledge DB (safe with WAL mode concurrent readers)"
  - "Embedding provider initialized as no-op when VOYAGE_API_KEY missing -- server starts fully functional without it"
  - "Learning memory writes are fire-and-forget (Promise.resolve().then) and never block review completion"
  - "reviewId hoisted to outer scope so both knowledgeStore and learningMemoryStore blocks can access it"
  - "Fixed vec0 embedding dimension at 1024 for v0.5 -- changing dimensions requires table recreation"
  - "Owner-level shared pool queries up to 5 most-active repos via partition iteration rather than separate unpartitioned table"
  - "Added retrieveMemoriesForOwner to LearningMemoryStore interface for shared pool queries"
  - "Duplicate memory writes handled via UNIQUE constraint and fail-open skip (not error)"
  - "Run identity keyed by SHA pair (base+head), not delivery ID -- catches GitHub retries"
  - "Run state check placed inside job callback before workspace creation for maximum cost savings"
  - "Fail-open design: run state errors log warning and proceed with review"
  - "Existing marker-based idempotency retained as defense-in-depth"
  - "Superseded run retention is 7 days; completed run retention is 30 days (configurable)"
patterns_established:
  - "Fire-and-forget async pattern: Promise.resolve().then(async () => { ... }).catch() for non-blocking post-review work"
  - "Fail-open startup: try/catch around learning memory init, server starts normally if sqlite-vec fails"
  - "Separate DB connection pattern: learning memory opens its own connection to the same WAL-mode DB file"
  - "Fail-open pattern: embedding provider returns null on any error, memory store degrades to no-op if sqlite-vec fails"
  - "Partition-key isolation: vec0 repo partition key enforces storage-level scoping without application filtering"
  - "Provenance logging: all retrieval results include full source repo attribution for debugging"
  - "SHA-pair run key format: {repo}:pr-{N}:base-{sha}:head-{sha}"
  - "Transactional claim-or-skip: check + supersede + insert in single SQLite transaction"
  - "Fail-open idempotency: try/catch around run state check, proceed on error"
observability_surfaces: []
drill_down_paths: []
duration: 3min
verification_result: passed
completed_at: 2026-02-13
blocker_discovered: false
---
# S01: State Memory And Isolation Foundation

**# Phase 30 Plan 03: Learning Memory Wiring Summary**

## What Happened

# Phase 30 Plan 03: Learning Memory Wiring Summary

**Learning memory store and Voyage AI embedding provider wired into startup lifecycle and review handler with async fire-and-forget memory writes and 8 integration tests**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-13T07:20:16Z
- **Completed:** 2026-02-13T07:23:04Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Wired learning memory store initialization into application startup with sqlite-vec health check and fail-open degradation
- Created embedding provider from VOYAGE_API_KEY environment variable with no-op fallback for environments without the key
- Added startup purge of old run state entries (30-day retention) alongside existing telemetry purge
- Integrated async fire-and-forget memory write pipeline into review handler after review completion
- Created 8 integration tests covering table creation, write/retrieval, repo isolation, UNIQUE constraint, stale marking, and purge

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire learning memory into startup and review handler** - `fc70daf873` (feat)
2. **Task 2: Integration tests for learning memory store** - `c515826a86` (test)

## Files Created/Modified
- `src/index.ts` - Added learning memory store initialization, embedding provider creation, run state purge, and passing deps to review handler
- `src/handlers/review.ts` - Added learningMemoryStore/embeddingProvider deps, hoisted reviewId, async memory write pipeline after review
- `src/learning/memory-store.test.ts` - 8 integration tests for memory store with sqlite-vec skip guard

## Decisions Made
- Learning memory store gets its own Database connection to the shared knowledge DB file -- safe with WAL mode concurrent readers, avoids exposing internals of createKnowledgeStore
- reviewId hoisted from inside `if (knowledgeStore)` block to outer scope so learning memory write can reference it
- Memory writes use `Promise.resolve().then(async () => {...}).catch()` pattern for truly non-blocking fire-and-forget behavior
- No-op embedding provider used when VOYAGE_API_KEY is not set -- server fully functional without external API key

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required at this time. VOYAGE_API_KEY environment variable is needed at runtime for embedding generation but is handled fail-open (no key = no-op provider).

## Next Phase Readiness
- Phase 30 complete: run state idempotency (Plan 01), learning memory infrastructure (Plan 02), and application wiring (Plan 03) all shipped
- Review pipeline now writes findings to learning memory asynchronously after each review
- Learning retrieval can be added in future phases by querying the memory store with embedding similarity
- All modules follow fail-open patterns: review pipeline never breaks if sqlite-vec or Voyage AI is unavailable

## Self-Check: PASSED

All files exist and all commits verified.

---
*Phase: 30-state-memory-and-isolation-foundation*
*Completed: 2026-02-13*

# Phase 30 Plan 02: Learning Memory Infrastructure Summary

**sqlite-vec backed vector memory store with Voyage AI embedding provider, repo partition key isolation, and owner-level shared pool retrieval with full provenance**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-13T07:13:45Z
- **Completed:** 2026-02-13T07:17:58Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Installed sqlite-vec and voyageai dependencies; created full type contract surface for learning memory
- Built fail-open Voyage AI embedding provider with no-op fallback for missing API keys
- Created vec0-backed memory store with repo partition key, KNN retrieval, stale marking, and purge
- Implemented isolation layer with repo-scoped retrieval, owner-level sharing across partitions, and full provenance
- Extended config schema with backward-compatible knowledge.embeddings and knowledge.sharing sections (5 new tests)

## Task Commits

Each task was committed atomically:

1. **Task 1: Install dependencies, create learning types, and extend config schema** - `52417dbeb8` (feat)
2. **Task 2: Create embedding provider, memory store, and isolation module** - `87a04d51fc` (feat)

## Files Created/Modified
- `src/learning/types.ts` - LearningMemoryRecord, EmbeddingProvider, LearningMemoryStore, RetrievalWithProvenance contracts
- `src/learning/embedding-provider.ts` - Voyage AI wrapper with fail-open, no-op provider fallback
- `src/learning/memory-store.ts` - vec0 virtual table management, writeMemory, retrieveMemories, purgeStaleEmbeddings
- `src/learning/isolation.ts` - Repo-scoped retrieval, owner-level shared pool, provenance logging
- `package.json` - Added sqlite-vec and voyageai dependencies
- `src/execution/config.ts` - Extended knowledgeSchema with embeddings and sharing sub-schemas
- `src/execution/config.test.ts` - 5 new tests for embeddings/sharing config parsing and backward compatibility

## Decisions Made
- Fixed vec0 embedding dimension at 1024 for v0.5 (configurable per-record metadata but table is fixed) -- changing requires table recreation
- Owner-level shared pool implemented via iterating up to 5 most-active repo partitions rather than a separate unpartitioned vec0 table (simpler, avoids second table maintenance)
- Added `retrieveMemoriesForOwner` to LearningMemoryStore interface (not in original plan which only had `retrieveMemories`) to support shared pool queries cleanly
- Duplicate memory writes are silently skipped via UNIQUE constraint + fail-open catch, not treated as errors

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added retrieveMemoriesForOwner to LearningMemoryStore type**
- **Found during:** Task 2 (isolation module implementation)
- **Issue:** Plan mentioned adding `retrieveMemoriesForOwner` to memory store but it was not in the original type definition in Task 1
- **Fix:** Added the method to the LearningMemoryStore type in types.ts during Task 1 implementation (anticipating Task 2 need)
- **Files modified:** src/learning/types.ts
- **Verification:** isolation.ts compiles and uses the method correctly
- **Committed in:** 52417dbeb8 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Essential for shared pool retrieval to work. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required. VOYAGE_API_KEY environment variable will be needed at runtime but is handled fail-open (no key = no-op provider).

## Next Phase Readiness
- Learning memory infrastructure complete and ready for wiring into review handler (Plan 03)
- All modules follow fail-open patterns: review pipeline will not break if sqlite-vec or Voyage AI is unavailable
- Config schema is backward-compatible: existing .kodiai.yml files parse without changes

---
*Phase: 30-state-memory-and-isolation-foundation*
*Completed: 2026-02-13*

# Phase 30 Plan 01: Run State Idempotency Summary

**Durable SHA-keyed run state table in KnowledgeStore with review handler integration for idempotent webhook processing**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-13T07:13:45Z
- **Completed:** 2026-02-13T07:17:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- run_state SQLite table with UNIQUE constraint on run_key for durable, restart-surviving idempotency
- checkAndClaimRun uses transactional claim-or-skip with automatic force-push supersession
- Review handler skips duplicate SHA pairs before expensive workspace creation
- completeRun called after successful review for audit trail
- Full test coverage: 6 new run state tests, all 312 project tests green

## Task Commits

Each task was committed atomically:

1. **Task 1: Add run_state table and RunState API to KnowledgeStore** - `3cf2a8826f` (feat)
2. **Task 2: Integrate run state idempotency into review handler** - `2780dd3c95` (feat)

## Files Created/Modified
- `src/knowledge/types.ts` - Added RunStatus, RunStateCheck, RunStateRecord types and KnowledgeStore interface methods
- `src/knowledge/store.ts` - Added run_state table creation, prepared statements, checkAndClaimRun/completeRun/purgeOldRuns implementations
- `src/knowledge/store.test.ts` - Added 6 run state tests (new, duplicate, supersede, complete, purge, delivery-id-independence)
- `src/handlers/review.ts` - Added early run state check before workspace creation and completeRun after knowledge store recording

## Decisions Made
- Run identity keyed by SHA pair (base+head), not delivery ID, so GitHub retries for the same SHA pair are caught as duplicates
- Run state check placed inside job callback (not before enqueue) for serialized access to SQLite
- Fail-open design: if knowledgeStore is undefined or SQLite query throws, review proceeds normally
- Existing marker-based idempotency (ensureReviewOutputNotPublished) retained as defense-in-depth for DB migration scenarios
- Superseded runs purged after 7 days, completed runs after 30 days (default, configurable via purgeOldRuns parameter)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Run state infrastructure ready for 30-02 (embedding storage) and 30-03 (isolation boundaries)
- purgeOldRuns available for startup lifecycle integration (e.g., alongside existing telemetryStore.purgeOlderThan)
- In-memory webhook deduplicator (src/webhook/dedup.ts) intentionally preserved for non-review event dedup

## Self-Check: PASSED

All files exist and all commits verified.

---
*Phase: 30-state-memory-and-isolation-foundation*
*Completed: 2026-02-13*
