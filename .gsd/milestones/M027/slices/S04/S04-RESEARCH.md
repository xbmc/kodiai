# M027 / S04: Final Integrated Production Repair Proof — Research

**Date:** 2026-03-13

## Summary

S04 is the milestone-closing composition slice. All the major execution artifacts were implemented in prior passes — `scripts/verify-m027-s04.ts` (459 lines, 4 stable check IDs), 6 contract tests all **passing**, the package alias, and the runbook section in `docs/operations/embedding-integrity.md`. **However the milestone is not currently in a passing state.** A test-contamination bug left "Test Page" (page_id=100) with `embedding_model=voyage-code-3` in the production `wiki_pages` table, causing cascading failures in both `M027-S04-FULL-AUDIT` and `M027-S04-WIKI-REPAIR-STATE`.

**Confirmed live state (2026-03-13):**
- `bun run audit:embeddings --json` → `success=false`, `status_code=audit_failed`, `wiki_pages total=1, model_mismatch=1, actual_models=["voyage-code-3"]`
- "Test Page" (page_id=100) is in production `wiki_pages` with `embedding_model=voyage-code-3`, `has_embedding=true`
- `bun run repair:wiki-embeddings -- --status` → `status_code=repair_resume_available` because `listRepairCandidates()` still finds "Test Page" as a degraded row (wrong model)
- `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json` → fails: `M027-S04-FULL-AUDIT:audit_failed, M027-S04-WIKI-REPAIR-STATE:repair_resume_available`
- `bun test ./scripts/verify-m027-s04.test.ts` → **6 pass, 0 fail** (contract tests are healthy)

**Root causes (both must be fixed before the live proof can pass):**

**Bug 1 — `wiki-store.test.ts` uses `DATABASE_URL` as its skip guard (line 57).** In this environment `DATABASE_URL` is always set to the Azure PostgreSQL production URL (`.env` always has it). So the test suite connects to production. The `beforeEach` block truncates `wiki_pages` before each test, but the final test (`replacePageChunks replaces language_tags on re-ingest`) writes "Test Page" (page_id=100) with `embeddingModel` unset — which hits the `wiki-store.ts` fallback `opts.embeddingModel ?? "voyage-code-3"` at line 114, writing `voyage-code-3` into production. There is no `afterAll` TRUNCATE, so the test artifact persists. The established M026 pattern uses `TEST_DATABASE_URL` as the skip guard.

**Bug 2 — `scripts/backfill-wiki.ts` also uses wrong model.** Two calls create wiki store and embedding provider without the correct wiki model: `createWikiPageStore({ sql: db.sql, logger })` at line 86 (no `embeddingModel` → defaults to `voyage-code-3`), and `createEmbeddingProvider({ model: "voyage-code-3", ... })` at line 93. If this script runs against production, all wiki pages it writes will carry the wrong model.

**Why the S04 proof fails (failure chain):**

1. `wiki_pages` has "Test Page" (page_id=100) with `embedding_model=voyage-code-3`
2. `audit:embeddings` counts `wiki_pages.model_mismatch=1` → `audit_failed` → `M027-S04-FULL-AUDIT` fails
3. `listRepairCandidates()` (no page filter) returns "Test Page" as degraded because `embedding_model IS DISTINCT FROM 'voyage-context-3'`
4. `executeStatus()` sees `hasRemaining=true` → `status="resume_required"` → `status_code="repair_resume_available"`
5. S02 status check requires `status.run.status === "completed"` → fails → `M027-S04-WIKI-REPAIR-STATE` fails

**The `wiki_embedding_repair_state` checkpoint is also stale:** it records `page_id=100, page_title="Test Page", repaired=1` — meaning a prior run of the repair engine processed "Test Page". But the `writeRepairEmbeddingsBatch` call writes embeddings with the passed `targetModel` (`voyage-context-3`) while the DB update sets `embedding_model = $2` (the `targetModel` value). Yet the row still shows `voyage-code-3` — this means either: (a) the prior repair wrote the `voyage-context-3` embedding correctly but the test later overwrote the row with the wrong model again, or (b) the repair only updated `embedding` and `stale` but not `embedding_model`. Either way, the row is currently wrong and the fix is hard-deletion.

