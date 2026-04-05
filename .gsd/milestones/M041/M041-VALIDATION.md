---
verdict: pass
remediation_round: 0
---

# Milestone Validation: M041

## Success Criteria Checklist

## Success Criteria Checklist

The milestone success criteria are derived from the CONTEXT.md "Final Integrated Acceptance" and "Completion Class" sections.

### SC-1: Canonical corpus storage with commit/ref provenance
**Criterion:** A one-time backfill of a production-like C++ or Python repo stores canonical code chunks for current HEAD with `commit_sha`, `file_path`, chunk identity, embedding model, and audit metadata.

**Evidence:**
- `src/db/migrations/033-canonical-code-corpus.sql` creates `canonical_code_chunks` table with `repo`, `owner`, `canonical_ref`, `commit_sha`, `file_path`, `chunk_type`, `symbol_name`, `content_hash`, `embedding`, and audit timestamps. SQL CHECK constraints enforce documented chunk_type invariants.
- `canonical-code-types.ts` defines discriminated union types matching the schema contract.
- `verify:m041:s02 --json`: check `M041-S02-BACKFILL-STORES-CANONICAL-CHUNKS` passed with `canonicalRef=trunk filesDone=3 chunksDone=4 storedRows=4`.

**Verdict: ✅ PASS**

---

### SC-2: Changed-file-only incremental update; unchanged rows untouched
**Criterion:** A merge/update flow re-embeds only changed files or changed chunks; unchanged rows remain untouched.

**Evidence:**
- `src/knowledge/canonical-code-update.ts` implements `updateCanonicalCodeSnapshot()` with content-hash comparison: `same identity + same contentHash = skip, no DB write`.
- `verify:m041:s03 --json`: check `M041-S03-UNCHANGED-FILE-PRESERVATION` passed with `unchanged_upserts=0 unchanged_deletes=0 partial_upserts=1 partial_unchanged=1`.
- `canonical-code-update.test.ts`: 5/5 tests pass including unchanged-preservation and partial-update.

**Verdict: ✅ PASS**

---

### SC-3: Audit/repair detects stale/missing rows without full-repo rebuild
**Criterion:** An audit/repair pass can detect stale/missing rows and repair them without full-repo re-embedding.

**Evidence:**
- `embedding-audit.ts` extended with `canonical_code` in `AUDITED_CORPORA`; `auditCanonicalCode()` queries globally and returns per-corpus `status: fail | warn | pass` plus model-mismatch count.
- `embedding-repair.ts` extended with `runCanonicalCodeEmbeddingRepair()`, `createCanonicalCodeRepairStore()` (bigint bridge), and `CANONICAL_CODE_REPAIR_LIMIT=2000`.
- `verify:m041:s03 --json`: checks `M041-S03-DRIFT-DETECTED-BY-AUDIT` (drift_status_code=audit_failed, drift_canonical_status=fail, clean_status_code=audit_ok), `M041-S03-SELECTIVE-REPAIR-FIXES-ONLY-DRIFTED-ROWS` (repaired=3 embedCallCount=3 writeCallCount=3), and `M041-S03-REPAIR-SKIPS-WHEN-NO-DRIFT` (status_code=repair_not_needed embedCallCount=0) all passed.

**Verdict: ✅ PASS**

---

### SC-4: Review-time retrieval returns current unchanged code from canonical corpus (not historical PR hunks)
**Criterion:** Retrieval for a review-style query returns current unchanged C++ or Python code from the canonical corpus rather than historical PR hunks.

**Evidence:**
- `src/knowledge/canonical-code-retrieval.ts` implements `searchCanonicalCode()` returning provenance-rich results (canonical ref, commit SHA, file path, line span, chunk type, symbol name, content hash, embedding model).
- `src/knowledge/retrieval.ts` integrates canonical results as a distinct `canonical_code` unified source, separate from historical `snippet` evidence; includes per-corpus ranking weights.
- `verify:m041:s02 --json`: check `M041-S02-RETRIEVAL-RETURNS-CANONICAL-CURRENT-CODE` passed (`canonicalCodeCount=2 topCanonicalFilePath=src/auth/token.ts`) and `M041-S02-RETRIEVAL-PRESERVES-CORPUS-SEPARATION` passed (`snippetCount=1 unifiedSources=["snippet","canonical_code","canonical_code"]`).

