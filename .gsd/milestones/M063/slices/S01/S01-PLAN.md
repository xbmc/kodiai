# S01: Automatic continuation lifecycle contract

**Goal:** Refactor large-PR bounded follow-up from timeout-specialized retry plumbing into an explicit continuation lifecycle contract that automatically schedules and settles continuation through the real review handler path without a manual follow-up command.
**Demo:** A large-PR bounded first pass automatically schedules and executes continuation through the real review handler path, using an explicit continuation planner/settlement seam rather than branch-local timeout plumbing, with no manual follow-up command required.

## Must-Haves

- **Demo:** A bounded large-PR first pass automatically schedules follow-up continuation through the existing review job path, and that continuation can merge or settle through the same handler-owned lifecycle without adding a new manual trigger.
- ## Must-Haves
- Extract a dedicated continuation lifecycle seam so `src/handlers/review.ts` stops owning ad hoc retry planning, merge, and settlement decisions inline.
- Preserve current bounded first-pass publication truthfulness from `normalizeReviewFirstPass(...)` while promoting automatic continuation to the default large-PR follow-up path.
- Keep continuation keyed to the base `reviewOutputKey` public lifecycle while allowing internal continuation pass identity to vary.
- Recheck `ReviewWorkCoordinator` publish authority on continuation update paths so stale queued continuation cannot overwrite newer review work.
- Add deterministic proof for automatic scheduling, merge/settlement behavior, and stale-authority suppression on the shipped S01 lifecycle paths.
- ## Threat Surface
- **Abuse**: replayed or superseded continuation attempts could try to update the bounded review after newer review work has become authoritative; malformed checkpoint state could incorrectly claim remaining scope or continuation eligibility.
- **Data exposure**: no new secret surface is introduced, but continuation decisions consume checkpoint summaries and GitHub-visible review state, so the slice must avoid leaking additional PR content outside existing review comments and telemetry.
- **Input trust**: webhook payload metadata, checkpoint records, diff-derived file lists, and persisted partial-comment IDs are all trusted only after validation and must not silently promote malformed continuation state.
- ## Requirement Impact
- **Requirements touched**: R062
- **Re-verify**: bounded first-pass publication, automatic continuation enqueue, continuation merge/settlement behavior, and stale publish-rights suppression for queued follow-up work.
- **Decisions revisited**: D181, D183
- ## Verification
- `bun test src/lib/review-continuation-lifecycle.test.ts`
- `bun test src/handlers/review.test.ts --filter "continuation"`
- `bun test scripts/verify-m063-s01.test.ts && bun run scripts/verify-m063-s01.ts --json`
- ## Observability / Diagnostics
- Runtime signals: continuation planner outcome, continuation pass key, retry/settlement reason, and publish-authority verdict stay visible in handler logs and resilience telemetry.
- Inspection surfaces: `src/handlers/review.test.ts` assertions, `scripts/verify-m063-s01.ts`, and `ReviewWorkCoordinator` snapshots/log capture in tests.
- Failure visibility: continuation state, base vs continuation `reviewOutputKey`, delivery IDs, and authority-loss reasons must remain inspectable when merge/update is skipped.
- Redaction constraints: do not add new logs that dump raw PR bodies, tokens, or credential-bearing checkpoint state.

## Proof Level

- This slice proves: - This slice proves: integration
- Real runtime required: no
- Human/UAT required: no

## Integration Closure

- Upstream surfaces consumed: `src/handlers/review.ts`, `src/lib/review-first-pass.ts`, `src/lib/retry-scope-reducer.ts`, `src/lib/partial-review-formatter.ts`, `src/knowledge/types.ts`, `src/jobs/review-work-coordinator.ts`
- New wiring introduced in this slice: a dedicated continuation lifecycle module becomes the handler-owned seam for continuation planning, merge eligibility, settlement, and checkpoint cleanup.
- What remains before the milestone is truly usable end-to-end: S02 still needs explicit same-surface revision/no-delta semantics, and S03 still needs measurable prompt narrowing plus shipped authority-safe proof across all final write paths.

## Verification

