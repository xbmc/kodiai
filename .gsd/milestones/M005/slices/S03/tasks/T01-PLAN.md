# T01: 32-multi-language-context-and-localized-output 01

**Slice:** S03 — **Milestone:** M005

## Description

Add programming language classification to diff analysis and outputLanguage to the config schema.

Purpose: Provide the data layer that language-aware prompt guidance (Plan 02) and handler wiring (Plan 03) will consume. Files are classified by extension during the existing `analyzeDiff()` loop, adding zero extra I/O. The config field enables user-controlled prose localization.

Output: Extended `DiffAnalysis` interface with `filesByLanguage`, exported `classifyFileLanguage()` and `classifyLanguages()` utilities, `review.outputLanguage` config field, and tests for all.

## Must-Haves

- [ ] "Each changed file in a PR is classified by programming language via extension lookup"
- [ ] "DiffAnalysis result contains a filesByLanguage record grouping files by detected language"
- [ ] "The config schema accepts review.outputLanguage with default 'en'"
- [ ] "Unknown or extensionless files are classified as 'Unknown' and do not break analysis"

## Files

- `src/execution/diff-analysis.ts`
- `src/execution/diff-analysis.test.ts`
- `src/execution/config.ts`
- `src/execution/config.test.ts`