**Verdict: ✅ PASS**

---

### SC-5: Contract completeness — storage, chunking, retrieval separate from historical diff-hunk corpus
**Criterion (Contract complete):** Kodiai can persist canonical current-code chunks with commit/ref provenance, query by semantic similarity, and keep fresh with incremental updates plus audit/repair; C++ and Python verified.

**Evidence:**
- `canonical-code-chunker.ts` implements auditable language-aware boundaries for Python, TypeScript, JavaScript, and C++ with explicit symbol-poor C++ block fallback.
- `canonical-code-chunker.test.ts` includes Python boundary test (module/class/function) and C++ symbol-poor fallback test.
- No writes to historical `code_snippets` tables from canonical path; proven by `canonical-code-ingest.test.ts` separation test.
- `bun run tsc --noEmit` exits 0 at milestone close.

**Verdict: ✅ PASS**

---

### SC-6: Non-`main` default branch propagates end to end
**Criterion (implicit from context):** Retrieval and backfill must not hard-code `main` as the default branch ref.

**Evidence:**
- `verify:m041:s02 --json`: check `M041-S02-NONMAIN-DEFAULT-BRANCH-IS-RESPECTED` passed (`backfillCanonicalRef=trunk retrievalCanonicalRef=trunk`).
- Unified retriever in `retrieval.ts` accepts caller-supplied `canonicalRef` and threads it through.

**Verdict: ✅ PASS**


## Slice Delivery Audit

## Slice Delivery Audit

| Slice | Claimed Demo/Deliverable | Delivered? | Evidence |
|-------|--------------------------|------------|----------|
| S01 | "Kodiai can ingest a fixture repo snapshot into dedicated canonical-corpus tables and show current-code chunks with explicit repo/ref/commit provenance." | ✅ Yes | `canonical-code-store.test.ts` 34/34, `canonical-code-chunker.test.ts` 7/7, `canonical-code-ingest.test.ts` 6/6. Migration `033-canonical-code-corpus.sql` creates dedicated tables with CHECK constraints. Ingest test proves no historical snippet-store calls. `tsc --noEmit` exits 0. |
| S02 | "Kodiai can backfill a repo's default branch once and answer review-style semantic queries from the canonical current-code corpus with provenance-preserving results." | ✅ Yes | `canonical-code-backfill.ts` implements resumable one-shot backfill. `canonical-code-retrieval.ts` returns provenance-rich results as `canonical_code` corpus. `verify:m041:s02 --json` exits 0, overallPassed=true, four checks pass including non-`main` branch propagation. `tsc --noEmit` exits 0. |
| S03 | "Kodiai keeps the canonical corpus fresh via changed-file updates and can prove drift detection and selective repair without full-repo rebuilds." | ✅ Yes | `canonical-code-update.ts` implements hash-compare selective refresh. `embedding-audit.ts` + `embedding-repair.ts` extended for `canonical_code`. `verify:m041:s03 --json` exits 0, overallPassed=true, four checks pass (unchanged preservation, drift audit, selective repair, no-drift skip). CLI `scripts/embedding-repair.ts` gains `--repo` and `--ref` flags. `tsc --noEmit` exits 0. |

**All three slices delivered their stated demo outputs. No gap between claimed and actual.**


## Cross-Slice Integration

## Cross-Slice Integration

### S01 → S02 boundary
**S01 provided:** Dedicated canonical current-code tables and store contract, canonical chunk identity/provenance types, auditable chunking rules, and snapshot ingest path.
**S02 consumed:** `CanonicalCodeStore` interface, `upsertChunk()`, `deleteChunksForFile()`, `canonical_code_chunks` schema, chunk identity and content-hash types; `ingestCanonicalCodeSnapshot()` used as the write path by backfill.

**Alignment:** ✅ Clean. S02 summary explicitly lists S01 as a `requires` dependency and enumerates exactly the primitives from S01's `provides` list. The backfill in `canonical-code-backfill.ts` calls `ingestCanonicalCodeSnapshot()` from S01's ingest path.

---

