---
estimated_steps: 3
estimated_files: 3
---

# T03: Verifier, Test Suite, and package.json Alias

**Slice:** S02 — Deterministic Retrofit & Comment Identity Surface
**Milestone:** M028

## Description

Implement the S02 proof harness — `scripts/verify-m028-s02.ts` with four check IDs (two pure-code, two DB-gated), a 20+ test suite in `scripts/verify-m028-s02.test.ts`, and a `verify:m028:s02` alias in `package.json`. Structural clone of the S01 verifier pattern. The pure-code checks always run; DB checks skip gracefully when DATABASE_URL is absent or DB is unreachable.

## Steps

1. Write `scripts/verify-m028-s02.ts`:

   **Exports and types:**
   ```typescript
   export const M028_S02_CHECK_IDS = [
     "M028-S02-COMMENT-MARKER",
     "M028-S02-UPSERT-CONTRACT",
     "M028-S02-COMMENT-ID-SCHEMA",
     "M028-S02-PUBLISHED-LINKAGE",
   ] as const;
   
   export type M028S02CheckId = typeof M028_S02_CHECK_IDS[number];
   export type M028S02Check = { id: M028S02CheckId; passed: boolean; skipped: boolean; status_code: string; detail: string };
   export type M028S02EvaluationReport = { check_ids: M028S02CheckId[]; overallPassed: boolean; checks: M028S02Check[] };
   ```

   **`M028-S02-COMMENT-MARKER`** (pure-code):
   - Build a test `PageSuggestionGroup` with `pageId: 42`, call `formatPageComment(group, "xbmc", "xbmc")`.
   - Assert `rendered.startsWith("<!-- kodiai:wiki-modification:42 -->")`.
   - Pass with `status_code: "marker_present"` and detail including the first 80 chars.
   - Fail with `status_code: "marker_absent"` and offending first line as detail.

   **`M028-S02-UPSERT-CONTRACT`** (pure-code):
   - Create a minimal mock Octokit with:
     - `issues.listComments` returning `[{ id: 5001, body: "<!-- kodiai:wiki-modification:99 --> ..." }]` for the update path
     - `issues.updateComment` returning `{ data: { id: 5001 } }` (spy)
     - `issues.createComment` returning `{ data: { id: 9999 } }` (spy, never called for update path)
   - Call `upsertWikiPageComment(mockOctokit, "xbmc", "xbmc", 100, 99, "body", mockLogger)`.
   - Assert: return is `{ commentId: 5001, action: 'updated' }`; `updateComment` called once; `createComment` not called.
   - Repeat with `listComments` returning `[]`:
   - Assert: return is `{ commentId: 9999, action: 'created' }`; `createComment` called once; `updateComment` not called.
   - Pass if both assertions hold; fail with detail naming which assertion failed.

   **`M028-S02-COMMENT-ID-SCHEMA`** (DB-gated):
   - Query: `SELECT column_name FROM information_schema.columns WHERE table_name = 'wiki_update_suggestions' AND column_name = 'published_comment_id'`
   - Pass with `status_code: "schema_ok"` if row returned.
   - Fail with `status_code: "column_missing"` if no row (DB reachable but column absent).
   - Skip with `status_code: "db_unavailable"` on connection error or missing DATABASE_URL.

   **`M028-S02-PUBLISHED-LINKAGE`** (DB-gated):
   - Query: `SELECT COUNT(*)::int as gap FROM wiki_update_suggestions WHERE published_at IS NOT NULL AND published_comment_id IS NULL`
   - If `gap === 0`: pass with `status_code: "no_linkage_gap"`.
   - If `gap > 0`: fail with `status_code: "linkage_gap_found"`, detail `${gap} published rows missing published_comment_id`.
   - On zero published rows total (query returns 0): pass with `status_code: "no_published_rows"`.
   - Skip with `status_code: "db_unavailable"` on connection error.

   **`evaluateM028S02(sql?: unknown)`**: Run all four checks; `overallPassed = !checks.some(c => !c.passed && !c.skipped)`.

   **`buildM028S02ProofHarness()`**: Call `evaluateM028S02` after attempting DB connection via `createDbClient`. Try/catch around DB connect; on failure set `sql = undefined` for DB-gated checks. Print JSON or human-readable output.

   **CLI runner** (`if (import.meta.main)`): Parse `--json`, call `buildM028S02ProofHarness()`, exit 0 on `overallPassed`, exit 1 otherwise.

