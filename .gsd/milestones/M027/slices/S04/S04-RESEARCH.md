# M027 / S04: Final Integrated Production Repair Proof — Research

**Date:** 2026-03-14

## Summary

S04 is the milestone-closing composition slice. The implementation is substantially complete: `scripts/verify-m027-s04.ts` (459 lines, 4 stable check IDs) is implemented, all 6 contract tests pass, the package alias is wired, and the runbook section in `docs/operations/embedding-integrity.md` exists. All four GSD tasks (T01–T04) are marked complete in the slice plan.

**Current live state (2026-03-14 — confirmed during research):**

The live proof passes:
```
bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments
→ Final verdict: PASS / Status code: m027_s04_ok
  M027-S04-FULL-AUDIT PASS audit_ok
  M027-S04-RETRIEVER PASS retrieval_hits
  M027-S04-WIKI-REPAIR-STATE PASS repair_completed
  M027-S04-NON-WIKI-REPAIR-STATE PASS repair_completed
```

`bun run audit:embeddings --json` returns `status_code=audit_ok` across all six corpora with `missing_or_null=0` for all.

**Two structural bugs remain open** that were identified during research but not fixed in prior S04 task execution. These do not block the current live proof but create recurrence risk:

**Bug 1 — `src/knowledge/wiki-store.test.ts` uses wrong skip guard.** Line 57 checks `if (!process.env.DATABASE_URL)` inside `beforeAll`. In this environment `DATABASE_URL` is always set to the production Azure PostgreSQL URL, so the test suite runs against production when `TEST_DATABASE_URL` is unset. The `afterAll` block (lines 68–70) only closes the DB connection — it has no final TRUNCATE. The `beforeEach` TRUNCATEs `wiki_pages` and `wiki_sync_state` before each test, so cleanup happens before the next test but not after the last one. When the test suite runs, it leaves "Test Page" (page_id=100) in `wiki_pages`. Because `createWikiPageStore({ sql, logger: mockLogger })` is called without `embeddingModel`, it hits the `wiki-store.ts` default `opts.embeddingModel ?? "voyage-code-3"` at line 114, writing the wrong model into production. This is what forced the wiki repair during the prior research session.

**Bug 2 — `scripts/backfill-wiki.ts` uses hardcoded `voyage-code-3`.** Line 93 has `model: "voyage-code-3"` in the `createEmbeddingProvider` call and line 86 has no `embeddingModel` in `createWikiPageStore`. If this script runs against production, it writes wrong-model wiki embeddings and breaks the next audit run. The correct constant `DEFAULT_WIKI_EMBEDDING_MODEL = "voyage-context-3"` is already exported from `src/knowledge/runtime.ts` line 19.

**S04 execution is therefore two targeted code fixes plus final verification:**
1. Fix `wiki-store.test.ts` skip guard (prevents future test contamination)
2. Fix `scripts/backfill-wiki.ts` model drift (prevents future operational contamination)
3. Re-run the live proof to confirm it still passes after the fixes
4. Update S04-SUMMARY.md and milestone closure artifacts with the final passing evidence

## Recommendation

The heavy composition work is done. The remaining S04 work is a precision repair pass for the two structural bugs, re-running the live proof, and writing the final milestone closure.

### Step 1: Fix `wiki-store.test.ts` skip guard

Replace the `if (!process.env.DATABASE_URL)` guard pattern with the M026-established `describe.skipIf(!TEST_DB_URL)` pattern:

1. Add `const TEST_DB_URL = process.env.TEST_DATABASE_URL;` before the describe block (line ~53).
2. Change `describe("WikiPageStore (pgvector)", () => {` to `describe.skipIf(!TEST_DB_URL)("WikiPageStore (pgvector)", () => {`.
3. Remove the `if (!process.env.DATABASE_URL)` guard block inside `beforeAll` (now redundant).
4. Add a final `TRUNCATE wiki_pages CASCADE` to the `afterAll` block so the last test run doesn't leave rows in production.
5. Keep all per-test `if (!store) return` guards (they protect idiomatic skip-within-describe behavior).

