---
estimated_steps: 5
estimated_files: 4
skills_used: []
---

# T02: Retire stale operator docs and smoke/config claims

Rewrite the operator-facing truth surface to match D124 and the removal implementation.
- Update `docs/runbooks/review-requested-debug.md` so `@kodiai review` is the only supported manual rereview procedure; keep `pull_request.review_requested` content only as a debug surface when still relevant, not as supported operator guidance.
- Remove `review.uiRereviewTeam` and `review.requestUiRereviewTeamOnOpen` from `docs/configuration.md`.
- Update `docs/smoke/phase75-live-ops-verification-closure.md` so accepted rereview-team requests are no longer treated as valid closure evidence.
- Ensure the checked-in `.kodiai.yml` example no longer advertises the unsupported team path.

## Inputs

- `.gsd/milestones/M051/slices/S01/tasks/T01-SUMMARY.md`
- `.gsd/milestones/M051/slices/S01/tasks/T02-SUMMARY.md`
- `docs/runbooks/review-requested-debug.md`
- `docs/configuration.md`
- `docs/smoke/phase75-live-ops-verification-closure.md`

## Expected Output

- `Operator docs no longer instruct humans to use the `ai-review` / `aireview` team path`
- `Configuration docs/examples no longer advertise removed rereview-team keys`
- `Smoke preflight language matches the supported manual trigger contract`

## Verification

! rg -n "uiRereviewTeam|requestUiRereviewTeamOnOpen|ai-review|aireview" docs/runbooks/review-requested-debug.md docs/configuration.md docs/smoke/phase75-live-ops-verification-closure.md .kodiai.yml && rg -n "@kodiai review" docs/runbooks/review-requested-debug.md docs/smoke/phase75-live-ops-verification-closure.md

## Observability Impact

Prevents operators from recapturing invalid team-path evidence after the code/config contract is removed.