2. Write `scripts/verify-m028-s02.test.ts` with 20+ tests:

   Group: **Check ID contract**
   - `M028_S02_CHECK_IDS` has exactly 4 entries
   - Contains all four expected check ID strings

   Group: **Envelope shape**
   - `evaluateM028S02()` result has `check_ids`, `overallPassed`, `checks` fields
   - `checks` array has length 4

   Group: **COMMENT-MARKER**
   - Passes when `formatPageComment` output starts with `<!-- kodiai:wiki-modification:42 -->`
   - Reports `status_code: "marker_present"` on pass
   - Would fail with `status_code: "marker_absent"` if marker absent (test by asserting shape when the check logic encounters a non-marker prefix — can test by mocking or by building the check function directly)

   Group: **UPSERT-CONTRACT**
   - Update path: mock with matching comment → result has `action: 'updated'`, `updateComment` called
   - Create path: mock with empty list → result has `action: 'created'`, `createComment` called
   - Check passes when both paths behave correctly
   - Reports `status_code: "upsert_contract_ok"` on pass

   Group: **DB-gated checks — no DB available**
   - `COMMENT-ID-SCHEMA` skips with `status_code: "db_unavailable"` when sql is undefined
   - `PUBLISHED-LINKAGE` skips with `status_code: "db_unavailable"` when sql is undefined

   Group: **overallPassed semantics**
   - `overallPassed` is true when all checks pass or are skipped
   - `overallPassed` is false when any non-skipped check fails

   Group: **All check IDs present even when DB skipped**
   - Result always has 4 checks regardless of DB availability
   - Each check has id from `M028_S02_CHECK_IDS`

3. Add to `package.json` scripts object:
   ```json
   "verify:m028:s02": "bun scripts/verify-m028-s02.ts"
   ```

## Must-Haves

- [ ] `scripts/verify-m028-s02.ts` exports `M028_S02_CHECK_IDS`, `evaluateM028S02`, `buildM028S02ProofHarness`
- [ ] Four check IDs with exact names: `M028-S02-COMMENT-MARKER`, `M028-S02-UPSERT-CONTRACT`, `M028-S02-COMMENT-ID-SCHEMA`, `M028-S02-PUBLISHED-LINKAGE`
- [ ] Pure-code checks always run and always pass in this environment (marker is in formatPageComment, upsert contract implemented in T01)
- [ ] DB-gated checks skip gracefully with `db_unavailable` when DATABASE_URL is absent
- [ ] `bun run verify:m028:s02 --json` exits 0 with `overallPassed: true`
- [ ] `scripts/verify-m028-s02.test.ts` has 20+ passing tests
- [ ] TypeScript clean on verifier files

## Verification

- `bun test ./scripts/verify-m028-s02.test.ts` — 20+ pass, 0 fail
- `bun run verify:m028:s02 --json` — exits 0, `overallPassed: true`, all checks have `id` and `status_code`
- `bunx tsc --noEmit 2>&1 | grep verify-m028-s02` → no output

## Inputs

- T01 output: `formatPageComment` with marker, `upsertWikiPageComment` exported from `wiki-publisher.ts`
- `scripts/verify-m028-s01.ts` — structural template to clone (check ID pattern, DB-gated skip, CLI runner, `overallPassed` logic)
- `scripts/verify-m028-s01.test.ts` — test structure to mirror (20 tests covering check IDs, envelope, pure-code pass/fail, DB-gated skip)
- `src/db/client.ts` — `createDbClient` for DB connect in harness
- `package.json` — add `verify:m028:s02` script alias

## Expected Output

- `scripts/verify-m028-s02.ts` — new proof harness with 4 check IDs, exported evaluator and harness
- `scripts/verify-m028-s02.test.ts` — new: 20+ tests
- `package.json` — `verify:m028:s02` alias added