- Continuation lifecycle decisions become explicit and testable: planners can inspect stable continuation state transitions, queued pass identity, merge/settlement reasons, and publish-authority suppression without reverse-engineering the monolithic timeout branch in `src/handlers/review.ts`.

## Tasks

- [x] **T01: Extract a dedicated continuation lifecycle planner from the timeout branch** `est:45m`
  Build a pure continuation lifecycle module around the existing bounded first-pass, retry-scope, and checkpoint seams so the handler can stop recomputing continuation state inline. Keep the first slice intentionally narrow: model automatic continuation planning, continuation-pass identity, bounded settlement readiness, merge inputs, and cleanup decisions for the current single-follow-up policy without changing public wording yet.

Steps:
1. Create `src/lib/review-continuation-lifecycle.ts` with typed inputs/outputs for planning continuation from first-pass evidence, deriving continuation pass keys from the base `reviewOutputKey`, deciding whether continuation should be scheduled, and deciding whether a finished continuation has enough structured evidence to merge or should settle with no update.
2. Move the existing retry-scope, chronic-timeout, no-remaining-scope, and checkpoint-merge arithmetic behind that module while keeping `normalizeReviewFirstPass(...)` as the source of truth for what is publicly publishable.
3. Write `src/lib/review-continuation-lifecycle.test.ts` first, covering happy-path planning plus edge cases: zero-evidence failures, already-published inline findings, malformed/partial checkpoint scope, empty remaining scope, chronic timeout suppression, merge-ready continuation, and no-delta settlement.
4. Keep the module side-effect free so later slices can reuse the same seam for public-surface revisions and prompt narrowing without re-deriving lifecycle rules from handler prose.

## Negative Tests

- **Malformed inputs**: missing `reviewOutputKey`, checkpoint scope where reviewed files exceed total files, empty continuation file list, and inconsistent merge inputs.
- **Error paths**: bounded first pass absent or zero-evidence should never produce a continuation plan; inline-output-already-published should suppress continuation planning.
- **Boundary conditions**: no remaining files, single remaining file, and merge with no new reviewed files must settle deterministically.

## Must-Haves

- [ ] Encode continuation planning and settlement as explicit typed decisions instead of anonymous handler locals
- [ ] Preserve the base `reviewOutputKey` as the public lifecycle identity while deriving continuation pass keys separately
- [ ] Prove the extracted seam handles no-follow-up, follow-up, merge-ready, and no-delta outcomes with unit coverage
  - Files: `src/lib/review-continuation-lifecycle.ts`, `src/lib/review-continuation-lifecycle.test.ts`, `src/lib/review-first-pass.ts`, `src/lib/retry-scope-reducer.ts`, `src/knowledge/types.ts`
  - Verify: bun test src/lib/review-continuation-lifecycle.test.ts

- [x] **T02: Wire the review handler through the continuation lifecycle seam** `est:1h15m`
  Replace the timeout-specialized continuation block in `src/handlers/review.ts` with orchestration over the extracted lifecycle planner while keeping the real publication path and coordinator semantics intact. This task closes the actual product requirement: a bounded first pass should enqueue continuation automatically through the live handler-owned job flow, and queued continuation must recheck publish authority before mutating the bounded review surface.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `knowledgeStore` checkpoint reads/writes | fall back to the existing zero-evidence / no-merge behavior and log why continuation could not be advanced | keep the original bounded output intact and settle without follow-up mutation | refuse to plan or merge continuation from malformed checkpoint scope |
| `jobQueue.enqueue(...)` follow-up execution | keep the first-pass comment truthful and visible; do not claim continuation succeeded | leave continuation pending but avoid duplicate enqueues from the same attempt | reject missing continuation files or keys before dispatch |
| `ReviewWorkCoordinator` publish checks | skip bounded-comment or Review Details updates when authority is lost and log the suppressed attempt | preserve the newer authoritative attempt | treat inconsistent attempt identity as non-publishable |

## Load Profile

