# T01: 38-delta-re-review-formatting 01

**Slice:** S09 — **Milestone:** M006

## Description

Add a delta-focused re-review template to the prompt builder that replaces the standard five-section template when incremental re-review data is available, and thread the delta context from review.ts to the prompt builder.

Purpose: Re-reviews currently use the same five-section template as initial reviews, repeating all findings even when most are unchanged. This plan adds a distinct delta template (What Changed, New Findings, Resolved Findings, Still Open, Verdict Update) that focuses maintainer attention on what actually changed.

Output: `buildReviewPrompt()` conditionally produces the delta template when `deltaContext` is provided; `review.ts` passes hoisted prior findings to the prompt builder; new tests verify both paths.

## Must-Haves

- [ ] "Re-reviews with prior findings produce a delta template instead of the five-section template"
- [ ] "The delta template has sections: Re-review header, What Changed, New Findings, Resolved Findings, Still Open, Verdict Update"
- [ ] "Prior findings are listed in the prompt so Claude can classify findings as new/resolved/still-open"
- [ ] "Delta verdict describes transition (New blockers found / Blockers resolved / Still ready), not absolute state"
- [ ] "Initial reviews are unaffected -- still use the five-section template"

## Files

- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`
- `src/handlers/review.ts`
