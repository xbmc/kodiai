# T02: 27-context-aware-reviews 02

**Slice:** S02 — **Milestone:** M004

## Description

Wire path instruction matching, profile preset resolution, and diff analysis into the review prompt builder and handler. Enrich the review prompt with contextual intelligence.

Purpose: Complete the context-aware review pipeline so reviews adapt to repo-specific conventions and risk patterns.
Output: Enriched review prompt with diff analysis context and path-scoped instructions, handler wiring for the complete pipeline.

## Must-Haves

- [ ] "Path instructions from config are matched against changed files using picomatch with negation support and cumulative matching"
- [ ] "Profile preset resolves to severity/maxComments/focusAreas/ignoredAreas defaults that explicit config overrides"
- [ ] "Diff analysis runs deterministically in handler before prompt building using git diff --numstat output"
- [ ] "Review prompt contains Change Context section with file breakdown, metrics, and risk signals"
- [ ] "Review prompt contains Path-Specific Review Instructions section with matched instructions grouped by pattern"
- [ ] "Path instructions section respects 3000-char budget with priority-based truncation"
- [ ] "Unmatched files receive standard review without extra instructions"
- [ ] "Analysis metadata is implicit only -- no meta-commentary about what analysis was performed"

## Files

- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`
- `src/handlers/review.ts`
