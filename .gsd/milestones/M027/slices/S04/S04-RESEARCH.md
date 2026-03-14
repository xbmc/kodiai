# M027 / S04: Final Integrated Production Repair Proof — Research

**Date:** 2026-03-14

## Summary

S04 is the milestone-closing composition slice. The acceptance harness (`scripts/verify-m027-s04.ts`, 459 lines, 4 stable check IDs) is fully implemented, all 6 contract tests pass, the package alias is wired, and the runbook section in `docs/operations/embedding-integrity.md` exists. All four GSD tasks (T01–T04) are marked complete in the slice plan, and S04-SUMMARY.md records a passing live proof from 2026-03-12.

However, **two structural code bugs were identified and confirmed via live observation during this research session** (2026-03-14). Both remain present in the code and are actively causing production harm:

- **Bug 1 — `src/knowledge/wiki-store.test.ts` uses the wrong skip guard.** Line 57 checks `if (!process.env.DATABASE_URL)` inside `beforeAll`. Because `DATABASE_URL` is set to the production Azure PostgreSQL URL in `.env`, this guard never triggers — the tests always run against production. The `createWikiPageStore({ sql, logger: mockLogger })` at line 65 has no `embeddingModel` parameter, so it falls through to the `"voyage-code-3"` default in `wiki-store.ts` line 114. Running `bun test src/knowledge/wiki-store.test.ts` writes a "Test Page" fixture (page_id 100, up to 16 chunks with wrong-model `voyage-code-3` embeddings) into the production `wiki_pages` table. This was confirmed live during this session: running the test caused `audit:embeddings` to return `status_code=audit_failed` with `wiki_pages.model_mismatch=1`. The established M026 pattern is `TEST_DATABASE_URL` not `DATABASE_URL` — see DECISIONS.md: "pgvector tests use TEST_DATABASE_URL (not DATABASE_URL) for skip guards — DATABASE_URL in .env is always set (prod URL), so checking it would never skip."

- **Bug 2 — `scripts/backfill-wiki.ts` hardcodes `voyage-code-3`.** Line 93 has `model: "voyage-code-3"` in `createEmbeddingProvider` and line 86 calls `createWikiPageStore` without `embeddingModel`. If an operator runs this script against production, it writes wrong-model wiki embeddings and breaks the next `audit:embeddings` run. The correct constant `DEFAULT_WIKI_EMBEDDING_MODEL = "voyage-context-3"` is already exported from `src/knowledge/runtime.ts` line 19.

**S04 execution is therefore two targeted code fixes, a production cleanup run, a re-run of the live proof to confirm it still passes, and updating S04-SUMMARY.md with fresh post-fix evidence.** The composition harness itself needs no logic changes.

**Confirmed live state as of 2026-03-14T20:30 UTC:**
- `audit:embeddings --json` → `status_code=audit_failed`, `wiki_pages.model_mismatch=1`, `actual_models=["voyage-code-3"]`
- `repair:wiki-embeddings -- --status --json` → `status_code=repair_resume_available`, `run.status=resume_required`, `page_title=Test Page`, `repaired=2, failed=0`
- `verify-m027-s04.test.ts` → 6 pass, 0 fail (contract tests are independent of live DB state)

## Recommendation

The heavy composition and documentation work is done. The remaining S04 work is a precision repair pass for the two structural bugs, followed by production cleanup, re-running the live proof, and updating the final milestone closure artifacts.

### Step 1: Fix `wiki-store.test.ts` skip guard

Replace the `if (!process.env.DATABASE_URL)` guard pattern with the M026-established `describe.skipIf(!TEST_DB_URL)` pattern (same as `src/knowledge/review-comment-store.test.ts` lines 58–60):

