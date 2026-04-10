---
estimated_steps: 4
estimated_files: 3
skills_used:
  - test-driven-development
  - verification-before-completion
---

# T01: Extract the structured M047 calibration change contract

**Slice:** S03 — Explicit Calibration Verdict and M047 Change Contract
**Milestone:** M046

## Description

Why: M047 needs a machine-readable keep/change/replace contract instead of prose, and the milestone verifier should derive that contract from one pure seam instead of hard-coding report text.

Do: Add a pure `src/contributor/calibration-change-contract.ts` helper that converts the S02 recommendation plus current runtime seams into stable keep/change/replace entries with verdict, rationale, evidence strings, and impacted surfaces; export it from `src/contributor/index.ts`; and cover it with focused tests that pin the current `replace` inventory without touching the CLI.

Done when: A reusable typed contract helper returns the current `replace` verdict with explicit keep/change/replace buckets, and focused unit tests prove the contract stays aligned with the live runtime surfaces M047 must address.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `scripts/verify-m046-s02.ts` recommendation shape | Fail fast if the verdict or rationale is missing rather than inventing contract buckets. | N/A — local code only. | Reject unsupported verdicts or missing rationale as contract-construction failures. |
| `src/handlers/review.ts`, `src/slack/slash-command-handler.ts`, and `src/contributor/experience-contract.ts` runtime seams | Keep the contract grounded in current code paths; if those seams drift, fail tests rather than leaving stale M047 guidance. | N/A — local code only. | Treat missing impacted-surface evidence as a regression instead of silently dropping a keep/change/replace entry. |

## Load Profile

- **Shared resources**: local source modules and focused unit tests only.
- **Per-operation cost**: one pure mapping over the small recommendation object plus a fixed set of evidence strings.
- **10x breakpoint**: maintainability drift matters before compute, so keep the helper small, typed, and deterministic.

## Negative Tests

- **Malformed inputs**: missing verdict, empty rationale, unsupported verdict, or missing impacted surfaces.
- **Error paths**: contradictory keep/change/replace entries or duplicate mechanisms fail tests instead of producing ambiguous contract output.
- **Boundary conditions**: the current truthful `replace` verdict still includes non-empty keep and change buckets, and evidence ordering stays stable.

## Steps

1. Write failing unit tests for the change-contract helper that pin the current keep/change/replace inventory, evidence strings, and contradiction handling.
2. Implement `src/contributor/calibration-change-contract.ts` as a pure typed helper that derives the M047 contract from the S02 recommendation while referencing the current runtime seams explicitly.
3. Export the helper from `src/contributor/index.ts` and keep the file enduring rather than milestone-coded so M047 can reuse it directly.
4. Re-run the focused tests and confirm the helper returns a stable `replace` contract with populated keep, change, and replace buckets.

## Must-Haves

- [ ] `src/contributor/calibration-change-contract.ts` emits a stable typed keep/change/replace contract rooted in the current runtime code.
- [ ] Tests pin the current keep/change/replace mechanisms, evidence strings, and contradiction handling.
- [ ] The helper is exported for reuse by the top-level verifier and downstream M047 work.

## Verification

- `bun test ./src/contributor/calibration-change-contract.test.ts`
- `bun run tsc --noEmit`

## Observability Impact

- Signals added/changed: stable contract bucket names, evidence strings, and impacted-surface identifiers that the top-level verifier can surface directly.
- How a future agent inspects this: run `bun test ./src/contributor/calibration-change-contract.test.ts` and inspect the exported helper output from `src/contributor/calibration-change-contract.ts`.
- Failure state exposed: stale runtime-seam mapping, unsupported verdicts, or contradictory bucket inventory show up as explicit unit-test failures.

## Inputs

- `scripts/verify-m046-s02.ts` — existing calibration recommendation shape and findings vocabulary that the contract must consume.
- `src/handlers/review.ts` — current live incremental `pr_authored` scoring path and trusted stored-tier behavior that the contract must classify.
- `src/slack/slash-command-handler.ts` — linked profile guidance surface that currently trusts stored tier state.
- `src/contributor/experience-contract.ts` — M045 contract vocabulary that should stay in the keep bucket.

## Expected Output

- `src/contributor/calibration-change-contract.ts` — pure helper that derives the structured M047 keep/change/replace contract from the calibration recommendation.
- `src/contributor/calibration-change-contract.test.ts` — focused regression tests for contract inventory, evidence strings, and contradiction handling.
- `src/contributor/index.ts` — export surface for the new helper.
