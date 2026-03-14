# M027 / S04: Final Integrated Production Repair Proof — Research

**Date:** 2026-03-14

## Summary

S04 is the milestone-closing composition slice. The acceptance harness (`scripts/verify-m027-s04.ts`, 459 lines, 4 stable check IDs) is implemented, all 6 contract tests pass, the package alias is wired, and the runbook section in `docs/operations/embedding-integrity.md` exists. All four GSD tasks (T01–T04) are marked complete in the slice plan, and S04-SUMMARY.md records a passing live proof (`overallPassed=true`, `status_code=m027_s04_ok`). The live proof confirms all four milestone checks pass today: `M027-S04-FULL-AUDIT=audit_ok`, `M027-S04-RETRIEVER=retrieval_hits`, `M027-S04-WIKI-REPAIR-STATE=repair_completed`, `M027-S04-NON-WIKI-REPAIR-STATE=repair_completed`.

However, two structural code bugs were identified that were **not fixed during T01–T04 execution**. Both remain present in the code as of 2026-03-14:

- **Bug 1 — `src/knowledge/wiki-store.test.ts` uses the wrong skip guard.** Line 57 checks `if (!process.env.DATABASE_URL)` inside `beforeAll`. When `DATABASE_URL` is not loaded into the process environment, the `beforeAll` returns early and `store` remains `undefined`. All 16 test bodies have `if (!store) return;` guards so they silently pass as no-ops — they appear as 16 passing tests but no assertions actually run. This is the inverse of the intended `skip` semantics. When `DATABASE_URL` is loaded (e.g., from `.env` in a production-adjacent CI environment), the tests run against production, write "Test Page" with the wrong model (`voyage-code-3`, because `createWikiPageStore({ sql, logger: mockLogger })` at line 65 has no `embeddingModel` parameter), and contaminate `wiki_pages`. The current `wiki_embedding_repair_state` checkpoint (`page_title=Test Page`, `repaired=1`) is evidence that a prior wiki repair run cleaned exactly this contamination. The established M026 pattern is `TEST_DATABASE_URL` not `DATABASE_URL` — documented in DECISIONS.md: "pgvector tests use TEST_DATABASE_URL (not DATABASE_URL) for skip guards — DATABASE_URL in .env is always set (prod URL), so checking it would never skip."

- **Bug 2 — `scripts/backfill-wiki.ts` hardcodes `voyage-code-3`.** Line 93 has `model: "voyage-code-3"` in `createEmbeddingProvider` and line 86 calls `createWikiPageStore` without `embeddingModel`. If an operator runs this script against production, it writes wrong-model wiki embeddings and breaks the next `audit:embeddings` run. The correct constant `DEFAULT_WIKI_EMBEDDING_MODEL = "voyage-context-3"` is already exported from `src/knowledge/runtime.ts` line 19.

**S04 execution is therefore two targeted code fixes, a re-run of the live proof to confirm it still passes, and updating S04-SUMMARY.md with fresh post-fix evidence.** The composition harness itself needs no logic changes.

## Recommendation

The heavy composition and documentation work is done. The remaining S04 work is a precision repair pass for the two structural bugs, followed by re-running the live proof and updating the final milestone closure artifacts.

### Step 1: Fix `wiki-store.test.ts` skip guard

Replace the `if (!process.env.DATABASE_URL)` guard pattern with the M026-established `describe.skipIf(!TEST_DB_URL)` pattern (same as `src/knowledge/review-comment-store.test.ts` lines 58–60):

1. Add `const TEST_DB_URL = process.env.TEST_DATABASE_URL;` before the describe block (around line 51).
2. Change `describe("WikiPageStore (pgvector)", () => {` to `describe.skipIf(!TEST_DB_URL)("WikiPageStore (pgvector)", () => {`.
3. Remove the `if (!process.env.DATABASE_URL)` guard block inside `beforeAll` (now redundant — `describe.skipIf` handles the whole block).
4. Update `beforeAll` to use `TEST_DB_URL!` for `connectionString` (consistent with `review-comment-store.test.ts` pattern).
5. Add `await sql\`TRUNCATE wiki_pages CASCADE\`` and `await sql\`TRUNCATE wiki_sync_state CASCADE\`` to the `afterAll` block so the last test run doesn't leave rows in production.
6. Keep all per-test `if (!store) return` guards as defense-in-depth.

