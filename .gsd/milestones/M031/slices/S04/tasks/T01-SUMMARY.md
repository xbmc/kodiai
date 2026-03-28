---
id: T01
parent: S04
milestone: M031
provides: []
requires: []
affects: []
key_files: ["src/execution/review-prompt.ts", "src/execution/mention-prompt.ts", "src/execution/review-prompt.test.ts", "src/execution/mention-prompt.test.ts"]
key_decisions: ["Placed buildSecurityPolicySection() immediately after buildEpistemicBoundarySection() in both definition and call-site positions", "Followed existing push-with-empty-separator style used by buildEpistemicBoundarySection throughout both prompts"]
patterns_established: []
drill_down_paths: []
observability_surfaces: []
duration: ""
verification_result: "bun test src/execution/mention-prompt.test.ts src/execution/review-prompt.test.ts — 190 pass, 0 fail, 505 expect() calls, 3.5s"
completed_at: 2026-03-28T17:45:14.600Z
blocker_discovered: false
---

# T01: Add buildSecurityPolicySection() to review-prompt.ts and mention-prompt.ts, wired into both prompt builders, with tests extending both test files (190/190 pass)

> Add buildSecurityPolicySection() to review-prompt.ts and mention-prompt.ts, wired into both prompt builders, with tests extending both test files (190/190 pass)

## What Happened
---
id: T01
parent: S04
milestone: M031
key_files:
  - src/execution/review-prompt.ts
  - src/execution/mention-prompt.ts
  - src/execution/review-prompt.test.ts
  - src/execution/mention-prompt.test.ts
key_decisions:
  - Placed buildSecurityPolicySection() immediately after buildEpistemicBoundarySection() in both definition and call-site positions
  - Followed existing push-with-empty-separator style used by buildEpistemicBoundarySection throughout both prompts
duration: ""
verification_result: passed
completed_at: 2026-03-28T17:45:14.601Z
blocker_discovered: false
---

# T01: Add buildSecurityPolicySection() to review-prompt.ts and mention-prompt.ts, wired into both prompt builders, with tests extending both test files (190/190 pass)

**Add buildSecurityPolicySection() to review-prompt.ts and mention-prompt.ts, wired into both prompt builders, with tests extending both test files (190/190 pass)**

## What Happened

Added export function buildSecurityPolicySection(): string to src/execution/review-prompt.ts immediately after buildEpistemicBoundarySection(). The function returns a multi-bullet security policy block with **Refuse** instructions covering environment variables/credentials, out-of-repo file reads, and environment-probing commands. Wired the call into buildReviewPrompt() directly after the epistemic boundary push. In mention-prompt.ts, added the import and the push after the epistemic section. Extended review-prompt.test.ts with 7 unit tests on buildSecurityPolicySection and 2 integration tests on buildReviewPrompt. Extended mention-prompt.test.ts with 2 tests asserting security policy presence in buildMentionPrompt output.

## Verification

bun test src/execution/mention-prompt.test.ts src/execution/review-prompt.test.ts — 190 pass, 0 fail, 505 expect() calls, 3.5s

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test src/execution/mention-prompt.test.ts src/execution/review-prompt.test.ts` | 0 | ✅ pass | 3500ms |


## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `src/execution/review-prompt.ts`
- `src/execution/mention-prompt.ts`
- `src/execution/review-prompt.test.ts`
- `src/execution/mention-prompt.test.ts`


## Deviations
None.

## Known Issues
None.
