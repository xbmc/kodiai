# S04: Final Integrated Publication & Retrofit Proof

**Goal:** Prove the assembled M028 system end-to-end — fix the last suggestion-flavored publisher surface (`formatSummaryTable`), supersede the 21 legacy sentinel rows via the live upsert path so they carry real GitHub comment IDs, and confirm the full R025–R029 contract holds via a 5-check machine-verifiable harness.
**Demo:** `bun run verify:m028:s04 --json` exits 0 with `overallPassed: true` across all five checks (including `SENTINEL-SUPERSEDED`). `bun run verify:m028:s02 --json && bun run verify:m028:s03 --json && bun run verify:m028:s04 --json` all exit 0. `formatSummaryTable` output no longer contains "Wiki Update Suggestions", "Suggestions posted", or a "Voice Warnings" column.

## Must-Haves

- `formatSummaryTable` renders "Wiki Modification Artifacts" as its title and "Modifications posted" as the stat label, with no Voice Warnings column, and tests enforce these via negative guards.
- `scripts/verify-m028-s04.ts` implements 5 checks covering R025–R029 with the same proof-harness contract as S02/S03 verifiers.
- `M028-S04-SENTINEL-SUPERSEDED` is a real (non-informational) gate — it fails when any sentinel rows remain, passes only when count = 0.
- All 21 sentinel rows (published_comment_id = 0) are re-published via the live upsert path, acquiring real GitHub comment IDs and leaving `SENTINEL-SUPERSEDED` passing.
- All prior verifiers (`verify:m028:s02`, `verify:m028:s03`) continue to pass after S04 changes.

## Proof Level

- This slice proves: final-assembly
- Real runtime required: yes (DB + GitHub App for sentinel re-publish step)
- Human/UAT required: no

## Verification

```bash
# T01 — publisher test suite with updated assertions and negative guards:
bun test src/knowledge/wiki-publisher.test.ts
# → 38+ pass, 0 fail; no "Wiki Update Suggestions" or "Suggestions posted" in output

# Diagnose T01 label regressions (any failing negative guard shows the offending string):
bun test src/knowledge/wiki-publisher.test.ts --reporter=verbose 2>&1 | grep -E 'FAIL|not.toContain'

# T02 — S04 verifier test suite:
bun test ./scripts/verify-m028-s04.test.ts
# → 30+ pass, 0 fail

# T02 — S04 verifier before sentinel re-publish (baseline):
bun run verify:m028:s04 --json
# Expected: LIVE-PUBLISHED=pass, SENTINEL-SUPERSEDED=fail (count=21)

# T02 — Sentinel re-publish (DB reset + live publish):
# 1. SQL: UPDATE wiki_update_suggestions SET published_at = NULL WHERE published_comment_id = 0 AND published_at IS NOT NULL
# 2. bun scripts/publish-wiki-updates.ts --issue-number 5
# → 21+ pages published to xbmc/wiki issue #5 with real comment IDs

# T02 — S04 verifier after sentinel re-publish:
bun run verify:m028:s04 --json
# Expected: overallPassed=true, all 5 checks pass

# T02 — Full regression sweep:
bun run verify:m028:s02 --json && bun run verify:m028:s03 --json && bun run verify:m028:s04 --json
# → all three overallPassed=true, exit 0

# Type check:
bunx tsc --noEmit 2>&1 | grep -E 'wiki-publisher|verify-m028-s04'
# → (no output)

# Failure-path diagnostic (inspect any failing checks with structured detail):
bun run verify:m028:s04 --json 2>&1 | grep -A5 '"passed": false'
# → shows id, status_code, and detail for any failing check
# Example for SENTINEL-SUPERSEDED failure: detail="sentinel_rows=21 (need 0; run re-publish to supersede)"
```

## Observability / Diagnostics

- Runtime signals: `logger.info({ issueNumber, pageId, commentId, action })` per upsert during sentinel re-publish; `bun run verify:m028:s04 --json` → structured check envelope
- Inspection surfaces: `SELECT page_id, published_comment_id, published_issue_number FROM wiki_update_suggestions WHERE published_at IS NOT NULL ORDER BY published_at DESC LIMIT 30` — confirms sentinel rows acquired real IDs; `bun run verify:m028:s04 --json 2>&1 | jq '.checks[] | select(.passed == false)'` — any failing checks with detail
- Failure visibility: `SENTINEL-SUPERSEDED` detail field shows count when failing; `LIVE-PUBLISHED` detail field shows count; pure-code checks report specific assertion that failed
- Redaction constraints: no secrets in check output; GitHub App credentials stay out of logs

## Integration Closure

- Upstream surfaces consumed: `formatPageComment` (S01/S03), `upsertWikiPageComment` (S02), `publish()` with `issueNumber` (S03), `published_comment_id` column (S02 migration 031), S03 `checkNoWhyInRender` export
- New wiring introduced in this slice: `verify-m028-s04.ts` integrates `formatSummaryTable` + `formatPageComment` negative checks; sentinel re-publish is a one-time operational step closing the identity gap on 21 legacy rows
- What remains before the milestone is truly usable end-to-end: nothing — S04 is the final acceptance slice

## Tasks

