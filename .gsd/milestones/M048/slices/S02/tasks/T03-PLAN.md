---
estimated_steps: 4
estimated_files: 5
skills_used:
  - test-driven-development
  - verification-before-completion
---

# T03: Add an operator compare command for before/after S02 latency proof

**Slice:** S02 — Single-Worker Path Latency Reduction
**Milestone:** M048

## Description

S02 should close on repeatable evidence, not ad hoc manual eyeballing of two separate live reviews. This task should reuse the S01 verifier/evidence pipeline to compare a baseline review key and a candidate review key, report targeted phase deltas, and keep publication continuity visible so operators can decide whether the latency win is real after deploy.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `verify:m048:s01` evidence evaluation reused by the compare command | Return a named unavailable/error state for the affected review key instead of inventing a comparison. | Preserve the timeout/unavailable state in the compare report and mark the comparison inconclusive. | Reject malformed phase payloads and surface the existing invalid-payload state for that side of the comparison. |
| CLI args for baseline/candidate review keys | Exit non-zero with named invalid-arg output instead of running a broad query. | N/A — local parsing only. | Refuse contradictory delivery filters or empty option values. |

## Load Profile

- **Shared resources**: Azure Log Analytics query budget and one operator compare report per before/after check.
- **Per-operation cost**: two keyed evidence lookups, one normalization pass per side, and one delta report render.
- **10x breakpoint**: wide or repeated Azure queries will fail before local compute does, so the command must stay scoped to explicit baseline/candidate keys and a bounded timespan.

## Negative Tests

- **Malformed inputs**: missing baseline/candidate keys, empty env-backed values, and contradictory delivery ids.
- **Error paths**: Azure unavailable, no matching phase-timing rows for one side, and invalid phase payloads inherited from `verify:m048:s01`.
- **Boundary conditions**: improved candidate latency, no-improvement candidate latency, and degraded publication/runtime phases that should still render a truthful delta report.

## Steps

1. Expose any reusable helpers from `scripts/verify-m048-s01.ts` that the compare command needs without changing the S01 contract.
2. Add `scripts/verify-m048-s02.ts` that accepts baseline/candidate review keys, evaluates both reviews through the existing evidence path, and renders a delta report for targeted latency phases plus publication continuity.
3. Add focused tests in `scripts/verify-m048-s02.test.ts` for happy path, no-improvement path, degraded/unavailable evidence, and invalid CLI args, while keeping `scripts/verify-m048-s01.test.ts` green.
4. Wire `verify:m048:s02` into `package.json` and prove the command shape with Bun tests plus a post-deploy live invocation using two real review keys.

## Must-Haves

- [ ] The compare command reuses the existing S01 evidence contract instead of inventing a second latency store.
- [ ] The report shows baseline/candidate identifiers, per-phase deltas for targeted latency phases, and publication continuity state.
- [ ] CLI parsing and degraded evidence states are covered with deterministic tests before live use.

## Verification

- `bun test ./scripts/verify-m048-s01.test.ts ./scripts/verify-m048-s02.test.ts`
- `bun run tsc --noEmit`
- `bun run verify:m048:s02 -- --baseline-review-output-key "$BASELINE_REVIEW_OUTPUT_KEY" --candidate-review-output-key "$REVIEW_OUTPUT_KEY" --json`

## Observability Impact

- Signals added/changed: one operator-facing compare report that carries both review identifiers, targeted phase deltas, and source availability.
- How a future agent inspects this: run `bun run verify:m048:s02 -- --baseline-review-output-key <baseline> --candidate-review-output-key <candidate> --json` and compare the result with the PR’s Review Details timing block.
- Failure state exposed: Azure unavailable, missing rows, invalid payloads, and “no improvement” outcomes remain explicit instead of looking like a successful proof.

## Inputs

- `scripts/verify-m048-s01.ts` — existing single-review evidence evaluation/reporting.
- `scripts/verify-m048-s01.test.ts` — regression coverage for the S01 verifier contract.
- `package.json` — script wiring for the new compare command.

## Expected Output

- `scripts/verify-m048-s01.ts` — any shared helpers needed by the S02 compare path without breaking the S01 CLI.
- `scripts/verify-m048-s01.test.ts` — updated regression coverage if reusable helper exports change.
- `scripts/verify-m048-s02.ts` — operator compare command for before/after S02 latency proof.
- `scripts/verify-m048-s02.test.ts` — deterministic coverage for compare-report happy path, degraded evidence, and invalid args.
- `package.json` — `verify:m048:s02` script wiring.
