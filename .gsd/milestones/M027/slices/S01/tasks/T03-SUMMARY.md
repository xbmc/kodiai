---
id: T03
parent: S01
milestone: M027
provides:
  - Shared production knowledge-runtime wiring plus the live `verify:retriever` operator surface over `createRetriever(...).retrieve(...)`
key_files:
  - src/knowledge/runtime.ts
  - src/knowledge/retriever-verifier.ts
  - scripts/retriever-verify.ts
  - src/index.ts
  - package.json
key_decisions:
  - Centralize server/script knowledge wiring in `src/knowledge/runtime.ts` so both paths reuse the same embedding providers, stores, isolation layer, and retriever composition
  - Preflight query embedding generation before calling `createRetriever(...).retrieve(...)` so `query_embedding_unavailable` stays distinct from `retrieval_no_hits`
patterns_established:
  - Operator verifier reports audited corpora, retriever-participating corpora, and `not_in_retriever` from stable shared constants instead of inferring coverage from hit output
  - CLI output is JSON-first with deterministic human rendering and stable exit behavior derived from the same verifier report envelope
observability_surfaces:
  - bun run verify:retriever --repo xbmc/xbmc --query "json-rpc subtitle delay" --json
  - bun run verify:retriever --repo xbmc/xbmc --query "json-rpc subtitle delay"
  - src/knowledge/runtime.ts
  - Stable verifier fields: `query_embedding`, `participating_corpora`, `not_in_retriever`, `result_counts`, `hits`, `success`, `status_code`
duration: 46m
verification_result: passed
completed_at: 2026-03-11T23:36:46-07:00
blocker_discovered: false
---

# T03: Reuse production wiring and implement the live retriever verifier

**Extracted shared production knowledge wiring and shipped `verify:retriever`, a live verifier that reuses the real retriever path and exposes query-embedding state, corpus coverage, and attributed hits.**

## What Happened

I added `src/knowledge/runtime.ts` to hold the production knowledge-runtime composition that previously lived inline in `src/index.ts`.

That factory now initializes the same:

- learning-memory store
- standard Voyage query/document embedding provider (`voyage-code-3`)
- wiki contextual provider (`voyage-context-3`)
- review-comment, wiki-page, code-snippet, and issue stores
- learning-memory isolation layer
- unified retriever with the same production retrieval config and wiki citation logger wiring

I also moved the non-blocking embedding smoke test into the runtime module and updated `src/index.ts` to consume the shared factory without changing fail-open behavior.

Then I added `src/knowledge/retriever-verifier.ts`.

The verifier now:

- locks the audited corpus list and the actual retriever-participating corpus list separately
- reports `issue_comments` honestly as `not_in_retriever`
- preflights query embedding generation using the production query provider
- only calls `createRetriever(...).retrieve(...)` when query embedding generation succeeds
- distinguishes `query_embedding_unavailable` from `retrieval_no_hits`
- returns stable machine fields for `query_embedding`, `result_counts`, `hits`, `success`, and `status_code`
- renders human-readable output from the same report object used for JSON

I added `scripts/retriever-verify.ts` and the `verify:retriever` package script.

The CLI now:

- parses `--repo`, `--query`, `--json`, and `--help`
- instantiates the real DB-backed knowledge runtime
- exercises the real production retriever wiring
- emits deterministic JSON or human output
- exits `0` only for `retrieval_hits`; degraded states stay non-zero and machine-checkable

On the current live runtime, `bun run verify:retriever --repo xbmc/xbmc --query "json-rpc subtitle delay" --json` succeeds and returns real attributed retrieval evidence. The current live result showed `query_embedding.status: generated`, `status_code: retrieval_hits`, and five snippet hits, while still reporting `issue_comments` under `not_in_retriever`.

## Verification

Task-level verification passed:

- `bun test ./src/knowledge/retriever-verifier.test.ts ./scripts/retriever-verify.test.ts`
  - 6/6 tests passed
- `bun run verify:retriever --repo xbmc/xbmc --query "json-rpc subtitle delay" --json`
  - command executed against live runtime wiring
  - returned `status_code: retrieval_hits`
  - reported `query_embedding.status: generated`
  - reported `not_in_retriever: ["issue_comments"]`
  - returned attributed `hits` with `by_source: { "snippet": 5 }`

Slice-level verification status after T03:

- `bun test ./src/knowledge/embedding-audit.test.ts ./src/knowledge/retriever-verifier.test.ts ./scripts/embedding-audit.test.ts ./scripts/retriever-verify.test.ts ./scripts/verify-m027-s01.test.ts`
  - audit and retriever tests pass
  - combined proof-harness tests still fail because `scripts/verify-m027-s01.ts` is not implemented until T04
- `bun run audit:embeddings --json`
  - command executed and truthfully reported live degraded data state
  - current live result is `status_code: audit_failed` because `review_comments` are missing embeddings and `wiki_pages` still mismatch the expected `voyage-context-3` model
- `bun run verify:m027:s01 --repo xbmc/xbmc --query "json-rpc subtitle delay"`
  - expected failure: script alias not implemented until T04

## Diagnostics

Future agents can inspect this task’s output with:

- `bun run verify:retriever --repo <owner/repo> --query "..." --json` for the machine contract
- `bun run verify:retriever --repo <owner/repo> --query "..."` for the human rendering
- `src/knowledge/runtime.ts` to confirm the exact production wiring reused by both server and operator command paths

The verifier now exposes these stable surfaces directly:

- `audited_corpora`
- `participating_corpora`
- `not_in_retriever`
- `query_embedding.status|model|dimensions`
- `result_counts.unified_results`
- `result_counts.by_source`
- attributed `hits`
- `success`
- `status_code`

This makes no-op provider mode, query embedding failure, honest retriever coverage gaps, and zero-hit vs hit outcomes inspectable without reading retriever internals or querying tables directly.

## Deviations

- None.

## Known Issues

- The combined proof harness `verify:m027:s01` is still missing and remains the next task in T04.
- The audit surface still reports real live corpus problems (`review_comments` missing embeddings and `wiki_pages` model mismatch); this task intentionally leaves those data repairs to later slice work.

## Files Created/Modified

- `src/knowledge/runtime.ts` — shared production knowledge-runtime factory and non-blocking embedding smoke-test helper
- `src/index.ts` — switched server startup to the shared runtime factory without changing fail-open behavior
- `src/knowledge/retriever-verifier.ts` — live retriever verifier, stable corpus coverage constants, report builder, and human renderer
- `scripts/retriever-verify.ts` — operator CLI for live retriever verification over real runtime wiring
- `package.json` — added the `verify:retriever` script alias
- `.gsd/DECISIONS.md` — recorded the shared runtime and query-embedding preflight decisions
- `.gsd/milestones/M027/slices/S01/S01-PLAN.md` — marked T03 complete
- `.gsd/STATE.md` — advanced the next action to T04
