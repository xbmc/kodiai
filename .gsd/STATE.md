# GSD State

**Active Milestone:** M027 — Embedding Integrity & Timeout Hardening
**Active Slice:** None — S01 complete, reassessing M027
**Active Task:** None
**Phase:** post-slice reassessment

## Recent Decisions
- M027 includes a final live integration slice so repaired corpus rows are proven through `createRetriever()` and post-repair audit output, not just table counts.
- M027/S01 extracts shared knowledge-runtime composition from `src/index.ts` so operator scripts and server reuse the same production provider/store wiring.
- M027/S01 retriever verifier must report `issue_comments` as `not_in_retriever` unless `createRetriever` actually includes them, rather than overstating end-to-end coverage.
- M027/S01 ships separate audit and live verifier commands plus a combined machine-checkable proof harness, all JSON-first with degraded-path diagnostics locked by tests.
- M027/S01 contract reports `stale_support` alongside `stale` counts and uses stable `success`/`status_code` fields so unsupported schema dimensions and degraded retrieval states stay machine-checkable.
- M027/S01 embedding audit now runs read-only Postgres queries across all six corpora and renders human output from the same JSON report envelope used for `--json`.
- M027/S01 centralizes production knowledge wiring in `src/knowledge/runtime.ts` so live operator verification reuses the same stores, embedding providers, isolation layer, and retriever composition as the server.
- M027/S01 verifier preflights query embedding with the production provider so `query_embedding_unavailable` stays distinct from `retrieval_no_hits` while still exercising the real `createRetriever(...).retrieve(...)` path when embeddings exist.

## Blockers
- None

## Next Action
Reassess M027 after S01 completion and plan the first repair-oriented slice using the new audit/verifier surfaces.

## Completed Milestones
- M026: Codebase Audit & Documentation — 474 TS errors fixed (0 remaining), 7 docs files written, CONTRIBUTING.md created, .env.example expanded to 26 vars, dead code removed, .planning/ untracked, all merged branches cleaned. All 16 requirements (R001-R016) validated. v0.26 shipped.
