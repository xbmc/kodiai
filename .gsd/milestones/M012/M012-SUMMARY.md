---
id: M012
milestone: M012
verification_result: passed
completed_at: migrated
---

# M012: Operator Reliability & Retrieval Quality

**Migrated from v0.12 milestone summary**

## What Happened

## v0.12 Operator Reliability & Retrieval Quality (Shipped: 2026-02-17)

**Scope:** 6 phases (66-71), 11 plans, 21 tasks

**Key accomplishments:**
- Repository-scoped Search API caching now uses deterministic keys, TTL reuse, and in-flight de-duplication to reduce redundant search calls.
- Rate-limit handling now retries once, degrades safely when needed, and consistently discloses partial analysis in output.
- OPS-03 telemetry now reports true Search cache behavior by wiring `cacheHitRate` to Search cache hit/miss semantics.
- Multi-query retrieval is live across review and mention paths with deterministic merge/rerank and variant-level fail-open behavior.
- Retrieval evidence now includes snippet anchors with strict prompt-budget trimming and deterministic path-only fallback.
- Conversational UX is unified across issue/PR/review surfaces with one targeted clarifying-question fallback when context is insufficient.

---