**What S04 execution needs to do:**
1. Fix `wiki-store.test.ts` skip guard from `DATABASE_URL` to `describe.skipIf(!TEST_DATABASE_URL)` + add `afterAll` TRUNCATE as a safety net.
2. Fix `scripts/backfill-wiki.ts` — both `createWikiPageStore` (line 86) and `createEmbeddingProvider` (line 93) need to use `DEFAULT_WIKI_EMBEDDING_MODEL` from `src/knowledge/runtime.ts`.
3. Hard-delete "Test Page" (page_id=100) from production `wiki_pages`. This makes the audit return `wiki_pages total=0, model_mismatch=0, status=pass` and makes `listRepairCandidates()` return empty so `executeStatus()` reports `status="completed"`.
4. Re-run `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json` and confirm it passes.
5. Write/update S04-SUMMARY.md with the actual passing proof output and close the milestone artifacts.

## Recommendation

Work in this order — each step is a prerequisite for the next.

### Step 1: Fix `wiki-store.test.ts` skip guard
Replace the unconditional `if (!process.env.DATABASE_URL)` guard with `describe.skipIf(!TEST_DB_URL)` wrapper pattern from `review-comment-store.test.ts`. Two changes:
1. Add `const TEST_DB_URL = process.env.TEST_DATABASE_URL;` before the describe block.
2. Change `describe("WikiPageStore (pgvector)", () => {` to `describe.skipIf(!TEST_DB_URL)("WikiPageStore (pgvector)", () => {`.
3. Add `afterAll` TRUNCATE of `wiki_pages` and `wiki_sync_state` as belt-and-suspenders cleanup.
4. Remove the `if (!process.env.DATABASE_URL)` early-return inside `beforeAll` (redundant after skipIf).

The fix must also ensure any internal `if (!store) return` guards in individual tests are preserved (they protect against running when `beforeAll` was skipped).

### Step 2: Fix `scripts/backfill-wiki.ts` model drift
Two changes + one import:
1. Add `import { DEFAULT_WIKI_EMBEDDING_MODEL } from "../src/knowledge/runtime.ts";` at the top.
2. `createWikiPageStore` at line 86: add `embeddingModel: DEFAULT_WIKI_EMBEDDING_MODEL`.
3. `createEmbeddingProvider` at line 93: change `model: "voyage-code-3"` to `model: DEFAULT_WIKI_EMBEDDING_MODEL`.

### Step 3: Hard-delete "Test Page" from production
Run a one-time deletion:
```sql
DELETE FROM wiki_pages WHERE page_id = 100;
```
After deletion:
- `audit:embeddings --json` should return `wiki_pages total=0, model_mismatch=0, status=pass` and overall `audit_ok`
- `repair:wiki-embeddings -- --status` should return `status_code=repair_completed` because `listRepairCandidates()` returns empty → `hasRemaining=false` → `status="completed"`

**Do not truncate `wiki_embedding_repair_state`.** The existing checkpoint row (page_id=100, repaired=1) was from a prior test-era repair run. After deleting "Test Page", `listRepairCandidates()` returns empty so the checkpoint page_id is irrelevant for status computation. The wiki durable status check in S04 uses `status_evidence.run.status` and `status_evidence.run.failed` — after the deletion, status will be `completed` with `failed=0`.

### Step 4: Verify the audit is clean and wiki status is healthy
```
bun run audit:embeddings --json
bun run repair:wiki-embeddings -- --status --json
```
Both should now report success/pass before running the full S04 proof.

### Step 5: Run the final acceptance proof
```
bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json
```
Expected: `overallPassed=true`, `status_code=m027_s04_ok`, all four check IDs green.

