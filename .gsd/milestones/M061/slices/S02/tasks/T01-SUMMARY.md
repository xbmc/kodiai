---
id: T01
parent: S02
milestone: M061
key_files:
  - src/handlers/mention.ts
  - src/execution/mention-context.ts
  - src/execution/config.ts
  - src/execution/mention-context.test.ts
  - src/execution/mention-prompt.test.ts
  - src/execution/config.test.ts
  - src/handlers/mention.test.ts
  - scripts/verify-m061-s02.ts
  - scripts/verify-m061-s02.test.ts
key_decisions:
  - Default conversational mentions now admit no conversation history, PR metadata, or review-thread context; only explicit review requests opt into the richer mention-context path.
  - Mention prompt accounting now uses fine-grained `mention.context` section names so downstream proof can attribute prompt cost reductions by admitted section rather than one coarse bucket.
  - Section fetch failures inside mention context building fail open by dropping the affected section and logging a safe warning instead of aborting the whole mention reply.
duration: 
verification_result: passed
completed_at: 2026-04-24T01:29:14.443Z
blocker_discovered: false
---

# T01: Added admission-policy-driven mention context staging with fine-grained mention prompt-section telemetry and slice proof coverage.

**Added admission-policy-driven mention context staging with fine-grained mention prompt-section telemetry and slice proof coverage.**

## What Happened

I turned mention intent classification into a durable admission policy and threaded it through mention context construction. `src/handlers/mention.ts` now derives a conservative conversational policy from repo config and only admits heavy sections for explicit review requests. `src/execution/mention-context.ts` now accepts an admission policy, emits separate `mention.context` section names for conversation history, PR metadata, inline review context, and review-thread context, and fails open by omitting any section whose GitHub fetch fails instead of aborting prompt construction. `src/execution/config.ts` now carries conservative `mention.admission` defaults plus validation so repos can override the policy explicitly. I expanded the mention-context, mention-prompt, config, and handler tests to pin the lighter default path, preserved explicit-review path, and the new telemetry names. I also created `scripts/verify-m061-s02.ts` and its test so the slice-level proof path exists and checks for fine-grained mention context attribution plus the canonical `mention-user-prompt` record.

## Verification

Ran the task verification suite after the final code changes. `bun test ./src/execution/mention-context.test.ts ./src/execution/mention-prompt.test.ts ./src/handlers/mention.test.ts` passed with 166 tests green, confirming the lighter conversational path, preserved rich explicit-review path, handler wiring, and no regressions across mention flows. `bun test ./scripts/usage-report.test.ts ./scripts/verify-m061-s01.test.ts ./scripts/verify-m061-s02.test.ts` passed with 12 tests green, confirming the operator-facing usage report and both milestone proof scripts align with the new named section accounting.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/execution/mention-context.test.ts ./src/execution/mention-prompt.test.ts ./src/handlers/mention.test.ts` | 0 | ✅ pass | 6530ms |
| 2 | `bun test ./scripts/usage-report.test.ts ./scripts/verify-m061-s01.test.ts ./scripts/verify-m061-s02.test.ts` | 0 | ✅ pass | 61ms |

## Deviations

Added the missing slice proof artifact pair `scripts/verify-m061-s02.ts` and `scripts/verify-m061-s02.test.ts` because the slice verification contract referenced them but they did not exist yet.

## Known Issues

`capture_thought` failed when attempting to store the new admission-policy pattern, so the durable memory store was not updated in this run. Runtime code, tests, and GSD task artifacts were unaffected.

## Files Created/Modified

- `src/handlers/mention.ts`
- `src/execution/mention-context.ts`
- `src/execution/config.ts`
- `src/execution/mention-context.test.ts`
- `src/execution/mention-prompt.test.ts`
- `src/execution/config.test.ts`
- `src/handlers/mention.test.ts`
- `scripts/verify-m061-s02.ts`
- `scripts/verify-m061-s02.test.ts`
