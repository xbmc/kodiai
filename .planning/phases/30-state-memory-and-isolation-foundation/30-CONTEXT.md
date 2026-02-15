# Phase 30: State, Memory, and Isolation Foundation - Context

**Gathered:** 2026-02-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Establish durable repo-scoped learning/state contracts for safe incremental behavior. This phase creates the foundation for reviews to use immutable run identity and repo-only learning memory so incremental behavior is deterministic and tenancy-safe.

**What must be TRUE after this phase:**
1. Re-running the same webhook delivery for the same base/head SHA pair does not create duplicate published review state
2. Learning memory writes are stored with embeddings and metadata for accepted/suppressed findings and remain scoped to the originating repository
3. Retrieval for a repo cannot read memory from any other repo unless explicit sharing is enabled

</domain>

<decisions>
## Implementation Decisions

### Run identity design

- **Identity determination:** Claude decides based on idempotency and debugging needs (SHA pair vs delivery ID vs request context)
- **Force-push handling:** Old review marked as superseded when head SHA changes - keeps obsolete review in audit trail but flags it clearly
- **Requester impact:** Claude decides whether requester identity matters for run uniqueness based on common use cases
- **Observability:** Run identity exposed in logs only, not in user-facing review comments (minimize noise)

### Embedding storage approach

- **Storage backend:** SQLite with vector extension (sqlite-vss or similar) for vector similarity search in same database
- **Embedding model:** Voyage AI with migration support - allow model version upgrades with background re-embedding of old memories
- **Embedding content:** Finding text + metadata (severity, category, file path enriched as context)
- **Failure handling:** Fail-open - review publishes without memory if embedding generation fails, logged but doesn't block publication

### Isolation boundaries

- **Default isolation:** Owner-level sharing opt-in - repos can participate in shared learning pool scoped to same GitHub owner/org
- **Sharing configuration:** Claude decides between config flag, allowlist, or admin API based on UX simplicity and control granularity
- **Opt-out behavior:** Immediate isolation when repo opts out - memory stops flowing to/from shared pool, but past contributions remain in pool
- **Retrieval provenance:** Yes - full provenance logged showing which repos contributed to each suggestion (for debugging and trust)

### Idempotency guarantees

- **Enforcement layer:** At ingestion - check run identity on webhook receipt, skip processing if already seen
- **Duplicate handling:** Claude decides between silent skip, logged skip, or tracking comment reaction based on debugging value vs noise
- **State persistence:** Claude decides retention duration based on storage cost vs reliability (PR duration, fixed window, or forever)
- **Re-request bypass:** Claude decides whether manual re-requests bypass idempotency based on UX expectations vs cost control

### Claude's Discretion

- Exact run identity composition (SHA pair, delivery ID, requester, timestamp combinations)
- SQLite vector extension choice (sqlite-vss, sqlite-vec, or other)
- Schema design for run state, memory records, and embedding storage
- Background migration strategy for embedding model version upgrades
- Shared pool querying and filtering algorithms
- Idempotency cache implementation (in-memory, database, or both)
- Duplicate webhook notification strategy
- Manual re-request bypass heuristics

</decisions>

<specifics>
## Specific Ideas

- **Run identity should be debuggable** - operators need to correlate webhook deliveries to review state in logs, but users don't need to see internal IDs
- **Fail-open philosophy** - embedding failures, retrieval failures, and migration issues should never block review publication (reliability over perfection)
- **Privacy-conscious sharing** - opt-in sharing at owner level balances learning quality with privacy, full provenance logging enables debugging without anonymizing
- **Superseded reviews stay visible** - force-push audit trail helps understand review history and why findings changed

</specifics>

<deferred>
## Deferred Ideas

None - discussion stayed within phase scope.

</deferred>

---

*Phase: 30-state-memory-and-isolation-foundation*
*Context gathered: 2026-02-13*
