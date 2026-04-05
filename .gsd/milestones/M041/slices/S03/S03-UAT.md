# S03: Incremental Refresh and Audit/Repair — UAT

**Milestone:** M041
**Written:** 2026-04-05T16:45:46.307Z

## UAT: S03 — Incremental Refresh and Audit/Repair

### Preconditions

- Kodiai repo checked out at HEAD, `bun install` complete.
- `bun run tsc --noEmit` exits 0 (no TypeScript errors).
- All prior slice tests still pass (S01, S02 test suites green).

---

### TC-01: Unchanged File Preservation

**What it proves:** When `updateCanonicalCodeSnapshot()` receives a file whose content has not changed since last ingest, no DB upserts or deletes are issued.

**Steps:**

1. Create an in-memory `WriteHarness` pre-populated with two chunk rows for `src/player.ts`: one `module` chunk with `UNCHANGED_HASH` and one `function/boot` chunk with its correct hash.
2. Call `updateCanonicalCodeSnapshot()` with the same file content used to produce those hashes.
3. Inspect `harness.upsertCalls` and `harness.deleteCalls`.

**Expected outcome:**
- `upsertCalls === 0` — no DB writes issued.
- `deleteCalls === 0` — no rows deleted.
- `result.unchanged >= 2` — both chunks counted as unchanged.
- `result.updated === 0`, `result.failed === 0`.

**Machine check:** `M041-S03-UNCHANGED-FILE-PRESERVATION` sub-check A in `verify:m041:s03 --json` reports `unchanged_upserts=0 unchanged_deletes=0`.

---

### TC-02: Partial File Update

**What it proves:** When one chunk in a file has a stale hash and another is current, only the stale chunk is re-embedded and upserted.

**Steps:**

1. Create an in-memory `WriteHarness` with two chunks for `src/player.ts`: the `module` chunk has the correct hash; the `function/boot` chunk has `STALE_HASH` (intentionally wrong).
2. Call `updateCanonicalCodeSnapshot()` with the current file content (which produces the correct hash for `function/boot`).
3. Inspect `harness.upsertCalls`, `result.unchanged`, `result.updated`.

**Expected outcome:**
- `upsertCalls === 1` — only the changed chunk triggers a write.
- `result.unchanged >= 1` — the module chunk is preserved.
- `result.updated >= 1` — the boot function chunk is updated.

**Machine check:** `M41-S03-UNCHANGED-FILE-PRESERVATION` sub-check B: `partial_upserts=1 partial_unchanged=1`.

---

### TC-03: Excluded File Skip

**What it proves:** Files rejected by the chunker (binary, oversized, excluded extension) are never inspected or written.

**Steps:**

1. Create a `WriteHarness` (empty is fine).
2. Call `updateCanonicalCodeSnapshot()` with a `.png` file or a file the chunker marks as excluded.
3. Inspect `harness.upsertCalls`, `harness.deleteCalls`, and `result.filesExcluded`.

**Expected outcome:**
- `upsertCalls === 0`, `deleteCalls === 0`.
- `result.filesExcluded === 1`.
- No store `listChunksForFile` call for the excluded file.

**Covered by:** `canonical-code-update.test.ts` — "skips excluded files without inspecting or rewriting store rows".

---

### TC-04: Stale Identity Removal

**What it proves:** When a changed file drops a chunk identity (function deleted), the updater soft-deletes all live rows for that file and re-upserts the surviving chunks.

**Steps:**

1. Pre-populate the store with two chunk rows for a file.
2. Call `updateCanonicalCodeSnapshot()` with new content that produces only one chunk identity (one function removed).
3. Inspect `harness.deleteCalls` and the surviving rows.

**Expected outcome:**
- `deleteCalls === 1` — the file's rows were cleared.
- The surviving chunk is re-upserted (`upsertCalls === 1`).
- `result.removed` reflects the dropped identity count.

**Covered by:** `canonical-code-update.test.ts` — "removes stale identities when a changed file drops a chunk".

---

### TC-05: Fail-Open Embedding

**What it proves:** If the embedding provider throws during a chunk update, the chunk is counted as `failed` and the loop continues without crashing.

**Steps:**

1. Create an embedding provider stub that throws `new Error("provider unavailable")`.
2. Call `updateCanonicalCodeSnapshot()` with a changed file.
3. Inspect `result.failed` and verify no exception propagated.

**Expected outcome:**
- `result.failed >= 1` — the chunk that could not be embedded is counted.
- No exception thrown from `updateCanonicalCodeSnapshot()`.
- Other files in the request are still processed.

**Covered by:** `canonical-code-update.test.ts` — "fails open when embeddings are unavailable for a changed chunk".

---

### TC-06: Drift Detection — Drifted Corpus

**What it proves:** The embedding audit report surfaces stale/missing/model-mismatch canonical_code rows as `status="fail"` and `audit_failed`.

**Steps:**

1. Call `buildEmbeddingAuditReport()` with a `canonical_code` corpus entry that has `missing_or_null=1`, `stale=2`, and `actual_model_counts: { "voyage-4": 27, "voyage-3": 3 }` (model mismatch).
2. Call `finalizeEmbeddingAuditReport()` on the result.
3. Find the `canonical_code` entry in `report.corpora` and inspect `status`, `model_mismatch`.
4. Check the envelope `status_code`.

