# M027 — Research

**Date:** 2026-03-11

## Summary

Prove the database reality before touching repair logic. The first slice should be a read-only, cross-corpus audit that measures `missing/null/stale/model_mismatch` for all persisted embedding tables and emits one deterministic operator report. That audit should be paired with one end-to-end retriever verification path that exercises the real `createRetriever().retrieve(...)` pipeline, because row counts alone cannot prove that query-time embeddings are healthy or that repaired rows are actually reachable through production retrieval.

The codebase already has the right primitives, but they are fragmented by corpus. `src/knowledge/retrieval.ts` is the real integration boundary for R021. `src/knowledge/review-comment-embedding-sweep.ts` is the best existing repair pattern for resumable batched remediation. `scripts/wiki-embedding-backfill.ts` is the clearest timeout hotspot and also reveals a model-correctness seam: production uses `voyage-context-3` for wiki, while `scripts/backfill-wiki.ts` still writes wiki embeddings with `voyage-code-3`.

Primary recommendation: build M027 in this order: **(1) read-only audit, (2) retrieval verifier using the live retriever, (3) generalized repair framework, (4) timeout hardening of the dominant slow path, likely wiki contextual batch re-embedding and/or serial per-item embedding loops**. Do not start with broad repair. Without an audit and verifier, repair work can silently “succeed” while query-time retrieval still fails open to `null`.

## Recommendation

Take a production-first operability approach, not a migration-style rewrite.

1. **Ship a single read-only audit command first**
   - Query `learning_memories`, `review_comments`, `wiki_pages`, `code_snippets`, `issues`, and `issue_comments`.
   - Report per corpus: total rows, `embedding IS NULL`, `stale = true` where present, wrong `embedding_model`, and any corpus-specific integrity gaps.
   - Emit both human-readable output and machine-readable JSON with stable field names and a non-zero exit code threshold option for automation.

2. **Add one real retriever verification command second**
   - Use production wiring from `src/index.ts`: shared `voyage-code-3` provider plus wiki `voyage-context-3` provider.
   - Call `createRetriever(...).retrieve(...)` directly and assert at least one repaired corpus produces attributed results in `unifiedResults`.
   - Record whether query embedding generation returned `null`, because the system currently fails open there.

3. **Generalize repair from existing patterns instead of inventing a new framework**
   - Reuse the review sweep pattern for batched, resumable repair.
   - Reuse sync-state/pagewise patterns from review, wiki, and issue backfills.
   - Reuse learning-memory `markStale()` / `purgeStaleEmbeddings()` semantics where model migration matters.

4. **Harden the dominant timeout path with bounded work units**
   - `contextualizedEmbedChunks()` currently allows 60s per request with 2 retries; worst-case latency is large before fallback starts.
   - Wiki page-level contextual batches should be split by token/chunk budget before calling Voyage.
   - Serial per-item embedding loops in review/issue/comment repair should expose progress checkpoints and resumable cursors so long runtimes are observable rather than looking hung.

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| End-to-end retrieval verification | `src/knowledge/retrieval.ts` + `createRetriever(...)` | This is the real production fan-out, hybrid merge, RRF, dedup, source weighting, and context assembly path. Verifying anything else is weaker than the system users actually hit. |
| Resumable batched repair | `src/knowledge/review-comment-embedding-sweep.ts` | Already implements batch-size, inter-batch delay, dry-run support, fail-open per row, and structured progress logging. It is the right template for other corpora. |
| Resumable corpus backfill state | `review_comment_sync_state`, `wiki_sync_state`, `issue_sync_state` via existing stores/backfills | The codebase already has durable resume semantics. Reuse them instead of inventing in-memory cursors or one-shot scripts. |
| Wiki model migration / repair verification | `scripts/wiki-embedding-backfill.ts` | Already does preflight counts, contextual batch embedding, single-chunk fallback, and post-run verification of `embedding_model`. Generalize the good parts and fix the timeout weaknesses. |
| Vector search storage | pgvector HNSW + existing table schemas | The tables already store `embedding`, `embedding_model`, and in several corpora `stale`. M027 should audit and repair those states, not replace the storage layer. |
| Embedding provider abstraction | `EmbeddingProvider.generate(text, inputType)` in `src/knowledge/types.ts` | This is the stable boundary across write-time, repair-time, and query-time embedding generation. Audit/repair tooling should stay behind this contract. |

## Existing Code and Patterns

