---
estimated_steps: 4
estimated_files: 4
---

# T04: Add repeatable slice proof and execute representative live repair evidence

**Slice:** S02 — Timeout-Hardened Wiki Repair Path
**Milestone:** M027

## Description

Close the slice with repeatable operational proof that the real wiki repair path completes on representative live data, emits durable progress evidence, and can be rechecked without relying on a one-off terminal transcript.

## Steps

1. Add `scripts/verify-m027-s02.ts` to run the representative repair flow, collect repair-state evidence, and emit stable check IDs/results for machine consumption.
2. Add `scripts/verify-m027-s02.test.ts` covering success, partial-failure, and resume-required proof envelopes while preserving underlying audit/repair evidence.
3. Execute the proof harness against the researched outlier target page (`JSON-RPC API/v8`) using the real production database/provider wiring and confirm it completes without normal-case timeout failure.
4. Update the operator docs and `.gsd/REQUIREMENTS.md` with the shipped proof command and the requirement-validation status that the run actually supports.

## Must-Haves

- [ ] The proof harness preserves raw repair/audit evidence rather than collapsing the result into one opaque pass/fail string.
- [ ] Live verification exercises the real provider/database path against representative data, not a fixture-only or dry-run-only shortcut.
- [ ] Requirement updates stay honest about what S02 proves operationally and what still remains for S03/S04.

## Verification

- `bun test scripts/verify-m027-s02.test.ts`
- `bun run verify:m027:s02 -- --page-title "JSON-RPC API/v8" --json`

## Observability Impact

- Signals added/changed: Machine-checkable proof output that ties together repair progress evidence, resume state, and post-run audit status.
- How a future agent inspects this: Re-run the verification command and compare the returned check IDs, cursor/progress fields, and audit deltas.
- Failure state exposed: The proof harness reports whether failure came from repair execution, resume state, or post-run audit expectations.

## Inputs

- `scripts/wiki-embedding-repair.ts` — operator command and status surface from T03.
- `src/knowledge/runtime.ts` and `src/knowledge/embedding-audit.ts` — production wiring and post-run audit truth source established in S01.
- `T01-PLAN.md` — locked proof-envelope contract.

## Expected Output

- `scripts/verify-m027-s02.ts` — repeatable slice proof harness.
- `scripts/verify-m027-s02.test.ts` — passing proof-harness contract tests.
- `docs/operations/embedding-integrity.md` — proof command and representative-run guidance.
- `.gsd/REQUIREMENTS.md` — honest validation updates for R020/R022/R024 as supported by the completed slice.
