---
id: T03
parent: S02
milestone: M036
key_files:
  - scripts/verify-m036-s02.ts
  - scripts/verify-m036-s02.test.ts
  - package.json
key_decisions:
  - Three checks cover the full activation-to-prompt pipeline using pure in-process stubs
  - shouldAutoActivate boundary predicate validated inside ACTIVATION check to prove threshold semantics mechanically
  - Fail-open check uses SpyLogger to verify warn was emitted before returning empty results
duration: 
verification_result: passed
completed_at: 2026-04-04T22:57:29.494Z
blocker_discovered: false
---

# T03: Added scripts/verify-m036-s02.ts and scripts/verify-m036-s02.test.ts proving the full activation-to-prompt pipeline: high-signal pending rule activates, active rule appears in formatted prompt section, store errors are fail-open.

**Added scripts/verify-m036-s02.ts and scripts/verify-m036-s02.test.ts proving the full activation-to-prompt pipeline: high-signal pending rule activates, active rule appears in formatted prompt section, store errors are fail-open.**

## What Happened

Created scripts/verify-m036-s02.ts following the S01 verifier pattern. Three checks: ACTIVATION (applyActivationPolicy with a store stub containing one high-signal pending rule, verifies activated=1 and shouldAutoActivate boundary predicate), PROMPT-INJECTION (getActiveRulesForPrompt + formatActiveRulesSection with an active-rule stub, verifies section header, title, text, and signal label), FAIL-OPEN (store always throws, verifies empty result + warn log + formatActiveRulesSection([]) returns empty string). All fixtures use pure in-process stubs. buildM036S02ProofHarness supports --json flag and stdout/stderr injection. Added verify:m036:s02 script to package.json.

## Verification

bun test ./scripts/verify-m036-s02.test.ts — 18 tests, 64 assertions, 0 fail. bun run verify:m036:s02 -- --json — 3/3 checks PASS, overallPassed:true, exit 0. bun run tsc --noEmit — exit 0.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./scripts/verify-m036-s02.test.ts` | 0 | ✅ pass | 14ms |
| 2 | `bun run verify:m036:s02 -- --json` | 0 | ✅ pass | 200ms |
| 3 | `bun run tsc --noEmit` | 0 | ✅ pass | 9700ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `scripts/verify-m036-s02.ts`
- `scripts/verify-m036-s02.test.ts`
- `package.json`
