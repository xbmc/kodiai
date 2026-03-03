# Phase 120: Embedding Migration - Context

**Gathered:** 2026-03-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Migrate wiki corpus from voyage-code-3 to voyage-context-3 embeddings and add per-corpus model routing in the retrieval pipeline. All wiki page embeddings use voyage-context-3; all other corpora (code, reviews, issues, snippets) continue using voyage-code-3. Wiki store accepts embedding model as a parameter. Future wiki sync automatically uses voyage-context-3 via the contextualized embedding API.

</domain>

<decisions>
## Implementation Decisions

### Contextualization strategy
- Use Voyage's contextualized embedding API for wiki document embeddings
- Full page text as context for each wiki chunk (no truncation, no cost cap — quality over cost)
- Query embeddings for wiki searches also use contextualization — pass PR diff or conversation context as the query context
- Asymmetry: document context = full page text; query context = PR diff / conversation / triggering context from the retrieval pipeline

### Migration cutover
- Offline swap approach: run backfill script to re-embed all wiki pages, then flip the model config
- Wiki search may return mixed/stale results during backfill window — acceptable
- Overwrite embeddings in place (no shadow column, no backup of old embeddings)
- Success criterion: zero rows with voyage-code-3 in wiki_pages after backfill completes

### Validation approach
- Reusable embedding comparison benchmark script in scripts/ (not one-time — kept for future model evaluations)
- Output: console table for quick review + JSON file for detailed analysis
- Runs N queries against old vs new embeddings, shows top results and distance scores side by side
- Claude's Discretion: eval query set selection (hardcoded known-good queries vs production log sampling)

### Dimension configuration
- Use voyage-context-3's native output dimensions (not forced to 1024)
- If native dimension is <= 1024: ALTER TABLE wiki_pages to match native dim
- If native dimension is > 1024: stay at 1024 using outputDimension parameter (avoid index rebuilds and storage increase)
- Per-corpus dimension tracking follows naturally from per-corpus model routing

### Claude's Discretion
- Backfill script mechanics (sequential with delay vs batch with checkpointing, rate limit handling, progress tracking)
- Eval query set composition for the comparison benchmark
- Exact plumbing for passing PR diff/conversation context into wiki query embedding calls

</decisions>

<specifics>
## Specific Ideas

- User wants both document and query contextualization — not just the Voyage-recommended asymmetric approach
- Quality over cost: full page text context, no truncation, no token budget caps
- Benchmark script should be reusable for future model changes (voyage-context-4, etc.)
- Native dimensions preferred over forced 1024 — "wouldn't it be better to use native dimension than force it to use 1024?"

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `createEmbeddingProvider()` in `src/knowledge/embeddings.ts`: Already parameterized for model/dimensions — can create multiple providers
- `EmbeddingProvider` interface in `src/knowledge/types.ts`: Has `model` and `dimensions` getters, `generate(text, inputType)` method
- `wiki-sync.ts`: Already model-agnostic — uses injected `embeddingProvider`, just needs a different provider
- `wiki-backfill.ts`: Existing backfill infrastructure for wiki pages

### Established Patterns
- Fail-open semantics: All embedding operations return null on failure, never throw
- Factory pattern: `createWikiPageStore()`, `createRetriever()` — dependency injection via opts
- Single embedding provider created in `src/index.ts:147` and passed everywhere

### Integration Points
- `src/index.ts:147-153`: Where the single embedding provider is created — needs to become per-corpus
- `wiki-store.ts:87,131`: Hardcoded `"voyage-code-3"` in writeChunks and replacePageChunks — needs parameterization (EMBED-03)
- `retrieval.ts:441-448`: Wiki vector search uses the single shared embeddingProvider — needs wiki-specific provider (EMBED-04)
- `review-comment-store.ts:100,155` and `issue-store.ts:129,286`: Also hardcode voyage-code-3 but stay on that model
- `execution/config.ts:244`: Config schema has `embeddings.model` defaulting to voyage-code-3 — may need per-corpus config

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 120-embedding-migration*
*Context gathered: 2026-03-02*
