---
id: S03
parent: M041
milestone: M041
provides:
  - updateCanonicalCodeSnapshot() — steady-state selective refresh for canonical code corpus (wire into push/merge webhook).
  - auditCanonicalCode() — canonical_code corpus audit coverage in the global embedding audit report.
  - runCanonicalCodeEmbeddingRepair() — bounded repair runner for stale/missing/model-mismatch canonical rows.
  - scripts/embedding-repair.ts --corpus canonical_code --repo --ref — CLI operator interface for manual/scheduled repair.
  - verify:m041:s03 — machine-checkable proof harness for S03 invariants.
requires:
  - slice: S01
    provides: CanonicalCodeStore interface, upsertChunk/deleteChunksForFile methods, canonical_code_chunks schema, chunk identity and content-hash types.
  - slice: S02
    provides: backfill pattern, EmbeddingProvider/store integration, embed-on-ingest flow that update path reuses; unified retrieval corpus separation that audit now covers.
affects:
  []
key_files:
  - src/knowledge/canonical-code-update.ts
  - src/knowledge/canonical-code-update.test.ts
  - src/knowledge/canonical-code-store.ts
  - src/knowledge/canonical-code-types.ts
  - src/knowledge/embedding-audit.ts
  - src/knowledge/embedding-repair.ts
  - src/knowledge/runtime.ts
  - scripts/embedding-repair.ts
  - scripts/verify-m041-s03.ts
  - scripts/verify-m041-s03.test.ts
  - package.json
key_decisions:
  - Steady-state selective refresh is separate from one-shot backfill semantics — updateCanonicalCodeSnapshot() is a new module with its own types and counters.
  - Content-hash comparison (not re-chunking) determines unchanged vs changed: same identity + same contentHash = skip, no DB write.
  - File-level soft-delete fires only when the chunk identity set shrinks; normal hash-equal updates never trigger deletes.
  - Canonical code audit aggregates at the table level (not per-repo) to match the operator view of a single global corpus.
  - number→bigint ID bridge in the canonical code repair store adapter is the established pattern for integrating bigint-PK tables with the generic number-keyed repair infrastructure.
  - No persistent checkpoint for canonical code repair — bounded per-pass limit (CANONICAL_CODE_REPAIR_LIMIT=2000) is sufficient.
  - Proof harness checks use injectable _fn overrides (the established _fn override pattern) so negative-path tests can exercise each branch without module mocking.
patterns_established:
  - Selective update pattern: load live identities → compare content hashes → skip unchanged → re-embed changed/new → delete-and-restore on identity shrink.
  - number→bigint ID bridge for repair store adapters when the corpus uses a bigint PK.
  - Global-table audit for canonical_code corpus (no per-repo query, single aggregated pass over the whole table).
  - Stateless repair with bounded per-pass limit as the default for new corpora without checkpointing.
observability_surfaces:
  - updateCanonicalCodeSnapshot() emits structured pino logs per file (excluded, removed identities, completed) and a summary log with aggregate counters (filesTotal, filesProcessed, filesExcluded, chunksSeen, removed, updated, unchanged, failed).
  - auditCanonicalCode() contributes canonical_code corpus stats to the embedding audit report with status=fail/warn/pass and model_mismatch count.
  - runCanonicalCodeEmbeddingRepair() emits structured repair report with processed/repaired/skipped/failed counters.
  - verify:m041:s03 --json emits machine-checkable proof JSON with per-check status_code and detail fields.
drill_down_paths:
  - .gsd/milestones/M041/slices/S03/tasks/T01-SUMMARY.md
  - .gsd/milestones/M041/slices/S03/tasks/T02-SUMMARY.md
  - .gsd/milestones/M041/slices/S03/tasks/T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-05T16:45:46.307Z
blocker_discovered: false
---

# S03: Incremental Refresh and Audit/Repair

**Added selective changed-file refresh, canonical-corpus audit/repair coverage, and a four-check in-memory proof harness — making the canonical code corpus self-maintaining without full-repo rebuilds.**

## What Happened

S03 delivered three tightly-scoped additions that together close the steady-state freshness loop for the canonical code corpus.

