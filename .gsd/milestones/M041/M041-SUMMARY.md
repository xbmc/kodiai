---
id: M041
title: "Canonical Repo-Code Corpus"
status: complete
completed_at: 2026-04-05T16:52:54.083Z
key_decisions:
  - D036: Canonical code chunks use a read-then-write upsert (not ON CONFLICT) because three distinct outcomes are needed — inserted, replaced (changed content, must re-embed), and dedup (unchanged, skip embedding). PostgreSQL ON CONFLICT DO UPDATE cannot distinguish dedup from replace, so the outcome is made explicit via SELECT-then-INSERT-or-UPDATE with content-hash comparison.
  - D028 (reaffirmed): M041 was scoped as a separate sibling substrate milestone to M040; this remained correct — graph blast-radius narrowing and canonical current-code embeddings solve different problems and their separation prevented M038 from rebuilding substrate logic locally.
  - Keep canonical chunking in a dedicated module (`canonical-code-chunker.ts`) rather than extending diff-hunk chunker semantics — the two have fundamentally different exclusion and boundary rules that would conflict if merged.
  - Use a dedicated `canonical_code` source label in unified retrieval rather than flattening into the existing `snippet` corpus — preserves provenance separation for downstream prompt packing and audit.
  - Fail-open at item granularity throughout (ingest, backfill, update, repair) — a single file or chunk embedding failure increments a counter and continues rather than aborting the whole pass. This makes the canonical corpus buildable incrementally even under transient embedding-service failures.
  - Content-hash comparison (not re-chunking) determines unchanged vs changed during selective refresh — loading live chunk identities and comparing hashes avoids re-chunking and re-embedding files that have not changed.
  - number→bigint ID bridge (`Number(bigint)` / `BigInt(number)`) is the pattern for integrating bigint-PK tables with the generic number-keyed repair infrastructure — safe for corpus sizes well below JS Number.MAX_SAFE_INTEGER.
  - Canonical code audit aggregates at the global table level (not per-repo) to match the operator view of a single corpus, consistent with how other corpora are audited.
key_files:
  - src/db/migrations/033-canonical-code-corpus.sql
  - src/knowledge/canonical-code-types.ts
  - src/knowledge/canonical-code-store.ts
  - src/knowledge/canonical-code-store.test.ts
  - src/knowledge/canonical-code-chunker.ts
  - src/knowledge/canonical-code-chunker.test.ts
  - src/knowledge/canonical-code-ingest.ts
  - src/knowledge/canonical-code-ingest.test.ts
  - src/knowledge/canonical-code-backfill.ts
  - src/knowledge/canonical-code-backfill.test.ts
  - src/knowledge/canonical-code-retrieval.ts
  - src/knowledge/canonical-code-retrieval.test.ts
  - src/knowledge/canonical-code-update.ts
  - src/knowledge/canonical-code-update.test.ts
  - src/knowledge/retrieval.ts
  - src/knowledge/embedding-audit.ts
  - src/knowledge/embedding-repair.ts
  - src/knowledge/runtime.ts
  - scripts/embedding-repair.ts
  - scripts/verify-m041-s02.ts
  - scripts/verify-m041-s02.test.ts
  - scripts/verify-m041-s03.ts
  - scripts/verify-m041-s03.test.ts
  - src/knowledge/index.ts
  - package.json
lessons_learned:
  - Slice-level verification gates catch type regressions that task-level gates miss: S02's proof-harness tests had incomplete nested fixture override shapes that only failed at slice close when `tsc --noEmit` was rerun over the full assembled set. Running `tsc --noEmit` at both task and slice close is necessary, not redundant.
  - The `ON CONFLICT DO UPDATE` pattern is insufficient when you need to distinguish three outcomes (inserted / replaced / dedup) — the read-then-write pattern with explicit outcome tracking is the right tool when accurate progress counters matter (e.g., for resumable backfill accounting).
  - Injectable `_fn` override pattern for proof harness negative-path tests avoids module mocking complexity while still exercising real code paths — establish this pattern early in a milestone so all three slices' proof harnesses are consistent.
  - Proof harness fixture repos should use a non-`main` default branch (e.g., `trunk`) from the start — this prevents the hard-coded-`main` regression from being invisible until a real multi-repo deployment.
  - bigint PK tables (PostgreSQL `bigserial`) require an explicit Number/BigInt bridge when integrating with generic repair infrastructure that assumes number-keyed rows — document this bridge as a pattern in KNOWLEDGE.md for the next corpus that uses bigint PKs.
  - Content-hash comparison for selective refresh is more reliable than re-chunking to detect changes — re-chunking a file with stable content can produce slightly different chunk boundaries depending on whitespace or parser state, causing false 'changed' signals. Stable content hashes from the committed snapshot are the correct skip predicate.
  - File-level soft-delete on identity shrink (delete all live rows then re-upsert survivors) is correct but causes re-upserts for unchanged sibling chunks. A chunk-level delete API would be more surgical; log this as a follow-up rather than blocking, since correctness is preserved.
  - Stateless bounded repair (CANONICAL_CODE_REPAIR_LIMIT) is sufficient for new corpora with no SLA on repair completion time — adding persistent checkpointing is a follow-up only if repair jobs regularly time out in production.
