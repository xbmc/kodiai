# M027 / S01 — Research

**Date:** 2026-03-12

## Summary

S01 owns the read-only production proof surfaces for **R019 (cross-corpus audit)**, **R021 (query-time retrieval verification)**, and **R023 (model correctness)**, and it should lay contract groundwork for **R024 (regression coverage)**. The codebase already has the real retrieval boundary (`createRetriever`) and all persisted stores, but there is still **no single operator surface** that can tell an operator whether embeddings are present, model-correct, and actually usable through live retrieval. Research priority should stay on those proof surfaces, not on repair yet.

Primary recommendation: ship S01 as **two explicit commands with one shared contract**: (1) a read-only embedding audit that scans all persisted tables and emits deterministic JSON + human output, and (2) a retriever verifier that uses the same production wiring as `src/index.ts` and records whether query embedding generation succeeded, which corpora actually participated, and what attributed `unifiedResults` came back from `createRetriever(...).retrieve(...)`. The audit proves storage integrity; the verifier proves query-path reality.

The biggest slice-level risk is that **`issue_comments` are persisted but are not currently part of `createRetriever`**. The audit can and must cover them, but S01 cannot truthfully claim end-to-end retriever coverage for issue comments unless the retrieval fan-out is extended or the verifier contract explicitly distinguishes **audited persisted corpora** from **currently retriever-participating corpora**. That is the main correctness seam to retire during research before implementation starts.

## Recommendation

Build S01 around one small shared model:

- **Per-corpus audit record** for `learning_memories`, `review_comments`, `wiki_pages`, `code_snippets`, `issues`, and `issue_comments`
- **Verifier result record** for one live query through the production retriever
- **Stable machine-readable JSON** first, with human-readable summary as a rendering of the same data

Recommended approach:

1. **Add one read-only audit script first**
   - Query all six persisted corpus tables directly.
   - Emit per-corpus fields: `total`, `missing_or_null`, `stale`, `model_mismatch`, `expected_model`, `actual_models`, `status`, `severity`.
   - Handle corpus-specific semantics instead of forcing fake uniformity:
     - `learning_memories`: `stale` and non-null `embedding_model` always exist.
     - `review_comments` and `wiki_pages`: both have `stale` and nullable embeddings.
     - `code_snippets`: audit both `code_snippets` integrity and repo coverage via `code_snippet_occurrences`.
     - `issues` and `issue_comments`: no `stale` flag today, so `stale` should be reported as `0`/`not_supported`, not inferred.
   - Make wiki expect `voyage-context-3`; all other corpora expect `voyage-code-3`.

2. **Add one live retriever verifier second**
   - Reuse production provider wiring from `src/index.ts`, including wiki’s contextual provider.
   - Call `createRetriever(...).retrieve(...)` directly.
   - Record three separate states:
     - query embedding generated successfully
     - retriever returned no hits
     - retriever returned hits with source attribution in `unifiedResults`
   - Include corpus/source counts from `unifiedResults` so operators can see which live paths actually participated.

3. **Be explicit about current retrieval coverage gaps**
   - `createRetriever` currently searches learning memories, review comments, wiki, code snippets, and issues.
   - `issue_comments` are retrievable elsewhere (`thread-assembler.ts`) but not through `createRetriever`.
   - S01 should either extend `createRetriever` to include issue comments or make the verifier output an explicit `not_in_retriever` status for that persisted corpus. Hiding that distinction would make R021 look satisfied when it is not.