- `src/knowledge/embeddings.ts` — central embedding boundary. Shared provider uses `voyage-code-3`; wiki contextual provider uses `voyage-context-3`. All failures return `null` after timeout/retry, so missing embeddings are operationally silent unless audited.
- `src/index.ts` — production truth for model routing. Shared corpora use `createEmbeddingProvider(..., model: "voyage-code-3")`; wiki uses `createContextualizedEmbeddingProvider(..., model: "voyage-context-3")`. Startup smoke test only verifies one shared query embedding call.
- `src/knowledge/retrieval.ts` — the key verification seam. Query-time embedding generation fans out into learning memories, review comments, wiki, code snippets, and issues; then hybrid merge, cross-corpus RRF, source weighting, language boosting, dedup, and context assembly happen here.
- `src/knowledge/review-comment-embedding-sweep.ts` — strongest current repair primitive. Batches null embeddings, delays between batches, supports dry-run, and logs per-batch progress.
- `src/knowledge/review-comment-backfill.ts` — durable resume, exponential retry for GitHub API fetches, per-thread chunking, per-chunk embeddings, sync-state updates after each page.
- `src/knowledge/issue-backfill.ts` — similar resume/page patterns for issues and issue comments, but embeddings are generated fully serially and summary reporting undercounts comment embeddings.
- `src/knowledge/wiki-backfill.ts` — original wiki ingest path embeds each chunk individually; safe but slow.
- `scripts/wiki-embedding-backfill.ts` — existing wiki repair path. It embeds all chunks for a page in one contextualized request, falls back to per-chunk requests when the batch yields nothing, and updates rows one at a time.
- `scripts/backfill-wiki.ts` — notable model-drift hotspot. It still creates wiki embeddings with `voyage-code-3`, while production retrieval and repair expect `voyage-context-3`.
- `src/knowledge/memory-store.ts` — only corpus with first-class stale/model lifecycle helpers (`markStale`, `purgeStaleEmbeddings`). That pattern is worth spreading, not reinventing.
- `src/knowledge/review-comment-store.ts` — has null-embedding getters/updaters, making it audit-friendly and repair-friendly.
- `src/knowledge/wiki-store.ts` — persists `embedding_model` and `stale`; search explicitly excludes `stale=true`, `deleted=true`, and `embedding IS NULL`.
- `src/knowledge/issue-store.ts` — persists `embedding_model` for issues and issue comments, but has no stale/model-migration helpers yet.
- `src/knowledge/code-snippet-store.ts` — code snippets are persisted with `embedding_model` and `stale`, but current ingestion is live review write-time only; there is no dedicated historical backfill or repair tool yet.
- `src/handlers/review.ts` — code snippet embeddings are fire-and-forget during review completion, which means failures can silently leave corpus coverage incomplete.
- `scripts/embedding-comparison.ts` — useful pattern for offline retrieval evaluation, but currently wiki-specific and not a substitute for `createRetriever(...)` verification.

## Constraints

- Production behavior is intentionally **fail-open**: embedding generation failures return `null` and most callers continue. M027 must add observability without breaking that uptime posture.
- Query-time verification must use the live retrieval boundary, not direct table queries, or R021 remains unproven.
- Wiki is a different vector space from the other corpora. Audit logic must validate **model correctness**, not just non-null vectors.
- pgvector does **not index NULL vectors**, so rows with `embedding IS NULL` are effectively invisible to vector retrieval even if the rest of the row exists.
- Existing repair/backfill code is mostly serial. Large corpora can complete eventually, but operators need bounded batches, durable cursors, and progress surfaces to distinguish “slow” from “stuck.”
- `scripts/wiki-embedding-backfill.ts` currently performs row-by-row `UPDATE`s after embedding. That is operationally safe but magnifies long runtimes.

## Common Pitfalls

- **Treating row presence as retrieval health** — A row existing in `wiki_pages`/`review_comments`/`issues` does not mean it is retrievable. Audit both storage integrity and retriever behavior.
- **Ignoring fail-open `null` embeddings** — `EmbeddingProvider.generate()` returns `null` on timeout/API failure. Many callers count the row as processed anyway. Audit `embedding IS NULL` explicitly.
- **Mixing embedding models inside the same corpus** — wiki must stay on `voyage-context-3`; other corpora are on `voyage-code-3`. Mixed vector spaces silently degrade relevance.
- **Large contextualized batch requests** — Voyage contextualized embedding inputs are limited to 1,000 input groups, 120K total tokens, and 16K total chunks. Split big wiki pages before the API call instead of waiting for a timeout and only then falling back.
- **Assuming HNSW searches will surface bad rows** — pgvector excludes NULL vectors from the index. Missing embeddings disappear from vector search rather than failing loudly.
- **Serial “repair” that looks hung** — 30s/60s timeouts with retries plus per-row updates can make healthy-but-slow jobs indistinguishable from stuck jobs. Emit durable progress and resume points.
- **Repairing wiki with the wrong script** — `scripts/backfill-wiki.ts` still uses `voyage-code-3`; that is ingestion convenience, not the current model-correct repair path.
- **Under-reporting work done** — `scripts/backfill-issues.ts` summary prints only issue embeddings created, not issue-comment embeddings, which can mislead operators during validation.
- **Missing corpus-specific integrity dimensions** — code snippets need both `code_snippets` embedding integrity and occurrence coverage reasoning; issues need `issues` and `issue_comments` audited separately.
- **Using legacy context-window output as corpus proof** — `assembleContextWindow()` only emits missing-corpus notes for code/review/wiki, not snippets/issues. Use `unifiedResults` + provenance for correctness checks.

