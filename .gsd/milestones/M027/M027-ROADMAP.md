# M027: Embedding Integrity & Timeout Hardening

**Vision:** Operators can prove embedding health across every persisted corpus, repair degraded data online without downtime, and verify that the live retrieval pipeline is using repaired embeddings instead of silently failing open.

## Success Criteria

- A single read-only audit command reports deterministic per-corpus integrity status for `learning_memories`, `review_comments`, `wiki_pages`, `code_snippets`, `issues`, and `issue_comments`, including total rows, missing/null embeddings, stale rows, and model-mismatch counts.
- Operators can run explicit repair commands that resume after interruption, expose durable progress, and restore missing or stale embeddings online for every persisted corpus.
- Query-time verification proves the real `createRetriever(...).retrieve(...)` path can generate query embeddings and return attributed results from repaired corpora rather than only proving row presence.
- The dominant timeout-prone repair path completes on representative live data with bounded work units, clear progress surfaces, and no normal-case timeout failure.
- Regression checks catch future embedding drift, wrong-model writes, and timeout regressions before they become silent production degradation.

## Key Risks / Unknowns

- Dominant timeout source is still unknown — wiki contextual batching, serial review/issue loops, or write/update strategy may be the real production bottleneck, and the wrong fix would leave repair jobs unusable.
- Fail-open `null` embeddings can mask degraded reality — rows can exist while vector retrieval silently excludes them, so storage-only checks are insufficient.
- Wiki model correctness is a live correctness seam — wiki must remain on `voyage-context-3` while the other corpora stay on `voyage-code-3`; mixed vectors can look healthy but retrieve badly.
- Cross-corpus repair semantics are inconsistent today — learning memories already have stale/model lifecycle helpers, while snippets/issues/comments are less mature operationally.

## Proof Strategy

- Dominant timeout source is still unknown → retire in S02 by proving the real timeout-prone repair path runs with bounded batches, durable progress output, and successful completion on representative data.
- Fail-open `null` embeddings can mask degraded reality → retire in S01 by proving a read-only audit plus retriever verifier can distinguish row presence, missing embeddings, query-embedding failure, and actual retrieval results.
- Wiki model correctness is a live correctness seam → retire in S01 by proving the audit flags wrong-model wiki rows and the verifier runs with production model routing.
- Cross-corpus repair semantics are inconsistent today → retire in S03 by proving every persisted corpus has an explicit online-safe repair path with resume semantics and common operator-visible status output.

## Verification Classes

- Contract verification: unit/integration tests for audit aggregation, model-classification rules, resume cursor behavior, timeout batching helpers, and stable JSON/exit-code CLI contracts.
- Integration verification: real `createRetriever(...)` exercise against live store wiring plus corpus-specific repair commands that read/write Azure PostgreSQL and call Voyage embeddings through production providers.
- Operational verification: representative repair run with durable progress/resume evidence, post-repair audit re-check, and timeout-path completion under expected live dataset sizes.
- UAT / human verification: none beyond operator review of audit/report output; milestone proof is machine-checkable.

## Milestone Definition of Done

This milestone is complete only when all are true:

- All five persisted embedding-backed corpora plus `issue_comments` can be audited and explicitly repaired through stable operator commands.
- Shared audit, repair, and verification surfaces are wired to the real production storage and embedding providers, not fixture-only substitutes.
- The real retrieval entrypoint (`createRetriever`) is exercised end to end and proves repaired persisted corpora contribute retrievable results.
- Success criteria are re-checked with live audit/repair/verifier output, not only with local tests.
- Final integrated acceptance passes: audit identifies gaps, repair restores them online, verifier proves live retrieval usage, and timeout-hardened paths complete without normal-case timeout failure.

## Requirement Coverage

- Covers: R019, R020, R021, R022, R023, R024
- Partially covers: none
- Leaves for later: none
- Orphan risks: none — every active M027 requirement is mapped below

### Requirement Ownership Map

- **R019 — Production embedding audit covers all persisted corpora** → primary: S01; support: S04
- **R020 — Online-safe repair tooling restores missing or stale embeddings** → primary: S03; support: S02, S04
- **R021 — Query-time embedding usage is verified end to end** → primary: S01; support: S04
- **R022 — Timeout-prone embedding and backfill paths are root-caused and hardened** → primary: S02; support: S03, S04
- **R023 — Corpus/model correctness is validated** → primary: S01; support: S02, S04
- **R024 — Regression coverage prevents future embedding drift** → primary: S03; support: S01, S02, S04

### Coverage Summary

- Active requirements: 6
- Mapped to slices: 6
- Deferred from this milestone: 0
- Blocked during planning: 0

## Slices

- [x] **S01: Live Audit & Retriever Verification Surface** `risk:high` `depends:[]`
  > After this: operators can run a read-only embedding integrity audit plus a live retriever verifier that reports corpus health, model correctness, query-embedding status, and real retrieval hits through the production `createRetriever` path.
- [x] **S02: Timeout-Hardened Wiki Repair Path** `risk:high` `depends:[S01]`
  > After this: the known highest-risk repair surface for wiki pages runs with bounded contextual batches, durable progress/resume output, model-correct writes, and representative completion evidence instead of opaque timeouts.
- [ ] **S03: Unified Online Repair for Remaining Corpora** `risk:medium` `depends:[S01,S02]`
  > After this: operators can explicitly repair learning memories, review comments, code snippets, issues, and issue comments with resumable/rate-limited commands that share a stable reporting contract and regression coverage.
- [ ] **S04: Final Integrated Production Repair Proof** `risk:medium` `depends:[S01,S02,S03]`
  > After this: a full production-style run proves the assembled system end to end — audit detects degradation, repairs restore data online, follow-up audit clears the gaps, and the live retriever returns attributed results from repaired corpora.

## Boundary Map

### S01 → S02

Produces:
- A stable audit contract: human-readable summary plus machine-readable JSON with per-corpus fields for `total`, `missing_or_null`, `stale`, `model_mismatch`, and status/severity.
- A stable retriever-verifier contract that records query embedding outcome (`generated` vs `null`), participating corpora, and attributed `unifiedResults` evidence from the real retrieval pipeline.
- Corpus/model invariants for operator tooling: wiki expects `voyage-context-3`; all other persisted corpora expect `voyage-code-3`.

Consumes:
- nothing (first slice)

### S02 → S03

Produces:
- A timeout-hardened repair pattern for embedding jobs: bounded batch sizing, progress checkpoints, resume cursor/state, explicit rate limiting, and deterministic completion/reporting.
- A model-correct wiki repair surface that can be reused as the reference contract for other corpus repair commands.
- Verification fixtures/tests that lock in timeout batching and progress semantics.

Consumes:
- S01 audit/verifier contracts and corpus/model invariants.

### S03 → S04

Produces:
- Explicit repair commands for all remaining corpora with shared operator-visible status fields, resume semantics, and dry-run/read-only separation.
- Regression coverage that guards audit math, repair resumability, model routing, and wrong-model/drift regressions across corpora.
- Stable post-repair observability surfaces for future operators and agents: last processed cursor/batch, counts repaired/skipped/failed, and failure-class summaries.

Consumes:
- S01 audit/verifier contracts.
- S02 timeout-hardened repair pattern.
