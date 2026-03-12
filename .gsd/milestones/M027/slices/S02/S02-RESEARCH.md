# M027/S02 — Research

**Date:** 2026-03-12

## Summary

S02 primarily owns **R022** (timeout-prone embedding/backfill paths are root-caused and hardened) and directly supports **R020** (online-safe resumable repair), **R023** (wiki model correctness), and **R024** (timeout/regression coverage). The live wiki problem exposed by S01 is narrower and more specific than a general backfill: the current corpus is fully populated but entirely on the wrong model. `bun run audit:embeddings --json` currently reports `wiki_pages.total=4030`, `missing_or_null=0`, and `model_mismatch=4030`, which means S02 should optimize for a **model-correct online rewrite of existing rows**, not for discovering missing wiki content.

The current repair path in `scripts/wiki-embedding-backfill.ts` is the dominant reliability risk. It processes every page as one contextualized request, treats **any** empty result as if it were a token-limit case, falls back to one request per chunk, updates rows one by one, and has no durable resume cursor or checkpoint state. That combination makes the script operationally ambiguous: a large page can spend minutes in retries before degrading to hundreds of per-chunk calls, and an interrupted run restarts from page 1 with no durable evidence of where progress stopped.

Live database inspection sharpens the root-cause hypothesis. The wiki corpus currently spans **445 pages / 4030 chunks / 461,003 approximate tokens**. Most pages are small (`p90=17 chunks`, `p99=49 chunks`), but one outlier page (`JSON-RPC API/v8`) is **388 chunks / 36,463 approximate tokens**. Those figures are below Voyage’s documented hard caps, so the dominant failure mode is unlikely to be a simple hard-limit breach. The more plausible problem is **large but technically legal contextualized requests hitting long latency / timeout / retry paths**, then cascading into extremely slow per-chunk fallback and row-by-row writes.

## Recommendation

Do **not** keep extending `scripts/wiki-embedding-backfill.ts` as a monolithic script. Extract a reusable wiki repair engine under `src/knowledge/` and let the CLI become a thin operator wrapper.

Recommended execution shape for S02:

1. **Repair only rows that actually need repair**
   - Scope to `wiki_pages` rows where `deleted=false` and any of: wrong `embedding_model`, `embedding IS NULL`, or `stale=true`.
   - Group by `page_id` so the repair loop remains page-aware, but skip already-correct pages.

2. **Replace full-page contextual requests with bounded contextual work units**
   - Keep the page as the semantic boundary, but split large pages into sub-batches using conservative ceilings (chunk-count and approximate token-count), not full-page “all chunks at once”.
   - Because `token_count` is only whitespace-based, use conservative headroom rather than Voyage’s published hard max as the runtime threshold.
   - Preserve chunk order inside each sub-batch so contextual embeddings remain meaningful.

3. **Persist durable repair checkpoints after each bounded unit**
   - Add a dedicated wiki repair state surface keyed by corpus/source/target-model/run mode; do not overload `wiki_sync_state`, which tracks MediaWiki ingestion progress.
   - Persist at least: last processed `page_id`, last processed chunk/window index within page, counts repaired/skipped/failed, current batch number, updated timestamp, and failure-class summary.

4. **Batch database writes per bounded work unit**
   - Stop issuing one `UPDATE wiki_pages ... WHERE id = ...` per chunk.
   - Add a store/helper method to update many chunk embeddings in one statement/transaction per bounded unit.
   - This reduces round trips, shortens partial-failure windows, and gives checkpoint boundaries that match actual durable progress.

5. **Separate failure classes instead of treating all empty results the same**
   - `contextualizedEmbedChunks()` currently returns an empty `Map` for timeout, 429, 5xx, malformed response, and true no-data cases.
   - S02 should either wrap it with a richer repair-specific result or add a repair-specific helper that preserves failure reason, attempt count, and request size.
   - Only token/size-related failures should trigger chunk-splitting fallback. Timeouts and transient API failures should trigger bounded retry, not immediate per-chunk explosion.

