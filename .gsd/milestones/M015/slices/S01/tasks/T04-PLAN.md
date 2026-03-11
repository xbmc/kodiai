# T04: 81-slack-write-mode-enablement 04

**Slice:** S01 — **Milestone:** M015

## Description

Add deterministic operator verification gates and runbook updates for Slack write mode so Phase 81 can be validated and release-blocking in CI/operator workflows.

Purpose: After confirmation and UX contracts are implemented, operators need stable smoke/regression checks and documentation to detect drift quickly.
Output: Phase 81 smoke/regression scripts and tests, package command aliases, and runbook updates.

## Must-Haves

- [ ] "Operators can run a deterministic Phase 81 smoke check that verifies write-intent routing, ambiguous fallback, and high-impact confirmation behavior"
- [ ] "Operators can run a deterministic Phase 81 regression gate that fails non-zero on Slack write contract drift"
- [ ] "Runbook instructions map Phase 81 verification commands to machine-checkable check IDs and troubleshooting guidance"

## Files

- `scripts/phase81-slack-write-smoke.ts`
- `scripts/phase81-slack-write-smoke.test.ts`
- `scripts/phase81-slack-write-regression-gate.ts`
- `scripts/phase81-slack-write-regression-gate.test.ts`
- `package.json`
- `docs/runbooks/slack-integration.md`
