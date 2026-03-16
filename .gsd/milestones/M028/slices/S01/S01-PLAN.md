# S01: Modification Artifact Contract Through Real Entry Points

**Goal:** The wiki generate + publish-dry-run entrypoints produce persisted and rendered outputs that are modification-only, explicitly scoped as `section` or `page` replacements, and free of `WHY:`/suggestion prose.

**Demo:** `bun scripts/generate-wiki-updates.ts --dry-run` (or live generation) followed by `bun scripts/publish-wiki-updates.ts --dry-run` produces output that contains PR citation links but no `WHY:` blocks, no `**Why:**` labels, and no voice-mismatch warning prose. Fresh DB rows carry a `modification_mode` column and a `replacement_content` column instead of rationale text. `bun run verify:m028:s01 --json` emits all-passing check IDs.

## Must-Haves

- `UpdateSuggestion` type has `modificationMode: 'section' | 'page'` and `replacementContent: string`; `whySummary` is nullable
- DB migration 030 adds `modification_mode`, `replacement_content`, makes `why_summary` nullable, and fixes the unique index to include `modification_mode`
- `parseModificationContent()` replaces `parseGeneratedSuggestion()` — returns `{ replacementContent, isNoUpdate }` with no `whySummary` extraction
- Deterministic page-mode selection: if matched section count >= `pageModeThreshold` (default 3), generator writes a single page-mode artifact instead of per-section rows
- `formatPageComment()` emits no `**Why:**` line and no voice-mismatch warning prose; keeps PR citation links as the only trace metadata
- Generator tests include explicit `not.toContain("WHY:")` assertion on prompt contract and `parseModificationContent` tests
- Publisher tests include explicit `not.toContain("**Why:**")` assertion as a negative regression guard
- `scripts/verify-m028-s01.ts` with stable check IDs `M028-S01-ARTIFACT-CONTRACT`, `M028-S01-NO-WHY-IN-RENDER`, `M028-S01-PR-CITATIONS`, `M028-S01-MODE-FIELD`
- `bun test scripts/verify-m028-s01.test.ts` passes
- S01 target files (`wiki-update-types.ts`, `wiki-update-generator.ts`, `wiki-publisher-types.ts`, `wiki-publisher.ts`, `scripts/generate-wiki-updates.ts`, `scripts/verify-m028-s01.ts`) compile without new errors (47 pre-existing errors in unrelated M027 files are out of S01 scope)

## Proof Level

- This slice proves: contract
- Real runtime required: no — unit/integration tests against mock SQL, plus dry-run verifier that can run against real DB when available
- Human/UAT required: no

## Verification

- `bun test src/knowledge/wiki-update-generator.test.ts` passes with `parseModificationContent` tests and mode-selection tests (both section/page modes) and no test asserting the old `WHY:` prompt instruction
- `bun test src/knowledge/wiki-publisher.test.ts` passes with `not.toContain("**Why:**")` guards
- `bun test scripts/verify-m028-s01.test.ts` passes, covering check IDs, envelope shape, and negative WHY: trigger behavior
- `bunx tsc --noEmit` exits clean on S01 target files (pre-existing M027 errors in embedding-repair, retrieval, and audit scripts are out of scope)
- When DB is available: `bun run verify:m028:s01 --json` emits `M028-S01-ARTIFACT-CONTRACT`, `M028-S01-NO-WHY-IN-RENDER`, `M028-S01-PR-CITATIONS`, `M028-S01-MODE-FIELD` all passing

## Observability / Diagnostics

- Runtime signals: generator logs `{ modificationMode, sectionsMatched, pageModeThreshold }` per page so operators can see which mode was selected and why
- Inspection surfaces: `bun run verify:m028:s01 --json` reports check results; `bun scripts/publish-wiki-updates.ts --dry-run --output preview.md` produces human-readable preview
- Failure visibility: verifier reports specific check ID failures with status codes; `M028-S01-NO-WHY-IN-RENDER` fails with the offending text snippet
- Redaction constraints: none — wiki content is public

## Integration Closure

- Upstream surfaces consumed: `createVoicePreservingPipeline()` (unchanged — already outputs modification text); existing `wiki-update-generator.ts` and `wiki-publisher.ts` call sites in `scripts/`
- New wiring introduced: migration 030 applied to shared Postgres DB; `verify:m028:s01` script alias in `package.json`
- What remains before milestone is usable end-to-end: S02 (durable comment identity for retrofit), S03 (live publish), S04 (final integrated acceptance)

## Tasks