### Step 6: Close milestone artifacts
Update S04-SUMMARY.md with actual passing proof output. Update `.gsd/REQUIREMENTS.md`, `.gsd/milestones/M027/M027-ROADMAP.md`, `.gsd/PROJECT.md`, `.gsd/STATE.md`.

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| Final integrated milestone proof | `scripts/verify-m027-s04.ts` | Already implemented (459 lines), composes S01/S02/S03 proof functions, stable check IDs, preserves nested raw evidence. No logic changes needed — only fix the contamination that blocks it from passing. |
| Test-DB skip guard pattern | `TEST_DATABASE_URL` guard in `src/knowledge/review-comment-store.test.ts` (lines 58–60) | Established M026 pattern: `const TEST_DB_URL = process.env.TEST_DATABASE_URL; describe.skipIf(!TEST_DB_URL)(...)`. Use verbatim. |
| Test page deletion | Direct SQL `DELETE FROM wiki_pages WHERE page_id = 100` via one-time Bun inline script | Simplest safe fix. Hard-delete is cleaner than soft-delete for a test artifact that should never have been in production. |
| Wiki model constant | `DEFAULT_WIKI_EMBEDDING_MODEL = "voyage-context-3"` from `src/knowledge/runtime.ts` line 19 | Already exported and used by `createKnowledgeRuntime` at line 105. Import it in `scripts/backfill-wiki.ts`. |
| Post-fix audit verification | `bun run audit:embeddings --json` | Cheapest check before running the full S04 proof — confirms wiki_pages is clean. |
| Final acceptance | `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json` | Canonical single-command milestone-closing proof. Must pass before closing S04. |
| Non-wiki repair durable status | `bun run repair:embeddings -- --corpus review_comments --status --json` | Already returns `success=true, status_code=repair_completed` — no changes needed here. |

## Existing Code and Patterns

- `scripts/verify-m027-s04.ts` (459 lines) — composes `runM027S01ProofHarness`, `runM027S02ProofHarness`, `runM027S03ProofHarness` via injectable deps; evaluates four stable check IDs: `M027-S04-FULL-AUDIT`, `M027-S04-RETRIEVER`, `M027-S04-WIKI-REPAIR-STATE`, `M027-S04-NON-WIKI-REPAIR-STATE`; exits 1 with failing check ID on failure; preserves nested `s01`/`s02`/`s03` raw payloads under `--json`. **No changes needed to this file** — only its inputs (live DB state) need repair.

- `scripts/verify-m027-s04.test.ts` — 6 contract tests, **all passing** (6 pass, 0 fail, 55ms). Tests use mock deps correctly via injectable functions. No changes needed.

- `src/knowledge/wiki-store.test.ts` — **buggy skip guard at line 57**: `if (!process.env.DATABASE_URL) { console.warn(...); return; }` inside `beforeAll`. No `afterAll` TRUNCATE. The `createWikiPageStore({ sql, logger: mockLogger })` call has no `embeddingModel`, so `writeChunks` hits the `opts.embeddingModel ?? "voyage-code-3"` fallback at line 114 — writing `voyage-code-3` for any test chunk with an embedding.

- `src/knowledge/review-comment-store.test.ts` (lines 58–60) — reference implementation of the correct pgvector test skip guard:
  ```ts
  const TEST_DB_URL = process.env.TEST_DATABASE_URL;
  describe.skipIf(!TEST_DB_URL)("ReviewCommentStore (pgvector)", () => {
  ```

- `src/knowledge/memory-store.test.ts` (line 53–55) — also uses `TEST_DATABASE_URL` correctly.

- `src/knowledge/issue-store.test.ts` (line 71–73) — also uses `TEST_DATABASE_URL` correctly.

- `scripts/backfill-wiki.ts` (lines 86, 93) — `createWikiPageStore({ sql: db.sql, logger })` without `embeddingModel`, and `createEmbeddingProvider({ model: "voyage-code-3", ... })` hardcoded. Both need `DEFAULT_WIKI_EMBEDDING_MODEL`.

- `src/knowledge/runtime.ts` (line 19) — `export const DEFAULT_WIKI_EMBEDDING_MODEL = "voyage-context-3"`. Used at line 105 in `createWikiPageStore({ embeddingModel: DEFAULT_WIKI_EMBEDDING_MODEL, ... })`. Import this in `scripts/backfill-wiki.ts`.

- `src/knowledge/wiki-store.ts` (line 25) — `const DEFAULT_WIKI_REPAIR_MODEL = "voyage-context-3"` used by `listRepairCandidates()` to identify degraded rows. After deleting "Test Page", `listRepairCandidates()` returns empty, making `executeStatus()` return `status="completed"`.

- `scripts/wiki-embedding-repair.ts` `executeStatus()` (lines 251–300) — computes `status` as `"completed"` when `hasRemaining=false` and `lastFailureClass=null`. After "Test Page" deletion, `remaining.length === 0` → `hasRemaining=false` → `status="completed"` → `statusCode="repair_completed"` → `success=true`.

- `scripts/verify-m027-s02.ts` (line 153) — S02 status check requires `status.success && status.status_code === "repair_completed" && status.run.status === "completed"`. After the deletion this will pass.

