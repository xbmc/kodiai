---
estimated_steps: 6
estimated_files: 4
---

# T03: Publisher Renderer, Types, and Test Rewrite

**Slice:** S01 — Modification Artifact Contract Through Real Entry Points
**Milestone:** M028

## Description

Fix the published output WHY: violation. The publisher is the final layer before GitHub-visible output. Currently `formatPageComment()` renders `**Why:** {s.whySummary}` and voice mismatch warning prose. `PageSuggestionGroup.suggestions` uses `whySummary: string`. This task updates publisher types, the DB SELECT, the renderer, the CLI summary language, and rewrites the publisher test suite to lock the modification-only contract with explicit negative guards.

## Steps

1. In `wiki-publisher-types.ts`, update the `PageSuggestionGroup.suggestions` item shape: replace `whySummary: string` with `replacementContent: string`; add `modificationMode: 'section' | 'page'` to the group-level type (or per-suggestion — group level is cleaner since all sections in a page share a mode). `voiceMismatchWarning: boolean` stays on the type for internal tracking but will not be rendered.

2. In `wiki-publisher.ts`, update the DB SELECT query to include `replacement_content, modification_mode` alongside `suggestion` (keep `suggestion` in the SELECT for backward compatibility with old rows). When building `groupMap` entries, set:
   - `replacementContent: (row.replacement_content as string | null) ?? (row.suggestion as string)` (fallback to legacy `suggestion` column for rows predating migration 030)
   - Determine `modificationMode` from the first row's `modification_mode` field with fallback to `'section'`

3. Rewrite `formatPageComment()`:
   - Remove the `lines.push("", `**Why:** ${s.whySummary}`)` line (the only content violation)
   - Remove the voice mismatch warning prose block (`if (s.voiceMismatchWarning) { lines.push(...) }`)
   - For page-mode groups (`group.modificationMode === 'page'`): skip per-section `### Heading` headers; render `s.replacementContent` directly under the page title/wiki-link block
   - For section-mode groups: keep the `### ${heading}` header per section, then render `s.replacementContent`
   - Keep PR citation links — these are the allowed trace metadata: `**PRs:** [#N](url) (title)`
   - The wiki URL and page title header remain unchanged

4. Update `formatSummaryTable()`:
   - Rename "Suggestions posted" → "Modifications posted" in the summary line
   - Remove the "Voice Warnings" column from the table header and rows (voice data is internal-only; removing from the rendered table keeps the modification-only contract intact)
   - Update `PagePostResult` in `wiki-publisher-types.ts` if needed (the `hasVoiceWarnings` field can stay internally but doesn't need a rendered column)

5. In `scripts/generate-wiki-updates.ts`, update the CLI summary block: "Suggestions generated" → "Modifications generated", "Suggestions dropped" → "Modifications dropped (ungrounded)". Also update the console log line `mode: ${dryRun ? "dry-run" : "live"}` to no change needed. Ensure the summary uses `result.modificationsGenerated` / `result.modificationsDropped` field names (matching T01/T02 type changes).

6. Rewrite `wiki-publisher.test.ts`:
   - Update `makeGroup()` helper: replace `whySummary` with `replacementContent`; add `modificationMode: 'section' as const` to the group
   - In every `formatPageComment` test, add `expect(result).not.toContain("**Why:**")` as a required negative contract guard
   - Add `expect(result).not.toContain(":warning: **Voice mismatch**")` to the "omits voice mismatch warning" test
   - Remove the test that asserts "includes voice mismatch warning when flag is true" OR rewrite it to verify the internal field exists but the output does not contain the warning (the internal `voiceMismatchWarning: true` fixture is fine, but `expect(result).toContain(":warning:")` must become `expect(result).not.toContain(":warning:")`)
   - Update the page-mode test (new test): create a `makeGroup` with `modificationMode: 'page'` and a single suggestion with `sectionHeading: null`; assert `expect(result).not.toContain("### Introduction")` (no section header for page mode) and `expect(result).toContain(s.replacementContent)`
   - Update the `formatSummaryTable` tests to match the new column headers (no "Voice Warnings" column)
   - Update `createWikiPublisher` test fixtures: `why_summary` → `replacement_content` in mock SQL rows
   - Keep all pre-flight, dry-run, full-publish-flow, and no-suggestions tests — just update fixtures

## Must-Haves

- [ ] `PageSuggestionGroup.suggestions[*].replacementContent: string` (no `whySummary`)
- [ ] `formatPageComment()` produces no `**Why:**` line
- [ ] `formatPageComment()` produces no `:warning: **Voice mismatch**` prose
- [ ] `formatPageComment()` renders page-mode groups without per-section `### Heading` headers
- [ ] `formatSummaryTable()` uses "Modifications" language and omits Voice Warnings column
- [ ] Publisher DB SELECT falls back to `suggestion` column when `replacement_content` is null (backward compat with old rows)
- [ ] Publisher tests include `expect(result).not.toContain("**Why:**")` in every `formatPageComment` test
- [ ] CLI summary in `generate-wiki-updates.ts` uses "Modifications" language

## Verification

- `bun test src/knowledge/wiki-publisher.test.ts` — all tests pass
- `grep -n '"[*][*]Why:[*][*]"' src/knowledge/wiki-publisher.test.ts` returns zero hits (no positive WHY: assertions remain)
- `grep -n 'not.toContain.*Why' src/knowledge/wiki-publisher.test.ts` returns hits (negative guards present)
- `bunx tsc --noEmit` exits 0

## Inputs

- `src/knowledge/wiki-update-types.ts` (T01 output) — `UpdateSuggestion` with `modificationMode`, `replacementContent`, nullable `whySummary`
- `src/knowledge/wiki-publisher-types.ts` — current shape with `whySummary: string`
- `src/knowledge/wiki-publisher.ts` — current `formatPageComment` with `**Why:**` and voice mismatch prose
- `src/knowledge/wiki-publisher.test.ts` — existing tests with `whySummary` fixtures to update

## Expected Output

- `src/knowledge/wiki-publisher-types.ts` — `PageSuggestionGroup` uses `replacementContent`, includes `modificationMode`
- `src/knowledge/wiki-publisher.ts` — `formatPageComment` emits modification-only output; DB SELECT has backward-compat fallback
- `src/knowledge/wiki-publisher.test.ts` — all tests pass with negative `**Why:**` guards throughout
- `scripts/generate-wiki-updates.ts` — CLI summary uses "Modifications" language
