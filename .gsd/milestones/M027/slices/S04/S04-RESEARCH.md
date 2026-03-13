# M027 / S04: Final Integrated Production Repair Proof — Research

**Date:** 2026-03-13

## Summary

S04 is the milestone-closing composition slice. The implementation is substantially complete: `scripts/verify-m027-s04.ts` (459 lines, 4 stable check IDs) is implemented, all 6 contract tests pass, the package alias is wired, and the runbook section in `docs/operations/embedding-integrity.md` exists.

**Current live state (2026-03-13 — updated during research session):**

The live proof now passes:
```
bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json
→ overallPassed=true, status_code=m027_s04_ok
```

All four checks pass:
- `M027-S04-FULL-AUDIT` → `audit_ok` (six corpora, all pass)
- `M027-S04-RETRIEVER` → `retrieval_hits` (live query embedding generated, attributed hits returned)
- `M027-S04-WIKI-REPAIR-STATE` → `repair_completed` (durable state, failed=0)
- `M027-S04-NON-WIKI-REPAIR-STATE` → `repair_completed` (review_comments, durable state, failed=0)

**How the blocker was resolved:** Earlier in this research session, the proof was failing with `M027-S04-FULL-AUDIT:audit_failed` and `M027-S04-WIKI-REPAIR-STATE:repair_resume_available`. The root cause was a "Test Page" (page_id=100) in production `wiki_pages` with `embedding_model=voyage-code-3` — written there by `wiki-store.test.ts` using the production `DATABASE_URL` instead of the `TEST_DATABASE_URL` guard. Running `bun run repair:wiki-embeddings -- --json` during this research session re-embedded "Test Page" with the correct `voyage-context-3` model, clearing both failures.

**Two structural bugs remain open** that must be fixed before S04 closes. These prevent future recurrence:

**Bug 1 — `src/knowledge/wiki-store.test.ts` uses wrong skip guard.** Line 57 checks `if (!process.env.DATABASE_URL)` inside `beforeAll`. In this environment `DATABASE_URL` is always set to the production Azure PostgreSQL URL, so tests run against production. The established M026 pattern uses `TEST_DATABASE_URL`. The final test writes "Test Page" with `embeddingModel` unset, hitting the `wiki-store.ts` fallback `opts.embeddingModel ?? "voyage-code-3"` and writing the wrong model into production. An `afterAll` TRUNCATE is also missing as cleanup.

**Bug 2 — `scripts/backfill-wiki.ts` uses hardcoded `voyage-code-3`.** Line 93 has `model: "voyage-code-3"` in the `createEmbeddingProvider` call and line 86 has no `embeddingModel` in `createWikiPageStore`. If this script runs against production, it writes wrong-model wiki embeddings. The fix is to import `DEFAULT_WIKI_EMBEDDING_MODEL` from `src/knowledge/runtime.ts`.

**S04 execution is therefore:**
1. Fix `wiki-store.test.ts` skip guard (prevents future test contamination)
2. Fix `scripts/backfill-wiki.ts` model drift (prevents future operational contamination)
3. Verify the proof still passes and write S04-SUMMARY citing the live evidence
4. Update milestone closure artifacts

## Recommendation

All the heavy composition work is done. This is a precision repair pass followed by milestone closure.

### Step 1: Fix `wiki-store.test.ts` skip guard

Replace the `if (!process.env.DATABASE_URL)` guard pattern with the M026-established `describe.skipIf(!TEST_DB_URL)` pattern:

1. Add `const TEST_DB_URL = process.env.TEST_DATABASE_URL;` before the describe block.
2. Change `describe("WikiPageStore (pgvector)", () => {` to `describe.skipIf(!TEST_DB_URL)("WikiPageStore (pgvector)", () => {`.
3. Remove the `if (!process.env.DATABASE_URL)` check inside `beforeAll` (now redundant).
4. Verify the `afterAll` already has `TRUNCATE wiki_pages CASCADE` — if not, add it.
5. Keep all per-test `if (!store) return` guards (they protect idiomatic skip-within-describe behavior).

### Step 2: Fix `scripts/backfill-wiki.ts` model drift

1. Add `import { DEFAULT_WIKI_EMBEDDING_MODEL } from "../src/knowledge/runtime.ts";` at top.
2. `createWikiPageStore` at line 86: add `embeddingModel: DEFAULT_WIKI_EMBEDDING_MODEL`.
3. `createEmbeddingProvider` at line 93: change `model: "voyage-code-3"` to `model: DEFAULT_WIKI_EMBEDDING_MODEL`.

### Step 3: Final acceptance proof and closure

Run the acceptance proof to confirm it still passes after the fixes:

```
bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json
```

