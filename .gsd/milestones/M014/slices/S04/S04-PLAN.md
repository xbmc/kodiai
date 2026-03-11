# S04: Slack Operator Hardening

**Goal:** Ship a deterministic Slack v1 smoke verifier that operators can run to prove the core safety behavior in one repeatable command.
**Demo:** Ship a deterministic Slack v1 smoke verifier that operators can run to prove the core safety behavior in one repeatable command.

## Must-Haves


## Tasks

- [x] **T01: 80-slack-operator-hardening 01** `est:2m4s`
  - Ship a deterministic Slack v1 smoke verifier that operators can run to prove the core safety behavior in one repeatable command.

Purpose: SLK-06 requires an operator-safe proof for channel gating, thread-only semantics, mention bootstrap, and follow-up handling before release decisions.
Output: A phase-specific smoke verifier CLI with tests plus an operator smoke procedure document.
- [x] **T02: 80-slack-operator-hardening 02** `est:1m55s`
  - Create a deterministic Slack v1 regression gate that blocks drift in the core safety contracts.

Purpose: SLK-06 requires regression safety, not just one-time validation; this plan makes contract drift immediately visible in CI and operator runs.
Output: A dedicated Slack v1 contract test suite plus a regression gate runner with machine-checkable pass/fail output.
- [x] **T03: 80-slack-operator-hardening 03** `est:1m31s`
  - Publish the Slack operator runbook and command wiring needed for repeatable deployment and incident response.

Purpose: SLK-06 is not complete until operators can both verify behavior and quickly debug production incidents using documented, deterministic procedures.
Output: New Slack integration runbook, ops playbook cross-link, and package script aliases for smoke/regression execution.

## Files Likely Touched

- `scripts/phase80-slack-smoke.ts`
- `scripts/phase80-slack-smoke.test.ts`
- `docs/smoke/phase80-slack-operator-hardening.md`
- `src/slack/v1-safety-contract.test.ts`
- `scripts/phase80-slack-regression-gate.ts`
- `scripts/phase80-slack-regression-gate.test.ts`
- `package.json`
- `docs/runbooks/slack-integration.md`
- `docs/runbooks/xbmc-ops.md`
