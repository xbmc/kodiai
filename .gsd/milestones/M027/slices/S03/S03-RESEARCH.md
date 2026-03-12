# S03: Unified Online Repair for Remaining Corpora — Research

**Date:** 2026-03-12

## Summary

S03 is the slice that needs to close the non-wiki half of M027: it is the **primary owner for R020 and R024** and a **supporting slice for R022**. After S01 and S02, the production truth is clearer: the remaining live degradation is concentrated in `review_comments` (`3033` rows, all `missing_or_null`), while `wiki_pages` is repaired and the other remaining corpora are currently either healthy or empty in this environment. That means the slice should optimize first for a real operator repair path that fixes the review-comment gap immediately, while still shipping stable repair surfaces for `learning_memories`, `code_snippets`, `issues`, and `issue_comments` so future drift is repairable instead of requiring ad hoc scripts.

The strongest implementation direction is **not** “reuse the old backfill CLIs and call it done.” Those scripts are historical ingestion tools, not repair tools. They depend on GitHub pagination, mix fetching with embedding, and expose inconsistent progress/summaries. S03 should instead introduce a **row-local, DB-driven repair path** for persisted corpora: select degraded rows from Postgres, regenerate embeddings from the text already stored in those rows, update them in bounded batches, persist a durable resume cursor plus counts/failure class, and verify the result with the existing S01 audit plus targeted regression tests.

Recommendation: build one shared repair contract for the remaining corpora and implement per-corpus adapters behind it. Start with `review_comments` because it is the only currently failing remaining corpus, then extend the same engine to `issues`, `issue_comments`, `learning_memories`, and `code_snippets`. Keep wiki on its existing dedicated S02 path; do not try to retroactively force wiki into the simpler row-based engine.

## Recommendation

Take a **shared engine + corpus adapter** approach.

1. **Introduce one row-based repair engine for non-wiki corpora**
   - Input: corpus name, repo scope, optional resume flag, optional limit/batch size.
   - Shared state contract: `success`, `status_code`, `target_model`, `resumed`, and a `run` object with cursor/count/failure fields mirroring the S02 style.
   - Shared execution model: `list degraded rows -> chunk into bounded batches -> embed from persisted text -> batch update -> persist checkpoint after each batch`.
   - Shared degraded selection rules should come from the S01 audit semantics:
     - `embedding IS NULL OR embedding_model IS NULL`
     - `stale = true` only where schema supports it
     - wrong-model rows (`embedding_model != expected_model`)

2. **Use corpus-specific adapters rather than a giant abstraction layer**
   - `review_comments`: embed from stored `chunk_text`; existing `getNullEmbeddingChunks()` / `updateEmbedding()` prove the basic seam already exists.
   - `issues`: embed from persisted `title` + `body` using the same `buildIssueEmbeddingText()` logic used in backfill.
   - `issue_comments`: embed from persisted `body`; use existing comment chunking rules only if re-chunking is explicitly required. For straight repair, updating the persisted rows is cheaper and safer.
   - `learning_memories`: embed from persisted `finding_text` plus existing metadata (`severity`, `category`, `file_path`) using the same text shape the review handler currently writes.
   - `code_snippets`: embed from persisted `embedded_text`; repair only existing snippet rows, not historical missing snippets that were never stored.

3. **Do not make GitHub API access part of the normal repair loop**
   - Repairing persisted rows should not require re-fetching from GitHub.
   - GitHub API paths (`backfill-review-comments.ts`, `backfill-issues.ts`) remain useful for historical ingestion and catch-up sync, but they are the wrong primitive for online repair of rows already in Postgres.
   - This keeps repair faster, more resumable, and less sensitive to API rate limits.