4. **Use existing tests as contract anchors, then add operator-surface tests**
   - Reuse retrieval E2E patterns to lock verifier output shape.
   - Add audit tests that lock per-corpus math and model expectations.
   - Keep the JSON contract deterministic so later slices can reuse it for repair-before/after verification.

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| Live retrieval proof | `src/knowledge/retrieval.ts` + `createRetriever(...)` | This is the real production fan-out, fail-open behavior, hybrid merge, and `unifiedResults` attribution path. Anything weaker would under-prove R021. |
| Production model routing | `src/index.ts` provider wiring | It is the source of truth for `voyage-code-3` vs `voyage-context-3`. Reusing it avoids verifier/model drift. |
| Corpus-level storage truth | Existing store schemas and migrations | The tables already encode where `embedding`, `embedding_model`, and `stale` do or do not exist. Audit logic should reflect those real schema differences. |
| Regression fixtures for retriever behavior | `src/knowledge/retrieval.e2e.test.ts` | It already exercises the shared retriever shape and preserves backward-compatible fields alongside `unifiedResults`. |
| Issue comment semantic retrieval pattern | `src/knowledge/thread-assembler.ts` | It proves issue comment embeddings are used elsewhere, which is useful evidence when deciding whether S01 must extend `createRetriever` or explicitly report the gap. |

## Existing Code and Patterns

- `src/index.ts` — production truth for embedding provider routing. Shared corpora use `voyage-code-3`; wiki uses `createContextualizedEmbeddingProvider(..., model: "voyage-context-3")`; the retriever is assembled here with the real stores.
- `src/knowledge/retrieval.ts` — real end-to-end verification seam. It fans out across learning memories, review comments, wiki pages, code snippets, and issues; returns `unifiedResults`; and fails open when per-corpus searches fail.
- `src/knowledge/embeddings.ts` — critical fail-open boundary. Query embedding generation returns `null` on timeout/API failure, so verifier output must distinguish `query_embedding_null` from `no_matches`.
- `src/knowledge/memory-store.ts` — learning memories are the most mature corpus operationally: non-null `embedding_model`, explicit `stale`, and model lifecycle helpers already exist.
- `src/knowledge/review-comment-store.ts` — review comments already expose useful audit/repair primitives: `countNullEmbeddings`, `getNullEmbeddingChunks`, `updateEmbedding`, and `stale` support.
- `src/knowledge/wiki-store.ts` — wiki persists `embedding_model` and `stale`, marks chunks stale when written without embeddings, and excludes stale/null/deleted rows from search.
- `src/knowledge/code-snippet-store.ts` — snippet integrity lives in two tables: vectors in `code_snippets`, repo scope in `code_snippet_occurrences`. Audit must consider both or it will overstate retrievability.
- `src/knowledge/issue-store.ts` — issues and issue comments both persist embeddings and embedding models, but only issues are currently wired into `createRetriever`; comments lack `stale` semantics.
- `src/knowledge/issue-retrieval.ts` — only top-level issues participate in the current unified retriever. This is the main S01 coverage gap versus persisted `issue_comments`.
- `src/knowledge/thread-assembler.ts` — issue comments already have semantic retrieval utility, but on a separate path from `createRetriever`.
- `scripts/backfill-wiki.ts` — still writes wiki embeddings with `voyage-code-3`; S01 audit should flag those rows as wiki model mismatches.
- `scripts/wiki-embedding-backfill.ts` — existing wiki repair path already verifies post-run `embedding_model`, which is a good pattern for the audit’s model-mismatch dimension.
- `package.json` — there is no existing audit/verifier operator alias yet, so S01 needs to create the stable entrypoints rather than layering on hidden scripts.

## Constraints

- The audit must cover **all six persisted corpus tables**, but the integrity dimensions are not uniform across them. `issues` and `issue_comments` do not currently have a `stale` column, so the audit cannot fabricate stale semantics.
- The verifier must use the **real production retriever path**, not direct table queries, or R021 stays unproven.
- `EmbeddingProvider.generate()` is fail-open and may return `null`; the verifier must make that state explicit instead of collapsing it into “no results”.
- Wiki must be audited against `voyage-context-3`, while all other persisted corpora expect `voyage-code-3`.
- `code_snippets` retrieval is repo-scoped through `code_snippet_occurrences`, so row presence in `code_snippets` alone does not prove a repo can retrieve that snippet.
- `createRetriever` currently does **not** include `issue_comments`, even though they are persisted and semantically searchable elsewhere.
- To support later automation and regression gates, the S01 surfaces need **stable JSON contracts** and should not be human-output-only scripts.