## Open Risks

- The dominant timeout root cause may be **wiki contextual batch size**, but review and issue repair are also highly serial and may still be operationally unacceptable at production scale.
- Code snippets are the least mature operational corpus: persisted and retrievable, but no dedicated backfill/repair path was found.
- Learning memories have stale/model lifecycle helpers, while other corpora mostly do not; a partial M027 could leave repair semantics inconsistent across corpora.
- The startup smoke test only proves one shared query embedding works once. It does not prove wiki query embeddings, persisted corpus completeness, or cross-corpus retrieval health.

## Candidate Requirement Gaps (advisory)

These are research findings, not automatic scope expansion.

- **Candidate:** Require a machine-readable audit contract (`--json`, stable field names, exit status thresholds). This is table stakes for operability if the audit will be used in cron, CI, or future milestones.
- **Candidate:** Require corpus-specific diagnostic counts for `issue_comments` and `code_snippet_occurrences`, not just top-level tables. Current active requirements mention issues/comments together, but operator debugging will need them separated.
- **Candidate:** Require retriever verification to report whether query embedding generation returned `null` versus “no matches found.” Those are different failure classes today and are easy to confuse.
- **Candidate:** Require timeout-hardening verification to include durable progress evidence (cursor/page/batch/last-id/last-updated-at), not just total duration. Otherwise future agents cannot localize a stuck repair job quickly.
- **Optional, not necessarily required:** snippet historical backfill. The current requirement says audit and repair all persisted corpora; that may be satisfied by auditing existing persisted snippet rows plus repairing null/stale rows, without inventing a full historical replay of older PR diffs.
- **Clearly out of scope:** replacing Voyage, changing pgvector index strategy wholesale, or redesigning retrieval ranking. M027 should harden integrity and repairability, not re-architect search.

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| Bun | `sickn33/antigravity-awesome-skills@bun-development` | available — install with `npx skills add sickn33/antigravity-awesome-skills@bun-development` |
| pgvector / semantic search | `wshobson/agents@similarity-search-patterns` | available — install with `npx skills add wshobson/agents@similarity-search-patterns` |
| pgvector / Postgres vector search | `timescale/pg-aiguide@pgvector-semantic-search` | available — install with `npx skills add timescale/pg-aiguide@pgvector-semantic-search` |
| Hono | `yusukebe/hono-skill@hono` | available — install with `npx skills add yusukebe/hono-skill@hono` |
| Embedding systems | `wshobson/agents@embedding-strategies` | available — install with `npx skills add wshobson/agents@embedding-strategies` |
| GitHub App | none found worth recommending | none found |
| Voyage AI | no Voyage-specific skill found; closest was generic embeddings guidance | none found |
| Debugging / timeout RCA | `debug-like-expert` | installed |

## Sources

- Production model routing and startup smoke behavior (source: `src/index.ts`)
- Embedding timeout/retry/fail-open behavior and contextual batch embedding contract (source: `src/knowledge/embeddings.ts`)
- Unified retrieval fan-out, hybrid merge, RRF, provenance, and context assembly behavior (source: `src/knowledge/retrieval.ts`)
- Review-comment repair pattern with batching and delay controls (source: `src/knowledge/review-comment-embedding-sweep.ts`)
- Review comment backfill/retry/resume behavior (source: `src/knowledge/review-comment-backfill.ts`)
- Issue and issue-comment backfill behavior (source: `src/knowledge/issue-backfill.ts`)
- Learning-memory stale/model lifecycle helpers (source: `src/knowledge/memory-store.ts`)
- Wiki repair and model verification flow (source: `scripts/wiki-embedding-backfill.ts`)
- Wiki ingestion script still using `voyage-code-3` (source: `scripts/backfill-wiki.ts`)
- Issue backfill summary/reporting behavior (source: `scripts/backfill-issues.ts`)
- Code snippet persistence model and lack of dedicated repair path (source: `src/knowledge/code-snippet-store.ts`, `src/handlers/review.ts`)
- Voyage contextualized chunk constraints: nested inputs, no overlap recommendation, 120K token cap, 16K chunk cap, 1,000 input-group cap (source: [Voyage AI — Contextualized Chunk Embeddings](https://docs.voyageai.com/docs/contextualized-chunk-embeddings))
- pgvector behavior: cosine distance operator `<=>`, approximate HNSW indexes, NULL vectors not indexed (source: [pgvector README](https://raw.githubusercontent.com/pgvector/pgvector/master/README.md))
- Skill discovery suggestions (source queries: `npx skills find "bun"`, `npx skills find "postgresql pgvector"`, `npx skills find "hono"`, `npx skills find "voyage ai embeddings"`, `npx skills find "github app"`)
