---
id: T02
parent: S04
milestone: M028
provides:
  - scripts/verify-m028-s04.ts with 5-check proof harness (NO-WHY-IN-RENDER, NO-WHY-IN-SUMMARY, LIVE-PUBLISHED, SENTINEL-SUPERSEDED, DRY-RUN-CLEAN)
  - SENTINEL-SUPERSEDED as a real gate (not informational) — blocks overallPassed when any sentinel rows remain
  - All 21 sentinel rows re-published via live upsert path; published_comment_id > 0 for all
  - bun run verify:m028:s04 --json → overallPassed=true, all 5 checks pass
  - Full regression sweep: verify:m028:s02, s03, s04 all exit 0
key_files:
  - scripts/verify-m028-s04.ts
  - scripts/verify-m028-s04.test.ts
  - package.json
key_decisions:
  - Reused checkNoWhyInRender from verify-m028-s03.ts for NO-WHY-IN-RENDER check (import, not inline) — avoids duplication while keeping the S04 check as a proxy that delegates to S03 export
  - DRY-RUN-CLEAN uses a different mock (pageId=42) than NO-WHY-IN-RENDER (pageId=1) to test the same formatPageComment from a distinct call site with distinct arguments
  - SENTINEL-SUPERSEDED skips (not fails) when DB is unavailable, to avoid making the harness non-runnable in DB-less environments; but it IS in the overallPassed gate when non-skipped
patterns_established:
  - Bare :warning: in JSDoc comments causes Bun parser to error ("Unexpected :") — sanitize JSDoc to use plain text descriptions instead of emoji/colon-notation
  - buildM028S04ProofHarness auto-probes DATABASE_URL when sql=undefined; tests that want to exercise the skip path must pass a rejecting sql stub, not undefined
  - Sequential SQL stub pattern (makeSequentialSqlStub) needed when two DB-gated checks run in parallel — each call index maps to a different response
observability_surfaces:
  - "bun run verify:m028:s04 --json 2>&1 | jq '.checks[] | select(.passed == false)' — shows failing check ids, status_codes, and detail strings"
  - "SENTINEL-SUPERSEDED detail field: sentinel_rows=N (need 0; run re-publish to supersede) — count visible on failure"
  - "LIVE-PUBLISHED detail field: count=N — visible on pass and fail"
  - "SELECT page_id, published_comment_id, published_issue_number FROM wiki_update_suggestions WHERE published_at IS NOT NULL ORDER BY published_at DESC LIMIT 30 — confirms sentinel rows acquired real IDs"
duration: ~60m
verification_result: passed
completed_at: 2026-03-16
blocker_discovered: false
---

# T02: Write S04 Proof Harness, Publish Sentinel Rows, Run Regression Sweep

**Wrote the 5-check M028/S04 proof harness, re-published all 21 legacy sentinel rows via live upsert (acquiring real GitHub comment IDs), and confirmed overallPassed=true with all 5 checks passing plus full S02/S03/S04 regression sweep exit 0.**

## What Happened

Wrote `scripts/verify-m028-s04.ts` following the S03 structural template exactly. The harness exports `M028_S04_CHECK_IDS` (5-entry const), `M028S04CheckId`, `M028S04Check`, `M028S04EvaluationReport`, `evaluateM028S04`, and `buildM028S04ProofHarness`. The 5 checks:

1. **NO-WHY-IN-RENDER** — delegates to `checkNoWhyInRender` from `./verify-m028-s03.ts` (imported, not inlined).
2. **NO-WHY-IN-SUMMARY** — calls `formatSummaryTable` with mock data, asserts no `**Why:**`, `:warning:`, or `Wiki Update Suggestions`.
3. **LIVE-PUBLISHED** — DB-gated, `COUNT(*) WHERE published_comment_id > 0`, pass threshold ≥ 80.
4. **SENTINEL-SUPERSEDED** — DB-gated, `COUNT(*) WHERE published_comment_id = 0 AND published_at IS NOT NULL`, pass when count = 0. **Real gate** — included in `overallPassed` computation.
5. **DRY-RUN-CLEAN** — calls `formatPageComment` directly with a different mock group than check 1, asserts no `**Why:**` or `:warning:`.

