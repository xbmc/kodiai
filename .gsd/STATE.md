# GSD State

**Active Milestone:** M027 — Embedding Integrity & Timeout Hardening
**Active Slice:** S04 — Final Integrated Production Repair Proof
**Active Task:** Planning / execution handoff
**Phase:** S03 complete; S04 ready to start

## Recent Decisions
- M027/S03 uses a generic `embedding_repair_state` surface keyed by corpus + repair_key, separate from ingestion sync tables, so all non-wiki corpora share one resume/status contract.
- M027/S03 repair tooling is row-local and DB-driven: regenerate embeddings from persisted Postgres text already stored in corpus rows instead of re-fetching GitHub data during normal repair.
- M027/S03 ships one `repair:embeddings` command with `--corpus`, `--status`, `--resume`, and `--dry-run`; `review_comments` proves the live path while other corpora prove no-op/model-drift handling through the same contract.
- M027/S03 proof harness scopes audit success to the repaired corpus plus the no-op probe corpus while preserving the full audit envelope in `verify:m027:s03 --json`.
- M027/S03 healthy no-op reruns no longer overwrite an existing `embedding_repair_state` checkpoint, so durable status stays useful after the corpus is repaired.
- M027/S02 proof harness emits stable check IDs and preserves raw repair/status/audit envelopes so reruns remain machine-checkable even when repair becomes idempotent.
- M027/S02 proof verdicts evaluate wiki-only audit success from the preserved full audit envelope so unrelated corpus failures stay visible without invalidating the wiki repair proof.
- M027/S02 live proof corrected the Voyage contextualized embedding endpoint to `POST /v1/contextualizedembeddings` and fixed batch-write payload normalization exposed only by the real repair path.
- M027/S02 will persist wiki embedding repair checkpoints in a dedicated repair-state surface separate from `wiki_sync_state`, with sub-page cursor fields (`page_id`, `window_index`) plus counts and last failure metadata.
- M027/S02 repair work is verified against the `JSON-RPC API/v8` outlier page so timeout hardening is proven on representative live data rather than only small-page fixtures.
- M027/S02 repair CLI stays JSON-first with stable progress/status fields and a thin compatibility wrapper from `scripts/wiki-embedding-backfill.ts` onto the new bounded repair engine.
- M027/S02 legacy wiki backfill wrapper now rejects old `--model`, `--delay`, and `--dry-run` flags so operators cannot drift off `voyage-context-3` or bypass the bounded repair path.
- M027/S01 extracts shared knowledge-runtime composition from `src/index.ts` so operator scripts and server reuse the same production provider/store wiring.
- M027/S01 retriever verifier must report `issue_comments` as `not_in_retriever` unless `createRetriever` actually includes them, rather than overstating end-to-end coverage.

## Blockers
- None

## Next Action
Plan and execute S04: run the integrated production-style proof that chains audit detection, wiki repair, non-wiki repair, follow-up audit, and live retriever verification into one final milestone acceptance pass.

## Completed Milestones
- M026: Codebase Audit & Documentation — 474 TS errors fixed (0 remaining), 7 docs files written, CONTRIBUTING.md created, .env.example expanded to 26 vars, dead code removed, .planning/ untracked, all merged branches cleaned. All 16 requirements (R001-R016) validated. v0.26 shipped.