Then update S04-SUMMARY.md with the actual proof output and mark all milestone artifacts closed.

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| Final integrated milestone proof | `scripts/verify-m027-s04.ts` | Already implemented (459 lines), composes S01/S02/S03 proof functions, 4 stable check IDs, preserves nested raw evidence. No logic changes needed. |
| Test-DB skip guard pattern | `TEST_DATABASE_URL` guard in `src/knowledge/review-comment-store.test.ts` (lines 58–60) | Established M026 pattern: `const TEST_DB_URL = process.env.TEST_DATABASE_URL; describe.skipIf(!TEST_DB_URL)(...)`. |
| Wiki model constant | `DEFAULT_WIKI_EMBEDDING_MODEL = "voyage-context-3"` from `src/knowledge/runtime.ts` line 19 | Already exported and used at runtime.ts line 105. Import it in `scripts/backfill-wiki.ts`. |
| Post-fix verification | `bun run audit:embeddings --json` + `bun run verify:m027:s04 -- ...` | Two-step confirmation: clean audit first, then full proof. |

## Existing Code and Patterns

- `scripts/verify-m027-s04.ts` (459 lines) — composes `runM027S01ProofHarness`, `runM027S02ProofHarness`, `runM027S03ProofHarness` via injectable deps; 4 stable check IDs; exits 1 with failing check ID; preserves nested `s01`/`s02`/`s03` raw payloads under `--json`. **No logic changes needed.**

- `scripts/verify-m027-s04.test.ts` — 6 contract tests, **all passing** (6 pass, 0 fail). Tests use mock deps via injectable functions. **No changes needed.**

- `src/knowledge/wiki-store.test.ts` — **buggy skip guard at line 57**: `if (!process.env.DATABASE_URL)` inside `beforeAll`. No `afterAll` TRUNCATE. The `createWikiPageStore({ sql, logger: mockLogger })` call at line 67 has no `embeddingModel`, so `writeChunks` hits `opts.embeddingModel ?? "voyage-code-3"` fallback at wiki-store.ts line 114 — writing `voyage-code-3` into production when embedding is set on a chunk. The `beforeEach` TRUNCATES between tests but there is no final `afterAll` TRUNCATE.

- `src/knowledge/review-comment-store.test.ts` (lines 58–60) — reference implementation of the correct pgvector test skip guard: `const TEST_DB_URL = process.env.TEST_DATABASE_URL; describe.skipIf(!TEST_DB_URL)("ReviewCommentStore (pgvector)", () => {`.

- `src/knowledge/memory-store.test.ts` and `src/knowledge/issue-store.test.ts` — both use `TEST_DATABASE_URL` correctly.

- `scripts/backfill-wiki.ts` (lines 86, 93) — `createWikiPageStore({ sql: db.sql, logger })` without `embeddingModel` at line 86; `createEmbeddingProvider({ model: "voyage-code-3", ... })` hardcoded at line 93. Both need `DEFAULT_WIKI_EMBEDDING_MODEL`.

- `src/knowledge/runtime.ts` (line 19) — `export const DEFAULT_WIKI_EMBEDDING_MODEL = "voyage-context-3"`. Used at line 105 in `createWikiPageStore({ embeddingModel: DEFAULT_WIKI_EMBEDDING_MODEL, ... })`. Import this in `scripts/backfill-wiki.ts`.

- `src/knowledge/wiki-store.ts` (line 25) — `const DEFAULT_WIKI_REPAIR_MODEL = "voyage-context-3"` used by `listRepairCandidates()` to identify degraded rows where `embedding_model IS DISTINCT FROM 'voyage-context-3'`.

- `scripts/verify-m027-s02.ts` (line 153) — S02 status check requires `status.success && status.status_code === "repair_completed" && status.run.status === "completed"`. Passes now because wiki repair cleared the degraded state.

- `docs/operations/embedding-integrity.md` — already has a `verify:m027:s04` section. May need minor updates to reflect the final passing proof evidence.

## Constraints

- `M027-S04-FULL-AUDIT` requires a milestone-wide six-corpus `audit_ok`. Currently passing with `wiki_pages total=1, model_mismatch=0, actual_models=["voyage-context-3"]` after the wiki repair ran during research.
- `issue_comments` must remain under `not_in_retriever`; the S04 harness fails with `retriever_scope_mismatch` if this boundary disappears. No changes affect this.
- `DATABASE_URL` is always set to the Azure PostgreSQL production URL in `.env`; test files using it as a skip guard will always run against production. Only `TEST_DATABASE_URL` is safe as a skip guard.
- The `verify:m027:s04` live proof depends on real Voyage API for the retriever check (`M027-S04-RETRIEVER`). The repair-state checks do not require Voyage since they use `--status` mode only.
- The wiki sync scheduler re-populates `wiki_pages` from `kodi.wiki` using `voyage-context-3` (via `createKnowledgeRuntime`). If it fires after the "Test Page" row was re-embedded, it will also write any new live wiki pages with the correct model.

## Common Pitfalls

- **Fixing only the `wiki-store.test.ts` skip guard without verifying the `afterAll` TRUNCATE** — the test file has a `close` call in `afterAll` but the TRUNCATE at line 74 already exists. Confirm it covers `wiki_pages CASCADE` before assuming the fix is complete.

