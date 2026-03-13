# Embedding Integrity Operator Runbook

This runbook covers the S01 read-only operator surfaces for persisted embedding health and live retriever verification, the S02 bounded wiki repair command, and the S03 unified non-wiki repair/status command for persisted Postgres-backed corpora.

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

### Repair degraded non-wiki embeddings

```bash
bun run repair:embeddings -- --corpus review_comments
bun run repair:embeddings -- --corpus review_comments --json
bun run repair:embeddings -- --corpus review_comments --resume --json
bun run repair:embeddings -- --corpus review_comments --status --json
bun run repair:embeddings -- --corpus issues --dry-run --json
```

Supported corpora:
- `review_comments`
- `learning_memories`
- `code_snippets`
- `issues`
- `issue_comments`

What it does:
- repairs degraded persisted rows using only text already stored in Postgres for the selected corpus
- uses the shared non-wiki target model `voyage-code-3`
- persists cursor/progress/failure state in `embedding_repair_state` keyed by `corpus + repair_key`
- keeps normal repair row-local and DB-driven rather than re-fetching GitHub issues, comments, or snippets during repair

Mode behavior:
- default mode is mutating repair for the selected corpus
- `--status` is read-only and reports the last persisted cursor plus whether resume-worthy degraded rows still exist
- `--dry-run` executes the same candidate selection/reporting path without writing repaired embeddings
- `--resume` continues from the persisted `last_row_id`/batch cursor saved in `embedding_repair_state`

Stable top-level fields:
- `command`
- `mode`
- `success`
- `status_code`
- `corpus`
- `target_model`
- `resumed`
- `dry_run`
- `run`

Stable `run` fields:
- `run_id`
- `status`
- `corpus`
- `batch_index`
- `batches_total`
- `last_row_id`
- `processed`
- `repaired`
- `skipped`
- `failed`
- `failure_summary.by_class`
- `failure_summary.last_failure_class`
- `failure_summary.last_failure_message`
- `updated_at`

Status codes:
- `repair_completed` — repair finished cleanly or status shows no resume-worthy degraded rows
- `repair_not_needed` — the mutating repair path found no degraded rows to rewrite
- `repair_resume_available` — `--status` found degraded rows still pending or a persisted failure that can be resumed
- `repair_failed` — the current repair invocation stopped on a bounded batch failure

Inspection guidance:
- operator-first: `bun run repair:embeddings -- --status --corpus <name> --json`
- direct DB inspection when deeper debugging is needed:

```sql
SELECT corpus, repair_key, run_id, status, resume_ready,
       batch_index, batches_total, last_row_id,
       processed, repaired, skipped, failed,
       failure_counts, last_failure_class, last_failure_message,
       updated_at
FROM embedding_repair_state
WHERE corpus = 'review_comments'
ORDER BY updated_at DESC;
```

When to use this command instead of older scripts:
- use `repair:embeddings` when the degraded data already exists in local Postgres and you only need to rebuild embeddings from persisted row content
- use historical ingestion/backfill scripts only when the underlying corpus rows themselves are missing and must be fetched or synchronized first
- `repair:embeddings` is not a GitHub sync loop; it is a bounded persisted-row repair surface

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

### Run the S03 non-wiki repair proof

```bash
bun run verify:m027:s03 -- --corpus review_comments
bun run verify:m027:s03 -- --corpus review_comments --json
```

The S03 harness runs four surfaces in order:
1. `repair:embeddings -- --corpus review_comments --json`
2. `repair:embeddings -- --corpus review_comments --status --json`
3. `repair:embeddings -- --corpus issues --dry-run --json` (or another remaining healthy/no-op corpus)
4. `audit:embeddings --json`

Human output shows:
- final `PASS`/`FAIL` verdict
- stable check IDs
- per-check `status_code`
- live repair details for the degraded corpus
- durable status details after the repair run
- no-op probe details for another corpus through the same shared CLI contract
- scoped audit details for the repaired corpus plus the no-op corpus

JSON output preserves the underlying evidence instead of collapsing it into one summary:
- summary fields: `check_ids`, `checks`, `overallPassed`, `success`, `status_code`, `corpus`, `noop_corpus`
- raw surfaces: `repair_evidence`, `status_evidence`, `noop_probe_evidence`, `audit_evidence`

Stable check IDs:
- `M027-S03-REPAIR`
- `M027-S03-STATUS`
- `M027-S03-NOOP`
- `M027-S03-AUDIT`

Final status codes:
- `m027_s03_ok`
- `m027_s03_resume_required`
- `m027_s03_failed`

Interpretation notes:
- `M027-S03-AUDIT` is scoped to the repaired corpus and the no-op probe corpus inside the full audit envelope. The raw `audit_evidence` still preserves the other audited corpora instead of hiding them.
- Re-running the harness after a successful live repair is intentionally idempotent: `repair_evidence.status_code` may become `repair_not_needed` while `status_evidence` retains the truthful durable post-run surface.
- Representative live evidence for this slice repaired 1,833 degraded `review_comments` rows with `voyage-code-3`, then verified `repair_completed` status, a safe `issues` dry-run no-op (`repair_not_needed`), and a passing post-run audit (`audit_ok`).

### Run the final S04 milestone proof