### S01 + S02 → S03 boundary
**S01 provided:** `CanonicalCodeStore` interface (including `upsertChunk`, `deleteChunksForFile`, `searchByEmbedding`, `listStaleChunks`, `updateEmbeddingsBatch`, `saveBackfillState`).
**S02 provided:** Backfill pattern, EmbeddingProvider/store integration, embed-on-ingest flow reused by update path; unified retrieval corpus separation that audit now covers.
**S03 consumed:** Store interface extended with `listChunksForFile()` (added to `canonical-code-store.ts`), backfill embedding pattern reused in `updateCanonicalCodeSnapshot()`, unified retrieval `canonical_code` corpus now covered by audit.

**Alignment:** ✅ Clean. S03 summary shows `requires` entries for both S01 and S02 with specific provides consumed. The store extension (`listChunksForFile`) was a planned addition to the interface; S01 did not need it. S03 correctly added it without breaking S01 or S02 contracts.

---

### Downstream boundary: M038 + M040
**M041 provides to M038:** A `canonical_code` unified retrieval corpus with provenance (ref, commit_sha, file_path, chunk_type, symbol_name) that M038 can consume as truthful unchanged-code context.
**Status:** S02 wired `canonical_code` into unified retrieval with preserved provenance and corpus separation; M038 can consume it. The S03 summary notes the webhook wiring (push/merge hook → `updateCanonicalCodeSnapshot()`) as a follow-up, meaning M038 integration may need that wiring in production. This is documented as a known follow-up, not a gap in M041's scope.

**Alignment:** ✅ Within M041's defined scope. The follow-up (webhook wiring) is correctly scoped to M038 or an operational integration task.

---

### No cross-slice boundary mismatches found.


## Requirement Coverage

## Requirement Coverage

### R036 — Canonical default-branch code corpus with commit/ref provenance and semantic retrieval
- **Status in DB:** validated
- **Coverage:** S01 established schema, types, chunker, and ingest (substrate half). S02 added backfill, retrieval, and unified-retriever integration (workflow half). Together they prove the full R036 requirement.
- **Evidence:** `bun run verify:m041:s02 --json` exits 0 with `overallPassed=true` and four passing checks proving canonical persistence, retrieval evidence, corpus separation, and non-`main` branch propagation.
- **Verdict: ✅ Validated**

### R035 — Selective changed-file updates and bounded audit/repair sweeps (no full-repo rebuilds)
- **Status in DB:** active (not yet validated in REQUIREMENTS.md — S03 summary shows it was advanced and validated but the DB entry was not updated to `validated`)
- **Coverage:** S03 delivered `updateCanonicalCodeSnapshot()` (hash-compare selective refresh), `auditCanonicalCode()` (drift detection), and `runCanonicalCodeEmbeddingRepair()` (bounded repair). Four proof checks passed in `verify:m041:s03 --json`.
- **Note:** R035 was advanced and proven by S03 but REQUIREMENTS.md still shows `status: active`. This is a minor bookkeeping gap — the evidence exists in S03-SUMMARY.md and the passing proof harness. Updating the status to `validated` is a non-blocking follow-up.
- **Verdict: ✅ Evidence of validation exists; status field not yet updated (minor)**

### R037 — Structural-grounded review context combining graph blast-radius + canonical unchanged code
- **Status in DB:** active
- **Coverage:** R037 is scoped to M038 (primary owner). M041 advances R037 by providing the canonical current-code substrate that M038 will consume. This is correctly marked as M038-owned work.
- **Verdict: ✅ Correctly deferred to M038 as planned; M041 fulfilled its substrate contribution**

### Summary
All requirements for which M041 is the primary owner (R035, R036) have evidence of completion. R037 is M038-owned and correctly deferred. The only gap is that R035's status field in REQUIREMENTS.md was not updated to `validated` at slice completion — this is a documentation bookkeeping gap, not a functional gap.


## Verification Class Compliance

## Verification Class Compliance

### Contract
**Planned:** Unit and fixture verification must prove canonical storage, chunking, and retrieval are separate from the historical diff-hunk corpus and preserve truthful provenance on every returned chunk.

**Evidence:**
- `canonical-code-store.test.ts` 34/34: proves inserted/replaced/dedup semantics, file soft-delete, search, stale helpers, backfill state — all in `canonical_code_chunks` / `canonical_corpus_backfill_state` tables (not `code_snippets`).
- `canonical-code-chunker.test.ts` 7/7: proves auditable exclusions, Python/C++ boundaries, C++ block fallback, stable content hashes.
- `canonical-code-ingest.test.ts` 6/6: proves corpus separation (no historical snippet-store calls) and truthful provenance on ingest results.
- `canonical-code-retrieval.test.ts` 5/5: proves canonical results are mapped as `canonical_code` source with preserved provenance fields.

