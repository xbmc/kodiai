# T02: 76-success-path-status-contract-parity 02

**Slice:** S05 — **Milestone:** M013

## Description

Enforce success/failure status-path contract parity in the regression gate and operator procedures so consumer validation matches producer output.

Purpose: Producer-side success markers are only useful if the regression gate and runbook treat success and failure as the same machine-checkable contract family.
Output: Updated Phase 74 gate parser/checks, deterministic tests, and smoke/runbook guidance that validate dual-path status envelopes.

## Must-Haves

- [ ] "Regression gate validates both issue write failure and success status envelopes as machine-checkable contract paths"
- [ ] "Runbook and smoke procedures define one shared status-envelope shape for success and failure evidence capture"
- [ ] "Automated tests fail when success-path status fields regress or become non-machine-checkable"

## Files

- `scripts/phase74-reliability-regression-gate.ts`
- `scripts/phase74-reliability-regression-gate.test.ts`
- `docs/smoke/phase74-reliability-regression-gate.md`
- `docs/runbooks/xbmc-ops.md`
