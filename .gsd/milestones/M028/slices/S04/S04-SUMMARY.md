---
id: S04
parent: M028
milestone: M028
provides:
  - formatSummaryTable emits "Wiki Modification Artifacts" title and "Modifications posted" stat with no Voice Warnings column
  - Negative-guard test suite (39 pass) preventing re-introduction of any suggestion-style labels in publisher output
  - scripts/verify-m028-s04.ts — 5-check machine-verifiable proof harness (NO-WHY-IN-RENDER, NO-WHY-IN-SUMMARY, LIVE-PUBLISHED, SENTINEL-SUPERSEDED, DRY-RUN-CLEAN)
  - SENTINEL-SUPERSEDED as a real (non-informational) overallPassed gate — fails when any sentinel rows remain
  - All 21 legacy sentinel rows re-published via live upsert path; all acquired real GitHub comment IDs (published_comment_id > 0)
  - bun run verify:m028:s04 --json → overallPassed:true, all 5 checks pass
  - Full regression sweep: verify:m028:s02, s03, s04 all exit 0
requires:
  - slice: S01
    provides: WikiUpdateGroup modification artifact contract, formatPageComment, section/page mode
  - slice: S02
    provides: upsertWikiPageComment, published_comment_id schema, comment-identity surface
  - slice: S03
    provides: live publish path, checkNoWhyInRender export, 80+ real comment IDs in DB
affects: []
key_files:
  - src/knowledge/wiki-publisher.ts
  - src/knowledge/wiki-publisher.test.ts
  - scripts/verify-m028-s04.ts
  - scripts/verify-m028-s04.test.ts
  - package.json
key_decisions:
  - Reused checkNoWhyInRender from verify-m028-s03.ts for NO-WHY-IN-RENDER check (import, not inline) — avoids duplication
  - DRY-RUN-CLEAN uses a different mock (pageId=42) than NO-WHY-IN-RENDER (pageId=1) to test the same formatPageComment from a distinct call site
  - SENTINEL-SUPERSEDED skips (not fails) when DB unavailable to keep harness runnable in DB-less environments, but IS in the overallPassed gate when non-skipped
  - Replaced "shows voice warning column" test with "does not render voice warning column" negative guard instead of deleting it — preserves explicit coverage of the removal contract
patterns_established:
  - Bare :warning: in JSDoc block comments causes Bun parser to error ("Unexpected :") — use plain text in JSDoc, colon-notation only in code/string/test contexts
  - buildM028*ProofHarness auto-probes DATABASE_URL when sql=undefined; tests exercising DB-skip path must pass a rejecting sql stub (not undefined)
  - Sequential SQL stub pattern (makeSequentialSqlStub) needed when two DB-gated checks run in parallel — call index maps to a different response
  - Paired each label removal with a not.toContain negative guard so future regressions are caught immediately by name
observability_surfaces:
  - "bun run verify:m028:s04 --json 2>&1 | jq '.checks[] | select(.passed == false)' — structured failure detail per check"
  - "SENTINEL-SUPERSEDED detail: sentinel_rows=N (need 0; run re-publish to supersede)"
  - "LIVE-PUBLISHED detail: count=N — visible on pass and fail"
  - "bun test src/knowledge/wiki-publisher.test.ts → 39 pass / 0 fail; negative guards name the offending string on failure"
drill_down_paths:
  - .gsd/milestones/M028/slices/S04/tasks/T01-SUMMARY.md
  - .gsd/milestones/M028/slices/S04/tasks/T02-SUMMARY.md
duration: ~70m
verification_result: passed
completed_at: 2026-03-16
---

# S04: Final Integrated Publication & Retrofit Proof

**A 5-check machine-verifiable harness confirms the full R025–R029 contract; all 21 legacy sentinel rows acquired real GitHub comment IDs via live upsert; `formatSummaryTable` is modification-only throughout; full regression sweep exits 0.**

## What Happened

S04 closed the two remaining gaps in the M028 system: a stale suggestion-style surface in `formatSummaryTable`, and 21 legacy DB rows that still carried `published_comment_id = 0` (sentinel values from a pre-identity migration era). It also wired up the final acceptance harness that confirms all five milestone requirements machine-verifiably.

**T01 — Fix `formatSummaryTable` labels and add regression tests**

