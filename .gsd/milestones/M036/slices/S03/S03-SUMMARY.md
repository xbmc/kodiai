---
id: S03
parent: M036
milestone: M036
provides:
  - generated-rule retirement policy (shouldRetireRule predicate + applyRetirementPolicy orchestrator) — ready to wire into background sweep
  - operator notification surface for lifecycle events (notifyLifecycleRun) with fail-open hook extension point
  - end-to-end machine-verifiable lifecycle proof covering proposal → activation → retirement → notification fail-open
requires:
  - slice: S01
    provides: GeneratedRule types, store interface (listActiveRules, retireRule), and generated-rule-store.ts
  - slice: S02
    provides: ActivationPolicyResult type and activation module pattern for mirroring
affects:
  []
key_files:
  - src/knowledge/generated-rule-retirement.ts
  - src/knowledge/generated-rule-retirement.test.ts
  - src/knowledge/generated-rule-notify.ts
  - src/knowledge/generated-rule-notify.test.ts
  - scripts/verify-m036-s03.ts
  - scripts/verify-m036-s03.test.ts
  - package.json
key_decisions:
  - Retirement criteria: signal-floor (primary) and member-decay (secondary); below-floor takes precedence in reason when both apply
  - Boundary semantics strict less-than — exactly at floor/min is kept, not retired
  - Notification module consumes policy result types as inputs with no direct store dependency — decoupled from store
  - LifecycleNotifyHook is fail-open: caught, sets notifyHookFailed=true, never throws; hook skipped when zero events
  - Three verifier checks mirror S03 contract exactly; injectable _runFn overrides on all three for deterministic negative testing
patterns_established:
  - Retirement module mirrors activation module pattern exactly: pure predicate + env-sourced config + fail-open policy runner with structured counts
  - Notification module is a pure side-effect adapter (logs + optional callback) that consumes existing policy result types — zero coupling to store
  - LifecycleNotifyHook fail-open pattern: try/catch around hook call, notifyHookFailed field on result, warn log on failure, no throw propagation
  - hookCallCount field in verifier detail to validate that batch delivery received all events (not just that hook was called once)
observability_surfaces:
  - applyRetirementPolicy emits per-rule info log on each retirement decision and a run-complete summary log with counts
  - notifyLifecycleRun/notifyActivation/notifyRetirement emit per-event info logs and run-summary logs
  - notifyHookFailed: true in return value surfaces hook failures without throwing — operators can observe via structured log field
  - verify-m036-s03.ts --json harness exits 0/1 and outputs machine-parseable check results for CI
drill_down_paths:
  - milestones/M036/slices/S03/tasks/T01-SUMMARY.md
  - milestones/M036/slices/S03/tasks/T02-SUMMARY.md
  - milestones/M036/slices/S03/tasks/T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-04T23:16:03.042Z
blocker_discovered: false
---

# S03: Retirement, Notification, and Lifecycle Proof

**Completed the generated-rule lifecycle with retirement policy, fail-open operator notifications, and a machine-verifiable proof harness covering all three stages.**

## What Happened

S03 delivers the final stage of the M036 generated-rule lifecycle. Three tasks built independent modules following the pattern established in S01 (activation) and S02 (prompt injection).

**T01 — Retirement module** (`src/knowledge/generated-rule-retirement.ts`): Implemented `shouldRetireRule` (pure predicate), env-var-sourced config (`getRetirementFloor` / `getMinMemberCount`), and `applyRetirementPolicy` (fail-open orchestrator). Two criteria: signal score below floor (GENERATED_RULE_RETIREMENT_FLOOR, default 0.3) and member count below minimum (GENERATED_RULE_MIN_MEMBER_COUNT, default 3). Boundary semantics are strict less-than — exactly at floor/min is kept. The below-floor criterion takes precedence over member-decay in the reason field when both apply. 35 tests cover all boundary cases, fail-open, and transition contract.

**T02 — Notification module** (`src/knowledge/generated-rule-notify.ts`): Implemented three public functions: `notifyLifecycleRun` (combined), `notifyActivation`, and `notifyRetirement`. Each emits per-event structured info logs and a run-summary log, optionally calling a `LifecycleNotifyHook` callback. Hook failures are caught in try/catch and surface only as `notifyHookFailed: true` — the function never throws. Hook is skipped when event count is zero. 25 tests cover event shapes, hook call/skip, fail-open on both throw and rejection, concurrent calls, and flat-logger compatibility. No changes to sweep.ts were needed.

**T03 — Lifecycle verifier** (`scripts/verify-m036-s03.ts`): Three checks prove the S03 contract: RETIREMENT (policy retires a below-floor rule, boundary semantics confirmed), NOTIFY-LIFECYCLE (activation+retirement events emitted, hook receives both), NOTIFY-FAIL-OPEN (hook throw → notifyHookFailed=true, warn emitted, result still returned). All checks use injectable `_runFn` overrides for deterministic negative testing. Added `verify:m036:s03` to package.json. 21 verifier tests pass.

Slice-level verification: 81/81 tests pass across all three modules. `bun run verify:m036:s03 --json` exits 0 with `overallPassed: true` and all three checks non-skipped passes. `bun run tsc --noEmit` exits 0.

## Verification

Ran all three verification commands at slice close:
- `bun test ./src/knowledge/generated-rule-retirement.test.ts ./src/knowledge/generated-rule-notify.test.ts ./scripts/verify-m036-s03.test.ts` — 81/81 pass
- `bun run verify:m036:s03 -- --json` — exit 0, overallPassed=true, all 3 checks pass (RETIREMENT, NOTIFY-LIFECYCLE, NOTIFY-FAIL-OPEN), none skipped
- TypeScript: exit 0 (confirmed in T01, T02, T03 task verifications)

## Requirements Advanced

None.

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

None. sweep.ts was listed as an input reference for T02 but required no modifications — the notification module is standalone and consumes only policy result types.

## Known Limitations

The notification module is a pure logging/callback surface with no external push integration today (no Slack or GitHub notification). The LifecycleNotifyHook callback provides the extension point for that when needed.

## Follow-ups

None from S03. M036 is complete — all three slices (S01 schema/store, S02 activation/injection, S03 retirement/notification/proof) delivered.

## Files Created/Modified

- `src/knowledge/generated-rule-retirement.ts` — New retirement policy module: shouldRetireRule predicate, env-sourced config, applyRetirementPolicy fail-open orchestrator
- `src/knowledge/generated-rule-retirement.test.ts` — 35 tests covering all boundary cases, fail-open, and active→retired transition contract
- `src/knowledge/generated-rule-notify.ts` — New notification module: notifyLifecycleRun, notifyActivation, notifyRetirement with fail-open hook support
- `src/knowledge/generated-rule-notify.test.ts` — 25 tests covering event shapes, hook behavior, fail-open, concurrent calls
- `scripts/verify-m036-s03.ts` — M036 S03 lifecycle proof harness: 3 checks (RETIREMENT, NOTIFY-LIFECYCLE, NOTIFY-FAIL-OPEN)
- `scripts/verify-m036-s03.test.ts` — 21 tests for the verifier covering pass/fail scenarios and harness output shape
- `package.json` — Added verify:m036:s03 script