6. **Lock the new operator contract with tests before implementation broadens**
   - Add unit tests for chunk-window splitting, resume cursor advancement, failure-class routing, and batched write semantics.
   - Add CLI contract tests for stable human/JSON progress output.
   - Keep S01’s verifier as the post-repair truth source.

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| Production model routing | `src/knowledge/runtime.ts` and `src/knowledge/embedding-audit.ts` constants | S01 already locked wiki=`voyage-context-3`; S02 should reuse the same truth rather than introducing another model source of record. |
| Batched remediation loop shape | `src/knowledge/review-comment-embedding-sweep.ts` | It already expresses batch size, inter-batch delay, dry-run behavior, and structured progress logging; reuse the pattern, then add durable wiki-specific resume state. |
| Durable resume semantics | `src/knowledge/wiki-backfill.ts` + `src/knowledge/wiki-store.ts` sync-state pattern | The codebase already has durable cursor/state updates for long-running ingestion. S02 should mirror that operator shape, but in a repair-specific state surface. |
| Corpus truth for what is broken | `bun run audit:embeddings --json` | S01 already exposes live mismatch/null/stale counts. Use that as the repair preflight/postflight contract rather than inventing separate integrity math. |
| Page chunk ordering and token approximation | `src/knowledge/wiki-chunker.ts` | The repair path should reuse persisted chunk order and existing `token_count` semantics rather than re-chunking raw wiki HTML during model-repair. |
| Search/read path invariants | `src/knowledge/wiki-store.ts` | Search already excludes `stale=true`, `deleted=true`, and `embedding IS NULL`; repair should preserve those invariants instead of bypassing store semantics ad hoc. |

## Existing Code and Patterns

- `scripts/wiki-embedding-backfill.ts` — current wiki repair path; good preflight summary, bad long-run ergonomics. It processes all pages, issues one contextualized request per page, falls back to per-chunk generation, updates each chunk row individually, and offers no durable resume state.
- `src/knowledge/embeddings.ts` — shared Voyage helpers. Important fragility: `contextualizedEmbedChunks()` returns an empty `Map` on any failure and hides the distinction between timeout, rate limit, token/size issue, and malformed response.
- `src/knowledge/review-comment-embedding-sweep.ts` — strongest current null-repair loop. Reuse its batch/delay/progress shape, but note that it is not durable across process interruption.
- `src/knowledge/wiki-store.ts` — authoritative wiki row/search model plus `wiki_sync_state` helpers. Good place for new repair-target queries and batched embedding updates.
- `src/knowledge/wiki-backfill.ts` — existing resumable ingestion engine. Useful as a resume/checkpoint reference, but it is about fetching MediaWiki pages, not repairing existing embeddings.
- `scripts/backfill-wiki.ts` — still writes wiki embeddings with `voyage-code-3`. This is an active model-drift source and must not be reused as the S02 repair path.
- `src/knowledge/wiki-chunker.ts` — `token_count` is a whitespace approximation, not a Voyage tokenizer count. Use it only for conservative repair batching.
- `src/knowledge/embedding-audit.ts` — S01’s authoritative per-corpus integrity logic. Its live output is the preflight and postflight acceptance surface for S02.
- `package.json` — currently exposes `backfill:wiki` but no stable wiki repair alias. S02 likely needs an explicit operator command, not a hidden one-off script path.

## Constraints

- S02 is a **repair** slice, not a raw ingestion slice. The live wiki corpus already exists; the job is to restore model correctness online without downtime.
- Wiki must remain on `voyage-context-3`; any “simpler” repair path that writes `voyage-code-3` fails R023 even if every row gets a non-null vector.
- `token_count` in `wiki_pages` is only a whitespace approximation, so batching against Voyage hard caps needs conservative headroom rather than exact boundary math.
- `contextualizedEmbedChunks()` currently fails open with an empty map, so the present script cannot truthfully distinguish timeout, token pressure, 429, 5xx, or malformed response.
- `wiki_sync_state` tracks MediaWiki enumeration progress (`source`, continue token, page counts). Reusing it for repair cursors would mix ingestion and repair semantics and make operator state ambiguous.
- The current shell environment used for research had `DATABASE_URL` available but **not** `VOYAGE_API_KEY`, so live database inspection was possible but live Voyage timing reproduction was not performed from this shell.