- [x] **T01: New modification artifact types and DB migration** `est:45m`
  - Why: Everything downstream depends on the new type contract. Without `modificationMode` and `replacementContent` in both the schema and TypeScript types, the generator and publisher cannot write or read the new contract.
  - Files: `src/db/migrations/030-wiki-modification-artifacts.sql`, `src/knowledge/wiki-update-types.ts`
  - Do: Write migration 030 that adds `modification_mode TEXT NOT NULL DEFAULT 'section' CHECK (modification_mode IN ('section', 'page'))`, adds `replacement_content TEXT` (nullable), drops the existing unique index, and adds `CREATE UNIQUE INDEX ... ON wiki_update_suggestions (page_id, modification_mode, COALESCE(section_heading, ''))`. Also `ALTER COLUMN why_summary DROP NOT NULL`. Update `UpdateSuggestion` to add `modificationMode: 'section' | 'page'` and `replacementContent: string` and make `whySummary: string | null`. Add `pageModeThreshold?: number` to `UpdateGeneratorOptions`. Update `UpdateGeneratorResult` to add `modificationsGenerated: number` and `modificationsDropped: number` (rename from `suggestionsGenerated`/`suggestionsDropped`, or alias alongside).
  - Verify: `bunx tsc --noEmit` exits 0; migration SQL file exists with correct column/index DDL; TypeScript types export `modificationMode` and `replacementContent`
  - Done when: `UpdateSuggestion.modificationMode` and `UpdateSuggestion.replacementContent` are exported; `030-wiki-modification-artifacts.sql` is present and syntactically valid; TypeScript compiles clean

- [x] **T02: Generator parser replacement and page-mode stitching** `est:1h30m`
  - Why: The production WHY: violation lives at `parseGeneratedSuggestion()` (extracts fake whySummary from modification text), `storeSuggestion()` (writes why_summary), and the mode-selection gap (no `modification_mode` written). This task fixes all three in the generator layer and rewrites generator tests to lock the new contract.
  - Files: `src/knowledge/wiki-update-generator.ts`, `src/knowledge/wiki-update-generator.test.ts`
  - Do: Add `parseModificationContent(text: string): { replacementContent: string; isNoUpdate: boolean }` (returns `{ replacementContent: text.trim(), isNoUpdate: false }` unless text starts with `NO_UPDATE`; guard: if `replacementContent` starts with `WHY:` or `WHY `, strip the preamble and log a warning). Mark `parseGeneratedSuggestion` as `@deprecated` but don't delete it (existing tests will be rewritten to cover the new function). In `processPage()`, compute `modificationMode` before the voice pipeline: if `sectionInputs.length >= (opts.pageModeThreshold ?? 3)`, set `modificationMode = 'page'`; else `'section'`. For page mode: generate per-section via voice pipeline as today, then stitch outputs in document order into one `replacementContent` string, write a single page-mode artifact with `sectionHeading = null` and `modificationMode = 'page'`, and delete all existing rows for the page before inserting. Update `storeSuggestion()` to write `replacement_content = suggestion.replacementContent` and `modification_mode = suggestion.modificationMode`. Log `{ pageId, pageTitle, modificationMode, sectionsMatched, pageModeThreshold }` in `logger.info` after computing mode. Update `UpdateGeneratorResult` fields to use `modificationsGenerated`/`modificationsDropped` (or add them alongside). Rewrite `wiki-update-generator.test.ts`: replace `parseGeneratedSuggestion` describe block with `parseModificationContent` tests (NO_UPDATE detection, plain text passthrough, WHY: prefix stripping with warning); add mode-selection tests; keep `matchPatchesToSection` tests; drop `checkGrounding` tests only if the function is marked deprecated (keep them if still exported). Add a guard: `expect(prompt).not.toContain('Begin with "WHY:"')` when testing the mode-selection flow (or alternatively test that `buildGroundedSectionPrompt` is marked deprecated). The key negative assertion is on `parseModificationContent` return value: `expect(result.whySummary)` should not exist on the returned object.
  - Verify: `bun test src/knowledge/wiki-update-generator.test.ts` passes; test file includes `parseModificationContent` describe block and a mode-selection describe block; `bunx tsc --noEmit` exits 0
  - Done when: All generator tests pass; `parseModificationContent` is exported and tested; mode-selection logic writes `modificationMode` to artifacts; `storeSuggestion` writes `replacement_content`