1. Add `const TEST_DB_URL = process.env.TEST_DATABASE_URL;` before the describe block (around line 51).
2. Change `describe("WikiPageStore (pgvector)", () => {` to `describe.skipIf(!TEST_DB_URL)("WikiPageStore (pgvector)", () => {`.
3. Remove the `if (!process.env.DATABASE_URL)` guard block inside `beforeAll` (now redundant — `describe.skipIf` handles the whole block).
4. Update `beforeAll` to use `TEST_DB_URL!` for `connectionString` (consistent with `review-comment-store.test.ts` pattern).
5. Add `await sql\`TRUNCATE wiki_pages CASCADE\`` and `await sql\`TRUNCATE wiki_sync_state CASCADE\`` to the `afterAll` block so test runs don't leave rows in the test database after the final test.
6. Keep all per-test `if (!store) return` guards as defense-in-depth.

Note: `beforeEach` already has `TRUNCATE wiki_pages CASCADE` and `TRUNCATE wiki_sync_state CASCADE` — these clean between tests. The `afterAll` cleanup is needed after the last test run.

### Step 2: Fix `scripts/backfill-wiki.ts` model drift

1. Add `import { DEFAULT_WIKI_EMBEDDING_MODEL } from "../src/knowledge/runtime.ts";` to the imports at the top.
2. `createWikiPageStore` at line 86: add `embeddingModel: DEFAULT_WIKI_EMBEDDING_MODEL`.
3. `createEmbeddingProvider` at line 93: change `model: "voyage-code-3"` to `model: DEFAULT_WIKI_EMBEDDING_MODEL`.

### Step 3: Repair production contamination before running final proof

After Bug 1 is fixed, the "Test Page" contamination (currently present in production) must be cleaned before re-running the proof:

1. Run `bun run repair:wiki-embeddings -- --resume --json` to clean current "Test Page" contamination (upgrades existing wrong-model rows to `voyage-context-3`).
2. Verify `bun run audit:embeddings --json` returns `status_code=audit_ok` with `wiki_pages.model_mismatch=0`.

### Step 4: Final acceptance proof and closure

Run the acceptance proof to confirm it still passes after the fixes:

```
bun test ./scripts/verify-m027-s04.test.ts
bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json
```

Then update `S04-SUMMARY.md` citing the fresh post-fix proof output.

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| Final integrated milestone proof | `scripts/verify-m027-s04.ts` | Already implemented (459 lines), composes S01/S02/S03 proof functions, 4 stable check IDs, preserves nested raw evidence. No logic changes needed. |
| Test-DB skip guard pattern | `TEST_DATABASE_URL` guard in `src/knowledge/review-comment-store.test.ts` (lines 58–60) | Established M026 pattern: `const TEST_DB_URL = process.env.TEST_DATABASE_URL; describe.skipIf(!TEST_DB_URL)(...)`. Used correctly in issue-store.test.ts and memory-store.test.ts too. |
| Wiki model constant | `DEFAULT_WIKI_EMBEDDING_MODEL = "voyage-context-3"` from `src/knowledge/runtime.ts` line 19 | Already exported and used at runtime.ts lines 86, 94, 105. Import it in `scripts/backfill-wiki.ts`. |
| Post-fix verification | `bun run audit:embeddings --json` + `bun run verify:m027:s04 -- ...` | Two-step confirmation: clean audit first, then full proof. |
| Cleaning wiki contamination | `bun run repair:wiki-embeddings -- --resume --json` | Already handles upgrading wrong-model wiki rows to `voyage-context-3`. Idempotent. |

## Existing Code and Patterns

- `scripts/verify-m027-s04.ts` (459 lines) — composes `runM027S01ProofHarness`, `runM027S02ProofHarness`, `runM027S03ProofHarness` via injectable deps; 4 stable check IDs (`M027-S04-FULL-AUDIT`, `M027-S04-RETRIEVER`, `M027-S04-WIKI-REPAIR-STATE`, `M027-S04-NON-WIKI-REPAIR-STATE`); exits 1 on failure; preserves nested `s01`/`s02`/`s03` raw payloads under `--json`. **No logic changes needed.**

- `scripts/verify-m027-s04.test.ts` (882 lines, 6 tests) — contract tests all passing (6 pass, 0 fail, 35 expect() calls). Tests use mock deps via injectable functions. **No changes needed.**

