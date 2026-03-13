# M027 / S04: Final Integrated Production Repair Proof — Research

**Date:** 2026-03-12

## Summary

S04 is the milestone-closing composition slice. All the major execution artifacts exist and have previously passed — `scripts/verify-m027-s04.ts` (459 lines), six contract tests, the package alias, and the runbook section in `docs/operations/embedding-integrity.md`. **However the milestone is not currently in a passing state.** Two latent bugs (documented previously) have now both materialized: `wiki-store.test.ts` uses `DATABASE_URL` as its skip guard instead of `TEST_DATABASE_URL`, causing the test suite to run against production and leave "Test Page" (page_id=100) with `embedding_model=voyage-code-3` in the `wiki_pages` table. This causes `bun run audit:embeddings --json` to return `status_code=audit_failed` with `wiki_pages model_mismatch=1`, and therefore `verify:m027:s04` fails.

**Current live state (confirmed):**
- `bun run audit:embeddings --json` → `success=false`, `status_code=audit_failed`, `wiki_pages total=1, model_mismatch=1, actual_models=["voyage-code-3"]`
- "Test Page" (page_id=100) is in production `wiki_pages` with `embedding_model=voyage-code-3`
- `bun test ./scripts/verify-m027-s04.test.ts` → **6 fail** (all timeout at 5000ms — likely because `runM027S01ProofHarness` calls the audit which now fails/exits early)
- The `verify:m027:s04` live proof command will fail at `M027-S04-FULL-AUDIT` because the audit is not `audit_ok`

**Root causes (both must be fixed):**

**Bug 1 — `wiki-store.test.ts` uses `DATABASE_URL` as its skip guard (line 57).** In this environment `DATABASE_URL` is always set to the Azure PostgreSQL production URL (`.env` always has it). So the test suite connects to production, `beforeEach` truncates `wiki_pages`/`wiki_sync_state` before each test, but `afterAll` only calls `close()` — there is no `afterAll` TRUNCATE. The final test (`replacePageChunks replaces language_tags on re-ingest`) leaves "Test Page" (page_id=100) with a `voyage-code-3` embedding in the production `wiki_pages` table. The M026 pattern uses `TEST_DATABASE_URL` as the guard; `review-comment-store.test.ts` (line 58–60) is the reference.

**Bug 2 — `scripts/backfill-wiki.ts` creates `wikiPageStore` without `embeddingModel` (line 86).** `createWikiPageStore({ sql: db.sql, logger })` uses the store default of `"voyage-code-3"` for any chunk it writes with an embedding. If this script is ever run against production, all wiki pages it ingests will carry the wrong model and the audit will fail again. The fix is to add `embeddingModel: DEFAULT_WIKI_EMBEDDING_MODEL` imported from `src/knowledge/runtime.ts`. Additionally, `scripts/backfill-wiki.ts` also creates its own `createEmbeddingProvider` hardcoded to `model: "voyage-code-3"` — that embedding provider is passed to `backfillWikiPages()` and writes page content with the wrong model.

**Why the contract tests timeout:** The test suite for `verify-m027-s04.test.ts` calls `runM027S01ProofHarness` and related functions inside tests. After the S04 implementation was completed (the SUMMARY says it was done), the contract tests were passing. The current timeouts indicate the test environment is hitting real DB/network paths unexpectedly — investigation shows the contract tests use injected mock deps, so the timeouts suggest the `bun test` invocation is somehow resolving to real implementations. This warrants investigation before concluding root cause, but the primary action item is fixing the DB contamination first.

**What S04 execution needs to do:**
1. Fix `wiki-store.test.ts` skip guard from `DATABASE_URL` to `TEST_DATABASE_URL` with `describe.skipIf` pattern and add `afterAll` TRUNCATE as a safety net.
2. Fix `scripts/backfill-wiki.ts` model parameter — both the `createWikiPageStore` call (line 86) and the `createEmbeddingProvider` call (line 93) need `voyage-context-3`.
3. Hard-delete "Test Page" (page_id=100) from production, then verify the audit returns `wiki_pages total=0, model_mismatch=0, status=pass`.
4. Diagnose and fix the contract test timeouts in `verify-m027-s04.test.ts`.
5. Re-run `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json` and confirm it passes.
6. Write S04-SUMMARY.md (already partially written as a draft from a prior run — update with actual passing proof output).
7. Ensure milestone closure artifacts in ROADMAP, REQUIREMENTS.md, PROJECT.md, STATE.md correctly cite the post-fix passing proof.

