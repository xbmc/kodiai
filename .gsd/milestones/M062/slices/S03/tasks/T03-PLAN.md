---
estimated_steps: 6
estimated_files: 6
skills_used:
  - using-superpowers
  - verification-before-completion
  - systematic-debugging
---

# T03: Run the milestone proof sweep and polish failure diagnostics

Close the slice by running the full deterministic proof stack and tightening report wording if any failure output is ambiguous. This task exists so S03 ends with a trustworthy operator-facing gate, not just new code that compiles locally.

Steps:
1. Run the slice verification commands in order, including both verifier scripts, formatter/handler regressions, and `bun run tsc --noEmit`.
2. If a verifier failure message is ambiguous, make the smallest focused adjustment in `scripts/verify-m062-s03.ts` or `scripts/verify-m062-s03.test.ts` so the failing scenario, broken parity check, and expected contract are explicit.
3. Re-run the affected commands until the full proof sweep passes cleanly.
4. Confirm the final `verify:m062:s03 -- --json` output remains compact, deterministic, and usable as an operator evidence surface for M062 closeout.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| Bun test/TypeScript commands | stop, inspect the exact failing gate, and patch only the verifier/reporting seam implicated by the failure | rerun the specific timed-out command after checking whether the verifier introduced pathological output or loops | treat malformed JSON/human output as a verifier defect and tighten the report contract |
| Existing formatter/handler tests | preserve their failures as real regressions rather than muting them to land S03 | not applicable for unit tests | fail loudly and document which prior contract was broken |

## Load Profile

- **Shared resources**: test runner CPU time and TypeScript compile memory
- **Per-operation cost**: one full deterministic proof sweep across verifier, formatter, handler, and compile gates
- **10x breakpoint**: compile/test duration increases before correctness changes; keep the sweep targeted to milestone proof commands

## Negative Tests

- **Malformed inputs**: malformed verifier JSON output, missing scenario issue detail, wrong package script target
- **Error paths**: any failing command must leave enough diagnostics to identify the broken scenario or contract clause
- **Boundary conditions**: all four S01 scenarios plus single-scenario targeted runs remain deterministic across reruns

## Inputs

- ``scripts/verify-m062-s03.ts``
- ``scripts/verify-m062-s03.test.ts``
- ``scripts/verify-m062-s01.ts``
- ``src/lib/review-utils.test.ts``
- ``src/lib/partial-review-formatter.test.ts``
- ``src/handlers/review.test.ts``
- ``package.json``

## Expected Output

- ``scripts/verify-m062-s03.ts``
- ``scripts/verify-m062-s03.test.ts``
- ``package.json``

## Must-Haves

- [ ] Run the full slice verification stack, not just the new verifier tests
- [ ] Tighten ambiguous verifier diagnostics instead of relaxing gates
- [ ] Leave `verify:m062:s03 -- --json` compact and operator-usable

## Verification

bun test ./scripts/verify-m062-s03.test.ts ./scripts/verify-m062-s01.test.ts && bun test ./src/lib/review-utils.test.ts ./src/lib/partial-review-formatter.test.ts ./src/handlers/review.test.ts && bun run verify:m062:s01 -- --json && bun run verify:m062:s03 -- --json && bun run tsc --noEmit

## Observability Impact

Validates that the new verifier’s JSON and human-readable outputs are explicit enough to diagnose which scenario or contract clause regressed during future milestone work.
