# M027 / S04: Final Integrated Production Repair Proof — Research

**Date:** 2026-03-13

## Summary

S04 is the milestone-closing composition slice. All four slice execution artifacts exist and were previously marked complete — `scripts/verify-m027-s04.ts` (459 lines, 6/6 contract tests pass), the package alias, and the runbook section in `docs/operations/embedding-integrity.md`. **However, there are two bugs that caused and can still cause production database contamination, plus a cleanup action needed before the final artifacts are stable.**

**Current live state (after research repair run):** `verify:m027:s04` currently passes (`m027_s04_ok`, all four checks green). This is because running `repair:wiki-embeddings -- --json` (without `--page-title`) repaired "Test Page" (page_id=100, `voyage-code-3` → `voyage-context-3`). But this is the wrong fix — "Test Page" is a test artifact, not real wiki content, and should not exist in the production database at all.

**Root cause 1 (must fix): `wiki-store.test.ts` uses `DATABASE_URL` for its skip guard.** In this environment `DATABASE_URL` is always set to the Azure PostgreSQL connection string (`.env` always has the production URL). So the test suite connects to production, `beforeEach` truncates `wiki_pages`/`wiki_sync_state`, but there is no `afterAll` truncate — the final test leaves "Test Page" (page_id=100, mock embedding, `voyage-code-3`) in production. This caused the S04 proof to fail after S04 tasks were originally marked complete. The established M026 pattern uses `TEST_DATABASE_URL` — copy it.

**Root cause 2 (should fix): `scripts/backfill-wiki.ts` creates `wikiPageStore` without `embeddingModel`.** When no `embeddingModel` is passed to `createWikiPageStore`, it defaults to `"voyage-code-3"` for any chunk with an embedding. If this script is ever run against production, all wiki pages it ingests will carry the wrong model and the audit will fail again. This is the exact model-drift hotspot identified in M027-RESEARCH.md.

**Immediate blocker cleared:** The repair (which I ran during research) gave "Test Page" a real `voyage-context-3` embedding, so the audit passes and `verify:m027:s04` passes. But "Test Page" is still fake content in production. The execution task should delete it, fix both bugs, re-run the proof, and re-close the milestone artifacts cleanly.

## Recommendation

1. **Fix `wiki-store.test.ts` skip guard first** — change line 57 from `process.env.DATABASE_URL` to `process.env.TEST_DATABASE_URL` and convert the inner `beforeAll` guard to the `describe.skipIf(!TEST_DB_URL)` pattern used by `review-comment-store.test.ts` (line 58–60). This is the root cause fix that prevents future contamination.

2. **Hard-delete "Test Page" from production `wiki_pages`** — `DELETE FROM wiki_pages WHERE page_id = 100`. This row is a test fixture ("Test Page > Introduction: This is the introduction section.") with a mock embedding that was repaired to `voyage-context-3` during this research session. It is not real wiki content. After deletion:
   - `audit:embeddings` will report `wiki_pages total=0, model_mismatch=0, status=pass` ✅
   - `repair:wiki-embeddings --status --json` will find `remaining.length=0`, returning `status=completed`, `status_code=repair_completed` ✅

3. **Fix `scripts/backfill-wiki.ts` to pass `embeddingModel: "voyage-context-3"`** — the wiki page store is created at line 86 without this parameter. Add it to prevent any future operator-triggered backfill from writing `voyage-code-3` embeddings for wiki pages. Use `import { DEFAULT_WIKI_EMBEDDING_MODEL } from "../src/knowledge/runtime.ts"` or inline the string.

4. **Re-run `verify:m027:s04`** after the cleanup to capture fresh clean proof output with `wiki_pages total=0` in the audit and `page_title=null` in the wiki repair state (or whatever stable page remains).

