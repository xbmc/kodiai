---
id: M027
provides:
  - Production-wired embedding audit, live retriever verification, bounded/resumable repair tooling for wiki and non-wiki corpora, and a milestone-closing acceptance proof.
key_decisions:
  - Close M027 only from the passing live `verify:m027:s04` proof, not from inferred readiness or subordinate slice completion alone.
  - Keep audit, repair, and final proof surfaces JSON-first with stable check IDs and preserved nested raw evidence so degraded states remain machine-checkable.
  - Treat `issue_comments` as an intentional audited-only / repairable boundary outside the live retriever and report that scope truthfully instead of implying end-to-end coverage.
patterns_established:
  - Production operator tooling reuses shared knowledge runtime wiring so audit, repair, verifier, and server execution all exercise the same providers and stores.
  - Embedding repair is explicit, bounded, resumable, and backed by durable Postgres repair-state surfaces rather than transient logs.
  - Healthy idempotent reruns pass only when durable repair-state evidence still reports prior successful completion with zero failures.
observability_surfaces:
  - `bun run audit:embeddings --json`
  - `bun run verify:retriever --repo <owner/repo> --query "..." --json`
  - `bun run repair:wiki-embeddings -- --status --json`
  - `bun run repair:embeddings -- --corpus <name> --status --json`
  - `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json`
  - `wiki_embedding_repair_state`
  - `embedding_repair_state`
requirement_outcomes:
  - id: R019
    from_status: active
    to_status: validated
    proof: `audit:embeddings` shipped in S01 and milestone closure re-proved six-corpus green audit inside the passing live `verify:m027:s04` command (`M027-S04-FULL-AUDIT=audit_ok`).
  - id: R020
    from_status: active
    to_status: validated
    proof: S02 and S03 delivered resumable wiki and non-wiki repair/status contracts, and S04 closed from durable passing wiki/non-wiki repair-state checks under `verify:m027:s04`.
  - id: R021
    from_status: active
    to_status: validated
    proof: S01 exercised the real `createRetriever(...).retrieve(...)` path with query-embedding preflight, and S04 re-proved live retrieval hits under `M027-S04-RETRIEVER=retrieval_hits`.
  - id: R022
    from_status: active
    to_status: validated
    proof: S02 and S03 proved bounded representative wiki and non-wiki repair paths without timeout-class failure, and S04 preserved both durable repair-state checks as passing milestone evidence.
  - id: R023
    from_status: active
    to_status: validated
    proof: S01 locked wiki=`voyage-context-3` vs non-wiki=`voyage-code-3` audit invariants, and S04 closed from the preserved all-green audit envelope confirming that model boundary.
  - id: R024
    from_status: active
    to_status: validated
    proof: S01-S04 added contract tests and proof harnesses for audit, retriever, wiki repair, non-wiki repair, and final milestone composition, culminating in the passing live `verify:m027:s04` acceptance proof.
duration: ~15h16m across 4 slices
verification_result: passed
completed_at: 2026-03-12T15:24:00-07:00
---

# M027: Embedding Integrity & Timeout Hardening

**Closed the embedding-integrity gap with a six-corpus audit, live retrieval proof, bounded resumable repair tooling, and a passing production-wired final acceptance harness.**

## What Happened

M027 started by making degraded embedding state visible instead of assuming persistence implied health. S01 added a read-only six-corpus audit plus a live retriever verifier wired through the real production knowledge runtime. That established the operator contract, locked the wiki-vs-non-wiki model boundary, and made `issue_comments` retriever exclusion explicit rather than silently overstating coverage.

With truth surfaces in place, S02 attacked the highest-risk timeout seam: wiki repair. The old monolithic path was replaced with a bounded repair engine that only targets degraded wiki rows, writes `voyage-context-3` embeddings in conservative contextual windows, persists cursor/failure state in `wiki_embedding_repair_state`, and stays resumable after interruption. Live proof on `JSON-RPC API/v8` also exposed two real production defects — the contextualized Voyage endpoint and chunk payload normalization — which were fixed inside the hardened path.

S03 generalized the same operational model across the remaining persisted corpora. `review_comments`, `learning_memories`, `code_snippets`, `issues`, and `issue_comments` now share one explicit `repair:embeddings` contract backed by `embedding_repair_state`, with row-local DB-driven repair, status inspection, resume behavior, dry-run support, and honest no-op reporting on healthy reruns. This slice also fixed an observability regression by preserving the last durable checkpoint instead of overwriting it with synthetic zero-count no-op state.

S04 then composed the milestone from those already-proven surfaces instead of inventing new logic. The final `verify:m027:s04` harness preserves nested raw S01/S02/S03 evidence, requires the full six-corpus audit to stay green, requires live retriever hits, requires durable wiki and non-wiki repair-state health, and remains truthful that `issue_comments` is audited but not in the retriever. The final live proof passed, so M027 closed on direct machine-checkable evidence rather than narrative confidence.

## Cross-Slice Verification

Success criteria and definition-of-done verification were checked explicitly. No success criterion was left unmet.

