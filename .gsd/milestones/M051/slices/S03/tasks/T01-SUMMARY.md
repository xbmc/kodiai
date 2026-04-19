---
id: T01
parent: S03
milestone: M051
key_files:
  - src/review-audit/phase-timing-evidence.ts
  - src/review-audit/phase-timing-evidence.test.ts
key_decisions:
  - Validate missing `conclusion` and `published` at the parser seam so downstream verifiers receive `invalid-phase-payload` instead of a false-green `ok` result.
duration: 
verification_result: mixed
completed_at: 2026-04-19T00:40:38.508Z
blocker_discovered: false
---

# T01: Rejected incomplete phase-timing payloads by flagging missing conclusion/published fields and covering the drift with parser regressions.

**Rejected incomplete phase-timing payloads by flagging missing conclusion/published fields and covering the drift with parser regressions.**

## What Happened

Extended `src/review-audit/phase-timing-evidence.test.ts` with red-green regressions for rows missing `conclusion`, missing `published`, and both fields missing while other malformed payload drift is still present. I also updated the fixture helper so tests can omit interpretation fields from the simulated Azure payload instead of defaulting them back in, which let the new regressions reproduce the current false-green behavior precisely.

Then I updated `src/review-audit/phase-timing-evidence.ts` at the parser seam: `buildPhaseTimingEvidence()` now derives `conclusion` and `published` once, appends named payload issues when either field is absent or malformed, and still preserves the selected row identity, correlation data, and normalized phase list in `evidence`. That keeps matched-but-invalid payloads visible for operator diagnosis instead of collapsing them into a false-green `ok` result.

## Verification

Red-green verification completed for the parser seam. `bun test ./src/review-audit/phase-timing-evidence.test.ts` failed before the production change with the new missing-field regressions, then passed after the fix. Slice-level verification at the end of T01 shows `bun test ./src/review-audit/phase-timing-evidence.test.ts ./scripts/verify-m048-s01.test.ts ./scripts/verify-m048-s03.test.ts` passing, `bun test ./scripts/verify-m048-s02.test.ts ./src/lib/review-utils.test.ts ./src/handlers/review.test.ts` passing, `bun run tsc --noEmit` passing, and the runbook grep still failing because `docs/runbooks/review-requested-debug.md` still contains the stale `## M050 Timeout-Truth Verifier Surfaces` heading that T03 is planned to remove.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/review-audit/phase-timing-evidence.test.ts` | 0 | ✅ pass | 15ms |
| 2 | `bun test ./src/review-audit/phase-timing-evidence.test.ts ./scripts/verify-m048-s01.test.ts ./scripts/verify-m048-s03.test.ts` | 0 | ✅ pass | 97ms |
| 3 | `bun test ./scripts/verify-m048-s02.test.ts ./src/lib/review-utils.test.ts ./src/handlers/review.test.ts` | 0 | ✅ pass | 4780ms |
| 4 | `! rg -n "^## M050 Timeout-Truth Verifier Surfaces$" docs/runbooks/review-requested-debug.md && rg -n "^## M048 .*Verifier Surfaces$|verify:m048:s01|verify:m048:s02|verify:m048:s03" docs/runbooks/review-requested-debug.md` | 1 | ❌ fail | 4ms |
| 5 | `bun run tsc --noEmit` | 0 | ✅ pass | 8702ms |

## Deviations

None.

## Known Issues

`docs/runbooks/review-requested-debug.md` still contains `## M050 Timeout-Truth Verifier Surfaces`, so the slice-level grep command remains red until T03 updates that runbook heading.

## Files Created/Modified

- `src/review-audit/phase-timing-evidence.ts`
- `src/review-audit/phase-timing-evidence.test.ts`
