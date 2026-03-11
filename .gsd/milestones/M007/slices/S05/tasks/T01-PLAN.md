# T01: 34-structured-review-template 01

**Slice:** S05 — **Milestone:** M007

## Description

Rewrite the standard-mode summary comment prompt and add a reviewed-categories helper

Purpose: Instruct Claude to produce the five-section structured template (What Changed, Strengths, Observations, Suggestions, Verdict) instead of the current issues-only format, and dynamically generate the FORMAT-02 "Reviewed: ..." checklist from diff analysis data.

Output: Updated review-prompt.ts with new template instructions and buildReviewedCategoriesLine() export; updated review-prompt.test.ts with tests for both.

## Must-Haves

- [ ] "Standard-mode review prompt instructs Claude to produce five ordered sections: What Changed, Strengths, Observations, Suggestions, Verdict"
- [ ] "Prompt includes a dynamically-built 'Reviewed: ...' checklist line derived from DiffAnalysis.filesByCategory"
- [ ] "Prompt instructs Strengths items to use :white_check_mark: prefix for verified positives"
- [ ] "Enhanced mode prompt is unchanged (no summary comment, no new sections)"

## Files

- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`