### Step 2: Fix `scripts/backfill-wiki.ts` model drift

1. Add `import { DEFAULT_WIKI_EMBEDDING_MODEL } from "../src/knowledge/runtime.ts";` to the imports at the top.
2. `createWikiPageStore` at line 86: add `embeddingModel: DEFAULT_WIKI_EMBEDDING_MODEL`.
3. `createEmbeddingProvider` at line 93: change `model: "voyage-code-3"` to `model: DEFAULT_WIKI_EMBEDDING_MODEL`.

### Step 3: Final acceptance proof and closure

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
| Test-DB skip guard pattern | `TEST_DATABASE_URL` guard in `src/knowledge/review-comment-store.test.ts` (lines 58–60) | Established M026 pattern: `const TEST_DB_URL = process.env.TEST_DATABASE_URL; describe.skipIf(!TEST_DB_URL)(...)`. |
| Wiki model constant | `DEFAULT_WIKI_EMBEDDING_MODEL = "voyage-context-3"` from `src/knowledge/runtime.ts` line 19 | Already exported and used at runtime.ts lines 86, 94, 105. Import it in `scripts/backfill-wiki.ts`. |
| Post-fix verification | `bun run audit:embeddings --json` + `bun run verify:m027:s04 -- ...` | Two-step confirmation: clean audit first, then full proof. |

## Existing Code and Patterns

- `scripts/verify-m027-s04.ts` (459 lines) — composes `runM027S01ProofHarness`, `runM027S02ProofHarness`, `runM027S03ProofHarness` via injectable deps; 4 stable check IDs (`M027-S04-FULL-AUDIT`, `M027-S04-RETRIEVER`, `M027-S04-WIKI-REPAIR-STATE`, `M027-S04-NON-WIKI-REPAIR-STATE`); exits 1 on failure; preserves nested `s01`/`s02`/`s03` raw payloads under `--json`. **No logic changes needed.**

- `scripts/verify-m027-s04.test.ts` (882 lines, 6 tests) — contract tests all passing (6 pass, 0 fail, 35 expect() calls). Tests use mock deps via injectable functions. **No changes needed.**

- `src/knowledge/wiki-store.test.ts` — **buggy skip guard at line 57**: `if (!process.env.DATABASE_URL)` inside `beforeAll`. When `DATABASE_URL` is not in process env, `store` stays `undefined` and all 16 tests silently pass via `if (!store) return;` guards — no assertions run. When `DATABASE_URL` is loaded, tests run against production and `createWikiPageStore({ sql, logger: mockLogger })` at line 65 (no `embeddingModel`) hits `opts.embeddingModel ?? "voyage-code-3"` fallback in `wiki-store.ts` line 114 — writing `voyage-code-3` into production. The `wiki_embedding_repair_state` checkpoint `page_title=Test Page, repaired=1` is direct evidence of prior test contamination that was cleaned by a repair run.

- `src/knowledge/review-comment-store.test.ts` (lines 58–60) — reference implementation of the correct pgvector test skip guard: `const TEST_DB_URL = process.env.TEST_DATABASE_URL; describe.skipIf(!TEST_DB_URL)("ReviewCommentStore (pgvector)", () => {`. Uses `TEST_DB_URL!` for connectionString in `beforeAll`. `afterAll` calls `closeDb()`. `beforeEach` clears rows.

- `src/knowledge/memory-store.test.ts` and `src/knowledge/issue-store.test.ts` — both use `TEST_DATABASE_URL` correctly and serve as additional reference implementations.

