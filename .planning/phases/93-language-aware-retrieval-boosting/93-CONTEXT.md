# Phase 93: Language-Aware Retrieval Boosting - Context

**Gathered:** 2026-02-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Retrieval results are ranked using stored language metadata across all three corpora (learning memory, PR reviews, wiki). Records store their programming language at write time, existing records are backfilled via migration, and retrieval applies language-aware boosting. No new corpora or retrieval capabilities are added — this phase improves ranking quality within existing infrastructure.

</domain>

<decisions>
## Implementation Decisions

### Language Classification
- Ambiguous file extensions resolved using repository context (other files in the same PR/repo determine the language; e.g., `.h` treated as C++ if PR contains `.cpp` files), with fallback to most common usage
- C and C++ stored as separate languages but treated as related languages with affinity during retrieval boosting
- Files with unknown or missing extensions tagged as `unknown` — no boost or penalty during retrieval, ranked on semantic similarity alone
- Comprehensive taxonomy covering 30+ languages — map every known extension to its language rather than grouping into broad categories

### Backfill Strategy
- One-time migration script (not background job or lazy backfill)
- Classify from stored file paths only — no need for files to still exist on disk
- Idempotent: safe to re-run, only classifies records with no language set (skips already-classified)
- Stats summary logged at completion: total records, records per language, records marked 'unknown', failures

### Retrieval Boost Mechanics
- Query language determined from PR file extensions (files changed in the PR)
- For multi-language PRs, boost is proportional to change volume (80% C++ / 20% Python → C++ results get stronger boost)
- Boost matching languages only — non-matching results keep their original score, never penalized
- Related-language affinity (e.g., C/C++) uses a fixed fraction of exact-match boost (Claude decides exact ratio)
- Language weighting applied in exactly one location in the retrieval pipeline — no double-boost

### Wiki Language Tagging
- Multiple language affinity tags per wiki page (a page covering both Python and C++ gets both tags)
- Language affinity determined by content analysis at ingest time (code blocks, language mentions, API references)
- Non-code wiki pages (process, governance, etc.) explicitly tagged as `general` — no language boost, ranked on semantic similarity
- Language tags re-analyzed every time a wiki page is re-ingested — tags stay current as content evolves

### Claude's Discretion
- Exact boost factor magnitude and related-language affinity ratio
- Language detection implementation details (extension mapping data structure, content analysis approach for wiki)
- Migration script batch size and error handling specifics
- Database schema design for the language column(s)

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 93-language-aware-retrieval-boosting*
*Context gathered: 2026-02-25*
