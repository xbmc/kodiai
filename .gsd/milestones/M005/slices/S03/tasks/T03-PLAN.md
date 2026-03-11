# T03: 32-multi-language-context-and-localized-output 03

**Slice:** S03 — **Milestone:** M005

## Description

Wire language classification data and output language config into the review and mention handlers.

Purpose: Plan 01 produces `filesByLanguage` on `DiffAnalysis` and `outputLanguage` on config. Plan 02 produces the prompt builders that consume them. This plan connects the data to the builders in the handler layer, completing the end-to-end feature.

Output: Updated `buildReviewPrompt()` call in review.ts with two new fields. Updated `buildMentionPrompt()` call in mention.ts with one new field.

## Must-Haves

- [ ] "The review handler passes filesByLanguage from DiffAnalysis to buildReviewPrompt"
- [ ] "The review handler passes config.review.outputLanguage to buildReviewPrompt"
- [ ] "The mention handler passes config.review.outputLanguage to buildMentionPrompt"
- [ ] "Existing review and mention flows work unchanged when outputLanguage is default 'en'"

## Files

- `src/handlers/review.ts`
- `src/handlers/mention.ts`