- `scripts/backfill-wiki.ts` (lines 86, 93) — `createWikiPageStore({ sql: db.sql, logger })` without `embeddingModel` at line 86; `createEmbeddingProvider({ model: "voyage-code-3", ... })` hardcoded at line 93. Both need `DEFAULT_WIKI_EMBEDDING_MODEL` from `src/knowledge/runtime.ts`.

- `src/knowledge/runtime.ts` (line 19) — `export const DEFAULT_WIKI_EMBEDDING_MODEL = "voyage-context-3"`. Used at runtime.ts lines 86, 94, 105. Import this in `scripts/backfill-wiki.ts`. Imports in `scripts/backfill-wiki.ts` already include `createWikiPageStore` from `wiki-store.ts` and `createEmbeddingProvider` from `embeddings.ts` — adding the runtime import is a one-liner.

- `src/knowledge/wiki-store.ts` (line ~25) — `const DEFAULT_WIKI_REPAIR_MODEL = "voyage-context-3"` used by `listRepairCandidates()` to identify degraded rows where `embedding_model IS DISTINCT FROM 'voyage-context-3'`. Must agree with the runtime constant — it does.

- `scripts/verify-m027-s02.ts` (line ~153) — S02 status check requires `status.success && status.status_code === "repair_completed" && status.run.status === "completed"`. The status evidence reports `page_title=Test Page` as the last repaired page, not `JSON-RPC API/v8`. This is expected: the wiki repair state surface reflects the last repair run's target page, and the "Test Page" repair was the cleanup of prior test contamination.

- `scripts/verify-m027-s04.ts` (lines 165–171) — `didWikiDurableStatusPass` is deliberately permissive: uses `["completed", "not_needed"].includes(report.status_evidence.run.status)` and requires `failed === 0` and `last_failure_class == null`. This handles healthy idempotent reruns correctly and matches the current live state.

- `docs/operations/embedding-integrity.md` — already has a `verify:m027:s04` section with command, check IDs, and localization guidance. No changes needed unless post-fix proof evidence warrants an update.

## Constraints

- `M027-S04-FULL-AUDIT` requires a milestone-wide six-corpus `audit_ok`. Currently passing because the wiki repair engine cleaned up the "Test Page" contamination from a prior test run. **However, running `bun test src/knowledge/wiki-store.test.ts` in a production environment (DATABASE_URL set, TEST_DATABASE_URL unset) would re-contaminate `wiki_pages` and break the next audit run.** This is why Bug 1 is time-sensitive.
- `issue_comments` must remain under `not_in_retriever`; the S04 harness fails with `retriever_scope_mismatch` if this boundary disappears. No code changes affect this.
- `DATABASE_URL` is set to the Azure PostgreSQL production URL in `.env`; test files using it as a skip guard will always run against production when tests load `.env`. Only `TEST_DATABASE_URL` is safe as a skip guard.
- `TEST_DATABASE_URL` is NOT in `.env` — it is only available in environments with an explicit test database. Tests using `describe.skipIf(!TEST_DATABASE_URL)` will correctly skip in all dev/CI environments where the test DB is not provisioned.
- The `verify:m027:s04` live proof depends on real Voyage API for the retriever check (`M027-S04-RETRIEVER`). The repair-state checks use `--status` mode only and do not call Voyage.
- The wiki sync scheduler re-populates `wiki_pages` from `kodi.wiki` using `voyage-context-3` (via `createKnowledgeRuntime`). If it fires, new pages will have the correct model — no audit impact.
- Three unrelated test failures exist in the full suite (`validateVoiceMatch` × 2, `extractPageStyle` × 2 — all 5000ms timeouts from M028 wiki voice work). These are NOT M027 scope.

## Common Pitfalls

- **Fixing only the `wiki-store.test.ts` skip guard without adding the `afterAll` TRUNCATE** — the `afterAll` exists but only closes the connection. Must add `TRUNCATE wiki_pages CASCADE` and `TRUNCATE wiki_sync_state CASCADE` there too. The `beforeEach` TRUNCATE covers inter-test isolation, but the final test still leaves rows behind if `afterAll` doesn't clean up.

