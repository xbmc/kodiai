# S01: Contract-Driven GitHub Review Behavior

**Goal:** Ship the explicit contributor-experience contract on the core GitHub review surface by separating contributor signal provenance and confidence from review behavior, then apply that contract consistently to review-time resolution, prompt shaping, and Review Details.
**Demo:** Given profile-backed, coarse fallback, unknown, and opted-out/degraded author inputs through the review path, GitHub review prompt instructions and Review Details reflect one explicit contributor-experience contract with truthful, non-contradictory behavior.

## Must-Haves

- Introduce one typed contributor-experience contract for the GitHub review surface that separates signal provenance/coarseness from prompt behavior and visible Review Details wording.
- `src/handlers/review.ts` resolves profile-backed, coarse fallback, unknown, opted-out, and degraded author inputs even when `knowledgeStore` is unavailable, without silently defaulting to the old mixed-tier behavior.
- `src/execution/review-prompt.ts` and `src/lib/review-utils.ts` consume contract projections instead of raw mixed tier strings, and the two surfaces stay truthful and non-contradictory.
- `scripts/verify-m045-s01.ts`, `bun run verify:m042:s02`, and `bun run verify:m042:s03` prove the GitHub review contract end to end, and `bun run tsc --noEmit` stays clean.

## Threat Surface

- **Abuse**: stale or malformed contributor signals, cache poisoning, or opt-out bypass must not yield overconfident/patronizing guidance or continue adapted behavior after opt-out.
- **Data exposure**: Review Details may reveal contributor-experience state, but must not expose Slack identity, profile IDs, raw expertise scores, or internal-only confidence internals.
- **Input trust**: GitHub author association, Search API PR counts, `author_cache` rows, and contributor-profile opt-out state are all untrusted until normalized by the contract layer.

## Requirement Impact

- **Requirements touched**: R046
- **Re-verify**: GitHub review prompt instructions, Review Details output, M042 truthfulness verifiers, and degraded disclosure behavior.
- **Decisions revisited**: D042, D062

## Proof Level

- This slice proves: contract plus integration proof on deterministic GitHub review-path fixtures.
- Real runtime required: no.
- Human/UAT required: no.

## Verification

- `bun test ./src/contributor/experience-contract.test.ts ./src/handlers/review.test.ts ./src/execution/review-prompt.test.ts ./src/lib/review-utils.test.ts ./scripts/verify-m045-s01.test.ts`
- `bun run verify:m042:s02 && bun run verify:m042:s03 && bun run verify:m045:s01`
- `bun run tsc --noEmit`

## Observability / Diagnostics

- Runtime signals: `src/handlers/review.ts` should log the resolved contributor-experience source/state/degradation path instead of only a raw tier string.
- Inspection surfaces: the Review Details contract line, targeted handler/prompt/detail tests, and `bun run verify:m045:s01 -- --json`.
- Failure visibility: verifier output should report the failing scenario, surface, and required/banned phrase mismatch when prompt and Review Details drift.
- Redaction constraints: do not surface Slack IDs, contributor profile IDs, or raw expertise scores in Review Details for generic, opted-out, or degraded paths.

## Integration Closure

- Upstream surfaces consumed: `src/contributor/profile-store.ts`, `src/lib/author-classifier.ts`, `author_cache`, `src/handlers/review.ts`, `src/execution/review-prompt.ts`, `src/lib/review-utils.ts`, and the M042 verifier scripts.
- New wiring introduced in this slice: one contributor-experience contract seam feeds review-time resolution, prompt shaping, and Review Details.
- What remains before the milestone is truly usable end-to-end: S02 must extend the same contract to Slack/opt-out messaging, identity-link copy, and retrieval shaping; S03 must ship the cross-surface verifier.

## Tasks

- [x] **T01: Resolve contributor signals into one GitHub review contract and surface it in Review Details** `est:2h`
  - Why: The slice cannot truthfully change GitHub review behavior until review-time resolution can distinguish profile-backed, coarse fallback, unknown, opted-out, and degraded states without depending on `knowledgeStore` presence.
  - Files: `src/contributor/experience-contract.ts`, `src/contributor/experience-contract.test.ts`, `src/contributor/types.ts`, `src/contributor/profile-store.ts`, `src/handlers/review.ts`, `src/handlers/review.test.ts`, `src/lib/review-utils.ts`, `src/lib/review-utils.test.ts`
  - Do: Add the contract module, extend system-level contributor profile lookup to detect opted-out profiles, resolve contract state in `src/handlers/review.ts`, and change Review Details formatting to render the new projection instead of a raw mixed-tier string.
  - Verify: `bun test ./src/contributor/experience-contract.test.ts ./src/handlers/review.test.ts ./src/lib/review-utils.test.ts`
  - Done when: Review Details renders truthful contract wording for profile-backed, coarse fallback, unknown, opted-out, and degraded scenarios, and handler tests prove the resolver no longer needs `knowledgeStore` just to decide contributor-experience behavior.

- [x] **T02: Drive review prompt shaping from the same contributor-experience contract** `est:90m`
  - Why: Prompt behavior is currently a separate raw-tier mapping; if it is not moved onto the same contract as Review Details, the GitHub surface will keep drifting.
  - Files: `src/contributor/experience-contract.ts`, `src/contributor/experience-contract.test.ts`, `src/execution/review-prompt.ts`, `src/execution/review-prompt.test.ts`, `src/handlers/review.ts`, `src/handlers/review.test.ts`
  - Do: Replace raw-tier prompt branching with contract-driven prompt policy helpers, thread the contract object through prompt-building call sites, and pin the profile-backed/coarse/generic/opt-out/degraded prompt matrix in tests.
  - Verify: `bun test ./src/contributor/experience-contract.test.ts ./src/execution/review-prompt.test.ts ./src/handlers/review.test.ts ./src/lib/review-utils.test.ts`
  - Done when: Prompt instructions and Review Details are driven by the same contract projection, expertise-specific caution only appears for high-confidence profile-backed states, and contradictory legacy phrases are banned by tests.

- [x] **T03: Add the GitHub review contract verifier and preserve M042 truthfulness guards** `est:75m`
  - Why: The slice needs one durable proof surface that exercises the full GitHub contract matrix and keeps the older M042 truthfulness guardrails meaningful after the vocabulary shift.
  - Files: `scripts/verify-m045-s01.ts`, `scripts/verify-m045-s01.test.ts`, `scripts/verify-m042-s02.ts`, `scripts/verify-m042-s03.ts`, `package.json`
  - Do: Add the new `verify:m045:s01` verifier, update the M042 verifiers to reuse the contract-aware expectations, and register the command so future slices can rerun the same matrix without reconstructing fixtures.
  - Verify: `bun test ./scripts/verify-m045-s01.test.ts && bun run verify:m042:s02 && bun run verify:m042:s03 && bun run verify:m045:s01 && bun run tsc --noEmit`
  - Done when: One rerunnable command proves prompt/details behavior for all five in-scope author scenarios and the updated M042 verifiers still guard against contradictory GitHub review behavior.

## Files Likely Touched

- `src/contributor/experience-contract.ts`
- `src/contributor/experience-contract.test.ts`
- `src/contributor/types.ts`
- `src/contributor/profile-store.ts`
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
- `src/lib/review-utils.ts`
- `src/lib/review-utils.test.ts`
- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`
- `scripts/verify-m045-s01.ts`
- `scripts/verify-m045-s01.test.ts`
- `scripts/verify-m042-s02.ts`
- `scripts/verify-m042-s03.ts`
- `package.json`
