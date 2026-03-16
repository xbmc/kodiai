---
id: T03
parent: S01
milestone: M028
provides:
  - PageSuggestionGroup updated: replacementContent, modificationMode, suggestion as backward-compat alias
  - formatPageComment: no **Why:** line, no voice-mismatch prose; section/page mode rendering
  - formatSummaryTable: 'Modifications' terminology, Voice Warnings column removed
  - DB SELECT includes replacement_content, modification_mode; falls back to suggestion for legacy rows
  - Publisher test suite: 28/28 pass with negative **Why:** and :warning: guards
  - scripts/generate-wiki-updates.ts CLI uses modificationsGenerated/modificationsDropped
key_files:
  - src/knowledge/wiki-publisher-types.ts
  - src/knowledge/wiki-publisher.ts
  - src/knowledge/wiki-publisher.test.ts
  - scripts/generate-wiki-updates.ts
key_decisions:
  - Legacy backward compat: null replacement_content falls back to suggestion column in grouping
  - voiceMismatchWarning stored in DB but NOT rendered in output (modification-only contract)
  - Page mode renders stitched content block without per-section headers
  - formatSummaryTable header renamed to 'Wiki Modification Artifacts'
patterns_established:
  - Negative guards (not.toContain("**Why:**"), not.toContain(":warning:")) as required publisher tests
observability_surfaces:
  - formatPageComment renders only replacementContent + PR citation links
  - formatSummaryTable shows only Modifications count, no voice stats
duration: ~1h
verification_result: passed
completed_at: 2026-03-16
blocker_discovered: false
---

# T03: Publisher Renderer, Types, and Test Rewrite

## What Happened

Updated all publisher-layer files to the modification-only contract:

1. **`wiki-publisher-types.ts`** — `PageSuggestionGroup.suggestions` now has `replacementContent` and `modificationMode`; `whySummary` removed; `suggestion` kept as backward-compat alias.

2. **`wiki-publisher.ts` `formatPageComment`** — completely rewritten. No `**Why:**` line, no voice mismatch warning prose. Section mode renders per-section under `### heading`; page mode renders single block. PR citation links kept as sole trace metadata.

3. **`wiki-publisher.ts` `formatSummaryTable`** — renamed "Suggestions posted" → "Modifications posted"; dropped Voice Warnings column; header changed to "Wiki Modification Artifacts".

4. **DB SELECT** — updated to include `replacement_content, modification_mode`. Group builder reads new columns with fallback: `replacementContent = rawReplacement ?? suggestion` for legacy rows.

5. **`wiki-publisher.test.ts`** — fully rewritten. `makeGroup()` uses `replacementContent`. All `formatPageComment` tests assert `not.toContain("**Why:**")` and voice-mismatch tests assert `not.toContain(":warning:")`. Added page-mode test and legacy fallback test.

6. **`scripts/generate-wiki-updates.ts`** — CLI summary uses `result.modificationsGenerated` / `result.modificationsDropped`.

## Verification

```
bun test src/knowledge/wiki-publisher.test.ts
# → 28 pass, 0 fail

bunx tsc --noEmit 2>&1 | grep wiki-publisher
# → (no output) — zero errors
```

## Diagnostics

- `grep -n 'replacementContent\|modificationMode' src/knowledge/wiki-publisher-types.ts` — confirms new fields in PageSuggestionGroup
- `grep -n 'Why:' src/knowledge/wiki-publisher.ts` — should produce no output (formatPageComment contains no **Why:** line)
- `bun test src/knowledge/wiki-publisher.test.ts 2>&1 | grep "Why"` — should show passing not.toContain tests
- `bunx tsc --noEmit 2>&1 | grep wiki-publisher` — should produce no output (zero errors)
- Visual check: `formatPageComment` with any group → output has `**PRs:**` lines, no `**Why:**` lines

## Files Created/Modified

- `src/knowledge/wiki-publisher-types.ts` — replacementContent, modificationMode on PageSuggestionGroup
- `src/knowledge/wiki-publisher.ts` — formatPageComment rewrite, formatSummaryTable update, new DB SELECT
- `src/knowledge/wiki-publisher.test.ts` — full rewrite with negative guards
- `scripts/generate-wiki-updates.ts` — CLI summary updated
