---
id: T02
parent: S03
milestone: M048
key_files:
  - src/lib/review-boundedness.ts
  - src/lib/review-boundedness.test.ts
  - src/lib/review-utils.ts
  - src/lib/review-utils.test.ts
  - src/execution/review-prompt.ts
  - src/execution/review-prompt.test.ts
  - src/handlers/review.ts
  - src/handlers/review.test.ts
  - docs/configuration.md
key_decisions:
  - Recorded D114: resolve one shared review-boundedness contract in the handler and reuse it for prompt instructions, Review Details rendering, and summary backfill.
  - Kept summary backfill fail-open: if the published summary body is malformed or missing `## What Changed`, the disclosure helper leaves the summary untouched instead of fabricating output.
duration: 
verification_result: mixed
completed_at: 2026-04-13T04:15:53.722Z
blocker_discovered: false
---

# T02: Added a shared bounded-review disclosure contract across prompt generation, Review Details, and summary publication.

**Added a shared bounded-review disclosure contract across prompt generation, Review Details, and summary publication.**

## What Happened

I started from the failing bounded-review contract tests and implemented a new shared helper in `src/lib/review-boundedness.ts` that normalizes requested versus effective profile state, large-PR triage coverage, timeout reduction metadata, reason codes, and the single disclosure sentence used on GitHub-visible surfaces. I then wired that contract into the three product paths the task called out: `src/execution/review-prompt.ts` now adds a bounded-review disclosure section only for standard-mode reviews that truly need one exact `## What Changed` sentence; `src/lib/review-utils.ts` now renders requested/effective profile lines plus bounded review and timeout status in Review Details while preserving the quiet single-profile line for small unbounded reviews; and `src/handlers/review.ts` now resolves the contract once from live handler state, logs bounded-review observability data, passes the contract into the prompt and Review Details builders, and backfills the exact sentence into the published summary exactly once when the model omits it. I also extended the handler suite with live publication-path tests covering explicit-profile skip, timeout auto-reduction, and the small-review silent path, and updated `docs/configuration.md` so the checked-in config reference matches the shipped truthfulness behavior for large PRs and timeout auto-reduction.

## Verification

Task-level verification passed with the focused command `bun test ./src/lib/review-boundedness.test.ts ./src/lib/review-utils.test.ts ./src/execution/review-prompt.test.ts ./src/handlers/review.test.ts`, which now includes helper-level contract checks plus end-to-end handler publication coverage for explicit-profile skip, timeout auto-reduction, and small-review silence. A fresh `bun run tsc --noEmit` also passed after the final code, test, and documentation changes. Slice-level intermediate verification partially passed: `bun test ./src/execution/config.test.ts ./src/lib/review-boundedness.test.ts ./src/lib/review-utils.test.ts ./src/execution/review-prompt.test.ts ./src/handlers/review.test.ts ./scripts/verify-m048-s03.test.ts` passed, while both `bun run verify:m048:s03 -- --json` and `bun run verify:m048:s03 -- --review-output-key "$REVIEW_OUTPUT_KEY" --json` still fail because the verifier script is not present yet and is scheduled for T03.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/lib/review-boundedness.test.ts ./src/lib/review-utils.test.ts ./src/execution/review-prompt.test.ts ./src/handlers/review.test.ts` | 0 | ✅ pass | 5221ms |
| 2 | `bun run tsc --noEmit` | 0 | ✅ pass | 8323ms |
| 3 | `bun test ./src/execution/config.test.ts ./src/lib/review-boundedness.test.ts ./src/lib/review-utils.test.ts ./src/execution/review-prompt.test.ts ./src/handlers/review.test.ts ./scripts/verify-m048-s03.test.ts` | 0 | ✅ pass | 4436ms |
| 4 | `bun run verify:m048:s03 -- --json` | 1 | ❌ fail | 15ms |
| 5 | `bun run verify:m048:s03 -- --review-output-key "$REVIEW_OUTPUT_KEY" --json` | 1 | ❌ fail | 13ms |

## Deviations

Added end-to-end handler publication tests for manual strict skip, auto-reduced strict reviews, and small published reviews so the summary backfill path is covered in addition to the planned helper/prompt/Review Details contract tests.

## Known Issues

`verify:m048:s03` is still not implemented, so both slice-level verifier commands fail with `Script not found "verify:m048:s03"`. That is expected remaining slice work for T03, not a blocker discovered by T02.

## Files Created/Modified

- `src/lib/review-boundedness.ts`
- `src/lib/review-boundedness.test.ts`
- `src/lib/review-utils.ts`
- `src/lib/review-utils.test.ts`
- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
- `docs/configuration.md`
