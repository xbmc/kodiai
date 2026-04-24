---
estimated_steps: 44
estimated_files: 7
skills_used: []
---

# T04: Prove reuse and degraded fallback through canonical reporting surfaces

---
estimated_steps: 4
estimated_files: 4
skills_used:
  - verify-before-complete
  - observability
---

# T04: Prove reuse and degraded fallback through canonical reporting surfaces

**Slice:** S04 — Retrieval Reuse and Safe Derived-Context Caching
**Milestone:** M061

## Description

Close the loop by making reuse evidence inspectable through the same operator-facing proof/report surfaces established in S01-S03. Add an S04 verifier and any minimal reporting/test updates needed so cache hits, misses, and degraded fallback are observable without inventing a parallel debug path.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `scripts/usage-report.ts` Postgres query layer | verifier must fail open with explicit access-state output | preserve the bounded timeout/shutdown behavior from S03 | treat missing rows as proof failure only when DB access is available |
| cache/reuse telemetry emitted by handlers | verifier should report missing evidence explicitly instead of inferring success | do not block on unavailable DB access; return fail-open preflight | malformed reuse evidence should fail the verifier test suite |
| new S04 proof script | surface why proof failed (missing rows, degraded-only evidence, unavailable DB) without hanging | reuse existing timeout behavior | reject ambiguous results rather than silently passing |

## Steps

1. Decide the minimal canonical evidence shape for S04 reuse (for example prompt-section-compatible markers, existing telemetry rows, or usage-report query extensions) without creating a second reporting path.
2. Extend `scripts/usage-report.ts` and tests only as needed so mention/review/retrieval reuse evidence is queryable alongside existing prompt/cache reporting.
3. Add `scripts/verify-m061-s04.ts` and `scripts/verify-m061-s04.test.ts` to prove retrieval reuse and derived-cache truthfulness with fail-open Postgres handling.
4. Keep the verifier aligned with the implementation tests: identical-state reuse evidence should pass, stale/missing/degraded states should be explicit.

## Must-Haves

- [ ] Operators can rerun one canonical S04 proof command and see whether reuse evidence is available, missing, or degraded.
- [ ] The proof surface stays aligned with existing usage-report/query layers instead of duplicating telemetry logic.

## Verification

- `bun test scripts/usage-report.test.ts scripts/verify-m061-s04.test.ts`
- `bun scripts/verify-m061-s04.ts --json`

## Observability Impact

- Signals added/changed: operator-visible reuse/fallback evidence on canonical report/verifier paths.
- How a future agent inspects this: `scripts/usage-report.ts` and `scripts/verify-m061-s04.ts --json`.
- Failure state exposed: unavailable Postgres, missing reuse evidence, and degraded cache fallback become explicit verdict inputs.

## Inputs

- `scripts/usage-report.ts` — canonical telemetry report/query layer
- `scripts/usage-report.test.ts` — report contract coverage
- `src/handlers/mention.ts` — source of mention reuse evidence
- `src/handlers/review.ts` — source of review reuse evidence
- `src/knowledge/retrieval.ts` — source of retrieval reuse evidence

## Expected Output

- `scripts/verify-m061-s04.ts` — slice verifier for reuse/fail-open evidence
- `scripts/verify-m061-s04.test.ts` — verifier regression coverage
- `scripts/usage-report.ts` — minimal canonical reporting updates if needed
- `scripts/usage-report.test.ts` — updated report coverage for any new reuse evidence rows

## Inputs

- ``scripts/usage-report.ts``
- ``scripts/usage-report.test.ts``
- ``src/handlers/mention.ts``
- ``src/handlers/review.ts``
- ``src/knowledge/retrieval.ts``

## Expected Output

- ``scripts/verify-m061-s04.ts``
- ``scripts/verify-m061-s04.test.ts``
- ``scripts/usage-report.ts``
- ``scripts/usage-report.test.ts``

## Verification

bun test scripts/usage-report.test.ts scripts/verify-m061-s04.test.ts && bun scripts/verify-m061-s04.ts --json

## Observability Impact

This task makes S04 reuse evidence operator-visible on the canonical report/verifier path and preserves explicit fail-open access-state reporting.
