---
estimated_steps: 5
estimated_files: 7
skills_used: []
---

# T01: Remove the UI-team rereview code and config surface

Implement the removal branch from D124 instead of leaving the wired-but-unproven team path in place.
- Remove `review.uiRereviewTeam` and `review.requestUiRereviewTeamOnOpen` from the repo config/schema/defaults.
- Stop accepting `requested_team` `ai-review` / `aireview` as an accepted `pull_request.review_requested` trigger in `createReviewHandler`; preserve the existing direct-Kodiai reviewer path and the generic team-only skip path.
- Remove the best-effort auto-request-on-open behavior and delete `src/handlers/rereview-team.ts` plus its tests if it becomes unused.
- Update handler/config tests so the post-change contract is explicit: team-only requests skip, no UI rereview team is auto-requested, and the removed config keys are gone.

## Inputs

- `.gsd/milestones/M051/slices/S01/tasks/T01-SUMMARY.md`
- `.gsd/milestones/M051/slices/S01/tasks/T02-SUMMARY.md`
- `.kodiai.yml`
- `src/handlers/review.ts`
- `src/execution/config.ts`

## Expected Output

- `Review handler no longer accepts or auto-requests the `ai-review` / `aireview` team path`
- `Repo config and config schema no longer expose `uiRereviewTeam` or `requestUiRereviewTeamOnOpen``
- `Negative regression coverage for team-only `review_requested` events`

## Verification

bun test ./src/handlers/review.test.ts ./src/execution/config.test.ts

## Observability Impact

Removes misleading rereview-team acceptance/request logs so operator evidence matches the supported trigger contract.