`formatSummaryTable` was the last publisher surface still emitting suggestion-style language. Three stale outputs were replaced:
- Title: `"# Wiki Update Suggestions — ${date}"` → `"# Wiki Modification Artifacts — ${date}"`
- Stat: `"**Suggestions posted:**"` → `"**Modifications posted:**"`
- Voice Warnings column (`voiceCol` with `| yes |` / `| no |` cells) → removed entirely from header and row template

In `wiki-publisher.test.ts`, two stale assertions were updated to match new strings. The old "shows voice warning column" test was flipped to "does not render voice warning column" (negative guard) rather than deleted — preserving explicit coverage of the removal contract. A new "does not contain suggestion-style labels" test added five `not.toContain` guards: `Wiki Update Suggestions`, `Suggestions posted`, `Voice Warnings`, `WHY:`, `:warning:`. Result: 39 pass, 0 fail.

**T02 — Write S04 proof harness, publish sentinel rows, run regression sweep**

`scripts/verify-m028-s04.ts` was written following the S03 structural template exactly. It exports `M028_S04_CHECK_IDS`, `M028S04CheckId`, `M028S04Check`, `M028S04EvaluationReport`, `evaluateM028S04`, and `buildM028S04ProofHarness`. The 5 checks:

1. **M028-S04-NO-WHY-IN-RENDER** — pure-code; delegates to `checkNoWhyInRender` imported from `./verify-m028-s03.ts`
2. **M028-S04-NO-WHY-IN-SUMMARY** — pure-code; calls `formatSummaryTable` with mock data, asserts no `**Why:**`, `:warning:`, or `Wiki Update Suggestions`
3. **M028-S04-LIVE-PUBLISHED** — DB-gated; `COUNT(*) WHERE published_comment_id > 0`, pass threshold ≥ 80
4. **M028-S04-SENTINEL-SUPERSEDED** — DB-gated; `COUNT(*) WHERE published_comment_id = 0 AND published_at IS NOT NULL`, pass when count = 0 — **real gate, not informational**
5. **M028-S04-DRY-RUN-CLEAN** — pure-code; calls `formatPageComment` with a distinct mock group (pageId=42), asserts no `**Why:**` or `:warning:`

`overallPassed` = `checks.filter(c => !c.skipped).every(c => c.passed)` — no informational exclusions.

`scripts/verify-m028-s04.test.ts` has 48 tests covering all check IDs, envelope shape, pure-code pass/fail paths, DB-gated skip/pass/fail, and `overallPassed` semantics including explicit test that SENTINEL-SUPERSEDED is NOT excluded from the gate.

**Baseline run** confirmed: LIVE-PUBLISHED=pass (count=80), SENTINEL-SUPERSEDED=fail (count=21) — expected pre-publish state.

**Sentinel re-publish:** Reset 21 sentinel rows (`UPDATE wiki_update_suggestions SET published_at = NULL WHERE published_comment_id = 0 AND published_at IS NOT NULL`), then ran `bun scripts/publish-wiki-updates.ts --issue-number 5`. The 21 sentinel rows mapped to 10 unique pages (multiple rows per page); all 21 acquired real comment IDs via the upsert path. After re-publish: LIVE-PUBLISHED=pass (count=104), SENTINEL-SUPERSEDED=pass (sentinel_rows=0).

Two JSDoc parser issues encountered: bare `:warning:` in `/** ... */` block comments triggered Bun parse error "Unexpected :". Fixed by using plain text descriptions in JSDoc only. Also, `buildM028S04ProofHarness` auto-probes `DATABASE_URL` when `sql=undefined`; test suite was fixed to pass a rejecting sql stub instead.

## Verification

```
bun test src/knowledge/wiki-publisher.test.ts
→ 39 pass, 0 fail

bun test ./scripts/verify-m028-s04.test.ts
→ 48 pass, 0 fail

bun run verify:m028:s04 --json
→ overallPassed: true
  NO-WHY-IN-RENDER: pass (render_clean length=155)
  NO-WHY-IN-SUMMARY: pass (summary_clean length=258)
  LIVE-PUBLISHED: pass (count=104)
  SENTINEL-SUPERSEDED: pass (sentinel_rows=0)
  DRY-RUN-CLEAN: pass (render_clean length=268)

bun run verify:m028:s02 --json && bun run verify:m028:s03 --json && bun run verify:m028:s04 --json
→ all three exit 0 with overallPassed: true

bunx tsc --noEmit 2>&1 | grep -E 'wiki-publisher|verify-m028-s04'
→ (no output — no type errors)
```

## Requirements Advanced

