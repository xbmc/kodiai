# Phase 88: Knowledge Layer Extraction - Context

**Gathered:** 2026-02-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Unify retrieval and embedding code into a single `src/knowledge/` module so GitHub review, mention handling, and Slack assistant all share one code path. Move files from `src/learning/` into `src/knowledge/`, create facade entry points, wire Slack retrieval, and delete `src/learning/` entirely.

</domain>

<decisions>
## Implementation Decisions

### Module boundary
- All retrieval/embedding files move from `src/learning/` to `src/knowledge/` — Claude decides the exact split of what stays vs moves based on coupling
- `src/learning/` gets fully removed after extraction (no re-export wrappers)
- Existing files in `src/knowledge/` (store.ts, confidence.ts, types.ts, db-path.ts) — Claude decides whether they stay alongside retrieval code or get separated

### Slack retrieval scope
- Slack uses the shared retrieval module with a simpler single-query approach (user's message as the query, not multi-variant)
- Retrieved context is woven into the system prompt inline (not a structured "Related findings:" block)
- Slack gets broader isolation: can retrieve across all repos the owner has (not just the repo being discussed)
- When no repo context is available, skip retrieval entirely — only retrieve when a repo is specified or inferable

### Retrieval API contract
- Text in, results out: callers pass raw text queries, embedding happens internally
- Multi-query is a first-class feature: `retrieve(['query1', 'query2', ...], opts)` — not a separate orchestrator
- Config uses sensible defaults from app config with caller overrides: module reads config internally, but callers CAN override topK, thresholds, etc.
- Write path (storing new memories): Claude decides whether it goes through the knowledge module or stays in handlers

### Handler refactor depth
- Handlers become fully thin: call `retrieve()` and get back final ranked results — all reranking, recency weighting, adaptive thresholds happen inside the knowledge module
- Variant building (intent, file-path, code-shape queries): Claude decides whether this stays in handlers or moves to knowledge module based on how context-specific the logic is
- Review and mention handlers call the same `retrieve()` function but can pass different options (topK, thresholds) — same code path, different tuning
- E2E test approach: Claude decides (integration vs mock-based) based on what best proves the success criteria

### Claude's Discretion
- Exact module boundary: which files move, which stay, barrel exports vs facades-only
- Whether write path goes through knowledge module
- Whether variant building moves to knowledge module or stays in handlers
- Testing approach for E2E success criteria
- How to handle existing knowledge/ files (store.ts, confidence.ts) alongside new retrieval code

</decisions>

<specifics>
## Specific Ideas

- Slack retrieval should feel invisible — context woven in naturally, not "here are 5 findings from past reviews"
- Multi-query as a first-class API, not bolted on — handlers shouldn't need to loop over variants themselves
- Clean break from src/learning/ — no backward-compat re-exports, just delete it

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 88-knowledge-layer-extraction*
*Context gathered: 2026-02-24*
