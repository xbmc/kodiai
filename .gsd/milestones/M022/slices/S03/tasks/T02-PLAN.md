# T02: 108-pr-issue-linking 02

**Slice:** S03 — **Milestone:** M022

## Description

Wire PR-issue linking into the review pipeline: extend buildReviewPrompt with a linked issues section, call linkPRToIssues in review.ts, and inject issueStore into the review handler's dependencies.

Purpose: This connects the building blocks from Plan 01 into the live review flow so that every PR review prompt is enriched with linked issue context when available.

Output: Extended review prompt builder, wired review handler, updated index.ts dependency injection.

## Must-Haves

- [ ] "buildReviewPrompt accepts a new optional linkedIssues parameter with referenced and semantic match arrays"
- [ ] "When linkedIssues has referenced issues, a 'Referenced Issues' section is included in the review prompt framed as 'this PR addresses these issues'"
- [ ] "When linkedIssues has semantic matches, a 'Possibly Related Issues' section is included framed as secondary context"
- [ ] "Each issue is displayed as: #N (state) -- 'title' with description summary"
- [ ] "Semantic matches include similarity percentage"
- [ ] "The prompt instructs the reviewer to assess coverage: whether linked issues appear addressed, partially addressed, or unrelated"
- [ ] "If no linked issues exist (both arrays empty), no section is added to the prompt (zero noise)"
- [ ] "The review handler calls linkPRToIssues before buildReviewPrompt and passes the result"
- [ ] "IssueStore and EmbeddingProvider are wired into the review handler via dependency injection from index.ts"
- [ ] "Issue linking failure does not block the review (fail-open)"

## Files

- `src/execution/review-prompt.ts`
- `src/handlers/review.ts`
- `src/index.ts`
