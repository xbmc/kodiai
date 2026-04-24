---
id: T01
parent: S02
milestone: M062
key_files:
  - src/lib/review-utils.ts
  - src/lib/review-utils.test.ts
  - src/lib/partial-review-formatter.ts
  - src/lib/partial-review-formatter.test.ts
key_decisions:
  - Made `src/lib/review-utils.ts` the single wording source for bounded first-pass public-summary and Review Details text.
  - Degraded missing scope fields to explicit 'not confirmed from structured evidence' wording so the visible contract never overclaims exhaustive review.
duration: 
verification_result: passed
completed_at: 2026-04-24T04:29:42.288Z
blocker_discovered: false
---

# T01: Unified bounded first-pass wording in shared formatter helpers and locked the visible-state contract with formatter tests.

**Unified bounded first-pass wording in shared formatter helpers and locked the visible-state contract with formatter tests.**

## What Happened

I treated the formatter seam as the contract boundary and wrote the failing tests first in `src/lib/review-utils.test.ts` and `src/lib/partial-review-formatter.test.ts`. Those tests now lock timeout and max-turns wording, explicit continuation state, and malformed-scope degradation so the visible review surfaces cannot imply exhaustive coverage when `coveredScope` or `remainingScope` is missing.

To make the wording single-sourced, I refactored `src/lib/review-utils.ts` to expose a shared public-summary helper and to drive detail-line rendering from the same bounded first-pass contract. The helper now truthfully reports covered scope, remaining scope, and continuation status, and it degrades to `not confirmed from structured evidence` instead of inventing scope. Zero-evidence failure continues to stay on the hard-failure path with explicit ineligible wording.

I then updated `src/lib/partial-review-formatter.ts` to consume the shared public-summary helper instead of keeping branch-local prose. That removes the old drift seam where the blockquote summary omitted continuation state or rendered remaining scope differently from Review Details. No handler control flow was changed in this task; the broader handler suite stayed green against the new formatter contract.

## Verification

Ran the task formatter suite and the slice-level verification commands after the final code changes. `bun test ./src/lib/review-utils.test.ts ./src/lib/partial-review-formatter.test.ts` passed with 21/21 tests, including explicit assertions for timeout, max-turns, zero-evidence failure, missing remaining scope, missing covered scope, and continuation pending/stopped wording. `bun test ./src/handlers/review.test.ts` passed with 133/133 tests, confirming the formatter refactor did not break current handler behavior. `bun run tsc --noEmit` completed successfully with exit code 0.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/lib/review-utils.test.ts ./src/lib/partial-review-formatter.test.ts` | 0 | ✅ pass | 30ms |
| 2 | `bun test ./src/handlers/review.test.ts` | 0 | ✅ pass | 6170ms |
| 3 | `bun run tsc --noEmit` | 0 | ✅ pass | 10040ms |

## Deviations

None.

## Known Issues

`lsp diagnostics` could not run because no language server was available in this environment; verification relied on the project test and TypeScript compile gates instead.

## Files Created/Modified

- `src/lib/review-utils.ts`
- `src/lib/review-utils.test.ts`
- `src/lib/partial-review-formatter.ts`
- `src/lib/partial-review-formatter.test.ts`
