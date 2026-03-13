# M027 / S04: Final Integrated Production Repair Proof — Research

**Date:** 2026-03-13

## Summary

S04 is the milestone-closing composition slice. All four slice execution artifacts exist and are complete — `scripts/verify-m027-s04.ts` (459 lines, 6/6 contract tests pass), the package alias, and the runbook section in `docs/operations/embedding-integrity.md`. **The milestone is already closed and `verify:m027:s04` currently passes** (`m027_s04_ok`, all four checks green). M027 is recorded as complete in `.gsd/STATE.md`; the active milestone is M028.

**Current live state:** `verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json` returns `overallPassed=true`, `status_code=m027_s04_ok` with all four milestone checks passing: `M027-S04-FULL-AUDIT=audit_ok`, `M027-S04-RETRIEVER=retrieval_hits`, `M027-S04-WIKI-REPAIR-STATE=repair_completed`, `M027-S04-NON-WIKI-REPAIR-STATE=repair_completed`.

**Two latent bugs exist** (not blocking the current passing proof, but should be fixed during S04 execution to prevent future contamination):

**Bug 1 — `wiki-store.test.ts` uses `DATABASE_URL` as its skip guard.** In this environment `DATABASE_URL` is always set to the Azure PostgreSQL production URL (`.env` always has it). So the test suite connects to production, `beforeEach` truncates `wiki_pages`/`wiki_sync_state` before each test, and there is no `afterAll` truncate — the final test (`replacePageChunks`) leaves "Test Page" (page_id=100) in the production `wiki_pages` table. This caused a prior S04 regression (audit failed with `wiki_pages model_mismatch=1`). The M026 pattern uses `TEST_DATABASE_URL` as the guard; `review-comment-store.test.ts` (line 58–60) is the reference.

**Bug 2 — `scripts/backfill-wiki.ts` creates `wikiPageStore` without `embeddingModel`.** Line 86: `createWikiPageStore({ sql: db.sql, logger })` uses the store default of `"voyage-code-3"` for any chunk it writes with an embedding. If this script is ever run against production, all wiki pages it ingests will carry the wrong model and the audit will fail again. The established fix is to add `embeddingModel: DEFAULT_WIKI_EMBEDDING_MODEL` from `src/knowledge/runtime.ts`.

**What the current passing proof relies on:** A prior research repair run (`bun run repair:wiki-embeddings -- --json`) re-embedded "Test Page" to `voyage-context-3`, so the audit now passes with `wiki_pages total=1, model_mismatch=0`. "Test Page" is a test fixture row, not real wiki content — but its presence doesn't hurt correctness (the proof measures model correctness, not content authenticity).

