---
estimated_steps: 6
estimated_files: 6
skills_used:
  - test-driven-development
  - verification-before-completion
---

# T02: Drive review prompt shaping from the same contributor-experience contract

Move prompt shaping onto the same contract so GitHub review behavior and Review Details cannot drift.

## Negative Tests

- **Malformed inputs**: missing or partially populated contract projections still produce generic prompt guidance rather than empty or contradictory copy.
- **Error paths**: degraded or unknown contract states never emit established/senior/profile-backed phrases or expertise-only instructions.
- **Boundary conditions**: profile-backed established/senior, coarse fallback, opted-out, and generic unknown/degraded scenarios each have one pinned prompt section.

## Steps

1. Replace raw-tier branching in `src/execution/review-prompt.ts` with contract-driven prompt policy helpers from `src/contributor/experience-contract.ts`; keep area-expertise caveats gated to high-confidence profile-backed states only.
2. Update `src/handlers/review.ts` and integration tests so every prompt-building call site threads the contract object instead of raw `authorTier`, including retry/rebuild and degraded disclosure paths.
3. Extend `src/execution/review-prompt.test.ts`, `src/handlers/review.test.ts`, and `src/contributor/experience-contract.test.ts` to pin the prompt matrix and ban contradictory legacy phrases.

## Must-Haves

- [ ] Prompt instructions are derived from the same contract as Review Details.
- [ ] Coarse fallback can adapt only within the contract-approved behavior, and unknown/opted-out/degraded states stay generic.
- [ ] Expertise-specific caution appears only for profile-backed high-confidence states.

## Inputs

- `src/contributor/experience-contract.ts`
- `src/contributor/experience-contract.test.ts`
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
- `src/execution/review-prompt.ts`

## Expected Output

- `src/contributor/experience-contract.ts`
- `src/contributor/experience-contract.test.ts`
- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`

## Verification

bun test ./src/contributor/experience-contract.test.ts ./src/execution/review-prompt.test.ts ./src/handlers/review.test.ts ./src/lib/review-utils.test.ts

## Observability Impact

- Signals added/changed: prompt sections and degraded disclosures now come from the shared contract projection instead of raw tiers.
- How a future agent inspects this: run the prompt and handler tests, then compare the prompt author-experience section against Review Details in the verifier fixtures.
- Failure state exposed: prompt/details drift or expertise leaks show up as banned/required phrase failures per scenario.