- **Single read-only audit covers all persisted corpora** — verified by S01 contract tests and by the live final proof rerun: `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json` returned `M027-S04-FULL-AUDIT=audit_ok`. The preserved `s01.audit` envelope showed all six corpora with deterministic `total`, `missing_or_null`, `stale`, `stale_support`, `model_mismatch`, and model fields.
- **Explicit resumable repair commands exist for every persisted corpus** — verified across S02 and S03. Live status surfaces passed on rerun: `bun run repair:wiki-embeddings -- --status --json` returned `repair_completed` for `JSON-RPC API/v8` with `repaired=388`, `failed=0`, `windows_total=49`; `bun run repair:embeddings -- --corpus review_comments --status --json` returned `repair_completed` with `failed=0` from the durable non-wiki state surface.
- **Query-time verification proves the real retrieval path uses repaired data** — verified by the final live proof rerun. `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json` returned `M027-S04-RETRIEVER=retrieval_hits`, with `query_embedding.status=generated`, attributed hits, and preserved `not_in_retriever=["issue_comments"]` scope truth.
- **Dominant timeout-prone repair path completes with bounded work units and clear progress** — verified by the preserved S02 evidence plus current durable status. The representative wiki target `JSON-RPC API/v8` completed through the hardened path with `388` repaired chunks across `49` windows, `failed=0`, and `used_split_fallback=false`; S03 extended the same bounded resumable pattern to non-wiki repair.
- **Regression checks catch future drift and timeout regressions** — verified by contract suites and live reruns: `bun test ./scripts/verify-m027-s04.test.ts` passed locally during milestone completion, and the final live `verify:m027:s04` command passed with stable check IDs and preserved nested evidence.

Definition of done verification:

- **All slices complete** — verified by the roadmap state (`S01`-`S04` all complete) and by the presence of `S01-SUMMARY.md`, `S02-SUMMARY.md`, `S03-SUMMARY.md`, and `S04-SUMMARY.md` under `.gsd/milestones/M027/slices/`.
- **All persisted embedding-backed corpora plus `issue_comments` can be audited and explicitly repaired** — verified by the shipped `audit:embeddings`, `repair:wiki-embeddings`, and `repair:embeddings` surfaces and by the passing final proof/state reruns above.
- **Shared surfaces are production-wired** — verified by the live rerun of `verify:m027:s04`, which exercised real provider/database wiring and returned `overallPassed=true`, `status_code=m027_s04_ok`.
- **The real `createRetriever` entrypoint is exercised end to end** — verified by the preserved S01 retriever evidence inside the live final proof, including `query_embedding.status=generated` and attributed `hits`.
- **Success criteria are re-checked with live output, not only tests** — verified during completion with fresh runs of `verify:m027:s04`, `repair:wiki-embeddings -- --status --json`, and `repair:embeddings -- --corpus review_comments --status --json`.
- **Final integrated acceptance passes** — verified by the live command `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json`, which returned `overallPassed=true` and passing check IDs `M027-S04-FULL-AUDIT`, `M027-S04-RETRIEVER`, `M027-S04-WIKI-REPAIR-STATE`, and `M027-S04-NON-WIKI-REPAIR-STATE`.

## Requirement Changes

- R019: active → validated — S01 shipped the six-corpus read-only audit and S04 re-proved it live with `M027-S04-FULL-AUDIT=audit_ok`.
- R020: active → validated — S02/S03 shipped resumable wiki and non-wiki repair/status surfaces, and S04 closed from durable passing repair-state checks.
- R021: active → validated — S01 verified the real retrieval path and S04 re-proved live retrieval hits with truthful scope.
- R022: active → validated — S02/S03 proved bounded repair completion without timeout-class failure and S04 preserved both healthy repair families together.
- R023: active → validated — S01 locked explicit corpus/model invariants and S04 closed from an all-green audit that preserved wiki vs non-wiki model correctness.
- R024: active → validated — S01-S04 added deterministic proof/test harnesses that now catch audit drift, model drift, retriever-scope drift, and repair-state regressions.

## Forward Intelligence

### What the next milestone should know
- `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json` is the single authoritative acceptance proof for M027; start there before re-running narrower commands.
- The strongest repair proof is the durable state tables, not whether a healthy rerun rewrites rows. Idempotent `repair_not_needed` is correct once the corpus is healthy.
- `issue_comments` being audited-but-not-in-retriever is deliberate current scope, not leftover M027 work.

### What's fragile
- Live proof still depends on real Azure Postgres and Voyage providers — environment or credential drift can fail the acceptance harness even when local contract tests remain green.
- Repair-state tables expose latest durable state, not append-only run history — useful for operations, weaker for deep forensic reconstruction.

### Authoritative diagnostics
- `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json` — best first diagnostic because it preserves nested S01/S02/S03 evidence under stable check IDs.
- `bun run repair:wiki-embeddings -- --status --json` — authoritative wiki checkpoint surface for `JSON-RPC API/v8` bounded-run status.
- `bun run repair:embeddings -- --corpus review_comments --status --json` — authoritative non-wiki durable status surface for healthy-idempotent rerun interpretation.

### What assumptions changed
- The milestone did not close from slice completion alone — it closed only after a fresh passing production-wired S04 proof.
- A passing rerun does not need fresh mutations — durable repair-state evidence plus truthful `repair_not_needed` behavior is the correct healthy-state signal.
- Six-corpus audit success does not imply six-corpus retriever participation — retriever scope must remain explicit, especially for `issue_comments`.

## Files Created/Modified

- `.gsd/milestones/M027/M027-SUMMARY.md` — milestone closure artifact covering success-criteria verification, definition-of-done verification, requirement transitions, and forward intelligence.
- `.gsd/PROJECT.md` — refreshed current-state narrative to point at the M027 closure artifact and authoritative acceptance proof.
- `.gsd/STATE.md` — refreshed quick-glance state to note that M027 summary artifacts are recorded and M028 planning is next.