## Common Pitfalls

- **Equating stored rows with retrievable corpus health** — pgvector excludes `NULL` embeddings from vector search, and repo scoping for snippets lives in occurrence rows. Audit storage and verify retrieval separately.
- **Treating `issue_comments` as already covered by `createRetriever`** — they are not. Either extend the live retriever or report the gap explicitly; otherwise R021 is overstated.
- **Collapsing query-embedding failure into “zero hits”** — `generate(..., "query")` can return `null` fail-open. Operators need that as a separate verifier outcome.
- **Using the wrong expected model for wiki** — `scripts/backfill-wiki.ts` still writes `voyage-code-3`, but live wiki retrieval is routed to `voyage-context-3`.
- **Reporting fake stale counts for corpora without stale semantics** — `issues` and `issue_comments` should report `stale` as unsupported/zero-by-schema, not guessed from timestamps or model drift.
- **Auditing snippets without occurrence coverage** — a healthy `code_snippets` row with no repo-linked occurrence does not help live retrieval in that repo.

## Open Risks

- The slice may uncover a requirement gap: persisted `issue_comments` are auditable now, but live retriever verification through `createRetriever` cannot currently prove their usage.
- A verifier built against the wrong provider wiring could silently miss the wiki model seam and give false confidence.
- If the audit contract is too generic, it will either hide unsupported dimensions (`stale` on issues/comments) or force special cases later that break automation.
- The existing no-op provider path when `VOYAGE_API_KEY` is absent means verifier UX must clearly report degraded embedding availability, not silently return empty evidence.

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| Bun | `sickn33/antigravity-awesome-skills@bun-development` | available — `npx skills add sickn33/antigravity-awesome-skills@bun-development` |
| pgvector / PostgreSQL vector search | `timescale/pg-aiguide@pgvector-semantic-search` | available — `npx skills add timescale/pg-aiguide@pgvector-semantic-search` |
| Embedding systems / RAG patterns | `wshobson/agents@embedding-strategies` | available — `npx skills add wshobson/agents@embedding-strategies` |
| Voyage AI | none found worth recommending beyond generic embedding guidance | none found |

## Sources

- Production provider routing and retriever assembly (source: `src/index.ts`)
- Fail-open embedding/query behavior and contextualized wiki embedding path (source: `src/knowledge/embeddings.ts`)
- Unified retrieval contract, participating corpora, and `unifiedResults` attribution (source: `src/knowledge/retrieval.ts`)
- Learning memory schema and stale/model lifecycle helpers (source: `src/knowledge/memory-store.ts`, `src/db/migrations/001-initial-schema.sql`)
- Review comment integrity/repair primitives and schema (source: `src/knowledge/review-comment-store.ts`, `src/db/migrations/005-review-comments.sql`)
- Wiki schema and model/stale behavior (source: `src/knowledge/wiki-store.ts`, `src/db/migrations/006-wiki-pages.sql`)
- Code snippet dual-table retrieval semantics (source: `src/knowledge/code-snippet-store.ts`, `src/db/migrations/009-code-snippets.sql`)
- Issue and issue-comment persistence model plus retrieval gap (source: `src/knowledge/issue-store.ts`, `src/knowledge/issue-retrieval.ts`, `src/db/migrations/014-issues.sql`)
- Issue comment semantic retrieval exists outside `createRetriever` (source: `src/knowledge/thread-assembler.ts`)
- Existing retriever E2E fixtures that can anchor verifier contract tests (source: `src/knowledge/retrieval.e2e.test.ts`)
- Existing wiki model drift seam in operator scripts (source: `scripts/backfill-wiki.ts`, `scripts/wiki-embedding-backfill.ts`)
- Skill discovery results (source queries: `npx skills find "pgvector"`, `npx skills find "voyage ai embeddings"`, `npx skills find "bun"`)