`overallPassed` = `checks.filter(c => !c.skipped).every(c => c.passed)` — no informational exclusions.

Wrote `scripts/verify-m028-s04.test.ts` with 48 tests covering all check IDs, envelope shape, pure-code pass/fail paths, DB-gated skip/pass/fail, `overallPassed` semantics (explicit test that SENTINEL-SUPERSEDED is NOT excluded), and `buildM028S04ProofHarness` output format.

Added `"verify:m028:s04": "bun scripts/verify-m028-s04.ts"` to `package.json`.

**Baseline run** (`bun run verify:m028:s04 --json`) confirmed: LIVE-PUBLISHED=pass (count=80), SENTINEL-SUPERSEDED=fail (count=21) — expected pre-publish state.

**Sentinel re-publish:**
1. Reset 21 sentinel rows via bun inline script: `UPDATE wiki_update_suggestions SET published_at = NULL WHERE published_comment_id = 0 AND published_at IS NOT NULL` → 21 rows updated.
2. Ran `bun scripts/publish-wiki-updates.ts --issue-number 5` → 10 pages posted to issue #5 (the 21 sentinel rows mapped to 10 unique pages with grounded content; 11 of the 21 were covered by those same pages). All 21 sentinel rows acquired real comment IDs via upsert.

**Post-publish verification:** `bun run verify:m028:s04 --json` → `overallPassed: true`, LIVE-PUBLISHED=pass (count=104), SENTINEL-SUPERSEDED=pass (sentinel_rows=0).

## Verification

```
bun test ./scripts/verify-m028-s04.test.ts
→ 48 pass, 0 fail

bun run verify:m028:s04 --json
→ overallPassed: true, all 5 checks pass

bun run verify:m028:s02 --json && bun run verify:m028:s03 --json && bun run verify:m028:s04 --json
→ all three exit 0 with overallPassed: true

bunx tsc --noEmit 2>&1 | grep -E 'wiki-publisher|verify-m028-s04'
→ (no output — no errors in these files)
```

## Diagnostics

- `bun run verify:m028:s04 --json 2>&1 | jq '.checks[] | select(.passed == false)'` — structured failure detail per check
- SENTINEL-SUPERSEDED failure detail: `sentinel_rows=N (need 0; run re-publish to supersede)` — count immediately visible
- LIVE-PUBLISHED failure detail: `count=N (need >= 80)` — count immediately visible  
- DB query to confirm sentinel status: `SELECT page_id, published_comment_id FROM wiki_update_suggestions WHERE published_at IS NOT NULL ORDER BY published_at DESC LIMIT 30`

## Deviations

- **Test count: 48 not 30+** — plan said "~30 tests"; actual count is 48 because full boundary coverage, order assertions, and `buildM028S04ProofHarness` output format tests were added. All required paths covered plus extra.
- **Publish posted 10 pages, not 21** — the 21 sentinel rows were associated with 10 unique pages (multiple sentinel rows per page). All 21 rows acquired real comment IDs via the upsert path; SENTINEL-SUPERSEDED passes with count=0.
- **Two JSDoc comment lines caused Bun parse errors** — bare `:warning:` in `/** ... */` block comments triggers "Unexpected :" in Bun's parser. Fixed by replacing emoji/colon notation with plain text descriptions.
- **buildM028S04ProofHarness test needed sql stub not undefined** — the harness auto-probes `DATABASE_URL` from env when `sql=undefined`; the test that exercises the "DB checks skip" path needed a rejecting sql stub instead of `undefined`.

## Known Issues

None — all must-haves verified.

## Files Created/Modified

- `scripts/verify-m028-s04.ts` — new: 5-check proof harness, full exports, CLI runner
- `scripts/verify-m028-s04.test.ts` — new: 48-test suite covering all check paths and overallPassed semantics
- `package.json` — added `verify:m028:s04` alias
- `.gsd/milestones/M028/slices/S04/S04-PLAN.md` — marked T02 done; added failure-path diagnostic check to Verification section
