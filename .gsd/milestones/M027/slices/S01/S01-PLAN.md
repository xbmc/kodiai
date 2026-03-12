# S01: Live Audit & Retriever Verification Surface

**Goal:** Ship read-only operator surfaces that prove persisted embedding health across all six corpora and prove the live `createRetriever(...).retrieve(...)` path can generate query embeddings and return attributed results through production wiring.
**Demo:** An operator can run a deterministic embedding audit plus a live retriever verifier and see per-corpus integrity/model status, explicit query-embedding outcome, retriever participation, and attributed retrieval evidence without mutating production data.

## Must-Haves

- A read-only audit command reports deterministic per-corpus status for `learning_memories`, `review_comments`, `wiki_pages`, `code_snippets`, `issues`, and `issue_comments`, including `total`, `missing_or_null`, `stale`, `model_mismatch`, `expected_model`, `actual_models`, `status`, and `severity`.
- The audit reflects real schema differences instead of inventing fake uniformity: wiki expects `voyage-context-3`; all other persisted corpora expect `voyage-code-3`; `issues` and `issue_comments` report `stale` as unsupported-by-schema rather than inferred; `code_snippets` include occurrence coverage diagnostics.
- A live verifier exercises the real production `createRetriever(...).retrieve(...)` path and records distinct states for query embedding generated, query embedding unavailable/null, zero hits, and attributed `unifiedResults` hits.
- Verifier output explicitly distinguishes audited persisted corpora from retriever-participating corpora, including `issue_comments` as `not_in_retriever` unless the slice wires them into `createRetriever`.
- Operator surfaces are stable and machine-checkable: JSON-first contracts, human-readable rendering, stable package/script entrypoints, and at least one diagnostic/failure-path assertion covering degraded embedding availability.

## Proof Level

- This slice proves: operational
- Real runtime required: yes
- Human/UAT required: no

## Verification

- `bun test src/knowledge/embedding-audit.test.ts src/knowledge/retriever-verifier.test.ts scripts/embedding-audit.test.ts scripts/retriever-verify.test.ts scripts/verify-m027-s01.test.ts`
- `bun run audit:embeddings --json`
- `bun run verify:retriever --repo xbmc/xbmc --query "json-rpc subtitle delay" --json`
- `bun run verify:m027:s01 --repo xbmc/xbmc --query "json-rpc subtitle delay"`

## Observability / Diagnostics

- Runtime signals: Structured JSON status for each corpus plus verifier fields for `query_embedding`, `participating_corpora`, `audited_corpora`, `not_in_retriever`, `result_counts`, and stable failure/status codes.
- Inspection surfaces: `bun run audit:embeddings`, `bun run verify:retriever`, and `bun run verify:m027:s01` as operator entrypoints; test files lock the JSON contract and degraded-path behavior.
- Failure visibility: Audit surfaces severity/status per corpus; verifier surfaces provider mode, query-embedding failure vs no hits, retriever participation gaps, and attributed hit counts rather than silent empty output.
- Redaction constraints: Do not print secrets, raw API keys, or raw embedding vectors; only report model names, counts, corpus identifiers, statuses, and safe error summaries.

## Integration Closure

- Upstream surfaces consumed: `src/index.ts` production provider/store wiring, `src/knowledge/retrieval.ts`, `src/knowledge/embeddings.ts`, `src/knowledge/memory-store.ts`, `src/knowledge/review-comment-store.ts`, `src/knowledge/wiki-store.ts`, `src/knowledge/code-snippet-store.ts`, `src/knowledge/issue-store.ts`, and existing retrieval E2E patterns.
- New wiring introduced in this slice: A shared production knowledge-runtime factory reusable by `src/index.ts` and operator scripts, plus explicit `audit:embeddings`, `verify:retriever`, and `verify:m027:s01` command entrypoints.
- What remains before the milestone is truly usable end-to-end: Online repair commands, timeout-hardening for the dominant repair path, resumable progress/reporting, and final post-repair integrated proof in S02-S04.

## Tasks