## Recommendation

Work in this order — each step unblocks the next:

### Step 1: Fix `wiki-store.test.ts` skip guard
Change the skip pattern to match `review-comment-store.test.ts`. The fix is two parts:
1. Replace `if (!process.env.DATABASE_URL)` guard with `describe.skipIf(!TEST_DB_URL)` wrapper.
2. Add `afterAll` TRUNCATE of `wiki_pages` and `wiki_sync_state` as a safety net (belt-and-suspenders: if someone runs this against a real test DB, cleanup happens).

Reference pattern from `src/knowledge/review-comment-store.test.ts` lines 58–60:
```ts
const TEST_DB_URL = process.env.TEST_DATABASE_URL;
describe.skipIf(!TEST_DB_URL)("ReviewCommentStore (pgvector)", () => {
```

### Step 2: Fix `scripts/backfill-wiki.ts` model drift
Two changes needed:
1. `createWikiPageStore` call at line 86 needs `embeddingModel: DEFAULT_WIKI_EMBEDDING_MODEL`.
2. `createEmbeddingProvider` call around line 93 needs `model: DEFAULT_WIKI_EMBEDDING_MODEL` (currently hardcoded `"voyage-code-3"`).
3. Add the import: `import { DEFAULT_WIKI_EMBEDDING_MODEL } from "../src/knowledge/runtime.ts"`.

### Step 3: Hard-delete "Test Page" from production
```sql
DELETE FROM wiki_pages WHERE page_id = 100;
```
Do this via a one-time Bun script that uses `createDbClient`. After deletion, `audit:embeddings --json` should return `wiki_pages total=0, model_mismatch=0, status=pass` and `audit_ok` overall. An empty corpus is a pass in the current audit logic.

### Step 4: Diagnose and fix contract test timeouts
Run `bun test ./scripts/verify-m027-s04.test.ts` with `--timeout 30000` to get actual errors instead of timeouts. If tests reveal implementation gaps, fix them. If they reveal mock injection not being applied, trace through `runM027S01ProofHarness` invocation in tests to verify mock deps flow correctly.

### Step 5: Re-run `verify:m027:s04` live and confirm pass
The canonical final acceptance command:
```
bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json
```
Expected: `overallPassed=true`, `status_code=m027_s04_ok`, all four checks green.

### Step 6: Close milestone artifacts
Update S04-SUMMARY.md, ROADMAP, REQUIREMENTS.md, PROJECT.md, STATE.md with the exact passing proof output.

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| Final integrated milestone proof | `scripts/verify-m027-s04.ts` | Already implemented (459 lines), composes S01/S02/S03 proof functions, stable check IDs, preserves nested raw evidence. No logic changes needed — just fix the contamination so it can pass. |
| Test-DB skip guard pattern | `TEST_DATABASE_URL` guard in `src/knowledge/review-comment-store.test.ts` (lines 58–60) | Established M026 pattern: `const TEST_DB_URL = process.env.TEST_DATABASE_URL; describe.skipIf(!TEST_DB_URL)(...)`. Use verbatim. |
| Test page deletion | Direct SQL `DELETE FROM wiki_pages WHERE page_id = 100` via one-time Bun script | Simplest safe fix. Hard-delete is cleaner than soft-delete for a test artifact. |
| Wiki model constant | `DEFAULT_WIKI_EMBEDDING_MODEL = "voyage-context-3"` from `src/knowledge/runtime.ts` line 19 | Already exported and used by production wiring at line 105. Import it in `scripts/backfill-wiki.ts`. |
| Post-fix audit verification | `bun run audit:embeddings --json` | Cheapest check before running the full S04 proof — confirms wiki_pages is clean. |
| Final acceptance | `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json` | The canonical single-command milestone-closing proof. Must pass before closing S04. |

## Existing Code and Patterns