### Step 2: Fix `scripts/backfill-wiki.ts` model drift

1. Add `import { DEFAULT_WIKI_EMBEDDING_MODEL } from "../src/knowledge/runtime.ts";` at top.
2. `createWikiPageStore` at line 86: add `embeddingModel: DEFAULT_WIKI_EMBEDDING_MODEL`.
3. `createEmbeddingProvider` at line 93: change `model: "voyage-code-3"` to `model: DEFAULT_WIKI_EMBEDDING_MODEL`.

### Step 3: Final acceptance proof and closure

Run the acceptance proof to confirm it still passes after the fixes:

```
bun test ./scripts/verify-m027-s04.test.ts
bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json
```

Then update S04-SUMMARY.md citing the fresh post-fix proof output and update milestone closure artifacts.

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| Final integrated milestone proof | `scripts/verify-m027-s04.ts` | Already implemented (459 lines), composes S01/S02/S03 proof functions, 4 stable check IDs, preserves nested raw evidence. No logic changes needed. |
| Test-DB skip guard pattern | `TEST_DATABASE_URL` guard in `src/knowledge/review-comment-store.test.ts` (lines 58–60) | Established M026 pattern: `const TEST_DB_URL = process.env.TEST_DATABASE_URL; describe.skipIf(!TEST_DB_URL)(...)`. |
| Wiki model constant | `DEFAULT_WIKI_EMBEDDING_MODEL = "voyage-context-3"` from `src/knowledge/runtime.ts` line 19 | Already exported and used at runtime.ts lines 86, 94, 105. Import it in `scripts/backfill-wiki.ts`. |
| Post-fix verification | `bun run audit:embeddings --json` + `bun run verify:m027:s04 -- ...` | Two-step confirmation: clean audit first, then full proof. |

## Existing Code and Patterns

- `scripts/verify-m027-s04.ts` (459 lines) — composes `runM027S01ProofHarness`, `runM027S02ProofHarness`, `runM027S03ProofHarness` via injectable deps; 4 stable check IDs; exits 1 with failing check ID; preserves nested `s01`/`s02`/`s03` raw payloads under `--json`. **No logic changes needed.**

- `scripts/verify-m027-s04.test.ts` (882 lines, 6 tests) — contract tests all passing (6 pass, 0 fail). Tests use mock deps via injectable functions. **No changes needed.**

- `src/knowledge/wiki-store.test.ts` — **buggy skip guard at line 57**: `if (!process.env.DATABASE_URL)` inside `beforeAll`. The `afterAll` (lines 68–70) only closes the DB, no final TRUNCATE. The `beforeEach` TRUNCATEs `wiki_pages`/`wiki_sync_state` before each test but not after the last. `createWikiPageStore({ sql, logger: mockLogger })` at line 67 has no `embeddingModel`, so `writeChunks` hits `opts.embeddingModel ?? "voyage-code-3"` fallback at wiki-store.ts line 114 — writing `voyage-code-3` into production on the last test's chunk write.

- `src/knowledge/review-comment-store.test.ts` (lines 58–60) — reference implementation of the correct pgvector test skip guard: `const TEST_DB_URL = process.env.TEST_DATABASE_URL; describe.skipIf(!TEST_DB_URL)("ReviewCommentStore (pgvector)", () => {`.

- `src/knowledge/memory-store.test.ts` and `src/knowledge/issue-store.test.ts` — both use `TEST_DATABASE_URL` correctly.

- `scripts/backfill-wiki.ts` (lines 86, 93) — `createWikiPageStore({ sql: db.sql, logger })` without `embeddingModel` at line 86; `createEmbeddingProvider({ model: "voyage-code-3", ... })` hardcoded at line 93. Both need `DEFAULT_WIKI_EMBEDDING_MODEL`.

- `src/knowledge/runtime.ts` (line 19) — `export const DEFAULT_WIKI_EMBEDDING_MODEL = "voyage-context-3"`. Used at runtime.ts lines 86, 94, 105. Import this in `scripts/backfill-wiki.ts`.

