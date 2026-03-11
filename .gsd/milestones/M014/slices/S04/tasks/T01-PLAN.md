# T01: 80-slack-operator-hardening 01

**Slice:** S04 — **Milestone:** M014

## Description

Ship a deterministic Slack v1 smoke verifier that operators can run to prove the core safety behavior in one repeatable command.

Purpose: SLK-06 requires an operator-safe proof for channel gating, thread-only semantics, mention bootstrap, and follow-up handling before release decisions.
Output: A phase-specific smoke verifier CLI with tests plus an operator smoke procedure document.

## Must-Haves

- [ ] "Operators can run one deterministic smoke command that proves Slack channel gating, mention bootstrap, and started-thread follow-up behavior"
- [ ] "Smoke output is machine-checkable and fails fast when Slack v1 rails do not match expected allow/ignore decisions"
- [ ] "Smoke evidence explicitly confirms every allowed payload resolves to thread-only reply targeting"

## Files

- `scripts/phase80-slack-smoke.ts`
- `scripts/phase80-slack-smoke.test.ts`
- `docs/smoke/phase80-slack-operator-hardening.md`
