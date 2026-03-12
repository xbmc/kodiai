# Embedding Integrity Operator Runbook

This runbook covers the S01 read-only operator surfaces for persisted embedding health and live retriever verification, plus the S02 bounded wiki repair command and checkpoint/status inspection flow.

## Commands

### Repair degraded wiki embeddings

```bash
bun run repair:wiki-embeddings -- --page-title "JSON-RPC API/v8"
bun run repair:wiki-embeddings -- --page-title "JSON-RPC API/v8" --json
bun run repair:wiki-embeddings -- --page-title "JSON-RPC API/v8" --resume --json
bun run repair:wiki-embeddings -- --status --json
```

What it does:
- repairs only degraded `wiki_pages` rows (`embedding IS NULL`, `stale = true`, or wrong `embedding_model`)
- always writes the wiki target model `voyage-context-3`
- processes bounded page windows instead of one monolithic full-page rewrite
- persists checkpoint state in `wiki_embedding_repair_state` so interrupted runs can resume without restarting page 1

Stable top-level fields:
- `command`
- `mode`
- `success`
- `status_code`
- `target_model`
- `requested_page_title`
- `resumed`
- `run`

Stable `run` fields:
- `run_id`
- `status`
- `page_id`
- `page_title`
- `window_index`
- `windows_total`
- `repaired`
- `skipped`
- `failed`
- `retry_count`
- `failure_summary.by_class`
- `failure_summary.last_failure_class`
- `failure_summary.last_failure_message`
- `used_split_fallback`
- `updated_at`

Status codes:
- `repair_completed` — no degraded wiki rows remain for the tracked repair surface
- `repair_resume_available` — checkpoint state shows unfinished work or a partial failure that can be resumed
- `repair_failed` — the current repair invocation stopped on a bounded window failure

Resume behavior:
- use `--resume` after an interrupted or failed run to continue from the persisted `page_id` + `window_index` checkpoint
- `--status` is non-mutating and returns the last saved cursor plus failure summary without rerunning embeddings
- a completed run reports `success: true`; partial or failed state reports `success: false` and preserves the last failure metadata

Checkpoint inspection guidance:
- operator-first: `bun run repair:wiki-embeddings -- --status --json`
- direct DB inspection when deeper debugging is needed:

```sql
SELECT repair_key, page_id, page_title, window_index, windows_total,
       repaired, skipped, failed, retry_count, used_split_fallback,
       last_failure_class, last_failure_message, updated_at
FROM wiki_embedding_repair_state
ORDER BY updated_at DESC;
```

Legacy compatibility:
- `bun scripts/wiki-embedding-backfill.ts` is now only a compatibility wrapper over `repair:wiki-embeddings`
- the wrapper refuses old model overrides and no longer runs the timeout-prone monolithic rewrite path

### Audit persisted embeddings

```bash
bun run audit:embeddings
bun run audit:embeddings --json
```

What it checks:
- `learning_memories`
- `review_comments`
- `wiki_pages`
- `code_snippets`
- `issues`
- `issue_comments`

Stable fields per corpus:
- `total`
- `missing_or_null`
- `stale`
- `stale_support`
- `model_mismatch`
- `expected_model`
- `actual_models`
- `status`
- `severity`
- `occurrence_diagnostics` for `code_snippets`

Envelope fields:
- `generated_at`
- `audited_corpora`
- `overall_status`
- `overall_severity`
- `success`
- `status_code`

Status codes:
- `audit_ok` — all audited corpora passed
- `audit_warn` — no hard failures, but at least one warning surface exists
- `audit_failed` — at least one corpus has missing/null embeddings or model mismatches

### Verify the live retriever path

```bash
bun run verify:retriever --repo xbmc/xbmc --query "json-rpc subtitle delay"
bun run verify:retriever --repo xbmc/xbmc --query "json-rpc subtitle delay" --json
```

What it proves:
- the production query embedding provider can attempt a live query embedding
- the production `createRetriever(...).retrieve(...)` path runs through shared runtime wiring
- results are attributed by source instead of returning opaque success/failure text

Stable fields:
- `audited_corpora`
- `participating_corpora`
- `not_in_retriever`
- `query_embedding.status|model|dimensions`
- `result_counts.unified_results`
- `result_counts.by_source`
- `hits`
- `success`
- `status_code`

Status codes:
- `retrieval_hits` — query embedding generated and at least one attributed hit returned
- `retrieval_no_hits` — query embedding generated but the retriever returned zero hits
- `query_embedding_unavailable` — query embedding could not be generated, so retrieval was not attempted
- `retrieval_unavailable` — retriever wiring returned `null`

### Run the combined slice proof

```bash
bun run verify:m027:s01 --repo xbmc/xbmc --query "json-rpc subtitle delay"
bun run verify:m027:s01 --repo xbmc/xbmc --query "json-rpc subtitle delay" --json
```

The combined harness runs the audit first, then the live retriever verifier.

Human output shows:
- final `PASS`/`FAIL` verdict
- stable check IDs
- per-check `status_code`
- explicit details for audit state, query embedding state, and retriever participation gaps