## Common Pitfalls

- **Treating “below Voyage hard caps” as “safe request size”** — the biggest page is under documented hard limits, but long latency plus 60s timeout/retry behavior can still make full-page contextual requests operationally bad. Use conservative bounded windows.
- **Assuming empty contextual results mean token-limit error** — the current script’s fallback comment is misleading. Empty results can mean timeout, 429, 5xx, or malformed payload. Split only when the failure class warrants splitting.
- **Falling back straight to one request per chunk** — for a large page, that can turn one bad page into hundreds of API calls. Prefer hierarchical degradation: full bounded window → smaller bounded windows → single chunk only as last resort.
- **Restarting from page 1 after interruption** — the current script has no durable repair cursor, so it cannot honestly claim resumability.
- **Updating 4030 rows one at a time** — row-by-row writes inflate runtime and make “progress” mostly network/database overhead rather than repair work.
- **Using `scripts/backfill-wiki.ts` as the repair path** — it still writes `voyage-code-3`, which is the exact live mismatch S02 must correct.
- **Overloading `wiki_sync_state` for repair progress** — ingestion cursor state and embedding-repair checkpoint state are different operator concerns and should stay separate.

## Open Risks

- Large-but-legal contextual requests may still timeout unpredictably, so even conservative bounded windows need a second-stage split strategy and durable checkpointing at the sub-page level.
- If S02 does not add a repair-specific state surface, the slice can improve performance but still fail R020’s resumability requirement.
- `review_comments` remains critically degraded in live audit output; S02 should keep scope disciplined on the wiki timeout/model seam and not try to solve every failing corpus at once.
- Because live Voyage credentials were not available in the research shell, the slice still needs explicit representative-run evidence once implemented; DB evidence alone is not enough to validate R022.

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| Timeout/root-cause investigation | `debug-like-expert` | installed |
| Bun | `sickn33/antigravity-awesome-skills@bun-development` | available — install with `npx skills add sickn33/antigravity-awesome-skills@bun-development` |
| pgvector / similarity search | `wshobson/agents@similarity-search-patterns` | available — install with `npx skills add wshobson/agents@similarity-search-patterns` |
| PostgreSQL pgvector | `timescale/pg-aiguide@pgvector-semantic-search` | available — install with `npx skills add timescale/pg-aiguide@pgvector-semantic-search` |
| Embedding systems / Voyage-adjacent patterns | `wshobson/agents@embedding-strategies` | available — install with `npx skills add wshobson/agents@embedding-strategies` |
| MediaWiki API | none found worth recommending | none found |

## Sources

- Live wiki integrity target is wrong-model rewrite, not null repair (source: `bun run audit:embeddings --json` on 2026-03-12)
- Live wiki size distribution shows 445 pages / 4030 chunks / 461,003 approximate tokens; biggest page is `JSON-RPC API/v8` at 388 chunks / 36,463 approximate tokens (source: read-only PostgreSQL queries against `wiki_pages` on 2026-03-12)
- Current wiki repair flow does full-page contextual requests, per-chunk fallback, row-by-row updates, and no durable resume (source: `scripts/wiki-embedding-backfill.ts`)
- Contextualized embedding helper hides failure class by returning empty maps on any failure after timeout/retry (source: `src/knowledge/embeddings.ts`)
- Existing batched repair pattern with progress/delay knobs already exists for review-comment null sweeps (source: `src/knowledge/review-comment-embedding-sweep.ts`)
- Existing durable cursor pattern for long-running wiki work already exists in ingestion sync state (source: `src/knowledge/wiki-backfill.ts`, `src/knowledge/wiki-store.ts`)
- Wrong-model wiki ingestion path still exists and must not be reused for repair (source: `scripts/backfill-wiki.ts`)
- Wiki token counts are whitespace-based approximations, not exact model token counts (source: `src/knowledge/wiki-chunker.ts`)
- Voyage contextualized embedding constraints are 1,000 input groups, 120K total tokens, and 16K total chunks, with chunk overlap discouraged (source: [Voyage AI — Contextualized Chunk Embeddings](https://docs.voyageai.com/docs/contextualized-chunk-embeddings))
