# T01: 36-verdict-and-merge-confidence 01

**Slice:** S07 — **Milestone:** M006

## Description

Rewrite the Verdict section template, add a Verdict Logic prompt section, update the Suggestions section template, and update hard requirements in `buildReviewPrompt()` to deliver explicit merge recommendations driven by blocker counts.

Purpose: Replace subjective verdict labels ("Looks good", "Needs changes", "Blocker") with merge-actionable labels ("Ready to merge", "Ready to merge with minor items", "Address before merging") and give Claude deterministic rules for selecting the verdict based on CRITICAL/MAJOR finding counts under ### Impact.
Output: Updated prompt template and comprehensive tests.

## Must-Haves

- [ ] "Verdict template shows three merge-recommendation states: Ready to merge, Ready to merge with minor items, Address before merging"
- [ ] "Verdict Logic section defines blocker as CRITICAL or MAJOR under Impact and provides deterministic counting rules"
- [ ] "Suggestions template requires Optional: or Future consideration: prefix on every item"
- [ ] "Hard requirements enforce blocker-driven verdict and non-blocking suggestions"

## Files

- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`