- `scripts/verify-m027-s04.ts` (459 lines) — composes `runM027S01ProofHarness`, `runM027S02ProofHarness`, `runM027S03ProofHarness` via injectable deps; evaluates four stable check IDs: `M027-S04-FULL-AUDIT`, `M027-S04-RETRIEVER`, `M027-S04-WIKI-REPAIR-STATE`, `M027-S04-NON-WIKI-REPAIR-STATE`; exits 1 with failing check ID on failure; preserves nested `s01`/`s02`/`s03` raw payloads under `--json`. The harness logic itself is complete and should not need changes — only its inputs (audit state) need repair.

- `scripts/verify-m027-s04.test.ts` (882 lines) — 6 contract tests that currently fail with 5000ms timeout. The tests pass mock deps to `runM027S04ProofHarness`. If the timeout is a genuine slow path, increase the bun test timeout in the test file. If the tests are calling real DB, trace through the mock dep chain.

- `src/knowledge/wiki-store.test.ts` — **buggy skip guard at line 57**: uses `if (!process.env.DATABASE_URL)` instead of `describe.skipIf(!TEST_DB_URL)`. Has `beforeEach` truncating `wiki_pages`/`wiki_sync_state` but `afterAll` only calls `close()` — no cleanup TRUNCATE. The final test (`replacePageChunks replaces language_tags on re-ingest`) writes "Test Page" (page_id=100) with `embedding_model=voyage-code-3` (store default since `embeddingModel` is not passed to `createWikiPageStore`). **Priority fix: change skip guard and add afterAll TRUNCATE.**

- `src/knowledge/review-comment-store.test.ts` (lines 58–60) — reference implementation of the correct pgvector test skip guard: `const TEST_DB_URL = process.env.TEST_DATABASE_URL; describe.skipIf(!TEST_DB_URL)(...)`.

- `src/knowledge/memory-store.test.ts` (line 53–55) — also uses `TEST_DATABASE_URL` correctly. Additional confirmation.

- `src/knowledge/issue-store.test.ts` (line 71–73) — also uses `TEST_DATABASE_URL` correctly.

- `scripts/backfill-wiki.ts` (line 86) — `createWikiPageStore({ sql: db.sql, logger })` without `embeddingModel`; defaults wiki writes to `voyage-code-3` via the store default. Line 93 also has `createEmbeddingProvider` hardcoded to `model: "voyage-code-3"`. **Needs both parameters fixed to use `DEFAULT_WIKI_EMBEDDING_MODEL`.**

- `src/knowledge/runtime.ts` (line 19) — exports `DEFAULT_WIKI_EMBEDDING_MODEL = "voyage-context-3"` and uses it consistently at line 105 for `createWikiPageStore`. This is the pattern `scripts/backfill-wiki.ts` should follow.

- `src/knowledge/wiki-store.ts` (line 114) — `opts.embeddingModel ?? "voyage-code-3"` is the fallback in `writeChunks`. The test's `createWikiPageStore({ sql, logger: mockLogger })` call without `embeddingModel` hits this fallback, writing `voyage-code-3` for any chunk that has an embedding. The fix in the test is `describe.skipIf` so it never runs against production; the fix in the store call is to pass `embeddingModel` explicitly.

- `src/knowledge/embedding-audit.ts` — audit queries `wiki_pages WHERE deleted = false`; after hard-deletion of page_id=100, `total=0, model_mismatch=0` maps to `status=pass`. Empty corpus is not a degraded state.

- `src/db/migrations/028-wiki-embedding-repair-state.sql` — `wiki_embedding_repair_state` checkpoint records repair history per bounded run. May reference page_id=100 from prior research repair runs. Do not truncate this table — it is the durable repair evidence for the S02 proof. Status checks use `listRepairCandidates()` dynamically; a stale checkpoint referencing a deleted page does not re-introduce repair candidates.

- Other tests with `DATABASE_URL` patterns: `src/telemetry/store.test.ts`, `src/contributor/profile-store.test.ts`, `src/knowledge/store.test.ts` all use `DATABASE_URL ?? "postgresql://kodiai:..."` fallback (safe — local dev default prevents accidental production hits). Only `wiki-store.test.ts` has the unconditional production-connection problem.

## Constraints