---

# M041: Canonical Repo-Code Corpus

**Built a canonical default-branch code corpus — separate from historical diff hunks — with dedicated schema, auditable chunking, resumable backfill, semantic retrieval, incremental hash-compare refresh, and bounded audit/repair that downstream review systems can now consume as truthful unchanged-code evidence.**

## What Happened

M041 delivered a complete, self-maintaining canonical current-code corpus in three slices.

**S01 — Canonical Schema, Chunking, and Storage** established the substrate. `src/db/migrations/033-canonical-code-corpus.sql` creates dedicated `canonical_code_chunks` and `canonical_corpus_backfill_state` tables with SQL CHECK constraints enforcing chunk_type/backfill-status invariants at the schema boundary. `canonical-code-types.ts` defines discriminated union types matching the schema. `canonical-code-store.ts` implements the store with explicit inserted/replaced/dedup upsert semantics (read-then-write pattern needed because `ON CONFLICT DO UPDATE` cannot distinguish dedup from replace), file-scoped soft-delete replacement, semantic/full-text search helpers, stale-row repair helpers, and backfill-state persistence. `canonical-code-chunker.ts` is a dedicated chunker (not an extension of the historical diff-hunk chunker) with auditable exclusion reasons for generated code, vendored paths, lockfiles, build artifacts, and binary assets; language-aware symbol boundaries for Python, TypeScript, JavaScript, and C++; and block fallback only when no class/function boundary exists at all. `canonical-code-ingest.ts` assembles these into a snapshot ingest orchestrator that soft-deletes a file's live rows before re-upserting, producing truthful inserted/replaced/dedup outcome counts.

**S02 — Default-Branch Backfill and Semantic Retrieval** turned the substrate into a usable workflow. `canonical-code-backfill.ts` implements a resumable one-shot default-branch backfill pipeline that resolves the repo's actual default branch through the existing GitHub App workspace path, is intentionally fail-open at file and chunk granularity (embedding/store failures increment warnings and preserve partial progress without aborting), and persists progress in `canonical_corpus_backfill_state`. `canonical-code-retrieval.ts` provides provenance-rich semantic retrieval returning canonical ref, commit SHA, file path, line span, chunk type, symbol name, content hash, and embedding model. `retrieval.ts` was extended to accept a caller-supplied canonicalRef (no hard-coded `main`) and integrate canonical results as a distinct `canonical_code` unified corpus preserving separation from historical `snippet` evidence. A deterministic proof harness (`verify:m041:s02`) proved four things on a `trunk`-branched fixture: canonical persistence, current-code retrieval evidence, corpus separation, and non-`main` branch propagation end-to-end. During slice closure, TypeScript regressions in the proof-harness tests (incomplete nested fixture override shapes) were found and fixed before the final gate passed.

**S03 — Incremental Refresh and Audit/Repair** closed the steady-state freshness loop. `canonical-code-update.ts` implements `updateCanonicalCodeSnapshot()` which loads live chunk identities per file from the store, compares new chunk content hashes against existing rows, and skips unchanged chunks (same identity + same hash) with zero DB writes. Changed or new chunks are re-embedded and upserted. When the identity set shrinks (a function was deleted), all live rows for that file are soft-deleted before re-upserting survivors. `embedding-audit.ts` was extended with `auditCanonicalCode()` for global corpus-level drift detection (stale/missing/model-mismatch). `embedding-repair.ts` was extended with `createCanonicalCodeRepairStore()` (a bigint-PK bridge to the generic number-keyed repair interface) and `runCanonicalCodeEmbeddingRepair()` with `CANONICAL_CODE_REPAIR_LIMIT=2000`. The `scripts/embedding-repair.ts` CLI gained `--repo` and `--ref` flags for the canonical_code corpus. A four-check in-memory proof harness (`verify:m041:s03`) covered unchanged-file preservation, drift detection, selective repair of only drifted rows, and no-drift early exit.