**Expected outcome:**
- Envelope `status_code === "audit_failed"`.
- `canonical_code.status === "fail"`.
- `canonical_code.missing_or_null > 0`.
- `canonical_code.model_mismatch > 0`.

**Machine check:** `M041-S03-DRIFT-DETECTED-BY-AUDIT` — `drift_status_code=audit_failed drift_canonical_status=fail`.

---

### TC-07: Drift Detection — Clean Corpus

**What it proves:** A fully fresh canonical_code corpus passes the audit without raising false alarms.

**Steps:**

1. Call `buildEmbeddingAuditReport()` with a `canonical_code` corpus entry that has all zeroes for missing/stale and `actual_model_counts: { "voyage-4": 30 }`.
2. Call `finalizeEmbeddingAuditReport()`.
3. Check `canonical_code.status` and envelope `status_code`.

**Expected outcome:**
- Envelope `status_code === "audit_ok"`.
- `canonical_code.status === "pass"`.

**Machine check:** `M041-S03-DRIFT-DETECTED-BY-AUDIT` — `clean_status_code=audit_ok`.

---

### TC-08: Selective Repair — Only Drifted Rows

**What it proves:** The repair runner embeds exactly the stale/missing/model-mismatch rows and leaves the fresh row untouched.

**Steps:**

1. Create a `listRepairCandidates` stub returning 4 rows: `id=1` stale=true, `id=2` model="voyage-3" (mismatch), `id=3` model=null (missing), `id=4` model="voyage-4" stale=false (fresh).
2. Run `runEmbeddingRepair()` with corpus="canonical_code".
3. Count embed calls and write calls.

**Expected outcome:**
- `embedCallCount === 3` — ids 1, 2, 3 re-embedded.
- `writeCallCount === 3` — ids 1, 2, 3 written back.
- `report.repaired === 3`, `report.failed === 0`.
- `report.status_code === "repair_completed"`.

**Machine check:** `M041-S03-SELECTIVE-REPAIR-FIXES-ONLY-DRIFTED-ROWS` — `repaired=3 embedCallCount=3 writeCallCount=3`.

---

### TC-09: No-Drift Early Exit

**What it proves:** When all canonical_code rows are fresh, the repair runner returns `repair_not_needed` without calling the embedding provider.

**Steps:**

1. Create a `listRepairCandidates` stub returning 2 rows, both with `model="voyage-4"`, `stale=false`, `embedding` non-null.
2. Run `runEmbeddingRepair()` with corpus="canonical_code".
3. Check `report.status_code` and embed call count.

**Expected outcome:**
- `report.status_code === "repair_not_needed"`.
- `embedCallCount === 0`.
- `report.repaired === 0`.

**Machine check:** `M041-S03-REPAIR-SKIPS-WHEN-NO-DRIFT` — `status_code=repair_not_needed embedCallCount=0`.

---

### TC-10: Proof Harness End-to-End

**What it proves:** The `verify:m041:s03` CLI integrates all four checks into a single machine-checkable exit.

**Steps:**

1. Run `bun run verify:m041:s03 -- --json`.
2. Parse stdout JSON.

**Expected outcome:**
```json
{
  "overallPassed": true,
  "checks": [
    { "id": "M041-S03-UNCHANGED-FILE-PRESERVATION", "passed": true },
    { "id": "M041-S03-DRIFT-DETECTED-BY-AUDIT", "passed": true },
    { "id": "M041-S03-SELECTIVE-REPAIR-FIXES-ONLY-DRIFTED-ROWS", "passed": true },
    { "id": "M041-S03-REPAIR-SKIPS-WHEN-NO-DRIFT", "passed": true }
  ]
}
```
Exit code must be 0.

---

### TC-11: Audit CLI Includes canonical_code Corpus

**What it proves:** `scripts/embedding-audit.ts` reports on the canonical_code corpus in its JSON output contract.

**Steps:**

1. Run `bun test ./scripts/embedding-audit.test.ts`.
2. Verify all 3 tests pass.

**Expected outcome:** 3/3 pass. The audit CLI parses `--json`, returns stable exit signaling, and reports failures deterministically.

---

### TC-12: Repair CLI Accepts --repo and --ref for canonical_code

**What it proves:** `scripts/embedding-repair.ts` accepts and threads through the `--repo` and `--ref` flags needed for canonical_code corpus repair.

**Steps:**

1. Run `bun test ./scripts/embedding-repair.test.ts`.
2. Verify all 4 tests pass.

**Expected outcome:** 4/4 pass. The repair CLI parses corpus, status, resume, dry-run, and json flags; surfaces corpus-specific failure diagnostics; returns stable exit codes.

---

### Edge Cases

- **TC-EC-01:** File with zero chunks after chunking (all content excluded by symbol heuristics) → `filesProcessed` increments but `chunksSeen` stays 0; any existing rows for that file are deleted (identity set went to empty).
- **TC-EC-02:** Audit called with no `canonical_code` rows at all (`total=0`, `missing_or_null=0`) → status should be `"pass"` (empty corpus is not drifted).
- **TC-EC-03:** Repair called with `CANONICAL_CODE_REPAIR_LIMIT` rows all drifted → exactly `CANONICAL_CODE_REPAIR_LIMIT` rows processed per pass; re-run processes the remainder.
- **TC-EC-04:** `createCanonicalCodeRepairStore()` with a bigint ID well within `Number.MAX_SAFE_INTEGER` → no precision loss in number→bigint bridge.