- `M027-S04-FULL-AUDIT` requires a milestone-wide six-corpus `audit_ok`; the proof harness fails immediately if the audit returns `audit_failed`.
- `M027-S04-WIKI-REPAIR-STATE` checks both the repair probe result (`["repair_completed", "repair_not_needed"]`) AND the durable status row (`repair_completed`, `failed=0`, no `last_failure_class`). The wiki repair state from prior S02 work (page `JSON-RPC API/v8`) should still be intact.
- `issue_comments` must remain under `not_in_retriever`; the S04 harness fails with `retriever_scope_mismatch` if this boundary disappears.
- `DATABASE_URL` is always set to the Azure PostgreSQL production URL in `.env`; test files using it as a skip guard will always run against production. Only `TEST_DATABASE_URL` is safe as a skip guard.
- Do not truncate `wiki_embedding_repair_state` — it holds durable repair evidence for S02 (the bounded `JSON-RPC API/v8` repair run).
- `scripts/backfill-wiki.ts` fix is additive (one parameter each, one import) and does not break existing usage.
- The `verify:m027:s04` live proof depends on real provider wiring (Voyage API) — intermittent API failures can flip `M027-S04-RETRIEVER` red; a rerun is sufficient.

## Common Pitfalls

- **Fixing `afterAll` TRUNCATE without changing the skip guard** — adding `afterAll(async () => { await sql\`TRUNCATE wiki_pages CASCADE\` })` prevents contamination when tests run but still runs tests against production. Fix the skip guard first.

- **Soft-deleting "Test Page" instead of hard-deleting** — `store.softDeletePage(100)` marks `deleted=true`; the audit excludes deleted rows so the proof would still pass, but the row remains as noise. Hard-delete is cleaner.

- **Treating `wiki_pages total=0` as degraded** — after deletion, `total=0, model_mismatch=0` maps to `status=pass` in the current audit logic. An empty corpus is healthy per the audit semantics.

- **Not re-running `verify:m027:s04` after cleanup** — the closure summary must cite post-cleanup proof output, not a pre-contamination run.

- **Only fixing one of the two `backfill-wiki.ts` model issues** — the script has both an `embeddingModel` gap in `createWikiPageStore` and a hardcoded `"voyage-code-3"` in `createEmbeddingProvider`. Both need to use `DEFAULT_WIKI_EMBEDDING_MODEL`.

- **Running `repair:wiki-embeddings` on "Test Page" instead of deleting it** — repairing embeds fake wiki content with `voyage-context-3` and leaves a test artifact in production with a "real" embedding. The right fix is hard-deletion.

- **Assuming `verify:m027:s04` tests pass without a DB** — the tests inject mock deps so they should not need a real DB. If they are timing out, check whether a dep somewhere is resolving to a real DB-calling implementation instead of the injected mock.

- **Not verifying `repair:wiki-embeddings -- --status --json` after cleanup** — the S04 harness checks that the wiki durable status row reports `repair_completed` from the prior bounded run. Ensure the `wiki_embedding_repair_state` checkpoint record is intact (it references page_id from the `JSON-RPC API/v8` repair, not page_id=100).

## Open Risks

- **Contract test timeout root cause unknown** — the 5000ms timeout for `verify-m027-s04.test.ts` tests may indicate mock dep injection is not working, or the default test timeout is too short for harness composition with mocks that include delays. Use `--timeout 30000` to get actual failures vs timeouts, then diagnose.

- **Wiki sync scheduler contamination** — the wiki sync scheduler runs on a 24-hour recurrence starting 60 seconds after server startup. If it fires after deleting "Test Page", it could re-populate `wiki_pages` with real wiki content (correctly using `voyage-context-3` from `createKnowledgeRuntime`). This would change `total` counts in the audit but would not fail model-correctness checks. The priority fix is the skip guard so tests stop contaminating production first.

- **`wiki_embedding_repair_state` may reference deleted page** — the checkpoint record from the S02 proof (`JSON-RPC API/v8`, page_id=13137) should be intact. But if the repair state references a different page or page_id, the `M027-S04-WIKI-REPAIR-STATE` check may not find `repair_completed`. Verify `repair:wiki-embeddings -- --status --json` still reports a completed state.