- [x] **T01: Lock audit and verifier contracts with failing tests** `est:1h`
  - Why: S01 needs a stable boundary before implementation so later work cannot silently weaken audit math, retriever coverage reporting, or degraded-path diagnostics.
  - Files: `src/knowledge/embedding-audit.test.ts`, `src/knowledge/retriever-verifier.test.ts`, `scripts/embedding-audit.test.ts`, `scripts/retriever-verify.test.ts`, `scripts/verify-m027-s01.test.ts`
  - Do: Add failing tests that define the JSON and human-output contracts for the audit and verifier, including per-corpus model expectations, unsupported `stale` semantics for issues/comments, code-snippet occurrence diagnostics, `query_embedding_unavailable` vs `no_hits`, attributed `unifiedResults` evidence, and explicit `issue_comments:not_in_retriever` reporting.
  - Verify: `bun test src/knowledge/embedding-audit.test.ts src/knowledge/retriever-verifier.test.ts scripts/embedding-audit.test.ts scripts/retriever-verify.test.ts scripts/verify-m027-s01.test.ts` (expected to fail until implementation lands)
  - Done when: The expected contracts are captured in named tests with clear assertions for success and degraded/failure paths, and the suite fails only because implementation is missing.
- [x] **T02: Implement the read-only embedding audit surface** `est:1.5h`
  - Why: R019 and R023 require a single operator-visible audit that tells the truth about persisted embedding completeness and model correctness across all six corpora.
  - Files: `src/knowledge/embedding-audit.ts`, `src/knowledge/embedding-audit.test.ts`, `scripts/embedding-audit.ts`, `scripts/embedding-audit.test.ts`, `package.json`
  - Do: Build shared audit logic that queries each corpus with schema-aware rules, computes deterministic status/severity fields, renders JSON plus human output from the same data model, and exposes a read-only `audit:embeddings` command without mutating rows.
  - Verify: `bun test src/knowledge/embedding-audit.test.ts scripts/embedding-audit.test.ts && bun run audit:embeddings --json`
  - Done when: The audit command emits all six corpus records with stable fields and correct wiki/non-wiki model expectations, and the contract tests pass.
- [x] **T03: Reuse production wiring and implement the live retriever verifier** `est:2h`
  - Why: R021 is not satisfied by table counts; S01 must prove the real retrieval entrypoint can generate query embeddings and return attributed results through production wiring.
  - Files: `src/knowledge/runtime.ts`, `src/index.ts`, `src/knowledge/retriever-verifier.ts`, `src/knowledge/retriever-verifier.test.ts`, `scripts/retriever-verify.ts`, `scripts/retriever-verify.test.ts`, `package.json`
  - Do: Extract reusable knowledge-runtime composition from `src/index.ts`, implement a verifier that invokes `createRetriever(...).retrieve(...)`, records query-embedding outcome and participating corpora, preserves wiki’s contextual provider routing, and reports `issue_comments` as `not_in_retriever` unless the retriever truly includes them.
  - Verify: `bun test src/knowledge/retriever-verifier.test.ts scripts/retriever-verify.test.ts && bun run verify:retriever --repo xbmc/xbmc --query "json-rpc subtitle delay" --json`
  - Done when: The server and scripts share the same provider/store composition, verifier tests pass for success and degraded states, and the command can distinguish query-embedding failure from empty retrieval.
- [x] **T04: Ship the operator proof harness and package entrypoints** `est:1h`
  - Why: Operators need one repeatable machine-checkable path to run both surfaces together and confirm the slice demo without manually stitching commands and statuses.
  - Files: `scripts/verify-m027-s01.ts`, `scripts/verify-m027-s01.test.ts`, `package.json`, `docs/operations/embedding-integrity.md`
  - Do: Add a combined verification script and package aliases that run the audit plus verifier, preserve the stable JSON contract, document required arguments/env behavior, and assert the degraded-path diagnostics remain inspectable when embeddings are unavailable.
  - Verify: `bun test scripts/verify-m027-s01.test.ts && bun run verify:m027:s01 --repo xbmc/xbmc --query "json-rpc subtitle delay"`
  - Done when: A single operator command exercises both S01 surfaces, the documentation matches the shipped entrypoints, and the combined verification script reports machine-checkable pass/fail evidence.

## Files Likely Touched

- `src/index.ts`
- `src/knowledge/runtime.ts`
- `src/knowledge/embedding-audit.ts`
- `src/knowledge/embedding-audit.test.ts`
- `src/knowledge/retriever-verifier.ts`
- `src/knowledge/retriever-verifier.test.ts`
- `scripts/embedding-audit.ts`
- `scripts/embedding-audit.test.ts`
- `scripts/retriever-verify.ts`
- `scripts/retriever-verify.test.ts`
- `scripts/verify-m027-s01.ts`
- `scripts/verify-m027-s01.test.ts`
- `docs/operations/embedding-integrity.md`
- `package.json`
