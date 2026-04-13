# T02 wrap-up draft

## Status
- Task **not complete**.
- I stopped at the TDD **red** phase due the auto wrap-up threshold.
- No production implementation landed yet for bounded-review wiring.

## Files changed so far
- `src/lib/review-boundedness.test.ts` — new red-phase contract tests using dynamic import so the missing module fails as a test failure, not a module-load error.
- `src/lib/review-utils.test.ts` — added failing expectations for bounded Review Details lines and silent small-PR behavior.
- `src/execution/review-prompt.test.ts` — added failing expectations for a bounded-review disclosure section in the standard summary prompt and silence in enhanced/unbounded cases.

## Red-phase command run
`bun test ./src/lib/review-boundedness.test.ts ./src/lib/review-utils.test.ts ./src/execution/review-prompt.test.ts`

### Current failures captured
1. `src/lib/review-boundedness.test.ts`
   - all tests fail because `src/lib/review-boundedness.ts` does not exist yet (`expect(mod).not.toBeNull()` received `null`).
2. `src/lib/review-utils.test.ts`
   - `formatReviewDetailsSummary` still renders the old single `- Profile:` line and does not render requested/effective bounded-review lines.
3. `src/execution/review-prompt.test.ts`
   - `buildReviewPrompt` does not yet emit a `## Bounded Review Disclosure` section.

## Intended contract shape
I planned the new helper as `src/lib/review-boundedness.ts` with these responsibilities:
- `resolveReviewBoundedness(...)` — compute one reusable bounded-review contract from:
  - requested profile
  - effective profile
  - large-PR triage counts
  - timeout reduction applied / skipped reason
- `buildReviewBoundednessPromptSection(...)` — emit one standard-mode prompt section instructing the model to include **one exact disclosure sentence** in `## What Changed` when disclosure is required.
- `formatReviewBoundednessDetailsLines(...)` — render Review Details requested/effective lines only when disclosure is required, keeping the small/unbounded path quiet.
- `ensureReviewBoundednessDisclosureInSummary(...)` — inject the exact sentence into `## What Changed` once, fail-open when the summary body is malformed, and never duplicate.

## Expected disclosure strings from the red tests
- Large PR explicit strict / timeout skip path:
  - `Requested strict review; effective review remained strict and covered 50/60 changed files via large-PR triage (30 full, 20 abbreviated; 10 not reviewed).`
- Timeout auto-reduced path:
  - `Requested strict review; timeout risk auto-reduced the effective review to minimal and covered 50/60 changed files via large-PR triage (30 full, 20 abbreviated; 10 not reviewed).`

## Next steps for the resume unit
1. Implement `src/lib/review-boundedness.ts` with the contract + render/injection helpers above.
2. Thread the contract through:
   - `src/execution/review-prompt.ts`
   - `src/lib/review-utils.ts`
   - `src/handlers/review.ts`
3. Add/finish handler integration coverage in `src/handlers/review.test.ts`:
   - small PR stays silent
   - large PR strict explicit-profile skip path
   - timeout auto-reduced path
   - summary disclosure injected exactly once when the model omits it
4. Update `docs/configuration.md` for large-PR triage and `timeout.autoReduceScope` truthfulness.
5. Re-run focused tests, then `bun test ./src/lib/review-boundedness.test.ts ./src/lib/review-utils.test.ts ./src/execution/review-prompt.test.ts ./src/handlers/review.test.ts`, then `bun run tsc --noEmit`.

## Important local note
A prior `edit` attempt on `src/execution/review-prompt.test.ts` was interrupted by the wrap-up event; I retried it successfully before saving this draft.
