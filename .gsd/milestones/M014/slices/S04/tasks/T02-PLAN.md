# T02: 80-slack-operator-hardening 02

**Slice:** S04 — **Milestone:** M014

## Description

Create a deterministic Slack v1 regression gate that blocks drift in the core safety contracts.

Purpose: SLK-06 requires regression safety, not just one-time validation; this plan makes contract drift immediately visible in CI and operator runs.
Output: A dedicated Slack v1 contract test suite plus a regression gate runner with machine-checkable pass/fail output.

## Must-Haves

- [ ] "Regression checks fail when Slack v1 channel gating, mention bootstrap, thread-only targeting, or started-thread follow-up semantics drift"
- [ ] "A single regression gate command runs Slack v1 contract tests and exits non-zero when any contract fails"
- [ ] "Failure output identifies exactly which Slack v1 contract family regressed"

## Files

- `src/slack/v1-safety-contract.test.ts`
- `scripts/phase80-slack-regression-gate.ts`
- `scripts/phase80-slack-regression-gate.test.ts`