**T01 — Selective Refresh Path**
`src/knowledge/canonical-code-update.ts` implements `updateCanonicalCodeSnapshot()`, the steady-state counterpart to the one-shot backfill added in S02. It accepts a list of touched files with their current content, loads live chunk identities per file from the store, and compares new chunk content hashes against existing rows. Unchanged chunks (same identity + same hash) are skipped entirely without any DB write. Changed or new chunks are re-embedded and upserted. When the new chunk identity set for a file is smaller than the live set (a function was deleted), all live rows for that file are soft-deleted and the surviving identities are re-upserted via the normal upsert path. The result includes per-file and aggregate counters: `removed`, `updated`, `unchanged`, `failed`. Fail-open embedding is preserved: if the embedding provider throws or returns null for a given chunk, the chunk is counted as `failed` and the loop continues — no crash. The store was extended with `listChunksForFile()` to make the identity lookup possible, and the new API was exported from `src/knowledge/index.ts`.

**T02 — Audit and Repair Coverage**
`embedding-audit.ts` was extended to include `canonical_code` in `AUDITED_CORPORA` and `EXPECTED_CORPUS_MODELS` (voyage-4). The new `auditCanonicalCode()` function queries `canonical_code_chunks` globally for total/missing_or_null/stale counts and a model-count breakdown — surfacing model-mismatch in the same per-corpus `status: "fail" | "warn" | "pass"` shape as other corpora. On the repair side, `embedding-repair.ts` gained `canonical_code` in `EmbeddingRepairCorpus`, `NON_WIKI_REPAIR_CORPORA`, and `STALE_SUPPORTED_CORPORA`. `createCanonicalCodeRepairStore()` bridges the bigint PK of `canonical_code_chunks` into the generic `number`-keyed `EmbeddingRepairStore` interface via `Number(bigint)` / `BigInt(number)` conversion. `runCanonicalCodeEmbeddingRepair()` is the high-level runner. The `scripts/embedding-repair.ts` CLI gained `--repo` and `--ref` flags required when targeting the canonical_code corpus. `KnowledgeRuntime` and `createKnowledgeRuntime` in `runtime.ts` gained a non-optional `canonicalCodeStore` field since the store needs only a DB connection. No persistent checkpoint was added — the 2000-row `CANONICAL_CODE_REPAIR_LIMIT` bounds per-pass exposure and re-runs pick up remaining drift naturally.

**T03 — In-Memory Proof Harness**
`scripts/verify-m041-s03.ts` implements four machine-checkable checks against the real module code paths, entirely in-memory with injected store/embedding stubs:

1. **M041-S03-UNCHANGED-FILE-PRESERVATION** — Two sub-fixtures: a fully unchanged file (zero upserts, zero deletes, ≥2 unchanged) and a partially changed file (one upsert, one unchanged preserved, zero deletes on unchanged chunks). Wires the real `updateCanonicalCodeSnapshot()` with an in-memory `WriteHarness`.
2. **M041-S03-DRIFT-DETECTED-BY-AUDIT** — Calls `buildEmbeddingAuditReport()` + `finalizeEmbeddingAuditReport()` directly. Drifted scenario (2 stale + 1 missing + 3 model-mismatch) → `audit_failed`, canonical_code `status="fail"`. Clean scenario (all voyage-4, no stale/missing) → `audit_ok`, canonical_code `status="pass"`.
3. **M041-S03-SELECTIVE-REPAIR-FIXES-ONLY-DRIFTED-ROWS** — Mix of 4 rows: 3 drifted (stale, model-mismatch, missing embedding) and 1 fresh. Asserts exactly 3 embed calls, 3 writes, 0 failures — the fresh row must not be re-embedded.
4. **M041-S03-REPAIR-SKIPS-WHEN-NO-DRIFT** — All-fresh corpus. Asserts `status_code="repair_not_needed"`, 0 embed calls.

`scripts/verify-m041-s03.test.ts` covers all 28 tests (87 expects): happy-path and all negative failure branches via injectable fixture overrides using the `_fn` pattern. `verify:m041:s03` was added to `package.json`.

## Verification

All slice-level verifications passed:

1. `bun test ./src/knowledge/canonical-code-update.test.ts` — 5/5 pass (unchanged preservation, partial update, stale identity removal, excluded file skip, fail-open embedding).
2. `bun test ./scripts/embedding-audit.test.ts ./scripts/embedding-repair.test.ts` — 7/7 pass (audit CLI contract × 3, repair CLI contract × 4).
3. `bun test ./scripts/verify-m041-s03.test.ts` — 28/28 pass, 87 expects.
4. `bun run verify:m041:s03 -- --json` — exits 0, `overallPassed: true`, all 4 check IDs pass with structured detail output.
5. `bun run tsc --noEmit` — exits 0, no type errors.

