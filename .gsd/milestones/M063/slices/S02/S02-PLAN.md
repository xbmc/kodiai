# S02: One evolving review surface with explicit revisions

**Goal:** Make continuation publish through one canonical review surface anchored to the base reviewOutputKey, render explicit revision deltas on that same surface, and keep no-delta continuation quiet.
**Demo:** Continuation deepens the same visible review surface in place: no extra lifecycle comment appears, revised findings are explicitly marked on that surface, and no-meaningful-delta continuation settles the lifecycle without noisy public churn.

## Must-Haves

- Timeout/continuation paths use one canonical visible review surface for the lifecycle and do not create a second standalone Review Details comment for the same reviewOutputKey.
- The canonical bounded comment remains rediscoverable for later continuation updates and refreshes its nested Review Details block in place.
- Continuation-visible changes are explicit on that same surface, including new, still-open, and resolved/revised findings, rather than silently rewriting prior conclusions.
- No-meaningful-delta continuation settles without extra public churn while preserving the original bounded first-pass surface.
- Deterministic proof covers same-surface ownership, explicit revision wording, and quiet no-delta settlement on the shipped path.

## Proof Level

- This slice proves: This slice proves: integration | contract
- Real runtime required: yes
- Human/UAT required: no

## Integration Closure

- Upstream surfaces consumed: `src/lib/review-continuation-lifecycle.ts`, `src/handlers/review.ts`, `src/lib/review-utils.ts`, `src/lib/partial-review-formatter.ts`, `src/lib/delta-classifier.ts`, `src/knowledge/types.ts`.
- New wiring introduced in this slice: continuation timeout and retry publication paths converge on one canonical bounded comment that owns the nested Review Details block and revision summary rendering.
- What remains before the milestone is truly usable end-to-end: S03 must prove continuation prompt/context narrowing and extend authority-safe proof across the final shipped write paths.

## Verification

- Handler tests remain the primary inspection surface for canonical-comment ownership, retry merge updates, quiet no-delta settlement, and stale-authority suppression on the real queued continuation path.
- Deterministic verifier output should expose same-surface lifecycle states so a future agent can see whether continuation created one surface, rendered revisions, or stayed quiet on no-delta settlement.
- Review-output marker continuity and explicit revision wording must stay inspectable in comment bodies rather than only in logs.

## Tasks

- [x] **T01: Anchor continuation to one canonical review comment** `est:1.5h`
  Collapse the timeout/continuation public lifecycle onto the bounded first-pass comment so later continuation passes update one stable visible surface instead of creating a second standalone Review Details comment.

Steps:
1. Audit `src/handlers/review.ts` timeout, append, and retry-merge branches to define the canonical comment contract: the bounded first-pass comment is rediscoverable by base `reviewOutputKey` and owns nested Review Details updates.
2. Update the bounded comment formatting/publication path so the canonical comment carries a stable review-output marker or equivalent durable identity, then route timeout Review Details publication through same-surface append/update behavior instead of a standalone continuation lifecycle comment.
3. Rework retry merge to refresh Review Details on that same canonical comment, still honoring `ReviewWorkCoordinator` publish-right rechecks and existing fallback behavior only where the base summary surface truly does not exist.
4. Extend handler coverage around timeout publication, same-surface refresh, and stale-authority suppression so the contract is explicit before revision wording is added.

Must-haves:
- The bounded first-pass comment is rediscoverable later from the base `reviewOutputKey` without relying only on ephemeral locals.
- Timeout/continuation paths stop creating a second public lifecycle comment when the canonical summary surface exists.
- Retry merge updates the same canonical comment in place and keeps publish-right suppression semantics intact.
  - Files: `src/handlers/review.ts`, `src/lib/partial-review-formatter.ts`, `src/handlers/review.test.ts`, `src/handlers/review-idempotency.ts`
  - Verify: bun test ./src/handlers/review.test.ts --filter "timeout" && bun test ./src/handlers/review.test.ts --filter "retry merge"

- [x] **T02: Render explicit continuation revisions without noisy no-delta churn** `est:1.5h`
  Use the existing delta-classifier seam to make continuation-visible revisions legible on the canonical comment while keeping no-meaningful-delta continuation quiet.

Steps:
1. Add a small formatter seam for continuation revision summaries sourced from `DeltaClassification`, covering new findings, still-open findings, and resolved/revised findings in user-visible wording appropriate for the bounded comment or nested Review Details block.
2. Thread delta classification through the continuation merge path in `src/handlers/review.ts` so merged updates render explicit revisions on the canonical surface instead of silently rewriting the summary draft.
3. Ensure no-delta settlement keeps the original bounded comment unchanged publicly while preserving internal settlement/logging semantics from S01.
4. Extend formatter and handler tests to prove revision wording, same-surface rendering, and quiet no-delta behavior.
  - Files: `src/handlers/review.ts`, `src/lib/partial-review-formatter.ts`, `src/lib/review-utils.ts`, `src/lib/delta-classifier.ts`, `src/lib/partial-review-formatter.test.ts`, `src/handlers/review.test.ts`
  - Verify: bun test ./src/lib/partial-review-formatter.test.ts && bun test ./src/handlers/review.test.ts --filter "continuation"

- [ ] **T03: Add deterministic proof for same-surface continuation revisions** `est:1h`
  Lock the shipped S02 contract with a deterministic verifier and package wiring so future slices can detect regressions in public-surface ownership, explicit revisions, and quiet no-delta settlement.

Steps:
1. Model an S02 scenario matrix in a new verifier script that exercises the production formatter/publication seams for timeout first pass, merge continuation, explicit revisions, and no-delta settlement.
2. Add verifier tests for CLI args, scenario status codes, contract failures, and human-readable report output, mirroring existing M062/M063 verifier style.
3. Wire the verifier into `package.json` and finish with a focused end-to-end verification run across formatter, handler, verifier, and TypeScript diagnostics if available.

Must-haves:
- The verifier reports whether continuation stayed on one visible surface, rendered explicit revisions, and avoided public churn on no-delta settlement.
- Test coverage fails if the canonical comment loses marker continuity or if a second lifecycle comment reappears.
- Package scripts expose `verify:m063:s02` for milestone-level proof.
  - Files: `scripts/verify-m063-s02.ts`, `scripts/verify-m063-s02.test.ts`, `package.json`, `src/handlers/review.test.ts`, `src/lib/partial-review-formatter.test.ts`
  - Verify: bun test ./scripts/verify-m063-s02.test.ts && bun run verify:m063:s02 -- --json && bun run tsc --noEmit

## Files Likely Touched

- src/handlers/review.ts
- src/lib/partial-review-formatter.ts
- src/handlers/review.test.ts
- src/handlers/review-idempotency.ts
- src/lib/review-utils.ts
- src/lib/delta-classifier.ts
- src/lib/partial-review-formatter.test.ts
- scripts/verify-m063-s02.ts
- scripts/verify-m063-s02.test.ts
- package.json