- [x] **T01: Fix `formatSummaryTable` labels and add regression tests** `est:30m`
  - Why: `formatSummaryTable` is the last publisher surface still emitting suggestion-style language ("Wiki Update Suggestions", "Suggestions posted", "Voice Warnings" column). Fixing it closes the surface consistency gap required by R026/R029, and new negative guards prevent regression.
  - Files: `src/knowledge/wiki-publisher.ts`, `src/knowledge/wiki-publisher.test.ts`
  - Do: In `wiki-publisher.ts` `formatSummaryTable`, change the title line to `"# Wiki Modification Artifacts — ${date}"`, change the stat line to `"**Modifications posted:** ${totalSuggestions}"`, remove the Voice Warnings column from the table header (`| # | Page | Wiki Link | Sections | PRs Cited | Comment |`) and remove `voiceCol` from the row template. In `wiki-publisher.test.ts`, update the two stale assertions (lines ~215 and ~240) to match the new strings, remove or update the "shows voice warning column" test (it checks `| yes |`/`| no |` which no longer renders), and add new negative guards on `formatSummaryTable` output: `expect(result).not.toContain("Wiki Update Suggestions")`, `expect(result).not.toContain("Suggestions posted")`, `expect(result).not.toContain("Voice Warnings")`.
  - Verify: `bun test src/knowledge/wiki-publisher.test.ts` → all pass, 0 fail
  - Done when: test suite passes with no failures; `formatSummaryTable("2026-03-05", [], 0)` does not contain "Wiki Update Suggestions" or "Suggestions posted"

- [x] **T02: Write S04 proof harness, publish sentinel rows, run regression sweep** `est:90m`
  - Why: The milestone is only complete when a machine-verifiable harness confirms the full R025–R029 contract and the 21 legacy sentinel rows carry real GitHub comment IDs. This task writes the verifier, runs it to baseline, performs the sentinel re-publish, then re-runs to confirm `overallPassed: true`.
  - Files: `scripts/verify-m028-s04.ts`, `scripts/verify-m028-s04.test.ts`, `package.json`
  - Do: Write `scripts/verify-m028-s04.ts` following `verify-m028-s03.ts` exactly as structural template. Export `M028_S04_CHECK_IDS`, `M028S04CheckId`, `M028S04Check`, `M028S04EvaluationReport`, `evaluateM028S04`, `buildM028S04ProofHarness`. Implement 5 checks: `M028-S04-NO-WHY-IN-RENDER` (pure-code — import and call `checkNoWhyInRender` from `./verify-m028-s03.ts`); `M028-S04-NO-WHY-IN-SUMMARY` (pure-code — call `formatSummaryTable` with mock data, assert output has no `"**Why:**"`, `":warning:"`, or `"Wiki Update Suggestions"`); `M028-S04-LIVE-PUBLISHED` (DB-gated — `COUNT(*) WHERE published_comment_id > 0`, pass when count >= 80); `M028-S04-SENTINEL-SUPERSEDED` (DB-gated — `COUNT(*) WHERE published_comment_id = 0 AND published_at IS NOT NULL`, pass when count = 0); `M028-S04-DRY-RUN-CLEAN` (pure-code — call `formatPageComment` on a mock group, assert no `"**Why:**"` or `":warning:"`; can import `checkNoWhyInRender` again or inline). `overallPassed` must include SENTINEL-SUPERSEDED in the gate — no informational exclusion. Write `scripts/verify-m028-s04.test.ts` (~30 tests): check ID list, envelope shape, each pure-code pass/fail path, DB-gated skip behavior, and `overallPassed` semantics including SENTINEL-SUPERSEDED as a real gate. Add `"verify:m028:s04": "bun scripts/verify-m028-s04.ts"` to `package.json`. Run `bun run verify:m028:s04 --json` to confirm baseline (LIVE-PUBLISHED passes, SENTINEL-SUPERSEDED fails with count=21). Then perform sentinel re-publish: run `psql $DATABASE_URL -c "UPDATE wiki_update_suggestions SET published_at = NULL WHERE published_comment_id = 0 AND published_at IS NOT NULL"` to reset the 21 sentinel rows, then run `bun scripts/publish-wiki-updates.ts --issue-number 5` (the publish loop queries `WHERE published_at IS NULL`, so the reset rows are now eligible; upsert will find or create comments on issue #5). After publish, run `bun run verify:m028:s04 --json` and confirm all 5 checks pass. Finally run full regression sweep: `bun run verify:m028:s02 --json && bun run verify:m028:s03 --json && bun run verify:m028:s04 --json`.
  - Verify: `bun test ./scripts/verify-m028-s04.test.ts` → 30+ pass, 0 fail; `bun run verify:m028:s04 --json` → `overallPassed: true`; `bun run verify:m028:s02 --json && bun run verify:m028:s03 --json && bun run verify:m028:s04 --json` → all exit 0
  - Done when: `verify-m028-s04.ts` test suite passes, `bun run verify:m028:s04 --json` emits `overallPassed: true` with all 5 checks passing (including SENTINEL-SUPERSEDED), and the full regression sweep exits 0

## Files Likely Touched

- `src/knowledge/wiki-publisher.ts`
- `src/knowledge/wiki-publisher.test.ts`
- `scripts/verify-m028-s04.ts`
- `scripts/verify-m028-s04.test.ts`
- `package.json`
