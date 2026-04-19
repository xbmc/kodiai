# S03: Residual operator truthfulness cleanup — UAT

**Milestone:** M051
**Written:** 2026-04-19T00:54:16.506Z

# UAT — M051/S03 Residual operator truthfulness cleanup

## Preconditions
- Repository checkout includes the M051/S03 changes.
- Dependencies are installed and `bun` is available from the repo root.
- No live Azure or GitHub runtime access is required; this UAT exercises the shipped parser/verifier/doc/type surfaces locally.

## Test Case 1 — Incomplete correlated phase evidence is rejected without hiding the matched row
1. Run `bun test ./src/review-audit/phase-timing-evidence.test.ts`.
2. Observe the cases for missing `conclusion`, missing `published`, and combined malformed payload drift.
3. Expected outcome: the suite passes and proves matched rows missing interpretation fields return `invalid-phase-payload`, list the missing-field issues, and still preserve matched evidence plus normalized phases for diagnosis.

## Test Case 2 — Verifier wording distinguishes no evidence, incomplete evidence, and publication-unknown states
1. Run `bun test ./scripts/verify-m048-s01.test.ts ./scripts/verify-m048-s03.test.ts`.
2. Inspect the passing assertions for:
   - true no-evidence path → `no correlated phase evidence available`
   - incomplete-but-present evidence → `unknown (...)` summary rather than no-evidence wording
   - `published === null` on success/timeout evidence → `publication unknown`
   - downstream S03 report reuse of the exact S01 `outcome.summary` string.
3. Expected outcome: all tests pass and demonstrate tri-state publication wording plus verbatim reuse on the downstream report surface.

## Test Case 3 — Adjacent M048 verifier/report consumers stay green
1. Run `bun test ./scripts/verify-m048-s02.test.ts ./src/lib/review-utils.test.ts ./src/handlers/review.test.ts`.
2. Expected outcome: all tests pass, proving the truthfulness cleanup did not regress compare-report output, timeout Review Details formatting, review-requested gating, or timeout-resilience flows.

## Test Case 4 — Runbook/docs surface matches the surviving verifier family
1. Run `! rg -n "^## M050 Timeout-Truth Verifier Surfaces$" docs/runbooks/review-requested-debug.md && rg -n "^## M048 .*Verifier Surfaces$|verify:m048:s01|verify:m048:s02|verify:m048:s03" docs/runbooks/review-requested-debug.md`.
2. Expected outcome: the command exits 0, produces no stale `M050 Timeout-Truth Verifier Surfaces` heading, and shows the `M048 ... Verifier Surfaces` heading plus the three `verify:m048:*` commands.

## Test Case 5 — Type cleanup leaves the handler/build surface consistent
1. Run `bun run tsc --noEmit`.
2. Expected outcome: TypeScript exits 0, confirming `src/handlers/review.ts` now reuses the exported `TimeoutReviewDetailsProgress` type without introducing type drift.

## Edge Cases Covered
- Correlated rows with both interpretation fields missing and other malformed payload issues still stay visible as matched-but-invalid evidence.
- `published: null` is treated as `publication unknown`, not as `no published output`.
- Downstream report reuse is pinned so wording drift becomes a regression instead of a silent second truth path.
