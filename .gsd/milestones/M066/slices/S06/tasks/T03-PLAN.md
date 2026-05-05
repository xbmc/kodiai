---
estimated_steps: 1
estimated_files: 1
skills_used: []
---

# T03: Trigger authenticated formatter-suggestion smoke

Using the credentialed path and controlled PR from T02, post or otherwise create the explicit `@kodiai format suggestions` trigger in the deployed/operator environment. Capture only non-secret evidence: trigger comment URL/id, repo, PR URL/number, delivery id if available, deployed revision/log correlation, formatter-specific reviewOutputKey containing the `mention-format-suggestions` intent, formatter subflow status fields, and any bounded failure reason if Kodiai declines to publish. Do not store secrets, raw formatter stdout, private keys, tokens, or full webhook payloads.

## Inputs

- `T02 credentialed smoke readiness output`
- `controlled PR`
- `deployed Kodiai logs/operator console`
- `docs/runbooks/formatter-suggestions.md`

## Expected Output

- `A live trigger evidence bundle with reviewOutputKey and log/deployment correlation`
- `No secrets or raw formatter output recorded`

## Verification

Confirm captured fields include repo, PR URL, trigger comment URL/id, reviewOutputKey containing `mention-format-suggestions`, deployed revision/log correlation, formatter subflow status, and either delivery id or a documented reason delivery id is unavailable.

## Observability Impact

Leaves a durable operator-readable proof record and requirement evidence that future milestone closure can audit.