- `src/knowledge/wiki-store.test.ts` — **buggy skip guard at line 57**: `if (!process.env.DATABASE_URL)` inside `beforeAll`. When `DATABASE_URL` is set in `.env` (production Azure PostgreSQL) and `TEST_DATABASE_URL` is absent, the guard never fires — all 16 tests run against production and write "Test Page" with `voyage-code-3` embeddings. **Confirmed live during this session**: running the test immediately broke `audit:embeddings`. Reference implementation for correct pattern: `src/knowledge/review-comment-store.test.ts` lines 58–60.

- `src/knowledge/review-comment-store.test.ts` (lines 58–60) — reference implementation of the correct pgvector test skip guard: `const TEST_DB_URL = process.env.TEST_DATABASE_URL; describe.skipIf(!TEST_DB_URL)("ReviewCommentStore (pgvector)", () => {`. Uses `TEST_DB_URL!` for connectionString in `beforeAll`. `afterAll` calls `closeDb()`. `beforeEach` clears rows. Also correctly used in `src/knowledge/memory-store.test.ts` and `src/knowledge/issue-store.test.ts`.

- `scripts/backfill-wiki.ts` (lines 86, 93) — `createWikiPageStore({ sql: db.sql, logger })` without `embeddingModel` at line 86; `createEmbeddingProvider({ model: "voyage-code-3", ... })` hardcoded at line 93. Both need `DEFAULT_WIKI_EMBEDDING_MODEL` from `src/knowledge/runtime.ts`.

- `src/knowledge/runtime.ts` (line 19) — `export const DEFAULT_WIKI_EMBEDDING_MODEL = "voyage-context-3"`. Used at runtime.ts lines 86, 94, 105. Adding this import to `scripts/backfill-wiki.ts` is a one-liner; the other imports are already there.

- `src/knowledge/wiki-store.ts` (line 114) — `opts.embeddingModel ?? "voyage-code-3"` — the fallback is intentionally `"voyage-code-3"` for non-wiki callers; wiki-aware callers must always pass `embeddingModel: DEFAULT_WIKI_EMBEDDING_MODEL`. This is why both `backfill-wiki.ts` and the test's `createWikiPageStore` call must carry the explicit parameter.

- `scripts/verify-m027-s04.ts` (lines 165–171) — `didWikiDurableStatusPass` is deliberately permissive: uses `["completed", "not_needed"].includes(report.status_evidence.run.status)` and requires `failed === 0` and `last_failure_class == null`. This handles idempotent reruns correctly and accepts either `repair_completed` or `not_needed` status.

- `docs/operations/embedding-integrity.md` — already has a `verify:m027:s04` section with command, check IDs, and localization guidance. No changes needed unless post-fix proof evidence warrants an update.

- `src/knowledge/wiki-store.test.ts` (lines 72–76) — `beforeEach` already truncates `wiki_pages` and `wiki_sync_state` between tests. The missing `afterAll` TRUNCATE means the final test's data persists in whatever DB the test connected to (production in the current `.env` setup). Both truncates must be added to `afterAll` after the `close()` call.

## Constraints

- `M027-S04-FULL-AUDIT` requires a milestone-wide six-corpus `audit_ok`. **The test bug (Bug 1) is an active threat**: as confirmed during this session, running `bun test src/knowledge/wiki-store.test.ts` in the current `.env` environment immediately breaks the audit. Bug 1 must be fixed before any further test suite runs that include wiki-store tests.
- `DATABASE_URL` is set to the Azure PostgreSQL production URL in `.env`; `TEST_DATABASE_URL` is absent from `.env`. Tests using `DATABASE_URL` as a skip guard will always run against production in this environment.
- `issue_comments` must remain under `not_in_retriever`; the S04 harness fails with `retriever_scope_mismatch` if this boundary disappears. No code changes affect this.
- The `verify:m027:s04` live proof depends on real Voyage API for the retriever check (`M027-S04-RETRIEVER`). Transient API errors flip `M027-S04-RETRIEVER` red; a rerun is sufficient.
- Three unrelated test failures exist in the full suite (`validateVoiceMatch` × 2, `extractPageStyle` × 1 — all 5000ms timeouts from M028 wiki voice work). These are NOT M027 scope and must not be fixed in S04 scope.
- The wiki repair state currently shows `page_title=Test Page` with `status=resume_required` (the last research-session repair was interrupted). After Bug 1 is fixed and the cleanup `--resume` runs, the S04 proof harness checks `status=completed` or `status=not_needed` plus `failed===0` — both pass.