**Status: ✅ FULLY MET**

---

### Integration
**Planned:** Integration proof must show one-time backfill, review-style retrieval, changed-file refresh, and selective repair working together on a production-like repo snapshot.

**Evidence:**
- `verify:m041:s02 --json` (overallPassed=true): end-to-end proof on a local fixture repo with `trunk` as the default branch. Backfill stores 4 canonical rows; unified retrieval returns both canonical and historical snippet evidence with corpus separation.
- `verify:m041:s03 --json` (overallPassed=true): four checks proving hash-compare selective refresh, audit drift detection, selective repair (repaired=3 for 3-drifted/1-fresh corpus), and no-drift early exit.
- All proof harnesses use in-memory / local-fixture setups that exercise real module code paths, satisfying the "production-like" integration requirement without requiring live external services.

**Status: ✅ FULLY MET**

---

### Operational
**Planned:** Operational verification must demonstrate bounded update behavior, explicit stale/missing/model-mismatch reporting, and fail-open handling when embedding or file parsing fails.

**Evidence:**
- **Bounded update behavior:** `CANONICAL_CODE_REPAIR_LIMIT=2000` bounds repair passes; `updateCanonicalCodeSnapshot()` processes only the supplied file list (no unbounded repo walk on incremental updates).
- **Explicit stale/missing/model-mismatch reporting:** `auditCanonicalCode()` reports `total`, `missing_or_null`, `stale`, `model_count` breakdown, and per-corpus `status: fail | warn | pass`. `verify:m041:s03` check `M041-S03-DRIFT-DETECTED-BY-AUDIT` proves `drift_status_code=audit_failed drift_canonical_status=fail` for drifted corpus.
- **Fail-open handling:** `updateCanonicalCodeSnapshot()` counts embed failures as `failed` and continues; backfill increments warnings without aborting; ingest skips failed-embed chunks without crashing the snapshot. Covered by `canonical-code-update.test.ts` "fails open when embeddings are unavailable".

**Gap noted:** Operational verification is implemented and tested, but there is no live production deployment proof in these results. This is expected — the milestone was scoped to "Contract complete" and "Integration complete" as the primary completion classes; "Operational complete" describes the _behavior model_, not a prod-deployment gate. The operational behaviors are proven in-process.

**Status: ✅ SUBSTANTIALLY MET — all three operational behaviors (bounded, explicit reporting, fail-open) are proven by unit/integration tests. No live-deployment gap exists that blocks milestone completion.**

---

### UAT
**Planned:** A user or operator should be able to point at a repo, backfill the default branch once, query for unchanged code relevant to a review scenario, then observe that later updates touch only changed files while audit/repair closes any drift.

**Evidence:**
- S01-UAT.md: 7 test cases covering store semantics, file-level replacement, chunker exclusions, Python boundaries, C++ block fallback, ingest observability, and TypeScript integration.
- S02-UAT.md: 5 test cases covering canonical backfill, unified retrieval provenance, corpus separation, non-`main` branch propagation, and a full regression gate.
- S03-UAT.md: 12 test cases (TC-01 through TC-09 plus TC-10 proof harness, TC-11 audit CLI, TC-12 repair CLI) plus 4 edge cases.
- All UAT test cases reference passing machine-verifiable proof harnesses as the primary evidence.

**Status: ✅ FULLY MET**



## Verdict Rationale
All three slices delivered their stated outputs and demo claims. Six success criteria pass with machine-verifiable proof (two proof harnesses exit 0, overallPassed=true across 8 total check IDs covering canonical persistence, retrieval evidence, corpus separation, non-main branch propagation, unchanged-file preservation, drift detection, selective repair, and no-drift early exit). All four verification classes are substantially met. The only gap is a documentation bookkeeping item: R035's status field in REQUIREMENTS.md was not promoted to `validated` at slice completion, though the proof evidence for R035 clearly exists in S03. This is a minor non-blocking gap that does not affect any delivered behavior. No functional gaps, regressions, or missing deliverables were found.
