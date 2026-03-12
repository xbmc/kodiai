---
id: S01
parent: M027
milestone: M027
provides:
  - Read-only embedding integrity audit and live retriever verification surfaces with a combined machine-checkable proof harness
requires:
  - slice: none
    provides: none
affects:
  - S02
key_files:
  - src/knowledge/embedding-audit.ts
  - src/knowledge/runtime.ts
  - src/knowledge/retriever-verifier.ts
  - scripts/embedding-audit.ts
  - scripts/retriever-verify.ts
  - scripts/verify-m027-s01.ts
  - docs/operations/embedding-integrity.md
  - package.json
key_decisions:
  - Centralize production knowledge wiring in `src/knowledge/runtime.ts` so server startup and operator verification reuse the same providers, stores, isolation layer, and retriever composition.
  - Keep audit queries inside a Postgres read-only transaction and render human output from the same JSON envelope used for `--json`.
  - Preflight query embedding generation before calling `createRetriever(...).retrieve(...)` so `query_embedding_unavailable` remains distinct from `retrieval_no_hits`.
  - Keep raw `audit` and `retriever` envelopes in `verify:m027:s01 --json` while human output stays summary-first with stable check IDs and status codes.
patterns_established:
  - Contract tests lock JSON and human output for audit, verifier, and combined proof harness before and after implementation.
  - Operator surfaces report audited corpora, retriever-participating corpora, and `not_in_retriever` from shared constants instead of inferring coverage from hit output.
  - Combined operator harnesses preserve underlying machine evidence instead of collapsing multiple checks into one opaque verdict.
observability_surfaces:
  - `bun run audit:embeddings [--json]`
  - `bun run verify:retriever --repo <owner/repo> --query "..." [--json]`
  - `bun run verify:m027:s01 --repo <owner/repo> --query "..." [--json]`
  - `docs/operations/embedding-integrity.md`
  - Stable status surfaces: `success`, `status_code`, `overall_status`, `query_embedding.status`, `participating_corpora`, `not_in_retriever`, `result_counts`, `hits`
  - Stable check IDs: `M027-S01-AUDIT`, `M027-S01-RETRIEVER`
drill_down_paths:
  - .gsd/milestones/M027/slices/S01/tasks/T01-SUMMARY.md
  - .gsd/milestones/M027/slices/S01/tasks/T02-SUMMARY.md
  - .gsd/milestones/M027/slices/S01/tasks/T03-SUMMARY.md
  - .gsd/milestones/M027/slices/S01/tasks/T04-SUMMARY.md
duration: 3h11m
verification_result: passed
completed_at: 2026-03-12T06:45:00Z
---

# S01: Live Audit & Retriever Verification Surface

**Shipped a production-wired embedding audit, live retriever verifier, and combined proof harness that expose degraded corpus health and real retrieval evidence without mutating data or masking failures.**

## What Happened

S01 started by locking the operator contract with failing tests for three surfaces: the six-corpus embedding audit, the live retriever verifier, and the combined slice proof harness. Those tests fixed the exact JSON fields, human-readable rendering expectations, stable exit semantics, wiki-vs-non-wiki model routing, unsupported stale semantics for `issues` and `issue_comments`, code-snippet occurrence diagnostics, explicit `issue_comments:not_in_retriever` reporting, and the distinction between `query_embedding_unavailable` and `retrieval_no_hits`.

With the contract in place, the slice added `src/knowledge/embedding-audit.ts` plus `scripts/embedding-audit.ts`. The audit now queries all six persisted corpora inside a Postgres read-only transaction, computes schema-aware integrity/model-status fields, and renders both JSON and human output from the same report envelope. The current live audit truthfully exposes two existing data problems instead of hiding them: all `review_comments` rows are missing embeddings, and all `wiki_pages` rows are on the wrong model relative to the locked `voyage-context-3` expectation.

Next, the slice extracted reusable production knowledge wiring into `src/knowledge/runtime.ts` so the server and operator commands share the same query provider, document providers, stores, isolation layer, and retriever composition. On top of that runtime, `src/knowledge/retriever-verifier.ts` and `scripts/retriever-verify.ts` exercise the real `createRetriever(...).retrieve(...)` path, preflight query embedding generation, separate query-embedding failure from zero-hit retrieval, and return attributed hits plus explicit corpus-participation gaps.

Finally, `scripts/verify-m027-s01.ts` combined both shipped surfaces into a single proof harness with stable check IDs and preserved raw evidence under `--json`. `docs/operations/embedding-integrity.md` documents the operator entrypoints, required runtime assumptions, degraded states, and the intentional `issue_comments` retriever gap. The slice ends with stable package entrypoints for all three commands and with the live system exposing failure state directly instead of failing open silently.

## Verification

Executed the full slice verification suite and live operator commands:

- `bun test ./src/knowledge/embedding-audit.test.ts ./src/knowledge/retriever-verifier.test.ts ./scripts/embedding-audit.test.ts ./scripts/retriever-verify.test.ts ./scripts/verify-m027-s01.test.ts` ✅
- `bun run audit:embeddings --json` ✅ command executed against the live database and returned deterministic six-corpus JSON with `status_code: audit_failed`, correctly surfacing `review_comments` missing embeddings and `wiki_pages` model mismatch
- `bun run verify:retriever --repo xbmc/xbmc --query "json-rpc subtitle delay" --json` ✅ exercised the live `createRetriever(...).retrieve(...)` path, returned `status_code: retrieval_hits`, `query_embedding.status: generated`, `not_in_retriever: ["issue_comments"]`, and attributed snippet hits
- `bun run verify:m027:s01 --repo xbmc/xbmc --query "json-rpc subtitle delay"` ✅ command executed end to end and returned a failing verdict because the live audit truthfully fails; this is expected slice behavior because the product is the visible proof surface, not a forced green data state
- `bun run verify:m027:s01 --repo xbmc/xbmc --query "json-rpc subtitle delay" --json` ✅ preserved raw `audit` and `retriever` envelopes alongside stable check IDs and machine-readable pass/fail detail

Observability was also verified directly: degraded audit state is externally visible via structured JSON, retriever coverage gaps are explicit through `not_in_retriever`, and the combined harness preserves enough detail for a future agent to localize whether failure comes from corpus integrity, query embedding generation, retriever behavior, or corpus coverage.

## Requirements Advanced

- R024 — Added contract tests plus deterministic operator verifiers (`audit:embeddings`, `verify:retriever`, `verify:m027:s01`) that now catch audit/verifier contract drift; timeout and repair-regression coverage remains for later slices.

## Requirements Validated

- R019 — Validated by the shipped six-corpus read-only audit with stable JSON/human contracts and live proof via `bun run audit:embeddings --json`.
- R021 — Validated by the production-wired retriever verifier, which preflights query embeddings and exercises the real `createRetriever(...).retrieve(...)` path with attributed live hits.
- R023 — Validated by the audit’s explicit model expectations and live mismatch reporting, especially wiki=`voyage-context-3` vs non-wiki=`voyage-code-3`.

## New Requirements Surfaced

- none

## Requirements Invalidated or Re-scoped

- none

## Deviations

none

## Known Limitations

- Live audit currently fails because existing `review_comments` rows have missing embeddings and `wiki_pages` rows still use the wrong model; S01 exposes this but does not repair it.
- `issue_comments` remains outside the live retriever and is intentionally reported as `not_in_retriever` rather than being presented as end-to-end covered.
- Timeout-hardening, resumable repair flows, and post-repair integrated proof remain for S02-S04.

## Follow-ups

- Use the new audit surface to scope and verify the first repair target in S02, starting with the dominant timeout-prone wiki path.
- Re-run `verify:m027:s01` after repair work so the combined harness can flip from truthful fail to truthful pass on live data.
- Decide in later slices whether `issue_comments` should join `createRetriever` or remain an explicit audited-only corpus.

## Files Created/Modified

- `src/knowledge/embedding-audit.ts` — six-corpus read-only audit logic, shared report builder, and human renderer
- `src/knowledge/runtime.ts` — shared production knowledge-runtime factory reused by server startup and operator commands
- `src/knowledge/retriever-verifier.ts` — live retriever verifier with query-embedding preflight, corpus coverage reporting, and attributed hits
- `scripts/embedding-audit.ts` — operator CLI for the audit surface
- `scripts/retriever-verify.ts` — operator CLI for the live retriever verifier
- `scripts/verify-m027-s01.ts` — combined slice proof harness with stable check IDs and preserved raw evidence
- `docs/operations/embedding-integrity.md` — operator runbook for the audit, verifier, and combined proof harness
- `package.json` — package aliases for `audit:embeddings`, `verify:retriever`, and `verify:m027:s01`
- `.gsd/REQUIREMENTS.md` — marked R019, R021, and R023 validated; advanced R024 notes; refreshed coverage summary
- `.gsd/milestones/M027/M027-ROADMAP.md` — marked S01 complete
- `.gsd/PROJECT.md` — refreshed current-state description with M027/S01 operator surfaces
- `.gsd/STATE.md` — moved milestone state to post-slice reassessment

## Forward Intelligence

### What the next slice should know
- The new proof surfaces already expose the real live repair targets: `review_comments` has 3033 missing/null embeddings, and `wiki_pages` has 4030 model-mismatched rows against the `voyage-context-3` expectation.
- The combined harness is intentionally strict: it will stay red until both the audit and retriever halves pass, so it is ready to become the post-repair proof gate for later slices.
- `verify:retriever` currently proves the production retrieval path works with snippets even while the broader corpus health is degraded, which means later repair work must preserve that happy-path behavior while improving audit status.

### What's fragile
- Live verification depends on real provider/database wiring — if `src/knowledge/runtime.ts` drifts from `src/index.ts`, the operator proofs will stop matching production behavior.
- Requirement tracking still contains historical duplicate IDs for old out-of-scope entries (`R019`, `R020`) — future edits should avoid conflating those historical placeholders with active M027 requirement IDs.

### Authoritative diagnostics
- `bun run audit:embeddings --json` — authoritative source for per-corpus completeness, stale-support semantics, and model correctness
- `bun run verify:retriever --repo <owner/repo> --query "..." --json` — authoritative source for live query-embedding state, participating corpora, and attributed retrieval hits
- `bun run verify:m027:s01 --repo <owner/repo> --query "..." --json` — authoritative combined proof surface because it preserves both raw envelopes and stable check verdicts

### What assumptions changed
- The slice plan’s verification commands were not expected to produce an all-green live verdict on current data — what actually mattered was that they executed, reported degraded state truthfully, and preserved enough structure for later repair slices to consume.
