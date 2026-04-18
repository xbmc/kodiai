# S02: Manual rereview contract implementation

**Goal:** Remove the unsupported UI-team rereview contract and leave `@kodiai review` as the only documented/tested manual rereview trigger so R055 can close without stale trigger claims.
**Demo:** After this slice, the supported manual rereview path works as documented, and any unsupported path is gone from code/config/docs/tests.

## Must-Haves

- `ai-review` / `aireview` no longer appear in supported operator docs, repo config, or live config schema/tests.
- `createReviewHandler` no longer auto-requests or accepts the UI rereview team path; team-only `review_requested` events skip cleanly.
- `@kodiai review` remains documented and regression-tested as the only supported manual rereview trigger with existing publish/fallback behavior intact.

## Proof Level

- This slice proves: This slice proves R055 by removing the unsupported UI-team contract and preserving only the explicit mention manual trigger; it does not depend on fresh human-generated UI-team proof.

## Integration Closure

After S02, S03 can assume the manual trigger contract is settled and can focus only on residual operator/verifier truthfulness debt rather than rereview-path ambiguity.

## Verification

- Operators stop seeing docs/smoke/config hints for the unproven rereview-team path, while tests and logs stay anchored on the surviving explicit mention lane.

## Tasks

- [x] **T01: Remove the UI-team rereview code and config surface** `est:1 context window`
  Implement the removal branch from D124 instead of leaving the wired-but-unproven team path in place.
- Remove `review.uiRereviewTeam` and `review.requestUiRereviewTeamOnOpen` from the repo config/schema/defaults.
- Stop accepting `requested_team` `ai-review` / `aireview` as an accepted `pull_request.review_requested` trigger in `createReviewHandler`; preserve the existing direct-Kodiai reviewer path and the generic team-only skip path.
- Remove the best-effort auto-request-on-open behavior and delete `src/handlers/rereview-team.ts` plus its tests if it becomes unused.
- Update handler/config tests so the post-change contract is explicit: team-only requests skip, no UI rereview team is auto-requested, and the removed config keys are gone.
  - Files: `src/handlers/review.ts`, `src/handlers/review.test.ts`, `src/handlers/rereview-team.ts`, `src/handlers/rereview-team.test.ts`, `src/execution/config.ts`, `src/execution/config.test.ts`, `.kodiai.yml`
  - Verify: bun test ./src/handlers/review.test.ts ./src/execution/config.test.ts

- [ ] **T02: Retire stale operator docs and smoke/config claims** `est:1 context window`
  Rewrite the operator-facing truth surface to match D124 and the removal implementation.
- Update `docs/runbooks/review-requested-debug.md` so `@kodiai review` is the only supported manual rereview procedure; keep `pull_request.review_requested` content only as a debug surface when still relevant, not as supported operator guidance.
- Remove `review.uiRereviewTeam` and `review.requestUiRereviewTeamOnOpen` from `docs/configuration.md`.
- Update `docs/smoke/phase75-live-ops-verification-closure.md` so accepted rereview-team requests are no longer treated as valid closure evidence.
- Ensure the checked-in `.kodiai.yml` example no longer advertises the unsupported team path.
  - Files: `docs/runbooks/review-requested-debug.md`, `docs/configuration.md`, `docs/smoke/phase75-live-ops-verification-closure.md`, `.kodiai.yml`
  - Verify: ! rg -n "uiRereviewTeam|requestUiRereviewTeamOnOpen|ai-review|aireview" docs/runbooks/review-requested-debug.md docs/configuration.md docs/smoke/phase75-live-ops-verification-closure.md .kodiai.yml && rg -n "@kodiai review" docs/runbooks/review-requested-debug.md docs/smoke/phase75-live-ops-verification-closure.md

- [ ] **T03: Lock the surviving manual trigger proof surface** `est:1 context window`
  Make the supported-path proof explicit enough to close R055 without re-litigating the trigger contract.
- Reuse or tighten `src/handlers/mention.test.ts` coverage that proves `@kodiai review` routes to `taskType=review.full` on `lane=interactive-review` and still owns the visible publish/fallback path.
- Add/update a narrow negative regression in `src/handlers/review.test.ts` proving team-only `review_requested` events are skipped after the removal.
- Run the slice-level proof bundle so completion can cite one explicit supported trigger and zero stale team-trigger claims.
  - Files: `src/handlers/mention.ts`, `src/handlers/mention.test.ts`, `src/handlers/review.test.ts`
  - Verify: bun test ./src/handlers/mention.test.ts ./src/handlers/review.test.ts

## Files Likely Touched

- src/handlers/review.ts
- src/handlers/review.test.ts
- src/handlers/rereview-team.ts
- src/handlers/rereview-team.test.ts
- src/execution/config.ts
- src/execution/config.test.ts
- .kodiai.yml
- docs/runbooks/review-requested-debug.md
- docs/configuration.md
- docs/smoke/phase75-live-ops-verification-closure.md
- src/handlers/mention.ts
- src/handlers/mention.test.ts
