---
id: T01
parent: S03
milestone: M036
key_files:
  - src/knowledge/generated-rule-retirement.ts
  - src/knowledge/generated-rule-retirement.test.ts
key_decisions:
  - Mirrored activation module pattern: pure predicate + env-sourced config + fail-open policy runner
  - Two criteria: below-floor (primary) and member-decay; below-floor takes precedence in reason when both apply
  - Boundary semantics strict less-than — exactly at floor/min is NOT retired
  - GENERATED_RULE_RETIREMENT_FLOOR env var (default 0.3), GENERATED_RULE_MIN_MEMBER_COUNT env var (default 3, positive integer only)
duration: 
verification_result: passed
completed_at: 2026-04-04T23:07:44.888Z
blocker_discovered: false
---

# T01: Added generated-rule-retirement module with signal-floor and member-decay criteria, plus 35 passing tests

**Added generated-rule-retirement module with signal-floor and member-decay criteria, plus 35 passing tests**

## What Happened

Created src/knowledge/generated-rule-retirement.ts mirroring the activation module pattern. Exports shouldRetireRule (pure predicate returning RuleRetirementDecision with shouldRetire and reason), env-var-sourced config via getRetirementFloor/getMinMemberCount, and applyRetirementPolicy which iterates active rules, evaluates each with the predicate, retires qualifying rules fail-open, and returns structured counts. Two retirement criteria: signalScore below floor (default 0.3, env GENERATED_RULE_RETIREMENT_FLOOR) and memberCount below minimum (default 3, env GENERATED_RULE_MIN_MEMBER_COUNT). Boundary semantics are strict less-than — exactly at floor/min is kept. Observability follows the established pattern: per-rule info decisions plus run-complete summary.

## Verification

bun test ./src/knowledge/generated-rule-retirement.test.ts — 35/35 pass. bun run tsc --noEmit — exit 0.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/knowledge/generated-rule-retirement.test.ts` | 0 | ✅ pass | 2000ms |
| 2 | `bun run tsc --noEmit` | 0 | ✅ pass | 6400ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `src/knowledge/generated-rule-retirement.ts`
- `src/knowledge/generated-rule-retirement.test.ts`