- `src/knowledge/wiki-store.ts` (line 25) — `const DEFAULT_WIKI_REPAIR_MODEL = "voyage-context-3"` used by `listRepairCandidates()` to identify degraded rows where `embedding_model IS DISTINCT FROM 'voyage-context-3'`.

- `scripts/verify-m027-s02.ts` (line 153) — S02 status check requires `status.success && status.status_code === "repair_completed" && status.run.status === "completed"`. Currently reports "Test Page" as the last repaired page, not `JSON-RPC API/v8`. This is the expected state: the wiki repair state surface reflects the last repair run's target page.

- `docs/operations/embedding-integrity.md` — already has a `verify:m027:s04` section. May need minor updates to reflect the final passing proof evidence from the bug-fix pass.

## Constraints

- `M027-S04-FULL-AUDIT` requires a milestone-wide six-corpus `audit_ok`. Currently passing because the wiki repair engine cleaned up the "Test Page" contamination during the prior research session. **However, running `bun test src/knowledge/wiki-store.test.ts` against production again would re-contaminate `wiki_pages` and break the next audit run.** This is time-sensitive.
- `issue_comments` must remain under `not_in_retriever`; the S04 harness fails with `retriever_scope_mismatch` if this boundary disappears. No code changes affect this.
- `DATABASE_URL` is always set to the Azure PostgreSQL production URL in `.env`; test files using it as a skip guard will always run against production. Only `TEST_DATABASE_URL` is safe as a skip guard.
- The `verify:m027:s04` live proof depends on real Voyage API for the retriever check (`M027-S04-RETRIEVER`). The repair-state checks use `--status` mode only.
- The wiki sync scheduler re-populates `wiki_pages` from `kodi.wiki` using `voyage-context-3` (via `createKnowledgeRuntime`). If it fires, new pages will have the correct model.

## Common Pitfalls

- **Fixing only the `wiki-store.test.ts` skip guard without adding the `afterAll` TRUNCATE** — the `afterAll` exists but only closes the connection. Must add `TRUNCATE wiki_pages CASCADE` there too. The `beforeEach` TRUNCATE covers inter-test isolation, but the final test still leaves rows behind if `afterAll` doesn't clean up.

- **Not re-running the full acceptance proof after applying the fixes** — the closure summary must cite post-fix proof output.

- **Only fixing one of the two `backfill-wiki.ts` model issues** — both `embeddingModel` gap in `createWikiPageStore` and `"voyage-code-3"` in `createEmbeddingProvider` need `DEFAULT_WIKI_EMBEDDING_MODEL`.

- **Forgetting to verify the non-wiki path is still healthy** — `repair:embeddings -- --corpus review_comments --status --json` currently returns `repair_resume_available` (not `repair_completed`) because the prior repair was interrupted by new row ingestion. Running `repair:embeddings -- --corpus review_comments --json` before finalizing the closure will restore the `repair_completed` state if needed.

- **Conflating `review_comments` repair-state with current audit health** — the S04 harness uses status-mode (durable checkpoint) for the non-wiki check, not a fresh degraded-row scan. The current `repair:embeddings -- --corpus review_comments --status --json` reports `repair_resume_available` with `status: resume_required`, which would fail the `M027-S04-NON-WIKI-REPAIR-STATE` check. This needs a fresh repair run before closure if the repair state has drifted.

- **Treating the S04-SUMMARY.md as already final** — the SUMMARY was written before the bug-fix requirement was fully understood. The bugs need to be fixed, the proof re-run, and the SUMMARY updated to reflect the final post-fix passing state.

## Open Risks

- **`repair:embeddings -- --corpus review_comments --status --json` returns `repair_resume_available`** — as of 2026-03-14, the non-wiki repair state for `review_comments` shows `status_code=repair_resume_available` with `run.status=resume_required`. This is because the prior repair run was interrupted when new review comment rows appeared. Running `repair:embeddings -- --corpus review_comments --json` will repair the new missing row(s) and restore the checkpoint to `repair_completed`. **This run is required before closure so `M027-S04-NON-WIKI-REPAIR-STATE` can pass cleanly on status re-check.** Note: the S04 proof currently passes anyway because the harness reads the durable S03 proof envelope which uses the status from the prior S03 session. But a fresh re-run of the proof after a `review_comments` repair run will produce cleaner durable evidence.

