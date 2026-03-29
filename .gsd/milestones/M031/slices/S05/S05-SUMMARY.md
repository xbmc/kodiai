---
id: S05
parent: M031
milestone: M031
provides:
  - scripts/verify-m031.ts — proof harness covering all five M031 security controls
  - scripts/verify-m031.test.ts — 23-test suite with pass/fail cases for each check
  - verify:m031 registered in package.json
requires:
  []
affects:
  []
key_files:
  - scripts/verify-m031.ts
  - scripts/verify-m031.test.ts
  - package.json
key_decisions:
  - ghp_ test token padded to exactly 36 chars after prefix to satisfy github-pat regex (plan had 15-char example)
  - ENV-ALLOWLIST check saves/restores DATABASE_URL and ANTHROPIC_API_KEY in finally block to avoid test pollution
  - _fn override pattern used across all 5 checks for clean fail-case testing without module mocking
patterns_established:
  - Pure-code M031 proof harness pattern: all five M031 security controls verified via direct function calls, no DB/GitHub gating, overallPassed = conjunction of all. Template: scripts/verify-m031.ts.
observability_surfaces:
  - bun run verify:m031 — five-check proof harness, JSON mode available via --json flag, exit 0 = all checks pass, exit 1 = any check fails
drill_down_paths:
  - .gsd/milestones/M031/slices/S05/tasks/T01-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-03-28T18:00:07.375Z
blocker_discovered: false
---

# S05: End-to-End Proof Harness (verify:m031)

**Wrote scripts/verify-m031.ts (5 pure-code checks), scripts/verify-m031.test.ts (23 pass), and registered verify:m031 in package.json — bun run verify:m031 exits 0 with five green checks.**

## What Happened

S05 had a single task (T01) whose executor wrote the proof harness and test suite in one pass. The harness follows the verify-m029-s04.ts canonical template: exported M031_CHECK_IDS tuple, one async runXxx() per check, evaluateM031() running all five in Promise.all, buildM031ProofHarness() for CLI rendering, and an if (import.meta.main) entry point. All five checks are pure-code (no DB or GitHub gating), so overallPassed is the conjunction of all five.

The five checks exercise each M031 security control directly:
1. M031-ENV-ALLOWLIST: calls buildAgentEnv() with DATABASE_URL set in process.env, asserts DATABASE_URL absent and ANTHROPIC_API_KEY present. The check saves/restores env in a finally block to avoid polluting the test environment.
2. M031-GIT-URL-CLEAN: calls buildAuthFetchUrl('', undefined) — the token-absent fast-return path — asserts result === 'origin' and no 'x-access-token' in result.
3. M031-OUTGOING-SCAN-BLOCKS: calls scanOutgoingForSecrets with a 36-char ghp_ PAT (the test token from the plan had only 15 chars after the prefix; padded to match the github-pat regex), asserts { blocked: true, matchedPattern: 'github-pat' }.
4. M031-PROMPT-HAS-SECURITY: calls buildMentionPrompt with a minimal MentionEvent, asserts result includes '## Security Policy' and "I can't help with that".
5. M031-CLAUDEMD-HAS-SECURITY: calls buildSecurityClaudeMd(), asserts result includes '# Security Policy' and "I can't help with that".

The test suite (23 tests) covers pass/fail cases for each check using the _fn override pattern, plus envelope semantics (overallPassed logic, skipped-check exclusion) and harness output in both text and JSON modes. verify:m031 was added to package.json scripts.

The slice-level verification gate initially failed with 'bun test scripts/verify-m031.test.ts' (without the ./ prefix) — Bun treated this as a filter substring rather than a file path. Correcting to 'bun test ./scripts/verify-m031.test.ts' confirmed 23/23 pass. This Bun quirk was documented in KNOWLEDGE.md.

## Verification

bun test ./scripts/verify-m031.test.ts: 23 pass, 0 fail, 74 expect() calls, 104ms. bun run verify:m031: exits 0 with five PASS checks (ENV-ALLOWLIST, GIT-URL-CLEAN, OUTGOING-SCAN-BLOCKS, PROMPT-HAS-SECURITY, CLAUDEMD-HAS-SECURITY).

## Requirements Advanced

None.

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

Test token 'ghp_abc123AAABBBCCC' from the plan has only 15 chars after the prefix; padded to exactly 36 chars to satisfy the github-pat regex. All other implementation details matched the plan exactly.

## Known Limitations

None. All five checks are pure-code and pass unconditionally when imports resolve correctly.

## Follow-ups

None.

## Files Created/Modified

- `scripts/verify-m031.ts` — Proof harness with 5 pure-code M031 security checks, evaluateM031(), buildM031ProofHarness(), CLI entry point
- `scripts/verify-m031.test.ts` — 23-test suite covering pass/fail cases per check, envelope semantics, and harness output modes
- `package.json` — Added verify:m031 script entry
