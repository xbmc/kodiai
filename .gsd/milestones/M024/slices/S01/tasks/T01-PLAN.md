# T01: 115-pr-review-epistemic-guardrails 01

**Slice:** S01 — **Milestone:** M024

## Description

Add epistemic boundary rules to the PR review prompt so the LLM distinguishes diff-visible facts from external knowledge claims.

Purpose: Prevent hallucinated assertions about version numbers, API release dates, or library behavior. The PR #27932 incident where the bot fabricated libxkbcommon version numbers as [CRITICAL] findings is the direct motivation. This is the first line of defense — prompt changes that teach the LLM epistemic discipline before any post-generation filtering.

Output: Updated review-prompt.ts with new buildEpistemicBoundarySection() helper, rewritten tone/hedging section, diff-grounded dep-bump focus lists with epistemic reinforcement, footnote citation format in security/changelog sections, diff-grounded conventional commit guidance, and comprehensive tests.

## Must-Haves

- [ ] "Review prompt contains explicit epistemic boundary rules separating diff-visible facts from external knowledge claims"
- [ ] "buildEpistemicBoundarySection() exists as a dedicated exported helper function"
- [ ] "Epistemic section is placed BEFORE conventional commit context in prompt assembly order"
- [ ] "buildToneGuidelinesSection() no longer contains blanket 'Do NOT use hedged or vague language' — replaced with epistemic principle"
- [ ] "buildDepBumpSection() major-bump and minor/patch-bump focus lists are rewritten to be diff-grounded with epistemic reinforcement"
- [ ] "buildSecuritySection() and buildChangelogSection() output footnote citations with source URLs"
- [ ] "Conventional commit typeGuidance strings are rewritten to be diff-grounded"
- [ ] "General programming knowledge (null deref, SQL injection) is explicitly allowed — boundary targets specific external claims about libraries, versions, APIs, dates"

## Files

- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`
