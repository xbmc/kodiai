---
id: T02
parent: S01
milestone: M047
key_files:
  - src/contributor/review-author-resolution.ts
  - src/contributor/review-author-resolution.test.ts
  - src/handlers/review.ts
  - src/handlers/review.test.ts
  - src/contributor/index.ts
key_decisions:
  - Extract review-time author resolution into a shared contributor module and keep stored-profile trust diagnostics in handler logs while Review Details stays contract-level and redacted.
duration: 
verification_result: mixed
completed_at: 2026-04-11T00:50:16.677Z
blocker_discovered: false
---

# T02: Routed GitHub review author resolution through the trust-aware stored-profile boundary.

**Routed GitHub review author resolution through the trust-aware stored-profile boundary.**

## What Happened

Extracted GitHub review-time author resolution into `src/contributor/review-author-resolution.ts` and routed the handler through that shared trust-aware boundary. The resolver now classifies persisted contributor rows with the M047 trust helper, preserves opt-out precedence, only keeps explicitly trustworthy calibrated rows `profile-backed`, and otherwise fails open into author-cache, GitHub search, author-association, or generic/degraded behavior. It also fixes the old inline-path bug where an expertise lookup failure could leave a previously assigned trusted tier behind. Updated `src/handlers/review.ts` to log stored-profile trust state, trust reason, calibration marker/version, and fallback path on the existing author-classification log entry without exposing calibration-only metadata in Review Details. Added resolver-level tests plus handler integration coverage for calibrated, linked-unscored, legacy, stale, opt-out, contradictory-cache, and fail-open scenarios.

## Verification

`bun test ./src/contributor/review-author-resolution.test.ts ./src/handlers/review.test.ts` passed. The slice-level bundle `bun test ./src/contributor/profile-trust.test.ts ./src/contributor/profile-store.test.ts ./src/contributor/review-author-resolution.test.ts ./src/handlers/review.test.ts ./scripts/verify-m047-s01.test.ts` passed, and an explicit presence check confirmed the future T03 verifier file/script are still absent. `bun run verify:m045:s01` passed. `bun run verify:m047:s01` and the exact combined `bun run verify:m045:s01 && bun run verify:m047:s01` command fail because the T03 verifier script has not been added yet. `bun run tsc --noEmit` passed.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/contributor/review-author-resolution.test.ts ./src/handlers/review.test.ts` | 0 | ✅ pass | 5126ms |
| 2 | `bun test ./src/contributor/profile-trust.test.ts ./src/contributor/profile-store.test.ts ./src/contributor/review-author-resolution.test.ts ./src/handlers/review.test.ts ./scripts/verify-m047-s01.test.ts` | 0 | ✅ pass | 5496ms |
| 3 | `printf 'review-author-resolution.test.ts=%s\n' "$(test -f src/contributor/review-author-resolution.test.ts && echo present || echo missing)"; printf 'verify-m047-s01.test.ts=%s\n' "$(test -f scripts/verify-m047-s01.test.ts && echo present || echo missing)"; jq -r '.scripts["verify:m047:s01"] // "missing"' package.json` | 0 | ✅ pass | 28ms |
| 4 | `bun run verify:m045:s01` | 0 | ✅ pass | 48ms |
| 5 | `bun run verify:m047:s01` | 1 | ❌ fail | 9ms |
| 6 | `bun run verify:m045:s01 && bun run verify:m047:s01` | 1 | ❌ fail | 44ms |
| 7 | `bun run tsc --noEmit` | 0 | ✅ pass | 10323ms |

## Deviations

None.

## Known Issues

`scripts/verify-m047-s01.test.ts` and package script `verify:m047:s01` are still intentionally missing because they belong to T03, so the exact slice verifier remains partially red until that task lands.

## Files Created/Modified

- `src/contributor/review-author-resolution.ts`
- `src/contributor/review-author-resolution.test.ts`
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
- `src/contributor/index.ts`