- **`scripts/backfill-wiki.ts` model drift is a live risk** — until Bug 2 is fixed, any operator invoking this script against production will write `voyage-code-3` wiki embeddings and break the next audit run. Fix this even if it doesn't block the immediate proof.

- **`verify:m027:s04` live proof may timeout** — the live proof command calls external APIs (Voyage AI) and queries Azure Postgres. Timeout at the script level is distinct from test timeouts. The previous passing proof took well under 120 seconds.

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| Bun | `sickn33/antigravity-awesome-skills@bun-development` | available — `npx skills add sickn33/antigravity-awesome-skills@bun-development` |
| pgvector / PostgreSQL vector search | `timescale/pg-aiguide@pgvector-semantic-search` | available — `npx skills add timescale/pg-aiguide@pgvector-semantic-search` |
| Embedding systems / RAG | `wshobson/agents@embedding-strategies` | available — `npx skills add wshobson/agents@embedding-strategies` |
| Timeout/debugging investigation | `debug-like-expert` | installed |

## Sources

- Current live audit failure: `bun run audit:embeddings --json` returns `success=false`, `status_code=audit_failed`, `wiki_pages total=1, model_mismatch=1, actual_models=["voyage-code-3"]` (source: live run, confirmed 2026-03-12)
- "Test Page" (page_id=100) confirmed in production `wiki_pages` with `embedding_model=voyage-code-3` (source: `SELECT page_id, page_title, embedding_model, stale FROM wiki_pages WHERE deleted = false` via live DB query)
- Contract test timeouts: `bun test ./scripts/verify-m027-s04.test.ts` → 6 fail, all 5000ms timeout (source: live test run)
- Skip guard bug: `if (!process.env.DATABASE_URL)` at line 57 of `src/knowledge/wiki-store.test.ts`; `afterAll` at line 68 only calls `close()` — no TRUNCATE; final test `replacePageChunks replaces language_tags on re-ingest` leaves page_id=100 with `voyage-code-3` (source: `src/knowledge/wiki-store.test.ts` lines 54–78 and 283–303)
- Reference skip guard pattern: `const TEST_DB_URL = process.env.TEST_DATABASE_URL; describe.skipIf(!TEST_DB_URL)(...)` (source: `src/knowledge/review-comment-store.test.ts` lines 58–60)
- M026 decision establishing the pattern: "M026: pgvector tests use TEST_DATABASE_URL (not DATABASE_URL) for skip guards — DATABASE_URL in .env is always set (prod URL), so checking it would never skip" (source: `.gsd/DECISIONS.md`)
- Model drift in backfill script: `createWikiPageStore({ sql: db.sql, logger })` at line 86 of `scripts/backfill-wiki.ts` without `embeddingModel`; also `createEmbeddingProvider` hardcoded to `model: "voyage-code-3"` at line 93 (source: `scripts/backfill-wiki.ts` lines 86 and 93)
- Correct wiki model constant: `DEFAULT_WIKI_EMBEDDING_MODEL = "voyage-context-3"` at line 19 of `src/knowledge/runtime.ts`, used at line 105 for `createWikiPageStore` in the production runtime (source: `src/knowledge/runtime.ts`)
- wiki-store.ts store default behavior: `opts.embeddingModel ?? "voyage-code-3"` at line 114 — no `embeddingModel` in createWikiPageStore opts means all writes default to `voyage-code-3` (source: `src/knowledge/wiki-store.ts` line 114)
- M027 milestone closure state: STATE.md records `Active Milestone: M028`; M027 recorded as closed in prior research/plan run (source: `.gsd/STATE.md`)
- S04 harness already implemented: `scripts/verify-m027-s04.ts` is 459 lines, composes S01/S02/S03 proof harnesses (source: `wc -l scripts/verify-m027-s04.ts`)
- Prior passing S04 evidence documented in S04-SUMMARY.md draft: `overallPassed=true`, `status_code=m027_s04_ok`, all four checks passing (source: `.gsd/milestones/M027/slices/S04/S04-SUMMARY.md`)
- Other test files with `DATABASE_URL ??` fallback (safe): `src/telemetry/store.test.ts`, `src/contributor/profile-store.test.ts`, `src/knowledge/store.test.ts` (source: grep scan)
