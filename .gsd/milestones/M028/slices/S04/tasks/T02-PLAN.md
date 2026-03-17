---
estimated_steps: 9
estimated_files: 3
---

# T02: Write S04 Proof Harness, Publish Sentinel Rows, Run Regression Sweep

**Slice:** S04 — Final Integrated Publication & Retrofit Proof
**Milestone:** M028

## Description

This task closes the milestone by (1) writing the 5-check proof harness `scripts/verify-m028-s04.ts`, (2) running it to establish a pre-publish baseline, (3) performing the operational sentinel re-publish to supersede the 21 legacy `published_comment_id=0` rows on xbmc/wiki issue #5, and (4) confirming `overallPassed: true` across all 5 checks plus a full regression sweep of S02/S03/S04 verifiers.

**Key constraint:** The publisher `publish()` loop queries `WHERE published_at IS NULL`. The 21 sentinel rows have `published_at IS NOT NULL` (published before identity tracking, then backfilled with `published_comment_id=0` in S02). To make them eligible for re-publish, their `published_at` must be reset to NULL before the publish run. The upsert path then scans issue #5 for the identity marker, finds or creates the comment, writes the real GitHub comment ID to `published_comment_id`, and re-marks `published_at`.

After the re-publish, `SENTINEL-SUPERSEDED` (which counts rows where `published_comment_id = 0 AND published_at IS NOT NULL`) should return count = 0 and pass.

**`SENTINEL-SUPERSEDED` is a real gate** — unlike S03's `SENTINEL-CLEARED` (which was informational), this check blocks `overallPassed` when it fails. The milestone is only complete when all 21 sentinel rows have real comment IDs.

## Steps

1. Write `scripts/verify-m028-s04.ts` — follow `scripts/verify-m028-s03.ts` exactly as the structural template (exports, check types, CLI runner pattern). Implement these exports:
   - `M028_S04_CHECK_IDS` — `readonly string[]` constant with 5 check IDs in order:
     `"M028-S04-NO-WHY-IN-RENDER"`, `"M028-S04-NO-WHY-IN-SUMMARY"`, `"M028-S04-LIVE-PUBLISHED"`, `"M028-S04-SENTINEL-SUPERSEDED"`, `"M028-S04-DRY-RUN-CLEAN"`
   - `M028S04CheckId`, `M028S04Check`, `M028S04EvaluationReport` — mirror S03 type shapes exactly
   - `evaluateM028S04(opts?: { sql?: ..., _formatFn?: ..., _summaryFn?: ... }): Promise<M028S04EvaluationReport>` — runs all 5 checks
   - `buildM028S04ProofHarness(opts?: { json?: boolean }): Promise<{ exitCode: number }>` — CLI runner

2. Implement the 5 checks inside `evaluateM028S04`:
   - `M028-S04-NO-WHY-IN-RENDER` (pure-code): import `checkNoWhyInRender` from `./verify-m028-s03.ts` and call it. If the import creates a coupling concern, inline the 6-line implementation. Pass: no `"**Why:**"` or `":warning:"` in `formatPageComment` output. Status codes: `no_why_in_render` (pass), `why_found` (fail).
   - `M028-S04-NO-WHY-IN-SUMMARY` (pure-code): call `formatSummaryTable` from `../src/knowledge/wiki-publisher.ts` with a minimal mock (`date="2026-01-01"`, empty results array, count=0). Assert result has no `"**Why:**"`, `":warning:"`, or `"Wiki Update Suggestions"`. Status codes: `no_why_in_summary` (pass), `why_found_in_summary` (fail).
   - `M028-S04-LIVE-PUBLISHED` (DB-gated): `SELECT COUNT(*) FROM wiki_update_suggestions WHERE published_comment_id > 0`. Skip with `db_unavailable` when DB absent/unreachable. Pass when count >= 80. Status codes: `live_published` (pass), `insufficient_published` (fail, includes count in detail).
   - `M028-S04-SENTINEL-SUPERSEDED` (DB-gated): `SELECT COUNT(*) FROM wiki_update_suggestions WHERE published_comment_id = 0 AND published_at IS NOT NULL`. Skip with `db_unavailable`. Pass when count = 0. Status codes: `sentinel_superseded` (pass), `sentinel_rows_remain` (fail, includes count in detail). **This is NOT informational — include it in the `overallPassed` gate.**
   - `M028-S04-DRY-RUN-CLEAN` (pure-code): call `formatPageComment` from `../src/knowledge/wiki-publisher.ts` directly with a mock `PageSuggestionGroup`. Assert the full output has no `"**Why:**"` or `":warning:"`. This is independent of `NO-WHY-IN-RENDER` (different entry point verification, tests from the top of the call stack). Status codes: `dry_run_clean` (pass), `why_found_in_dry_run` (fail).