JSON output preserves the underlying evidence instead of collapsing it into one summary:
- summary fields: `check_ids`, `checks`, `overallPassed`, `success`, `status_code`
- raw surfaces: `audit`, `retriever`

Stable check IDs:
- `M027-S01-AUDIT`
- `M027-S01-RETRIEVER`

Final status codes:
- `m027_s01_ok`
- `m027_s01_failed`

### Run the S02 wiki repair proof

```bash
bun run verify:m027:s02 -- --page-title "JSON-RPC API/v8"
bun run verify:m027:s02 -- --page-title "JSON-RPC API/v8" --json
```

The S02 harness runs three surfaces in order:
1. `repair:wiki-embeddings -- --page-title "..."`
2. `repair:wiki-embeddings -- --status --json`
3. `audit:embeddings --json`

Human output shows:
- final `PASS`/`FAIL` verdict
- stable check IDs
- per-check `status_code`
- repair cursor/progress details
- whether a resume-required state came from the repair checkpoint surface
- wiki audit model/missing-row details

JSON output preserves the underlying evidence instead of collapsing it into one summary:
- summary fields: `check_ids`, `checks`, `overallPassed`, `success`, `status_code`, `page_title`
- raw surfaces: `repair_evidence`, `status_evidence`, `audit_evidence`

Stable check IDs:
- `M027-S02-REPAIR`
- `M027-S02-STATUS`
- `M027-S02-AUDIT`

Final status codes:
- `m027_s02_ok`
- `m027_s02_resume_required`
- `m027_s02_failed`

Interpretation notes:
- `M027-S02-AUDIT` is scoped to the `wiki_pages` corpus inside the full audit envelope. The raw `audit_evidence` still preserves unrelated corpus failures instead of hiding them.
- Re-running the harness after a successful repair may show `repair_evidence.run.repaired = 0` because the target page is already healthy. Use `status_evidence` for the durable proof surface (`page_title`, `window_index`, `windows_total`, `repaired`, `updated_at`) from the last completed bounded repair run.
- Representative live evidence for this slice was executed against `JSON-RPC API/v8`; the bounded repair completed 388 chunk rewrites across 49 windows with `voyage-context-3` writes and no timeout-class failure.

## Required runtime assumptions

Required:
- `DATABASE_URL` must point to the PostgreSQL knowledge database

Optional but important:
- `VOYAGE_API_KEY` enables live query embeddings for `verify:retriever` and `verify:m027:s01`
- `VOYAGE_API_KEY` is required for `repair:wiki-embeddings` repair runs; `--status` can still inspect checkpoint state without it
- without `VOYAGE_API_KEY`, the retriever verification is expected to report `query_embedding_unavailable`

Safety constraints:
- the audit uses read-only database access
- these commands do not repair rows or mutate corpus data
- operator output must never print secrets or raw embedding vectors

## Interpreting degraded states

### Audit degradation

`audit_warn` means the data is usable enough to avoid a hard failure, but the system is not fully healthy.

Expected warning cases:
- supported corpora report `stale > 0`
- `code_snippets.occurrence_diagnostics.snippets_without_occurrences > 0`

Hard failure cases:
- `missing_or_null > 0`
- `model_mismatch > 0`

Schema-aware behavior:
- `issues` and `issue_comments` do **not** expose stale semantics in schema, so they report `stale_support: "not_supported"`
- do not treat `stale: 0` on those corpora as proof that stale tracking exists; the stable signal is `stale_support`
- `wiki_pages` expects `voyage-context-3`; the other audited persisted corpora expect `voyage-code-3`

### Retriever degradation

`query_embedding_unavailable` means the verifier could not produce a live query embedding. That is distinct from a successful query returning zero hits.

Use this split:
- `query_embedding_unavailable` — provider/env/runtime problem before retrieval
- `retrieval_no_hits` — retrieval path worked, but nothing matched the query
- `retrieval_unavailable` — retriever wiring was unavailable or returned `null`
- `retrieval_hits` — end-to-end success with attributed evidence

## Current retriever participation gap

The audit covers six persisted corpora, but the current retriever participation set is smaller.

Current behavior:
- audited corpora include `issue_comments`
- retriever-participating corpora do **not** currently include `issue_comments`
- verifier surfaces this honestly through `not_in_retriever: ["issue_comments"]`

That gap is not hidden by the combined harness. A passing retriever verification can still report that `issue_comments` are not part of the live retriever.

## Suggested operator flow

1. Run `bun run verify:m027:s01 --repo <owner/repo> --query "..."`
2. If it fails, inspect the failing check ID and `status_code`
3. Re-run the specific underlying command with `--json`:
   - `bun run audit:embeddings --json`
   - `bun run verify:retriever --repo <owner/repo> --query "..." --json`
4. Use the structured fields above to determine whether the failure is:
   - persisted data integrity
   - embedding provider degradation
   - retriever availability
   - honest retriever corpus coverage gap

## Example

```bash
bun run verify:m027:s01 --repo xbmc/xbmc --query "json-rpc subtitle delay" --json
```

This is the slice-level proof command for M027/S01.
