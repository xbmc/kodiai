# S05: Success Path Status Contract Parity

**Goal:** Make issue write success output machine-checkable so producer status semantics are contract-parity with failure-path replies.
**Demo:** Make issue write success output machine-checkable so producer status semantics are contract-parity with failure-path replies.

## Must-Haves


## Tasks

- [x] **T01: 76-success-path-status-contract-parity 01** `est:3min`
  - Make issue write success output machine-checkable so producer status semantics are contract-parity with failure-path replies.

Purpose: Phase 74 locked failure-path machine-checkability, but success replies still rely on free-form text (`Opened PR`) that can drift and break downstream automation.
Output: Updated mention-handler success reply envelope with deterministic markers plus regression coverage proving success-path status contracts stay parseable.
- [x] **T02: 76-success-path-status-contract-parity 02** `est:3min`
  - Enforce success/failure status-path contract parity in the regression gate and operator procedures so consumer validation matches producer output.

Purpose: Producer-side success markers are only useful if the regression gate and runbook treat success and failure as the same machine-checkable contract family.
Output: Updated Phase 74 gate parser/checks, deterministic tests, and smoke/runbook guidance that validate dual-path status envelopes.

## Files Likely Touched

- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`
- `scripts/phase74-reliability-regression-gate.ts`
- `scripts/phase74-reliability-regression-gate.test.ts`
- `docs/smoke/phase74-reliability-regression-gate.md`
- `docs/runbooks/xbmc-ops.md`
