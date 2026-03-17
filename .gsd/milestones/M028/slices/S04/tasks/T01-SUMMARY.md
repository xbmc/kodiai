---
id: T01
parent: S04
milestone: M028
provides:
  - formatSummaryTable emits "Wiki Modification Artifacts" title and "Modifications posted" stat with no Voice Warnings column
  - Negative-guard tests preventing re-introduction of suggestion-style labels
key_files:
  - src/knowledge/wiki-publisher.ts
  - src/knowledge/wiki-publisher.test.ts
key_decisions:
  - Replaced the "shows voice warning column" test with "does not render voice warning column" (negative guard) instead of deleting it, preserving coverage of the column-removal contract
patterns_established:
  - Paired each label removal with a `not.toContain` negative guard so future regressions are caught immediately by name
observability_surfaces:
  - bun test src/knowledge/wiki-publisher.test.ts → 39 pass / 0 fail (negative guards report exact offending string on failure)
  - bun -e "import {formatSummaryTable} from './src/knowledge/wiki-publisher.ts'; console.log(formatSummaryTable('2026-03-05', [], 0))" → full summary table output for visual inspection
duration: ~10m
verification_result: passed
completed_at: 2026-03-16
blocker_discovered: false
---

# T01: Fix `formatSummaryTable` Labels and Add Regression Tests

**Replaced the three stale suggestion-style labels in `formatSummaryTable` and added negative-guard tests that will fail with the offending string if any label regresses.**

## What Happened

`formatSummaryTable` in `src/knowledge/wiki-publisher.ts` had three stale outputs:

1. Title: `"# Wiki Update Suggestions — ${date}"` → changed to `"# Wiki Modification Artifacts — ${date}"`
2. Stat: `"**Suggestions posted:** ${totalSuggestions}"` → changed to `"**Modifications posted:** ${totalSuggestions}"`
3. Table header and row template contained a `Voice Warnings` column (`voiceCol` variable emitting `"yes"`/`"no"`) → column and variable removed entirely

In `wiki-publisher.test.ts`:
- Updated the `"includes date-stamped header"` assertion to match the new title string
- Updated the `"includes page and suggestion counts"` assertion to match `"Modifications posted"`
- Replaced the `"shows voice warning column"` test (which checked for `| yes |` / `| no |`) with `"does not render voice warning column"` — a negative guard asserting the column and its cell values are absent
- Added a new `"does not contain suggestion-style labels"` test with five negative guards: `Wiki Update Suggestions`, `Suggestions posted`, `Voice Warnings`, `WHY:`, `:warning:`

## Verification

```
bun test src/knowledge/wiki-publisher.test.ts
→ 39 pass, 0 fail (up from 38 due to the additional negative-guard test)

bun -e "..."  spot-check:
OK: title         (no "Wiki Update Suggestions")
OK: stat          ("Modifications posted" present)
OK: column removed (no "Voice Warnings")
```

## Diagnostics

- Re-run `bun test src/knowledge/wiki-publisher.test.ts` at any time; if a stale label re-appears, the `does not contain suggestion-style labels` or `does not render voice warning column` test will fail and the `expect(result).not.toContain("...")` error output will name the exact string that reappeared.
- Visual inspection: `bun -e "import {formatSummaryTable} from './src/knowledge/wiki-publisher.ts'; console.log(formatSummaryTable('2026-03-05', [], 0))"` prints the table for human review.

## Deviations

- Kept the voice-warning test rather than deleting it — renamed to `"does not render voice warning column"` and flipped assertions to negative guards. This preserves explicit coverage of the removal contract with no plan-level impact.

## Known Issues

none

## Files Created/Modified

- `src/knowledge/wiki-publisher.ts` — `formatSummaryTable`: title, stat label, table header, and row template updated; `voiceCol` removed
- `src/knowledge/wiki-publisher.test.ts` — two stale assertions updated; voice-warning test replaced with negative guard; new `does not contain suggestion-style labels` test added
- `.gsd/milestones/M028/slices/S04/tasks/T01-PLAN.md` — added `## Observability Impact` section (pre-flight gap fix)
- `.gsd/milestones/M028/slices/S04/S04-PLAN.md` — added diagnostic failure-path verification step (pre-flight gap fix)
