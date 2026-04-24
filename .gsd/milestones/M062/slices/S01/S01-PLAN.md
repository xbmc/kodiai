# S01: Bounded first-pass contract

**Goal:** Define and prove a normalized bounded first-pass review contract so large PRs publish truthful constrained output instead of ending in the dead-end max_turns failure path.
**Demo:** After this: a large PR that would previously die at `max_turns` produces a truthful bounded first-pass result instead of an empty or dead-end failure outcome.

## Must-Haves

- A shared lib-level bounded first-pass state models bounded reason, covered scope, remaining scope, publication eligibility, and continuation-pending state from structured evidence rather than prose.
- `src/handlers/review.ts` projects timeout and `max_turns`/publishless constrained outcomes through that shared state, preserves the single `reviewOutputKey` surface, and only falls back to a hard failure comment when no truthful first-pass evidence exists.
- Visible summary and Review Details surfaces consume the same normalized state so covered/remaining scope and bounded reason cannot drift.
- Deterministic regression coverage plus a dedicated `verify:m062:s01` proof harness distinguish the old dead-end failure outcome from the new bounded-first-pass publication contract.

## Proof Level

- This slice proves: This slice proves an integration-level contract: constrained large-PR runs with checkpoint or triage evidence publish one truthful bounded first-pass surface, and dead-end `max_turns` fallback remains only for zero-evidence failures. Real runtime required: no. Human/UAT required: no.

## Integration Closure

Consumes the existing review boundedness seam, checkpoint persistence, partial-review publication path, Review Details rendering, and stable `reviewOutputKey` idempotency. This slice adds one normalized first-pass contract and routes constrained publication through it. S02 can then refine user-visible wording without changing state semantics; S03 can compose this contract into the milestone baseline verifier.

## Verification

- Runtime signals: bounded first-pass reason, evidence source, covered/remaining counts, and publication eligibility should be visible through handler logs and deterministic verifier output.
- Inspection surfaces: `src/handlers/review.test.ts`, `src/lib/review-utils.test.ts`, the new `scripts/verify-m062-s01.ts`, and any emitted bounded-review log fields.
- Failure visibility: regressions should show up as missing bounded publication, mismatched covered/remaining counts, or an explicit verifier status code for dead-end-vs-bounded drift.
- Redaction constraints: expose counts, reason codes, and reviewOutputKey-linked state only; never leak prompt internals, secrets, or unpublished checkpoint prose beyond the existing review surface.

## Tasks

- [x] **T01: Define the normalized bounded first-pass state and pure contract tests** `est:2h`
  Extract the core contract first so later handler work stops branching on timeout-only wording versus `max_turns` failure prose. Create one focused lib seam that combines review boundedness, checkpoint evidence, and execution outcome into a normalized first-pass payload with explicit bounded reason, covered scope, remaining scope, publication eligibility, and continuation-pending state. Keep the contract conservative: counts and reviewed file lists may come from checkpoint evidence, but any field not backed by structured evidence must stay absent rather than inferred from prose. Record executor skills in the rendered frontmatter as `test-driven-development`, `verification-before-completion`, and `observability` if the task introduces diagnostic fields.
  - Files: `src/lib/review-boundedness.ts`, `src/lib/review-first-pass.ts`, `src/lib/review-boundedness.test.ts`, `src/lib/review-first-pass.test.ts`, `src/knowledge/types.ts`
  - Verify: bun test ./src/lib/review-boundedness.test.ts ./src/lib/review-first-pass.test.ts

- [x] **T02: Route constrained review publication through the bounded first-pass contract** `est:3h`
  Apply the new contract at the root-cause seam in `src/handlers/review.ts`. Replace the split between timeout partial publication and dead-end `max_turns` fallback with one bounded-first-pass projection that uses checkpoint or triage evidence when available, preserves the existing `reviewOutputKey` identity, and keeps true hard failure only for zero-evidence runs. Update partial-review formatting and Review Details rendering so both consume the same normalized state, including covered/remaining scope and bounded reason. Keep the summary structure valid for `comment-server` and do not add a second public surface. Record executor skills in the rendered frontmatter as `test-driven-development`, `verification-before-completion`, `systematic-debugging`, and `observability`.
  - Files: `src/handlers/review.ts`, `src/handlers/review.test.ts`, `src/lib/partial-review-formatter.ts`, `src/lib/partial-review-formatter.test.ts`, `src/lib/review-utils.ts`, `src/lib/review-utils.test.ts`, `src/lib/review-first-pass.ts`, `src/handlers/review-idempotency.ts`
  - Verify: bun test ./src/lib/partial-review-formatter.test.ts ./src/lib/review-utils.test.ts ./src/handlers/review.test.ts

- [ ] **T03: Ship a deterministic verifier for bounded first-pass versus dead-end failure** `est:2h`
  Lock the slice with a dedicated proof surface modeled after the M048 verifier style, but scoped to this contract. Add a pure-code `verify:m062:s01` harness plus regression tests that classify representative scenarios such as timeout with checkpoint evidence, `max_turns` with checkpoint evidence, large-PR boundedness without timeout, and zero-evidence failure. The harness should prove that bounded-first-pass publication and hard failure are distinguished by structured state, not by brittle string matching alone, while still checking package-script wiring and human/JSON output consistency. Record executor skills in the rendered frontmatter as `test-driven-development`, `verification-before-completion`, and `observability`.
  - Files: `scripts/verify-m062-s01.ts`, `scripts/verify-m062-s01.test.ts`, `package.json`, `src/lib/review-first-pass.ts`, `src/handlers/review.ts`
  - Verify: bun test ./scripts/verify-m062-s01.test.ts && bun run verify:m062:s01 -- --json && bun run tsc --noEmit

## Files Likely Touched

- src/lib/review-boundedness.ts
- src/lib/review-first-pass.ts
- src/lib/review-boundedness.test.ts
- src/lib/review-first-pass.test.ts
- src/knowledge/types.ts
- src/handlers/review.ts
- src/handlers/review.test.ts
- src/lib/partial-review-formatter.ts
- src/lib/partial-review-formatter.test.ts
- src/lib/review-utils.ts
- src/lib/review-utils.test.ts
- src/handlers/review-idempotency.ts
- scripts/verify-m062-s01.ts
- scripts/verify-m062-s01.test.ts
- package.json