- `scripts/verify-m027-s03.ts` — non-wiki repair state is already healthy. `repair:embeddings -- --corpus review_comments --status --json` returns `success=true, status_code=repair_completed`. No changes needed.

- `wiki_embedding_repair_state` table — holds one row: `page_id=100, page_title="Test Page", repaired=1, failed=0`. This row will remain after "Test Page" deletion from `wiki_pages`. That is fine — the status computation queries `listRepairCandidates()` (live rows) for `hasRemaining`, not the checkpoint page_id. The checkpoint `failed=0` and `last_failure_class=null` satisfy the durable-status truthfulness check in `verify-m027-s04.ts`.

## Constraints

- `M027-S04-FULL-AUDIT` requires a milestone-wide six-corpus `audit_ok`. After deleting "Test Page", `wiki_pages total=0, model_mismatch=0` maps to `status=pass` in the audit — an empty corpus is not degraded.
- `M027-S04-WIKI-REPAIR-STATE` checks both the repair probe result (`["repair_completed", "repair_not_needed"]`) AND the durable status row (`repair_completed`, `failed=0`, no `last_failure_class`). After deletion, status becomes `repair_completed` with `failed=0`.
- `issue_comments` must remain under `not_in_retriever`; the S04 harness fails with `retriever_scope_mismatch` if this boundary disappears. No changes affect this.
- `DATABASE_URL` is always set to the Azure PostgreSQL production URL in `.env`; test files using it as a skip guard will always run against production. Only `TEST_DATABASE_URL` is safe as a skip guard.
- Do not truncate `wiki_embedding_repair_state` — after "Test Page" deletion, `listRepairCandidates()` returns empty so the stale checkpoint entry does not block the status check.
- The `verify:m027:s04` live proof depends on real provider wiring (Voyage API) for the retriever check. The non-wiki repair-state check does not require Voyage since it uses `--status` mode only.

## Common Pitfalls

- **Fixing the skip guard without adding `afterAll` TRUNCATE** — if `TEST_DATABASE_URL` is ever set in a future dev environment, tests would pass but leave residue. The `afterAll` TRUNCATE is cheap insurance.

- **Soft-deleting "Test Page" instead of hard-deleting** — `store.softDeletePage(100)` marks `deleted=true`; the audit excludes deleted rows so audit would pass, but `wiki_embedding_repair_state` would still reference the deleted page. Hard-delete is cleaner and doesn't leave a soft-deleted test artifact in production.

- **Treating `wiki_pages total=0` as degraded** — after deletion, `total=0, model_mismatch=0` maps to `status=pass`. An empty corpus is healthy per the current audit semantics.

- **Running `repair:wiki-embeddings -- --page-title "JSON-RPC API/v8"` expecting status to pass** — the status command queries ALL degraded candidates globally (no page filter), so even without `--page-title`, "Test Page" would be found and cause `resume_required`. The fix is deletion, not scoping the status query.

- **Not re-running the full acceptance proof after cleanup** — the closure summary must cite post-cleanup proof output, not a pre-contamination run.

- **Only fixing one of the two `backfill-wiki.ts` model issues** — the script has both an `embeddingModel` gap in `createWikiPageStore` and a hardcoded `"voyage-code-3"` in `createEmbeddingProvider`. Both need `DEFAULT_WIKI_EMBEDDING_MODEL`.

- **Checking `wiki_embedding_repair_state` shows page_id=100 and assuming it blocks the proof** — the checkpoint page_id is only used for resume cursor state. Status computation derives `hasRemaining` from `listRepairCandidates()` (live wiki_pages rows), not from the checkpoint page_id.

- **Forgetting to verify the non-wiki path is still healthy** — `repair:embeddings -- --corpus review_comments --status --json` already returns `repair_completed` and needs no changes. Just verify it still passes after the wiki fixes.

## Open Risks

- **`verify:m027:s04` live proof may encounter Voyage API transience** — the live proof calls the retriever which generates a real query embedding via Voyage. API errors would flip `M027-S04-RETRIEVER` red. A rerun is sufficient if this occurs.

- **Wiki sync scheduler re-populating `wiki_pages`** — the wiki sync scheduler runs on a 24-hour recurrence starting 60 seconds after server startup. If it fires after deleting "Test Page", it could re-populate `wiki_pages` with real wiki content (correctly using `voyage-context-3` from `createKnowledgeRuntime`). This would change `total` counts but not fail model-correctness checks. The priority fix (skip guard) prevents future test contamination regardless.

