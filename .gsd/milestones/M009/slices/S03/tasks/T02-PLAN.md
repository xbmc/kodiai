# T02: 53-dependency-bump-detection 02

**Slice:** S03 — **Milestone:** M009

## Description

Wire the dependency bump detection pipeline into the review handler and prompt builder so detected bumps produce dependency-aware review instructions.

Purpose: Complete the end-to-end integration so Kodiai reviews provide tailored feedback for dependency bump PRs.
Output: Modified review.ts (detection wiring), modified review-prompt.ts (prompt section), new tests.

## Must-Haves

- [ ] "When a Dependabot PR reaches the review handler, depBumpContext is populated and passed to buildReviewPrompt"
- [ ] "When depBumpContext is present, the review prompt includes a Dependency Bump Context section"
- [ ] "Major bumps produce a breaking change warning in the prompt section"
- [ ] "Minor/patch bumps produce low-risk guidance in the prompt section"
- [ ] "When detection returns null (non-dep PR), no depBumpContext is added and no latency is introduced"
- [ ] "Detection failure is caught and logged as warning (fail-open pattern)"

## Files

- `src/handlers/review.ts`
- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`