5. **Update closure artifacts** — rewrite S04-SUMMARY.md with the actual final proof output, and update `.gsd/REQUIREMENTS.md`, M027-ROADMAP.md, PROJECT.md, and STATE.md to reflect the true closure state.

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| Final integrated milestone proof | `scripts/verify-m027-s04.ts` | Already correct — composes S01/S02/S03 proof functions, stable check IDs, preserves nested raw evidence. The harness is not broken. |
| Test-DB skip guard pattern | `TEST_DATABASE_URL` guard in `src/knowledge/review-comment-store.test.ts` (lines 58–60) | The established M026 pattern — `const TEST_DB_URL = process.env.TEST_DATABASE_URL; describe.skipIf(!TEST_DB_URL)(...)`. Use this verbatim. |
| Test page deletion | Direct SQL `DELETE FROM wiki_pages WHERE page_id = 100` via a bun script | Simplest safe fix. `softDelete` would leave the row and the audit query excludes `deleted = true` — so soft-delete would work for the audit, but hard-delete is cleaner for a test artifact. |
| Wiki model constant | `DEFAULT_WIKI_EMBEDDING_MODEL = "voyage-context-3"` from `src/knowledge/runtime.ts` | Already exported. Import it in `scripts/backfill-wiki.ts` instead of hardcoding the string. |
| Post-fix verification | `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json` | The canonical final acceptance command. Passes now, must still pass after cleanup. |

## Existing Code and Patterns

- `scripts/verify-m027-s04.ts` — 459 lines; composes `runM027S01ProofHarness`, `runM027S02ProofHarness`, `runM027S03ProofHarness` via injectable deps; evaluates `M027-S04-FULL-AUDIT`, `M027-S04-RETRIEVER`, `M027-S04-WIKI-REPAIR-STATE`, `M027-S04-NON-WIKI-REPAIR-STATE` from raw evidence fields; exits 1 with `verify:m027:s04 failed: <check-id>:<status-code>` on failure; preserves nested `s01`/`s02`/`s03` payloads under `--json`. **No changes needed.**
- `scripts/verify-m027-s04.test.ts` — 6 tests, all pass; correctly models idempotent healthy reruns, retriever failure cases, wiki/non-wiki resume-needed failures, and `issue_comments:not_in_retriever` scope-truthfulness enforcement.
- `src/knowledge/wiki-store.test.ts` — **buggy skip guard**: uses `process.env.DATABASE_URL` (line 57) instead of `process.env.TEST_DATABASE_URL`; has `beforeEach` truncating `wiki_pages`/`wiki_sync_state` but no `afterAll` truncate — final test leaves "Test Page" (page_id=100) in production. **Needs skip guard fix.**
- `src/knowledge/review-comment-store.test.ts` (lines 58–60) — reference pattern for pgvector test skip guards: `const TEST_DB_URL = process.env.TEST_DATABASE_URL; describe.skipIf(!TEST_DB_URL)(...)`.
- `scripts/backfill-wiki.ts` (line 86) — creates `wikiPageStore` without `embeddingModel`, defaulting writes to `voyage-code-3`. **Needs `embeddingModel: DEFAULT_WIKI_EMBEDDING_MODEL` added.**
- `src/knowledge/runtime.ts` (line 19) — exports `DEFAULT_WIKI_EMBEDDING_MODEL = "voyage-context-3"` and uses it consistently at line 105 for `createWikiPageStore`. This is the pattern `scripts/backfill-wiki.ts` should follow.
- `scripts/wiki-embedding-repair.ts` `executeStatus()` function (lines ~264–265) — status logic: `const hasRemaining = remaining.length > 0; const status = hasRemaining || lastFailureClass ? "resume_required" : "completed"`. After "Test Page" is deleted, `remaining.length = 0` and `lastFailureClass = null` → `status = "completed"` → `status_code = "repair_completed"` ✅.
- `src/knowledge/embedding-audit.ts` — audit queries `wiki_pages WHERE deleted = false`; after deletion, `total=0, model_mismatch=0, status=pass` (empty is a pass, not a failure).
- `src/db/migrations/028-wiki-embedding-repair-state.sql` — `wiki_embedding_repair_state` checkpoint records repair history. After "Test Page" cleanup, the checkpoint may reference page_id=100 ("Test Page") from the repair run. Do not truncate this table — the checkpoint is the durable repair evidence. The status check uses `listRepairCandidates()` dynamically; a stale checkpoint referencing a deleted page does not re-introduce repair candidates.

