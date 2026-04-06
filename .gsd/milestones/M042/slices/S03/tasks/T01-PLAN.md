---
estimated_steps: 2
estimated_files: 4
skills_used: []
---

# T01: Harden author-tier cache and fallback resolution contracts

Audit and tighten the `resolveAuthorClassification()` path in `src/handlers/review.ts` so cache reuse and fallback classification stay explicitly bounded by source fidelity. Keep the change local to the review author-tier seam unless a small type/store contract improvement is clearly justified. If cache values need normalization or validation, implement it where the handler reads/writes them and preserve fail-open behavior rather than introducing a blocking path.

Document the concrete assumptions in code comments or tests: contributor profile is the highest-fidelity source, cached fallback taxonomy is lower-fidelity and may be reused only as-is, and degraded fallback must never claim `established`/`senior` knowledge it does not actually have.

## Inputs

- `src/handlers/review.ts`
- `src/knowledge/types.ts`
- `src/knowledge/store.ts`
- `src/lib/author-classifier.ts`
- `.gsd/milestones/M042/slices/S03/S03-RESEARCH.md`
- `.gsd/milestones/M042/slices/S02/S02-SUMMARY.md`

## Expected Output

- `src/handlers/review.ts`
- `src/knowledge/types.ts`
- `src/knowledge/store.ts`

## Verification

bun test ./src/handlers/review.test.ts

## Observability Impact

Preserve and, if needed, sharpen the existing fail-open warning surfaces in `src/handlers/review.ts` so future agents can tell whether a run used contributor profile, author cache, or degraded fallback without inspecting production data manually.
