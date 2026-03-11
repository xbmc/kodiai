# T02: 26-review-mode-severity-control 02

**Slice:** S01 — **Milestone:** M004

## Description

Enrich the review prompt builder with mode-aware instructions for severity classification, focus areas, noise suppression, and comment caps. Wire the new config fields from the handler to the prompt builder.

Purpose: Transform config values into Claude prompt instructions that control review behavior -- all review intelligence lives in the prompt, not in post-processing code.
Output: Updated `buildReviewPrompt()` with conditional prompt sections and updated handler call site.

## Must-Haves

- [ ] "Standard mode review prompt includes [SEVERITY] prefix instructions and severity classification guidelines"
- [ ] "Enhanced mode review prompt includes YAML code block format instructions with severity/category/suggested_action metadata"
- [ ] "Review prompt includes noise suppression rules that unconditionally suppress style-only, trivial renaming, and cosmetic issues"
- [ ] "Review prompt includes severity classification guidelines with deterministic rules and path-aware adjustments"
- [ ] "Review prompt includes focus area instructions when focusAreas is configured, with critical-exception for non-focus categories"
- [ ] "Review prompt includes comment cap instruction based on maxComments config value"
- [ ] "Review prompt includes minLevel filtering instructions when severity.minLevel is above 'minor'"
- [ ] "Enhanced mode prompt instructs Claude NOT to post a summary comment"
- [ ] "Standard mode prompt preserves existing summary comment behavior"
- [ ] "Handler passes new config fields to buildReviewPrompt()"

## Files

- `src/execution/review-prompt.ts`
- `src/handlers/review.ts`
