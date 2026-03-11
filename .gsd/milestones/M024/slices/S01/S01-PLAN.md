# S01: Pr Review Epistemic Guardrails

**Goal:** Add epistemic boundary rules to the PR review prompt so the LLM distinguishes diff-visible facts from external knowledge claims.
**Demo:** Add epistemic boundary rules to the PR review prompt so the LLM distinguishes diff-visible facts from external knowledge claims.

## Must-Haves


## Tasks

- [x] **T01: 115-pr-review-epistemic-guardrails 01** `est:12min`
  - Add epistemic boundary rules to the PR review prompt so the LLM distinguishes diff-visible facts from external knowledge claims.

Purpose: Prevent hallucinated assertions about version numbers, API release dates, or library behavior. The PR #27932 incident where the bot fabricated libxkbcommon version numbers as [CRITICAL] findings is the direct motivation. This is the first line of defense — prompt changes that teach the LLM epistemic discipline before any post-generation filtering.

Output: Updated review-prompt.ts with new buildEpistemicBoundarySection() helper, rewritten tone/hedging section, diff-grounded dep-bump focus lists with epistemic reinforcement, footnote citation format in security/changelog sections, diff-grounded conventional commit guidance, and comprehensive tests.

## Files Likely Touched

- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`
