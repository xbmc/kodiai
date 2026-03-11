# S03: Multi Language Context And Localized Output

**Goal:** Add programming language classification to diff analysis and outputLanguage to the config schema.
**Demo:** Add programming language classification to diff analysis and outputLanguage to the config schema.

## Must-Haves


## Tasks

- [x] **T01: 32-multi-language-context-and-localized-output 01** `est:2min`
  - Add programming language classification to diff analysis and outputLanguage to the config schema.

Purpose: Provide the data layer that language-aware prompt guidance (Plan 02) and handler wiring (Plan 03) will consume. Files are classified by extension during the existing `analyzeDiff()` loop, adding zero extra I/O. The config field enables user-controlled prose localization.

Output: Extended `DiffAnalysis` interface with `filesByLanguage`, exported `classifyFileLanguage()` and `classifyLanguages()` utilities, `review.outputLanguage` config field, and tests for all.
- [x] **T02: 32-multi-language-context-and-localized-output 02** `est:3min`
  - Add language-specific review guidance and output language localization to the prompt builders.

Purpose: CTX-06 requires the review prompt to inject language-specific coding guidance (Python, Go, Rust, Java, C/C++, Ruby, PHP, Swift) while preserving the canonical severity/category taxonomy. LANG-01 requires a prompt instruction that localizes explanatory prose to the configured language. Both are prompt-level features that do not change control flow.

Output: `buildLanguageGuidanceSection()` and `buildOutputLanguageSection()` helpers in review-prompt.ts, updated `buildReviewPrompt()` context type, outputLanguage support in mention-prompt.ts, and tests for all.
- [x] **T03: 32-multi-language-context-and-localized-output 03** `est:2min`
  - Wire language classification data and output language config into the review and mention handlers.

Purpose: Plan 01 produces `filesByLanguage` on `DiffAnalysis` and `outputLanguage` on config. Plan 02 produces the prompt builders that consume them. This plan connects the data to the builders in the handler layer, completing the end-to-end feature.

Output: Updated `buildReviewPrompt()` call in review.ts with two new fields. Updated `buildMentionPrompt()` call in mention.ts with one new field.

## Files Likely Touched

- `src/execution/diff-analysis.ts`
- `src/execution/diff-analysis.test.ts`
- `src/execution/config.ts`
- `src/execution/config.test.ts`
- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`
- `src/execution/mention-prompt.ts`
- `src/execution/mention-prompt.test.ts`
- `src/handlers/review.ts`
- `src/handlers/mention.ts`