## Common Pitfalls

- **Fixing only the `wiki-store.test.ts` skip guard without adding `afterAll` TRUNCATE** — the `afterAll` currently only closes the connection. Must add `TRUNCATE wiki_pages CASCADE` and `TRUNCATE wiki_sync_state CASCADE` so test runs don't leave rows in the test database after the final test.

- **Not cleaning up current production contamination before running the final proof** — the research session already re-contaminated `wiki_pages` with wrong-model "Test Page" rows. The proof will fail on `M027-S04-FULL-AUDIT` until a `--resume` run cleans those rows. Fix Bug 1 first, then clean, then run the final proof.

- **Not re-running the full acceptance proof after applying the fixes** — the closure summary must cite post-fix proof output. Contract tests alone are not sufficient to prove the bug fixes are safe on live data.

- **Only fixing one of the two `backfill-wiki.ts` model issues** — both the missing `embeddingModel` in `createWikiPageStore` (line 86) and `"voyage-code-3"` in `createEmbeddingProvider` (line 93) need `DEFAULT_WIKI_EMBEDDING_MODEL`.

- **Using `DATABASE_URL` in any new test's skip guard** — the established M026 pattern is `TEST_DATABASE_URL`. Any new pgvector test file must follow this pattern.

- **Conflating wiki repair state cursor with proof target** — the S02 status evidence now reports `page_title=Test Page` (the last page actually repaired) not `JSON-RPC API/v8`. The proof harness checks status code and counts (`failed=0`, `last_failure_class=null`), not page title — this is by design.

- **Treating S04-SUMMARY.md as already final** — the SUMMARY was recorded before the bug fixes were identified. After the bug fixes and final proof rerun, it must be updated with the actual post-fix passing evidence and correct citation of the two structural fixes.

## Open Risks

- **Active production contamination risk from Bug 1** — every run of `bun test` that includes `wiki-store.test.ts` (or any full-suite `bun test` run) will re-contaminate `wiki_pages` with wrong-model rows as long as Bug 1 is unfixed. This was confirmed twice during this session. **Time-sensitive — fix before any other test work.**

- **`backfill-wiki.ts` model drift is a live production risk** — until Bug 2 is fixed, any operator invoking `scripts/backfill-wiki.ts` against production will write `voyage-code-3` wiki embeddings and break the next audit run. Low-probability but high-impact.

- **`verify:m027:s04` live proof may encounter Voyage API transience** — the live proof calls the retriever which generates a real query embedding via Voyage. Transient API errors flip `M027-S04-RETRIEVER` red. A rerun is sufficient.

- **Wiki sync scheduler re-populating `wiki_pages`** — the wiki sync scheduler runs on a 24-hour recurrence starting 60 seconds after server startup. New real wiki pages get `voyage-context-3` correctly via runtime.ts wiring. No audit impact expected from normal sync.

- **M028 wiki voice test failures are unrelated but noisy** — `bun test` reports failures from M028 timeout issues. They do not affect M027 correctness and must not be fixed in S04 scope.

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| Bun | `sickn33/antigravity-awesome-skills@bun-development` | available — `npx skills add sickn33/antigravity-awesome-skills@bun-development` |
| pgvector / PostgreSQL vector search | `timescale/pg-aiguide@pgvector-semantic-search` | available — `npx skills add timescale/pg-aiguide@pgvector-semantic-search` |
| Timeout/debugging investigation | `debug-like-expert` | installed |

## Sources

