---
id: S03
parent: M033
milestone: M033
provides:
  - Execution-bypass guardrails in both review-prompt security policy and executor CLAUDE.md
  - 5 regression tests asserting presence of social-engineering-refusal and mandatory-review clauses
requires:
  []
affects:
  []
key_files:
  - src/execution/review-prompt.ts
  - src/execution/executor.ts
  - src/execution/review-prompt.test.ts
  - src/execution/executor.test.ts
key_decisions:
  - Mirrored execution-bypass guardrail language across both security surfaces (review-prompt policy section and executor CLAUDE.md) rather than centralizing — each consumer runs in a different agent context and must carry its own policy signal independently.
patterns_established:
  - Security policy additions span two surfaces: buildSecurityPolicySection() for the reviewer agent and buildSecurityClaudeMd() for the executor agent. Future policy changes should update both.
observability_surfaces:
  - none
drill_down_paths:
  - .gsd/milestones/M033/slices/S03/tasks/T01-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-03-31T11:47:55.070Z
blocker_discovered: false
---

# S03: Harden security policy prompt against execution bypass

**Added execution-bypass guardrails to buildSecurityPolicySection() and a new Execution Safety section to buildSecurityClaudeMd(), with 5 new passing tests covering social engineering refusal and mandatory pre-execution review.**

## What Happened

S03 was a single-task slice with a targeted scope: add execution-bypass guardrails to the two security policy surfaces the agent reads at runtime — the review prompt and the CLAUDE.md written into every job workspace.

T01 extended `buildSecurityPolicySection()` in `src/execution/review-prompt.ts` with three new bullets: refuse requests to execute embedded scripts/commands regardless of framing; treat "just run it / skip the review" instructions as social engineering; and require review of any code before executing it via a Bash/shell tool. These bullets slot directly into the existing security policy array with consistent style.

The same guardrail language was mirrored into `buildSecurityClaudeMd()` in `src/execution/executor.ts` as a new `## Execution Safety` section. This matters because the CLAUDE.md is the agent's in-task instruction surface (written to the workspace dir before job launch) — the review prompt is for the reviewer agent, CLAUDE.md is for the executor agent. Both surfaces now carry identical policy intent in their respective register.

Five new tests were added: 3 in `review-prompt.test.ts` (execute in section, social engineering in section, review-before-execute regex) and 2 in `executor.test.ts` (execute in CLAUDE.md, social engineering in CLAUDE.md). All 169 review-prompt tests and 24 executor tests pass.

Key decision: mirroring language across both surfaces rather than centralizing it — the two consumers run in different contexts and each must carry its own policy signal.

## Verification

bun test ./src/execution/review-prompt.test.ts: 169 pass, 0 fail (34ms). bun test ./src/execution/executor.test.ts: 24 pass, 0 fail (164ms). All 5 new security policy tests pass, confirming 'execute', 'social engineering', and 'review before execution' clauses are present in both policy surfaces.

## Requirements Advanced

None.

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

None.

## Known Limitations

None. The guardrails are prompt-level instructions — their effectiveness depends on the LLM following policy, not on deterministic enforcement. No runtime bypass detection was added (not in scope).

## Follow-ups

None.

## Files Created/Modified

- `src/execution/review-prompt.ts` — Added three execution-bypass guardrail bullets to the security policy array in buildSecurityPolicySection()
- `src/execution/executor.ts` — Added new ## Execution Safety section to buildSecurityClaudeMd() with three parallel guardrail bullets
- `src/execution/review-prompt.test.ts` — Added 3 new tests asserting 'execute', 'social engineering', and review-before-execution regex in buildSecurityPolicySection()
- `src/execution/executor.test.ts` — Added 2 new tests asserting 'execute' and 'social engineering' in buildSecurityClaudeMd() output