```bash
bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments
bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json
bun run repair:wiki-embeddings -- --status --json
bun run repair:embeddings -- --corpus review_comments --status --json
```

Required inputs:
- `--repo` — repo forwarded to the live retriever proof (`xbmc/xbmc` in the representative acceptance run)
- `--query` — live retrieval query (`json-rpc subtitle delay` in the representative acceptance run)
- `--page-title` — representative wiki repair target (`JSON-RPC API/v8`)
- `--corpus` — representative non-wiki repair corpus (`review_comments`)

The S04 harness composes the existing slice proofs instead of re-implementing them:
1. `verify:m027:s01` for the full six-corpus audit + live retriever proof
2. `verify:m027:s02` for the wiki repair proof + durable wiki status evidence
3. `verify:m027:s03` for the non-wiki repair proof + durable non-wiki status evidence

Human output shows:
- final milestone `PASS`/`FAIL` verdict
- stable milestone-level check IDs
- per-check `status_code`
- whether the live retriever result stayed truthful about `issue_comments`
- whether wiki and non-wiki repair-state success came from durable status evidence instead of a fresh rewrite

JSON output preserves the full subordinate proof payloads instead of flattening them:
- summary fields: `check_ids`, `checks`, `overallPassed`, `success`, `status_code`, `repo`, `query`, `page_title`, `corpus`
- raw surfaces: `s01`, `s02`, `s03`

Stable check IDs:
- `M027-S04-FULL-AUDIT`
- `M027-S04-RETRIEVER`
- `M027-S04-WIKI-REPAIR-STATE`
- `M027-S04-NON-WIKI-REPAIR-STATE`

Final status codes:
- `m027_s04_ok`
- `m027_s04_resume_required`
- `m027_s04_failed`

Interpretation notes:
- `M027-S04-FULL-AUDIT` only passes when the top-level S01 audit envelope is fully green across all six audited corpora. Slice-local audit success is not enough.
- `M027-S04-RETRIEVER` requires live query embedding generation plus attributed hits. `retrieval_no_hits`, `retrieval_unavailable`, and `query_embedding_unavailable` are distinct failure modes and should be debugged from the preserved `s01.retriever` payload.
- `M027-S04-RETRIEVER` must continue surfacing `issue_comments` under `not_in_retriever`. That corpus is audited-only today. A passing S04 verdict does not claim live retriever coverage for `issue_comments`.
- `M027-S04-WIKI-REPAIR-STATE` and `M027-S04-NON-WIKI-REPAIR-STATE` are durable-state checks, not “did this rerun mutate rows?” checks. A healthy rerun may show `repair_not_needed` or `run.status=not_needed` on the immediate repair probe while the paired `--status --json` surface still reports `repair_completed` with zero failures.
- Treat `repair_resume_available` on either repair-state family as a real regression. It means the persisted state says there is unfinished or failed repair work to resume, so the milestone proof should stay red until the repair surface is completed and the status row returns to `repair_completed`.
- Operator-first localization flow: run `verify:m027:s04 --json`, then inspect `s01`, `s02`, or `s03` by failing check ID. Use `repair:wiki-embeddings -- --status --json` and `repair:embeddings -- --corpus review_comments --status --json` to confirm the durable rows backing a healthy no-op rerun.
- Representative live acceptance for this milestone passed with `audit_ok`, `retrieval_hits`, wiki `repair_completed`, and non-wiki durable `repair_completed` while the immediate `review_comments` repair probe correctly reported `repair_not_needed`.

## Required runtime assumptions

Required:
- `DATABASE_URL` must point to the PostgreSQL knowledge database

Optional but important:
- `VOYAGE_API_KEY` enables live query embeddings for `verify:retriever` and `verify:m027:s01`
- `VOYAGE_API_KEY` is required for `repair:wiki-embeddings` repair runs; `--status` can still inspect checkpoint state without it
- `VOYAGE_API_KEY` is required for `repair:embeddings` runs that still need live document embeddings; `--status` remains DB-only and healthy/no-op `--dry-run` probes stay truthful when no degraded candidates exist
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

1. Run `bun run verify:m027:s04 -- --repo <owner/repo> --query "..." --page-title "..." --corpus <name>`
2. If it fails, inspect the failing S04 check ID and `status_code`
3. Re-run the milestone harness with `--json` and inspect the preserved nested payload that corresponds to the failing check:
   - `s01` for `M027-S04-FULL-AUDIT` or `M027-S04-RETRIEVER`
   - `s02` for `M027-S04-WIKI-REPAIR-STATE`
   - `s03` for `M027-S04-NON-WIKI-REPAIR-STATE`
4. Re-run the specific underlying command with `--json` only when the nested proof payload is not enough:
   - `bun run audit:embeddings --json`
   - `bun run verify:retriever --repo <owner/repo> --query "..." --json`
   - `bun run repair:wiki-embeddings -- --status --json`
   - `bun run repair:embeddings -- --corpus <name> --status --json`
5. Use the structured fields above to determine whether the failure is:
   - milestone-wide persisted data integrity drift
   - embedding provider degradation before retrieval
   - retriever availability or zero-hit behavior
   - wiki/non-wiki durable repair-state regression (`repair_resume_available`)
   - honest retriever corpus coverage gap (`issue_comments` remains audited-only)

## Example

```bash
bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json
```

This is the milestone-closing proof command for M027/S04.