- **Not re-running the full acceptance proof after applying the fixes** — the closure summary must cite post-fix proof output. Contract tests alone are not sufficient to prove the bug fixes are safe on live data.

- **Only fixing one of the two `backfill-wiki.ts` model issues** — both the missing `embeddingModel` in `createWikiPageStore` (line 86) and `"voyage-code-3"` in `createEmbeddingProvider` (line 93) need `DEFAULT_WIKI_EMBEDDING_MODEL`.

- **Treating the live proof as closed before the bug fixes land** — the proof currently passes because prior repair runs cleaned the contamination. Without the code fixes, the next test run against production would re-contaminate and break the audit.

- **Conflating wiki repair state cursor with proof target** — the S02 status evidence reports `page_title=Test Page` (the last page actually repaired) not `JSON-RPC API/v8`. This is correct: the proof harness shows the last completed repair checkpoint, which happens to be the test contamination cleanup run. `didWikiDurableStatusPass` checks status code and counts (`failed=0`, `last_failure_class=null`), not page title.

- **Treating the S04-SUMMARY.md as already final** — the SUMMARY was recorded before the bug fixes were identified. After the bug fixes and final proof rerun, it must be updated with the actual post-fix passing evidence and correct citation of the two structural fixes.

- **Using `DATABASE_URL` in any new test's skip guard** — the established M026 pattern is `TEST_DATABASE_URL`. Any new pgvector test file must follow this pattern.

- **Running `bun test` across all suites before fixing Bug 1** — in production agent environments where `.env` is loaded, if `bun test src/knowledge/wiki-store.test.ts` runs with `DATABASE_URL` set and `TEST_DATABASE_URL` unset, it will re-contaminate `wiki_pages`. Fix the skip guard first.

## Open Risks

- **Future `bun test` runs against production** — until Bug 1 is fixed, any run of `bun test` in a production environment (with `DATABASE_URL` set but `TEST_DATABASE_URL` unset) will re-contaminate `wiki_pages` with a wrong-model "Test Page". This re-triggers the need to run wiki repair before the next audit. **Time-sensitive fix.** Current ENV has DATABASE_URL set in `.env` and TEST_DATABASE_URL absent — this is the exact risk profile.

- **`backfill-wiki.ts` model drift is a live production risk** — until Bug 2 is fixed, any operator invoking `scripts/backfill-wiki.ts` against production will write `voyage-code-3` wiki embeddings and break the next audit run. This risk is low-probability (requires manual invocation) but high-impact.

- **`verify:m027:s04` live proof may encounter Voyage API transience** — the live proof calls the retriever which generates a real query embedding via Voyage. Transient API errors flip `M027-S04-RETRIEVER` red. A rerun is sufficient.

- **Wiki sync scheduler re-populating `wiki_pages`** — the wiki sync scheduler runs on a 24-hour recurrence starting 60 seconds after server startup. New real wiki pages will get `voyage-context-3` correctly. No audit impact expected, but the `wiki_pages` row count will grow over time.

- **M028 wiki voice test failures are unrelated but noisy** — `bun test` reports 3 failures (2 unique: `validateVoiceMatch`, `extractPageStyle`) from M028 timeout issues. They do not affect M027 correctness and should not be fixed in S04 scope.

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| Bun | `sickn33/antigravity-awesome-skills@bun-development` | available — `npx skills add sickn33/antigravity-awesome-skills@bun-development` |
| pgvector / PostgreSQL vector search | `timescale/pg-aiguide@pgvector-semantic-search` | available — `npx skills add timescale/pg-aiguide@pgvector-semantic-search` |
| Timeout/debugging investigation | `debug-like-expert` | installed |

## Sources

