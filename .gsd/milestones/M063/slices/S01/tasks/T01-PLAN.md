---
estimated_steps: 14
estimated_files: 5
skills_used:
  - using-superpowers
  - test-driven-development
  - verify-before-complete
---

# T01: Extract a dedicated continuation lifecycle planner from the timeout branch

Build a pure continuation lifecycle module around the existing bounded first-pass, retry-scope, and checkpoint seams so the handler can stop recomputing continuation state inline. Keep the first slice intentionally narrow: model automatic continuation planning, continuation-pass identity, bounded settlement readiness, merge inputs, and cleanup decisions for the current single-follow-up policy without changing public wording yet.

Steps:
1. Create `src/lib/review-continuation-lifecycle.ts` with typed inputs/outputs for planning continuation from first-pass evidence, deriving continuation pass keys from the base `reviewOutputKey`, deciding whether continuation should be scheduled, and deciding whether a finished continuation has enough structured evidence to merge or should settle with no update.
2. Move the existing retry-scope, chronic-timeout, no-remaining-scope, and checkpoint-merge arithmetic behind that module while keeping `normalizeReviewFirstPass(...)` as the source of truth for what is publicly publishable.
3. Write `src/lib/review-continuation-lifecycle.test.ts` first, covering happy-path planning plus edge cases: zero-evidence failures, already-published inline findings, malformed/partial checkpoint scope, empty remaining scope, chronic timeout suppression, merge-ready continuation, and no-delta settlement.
4. Keep the module side-effect free so later slices can reuse the same seam for public-surface revisions and prompt narrowing without re-deriving lifecycle rules from handler prose.

## Negative Tests

- **Malformed inputs**: missing `reviewOutputKey`, checkpoint scope where reviewed files exceed total files, empty continuation file list, and inconsistent merge inputs.
- **Error paths**: bounded first pass absent or zero-evidence should never produce a continuation plan; inline-output-already-published should suppress continuation planning.
- **Boundary conditions**: no remaining files, single remaining file, and merge with no new reviewed files must settle deterministically.

## Must-Haves

- [ ] Encode continuation planning and settlement as explicit typed decisions instead of anonymous handler locals
- [ ] Preserve the base `reviewOutputKey` as the public lifecycle identity while deriving continuation pass keys separately
- [ ] Prove the extracted seam handles no-follow-up, follow-up, merge-ready, and no-delta outcomes with unit coverage

## Inputs

- ``src/handlers/review.ts``
- ``src/lib/review-first-pass.ts``
- ``src/lib/retry-scope-reducer.ts``
- ``src/knowledge/types.ts``

## Expected Output

- ``src/lib/review-continuation-lifecycle.ts``
- ``src/lib/review-continuation-lifecycle.test.ts``

## Verification

bun test src/lib/review-continuation-lifecycle.test.ts

## Observability Impact

No new runtime surface yet, but this task creates the typed seam that later tests and verifier code will inspect for continuation state, settlement reason, and pass identity instead of reconstructing those decisions from handler-local variables.