- **Not re-running the full acceptance proof after applying the fixes** — the closure summary must cite the post-fix proof output, not the pre-fix proof from earlier in the session.

- **Only fixing one of the two `backfill-wiki.ts` model issues** — the script has both an `embeddingModel` gap in `createWikiPageStore` and a hardcoded `"voyage-code-3"` in `createEmbeddingProvider`. Both need `DEFAULT_WIKI_EMBEDDING_MODEL`.

- **Forgetting to verify the non-wiki path is still healthy** — `repair:embeddings -- --corpus review_comments --status --json` returns `repair_completed` and needs no changes. Just confirm it still passes after the wiki fixes.

- **Treating the S04-SUMMARY.md as already final** — the SUMMARY was written before the test-contamination bug was resolved. The T03-T04 tasks may have been completed in an earlier session, but the failing live proof state means the summary's "verification" section may not reflect the live proof that ran during this session.

## Open Risks

- **`verify:m027:s04` live proof may encounter Voyage API transience** — the live proof calls the retriever which generates a real query embedding via Voyage. API errors would flip `M027-S04-RETRIEVER` red. A rerun is sufficient if this occurs.

- **Wiki sync scheduler re-populating `wiki_pages` with correct model** — the wiki sync scheduler runs on a 24-hour recurrence starting 60 seconds after server startup. If it fires, it will add new real wiki pages using `voyage-context-3`. This is fine for audit correctness; `total` counts will change but no model mismatch will appear.

- **Future `bun test` runs against production** — until Bug 1 is fixed, running the full test suite against a production environment (any environment with `DATABASE_URL` set but `TEST_DATABASE_URL` unset) will re-contaminate `wiki_pages` with a wrong-model "Test Page". This is a time-sensitive fix because the wiki repair will need to run again to restore the correct state.

- **`backfill-wiki.ts` model drift is a live production risk** — until Bug 2 is fixed, any operator invoking `scripts/backfill-wiki.ts` against production will write `voyage-code-3` wiki embeddings and immediately break the next audit run.

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| Bun | `sickn33/antigravity-awesome-skills@bun-development` | available — `npx skills add sickn33/antigravity-awesome-skills@bun-development` |
| pgvector / PostgreSQL vector search | `timescale/pg-aiguide@pgvector-semantic-search` | available — `npx skills add timescale/pg-aiguide@pgvector-semantic-search` |
| Timeout/debugging investigation | `debug-like-expert` | installed |

## Sources

- Live proof passing (status_code=m027_s04_ok): `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json` (source: live run 2026-03-13, after wiki repair ran during research)
- Wiki repair fixed the blocking contamination: `bun run repair:wiki-embeddings -- --json` → `success=true, status_code=repair_completed, repaired=1` (source: live run 2026-03-13)
- Post-repair audit clean: `bun run audit:embeddings --json` → `success=true, status_code=audit_ok, wiki_pages model_mismatch=0, actual_models=["voyage-context-3"]` (source: live run 2026-03-13)
- S04 contract tests all passing: `bun test ./scripts/verify-m027-s04.test.ts` → 6 pass, 0 fail (source: live run 2026-03-13)
- Skip guard bug confirmed: `if (!process.env.DATABASE_URL)` at line 57 of `src/knowledge/wiki-store.test.ts`; `afterAll` has `close()` but no TRUNCATE at final position (source: code review 2026-03-13)
- Reference skip guard pattern: `const TEST_DB_URL = process.env.TEST_DATABASE_URL; describe.skipIf(!TEST_DB_URL)(...)` (source: `src/knowledge/review-comment-store.test.ts` lines 58–60)
- M026 decision establishing the pattern: "pgvector tests use TEST_DATABASE_URL (not DATABASE_URL) for skip guards — DATABASE_URL in .env is always set (prod URL), so checking it would never skip" (source: `.gsd/DECISIONS.md`)
- Model drift in backfill script: `model: "voyage-code-3"` at line 93; `createWikiPageStore` without `embeddingModel` at line 86 (source: `scripts/backfill-wiki.ts`)
- Correct wiki model constant: `DEFAULT_WIKI_EMBEDDING_MODEL = "voyage-context-3"` at line 19 of `src/knowledge/runtime.ts` (source: code review 2026-03-13)
- `wiki-store.ts` store default behavior: `opts.embeddingModel ?? "voyage-code-3"` at line 114 — no `embeddingModel` means wrong-model writes (source: `src/knowledge/wiki-store.ts`)
- Non-wiki repair already healthy: `bun run repair:embeddings -- --corpus review_comments --status --json` → `success=true, status_code=repair_completed` (source: live run 2026-03-13)
- Retriever returning attributed hits: `bun run verify:retriever --repo xbmc/xbmc --query "json-rpc subtitle delay" --json` → `retrieval_hits`, 5 unified results (snippet + review_comment sources) (source: embedded in live proof run 2026-03-13)