- **Shared resources**: job queue ordering, checkpoint rows keyed by `reviewOutputKey`, and review-work family authority state
- **Per-operation cost**: one continuation planning pass per bounded first pass plus at most one queued continuation execution on the shipped path
- **10x breakpoint**: duplicated enqueues or stale checkpoint churn would break before CPU does; tests must prove single-follow-up planning and cleanup

## Negative Tests

- **Malformed inputs**: missing checkpoint comment id, malformed checkpoint scope, and inconsistent continuation plan state
- **Error paths**: queued continuation with no additional results, queued continuation losing publish authority, and continuation planner returning no-follow-up
- **Boundary conditions**: bounded first pass with exactly one remaining file, no remaining files, and superseding review work arriving before continuation publishes

## Must-Haves

- [ ] `src/handlers/review.ts` delegates continuation planning, merge, and settlement decisions to the extracted lifecycle module
- [ ] Automatic continuation still goes through the real queued review execution path; no manual trigger or fake shortcut is introduced
- [ ] All continuation update paths recheck `ReviewWorkCoordinator` authority before changing the bounded comment or Review Details surface
- [ ] Handler tests cover auto-enqueue, successful merge, no-delta settlement, and superseded-update suppression
  - Files: `src/handlers/review.ts`, `src/handlers/review.test.ts`, `src/lib/review-continuation-lifecycle.ts`, `src/lib/partial-review-formatter.ts`, `src/jobs/review-work-coordinator.ts`, `src/knowledge/types.ts`
  - Verify: bun test src/handlers/review.test.ts --filter "continuation"

- [ ] **T03: Add a deterministic verifier for the automatic continuation lifecycle contract** `est:45m`
  Package the shipped S01 behavior into a machine-checkable verifier so later slices can build on a stable lifecycle proof instead of rediscovering it from `review.test.ts`. The verifier should exercise the real continuation seam and report whether bounded first-pass output automatically produces a continuation plan, whether merge/no-delta settlement decisions are explicit, and whether stale continuation loses authority before updating visible state.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `src/lib/review-continuation-lifecycle.ts` exports | fail the verifier loudly with named invalid-contract statuses | not applicable for local imports | reject scenarios whose planner output is missing required fields |
| `src/handlers/review.ts` continuation fixtures/helpers | surface the mismatch in the scenario issues list instead of silently skipping coverage | not applicable for local helpers | classify the scenario as invalid-contract rather than passing with partial evidence |

## Load Profile

- **Shared resources**: local Bun process only; verifier must stay deterministic and in-process
- **Per-operation cost**: a small fixed scenario matrix covering schedule, merge, no-delta, and stale-authority suppression
- **10x breakpoint**: output readability degrades before runtime cost matters, so keep report fields compact and semantic

## Negative Tests

- **Malformed inputs**: invalid scenario ids and planner outputs missing continuation status or pass identity
- **Error paths**: no-follow-up, no-delta, and stale-authority scenarios must return explicit non-success statuses instead of generic pass/fail prose
- **Boundary conditions**: single-pass merge-ready, no remaining scope, and superseded continuation after a newer attempt claims authority

## Must-Haves

- [ ] Add `scripts/verify-m063-s01.ts` with stable human-readable and `--json` output
- [ ] Reuse production continuation and handler seams instead of hand-writing parallel lifecycle logic in the verifier
- [ ] Fail deterministically when automatic continuation, merge/settlement classification, or stale-authority suppression regresses
  - Files: `scripts/verify-m063-s01.ts`, `scripts/verify-m063-s01.test.ts`, `src/lib/review-continuation-lifecycle.ts`, `src/handlers/review.test.ts`
  - Verify: bun test scripts/verify-m063-s01.test.ts && bun run scripts/verify-m063-s01.ts --json

## Files Likely Touched

- src/lib/review-continuation-lifecycle.ts
- src/lib/review-continuation-lifecycle.test.ts
- src/lib/review-first-pass.ts
- src/lib/retry-scope-reducer.ts
- src/knowledge/types.ts
- src/handlers/review.ts
- src/handlers/review.test.ts
- src/lib/partial-review-formatter.ts
- src/jobs/review-work-coordinator.ts
- scripts/verify-m063-s01.ts
- scripts/verify-m063-s01.test.ts