## Constraints

- `M027-S04-FULL-AUDIT` requires a milestone-wide six-corpus `audit_ok`; slice-local audit views from S02/S03 are insufficient. Any non-zero `model_mismatch` in any corpus fails this check.
- `M027-S04-WIKI-REPAIR-STATE` checks both the repair probe (`["repair_completed", "repair_not_needed"]`) AND the durable status row (`repair_completed`, `failed=0`, no `last_failure_class`). Both must pass.
- `issue_comments` must remain under `not_in_retriever`; the S04 harness fails with `retriever_scope_mismatch` if this boundary disappears.
- `DATABASE_URL` is always set to the Azure PostgreSQL URL in `.env`; test files using it as a skip guard will always run against production. Only `TEST_DATABASE_URL` is safe for that pattern.
- Do not truncate `wiki_embedding_repair_state` — it holds the durable repair evidence for prior bounded wiki repairs.
- `scripts/backfill-wiki.ts` is an operator tool; fix it in place rather than wrapping it. The fix is additive (one parameter) and does not break existing usage.

## Common Pitfalls

- **Using `repair:wiki-embeddings` to fix test artifacts instead of deleting them** — repairing "Test Page" embeds fake wiki content with `voyage-context-3` and persists it as real production knowledge. The research repair run already did this. The correct follow-up is to delete the row.
- **Soft-deleting "Test Page" instead of hard-deleting** — `store.softDeletePage(100)` marks `deleted=true`; the audit excludes deleted rows; the proof would pass. But the row stays as clutter. Hard-delete is cleaner for a test fixture.
- **Forgetting to fix the skip guard after deleting the row** — deleting fixes the current production state but doesn't prevent the next test run from re-inserting it. Fix `wiki-store.test.ts` first, so the test never runs against production again.
- **Treating `wiki_pages total=0` as a degraded state** — after deletion, `total=0, model_mismatch=0` maps to `status=pass`. The audit handles the empty case correctly.
- **Adding a final `afterAll(TRUNCATE)` to `wiki-store.test.ts` instead of fixing the skip guard** — that would prevent contamination but still runs the test against production, which is wrong. Use `TEST_DATABASE_URL` skip guard so the test only runs against a real test database.
- **Forgetting `page_title=Test Page` in the S04 check output** — after the research repair run, the `M027-S04-WIKI-REPAIR-STATE` check currently shows `page_title=Test Page`. After deletion and a fresh repair-status run, this will change. The check passes regardless of page_title value.
- **Not updating S04-SUMMARY.md after the final proof run** — the existing summary was written before the contamination regression. Re-run the proof and record its actual passing output in the summary so future agents inherit accurate evidence.

## Open Risks

- **Wiki sync scheduler contamination** — the wiki sync scheduler runs on a 24-hour recurrence starting 60 seconds after server startup. If it fires during cleanup or after, it could re-populate `wiki_pages` with real content (using the correct `voyage-context-3` from `createKnowledgeRuntime`). This would be fine for the audit but changes the `total` count. Run the proof promptly after cleanup.
- **Other test files with the same `DATABASE_URL` skip guard pattern** — worth a targeted check with `rg "DATABASE_URL" src/ --include="*.test.ts"` to find any other tests that might contaminate production.
- **`scripts/backfill-wiki.ts` is an operator-facing tool** — after fixing the default model, any future invocation will correctly write `voyage-context-3` embeddings. The fix does not affect current behavior (the model fix only applies when embeddings are generated).
- **Intermittent Voyage API failures** — `M027-S04-RETRIEVER` can flip red through `query_embedding_unavailable` even when stored embeddings are healthy. A rerun is sufficient in that case.
- **`wiki_embedding_repair_state` checkpoint now references "Test Page" (page_id=100)** — from the research repair run. This is safe (the status check uses `listRepairCandidates()` dynamically), but operators reading the checkpoint directly may find it confusing. The runbook note about "JSON-RPC API/v8" as the representative wiki repair target should be updated to reflect the current checkpoint state.

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| Bun | `sickn33/antigravity-awesome-skills@bun-development` | available — `npx skills add sickn33/antigravity-awesome-skills@bun-development` |
| pgvector / PostgreSQL vector search | `timescale/pg-aiguide@pgvector-semantic-search` | available — `npx skills add timescale/pg-aiguide@pgvector-semantic-search` |
| Embedding systems / RAG | `wshobson/agents@embedding-strategies` | available — `npx skills add wshobson/agents@embedding-strategies` |
| Timeout/debugging investigation | `debug-like-expert` | installed |

