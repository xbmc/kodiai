---
id: T01
parent: S03
milestone: M047
key_files:
  - scripts/verify-m047.ts
  - scripts/verify-m047.test.ts
  - package.json
  - .gsd/milestones/M047/slices/S03/tasks/T01-SUMMARY.md
key_decisions:
  - Compose `verify:m047` only from `evaluateM047S02()`, `evaluateM045S03()`, and `evaluateM046()`, and map coarse-fallback to S01 cache runtime plus M045 retrieval while marking Slack/profile continuity not applicable.
duration: 
verification_result: passed
completed_at: 2026-04-11T03:07:32.185Z
blocker_discovered: false
---

# T01: Added the milestone-level `verify:m047` composition harness with stable scenario mapping, preserved nested S02/M045/M046 evidence, and regression coverage for malformed reports, anchor drift, and CLI behavior.

**Added the milestone-level `verify:m047` composition harness with stable scenario mapping, preserved nested S02/M045/M046 evidence, and regression coverage for malformed reports, anchor drift, and CLI behavior.**

## What Happened

Added `scripts/verify-m047.ts` as the milestone-level composition harness for M047. The new verifier validates nested S02, M045, and M046 report shapes, preserves their full JSON payloads verbatim, maps the five milestone scenarios from nested evidence only, and keeps the truthful M046 `replace` verdict as data instead of treating it as a harness failure. Added `scripts/verify-m047.test.ts` first to lock the contract for stable check ids, scenario ids, malformed nested reports, missing anchors, coarse-fallback not-applicable handling, human/JSON output alignment, and package wiring. Wired `verify:m047` into `package.json`, fixed the compiler issues caught by `tsc`, and confirmed the dedicated test suite, the milestone CLI, the prerequisite proof bundle, and TypeScript compilation all pass.

## Verification

Verified with the dedicated `scripts/verify-m047.test.ts` regression suite, the real `bun run verify:m047 -- --json` CLI smoke check, the prerequisite proof bundle `bun run verify:m047:s02 -- --json && bun run verify:m045:s03 -- --json && bun run verify:m046 -- --json`, and `bun run tsc --noEmit`. All four commands exited 0 after the final syntax and readonly-tuple fixes.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./scripts/verify-m047.test.ts` | 0 | ✅ pass | 190ms |
| 2 | `bun run verify:m047 -- --json` | 0 | ✅ pass | 153ms |
| 3 | `bun run verify:m047:s02 -- --json && bun run verify:m045:s03 -- --json && bun run verify:m046 -- --json` | 0 | ✅ pass | 226ms |
| 4 | `bun run tsc --noEmit` | 0 | ✅ pass | 10710ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `scripts/verify-m047.ts`
- `scripts/verify-m047.test.ts`
- `package.json`
- `.gsd/milestones/M047/slices/S03/tasks/T01-SUMMARY.md`
