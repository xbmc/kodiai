# S01: Live Audit & Retriever Verification Surface — UAT

**Milestone:** M027
**Written:** 2026-03-12

## UAT Type

- UAT mode: live-runtime
- Why this mode is sufficient: S01 is an operator-surface slice. The proof is the real command behavior and machine-readable output against production wiring, not a human UI walkthrough.

## Preconditions

- `DATABASE_URL` points at the live Azure PostgreSQL knowledge store.
- Embedding/runtime configuration is present so the production knowledge runtime can initialize.
- For retriever verification, the runtime can generate Voyage query embeddings.
- Package scripts `audit:embeddings`, `verify:retriever`, and `verify:m027:s01` are available.

## Smoke Test

Run `bun run audit:embeddings --json` and confirm it returns a six-corpus JSON envelope with stable fields including `corpora`, `overall_status`, `success`, and `status_code`.

## Test Cases

### 1. Six-corpus read-only audit reports truthful integrity/model status

1. Run `bun run audit:embeddings --json`.
2. Inspect the JSON envelope.
3. **Expected:** The output includes exactly `learning_memories`, `review_comments`, `wiki_pages`, `code_snippets`, `issues`, and `issue_comments`, with per-corpus `total`, `missing_or_null`, `stale`, `stale_support`, `model_mismatch`, `expected_model`, `actual_models`, `status`, and `severity`.
4. **Expected:** `wiki_pages.expected_model` is `voyage-context-3`; the other persisted corpora expect `voyage-code-3`.
5. **Expected:** `issues` and `issue_comments` report `stale_support: "not_supported"` rather than invented stale counts.

### 2. Live retriever verifier exercises production retrieval path

1. Run `bun run verify:retriever --repo xbmc/xbmc --query "json-rpc subtitle delay" --json`.
2. Inspect `query_embedding`, `participating_corpora`, `not_in_retriever`, `result_counts`, and `hits`.
3. **Expected:** The verifier distinguishes query embedding generation from retrieval results and reports a stable `status_code`.
4. **Expected:** `issue_comments` appears under `not_in_retriever` unless the live retriever has actually been expanded.
5. **Expected:** On a healthy query path, the command returns attributed `hits` from `unifiedResults` rather than only row-count evidence.

### 3. Combined proof harness preserves failure locality

1. Run `bun run verify:m027:s01 --repo xbmc/xbmc --query "json-rpc subtitle delay" --json`.
2. Inspect `check_ids`, `checks`, `audit`, and `retriever`.
3. **Expected:** The output includes stable checks `M027-S01-AUDIT` and `M027-S01-RETRIEVER`.
4. **Expected:** A failing audit does not erase retriever evidence; both raw envelopes remain present in the final JSON.
5. **Expected:** `success`/`status_code` reflect the combined verdict while preserving enough detail to identify whether the failure came from audit state, query embedding generation, no hits, or corpus participation gaps.

## Edge Cases

### Degraded live data remains visible instead of being treated as success

1. Run `bun run verify:m027:s01 --repo xbmc/xbmc --query "json-rpc subtitle delay"` against the current live dataset.
2. **Expected:** The command exits non-zero and reports `M027-S01-AUDIT:audit_failed` while still showing the retriever half as passing when retrieval works.

### Unsupported stale semantics stay explicit

1. Run `bun run audit:embeddings --json`.
2. **Expected:** `issues` and `issue_comments` emit `stale_support: "not_supported"`; they do not claim stale counts from absent schema.

## Failure Signals

- Missing corpora or unstable field names in audit/verifier JSON.
- Wiki/non-wiki expected models collapsing to one value.
- `query_embedding_unavailable` being collapsed into generic failure or `retrieval_no_hits`.
- Combined proof harness omitting raw `audit` or `retriever` evidence when one half fails.
- `issue_comments` being silently implied as retriever-participating without explicit wiring.

## Requirements Proved By This UAT

- R019 — Proves the shipped read-only audit reports deterministic six-corpus integrity/model status through a stable operator command.
- R021 — Proves the live verifier exercises the real `createRetriever(...).retrieve(...)` path and returns machine-checkable retrieval evidence.
- R023 — Proves model correctness is enforced and observable, especially wiki=`voyage-context-3` vs non-wiki=`voyage-code-3`.

## Not Proven By This UAT

- R020 — No repair commands or resumable online restoration paths are exercised here.
- R022 — No timeout-prone repair workflow is root-caused or hardened by this slice UAT.
- R024 — This UAT proves the shipped audit/verifier surfaces exist, but it does not complete the later repair/timeout regression coverage required for full validation.
- A fully healthy live dataset; the current proof run intentionally shows existing audit failures rather than repaired state.
- Inclusion of `issue_comments` in the retriever; the slice explicitly proves the current gap instead.

## Notes for Tester

The combined proof harness is expected to fail on the current live dataset because the audit is correctly surfacing real integrity problems. That is not a harness bug. Treat a truthful, well-localized failure as a passing S01 outcome; later slices are responsible for repairs and for turning the combined verdict green.
