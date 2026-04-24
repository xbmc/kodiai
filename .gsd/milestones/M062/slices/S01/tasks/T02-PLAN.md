---
estimated_steps: 4
estimated_files: 8
skills_used:
  - test-driven-development
  - systematic-debugging
  - verification-before-completion
  - observability
---

# T02: Route constrained review publication through the bounded first-pass contract

**Slice:** S01 — Bounded first-pass contract
**Milestone:** M062

## Description

Apply the new contract at the root-cause seam in `src/handlers/review.ts`. Replace the split between timeout partial publication and dead-end `max_turns` fallback with one bounded-first-pass projection that uses checkpoint or triage evidence when available, preserves the existing `reviewOutputKey` identity, and keeps true hard failure only for zero-evidence runs.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `src/lib/review-first-pass.ts` | Fail the handler tests and keep the old path from shipping; do not silently fall back to string-built comments. | N/A — pure local helper. | Treat malformed normalized payloads as non-publishable and keep the hard failure path explicit in tests. |
| `CheckpointRecord` from `src/knowledge/types.ts` | Publish only when structured evidence is present; otherwise leave the run in zero-evidence hard failure. | Preserve existing timeout handling while avoiding duplicate publication. | Ignore impossible counts or inconsistent file lists and classify them as zero trustworthy evidence. |
| `src/handlers/review-idempotency.ts` / `reviewOutputKey` | Keep one public review surface and fail tests if the new flow would create a second comment contract. | Do not introduce retry loops or extra publication attempts. | Treat malformed publication-state data as non-publishable and surface that branch in handler tests. |

## Load Profile

- **Shared resources**: checkpoint persistence, review publication identity, handler logging, and existing comment formatting paths.
- **Per-operation cost**: one normalized state projection plus the existing publication and review-details rendering work.
- **10x breakpoint**: correctness drift matters before compute cost; duplicated summary/details logic would break user trust faster than runtime cost would.

## Negative Tests

- **Malformed inputs**: inconsistent checkpoint totals, invalid bounded reason combinations, and publishless failures with unusable evidence.
- **Error paths**: timeout with no checkpoint, `max_turns` with zero evidence, idempotency state that says output already exists, and summary body that would violate comment structure.
- **Boundary conditions**: timeout with checkpoint evidence, `max_turns` with checkpoint evidence, large-PR boundedness without timeout, and constrained runs that already published output.

## Steps

1. Replace the timeout-only partial-review projection and the publishless `max_turns` fallback with a shared bounded-first-pass state built from `src/lib/review-first-pass.ts`.
2. Update `src/lib/partial-review-formatter.ts` and `src/lib/review-utils.ts` so visible summary and Review Details consume the same bounded reason and coverage data.
3. Extend `src/handlers/review.test.ts`, `src/lib/partial-review-formatter.test.ts`, and `src/lib/review-utils.test.ts` to prove bounded-first-pass publication, zero-evidence hard failure, and coherent coverage/details rendering.
4. Add or update handler diagnostics so a future agent can tell why a constrained run published bounded output versus falling back to hard failure.

## Must-Haves

- [ ] Timeout and `max_turns` constrained outcomes use the same bounded-first-pass state when structured evidence exists.
- [ ] The handler preserves the single `reviewOutputKey` publication surface and does not add a second public comment contract.
- [ ] Review Details and visible summary stay coherent on covered scope, remaining scope, and bounded reason.
- [ ] Zero-evidence failure remains explicit instead of being mislabeled as partial review success.

## Verification

- `bun test ./src/lib/partial-review-formatter.test.ts ./src/lib/review-utils.test.ts ./src/handlers/review.test.ts`

## Observability Impact

- Signals added/changed: bounded first-pass reason, evidence source, covered/remaining counts, and zero-evidence hard-failure classification in constrained-review diagnostics.
- How a future agent inspects this: inspect bounded publication scenarios in `src/handlers/review.test.ts` and Review Details formatting cases in `src/lib/review-utils.test.ts`.
- Failure state exposed: a regression shows up as dead-end comment publication, mismatched coverage fields, duplicate publication behavior, or missing bounded diagnostics.

## Inputs

- `src/handlers/review.ts` — live constrained-review orchestration and dead-end `max_turns` fallback.
- `src/handlers/review.test.ts` — regression surface for publication behavior and review output truth.
- `src/lib/partial-review-formatter.ts` — timeout-only partial review formatter that must be generalized or replaced.
- `src/lib/partial-review-formatter.test.ts` — formatter contract tests.
- `src/lib/review-utils.ts` — Review Details renderer that must consume the same normalized state.
- `src/lib/review-utils.test.ts` — Review Details truth/regression coverage.
- `src/lib/review-first-pass.ts` — shared normalized bounded first-pass state from T01.
- `src/handlers/review-idempotency.ts` — stable single-surface publication identity.

## Expected Output

- `src/handlers/review.ts` — constrained publication logic routed through the bounded first-pass contract.
- `src/handlers/review.test.ts` — handler regressions covering bounded publication versus zero-evidence hard failure.
- `src/lib/partial-review-formatter.ts` — summary formatter aligned to the normalized contract.
- `src/lib/partial-review-formatter.test.ts` — formatter tests for bounded reason and coverage truth.
- `src/lib/review-utils.ts` — Review Details rendering aligned to the normalized contract.
- `src/lib/review-utils.test.ts` — Review Details regressions proving summary/details coherence.