- [x] **T03: Publisher renderer, types, and test rewrite** `est:1h`
  - Why: The published output WHY: violation is in `formatPageComment()` which renders `**Why:** {s.whySummary}` and voice mismatch warning prose. Publisher types (`PageSuggestionGroup`) use `whySummary`. The CLI summary uses "Suggestions" language.
  - Files: `src/knowledge/wiki-publisher-types.ts`, `src/knowledge/wiki-publisher.ts`, `src/knowledge/wiki-publisher.test.ts`, `scripts/generate-wiki-updates.ts`
  - Do: In `wiki-publisher-types.ts`, replace `whySummary: string` with `replacementContent: string` in the `PageSuggestionGroup.suggestions` item shape; add `modificationMode: 'section' | 'page'` to the group. In `wiki-publisher.ts`, update the DB SELECT to include `replacement_content, modification_mode` alongside `suggestion` (for backward compat). When building groups, set `replacementContent: (row.replacement_content as string | null) ?? (row.suggestion as string)` and `modificationMode: (row.modification_mode as string | null) as 'section' | 'page' ?? 'section'`. Rewrite `formatPageComment()`: remove the `**Why:** ${s.whySummary}` line (line 46), remove the voice mismatch warning prose block; for page-mode groups, skip per-section `### Heading` headers and render the single `replacementContent` block directly under the page header; for section-mode, keep `### Heading` per section; always keep PR citation links. Update `formatSummaryTable()`: rename "Suggestions posted" → "Modifications posted" and remove the "Voice Warnings" column (voice data is internal-only). In `scripts/generate-wiki-updates.ts`, update the CLI summary output to say "Modifications generated" / "Modifications dropped" instead of "Suggestions generated" / "Suggestions dropped". Rewrite `wiki-publisher.test.ts`: update `makeGroup()` to use `replacementContent` and `modificationMode`; add `expect(result).not.toContain("**Why:**")` as a required assertion in all `formatPageComment` tests; add `expect(result).not.toContain(":warning:")` for the no-voice-warning test; update `createWikiPublisher` test fixtures; keep the dry-run, pre-flight, and full-publish-flow tests updated to the new field names.
  - Verify: `bun test src/knowledge/wiki-publisher.test.ts` passes with negative `**Why:**` guards; `bunx tsc --noEmit` exits 0
  - Done when: All publisher tests pass; `formatPageComment` output has no `**Why:**` or voice mismatch prose; CLI summary uses Modifications language

- [x] **T04: Verifier script, test, and package.json wiring** `est:1h`
  - Why: Locks the modification-only contract machine-checkably for operators and future agents. Follows the M027 verifier pattern: stable check IDs, raw evidence envelope, JSON-first, human-readable summary from same data.
  - Files: `scripts/verify-m028-s01.ts`, `scripts/verify-m028-s01.test.ts`, `package.json`
  - Do: Write `scripts/verify-m028-s01.ts` with four check IDs: `M028-S01-ARTIFACT-CONTRACT` (DB rows with `generated_at` after migration have `modification_mode` non-null and `replacement_content` non-null; skip if no DB), `M028-S01-NO-WHY-IN-RENDER` (build a dry-run PageSuggestionGroup with realistic replacement content, call `formatPageComment`, assert result has no `WHY:` or `**Why:**`; this is a pure-code check requiring no DB), `M028-S01-PR-CITATIONS` (dry-run output contains at least one PR citation link `https://github.com/`; pure-code check), `M028-S01-MODE-FIELD` (DB rows have `modification_mode IN ('section', 'page')`; skip if no DB). Export `M028_S01_CHECK_IDS`, `evaluateM028S01()`, `buildM028S01ProofHarness()`. Write CLI runner at bottom. Pure-code checks (NO-WHY-IN-RENDER, PR-CITATIONS) always run; DB checks report `status_code: 'db_unavailable'` when `DATABASE_URL` is absent and mark as skipped (not failed). Write `scripts/verify-m028-s01.test.ts` covering: check ID list has all four IDs; `evaluateM028S01` returns all-passing when given modification-only fixtures (replacementContent="Updated pipeline text", no WHY prefix); `evaluateM028S01` returns M028-S01-NO-WHY-IN-RENDER failing when fixture contains "**Why:**"; envelope shape has `check_ids`, `overallPassed`, `checks` fields. Add `"verify:m028:s01": "bun scripts/verify-m028-s01.ts"` to `package.json` scripts.
  - Verify: `bun test scripts/verify-m028-s01.test.ts` passes; `bun run verify:m028:s01 --json` runs without error; pure-code checks always pass
  - Done when: Test file passes; `verify:m028:s01` alias in package.json runs; pure-code checks M028-S01-NO-WHY-IN-RENDER and M028-S01-PR-CITATIONS pass in every environment

## Files Likely Touched

- `src/db/migrations/030-wiki-modification-artifacts.sql` (new)
- `src/db/migrations/030-wiki-modification-artifacts.down.sql` (new)
- `src/knowledge/wiki-update-types.ts`
- `src/knowledge/wiki-update-generator.ts`
- `src/knowledge/wiki-update-generator.test.ts`
- `src/knowledge/wiki-publisher-types.ts`
- `src/knowledge/wiki-publisher.ts`
- `src/knowledge/wiki-publisher.test.ts`
- `scripts/generate-wiki-updates.ts`
- `scripts/verify-m028-s01.ts` (new)
- `scripts/verify-m028-s01.test.ts` (new)
- `package.json`