- **`backfill-wiki.ts` model drift is a live production risk** — until Bug 2 is fixed, any operator invoking `scripts/backfill-wiki.ts` against production will write `voyage-code-3` wiki embeddings and immediately break the next audit run. This is a time-sensitive fix even if it doesn't directly block the immediate proof.

- **`wiki_embedding_repair_state` stale checkpoint** — the checkpoint row still references page_id=100 ("Test Page"). After deletion this is harmless for status computation, but could confuse future operators inspecting the table directly. A note in the runbook is sufficient; no table cleanup is needed.

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| Bun | `sickn33/antigravity-awesome-skills@bun-development` | available — `npx skills add sickn33/antigravity-awesome-skills@bun-development` |
| pgvector / PostgreSQL vector search | `timescale/pg-aiguide@pgvector-semantic-search` | available — `npx skills add timescale/pg-aiguide@pgvector-semantic-search` |
| Timeout/debugging investigation | `debug-like-expert` | installed |

## Sources

- Current live audit failure confirmed: `bun run audit:embeddings --json` → `success=false`, `status_code=audit_failed`, `wiki_pages total=1, model_mismatch=1, actual_models=["voyage-code-3"]` (source: live run 2026-03-13)
- "Test Page" (page_id=100) confirmed in production `wiki_pages` with `embedding_model=voyage-code-3, has_embedding=true` (source: direct DB query 2026-03-13)
- `wiki_embedding_repair_state` has one row: `page_id=100, page_title="Test Page", repaired=1, failed=0, last_failure_class=null, used_split_fallback=false` (source: direct DB query 2026-03-13)
- `repair:wiki-embeddings -- --status` returns `status_code=repair_resume_available` because `listRepairCandidates()` finds "Test Page" as a degraded row (source: live run 2026-03-13)
- Contract tests all passing: `bun test ./scripts/verify-m027-s04.test.ts` → 6 pass, 0 fail, 55ms (source: live run 2026-03-13)
- Final proof fails with exactly two check IDs: `M027-S04-FULL-AUDIT:audit_failed, M027-S04-WIKI-REPAIR-STATE:repair_resume_available` (source: live run 2026-03-13)
- Skip guard bug confirmed: `if (!process.env.DATABASE_URL)` at line 57 of `src/knowledge/wiki-store.test.ts`; no `afterAll` TRUNCATE (source: code review 2026-03-13)
- Reference skip guard pattern: `const TEST_DB_URL = process.env.TEST_DATABASE_URL; describe.skipIf(!TEST_DB_URL)(...)` (source: `src/knowledge/review-comment-store.test.ts` lines 58–60)
- M026 decision establishing the pattern: "M026: pgvector tests use TEST_DATABASE_URL (not DATABASE_URL) for skip guards — DATABASE_URL in .env is always set (prod URL), so checking it would never skip" (source: `.gsd/DECISIONS.md`)
- Model drift in backfill script: `createWikiPageStore({ sql: db.sql, logger })` at line 86 without `embeddingModel`; `createEmbeddingProvider({ model: "voyage-code-3", ... })` at line 93 (source: `scripts/backfill-wiki.ts`)
- Correct wiki model constant: `DEFAULT_WIKI_EMBEDDING_MODEL = "voyage-context-3"` at line 19 of `src/knowledge/runtime.ts`, used at line 105 for `createWikiPageStore` (source: `src/knowledge/runtime.ts`)
- `wiki-store.ts` store default behavior: `opts.embeddingModel ?? "voyage-code-3"` at line 114 — no `embeddingModel` means wrong-model writes (source: `src/knowledge/wiki-store.ts`)
- Status computation logic in `executeStatus()`: `const status = hasRemaining || lastFailureClass ? "resume_required" : "completed"` where `hasRemaining = remaining.length > 0` (source: `scripts/wiki-embedding-repair.ts` lines 263–265)
- Non-wiki repair already healthy: `bun run repair:embeddings -- --corpus review_comments --status --json` → `success=true, status_code=repair_completed` (source: live run 2026-03-13)
- S04 proof harness verdict logic: `M027-S02-STATUS` requires `status.run.status === "completed"` which requires `status_code === "repair_completed"` (source: `scripts/verify-m027-s02.ts` line 153)
