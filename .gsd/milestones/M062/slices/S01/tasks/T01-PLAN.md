---
estimated_steps: 4
estimated_files: 5
skills_used:
  - test-driven-development
  - verification-before-completion
  - observability
---

# T01: Define the normalized bounded first-pass state and pure contract tests

**Slice:** S01 — Bounded first-pass contract
**Milestone:** M062

## Description

Extract the contract first so the rest of the slice stops branching on timeout-only wording versus `max_turns` failure prose. Build one focused lib seam that combines review boundedness, checkpoint evidence, and execution outcome into a normalized bounded first-pass payload with explicit bounded reason, covered scope, remaining scope, publication eligibility, and continuation-pending state.

## Steps

1. Create `src/lib/review-first-pass.ts` with a pure normalization API that accepts structured boundedness, checkpoint, and execution outcome inputs and returns a conservative first-pass payload.
2. Extend `src/lib/review-boundedness.ts` only where needed so large-PR and timeout truth still originates from the existing boundedness seam instead of being re-derived later in the handler.
3. Add focused tests in `src/lib/review-first-pass.test.ts` and update `src/lib/review-boundedness.test.ts` to cover timeout-with-checkpoint, `max_turns`-with-checkpoint, large-PR-only boundedness, and zero-evidence failure scenarios.
4. Keep every field machine-checkable: if a scope value is not supported by structured evidence, omit it rather than synthesizing it from prose.

## Must-Haves

- [ ] The normalized first-pass payload has explicit fields for bounded reason, evidence source, covered scope, remaining scope, publication eligibility, and continuation-pending state.
- [ ] Timeout, large-PR, and `max_turns` branches can all map into the same payload without string parsing.
- [ ] Zero-evidence failure remains distinguishable from bounded first-pass publication instead of being forced into a false partial-review state.

## Negative Tests

- **Malformed inputs**: missing checkpoint counts, reviewed-file counts that exceed total files, unknown stop reasons, and inconsistent large-PR totals.
- **Error paths**: null boundedness, null checkpoint evidence, and failure outcomes with no publishable evidence.
- **Boundary conditions**: zero reviewed files, full coverage, partial coverage, and `max_turns` with structured evidence but no published output yet.

## Verification

- `bun test ./src/lib/review-boundedness.test.ts ./src/lib/review-first-pass.test.ts`

## Observability Impact

- Signals added/changed: explicit bounded reason and evidence-source fields in the normalized payload.
- How a future agent inspects this: read failing cases in `src/lib/review-first-pass.test.ts` and any payload snapshots they assert.
- Failure state exposed: contract drift shows up as missing fields, impossible counts, or wrong publishability classification in pure tests.

## Inputs

- `src/lib/review-boundedness.ts` — existing boundedness contract and disclosure rules.
- `src/lib/review-boundedness.test.ts` — current boundedness truth assertions that must stay green.
- `src/knowledge/types.ts` — `CheckpointRecord` shape that defines checkpoint-backed review evidence.
- `src/execution/mcp/checkpoint-server.ts` — source of what checkpoint evidence is actually persisted.

## Expected Output

- `src/lib/review-first-pass.ts` — new normalized bounded first-pass contract seam.
- `src/lib/review-first-pass.test.ts` — pure regression coverage for first-pass normalization.
- `src/lib/review-boundedness.ts` — any narrow boundedness adjustments required by the new contract.
- `src/lib/review-boundedness.test.ts` — updated boundedness tests that stay aligned with the new seam.
