---
id: T02
parent: S01
milestone: M028
provides:
  - parseModificationContent() exported from wiki-update-generator.ts
  - parseGeneratedSuggestion() marked @deprecated (kept for backward compat)
  - processPage() computes modificationMode before pipeline
  - Page-mode stitching: per-section voice pipeline outputs joined with --- separators
  - storeSuggestion() writes replacement_content and modification_mode columns
  - UpdateGeneratorResult uses modificationsGenerated/modificationsDropped with deprecated aliases
  - Generator tests: 33/33 pass with parseModificationContent + mode-selection blocks
key_files:
  - src/knowledge/wiki-update-generator.ts
  - src/knowledge/wiki-update-generator.test.ts
key_decisions:
  - parseModificationContent strips WHY: prefix with logger.warn — model drift guard
  - Page mode: sections generated via existing voice pipeline, stitched in document order
  - Section/page coexistence: DELETE+INSERT uses (page_id, modification_mode, COALESCE(section_heading,''))
  - modificationMode defaults to 'section' (< pageModeThreshold); page mode at/above threshold
  - deprecated aliases kept on UpdateGeneratorResult for backward compat
patterns_established:
  - pageModeThreshold logged at info level with sectionsMatched per page
observability_surfaces:
  - logger.info({ modificationMode, sectionsMatched, pageModeThreshold }) in processPage
  - logger.warn when WHY: prefix stripped by parseModificationContent
duration: ~45min
verification_result: passed
completed_at: 2026-03-16
blocker_discovered: false
---

# T02: Generator Parser Replacement and Page-Mode Stitching

## What Happened

Rewrote the generator's parsing, mode selection, and storage layers:

1. **`parseModificationContent()`** — new exported function returning `{ replacementContent, isNoUpdate }`. Strips WHY: preamble with `logger.warn` if LLM drifts back to old format. No `whySummary` on the return type.

2. **`parseGeneratedSuggestion()`** — marked `@deprecated`, kept intact for backward compat (deprecated tests still pass).

3. **Mode selection** — computed in `processPage()` before the voice pipeline: `sectionInputs.length >= pageModeThreshold` → `'page'`; else `'section'`. Logged at info level.

4. **Page-mode stitching** — voice pipeline runs per-section as before. Outputs are collected in document order and joined with `\n\n---\n\n` separators into a single page-mode artifact with `sectionHeading = null`. Each section runs through the guardrail pipeline independently; failed sections are excluded (not dropped entirely).

5. **Section mode** — unchanged logic, uses `parseModificationContent` instead of `parseGeneratedSuggestion`.

6. **`storeSuggestion()`** — writes `replacement_content` and `modification_mode` columns. DELETE+INSERT key updated to `(page_id, modification_mode, COALESCE(section_heading, ''))`.

7. **`UpdateGeneratorResult`** — initialized with both `modificationsGenerated`/`modificationsDropped` (new) and `suggestionsGenerated`/`suggestionsDropped` (deprecated aliases, kept in sync).

## Verification

```
bun test src/knowledge/wiki-update-generator.test.ts
# → 33 pass, 0 fail

bunx tsc --noEmit 2>&1 | grep wiki-update-generator
# → (no output) — zero errors
```

## Deviations

- Deprecated `parseGeneratedSuggestion` kept (plan said keep it; done).
- Page-mode section heading rendered as `## heading` in stitched content so operators can see structure; plan was silent on this detail.

## Diagnostics

- `grep -n 'parseModificationContent\|modificationMode\|replacement_content' src/knowledge/wiki-update-generator.ts` — confirms all three are present in implementation
- `bun test src/knowledge/wiki-update-generator.test.ts 2>&1 | grep 'parseModificationContent\|mode selection'` — confirms new describe blocks are running
- `bunx tsc --noEmit 2>&1 | grep wiki-update-generator` — should produce no output (zero errors)
- Log signal: `logger.info({ modificationMode, sectionsMatched, pageModeThreshold }, "Mode selected for page")` in `processPage()` — visible at INFO level during generation runs
- Log signal: `logger.warn("LLM output starts with WHY: preamble")` in `parseModificationContent` — fires on model drift

## Files Created/Modified

- `src/knowledge/wiki-update-generator.ts` — parseModificationContent, page-mode processPage, storeSuggestion with new columns
- `src/knowledge/wiki-update-generator.test.ts` — rewritten test suite with parseModificationContent + mode-selection blocks
