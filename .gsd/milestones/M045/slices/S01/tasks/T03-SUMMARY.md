---
id: T03
parent: S01
milestone: M045
key_files:
  - scripts/verify-m045-s01.ts
  - scripts/verify-m045-s01.test.ts
  - scripts/verify-m042-s02.ts
  - scripts/verify-m042-s03.ts
  - scripts/verify-m042-s02.test.ts
  - scripts/verify-m042-s03.test.ts
  - package.json
  - scripts/verify-m044-s01.test.ts
  - src/handlers/review-idempotency.ts
key_decisions:
  - D066 — Use scripts/verify-m045-s01.ts as the shared source of contributor-experience verifier scenarios and wording expectations.
duration: 
verification_result: passed
completed_at: 2026-04-09T11:47:49.951Z
blocker_discovered: false
---

# T03: Added the shared GitHub review contract verifier and rewired M042 truthfulness gates onto the same scenario matrix.

**Added the shared GitHub review contract verifier and rewired M042 truthfulness gates onto the same scenario matrix.**

## What Happened

Added scripts/verify-m045-s01.ts as the canonical GitHub contributor-experience contract proof harness for the five in-scope review scenarios, with shared scenario fixtures, prompt/detail phrase expectations, human output, and JSON diagnostics. Added scripts/verify-m045-s01.test.ts first to drive the harness via TDD, including malformed-input, opt-out leak, degraded overclaim, and JSON-shape checks. Rewired scripts/verify-m042-s02.ts and scripts/verify-m042-s03.ts to import the shared M045 scenario fixtures and wording expectations instead of maintaining their own hardcoded contract phrases, then updated the corresponding script tests to the contract vocabulary. Registered verify:m045:s01 in package.json. To keep the final slice verification bar clean, also fixed two unrelated strictness blockers in scripts/verify-m044-s01.test.ts and src/handlers/review-idempotency.ts so bun run tsc --noEmit passed on the finished tree.

## Verification

Ran the slice contract test suite (src/contributor/experience-contract.test.ts, src/handlers/review.test.ts, src/execution/review-prompt.test.ts, src/lib/review-utils.test.ts, scripts/verify-m045-s01.test.ts), reran the M042 and M045 verifier commands, refreshed bun run verify:m045:s01 -- --json to confirm the inspection surface exposes scenario/state/mismatch data, ran the targeted M044/idempotency tests after the strictness fixes, and finished with a clean bun run tsc --noEmit.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/contributor/experience-contract.test.ts ./src/handlers/review.test.ts ./src/execution/review-prompt.test.ts ./src/lib/review-utils.test.ts ./scripts/verify-m045-s01.test.ts` | 0 | ✅ pass | 3213ms |
| 2 | `bun run verify:m042:s02 && bun run verify:m042:s03 && bun run verify:m045:s01` | 0 | ✅ pass | 360ms |
| 3 | `bun run verify:m045:s01 -- --json` | 0 | ✅ pass | 39ms |
| 4 | `bun test ./scripts/verify-m044-s01.test.ts ./src/handlers/review-idempotency.test.ts` | 0 | ✅ pass | 73ms |
| 5 | `bun run tsc --noEmit` | 0 | ✅ pass | 7678ms |

## Deviations

Added two small verification-enabling strictness fixes outside the planned file list: scripts/verify-m044-s01.test.ts now uses a type-correct M044S01Report stub, and src/handlers/review-idempotency.ts now narrows parsed key segments before splitting the repo segment.

## Known Issues

None.

## Files Created/Modified

- `scripts/verify-m045-s01.ts`
- `scripts/verify-m045-s01.test.ts`
- `scripts/verify-m042-s02.ts`
- `scripts/verify-m042-s03.ts`
- `scripts/verify-m042-s02.test.ts`
- `scripts/verify-m042-s03.test.ts`
- `package.json`
- `scripts/verify-m044-s01.test.ts`
- `src/handlers/review-idempotency.ts`
