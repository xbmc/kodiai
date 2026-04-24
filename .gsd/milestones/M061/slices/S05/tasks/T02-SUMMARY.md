---
id: T02
parent: S05
milestone: M061
key_files:
  - scripts/phase-m061-token-regression-gate.ts
  - scripts/phase-m061-token-regression-gate.test.ts
key_decisions:
  - Grouped the pinned regression suites by operator-visible seam (mention, review, retrieval, reporting, verifiers) so stable check IDs map directly to the regressed behavior surface.
  - Kept the regression gate separate from the live-telemetry verifier so R069 still has a meaningful blocking check when Postgres is missing or unreachable.
duration: 
verification_result: passed
completed_at: 2026-04-24T03:31:09.560Z
blocker_discovered: false
---

# T02: Added the M061 token regression gate CLI with pinned mention, review, retrieval, reporting, and verifier suite groups.

**Added the M061 token regression gate CLI with pinned mention, review, retrieval, reporting, and verifier suite groups.**

## What Happened

Implemented `scripts/phase-m061-token-regression-gate.ts` as a DB-independent regression gate that follows the existing phase regression-gate pattern while pinning the exact M061 suite groups needed for R069 protection. The new gate defines stable `M061-REG-*` check IDs for mention, review, retrieval, reporting, and verifier coverage; validates malformed suite definitions up front; catches thrown runner errors per suite so remaining checks still evaluate; and renders concise blocking output that names the failing suite group directly. Added `scripts/phase-m061-token-regression-gate.test.ts` first, then used it to lock the pinned command inventory, help behavior, malformed-command handling, non-zero suite failures, thrown spawn errors, and stable failing-check rendering before implementing the CLI.

## Verification

Ran the task verification commands and confirmed both the focused gate test file and the real regression-gate CLI pass locally. The CLI executed all five pinned suite groups successfully without requiring Postgres access, which preserves the blocking regression surface even when live telemetry is unavailable. Slice-level verification is partially advanced for this intermediate task: the new gate test and gate CLI pass, while the remaining slice-wide package-alias and lint verification belongs to T03.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test scripts/phase-m061-token-regression-gate.test.ts` | 0 | ✅ pass | 80ms |
| 2 | `bun scripts/phase-m061-token-regression-gate.ts` | 0 | ✅ pass | 11350ms |

## Deviations

None.

## Known Issues

Language-server diagnostics were unavailable for these TypeScript files in this workspace (`No language server found`), so verification relied on executable test and CLI runs instead of LSP feedback.

## Files Created/Modified

- `scripts/phase-m061-token-regression-gate.ts`
- `scripts/phase-m061-token-regression-gate.test.ts`
