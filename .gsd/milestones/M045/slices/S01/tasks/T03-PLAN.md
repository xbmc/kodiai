---
estimated_steps: 5
estimated_files: 5
skills_used:
  - test-driven-development
  - verification-before-completion
---

# T03: Add the GitHub review contract verifier and preserve M042 truthfulness guards

Add the slice proof surface and keep M042 continuity checks meaningful under the new contract vocabulary.

## Negative Tests

- **Malformed inputs**: verifier fixtures with missing contract state or mismatched required/banned phrases fail with scenario-specific diagnostics.
- **Error paths**: prompt/details divergence, opted-out adaptation leaks, and degraded overclaim each produce failing named checks.
- **Boundary conditions**: profile-backed, coarse fallback, unknown, opted-out, and degraded scenarios all appear in both human and JSON output.

## Steps

1. Add `scripts/verify-m045-s01.ts` and `scripts/verify-m045-s01.test.ts` to execute the GitHub review contract matrix and report named pass/fail checks for prompt and Review Details behavior.
2. Update `scripts/verify-m042-s02.ts` and `scripts/verify-m042-s03.ts` to reuse the new contract projections or wording expectations so continuity checks remain truthful after the contract refactor.
3. Register `verify:m045:s01` in `package.json` and make the verifier surface expose scenario names, contract state, and phrase mismatches for fast drift diagnosis.

## Must-Haves

- [ ] One rerunnable command proves the GitHub review contract across all five in-scope author scenarios.
- [ ] Existing M042 truthfulness verifiers continue to guard against contradictory prompt/details behavior after the refactor.
- [ ] JSON output includes enough detail for S02/S03 to reuse the same fixtures instead of rebuilding them.

## Inputs

- `scripts/verify-m042-s02.ts`
- `scripts/verify-m042-s03.ts`
- `src/contributor/experience-contract.ts`
- `src/execution/review-prompt.ts`
- `src/lib/review-utils.ts`
- `package.json`

## Expected Output

- `scripts/verify-m045-s01.ts`
- `scripts/verify-m045-s01.test.ts`
- `scripts/verify-m042-s02.ts`
- `scripts/verify-m042-s03.ts`
- `package.json`

## Verification

bun test ./scripts/verify-m045-s01.test.ts && bun run verify:m042:s02 && bun run verify:m042:s03 && bun run verify:m045:s01 && bun run tsc --noEmit

## Observability Impact

- Signals added/changed: a new `verify:m045:s01` command emits named contract checks and scenario-level drift diagnostics.
- How a future agent inspects this: run `bun run verify:m045:s01 -- --json` and inspect the failing scenario/surface output.
- Failure state exposed: prompt/details contradictions, opt-out leaks, and degraded overclaims are reported as explicit check failures.