## Success Criteria Results

### SC-1: Canonical corpus storage with commit/ref provenance ✅ PASS
`033-canonical-code-corpus.sql` creates `canonical_code_chunks` with `repo`, `owner`, `canonical_ref`, `commit_sha`, `file_path`, `chunk_type`, `symbol_name`, `content_hash`, `embedding`, and audit timestamps enforced by SQL CHECK constraints. `verify:m041:s02 --json` check `M041-S02-BACKFILL-STORES-CANONICAL-CHUNKS` passed with `canonicalRef=trunk filesDone=3 chunksDone=4 storedRows=4`.

### SC-2: Changed-file-only incremental update; unchanged rows untouched ✅ PASS
`canonical-code-update.ts` implements hash-compare selective refresh: same identity + same contentHash = skip, no DB write. `verify:m041:s03 --json` check `M041-S03-UNCHANGED-FILE-PRESERVATION` passed with `unchanged_upserts=0 unchanged_deletes=0 partial_upserts=1 partial_unchanged=1`. `canonical-code-update.test.ts` 5/5 tests pass including unchanged-preservation and partial-update.

### SC-3: Audit/repair detects stale/missing rows without full-repo rebuild ✅ PASS
`embedding-audit.ts` extended with `auditCanonicalCode()` for corpus-level stale/missing/model-mismatch detection. `embedding-repair.ts` extended with bounded `runCanonicalCodeEmbeddingRepair()` (CANONICAL_CODE_REPAIR_LIMIT=2000). `verify:m041:s03 --json` checks `M041-S03-DRIFT-DETECTED-BY-AUDIT` (drift_status_code=audit_failed, clean_status_code=audit_ok), `M041-S03-SELECTIVE-REPAIR-FIXES-ONLY-DRIFTED-ROWS` (repaired=3 embedCallCount=3 writeCallCount=3 on 3-drifted/1-fresh corpus), and `M041-S03-REPAIR-SKIPS-WHEN-NO-DRIFT` (status_code=repair_not_needed embedCallCount=0) all passed.

### SC-4: Review-time retrieval returns canonical current-code evidence (not historical PR hunks) ✅ PASS
`canonical-code-retrieval.ts` returns provenance-rich results. `retrieval.ts` integrates canonical results as distinct `canonical_code` corpus with per-corpus ranking weights. `verify:m041:s02 --json` check `M041-S02-RETRIEVAL-RETURNS-CANONICAL-CURRENT-CODE` passed (`canonicalCodeCount=2 topCanonicalFilePath=src/auth/token.ts`) and `M041-S02-RETRIEVAL-PRESERVES-CORPUS-SEPARATION` passed (`snippetCount=1 unifiedSources=["snippet","canonical_code","canonical_code"]`).

### SC-5: Contract completeness — storage, chunking, retrieval separate from historical diff-hunk corpus ✅ PASS
`canonical-code-chunker.ts` supports Python, TypeScript, JavaScript, and C++ with auditable exclusions and symbol-poor C++ block fallback. `canonical-code-ingest.test.ts` corpus-separation test proves no historical snippet-store calls from canonical ingest path. `bun run tsc --noEmit` exits 0 at milestone close.

### SC-6: Non-`main` default branch propagates end to end ✅ PASS
`verify:m041:s02 --json` check `M041-S02-NONMAIN-DEFAULT-BRANCH-IS-RESPECTED` passed (`backfillCanonicalRef=trunk retrievalCanonicalRef=trunk`). `retrieval.ts` accepts caller-supplied `canonicalRef` threaded through all retrieval calls.

## Definition of Done Results

### All slices complete ✅
- S01 ✅ — `verification_result: passed`, `completed_at: 2026-04-05T14:12:16.445Z`. Summary exists at `.gsd/milestones/M041/slices/S01/S01-SUMMARY.md`.
- S02 ✅ — `verification_result: passed`, `completed_at: 2026-04-05T14:35:30.780Z`. Summary exists at `.gsd/milestones/M041/slices/S02/S02-SUMMARY.md`.
- S03 ✅ — `verification_result: passed`, `completed_at: 2026-04-05T16:45:46.307Z`. Summary exists at `.gsd/milestones/M041/slices/S03/S03-SUMMARY.md`.

### All slice summaries exist ✅
Confirmed via `find .gsd/milestones/M041 -name "S*-SUMMARY.md"` — S01, S02, and S03 summaries are present.

### Code changes exist in non-.gsd/ files ✅
`git diff --stat cb3a6c0cf6 HEAD -- ':!.gsd/'` shows 26 files changed, 7278 net insertions: new canonical corpus modules (store, chunker, ingest, backfill, retrieval, update), extended audit/repair modules, two proof harnesses, and migration.