- R025 — Pipeline is modification-only end-to-end; all publisher surfaces confirmed clean across 5 checks
- R027 — Section/page mode is explicit and machine-checkable in stored artifacts and verifier output
- R028 — 21 sentinel rows re-published; all legacy rows now have real GitHub comment IDs (sentinel_rows=0)
- R029 — 5-check harness + 39-test publisher suite with negative guards provides comprehensive regression protection

## Requirements Validated

- R025 — Full pipeline proven modification-first: formatPageComment, formatSummaryTable, 104 live DB rows, 5 harness checks all clean
- R027 — WikiUpdateGroup mode field (section|page) proven in artifact contract; harness verifies no opinionated framing regardless of mode
- R028 — Live upsert path proven to supersede legacy sentinel rows; SENTINEL-SUPERSEDED=pass (sentinel_rows=0)
- R029 — Machine-verifiable regression harness operational; negative guards in publisher tests and 3 pure-code harness checks catch any reintroduction of banned strings

## New Requirements Surfaced

none

## Requirements Invalidated or Re-scoped

none

## Deviations

- **Test count: 48 not 30+** — plan said "~30 tests"; actual is 48 because full boundary coverage, order assertions, and `buildM028S04ProofHarness` output-format tests were added. All plan-required paths covered plus extras.
- **Publish posted 10 pages, not 21** — the 21 sentinel rows were associated with 10 unique pages (multiple rows per page). All 21 rows acquired real comment IDs; SENTINEL-SUPERSEDED passes with count=0.
- **Two Bun JSDoc parse errors** — bare `:warning:` in `/** ... */` block comments triggers "Unexpected :" in Bun v1.3.8. Fixed by replacing colon-notation with plain text in JSDoc only.
- **buildM028S04ProofHarness test needed sql stub not undefined** — harness auto-probes `DATABASE_URL` from env when `sql=undefined`; test fixed to pass a rejecting stub.
- **Voice-warning test renamed to negative guard** — plan said to remove the "shows voice warning column" test; instead it was flipped to a negative guard, preserving removal-contract coverage. No plan-level impact.

## Known Limitations

None — all must-haves verified. The milestone is complete.

## Follow-ups

None — S04 is the final acceptance slice. All five M028 requirements are validated.

## Files Created/Modified

- `src/knowledge/wiki-publisher.ts` — `formatSummaryTable`: title, stat label, table header, and row template updated; `voiceCol` removed
- `src/knowledge/wiki-publisher.test.ts` — two stale assertions updated; voice-warning test replaced with negative guard; new `does not contain suggestion-style labels` test (5 negative guards)
- `scripts/verify-m028-s04.ts` — new: 5-check proof harness, full exports, CLI runner with --json flag
- `scripts/verify-m028-s04.test.ts` — new: 48-test suite covering all check paths and overallPassed semantics
- `package.json` — added `verify:m028:s04` alias

## Forward Intelligence

### What the next slice should know
- M028 is complete. All five requirements (R025–R029) are validated. The wiki pipeline is modification-only end to end with machine-verifiable regression guards.
- The `verify:m028:s0N` script pattern (S02, S03, S04) forms a regression sweep that future wiki work should keep passing.
- The `checkNoWhyInRender` export from `verify-m028-s03.ts` is the canonical reusable negative guard for formatPageComment; import it rather than re-implementing.

### What's fragile
- `SENTINEL-SUPERSEDED` passes because the 21 rows were re-published one time. If new rows are inserted with `published_comment_id = 0` (e.g., by a publish path that doesn't upsert correctly), the check will fail again — which is the intended behavior.
- The LIVE-PUBLISHED threshold is 80. If rows are deleted from the DB this check would fail; it's not tied to a specific page list.

### Authoritative diagnostics
- `bun run verify:m028:s04 --json 2>&1 | jq '.checks[] | select(.passed == false)'` — most specific failure signal available; detail field names exact count or assertion on failure
- `SELECT page_id, published_comment_id, published_issue_number FROM wiki_update_suggestions WHERE published_at IS NOT NULL ORDER BY published_at DESC LIMIT 30` — confirms sentinel status in DB
- `bun test src/knowledge/wiki-publisher.test.ts --reporter=verbose 2>&1 | grep -E 'FAIL|not.toContain'` — shows any regressed negative guard with exact offending string

### What assumptions changed
- Original assumption: 21 sentinel rows = 21 separate pages needing separate publish runs. Actual: 21 sentinel rows mapped to 10 unique pages (multiple rows per page); 10 publish actions covered all 21 rows via the upsert path.
