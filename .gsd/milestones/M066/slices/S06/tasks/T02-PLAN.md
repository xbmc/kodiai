---
estimated_steps: 1
estimated_files: 1
skills_used: []
---

# T02: Establish credentialed smoke gate and controlled PR

Resolve the T01 environment blocker before attempting another live smoke. Verify whether a credentialed operator path is available through secure environment collection or already-present CI/operator environment variables without printing secret values. Required capability is one authenticated path that can post a PR comment/trigger and read PR reviews/comments for the selected repo. Establish or identify a safe controlled PR with a small formatting-only diff, and capture non-secret prerequisites: repo, PR URL/number, branch/head SHA, deployed environment/revision or log stream identifier, and which auth path is active. If no authenticated path is available after secure collection/gating, stop with a blocker summary rather than modifying proof docs or fabricating evidence.

## Inputs

- `T01 blocker summary`
- `docs/runbooks/formatter-suggestions.md`
- `docs/smoke/m066-formatter-suggestions.md`
- `existing deployment/operator environment`
- `secure environment variables for GitHub/App auth when available`

## Expected Output

- `A credentialed smoke readiness note with no secrets`
- `A selected controlled PR ready for @kodiai format suggestions`
- `A documented auth path and deployment/log correlation target, or a new blocker if auth remains unavailable`

## Verification

Confirm non-secret smoke prerequisites are captured: repo, PR URL/number, controlled formatting diff description, deployed revision/log correlation target, and an authenticated write/read path is available without exposing tokens. If unavailable, record a blocker and do not proceed to trigger/verification tasks.

## Observability Impact

Produces machine-readable verifier evidence binding GitHub visible review/comment surfaces to the captured reviewOutputKey and delivery id.
