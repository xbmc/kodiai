# GSD State

**Active Milestone:** M027 — Embedding Integrity & Timeout Hardening
**Active Slice:** S03 — Unified Online Repair for Remaining Corpora
**Active Task:** none
**Phase:** ready for next slice

## Recent Decisions
- M027/S02 proof harness emits stable check IDs and preserves raw repair/status/audit envelopes so reruns remain machine-checkable even when repair becomes idempotent.
- M027/S02 proof verdicts evaluate wiki-only audit success from the preserved full audit envelope so unrelated corpus failures stay visible without invalidating the wiki repair proof.
- M027/S02 live proof corrected the Voyage contextualized embedding endpoint to `POST /v1/contextualizedembeddings` and fixed batch-write payload normalization exposed only by the real repair path.
- M027/S02 will persist wiki embedding repair checkpoints in a dedicated repair-state surface separate from `wiki_sync_state`, with sub-page cursor fields (`page_id`, `window_index`) plus counts and last failure metadata.
- M027/S02 repair work is verified against the `JSON-RPC API/v8` outlier page so timeout hardening is proven on representative live data rather than only small-page fixtures.
- M027/S02 repair CLI stays JSON-first with stable progress/status fields and a thin compatibility wrapper from `scripts/wiki-embedding-backfill.ts` onto the new bounded repair engine.
- M027/S02 legacy wiki backfill wrapper now rejects old `--model`, `--delay`, and `--dry-run` flags so operators cannot drift off `voyage-context-3` or bypass the bounded repair path.
- M027 includes a final live integration slice so repaired corpus rows are proven through `createRetriever()` and post-repair audit output, not just table counts.
- M027/S01 extracts shared knowledge-runtime composition from `src/index.ts` so operator scripts and server reuse the same production provider/store wiring.
- M027/S01 retriever verifier must report `issue_comments` as `not_in_retriever` unless `createRetriever` actually includes them, rather than overstating end-to-end coverage.
- M027/S01 ships separate audit and live verifier commands plus a combined machine-checkable proof harness, all JSON-first with degraded-path diagnostics locked by tests.
- M027/S01 contract reports `stale_support` alongside `stale` counts and uses stable `success`/`status_code` fields so unsupported schema dimensions and degraded retrieval states stay machine-checkable.

## Blockers
- None

## Next Action
Plan and execute S03 so the bounded/resumable repair pattern extends from wiki pages to learning memories, review comments, code snippets, issues, and issue comments with the same status and resume semantics.

## Completed Milestones
- M026: Codebase Audit & Documentation — 474 TS errors fixed (0 remaining), 7 docs files written, CONTRIBUTING.md created, .env.example expanded to 26 vars, dead code removed, .planning/ untracked, all merged branches cleaned. All 16 requirements (R001-R016) validated. v0.26 shipped.