4. **Persist repair state separately from backfill sync state**
   - Reuse the S02 idea: repair status must be inspectable even when the process exits.
   - Do **not** overload `review_comment_sync_state` or `issue_sync_state`; those track ingestion cursors, not repair progress.
   - For S03, a generic `embedding_repair_state` table keyed by `corpus + repair_key` is likely the least-fragile option because the remaining corpora are all row-based and can expose a scalar cursor (`last_row_id`, `last_content_hash`, or JSON cursor`).

5. **Keep the operator surface JSON-first and audit-driven**
   - Prefer one shared command such as `bun run repair:embeddings -- --corpus <name> [--resume] [--status] [--json]` over five unrelated scripts.
   - Thin aliases are fine if desired, but the underlying report envelope should be identical.
   - Post-repair proof should continue to use `bun run audit:embeddings --json` as the authoritative correctness check.

6. **Sequence the work by operational value**
   - First: `review_comments` repair path and tests, because it closes the current live failure.
   - Second: `issues` + `issue_comments`, because the code already has reusable embedding-text builders and sync-state patterns.
   - Third: `learning_memories`, because the corpus is empty in current live data but has first-class stale/model lifecycle semantics.
   - Fourth: `code_snippets`, because it is healthy now but still needs explicit repair tooling and regression coverage.

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| Stable repair/report contract | `src/knowledge/wiki-embedding-repair.ts` + `scripts/wiki-embedding-repair.ts` | S02 already proved the right operator shape: bounded work, persisted checkpoint, JSON-first output, and stable `status_code`/`run` fields. Reuse the contract even if the non-wiki execution model is simpler. |
| Review-comment repair of null embeddings | `src/knowledge/review-comment-embedding-sweep.ts` | It already does batch size, delay, per-row fail-open handling, and structured progress counters. It is the best direct template for `review_comments`. |
| Resume/state persistence pattern | `wiki_embedding_repair_state` plus `src/knowledge/wiki-store.ts` checkpoint helpers | S02 established that repair state should be durable and separate from sync state. Copy the idea, not the wiki-specific schema. |
| Corpus health verification | `src/knowledge/embedding-audit.ts` | The audit already encodes the real degraded-state rules (`missing_or_null`, `stale_support`, `model_mismatch`, code-snippet occurrence diagnostics). Repair should target those exact rules and use the same surface for proof. |
| Issue text construction | `buildIssueEmbeddingText()` and `buildCommentEmbeddingText()` in `src/knowledge/issue-comment-chunker.ts` / `src/knowledge/issue-backfill.ts` | These already define how issue and issue-comment text is turned into embeddings. Reuse them to avoid drift between backfill-time and repair-time vector semantics. |
| Learning-memory model lifecycle | `markStale()` / `purgeStaleEmbeddings()` in `src/knowledge/memory-store.ts` | This is the only corpus with first-class stale/model helpers today. S03 should align its repair semantics with this existing lifecycle instead of inventing a different meaning for model drift. |

## Existing Code and Patterns

- `src/knowledge/wiki-embedding-repair.ts` — authoritative S02 repair pattern: bounded batches, persisted cursor, retry-vs-split routing, stable status codes. Non-wiki repair should match its operator contract, not its page/window mechanics.
- `scripts/wiki-embedding-repair.ts` — the best example of a JSON-first repair CLI with `--status`, `--resume`, and stable human rendering from the same envelope.
- `src/knowledge/review-comment-embedding-sweep.ts` — the cleanest non-wiki repair primitive already in the repo. It repairs null embeddings from persisted `chunk_text` without GitHub API fetches.
- `src/knowledge/review-comment-store.ts` — already exposes `getNullEmbeddingChunks()`, `updateEmbedding()`, `countNullEmbeddings()`, and has `stale`/`embedding_model` columns. What it lacks is model-mismatch selection, batch updates, and durable repair-state helpers.
- `src/knowledge/review-comment-backfill.ts` — useful for text/embedding semantics and resume patterns, but too coupled to GitHub pagination to serve as the main repair path.
- `scripts/backfill-review-comments.ts` — operator entrypoint for ingestion only; human-readable only, no stable JSON contract, and no persisted repair cursor.
- `src/knowledge/issue-backfill.ts` — has reusable issue/comment embedding-text construction and sync-state logic, but repair is mixed with GitHub fetch loops and serial per-row embedding.
- `scripts/backfill-issues.ts` — proves current operator inconsistency: it reports only `issueResult.totalEmbeddings`, undercounting comment embeddings entirely. This should not be reused as the repair status contract.
- `src/knowledge/issue-store.ts` — supports upsert/search for `issues` and `issue_comments` and persists `embedding_model`, but has no stale lifecycle helpers and no repair-specific selectors/updaters.
- `src/knowledge/memory-store.ts` — has `stale` semantics and model-migration helpers, but no repair selector/update API for rows with `embedding IS NULL` or wrong model.
- `src/handlers/review.ts` — the live write path for `learning_memories` and `code_snippets` is fire-and-forget and fail-open, which means S03 repair must assume rows can exist with missing or stale embeddings even when the original review succeeded.
- `src/knowledge/code-snippet-store.ts` — stores `embedded_text`, `embedding_model`, and `stale`; repair can regenerate embeddings from `embedded_text`, but the store currently has no selection/update helpers.
- `src/db/migrations/009-code-snippets.sql` — critical constraint: `code_snippet_occurrences` has metadata only; it does **not** store the hunk text. Missing `code_snippets` rows cannot be reconstructed from occurrences alone.
- `src/knowledge/embedding-audit.ts` — the audit is the canonical source for which schema dimensions are supported: `learning_memories`, `review_comments`, and `code_snippets` support `stale`; `issues` and `issue_comments` do not.

## Constraints

- S03 owns **R020** and **R024** for the remaining non-wiki corpora and supports **R022**. It is not enough to have ad hoc scripts; the slice needs explicit, resumable operator repair surfaces and regression coverage.
- Live audit evidence now shows `review_comments` is the only currently degraded remaining corpus (`3033` rows, all `missing_or_null`), while `code_snippets` is healthy and `learning_memories` / `issues` / `issue_comments` are empty in this environment. Empty corpora still need no-op-safe repair commands and tests.
- `issues` and `issue_comments` intentionally report `stale_support: "not_supported"` in the audit. S03 must not invent fake stale semantics for those tables just to make the repair contract symmetric.
- `learning_memories`, `review_comments`, and `code_snippets` all support `stale`; repair selection must include stale rows, not just null embeddings.
- `code_snippets` repair is limited to persisted snippet rows because `code_snippet_occurrences` does not contain enough text to recreate a missing snippet row.
- Existing write paths are mostly row-at-a-time and fail-open. If S03 reuses them unchanged, it will inherit the same operational ambiguity that M027 is trying to remove.
- Repair state must survive process exit. Logs are not an acceptable resume mechanism.
- Model correctness remains fixed: non-wiki corpora use `voyage-code-3`; only wiki stays on `voyage-context-3`.
- The final proof for S03 must be machine-checkable and should use the already-shipped audit surface rather than inventing a second health definition.

## Common Pitfalls

- **Confusing repair with historical backfill** — repair for persisted corpora should operate on rows already in Postgres. Do not force operators through GitHub re-fetch loops when the text to embed is already stored locally.
- **Reusing ingestion sync tables as repair cursors** — `review_comment_sync_state` and `issue_sync_state` track API ingestion progress, not repair state. Overloading them will blur two different operational concerns and make status inspection misleading.
- **Treating all corpora as if they support `stale`** — `issues` and `issue_comments` do not. Preserve the S01 audit semantics instead of flattening schema differences away.
- **Assuming code-snippet occurrences are enough to recreate missing snippet rows** — occurrences store repo/PR/file/line metadata, not the embedded hunk text. Repair can update existing snippets, but reconstructing absent snippet rows is a different historical-ingestion problem.
- **Copying the current issue backfill summary contract** — `scripts/backfill-issues.ts` under-reports work by excluding comment embeddings from `Embeddings created`. That output is not good enough for S03 operator proof.
- **Leaving repair purely serial and log-driven** — that recreates the “slow vs stuck” ambiguity M027 is explicitly trying to eliminate. Persist cursor/count/failure state after every bounded unit.
- **Trying to over-generalize wiki into the same engine** — wiki already has a working page/window-specific repair path. S03 should reuse its contract, not destabilize it by forcing a new abstraction over a solved problem.

## Open Risks

- `review_comments` likely has the highest immediate operational value, but a generic engine that is too abstract too early could slow delivery. The safest path is a small shared contract with thin corpus adapters, not a framework.
- `learning_memories` currently has zero live rows, so it is easy to under-test. S03 needs explicit fixtures proving null/stale/model-mismatch repair even when production has no current signal there.
- `code_snippets` may hide two different failure classes: snippet rows with bad embeddings, and snippet rows with no current occurrences. The audit already distinguishes those via `occurrence_diagnostics`; repair should not collapse them into a single counter.
- `issue_comments` is still outside the live retriever path. S03 can repair the corpus, but S04 will still need to be careful not to overstate end-to-end retrieval coverage for issue comments.
- If repair status storage is implemented separately per corpus with slightly different field names, R024 will remain weak because operator automation and tests will have to special-case every surface.

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| Timeout/root-cause investigation | `debug-like-expert` | installed |
| Bun | `sickn33/antigravity-awesome-skills@bun-development` | available — install with `npx skills add sickn33/antigravity-awesome-skills@bun-development` |
| pgvector / PostgreSQL vector search | `timescale/pg-aiguide@pgvector-semantic-search` | available — install with `npx skills add timescale/pg-aiguide@pgvector-semantic-search` |
| Embedding systems | `wshobson/agents@embedding-strategies` | available — install with `npx skills add wshobson/agents@embedding-strategies` |
| GitHub App | none found worth recommending | none found |

## Sources

- Live degraded-state truth for remaining corpora (source: `bun run audit:embeddings --json` executed on 2026-03-12)
- Shared repair contract, durable checkpoint pattern, and status envelope (source: `src/knowledge/wiki-embedding-repair.ts`, `scripts/wiki-embedding-repair.ts`)
- Current review-comment null-embedding repair primitive (source: `src/knowledge/review-comment-embedding-sweep.ts`)
- Review-comment storage selectors and missing helper gaps (source: `src/knowledge/review-comment-store.ts`, `src/knowledge/review-comment-types.ts`)
- Review-comment ingestion/backfill flow and resume behavior (source: `src/knowledge/review-comment-backfill.ts`, `scripts/backfill-review-comments.ts`)
- Issue and issue-comment backfill behavior, sync-state pattern, and summary undercount risk (source: `src/knowledge/issue-backfill.ts`, `scripts/backfill-issues.ts`)
- Issue and issue-comment schema/model capabilities (source: `src/knowledge/issue-store.ts`, `src/db/migrations/014-issues.sql`)
- Learning-memory stale/model lifecycle helpers (source: `src/knowledge/memory-store.ts`)
- Code-snippet schema limits and repairable text source (`embedded_text`) vs non-repairable occurrence-only metadata (source: `src/knowledge/code-snippet-store.ts`, `src/db/migrations/009-code-snippets.sql`)
- Fire-and-forget write-time behavior for learning memories and code snippets (source: `src/handlers/review.ts`)
- Audit semantics for stale support, model mismatch, and code-snippet occurrence diagnostics (source: `src/knowledge/embedding-audit.ts`)
- Installed/available skill results (source: `<available_skills>` plus `npx skills find "bun"`, `npx skills find "pgvector"`, `npx skills find "voyage ai embeddings"`, `npx skills find "github app"`)