**What S04 execution needs to do (beyond what's already done):**
1. Fix `wiki-store.test.ts` skip guard to prevent future contamination.
2. Fix `scripts/backfill-wiki.ts` model parameter to prevent future model drift.
3. Optionally: hard-delete "Test Page" from production for cleanliness, then re-run the proof.
4. Write S04-SUMMARY.md with the actual passing proof output.
5. Close milestone artifacts: mark S04 in ROADMAP, update REQUIREMENTS.md, PROJECT.md, STATE.md.

Steps 4 and 5 have already been completed (ROADMAP marks S04 `[x]`, STATE.md records M027 closed), but steps 1–3 remain as cleanup debt.

## Recommendation

1. **Fix `wiki-store.test.ts` skip guard** — change line 57 from `process.env.DATABASE_URL` to `process.env.TEST_DATABASE_URL` and convert to the `describe.skipIf(!TEST_DB_URL)` pattern used by `review-comment-store.test.ts` (lines 58–60). Add an `afterAll` truncate as a safety net. This is the root cause fix that prevents future contamination.

2. **Fix `scripts/backfill-wiki.ts` model parameter** — add `embeddingModel: DEFAULT_WIKI_EMBEDDING_MODEL` to the `createWikiPageStore` call at line 86. Import the constant from `src/knowledge/runtime.ts`.

3. **Hard-delete "Test Page" (page_id=100)** — `DELETE FROM wiki_pages WHERE page_id = 100`. This cleans the test artifact from production. After deletion, `audit:embeddings` will report `wiki_pages total=0, model_mismatch=0, status=pass` (the audit handles empty correctly — it is not an error condition).

4. **Re-run `verify:m027:s04`** after the cleanup to capture fresh proof output with clean wiki state.

5. **Record final proof output** in S04-SUMMARY.md and ensure milestone closure artifacts cite the post-cleanup proof command.

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| Final integrated milestone proof | `scripts/verify-m027-s04.ts` | Already correct and passing — composes S01/S02/S03 proof functions, stable check IDs, preserves nested raw evidence. The harness needs no changes. |
| Test-DB skip guard pattern | `TEST_DATABASE_URL` guard in `src/knowledge/review-comment-store.test.ts` (lines 58–60) | The established M026 pattern: `const TEST_DB_URL = process.env.TEST_DATABASE_URL; describe.skipIf(!TEST_DB_URL)(...)`. Use verbatim. |
| Test page deletion | Direct SQL `DELETE FROM wiki_pages WHERE page_id = 100` | Simplest safe fix. Hard-delete is cleaner than soft-delete for a test artifact since we don't want the row around at all. |
| Wiki model constant | `DEFAULT_WIKI_EMBEDDING_MODEL = "voyage-context-3"` from `src/knowledge/runtime.ts` line 19 | Already exported. Import it in `scripts/backfill-wiki.ts` rather than hardcoding the string. |
| Post-fix verification | `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json` | The canonical final acceptance command. Must still pass after cleanup. |

## Existing Code and Patterns

- `scripts/verify-m027-s04.ts` (459 lines) — composes `runM027S01ProofHarness`, `runM027S02ProofHarness`, `runM027S03ProofHarness` via injectable deps; evaluates four stable check IDs: `M027-S04-FULL-AUDIT`, `M027-S04-RETRIEVER`, `M027-S04-WIKI-REPAIR-STATE`, `M027-S04-NON-WIKI-REPAIR-STATE`; exits 1 with failing check ID on failure; preserves nested `s01`/`s02`/`s03` raw payloads under `--json`. **No changes needed.**
- `scripts/verify-m027-s04.test.ts` — 6 contract tests, all pass; covers idempotent healthy reruns, audit regression cases, retriever failure cases, wiki/non-wiki resume-needed failures, and `issue_comments:not_in_retriever` scope-truthfulness enforcement.
- `src/knowledge/wiki-store.test.ts` — **buggy skip guard at line 57**: uses `process.env.DATABASE_URL` instead of `process.env.TEST_DATABASE_URL`; has `beforeEach` truncating `wiki_pages`/`wiki_sync_state` but no `afterAll` truncate — final test (`replacePageChunks`) leaves "Test Page" (page_id=100) in production. **Needs skip guard fix and afterAll cleanup.**
- `src/knowledge/review-comment-store.test.ts` (lines 58–60) — reference implementation of the correct pgvector test skip guard: `const TEST_DB_URL = process.env.TEST_DATABASE_URL; describe.skipIf(!TEST_DB_URL)(...)`.
- `src/knowledge/memory-store.test.ts` (line 53–55) — also uses `TEST_DATABASE_URL` correctly. Additional confirmation of the right pattern.
- `src/knowledge/issue-store.test.ts` (line 71–73) — also uses `TEST_DATABASE_URL` correctly.
- `scripts/backfill-wiki.ts` (line 86) — `createWikiPageStore({ sql: db.sql, logger })` without `embeddingModel`; defaults wiki writes to `voyage-code-3` via the store default. **Needs `embeddingModel: DEFAULT_WIKI_EMBEDDING_MODEL` added.**
- `src/knowledge/runtime.ts` (line 19) — exports `DEFAULT_WIKI_EMBEDDING_MODEL = "voyage-context-3"` and uses it consistently at line 105 for `createWikiPageStore`. This is the pattern `scripts/backfill-wiki.ts` should follow.
- `scripts/wiki-embedding-repair.ts` `executeStatus()` function — status logic: `const hasRemaining = remaining.length > 0; const status = hasRemaining || lastFailureClass ? "resume_required" : "completed"`. After "Test Page" is deleted, `remaining.length = 0` → `status = "completed"` → `status_code = "repair_completed"` ✅.
- `src/knowledge/embedding-audit.ts` — audit queries `wiki_pages WHERE deleted = false`; after hard-deletion, `total=0, model_mismatch=0, status=pass` (empty corpus is a pass, not a failure).
- `src/db/migrations/028-wiki-embedding-repair-state.sql` — `wiki_embedding_repair_state` checkpoint records repair history per bounded run. After "Test Page" cleanup, the checkpoint may reference page_id=100 from the research repair run. Do not truncate this table — it is the durable repair evidence. Status checks use `listRepairCandidates()` dynamically; a stale checkpoint referencing a deleted page does not re-introduce repair candidates.
- Other test files with `DATABASE_URL` skip guard patterns: `src/telemetry/store.test.ts`, `src/contributor/profile-store.test.ts`, `src/knowledge/store.test.ts` — all three use `DATABASE_URL ?? "postgresql://kodiai:..."` fallback pattern (defaulting to a local dev URL if unset, not production). These are safe as-is since the fallback avoids production; only `wiki-store.test.ts` has the unconditional production-hit problem.

## Constraints

- `M027-S04-FULL-AUDIT` requires a milestone-wide six-corpus `audit_ok`; slice-local audit views from S02/S03 are insufficient.
- `M027-S04-WIKI-REPAIR-STATE` checks both the repair probe result (`["repair_completed", "repair_not_needed"]`) AND the durable status row (`repair_completed`, `failed=0`, no `last_failure_class`). Both must pass.
- `issue_comments` must remain under `not_in_retriever`; the S04 harness fails with `retriever_scope_mismatch` if this boundary disappears.
- `DATABASE_URL` is always set to the Azure PostgreSQL production URL in `.env`; test files using it as a skip guard will always run against production. Only `TEST_DATABASE_URL` is safe for that pattern.
- Do not truncate `wiki_embedding_repair_state` — it holds the durable repair evidence for prior bounded wiki repairs.
- `scripts/backfill-wiki.ts` is an operator-facing tool; fix the missing model parameter in place rather than wrapping it. The fix is additive (one parameter) and does not break existing usage.

## Common Pitfalls

- **Using `repair:wiki-embeddings` to fix test artifacts instead of deleting them** — repairing "Test Page" embeds fake wiki content with `voyage-context-3` and persists it in the production knowledge store. The research session already did this. The correct follow-up is to delete the row.
- **Soft-deleting "Test Page" instead of hard-deleting** — `store.softDeletePage(100)` marks `deleted=true`; the audit excludes deleted rows; the proof would still pass. But the row remains as noise. Hard-delete is cleaner for a test fixture.
- **Forgetting to fix the skip guard after deleting the row** — deleting fixes the current state but doesn't prevent the next `bun test` run from re-inserting "Test Page". Fix `wiki-store.test.ts` first.
- **Treating `wiki_pages total=0` as a degraded state** — after deletion, `total=0, model_mismatch=0` maps to `status=pass`. The audit correctly handles an empty corpus.
- **Adding only an `afterAll(TRUNCATE)` to `wiki-store.test.ts` instead of fixing the skip guard** — that would prevent contamination but still runs the test against production, which is wrong. Use `TEST_DATABASE_URL` skip guard so the test only runs against a real test database.
- **Assuming the three `DATABASE_URL ??` tests are also dangerous** — `telemetry/store.test.ts`, `contributor/profile-store.test.ts`, and `knowledge/store.test.ts` use `DATABASE_URL ?? "postgresql://kodiai:..."` and will connect to local dev when `DATABASE_URL` is unset. They are safe because the fallback prevents accidental production hits, unlike `wiki-store.test.ts` which has no fallback.
- **Not re-running `verify:m027:s04` after cleanup** — the closure summary should cite post-cleanup proof output, not the pre-cleanup run.

## Open Risks

- **Wiki sync scheduler contamination** — the wiki sync scheduler runs on a 24-hour recurrence starting 60 seconds after server startup. If it fires after deleting "Test Page", it could re-populate `wiki_pages` with real wiki content (correctly using `voyage-context-3` from `createKnowledgeRuntime`). This would change `total` counts in the audit but would not fail model-correctness checks. Run the proof promptly after cleanup.
- **`wiki_embedding_repair_state` checkpoint references "Test Page" (page_id=100)** from the research repair run. This is safe (status checks use `listRepairCandidates()` dynamically), but operators reading the checkpoint directly will find it confusing. The state row is authoritative evidence for prior repair work and should not be truncated.
- **Intermittent Voyage API failures** — `M027-S04-RETRIEVER` can flip red via `query_embedding_unavailable` even when stored embeddings are healthy. A rerun is sufficient.
- **`scripts/backfill-wiki.ts` model drift risk** — until Bug 2 is fixed, any operator invoking this script against production will write `voyage-code-3` wiki embeddings and break the next audit run.

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| Bun | `sickn33/antigravity-awesome-skills@bun-development` | available — `npx skills add sickn33/antigravity-awesome-skills@bun-development` |
| pgvector / PostgreSQL vector search | `timescale/pg-aiguide@pgvector-semantic-search` | available — `npx skills add timescale/pg-aiguide@pgvector-semantic-search` |
| Embedding systems / RAG | `wshobson/agents@embedding-strategies` | available — `npx skills add wshobson/agents@embedding-strategies` |
| Timeout/debugging investigation | `debug-like-expert` | installed |

## Sources

- Live S04 proof passing: `verify:m027:s04` returns `overallPassed=true`, `status_code=m027_s04_ok`, all four checks green; `M027-S04-WIKI-REPAIR-STATE` shows `page_title=Test Page` because that page was repaired rather than deleted (source: `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json` executed live)
- Current audit passes: `audit:embeddings` returns `status_code=audit_ok` with `wiki_pages total=1, model_mismatch=0, actual_models=["voyage-context-3"]` (source: `bun run audit:embeddings --json`)
- Wiki repair status: `status_code=repair_completed`, `page_id=100`, `page_title=Test Page`, `repaired=1`, `failed=0` (source: `bun run repair:wiki-embeddings -- --status --json`)
- Non-wiki repair status: `status_code=repair_completed`, `corpus=review_comments`, `run.status=not_needed` (source: `bun run repair:embeddings -- --corpus review_comments --status --json`)
- Skip guard bug: `if (!process.env.DATABASE_URL)` at line 57 of `src/knowledge/wiki-store.test.ts`; `beforeEach` truncates `wiki_pages`/`wiki_sync_state` but `afterAll` does not; final test's `replacePageChunks(100, [...])` leaves "Test Page" behind (source: `src/knowledge/wiki-store.test.ts` lines 54–78)
- Reference skip guard pattern: `const TEST_DB_URL = process.env.TEST_DATABASE_URL; describe.skipIf(!TEST_DB_URL)(...)` (source: `src/knowledge/review-comment-store.test.ts` lines 58–60)
- M026 decision establishing the pattern: "M026: pgvector tests use TEST_DATABASE_URL (not DATABASE_URL) for skip guards — DATABASE_URL in .env is always set (prod URL), so checking it would never skip" (source: `.gsd/DECISIONS.md`)
- Model drift in backfill script: `createWikiPageStore({ sql: db.sql, logger })` at line 86 of `scripts/backfill-wiki.ts` without `embeddingModel` parameter (source: `scripts/backfill-wiki.ts` line 86)
- Correct wiki model constant: `DEFAULT_WIKI_EMBEDDING_MODEL = "voyage-context-3"` at line 19 of `src/knowledge/runtime.ts`, used at line 105 for `createWikiPageStore` in the production runtime (source: `src/knowledge/runtime.ts`)
- M027 milestone closure state: STATE.md records `Active Milestone: M028`; M027 closed by passing live S04 proof (source: `.gsd/STATE.md`)
- Contract test suite passing: `bun test ./scripts/verify-m027-s04.test.ts` → 6 pass, 0 fail (source: live test run)
- Other test files with DATABASE_URL: `src/telemetry/store.test.ts`, `src/contributor/profile-store.test.ts`, `src/knowledge/store.test.ts` all use `DATABASE_URL ?? "postgresql://kodiai:..."` fallback (safe — local dev default); `src/knowledge/memory-store.test.ts` and `src/knowledge/issue-store.test.ts` already use `TEST_DATABASE_URL` correctly (source: `rg "DATABASE_URL" src/ --type ts -l` + file inspection)
