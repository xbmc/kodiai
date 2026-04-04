---
id: T01
parent: S02
milestone: M036
key_files:
  - src/knowledge/generated-rule-activation.ts
  - src/knowledge/generated-rule-activation.test.ts
key_decisions:
  - Pure predicate (shouldAutoActivate) separated from orchestrator (applyActivationPolicy) for isolated testability
  - Threshold reads from env var at call time so tests can mutate process.env without module reloads
  - null return from activateRule counted as activationFailures to handle concurrent-delete races gracefully
  - Explicit threshold parameter overrides env lookup — no need for env mutation in tests when injecting threshold directly
duration: 
verification_result: passed
completed_at: 2026-04-04T22:45:39.279Z
blocker_discovered: false
---

# T01: Added applyActivationPolicy and shouldAutoActivate — pending rules with signalScore ≥ threshold auto-activate with fail-open error handling and structured per-decision logging

**Added applyActivationPolicy and shouldAutoActivate — pending rules with signalScore ≥ threshold auto-activate with fail-open error handling and structured per-decision logging**

## What Happened

Created src/knowledge/generated-rule-activation.ts with a pure shouldAutoActivate predicate and an applyActivationPolicy orchestrator. The predicate takes signalScore and threshold with no I/O, keeping threshold logic trivially testable. The orchestrator fetches pending rules via store.listRulesForRepo, evaluates each rule, activates qualifying ones via store.activateRule, and counts null returns (concurrent deletes) as activationFailures. Threshold is configurable via GENERATED_RULE_ACTIVATION_THRESHOLD env var with a default of 0.7; the explicit threshold parameter overrides env lookup when provided. Full structured logging per decision: threshold-hit, skipped (debug), activated (info), failure (warn), and a run-complete summary with all counters.

## Verification

bun test ./src/knowledge/generated-rule-activation.test.ts — 25 tests, 45 assertions, all pass. bun run tsc --noEmit — exit 0, no new errors.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/knowledge/generated-rule-activation.test.ts` | 0 | ✅ pass | 6300ms |
| 2 | `bun run tsc --noEmit` | 0 | ✅ pass | 10000ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `src/knowledge/generated-rule-activation.ts`
- `src/knowledge/generated-rule-activation.test.ts`
