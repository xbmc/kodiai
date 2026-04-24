---
estimated_steps: 6
estimated_files: 4
skills_used:
  - using-superpowers
  - test-driven-development
  - verify-before-complete
---

# T01: Compose the milestone verifier from S01 scenarios and S02 rendering helpers

Build the new deterministic verifier around production seams rather than duplicated fixture prose. Reuse `getDefaultScenarioMatrix()` and `evaluateScenario()` from `scripts/verify-m062-s01.ts`, feed bounded-first-pass payloads through `formatPartialReviewComment()` and `formatReviewDetailsSummary()`, and emit a compact report that classifies whether the two visible surfaces stay truthful and mutually consistent for each scenario. Document in the code that bounded scenarios must prove reason/coverage/continuation parity while zero-evidence scenarios must remain ineligible for bounded public comment.

Steps:
1. Create `scripts/verify-m062-s03.ts` with typed scenario/report shapes and CLI parsing that mirrors the established verifier style in `scripts/verify-m062-s01.ts`.
2. Reuse the S01 scenario matrix and normalized payload output instead of reconstructing first-pass payloads by hand; for bounded scenarios, render both visible surfaces with production helpers and extract semantic checks for bounded reason, covered scope, remaining scope or truthful uncertainty, and continuation state.
3. For the zero-evidence scenario, assert the verifier records a dead-end failure classification and captures that `formatPartialReviewComment()` rejects non-bounded payloads rather than letting the scenario masquerade as bounded success.
4. Render human-readable and `--json` output that includes stable per-scenario status, key parity checks, and issues so future agents can localize regressions quickly.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `scripts/verify-m062-s01.ts` exports | fail the verifier loudly with a named invalid-contract issue instead of silently skipping scenarios | not applicable for local imports | reject the scenario as invalid and report which field drifted |
| `src/lib/review-utils.ts` / `src/lib/partial-review-formatter.ts` helpers | surface the thrown formatter error in the scenario issues list | not applicable for local helpers | treat mismatched or missing wording evidence as parity failure |

## Load Profile

- **Shared resources**: Bun process memory and local module loading only
- **Per-operation cost**: one in-process evaluation of the 4-scenario matrix plus formatter rendering per scenario
- **10x breakpoint**: report size/readability would degrade before CPU becomes a problem; keep output compact and semantic

## Negative Tests

- **Malformed inputs**: invalid scenario id, missing normalized payload, missing review identity
- **Error paths**: zero-evidence scenario throws for bounded comment rendering and is reported as an expected negative case
- **Boundary conditions**: bounded scenario with missing remaining scope must degrade to explicit uncertainty rather than exhaustive wording

## Inputs

- ``scripts/verify-m062-s01.ts``
- ``src/lib/review-utils.ts``
- ``src/lib/partial-review-formatter.ts``
- ``src/lib/review-first-pass.ts``

## Expected Output

- ``scripts/verify-m062-s03.ts``

## Must-Haves

- [ ] Reuse S01 scenario/payload seams instead of hand-built first-pass fixtures
- [ ] Report bounded-surface parity and zero-evidence rejection with stable machine-readable fields
- [ ] Keep output deterministic in both human-readable and `--json` modes

## Verification

bun test ./scripts/verify-m062-s03.test.ts --filter "verify-m062-s03"

## Observability Impact

Adds a new machine-readable verifier surface that exposes wording-parity failures and bounded-comment eligibility by scenario instead of forcing agents to infer drift from raw formatter strings.
