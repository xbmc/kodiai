# S03: Reliability Regression Gate

**Goal:** Lock issue write-mode PR creation failure semantics so maintainers get deterministic, machine-checkable reliability signals instead of false success.
**Demo:** Lock issue write-mode PR creation failure semantics so maintainers get deterministic, machine-checkable reliability signals instead of false success.

## Must-Haves


## Tasks

- [x] **T01: 74-reliability-regression-gate 01** `est:3 min`
  - Lock issue write-mode PR creation failure semantics so maintainers get deterministic, machine-checkable reliability signals instead of false success.

Purpose: Phase 74 requires release gating that catches write-mode publish regressions before ship, including implicit issue write-intent paths.
Output: Hardened mention write-mode publish contract and regression tests covering retry-once failure handling, diagnostics quality, required success artifacts, and combined degraded+retrieval behavior safety.
- [x] **T02: 74-reliability-regression-gate 02** `est:4 min`
  - Ship a deterministic release gate that verifies issue write-mode PR-creation reliability and combined degraded retrieval behavior, and fails pre-release checks when runtime prerequisites or contracts regress.

Purpose: Phase 74 completes when maintainers can run one repeatable path that proves write-mode reliability plus degraded retrieval behavior in Azure runtime context and blocks release on regressions.
Output: New Phase 74 verification CLI, package command wiring, and runbook/smoke documentation with explicit blocking criteria for both reliability and retrieval-behavior checks.

## Files Likely Touched

- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`
- `scripts/phase74-reliability-regression-gate.ts`
- `scripts/phase74-reliability-regression-gate.test.ts`
- `package.json`
- `docs/smoke/phase74-reliability-regression-gate.md`
- `docs/runbooks/xbmc-ops.md`