### All tests pass ✅
`bun test ./src/knowledge/canonical-code-store.test.ts ./src/knowledge/canonical-code-chunker.test.ts ./src/knowledge/canonical-code-ingest.test.ts ./src/knowledge/canonical-code-backfill.test.ts ./src/knowledge/canonical-code-retrieval.test.ts ./src/knowledge/canonical-code-update.test.ts` — 61/61 pass. `bun run tsc --noEmit` exits 0.

### Proof harnesses pass ✅
`bun run verify:m041:s02 -- --json` exits 0, overallPassed=true (4 checks). `bun run verify:m041:s03 -- --json` exits 0, overallPassed=true (4 checks).

### Cross-slice integration works ✅
S01 → S02 boundary: backfill in `canonical-code-backfill.ts` calls `ingestCanonicalCodeSnapshot()` from S01. S01+S02 → S03 boundary: `updateCanonicalCodeSnapshot()` reuses store interface plus the embed-on-ingest pattern from S02; audit now covers the `canonical_code` unified corpus from S02. No boundary mismatches found.

### Milestone validation passed ✅
`.gsd/milestones/M041/M041-VALIDATION.md` verdict=pass, remediation_round=0. Six success criteria individually pass. All three verification classes (contract, integration, operational) substantially met. All four UAT coverage documents exist (S01-UAT.md, S02-UAT.md, S03-UAT.md).

## Requirement Outcomes

### R035 — Selective changed-file updates and bounded audit/repair sweeps
**Transition: active → validated**
**Evidence:** S03 delivered `updateCanonicalCodeSnapshot()` with content-hash comparison (no full-repo rebuilds), `auditCanonicalCode()` for corpus-level drift detection, and `runCanonicalCodeEmbeddingRepair()` bounded by `CANONICAL_CODE_REPAIR_LIMIT=2000`. `verify:m041:s03 --json` exits 0, overallPassed=true, all four checks pass: UNCHANGED-FILE-PRESERVATION, DRIFT-DETECTED-BY-AUDIT, SELECTIVE-REPAIR-FIXES-ONLY-DRIFTED-ROWS, and REPAIR-SKIPS-WHEN-NO-DRIFT. Status already updated to `validated` in REQUIREMENTS.md at S03 slice close.

### R036 — Canonical default-branch code corpus with commit/ref provenance and semantic retrieval
**Transition: active → validated**
**Evidence:** S01 established substrate (schema, chunker, ingest, store). S02 completed the workflow (backfill, retrieval, unified-retriever integration). Together they satisfy the full requirement. `verify:m041:s02 --json` exits 0, overallPassed=true, four checks pass proving canonical persistence, retrieval evidence, corpus separation, and non-`main` branch propagation. Status updated to `validated` in REQUIREMENTS.md.

### R037 — Structural-grounded review context combining graph blast-radius + canonical unchanged code
**Transition: active → active (no change, correctly deferred)**
**Evidence:** R037 is owned by M038. M041 advances R037 by providing the `canonical_code` unified retrieval corpus that M038 will consume as unchanged-code evidence. The substrate contribution is complete; the M038 integration (prompt packing policy, Review Details surface) remains the M038 owner's responsibility.

## Deviations

S02's proof-harness tests (`scripts/verify-m041-s02.test.ts`) had incomplete nested fixture override shapes that caused TypeScript regressions caught at slice close (not during task execution). The closer repaired those shapes and reran the full gate before completing the slice. No product-scope deviation from the milestone plan resulted. All three slices delivered exactly their planned scope.

## Follow-ups

1. Wire `updateCanonicalCodeSnapshot()` into the push/merge webhook handler (M038 or an operational integration task) so changed files automatically trigger selective refresh without a manual CLI invocation.
2. M038 needs to decide prompt-packing policy for canonical_code vs snippet ranking — canonical hits are currently weighted equally to other corpora in unified retrieval; M038 may need to boost canonical evidence for structural-grounded review.
3. Add a persistent cursor/checkpoint to canonical code repair if repair jobs regularly time out (corpus >2000 drifted rows per pass).
4. Consider a chunk-level delete API on `CanonicalCodeStore` to make the identity-shrink path more surgical (avoid re-upserting unchanged sibling chunks when only one chunk identity is removed from a file).
5. R037 remains active and is the next integration requirement: M038 should consume the `canonical_code` unified retrieval corpus as truthful unchanged-code evidence alongside M040's graph blast-radius context.
