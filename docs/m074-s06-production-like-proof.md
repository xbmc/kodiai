# M074/S06 Production-like Same-PR Inline Fix Proof

M074/S06 closes the Clawpatch-inspired review workflow milestone with a compact proof that the current review trigger model can produce bounded same-PR inline fix evidence, lifecycle evidence, validation-truth evidence, and Review Details evidence without creating a bot branch, opening a separate PR, pushing directly, or expanding public output beyond the intended surfaces.

This proof is **production-like**, not a claim of live validation. The accepted checked-in evidence is `scripts/fixtures/m074-s06-production-like-proof.json`, evaluated by `bun run verify:m074:s06 -- --fixture scripts/fixtures/m074-s06-production-like-proof.json`. Exact-key live collection is supported by the verifier but optional for S06 acceptance; blocked or unavailable live sources remain blocked/unavailable and do not count as fixture success.

## Accepted proof path

The accepted S06 path is:

1. A review is handled through the existing review/mention surfaces, not through a replacement workflow or Clawpatch port.
2. The handler captures same-PR inline GitHub review suggestion evidence plus lifecycle, fix-eligibility, validation-truth, Review Details, redaction, visible-volume, and side-effect counters.
3. The captured evidence is reduced into the bounded `m074-s06-production-like-proof.v1` fixture contract.
4. `verify:m074:s06` evaluates that contract and reports compact check IDs, status codes, source availability, correlation presence, visible-volume counts, side-effect counters, and redaction flags without emitting raw prompts, model output, candidate bodies, replacement text, tool payloads, full diffs, or secrets.

The verifier requires all of these S06 checks to pass for fixture success:

- `fixture.shape`
- `source.available`
- `correlation.exact`
- `same-pr-inline-suggestion.present`
- `lifecycle.rows.passed`
- `fix-eligibility.rows.passed`
- `validation-truth.rows.passed`
- `review-details.validation-truth.passed`
- `validation-truth.not-suggested-only`
- `visible-volume.bounded`
- `side-effects.absent`
- `redaction.safe`
- `package-wiring.present`

## Trigger shape and non-simulated assumptions

Current S06 proof assumptions are intentionally narrow:

- Same-PR inline GitHub review suggestions only.
- Existing `pull_request` and explicit `@kodiai review` review paths remain the first-class trigger surfaces.
- No bot branch creation.
- No separate bot PR creation.
- No direct push to a repository branch.
- No replacement of ReviewPlan, candidate bridge, candidate verification, Review Details, or existing publication gates.
- Suggested fixes are **not** resolved merely because they were suggested or published; closure requires validation or fresh revalidation evidence.

## Required correlation evidence

Every accepted S06 proof must include exact correlation fields:

- `reviewOutputKey` — the review-output idempotency/correlation key for the produced review surface.
- `deliveryId` — the webhook or trigger delivery identifier associated with the run.

For the checked-in production-like fixture, the expected values are:

- `reviewOutputKey`: `m074-s06-review-output`
- `deliveryId`: `delivery-m074-s06`

The verifier fails the `correlation.exact` check when either value is absent, stale, or different from the expected CLI argument/fixture value.

## Public surfaces under proof

S06 allows only bounded, reviewed public surfaces:

- Existing GitHub review output for same-PR inline suggestion blocks.
- Review Details lines for compact lifecycle, validation-truth, and reason-code summaries.
- Compact verifier diagnostics containing status codes, check IDs, availability/correlation flags, counts, and redaction booleans.

The production-like fixture proves bounded public volume with:

- `publicCommentCount: 2` and `maxPublicCommentCount: 2`
- `inlineSuggestionCommentCount: 1` and `maxInlineSuggestionCommentCount: 1`
- `reviewDetailsLineCount: 9` and `maxReviewDetailsLineCount: 12`
- `reviewDetailsValidationTruthLineCount: 1`

## Private and redacted surfaces

The reducer boundary remains private for raw or high-volume artifacts. S06 verifier output must not contain:

- Raw prompts.
- Raw model output.
- Candidate bodies.
- Replacement text.
- Tool payloads.
- Full diffs.
- Secret-like strings.
- Unbounded arrays.

The production-like fixture records all corresponding redaction flags as false and `canariesAbsent: true`. The S06 test suite also asserts forbidden canary strings are absent from serialized verifier output.

## Side-effect denials

S06 proof explicitly denies branch/PR/push side effects. The accepted fixture records:

- `botBranchCreated: 0`
- `separatePrCreated: 0`
- `directPushCount: 0`
- `unexpectedPublicCommentCount: 0`

Any non-zero value fails `side-effects.absent`.

## Live-mode semantics

`verify:m074:s06` can be run without a fixture and with exact-key live arguments, but the built-in CLI live source is intentionally fail-closed unless real live collectors provide evidence. Live-source outcomes are not collapsed into production-like success:

- Blocked GitHub/runtime access reports `m074_s06_live_source_blocked` or related blocked status.
- Unavailable exact-key evidence reports unavailable/failed status.
- Missing runtime correlation reports a runtime-correlation failure.
- `--allow-blocked` may be used only to make blocked status an expected diagnostic outcome; it does not convert live evidence into passed production-like proof.

This document does not claim that a live run passed. It records the production-like fixture proof and the exact-key live semantics operators should use when live evidence exists.

## Verification commands

Run the full closeout bundle before treating M074/S06 as complete:

```bash
bun test scripts/verify-m074-s02.test.ts scripts/verify-m074-s03.test.ts scripts/verify-m074-s04.test.ts scripts/verify-m074-s05.test.ts scripts/verify-m074-s06.test.ts src/handlers/review.test.ts src/handlers/mention.test.ts src/lib/review-utils.test.ts src/review-lifecycle/handler-lifecycle.test.ts src/review-lifecycle/validation-truth.test.ts
bun run verify:m074:s01
bun run verify:m074:s02
bun run verify:m074:s03
bun run verify:m074:s04
bun run verify:m074:s05
bun run verify:m074:s06 -- --fixture scripts/fixtures/m074-s06-production-like-proof.json
```

For machine-readable S06 diagnostics, add `--json`:

```bash
bun run verify:m074:s06 -- --fixture scripts/fixtures/m074-s06-production-like-proof.json --json
```

## Requirement impact

- R043 is re-verified by keeping explicit review trigger coverage in the closeout test bundle.
- R132 is re-verified at the M074 level by preserving candidate publication gates, dedupe/idempotency, reducer approval evidence, validation-truth checks, and same-PR-only publication.
- R131 and R133 receive supporting evidence only. They remain broader follow-up requirements and are not validated by S06 alone.

## Remaining rollout limitations

- S06 proves a production-like same-PR inline suggestion path, not a broad live rollout.
- Exact-key live collection is optional and must be interpreted separately from fixture success.
- The proof is scoped to same-PR inline GitHub review suggestions; bot branch workflows, bot PR workflows, and direct-push workflows remain out of scope.
- Suggested fixes remain open or uncertain unless validation/revalidation evidence supports closure.
- Future rollout still needs broader telemetry, cost/noise controls, and specialist-lane rollout gates before R131/R133 can be closed.
