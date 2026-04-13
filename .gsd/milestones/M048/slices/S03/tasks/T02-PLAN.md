---
estimated_steps: 14
estimated_files: 9
skills_used:
  - test-driven-development
  - verification-before-completion
---

# T02: Thread one bounded-review contract through prompt, Review Details, and summary publication

**Slice:** S03 — Truthful Bounded Reviews and Synchronize Continuity
**Milestone:** M048

## Description

Strict reviews are already bounded on large PRs, and timeout pressure can further reduce scope, but today's GitHub-visible surfaces do not explain that truth clearly. This task should define one small bounded-review contract, reuse it across the handler, prompt, and Review Details paths, and preserve the small-PR fast path so S03 improves truthfulness without adding normal-case noise or latency.

## Steps

1. Add failing contract tests in `src/lib/review-boundedness.test.ts`, `src/lib/review-utils.test.ts`, `src/execution/review-prompt.test.ts`, and `src/handlers/review.test.ts` for large-PR strict reviews, timeout-driven reductions, explicit-profile skip paths, and small PRs that should remain silent.
2. Extract a focused bounded-review helper in `src/lib/review-boundedness.ts` that captures requested versus effective profile, large-PR triage coverage, timeout reduction or skip reason, and the exact disclosure sentence required on GitHub-visible surfaces.
3. Thread that contract through `src/handlers/review.ts`, `src/execution/review-prompt.ts`, and `src/lib/review-utils.ts` so Review Details shows requested/effective behavior, the prompt asks for one exact `## What Changed` disclosure when needed, and summary publication backfills the sentence exactly once if the model omits it.
4. Update `docs/configuration.md` to clarify that large-PR triage already bounds file coverage and that any `timeout.autoReduceScope` or explicit strict bounded behavior is disclosed instead of implying exhaustive review.
5. Re-run focused tests and `tsc`, verifying that bounded cases become explicit while the small-PR path stays clean and fast.

## Must-Haves

- [ ] One bounded-review contract powers prompt, Review Details, summary injection, and later verifier checks.
- [ ] Large or timeout-bounded explicit strict reviews disclose requested versus actual scope clearly, exactly once, on GitHub-visible output.
- [ ] Small PRs and unbounded reviews do not gain extra disclosure noise or hidden new normal-path work.

## Inputs

- `src/handlers/review.ts`
- `src/lib/review-utils.ts`
- `src/lib/review-utils.test.ts`
- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`
- `src/handlers/review.test.ts`
- `docs/configuration.md`

## Expected Output

- `src/lib/review-boundedness.ts`
- `src/lib/review-boundedness.test.ts`
- `src/handlers/review.ts`
- `src/lib/review-utils.ts`
- `src/lib/review-utils.test.ts`
- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`
- `src/handlers/review.test.ts`
- `docs/configuration.md`

## Verification

- `bun test ./src/lib/review-boundedness.test.ts ./src/lib/review-utils.test.ts ./src/execution/review-prompt.test.ts ./src/handlers/review.test.ts`
- `bun run tsc --noEmit`

## Observability Impact

- Signals added or changed: bounded-review reason codes or disclosure flags in the review handler, plus GitHub-visible requested/effective scope lines in Review Details and the summary comment.
- How a future agent inspects this: rerun the focused tests, inspect the rendered Review Details block, and confirm the disclosure sentence appears once in `## What Changed` only when the contract says the review was bounded.
- Failure state exposed: duplicate disclosure injection, missing requested-versus-effective wording, and accidental small-PR disclosure noise become visible in deterministic tests instead of only in live PRs.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| Large-PR triage and timeout estimation inside `src/handlers/review.ts` | Fail open to existing review behavior and surface missing bounded-disclosure tests rather than fabricating requested/effective state. | Preserve current timeout handling; disclosure can describe reduction but must not hide a timed-out partial review. | Treat incomplete triage/profile data as unavailable and skip disclosure rather than overclaiming exhaustive review. |
| Summary publication and Review Details helpers in `src/lib/review-utils.ts` | Inject the exact disclosure sentence once or leave the review truthful-but-quiet; never duplicate or corrupt the summary body. | Keep publication fallback behavior intact so R043/R044 still produce one visible GitHub outcome. | Refuse malformed boundedness payloads by omitting the disclosure and failing deterministic tests. |

## Load Profile

- **Shared resources**: prompt tokens, GitHub summary-comment body size, Review Details length, and the existing review publication path.
- **Per-operation cost**: one small boundedness computation plus conditional disclosure rendering only when the review was actually bounded.
- **10x breakpoint**: large file lists or duplicate disclosure text will hit comment-size/noise limits before CPU does, so the task must keep the small-PR path silent and cap any bounded-file detail reuse to existing surfaces.

## Negative Tests

- **Malformed inputs**: missing requested/effective profile data, empty large-PR triage payloads, and malformed bounded-review helper output.
- **Error paths**: auto-reduced scope, explicit strict profile with large-PR triage, explicit strict profile whose timeout reduction is skipped, and model output that omits the required disclosure sentence.
- **Boundary conditions**: small PRs with no boundedness, bounded reviews that already contain the disclosure sentence once, and clean-review paths where Review Details is standalone because no summary comment exists.