## Requirements Advanced

- R035 — updateCanonicalCodeSnapshot() re-embeds only changed/new chunks via content-hash comparison (not full-repo rebuilds); auditCanonicalCode() + runCanonicalCodeEmbeddingRepair() detect and repair stale/missing/model-mismatch rows in bounded passes. Four proof checks confirm the invariants machine-checkably.

## Requirements Validated

- R035 — verify:m041:s03 --json exits 0 with overallPassed:true. All four checks pass: UNCHANGED-FILE-PRESERVATION (upsertCallCount=0 for fully unchanged file, upsertCallCount=1 for partially changed file), DRIFT-DETECTED-BY-AUDIT (audit_failed on drifted corpus, audit_ok on clean), SELECTIVE-REPAIR-FIXES-ONLY-DRIFTED-ROWS (repaired=3 embedCallCount=3 writeCallCount=3 on 3-drifted/1-fresh corpus), REPAIR-SKIPS-WHEN-NO-DRIFT (status_code=repair_not_needed embedCallCount=0).

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

None. All tasks delivered as planned. The only known limitation is the file-level soft-delete behavior on identity shrink (documented in KNOWLEDGE.md) — this is an inherent property of the current store interface, not a deviation from the plan.

## Known Limitations

1. Selective refresh uses file-level soft-delete: when a file loses any chunk identity, all live rows for that file are deleted and survivors are re-upserted. This is correct but means a file that loses one of five chunks will see four "re-upserts" even if their content is unchanged. A chunk-level delete API on the store would make this more surgical, but is not needed for correctness.

2. Canonical code repair has no persistent checkpoint. If a run is interrupted, re-running will process remaining stale rows from scratch. The 2000-row CANONICAL_CODE_REPAIR_LIMIT bounds per-pass exposure.

3. The number→bigint ID bridge in createCanonicalCodeRepairStore() is safe for typical corpus sizes (well below JS Number.MAX_SAFE_INTEGER) but would need revisiting for billions of rows.

## Follow-ups

1. Wire `updateCanonicalCodeSnapshot()` into the push/merge webhook handler so changed files automatically trigger the selective refresh path in production.
2. Add a persistent cursor/checkpoint to canonical code repair if repair jobs regularly time out (corpus >2000 drifted rows per pass).
3. Consider a chunk-level delete API on `CanonicalCodeStore` to make the identity-shrink path more surgical.

## Files Created/Modified

- `src/knowledge/canonical-code-update.ts` — New: updateCanonicalCodeSnapshot() selective refresh path — identity load, hash compare, skip/update/delete logic, fail-open embedding.
- `src/knowledge/canonical-code-update.test.ts` — New: 5 tests covering unchanged preservation, partial update, stale identity removal, excluded file skip, fail-open embedding.
- `src/knowledge/canonical-code-store.ts` — Extended: added listChunksForFile() method to support per-file identity lookup during selective refresh.
- `src/knowledge/canonical-code-types.ts` — Extended: added listChunksForFile() to CanonicalCodeStore interface.
- `src/knowledge/embedding-audit.ts` — Extended: added canonical_code to AUDITED_CORPORA/EXPECTED_CORPUS_MODELS; added auditCanonicalCode() global audit function.
- `src/knowledge/embedding-repair.ts` — Extended: added canonical_code corpus support, CANONICAL_CODE_REPAIR_LIMIT, createCanonicalCodeRepairStore() with bigint bridge, runCanonicalCodeEmbeddingRepair().
- `src/knowledge/runtime.ts` — Extended: added canonicalCodeStore to KnowledgeRuntime and createKnowledgeRuntime.
- `scripts/embedding-repair.ts` — Extended: added --repo and --ref CLI flags for canonical_code corpus; wired canonicalCodeStore.
- `scripts/verify-m041-s03.ts` — New: four-check in-memory proof harness for S03 invariants.
- `scripts/verify-m041-s03.test.ts` — New: 28 tests (87 expects) covering all four checks and all negative failure branches.
- `package.json` — Added verify:m041:s03 script entry.
