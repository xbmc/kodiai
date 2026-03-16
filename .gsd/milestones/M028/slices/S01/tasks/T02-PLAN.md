---
estimated_steps: 7
estimated_files: 2
---

# T02: Generator Parser Replacement and Page-Mode Stitching

**Slice:** S01 — Modification Artifact Contract Through Real Entry Points
**Milestone:** M028

## Description

Fix the production WHY: violation in the generator layer. The violation lives at three points: `parseGeneratedSuggestion()` (carves a fake `whySummary` from modification text using sentence-boundary fallback), `storeSuggestion()` (writes the fake `why_summary` to DB), and the missing `modification_mode` write. This task replaces the parser, adds deterministic mode-selection, implements page-mode stitching, and updates storage. It also rewrites the generator tests to lock the new contract with positive modification-only assertions and negative WHY: guards.

Key insight from research: `buildGroundedSectionPrompt` (which contains the `WHY:` instruction) is only used in tests, not in the production call path. The production path uses `createVoicePreservingPipeline` → `buildVoicePreservingPrompt`, which already outputs pure modification text. The parser change is therefore the primary production fix.

## Steps

1. In `wiki-update-generator.ts`, add `parseModificationContent(text: string): { replacementContent: string; isNoUpdate: boolean }`. Logic: trim text; if `trimmed.toUpperCase().startsWith("NO_UPDATE")`, return `{ replacementContent: "", isNoUpdate: true }`; if `trimmed.startsWith("WHY: ")` or `trimmed.startsWith("WHY:")`, strip the WHY preamble (the content before the first double-newline or first single newline) and log `logger.warn({ section }, "LLM produced WHY: prefix in modification text — stripping preamble")`, then use the remainder as `replacementContent`; otherwise return `{ replacementContent: trimmed, isNoUpdate: false }`. Export this function. Mark `parseGeneratedSuggestion` as `/** @deprecated Use parseModificationContent instead. */` but keep it to avoid immediate breakage of existing references.

2. In `createUpdateGenerator()` → `run()`, add `const pageModeThreshold = opts.pageModeThreshold ?? 3`. Pass through to `processPage` (add as a parameter).

3. In `processPage()`, after computing `sectionInputs`, determine `modificationMode: 'section' | 'page'` based on `sectionInputs.length >= pageModeThreshold`. Log `logger.info({ pageId, pageTitle, modificationMode, sectionsMatched: sectionInputs.length, pageModeThreshold }, "Selected modification mode")`.

4. In `processPage()`, replace the `parseGeneratedSuggestion(vr.suggestion)` call with `parseModificationContent(vr.suggestion)`. Replace the resulting `parsed.whySummary` usage with nothing (no whySummary needed). Use `parsed.replacementContent` directly.

5. For page mode: after collecting all voice results that pass the grounding check, stitch them into a single `replacementContent` by joining section contents in document order (use the `sectionInputs` ordering as the canonical order). Write one artifact with `sectionHeading: null`, `modificationMode: 'page'`, `replacementContent: stitchedContent`. Before inserting, delete ALL existing rows for `page.pageId` (to clear any prior section-mode rows). For section mode: write one artifact per section as today.

6. Update `storeSuggestion()` to accept `modificationMode: 'section' | 'page'` and `replacementContent: string` on the input type. Write `modification_mode = suggestion.modificationMode` and `replacement_content = suggestion.replacementContent` in the INSERT. The DELETE clause for the unique-index upsert logic should now match on `(page_id, modification_mode, COALESCE(section_heading, ''))`.

7. Update `UpdateGeneratorResult` usage in the `run()` function body to use `modificationsGenerated`/`modificationsDropped` field names (matching T01 type update). Update the CLI `generate-wiki-updates.ts` will be updated in T03; for now ensure the generator result type is consistent.

8. Rewrite `wiki-update-generator.test.ts`:
   - Replace the `parseGeneratedSuggestion` describe block with a `parseModificationContent` describe block: test `NO_UPDATE` detection (case-insensitive), test plain text passthrough (returns text as-is as `replacementContent`), test WHY: prefix stripping (if LLM emits `WHY: ...` the function strips it), test that the returned object has no `whySummary` key.
   - Add a `mode-selection` describe block: test that when `sectionInputs.length < pageModeThreshold`, mode is `section`; test that when `sectionInputs.length >= pageModeThreshold`, mode is `page`. These can use direct calls to a helper if mode-selection is extracted, or mock the generator run with a fixed `pageModeThreshold`.
   - Keep `matchPatchesToSection` describe block unchanged.
   - Replace any test asserting `expect(prompt).toContain('Begin with "WHY:"')` with `expect(prompt).not.toContain('Begin with "WHY:"')` (the `buildGroundedSectionPrompt` function is deprecated — its tests should become negative contract guards OR be replaced with tests of the new modification prompt).
   - Keep `checkGrounding` tests since the function remains in the file (deprecated but present).

## Must-Haves

- [ ] `parseModificationContent` exported from `wiki-update-generator.ts`
- [ ] `parseGeneratedSuggestion` marked `@deprecated` (not deleted)
- [ ] `processPage` computes `modificationMode` from `sectionInputs.length >= pageModeThreshold` and logs the decision
- [ ] Page-mode stitching: single artifact with `modificationMode='page'`, `sectionHeading=null`, section outputs joined in order
- [ ] `storeSuggestion` writes `modification_mode` and `replacement_content` columns
- [ ] Generator tests include `parseModificationContent` describe block with no-whySummary assertion
- [ ] Generator tests include mode-selection tests covering both `section` and `page` outcomes
- [ ] No test asserts `expect(prompt).toContain('Begin with "WHY:"')` without a corresponding refutation

## Verification

- `bun test src/knowledge/wiki-update-generator.test.ts` — all tests pass
- Test output includes `parseModificationContent` and `mode-selection` describe blocks
- `grep -n 'parseModificationContent' src/knowledge/wiki-update-generator.test.ts` returns hits showing the new test coverage
- `bunx tsc --noEmit` — no errors in wiki-update-generator.ts (publisher errors remain until T03; 47 pre-existing M027 errors in unrelated files are out of scope)

## Observability Impact

- Signals added/changed: `logger.info({ modificationMode, sectionsMatched, pageModeThreshold })` per page — operators can trace why a page became page-mode vs section-mode
- Failure state exposed: `logger.warn` when LLM produces WHY: prefix — signals prompt drift before it pollutes stored artifacts

## Inputs

- `src/knowledge/wiki-update-types.ts` (T01 output) — `UpdateSuggestion` with `modificationMode`, `replacementContent`, nullable `whySummary`; `UpdateGeneratorOptions.pageModeThreshold`
- `src/knowledge/wiki-update-generator.ts` — current production code with `parseGeneratedSuggestion`, `processPage`, `storeSuggestion`
- `src/knowledge/wiki-update-generator.test.ts` — existing tests to rewrite (kept as starting point)

## Expected Output

- `src/knowledge/wiki-update-generator.ts` — updated with `parseModificationContent`, mode-selection logic, page-mode stitching, updated `storeSuggestion`
- `src/knowledge/wiki-update-generator.test.ts` — rewritten with `parseModificationContent` tests, mode-selection tests, no stale WHY: positive assertions
