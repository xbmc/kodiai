---
estimated_steps: 13
estimated_files: 5
skills_used:
  - test-driven-development
  - verification-before-completion
---

# T03: Ship an operator proof harness for stored-profile review resolution

**Slice:** S01 — Truthful contributor resolution on GitHub review
**Milestone:** M047

## Description

Prove the runtime resolver rather than just the public contract fixtures. The slice needs one shipped verifier that seeds stored contributor-profile states through the real review-resolution seam and shows linked-but-unscored and legacy rows fail open while a calibrated retained contributor still drives coherent prompt and Review Details output.

## Steps

1. Write failing verifier tests for linked-unscored, legacy, stale, calibrated, opt-out, and coarse-fallback scenarios, including stable human/JSON output and package-script wiring.
2. Implement `scripts/verify-m047-s01.ts` by reusing the trust-aware review-resolution helper plus prompt/details builders to render each stored-profile scenario end to end.
3. Add the `verify:m047:s01` package script and keep M045 proof compatibility by rerunning `verify:m045:s01` alongside the new runtime verifier.
4. Make the report expose trust state, contract state, source, and fallback/degradation reason so S03 can compose it into the final `verify:m047` surface.

## Must-Haves

- [ ] `bun run verify:m047:s01` proves stored-profile resolution instead of direct contract fixtures.
- [ ] The verifier reports linked-unscored, legacy, stale, calibrated, opt-out, and coarse-fallback outcomes with stable check IDs and scenario details.
- [ ] Existing `verify:m045:s01` contract proof stays green alongside the new runtime resolver proof.

## Inputs

- `src/contributor/review-author-resolution.ts`
- `src/handlers/review.ts`
- `scripts/verify-m045-s01.ts`
- `package.json`

## Expected Output

- `scripts/verify-m047-s01.ts`
- `scripts/verify-m047-s01.test.ts`
- `package.json`

## Verification

bun test ./scripts/verify-m047-s01.test.ts && bun run verify:m045:s01 && bun run verify:m047:s01 && bun run tsc --noEmit

## Observability Impact

The verifier becomes the operator inspection surface for stored-profile trust failures by reporting trust state, contract state, source, and fallback/degradation reason for each scenario.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `src/contributor/review-author-resolution.ts` / `src/handlers/review.ts` | Fail the verifier with a named status code instead of printing a misleading green runtime-proof result. | N/A — deterministic local helper path only. | Treat missing trust-state or contract fields as proof-harness drift and fail the scenario explicitly. |
| `scripts/verify-m045-s01.ts` compatibility path | Keep the older direct-contract proof running so M047 runtime proof cannot silently replace the M045 surface. | N/A — local script only. | Fail tests if the new runtime harness or package wiring breaks the existing M045 contract proof surface. |

## Load Profile

- **Shared resources**: local proof scripts, deterministic scenario fixtures, and one package-script entry.
- **Per-operation cost**: one scenario matrix evaluation plus prompt/details rendering for a handful of stored-profile states.
- **10x breakpoint**: report readability and stable status-code shape degrade before compute does, so the harness should keep the scenario set bounded and machine-readable.

## Negative Tests

- **Malformed inputs**: scenario fixtures missing trust state, missing contract state, or inconsistent stored-profile row shape.
- **Error paths**: runtime resolver throws, human/JSON report shapes drift apart, package script wiring is missing, or `verify:m045:s01` regresses while `verify:m047:s01` is added.
- **Boundary conditions**: linked-unscored fail-open, legacy fail-open, stale fail-open/degraded, calibrated retained profile-backed, opt-out generic, and coarse-fallback cache-only scenarios.