3. `overallPassed` logic: `checks.filter(c => !c.skipped).every(c => c.passed)` — no informational exclusions. All non-skipped checks gate the result.

4. Write `scripts/verify-m028-s04.test.ts` — ~30 tests covering:
   - Check IDs: `M028_S04_CHECK_IDS` has exactly 5 entries; each expected ID is present
   - Envelope shape: `evaluateM028S04()` result has `check_ids`, `overallPassed`, `checks` with 5 entries, each with `id`, `passed`, `skipped`, `status_code`
   - Pure-code NO-WHY-IN-RENDER: passes with real `formatPageComment`; fails when `_formatFn` returns `"**Why:** reason"`
   - Pure-code NO-WHY-IN-SUMMARY: passes with fixed `formatSummaryTable`; fails when `_summaryFn` returns `"Wiki Update Suggestions"`
   - Pure-code DRY-RUN-CLEAN: passes with real `formatPageComment`; fails when mock returns `":warning: voice"`
   - DB-gated LIVE-PUBLISHED: skip when no sql; pass when count=85; fail when count=2
   - DB-gated SENTINEL-SUPERSEDED: skip when no sql; pass when count=0; fail when count=21
   - `overallPassed` true when all 5 pass; false when SENTINEL-SUPERSEDED fails (not excluded unlike S03's SENTINEL-CLEARED)
   - `buildM028S04ProofHarness` returns `exitCode: 0` when all pass; `exitCode: 1` when any fail
   - Follow the sequential SQL stub pattern from `verify-m028-s03.test.ts` for multi-check DB sequences

5. Add `"verify:m028:s04": "bun scripts/verify-m028-s04.ts"` to `package.json` scripts section.

6. Run baseline verification:
   ```bash
   bun test ./scripts/verify-m028-s04.test.ts
   # → 30+ pass, 0 fail
   
   bun run verify:m028:s04 --json
   # Expected: LIVE-PUBLISHED=pass, SENTINEL-SUPERSEDED=fail(count=21)
   ```

7. Perform the sentinel re-publish:
   ```bash
   # Step 1: Reset published_at for sentinel rows
   psql $DATABASE_URL -c "UPDATE wiki_update_suggestions SET published_at = NULL WHERE published_comment_id = 0 AND published_at IS NOT NULL"
   # Should update 21 rows
   
   # Step 2: Publish all now-unpublished grounded rows to issue #5
   bun scripts/publish-wiki-updates.ts --issue-number 5
   # → publishes the 21 reset sentinel rows + any other unpublished grounded rows
   # → upsert path finds or creates comments on issue #5 with identity markers
   # → writes real published_comment_id values (> 0) back to DB
   ```
   
   If `DATABASE_URL` isn't available in the current shell, check `.env` or environment config. The publish script requires database access and GitHub App credentials (`GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_APP_INSTALLATION_ID` or similar) — these should already be present from S03's live run.

8. Run verifier after publish to confirm `SENTINEL-SUPERSEDED` passes:
   ```bash
   bun run verify:m028:s04 --json
   # Expected: overallPassed=true, all 5 checks pass
   # SENTINEL-SUPERSEDED: passed=true, status_code="sentinel_superseded"
   ```

9. Run full regression sweep:
   ```bash
   bun run verify:m028:s02 --json && bun run verify:m028:s03 --json && bun run verify:m028:s04 --json
   # → all three exit 0 with overallPassed=true
   
   bunx tsc --noEmit 2>&1 | grep -E 'wiki-publisher|verify-m028-s04'
   # → (no output)
   ```

## Must-Haves

- [ ] `scripts/verify-m028-s04.ts` exports: `M028_S04_CHECK_IDS`, `evaluateM028S04`, `buildM028S04ProofHarness`, matching type shapes
- [ ] All 5 checks implemented with correct pure-code vs DB-gated routing
- [ ] `SENTINEL-SUPERSEDED` is a real gate — included in `overallPassed` computation
- [ ] `scripts/verify-m028-s04.test.ts` has 30+ tests covering all check paths
- [ ] `verify:m028:s04` alias in `package.json`
- [ ] `bun test ./scripts/verify-m028-s04.test.ts` → 0 failures
- [ ] All 21 sentinel rows re-published via upsert path; `published_comment_id > 0` for all
- [ ] `bun run verify:m028:s04 --json` → `overallPassed: true`, all 5 checks passing
- [ ] `bun run verify:m028:s02 --json && bun run verify:m028:s03 --json && bun run verify:m028:s04 --json` → all exit 0

## Verification

```bash
bun test ./scripts/verify-m028-s04.test.ts
# → 30+ pass, 0 fail

bun run verify:m028:s04 --json
# → { overallPassed: true, checks: [
#     { id: "M028-S04-NO-WHY-IN-RENDER", passed: true },
#     { id: "M028-S04-NO-WHY-IN-SUMMARY", passed: true },
#     { id: "M028-S04-LIVE-PUBLISHED", passed: true },
#     { id: "M028-S04-SENTINEL-SUPERSEDED", passed: true },
#     { id: "M028-S04-DRY-RUN-CLEAN", passed: true }
#   ] }

bun run verify:m028:s02 --json && bun run verify:m028:s03 --json && bun run verify:m028:s04 --json
# → all exit 0

bunx tsc --noEmit 2>&1 | grep -E 'wiki-publisher|verify-m028-s04'
# → (no output)
```

## Observability Impact

- Signals added/changed: `bun run verify:m028:s04 --json` structured output; `SENTINEL-SUPERSEDED` detail field reports count when failing; DB query `SELECT COUNT(*) WHERE published_comment_id=0 AND published_at IS NOT NULL` is the primary failure diagnostic
- How a future agent inspects this: `bun run verify:m028:s04 --json 2>&1 | jq '.checks[] | select(.passed == false)'`; `SELECT page_id, published_comment_id FROM wiki_update_suggestions WHERE published_at IS NOT NULL ORDER BY published_at DESC LIMIT 30`
- Failure state exposed: SENTINEL-SUPERSEDED count visible in check detail; LIVE-PUBLISHED count visible when insufficient

## Inputs

- `scripts/verify-m028-s03.ts` — structural template and `checkNoWhyInRender` export to reuse
- `scripts/verify-m028-s03.test.ts` — test structure template (sequential SQL stub pattern, DB-skip coverage)
- `src/knowledge/wiki-publisher.ts` — `formatPageComment` (post-T01) and `formatSummaryTable` (post-T01) as the two render surfaces under test
- `src/knowledge/wiki-publisher-types.ts` — `PageSuggestionGroup` type for mock construction
- T01 must be complete before T02 — `M028-S04-NO-WHY-IN-SUMMARY` checks the corrected `formatSummaryTable`

## Expected Output

- `scripts/verify-m028-s04.ts` — new: 5-check proof harness with correct exports
- `scripts/verify-m028-s04.test.ts` — new: 30+ test suite covering all check paths
- `package.json` — `verify:m028:s04` alias added
- DB: all 21 sentinel rows now have `published_comment_id > 0` and `published_at IS NOT NULL` (re-written by live publish)
- xbmc/wiki issue #5: 21 additional modification-only comments with identity markers (or 21 updated existing comments)
- `bun run verify:m028:s04 --json` → `overallPassed: true`