## Sources

- Live S04 proof passing after research repair run: `verify:m027:s04` returns `overallPassed=true`, `status_code=m027_s04_ok`, all four checks green; `M027-S04-WIKI-REPAIR-STATE` shows `page_title=Test Page` because that page was repaired rather than deleted (source: `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments` executed live)
- Pre-repair audit failure: `wiki_pages total=1, model_mismatch=1, actual_models=["voyage-code-3"], status=fail` (source: `bun run audit:embeddings --json` before running repair)
- Pre-repair wiki repair status: `status_code=repair_resume_available`, `run.status=resume_required`, `page_id=13137`, `page_title=JSON-RPC API/v8`, `repaired=388`, `failed=0` — old S02 checkpoint, but "Test Page" was a live repair candidate via `listRepairCandidates()` (source: `bun run repair:wiki-embeddings -- --status --json`)
- Research repair run: `bun run repair:wiki-embeddings -- --json` repaired "Test Page" (`repaired=1`); `repair:wiki-embeddings -- --status --json` then returned `status_code=repair_completed`, `page_title=Test Page`, `page_id=100` (source: live commands during research)
- Skip guard bug in wiki-store test: `if (!process.env.DATABASE_URL)` at line 57 of `src/knowledge/wiki-store.test.ts`; `beforeEach` truncates `wiki_pages`/`wiki_sync_state` but `afterAll` does not; final test's `replacePageChunks(100, [...])` leaves "Test Page" behind (source: `src/knowledge/wiki-store.test.ts` lines 54–75 and tail-20)
- Reference skip guard pattern: `const TEST_DB_URL = process.env.TEST_DATABASE_URL; describe.skipIf(!TEST_DB_URL)(...)` (source: `src/knowledge/review-comment-store.test.ts` lines 58–60)
- M026 decision establishing the pattern: "M026: pgvector tests use TEST_DATABASE_URL (not DATABASE_URL) for skip guards — DATABASE_URL in .env is always set (prod URL), so checking it would never skip" (source: `.gsd/DECISIONS.md`)
- Model drift in backfill script: `createWikiPageStore({ sql: db.sql, logger })` at line 86 of `scripts/backfill-wiki.ts` defaults writes to `voyage-code-3` (source: `scripts/backfill-wiki.ts` with `grep createWikiPageStore`)
- Correct wiki model constant: `DEFAULT_WIKI_EMBEDDING_MODEL = "voyage-context-3"` exported from `src/knowledge/runtime.ts` line 19, used at line 105 for `createWikiPageStore` in production runtime (source: `src/knowledge/runtime.ts`)
- Contract test suite still passing: 6/6 pass (source: `bun test ./scripts/verify-m027-s04.test.ts`)
- Status logic in `scripts/wiki-embedding-repair.ts` (~lines 264–265): `const hasRemaining = remaining.length > 0; const status = hasRemaining || lastFailureClass ? "resume_required" : "completed"` — after deletion, `remaining.length = 0` → `status = "completed"` (source: `scripts/wiki-embedding-repair.ts`)
