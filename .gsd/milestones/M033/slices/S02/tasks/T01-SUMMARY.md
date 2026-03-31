---
id: T01
parent: S02
milestone: M033
provides: []
requires: []
affects: []
key_files: ["src/lib/sanitizer.ts", "src/lib/sanitizer.test.ts"]
key_decisions: ["Regex /sk-ant-[a-z0-9]+-[A-Za-z0-9_\-]{20,}/ — fixed prefix + type slug + min-20-char body avoids false positives on short strings while covering both oat01/api03 families"]
patterns_established: []
drill_down_paths: []
observability_surfaces: []
duration: ""
verification_result: "Ran bun test ./src/lib/sanitizer.test.ts — all 71 tests pass (68 pre-existing + 3 new anthropic-api-key cases)."
completed_at: 2026-03-31T11:41:52.680Z
blocker_discovered: false
---

# T01: Added anthropic-api-key as 7th pattern in scanOutgoingForSecrets, blocking sk-ant-oat01-* and sk-ant-api03-* tokens from leaving the system

> Added anthropic-api-key as 7th pattern in scanOutgoingForSecrets, blocking sk-ant-oat01-* and sk-ant-api03-* tokens from leaving the system

## What Happened
---
id: T01
parent: S02
milestone: M033
key_files:
  - src/lib/sanitizer.ts
  - src/lib/sanitizer.test.ts
key_decisions:
  - Regex /sk-ant-[a-z0-9]+-[A-Za-z0-9_\-]{20,}/ — fixed prefix + type slug + min-20-char body avoids false positives on short strings while covering both oat01/api03 families
duration: ""
verification_result: passed
completed_at: 2026-03-31T11:41:52.680Z
blocker_discovered: false
---

# T01: Added anthropic-api-key as 7th pattern in scanOutgoingForSecrets, blocking sk-ant-oat01-* and sk-ant-api03-* tokens from leaving the system

**Added anthropic-api-key as 7th pattern in scanOutgoingForSecrets, blocking sk-ant-oat01-* and sk-ant-api03-* tokens from leaving the system**

## What Happened

Read both target files to confirm exact existing state. Added one new pattern entry after the github-x-access-token-url entry in scanOutgoingForSecrets using regex /sk-ant-[a-z0-9]+-[A-Za-z0-9_\-]{20,}/ which covers both Claude Code OAuth (oat01) and Anthropic API (api03) token families. Updated the JSDoc count from 6 to 7 and appended the new entry to the pattern list. Added three test cases to sanitizer.test.ts: standalone oat01 token, standalone api03 token, and api03 token embedded in prose — all asserting blocked:true with matchedPattern:"anthropic-api-key".

## Verification

Ran bun test ./src/lib/sanitizer.test.ts — all 71 tests pass (68 pre-existing + 3 new anthropic-api-key cases).

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/lib/sanitizer.test.ts` | 0 | ✅ pass | 10ms |


## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `src/lib/sanitizer.ts`
- `src/lib/sanitizer.test.ts`


## Deviations
None.

## Known Issues
None.
