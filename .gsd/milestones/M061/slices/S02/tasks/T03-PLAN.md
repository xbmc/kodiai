---
estimated_steps: 4
estimated_files: 6
skills_used:
  - verify-before-complete
  - write-docs
---

# T03: Publish a slice proof that measures conversational mention reduction on the canonical telemetry path

**Slice:** S02 — Mention Flow Context Diet
**Milestone:** M061

## Description

Turn the new gating behavior into durable operator evidence. S01 established Postgres-backed `prompt_section_events` as the only truthful prompt-accounting seam; this task should extend that operator surface so S02 can prove reduced conversational mention context by named section without inventing a parallel reporting path. The output should be a rerunnable proof command plus tests that stay aligned with the report layer and fail open when Postgres is unavailable.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| Postgres access through `createDbClient()` | Report explicit `missing` / `unavailable` access state and exit fail-open, matching S01 behavior. | Return the same fail-open preflight state instead of hanging the proof command. | Treat malformed rows as report/proof failures in tests rather than silently hiding missing telemetry. |
| Prompt-section report aggregation | Keep the command truthful by surfacing the mismatch in test output. | N/A for local aggregation logic. | Fail tests if section names drift from runtime-emitted telemetry. |

## Load Profile

- **Shared resources**: Postgres prompt-section queries and CLI/report rendering
- **Per-operation cost**: one report/proof query pass over named prompt-section rows
- **10x breakpoint**: not runtime-critical; the main risk is operator confusion if report aggregation becomes inconsistent with runtime section names

## Negative Tests

- **Malformed inputs**: unexpected or missing prompt-section names should fail proof assertions rather than silently disappearing from the report.
- **Error paths**: database-unavailable and missing-credentials paths stay explicit and fail open.
- **Boundary conditions**: the proof distinguishes reduced `mention.response` sections from preserved richer explicit-review paths rather than collapsing both into one bucket.

## Steps

1. Update `scripts/usage-report.ts` and `scripts/usage-report.test.ts` to expose the named conversational mention sections needed for S02 operator evidence.
2. Add or adjust proof helpers/tests around `scripts/verify-m061-s01.ts` only where shared logic needs to know about the new section names.
3. Create `scripts/verify-m061-s02.ts` and `scripts/verify-m061-s02.test.ts` as the slice-specific proof command for conversational mention reduction on the canonical telemetry path.
4. If command help/runbook text changes, keep it minimal and aligned with the same report/proof terminology used in tests.

## Must-Haves

- [ ] There is a dedicated S02 proof command that checks named conversational mention reductions on the canonical telemetry path.
- [ ] Report/proof tests share the same section names the runtime now emits.
- [ ] Postgres-unavailable paths remain explicit and fail open.

## Verification

- Script/report tests: `bun test ./scripts/usage-report.test.ts ./scripts/verify-m061-s01.test.ts ./scripts/verify-m061-s02.test.ts`
- Manual smoke expectation: the new proof command’s help/JSON/text output describes conversational mention reduction in the same terms asserted by the tests.

## Observability Impact

- Signals added/changed: operator-facing proof/report output gains named conversational mention reduction checks.
- How a future agent inspects this: run `scripts/verify-m061-s02.ts` or inspect its tests, then compare section names against `scripts/usage-report.ts` output.
- Failure state exposed: missing prompt-section rows, naming drift, or DB access problems are surfaced explicitly in proof output.

## Inputs

- `scripts/usage-report.ts` — canonical operator report path over prompt-section telemetry
- `scripts/usage-report.test.ts` — report surface assertions for task types and section names
- `scripts/verify-m061-s01.ts` — existing milestone baseline proof helper/pattern
- `scripts/verify-m061-s01.test.ts` — existing proof coverage to extend carefully
- `src/telemetry/store.ts` — canonical prompt-section persistence contract
- `src/execution/prompt-section-metrics.ts` — section metric shape and naming seam

## Expected Output

- `scripts/usage-report.ts` — conversational mention sections rendered in the canonical report surface
- `scripts/usage-report.test.ts` — assertions for the new section names / grouping
- `scripts/verify-m061-s01.ts` — shared helper tweaks only if needed for consistent proof terminology
- `scripts/verify-m061-s01.test.ts` — guard coverage for any shared helper changes
- `scripts/verify-m061-s02.ts` — slice proof command for conversational mention reduction
- `scripts/verify-m061-s02.test.ts` — fail-open and named-section proof coverage for S02