- `scripts/verify-m027-s04.ts` confirmed 459 lines, `scripts/verify-m027-s04.test.ts` confirmed 882 lines (6 pass, 0 fail, 35 expect() calls), package alias `verify:m027:s04` confirmed wired at line 16 of `package.json` (source: filesystem check + `bun test` run, 2026-03-14)
- T01–T04 all marked `[x]` complete in `S04-PLAN.md` and all T*-SUMMARY.md files present in `.gsd/milestones/M027/slices/S04/tasks/` (source: filesystem check, 2026-03-14)
- S04-SUMMARY.md records `verification_result: passed` and `completed_at: 2026-03-12T15:24:00-07:00` (source: file read, 2026-03-14)
- Live proof confirmed passing: `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json` returned `overallPassed=true`, `status_code=m027_s04_ok`, all 4 check IDs green (source: live run, 2026-03-14)
- Skip guard bug confirmed present in current code: `if (!process.env.DATABASE_URL)` at line 57 of `src/knowledge/wiki-store.test.ts`; `afterAll` has `if (close) await close()` but no TRUNCATE; `createWikiPageStore({ sql, logger: mockLogger })` at line 65 has no `embeddingModel`; all 16 test bodies have `if (!store) return;` guards so they silently pass as no-ops when DATABASE_URL is absent from process env (source: code read + `bun test src/knowledge/wiki-store.test.ts` run showing 16 pass/0 fail without env loaded, 2026-03-14)
- Reference skip guard pattern: `const TEST_DB_URL = process.env.TEST_DATABASE_URL; describe.skipIf(!TEST_DB_URL)(...)` (source: `src/knowledge/review-comment-store.test.ts` lines 58–60, confirmed 2026-03-14)
- `src/knowledge/issue-store.test.ts` and `src/knowledge/memory-store.test.ts` both confirmed to use `TEST_DATABASE_URL` correctly (source: code read, 2026-03-14)
- M026 decision establishing the pattern: "pgvector tests use TEST_DATABASE_URL (not DATABASE_URL) for skip guards — DATABASE_URL in .env is always set (prod URL), so checking it would never skip" (source: `.gsd/DECISIONS.md`)
- Model drift in backfill script confirmed present: `model: "voyage-code-3"` at line 93; `createWikiPageStore` without `embeddingModel` at line 86 (source: `scripts/backfill-wiki.ts` read, confirmed 2026-03-14)
- Correct wiki model constant: `DEFAULT_WIKI_EMBEDDING_MODEL = "voyage-context-3"` at line 19 of `src/knowledge/runtime.ts`; used at lines 86, 94, 105 (source: code read, 2026-03-14)
- `wiki-store.ts` store default behavior: `opts.embeddingModel ?? "voyage-code-3"` — no `embeddingModel` means wrong-model writes (source: `src/knowledge/wiki-store.ts`)
- `verify-m027-s04.ts` `didWikiDurableStatusPass` uses `["completed", "not_needed"].includes(run.status)` (permissive for idempotent reruns) (source: `scripts/verify-m027-s04.ts` lines 165–171, confirmed 2026-03-14)
- S04 non-wiki repair check also uses `["completed", "not_needed"].includes(...)` at lines 186–199 — same permissive pattern (source: `scripts/verify-m027-s04.ts`, confirmed 2026-03-14)
- `NON_WIKI_REPAIR_CORPORA` confirmed as: `["review_comments", "learning_memories", "code_snippets", "issues", "issue_comments"]` (source: `src/knowledge/embedding-repair.ts`)
- `wiki_embedding_repair_state` current live state: `page_title=Test Page`, `repaired=1`, `status=completed` — confirmed evidence of prior test contamination cleanup (source: `bun run repair:wiki-embeddings -- --status --json`, 2026-03-14)
- `.env` has `DATABASE_URL` (production Azure PostgreSQL), `TEST_DATABASE_URL` is absent from `.env` (source: `.env` grep, 2026-03-14)
- Full test suite: 2193 pass, 45 skip, 3 fail (2 unique failures: `validateVoiceMatch` and `extractPageStyle`, both 5000ms M028 timeouts — not M027 scope) (source: `bun test`, 2026-03-14)
- M027-ROADMAP.md: all four slices `[x]` (source: `.gsd/milestones/M027/M027-ROADMAP.md`, 2026-03-14)
