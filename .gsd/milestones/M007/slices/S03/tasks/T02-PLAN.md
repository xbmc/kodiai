# T02: 32-multi-language-context-and-localized-output 02

**Slice:** S03 — **Milestone:** M007

## Description

Add language-specific review guidance and output language localization to the prompt builders.

Purpose: CTX-06 requires the review prompt to inject language-specific coding guidance (Python, Go, Rust, Java, C/C++, Ruby, PHP, Swift) while preserving the canonical severity/category taxonomy. LANG-01 requires a prompt instruction that localizes explanatory prose to the configured language. Both are prompt-level features that do not change control flow.

Output: `buildLanguageGuidanceSection()` and `buildOutputLanguageSection()` helpers in review-prompt.ts, updated `buildReviewPrompt()` context type, outputLanguage support in mention-prompt.ts, and tests for all.

## Must-Haves

- [ ] "Language-specific guidance sections appear in the review prompt for detected programming languages"
- [ ] "Guidance sections preserve the canonical severity/category taxonomy in English"
- [ ] "When outputLanguage is non-English, the prompt instructs the LLM to localize prose while keeping severity labels, category labels, code identifiers, and snippets in English"
- [ ] "When outputLanguage is 'en' or absent, no output language section appears in the prompt"
- [ ] "Language guidance is capped to top 5 languages by file count to prevent prompt bloat"

## Files

- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`
- `src/execution/mention-prompt.ts`
- `src/execution/mention-prompt.test.ts`