- `scripts/verify-m027-s04.ts` confirmed 459 lines, `scripts/verify-m027-s04.test.ts` confirmed 882 lines (6 pass, 0 fail, 35 expect() calls), package alias `verify:m027:s04` confirmed wired in `package.json` (source: filesystem check + `bun test` run, 2026-03-14)
- T01–T04 all marked `[x]` complete in `S04-PLAN.md` and all T*-SUMMARY.md files present (source: filesystem check, 2026-03-14)
- S04-SUMMARY.md records `verification_result: passed` and `completed_at: 2026-03-12T15:24:00-07:00` (source: file read, 2026-03-14)
- **Live proof is FAILING at time of this research**: `bun run audit:embeddings --json` returns `status_code=audit_failed`, `wiki_pages.model_mismatch=1`, `actual_models=["voyage-code-3"]`, `total=1` (source: live run, 2026-03-14T20:30 UTC)
- **Repair state shows contamination**: `bun run repair:wiki-embeddings -- --status --json` returns `success=false`, `status_code=repair_resume_available`, `run.status=resume_required`, `page_title=Test Page`, `repaired=2, failed=0` (source: live run, 2026-03-14T20:30 UTC)
- Skip guard bug confirmed present in current code: `if (!process.env.DATABASE_URL)` at line 57 of `src/knowledge/wiki-store.test.ts`; `createWikiPageStore({ sql, logger: mockLogger })` at line 65 has no `embeddingModel`; all test bodies have `if (!store) return;` guards which only fire when DATABASE_URL is absent from process env (never, since `.env` always sets it) (source: code read, 2026-03-14)
- Reference skip guard pattern: `const TEST_DB_URL = process.env.TEST_DATABASE_URL; describe.skipIf(!TEST_DB_URL)(...)` (source: `src/knowledge/review-comment-store.test.ts` lines 58–60, confirmed 2026-03-14)
- `src/knowledge/issue-store.test.ts` and `src/knowledge/memory-store.test.ts` both confirmed to use `TEST_DATABASE_URL` correctly (source: code read, 2026-03-14)
- M026 decision establishing the pattern: "pgvector tests use TEST_DATABASE_URL (not DATABASE_URL) for skip guards — DATABASE_URL in .env is always set (prod URL), so checking it would never skip" (source: `.gsd/DECISIONS.md`)
- Model drift in backfill script confirmed present: `model: "voyage-code-3"` at line 93 of `scripts/backfill-wiki.ts`; `createWikiPageStore` without `embeddingModel` at line 86 (source: code read, 2026-03-14)
- Correct wiki model constant: `DEFAULT_WIKI_EMBEDDING_MODEL = "voyage-context-3"` at line 19 of `src/knowledge/runtime.ts`; used at lines 86, 94, 105 (source: code read, 2026-03-14)
- `wiki-store.ts` default behavior: `opts.embeddingModel ?? "voyage-code-3"` — no `embeddingModel` means wrong-model writes (source: `src/knowledge/wiki-store.ts` line 114, 2026-03-14)
- `verify-m027-s04.ts` `didWikiDurableStatusPass` uses `["completed", "not_needed"].includes(run.status)` (permissive for idempotent reruns) (source: `scripts/verify-m027-s04.ts` lines 165–171, confirmed 2026-03-14)
- `.env` has `DATABASE_URL` (production Azure PostgreSQL), `TEST_DATABASE_URL` is absent from `.env` (source: `.env` grep, 2026-03-14)
- `wiki-store.test.ts` `beforeEach` already TRUNCATES both tables between tests (lines 74–75); `afterAll` only calls `close()` — no post-run TRUNCATE, leaving last-test rows in whatever DB was connected (source: code read, 2026-03-14)
- Four M027-S04 check IDs confirmed in harness: `M027-S04-FULL-AUDIT`, `M027-S04-RETRIEVER`, `M027-S04-WIKI-REPAIR-STATE`, `M027-S04-NON-WIKI-REPAIR-STATE` (source: `scripts/verify-m027-s04.ts` lines 16–19, 2026-03-14)
- `M027-S04-FULL-AUDIT` gates on `s01.audit.status_code === "audit_ok"` (source: `scripts/verify-m027-s04.ts` line 237, 2026-03-14)
- `verify:m027:s04` package alias confirmed wired: `"verify:m027:s04": "bun scripts/verify-m027-s04.ts"` in package.json (source: package.json grep, 2026-03-14)