- **`verify:m027:s04` live proof may encounter Voyage API transience** — the live proof calls the retriever which generates a real query embedding via Voyage. API errors flip `M027-S04-RETRIEVER` red. A rerun is sufficient.

- **Wiki sync scheduler re-populating `wiki_pages`** — the wiki sync scheduler runs on a 24-hour recurrence starting 60 seconds after server startup. New real wiki pages will get `voyage-context-3` correctly (via `createKnowledgeRuntime`). No audit impact expected.

- **Future `bun test` runs against production** — until Bug 1 is fixed, any run of `bun test` in a production environment (with `DATABASE_URL` set but `TEST_DATABASE_URL` unset) will re-contaminate `wiki_pages` with a wrong-model "Test Page". This re-triggers the need to run wiki repair before the next audit. **Time-sensitive fix.**

- **`backfill-wiki.ts` model drift is a live production risk** — until Bug 2 is fixed, any operator invoking `scripts/backfill-wiki.ts` against production will write `voyage-code-3` wiki embeddings and break the next audit run.

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| Bun | `sickn33/antigravity-awesome-skills@bun-development` | available — `npx skills add sickn33/antigravity-awesome-skills@bun-development` |
| pgvector / PostgreSQL vector search | `timescale/pg-aiguide@pgvector-semantic-search` | available — `npx skills add timescale/pg-aiguide@pgvector-semantic-search` |
| Timeout/debugging investigation | `debug-like-expert` | installed |

## Sources

- Live proof passing (status_code=m027_s04_ok): `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments` (source: live run 2026-03-14)
- Full audit clean (audit_ok): `bun run audit:embeddings --json` → all six corpora `missing_or_null=0`, `model_mismatch=0` (source: live run 2026-03-14)
- S04 contract tests all passing: `bun test ./scripts/verify-m027-s04.test.ts` → 6 pass, 0 fail (source: live run 2026-03-14)
- Non-wiki repair state drifted to `repair_resume_available`: `bun run repair:embeddings -- --corpus review_comments --status --json` → `status_code=repair_resume_available`, `run.status=resume_required` (source: live run 2026-03-14)
- Skip guard bug confirmed: `if (!process.env.DATABASE_URL)` at line 57 of `src/knowledge/wiki-store.test.ts`; `afterAll` has `close()` but no TRUNCATE (source: code review 2026-03-14)
- Reference skip guard pattern: `const TEST_DB_URL = process.env.TEST_DATABASE_URL; describe.skipIf(!TEST_DB_URL)(...)` (source: `src/knowledge/review-comment-store.test.ts` lines 58–60)
- M026 decision establishing the pattern: "pgvector tests use TEST_DATABASE_URL (not DATABASE_URL) for skip guards — DATABASE_URL in .env is always set (prod URL), so checking it would never skip" (source: `.gsd/DECISIONS.md`)
- Model drift in backfill script: `model: "voyage-code-3"` at line 93; `createWikiPageStore` without `embeddingModel` at line 86 (source: `scripts/backfill-wiki.ts` code review 2026-03-14)
- Correct wiki model constant: `DEFAULT_WIKI_EMBEDDING_MODEL = "voyage-context-3"` at line 19 of `src/knowledge/runtime.ts` (source: code review 2026-03-14)
- `wiki-store.ts` store default behavior: `opts.embeddingModel ?? "voyage-code-3"` at line 114 — no `embeddingModel` means wrong-model writes (source: `src/knowledge/wiki-store.ts`)
- Wiki repair state points to "Test Page": `bun run repair:wiki-embeddings -- --status --json` → `page_title=Test Page`, `repaired=1`, `failed=0` (source: live run 2026-03-14; result of wiki repair that cleaned prior test contamination)
- Review comment repair state needs fresh run: `bun run repair:embeddings -- --corpus review_comments --status --json` → `status_code=repair_resume_available` because new rows appeared since last completed repair run (source: live run 2026-03-14)
