---
estimated_steps: 1
estimated_files: 1
skills_used: []
---

# T01: Blocked live formatter-suggestion trigger because no authenticated GitHub operator credentials are available in auto-mode.

Prepare a safe controlled PR or identify an existing test PR with a small formatting-only diff, verify deployed Kodiai is available, and trigger `@kodiai format suggestions`. Capture the trigger comment URL, delivery id if accessible, repo/PR identity, and the formatter-specific reviewOutputKey from logs or visible output. Do not store secrets.

## Inputs

- `docs/runbooks/formatter-suggestions.md`
- `docs/smoke/m066-formatter-suggestions.md`
- `scripts/verify-m066-s05.ts`

## Expected Output

- `A captured live trigger/evidence bundle recorded in task summary or a clear blocker if authenticated operator access is unavailable.`

## Verification

Confirm captured fields include repo, PR URL, trigger comment URL, reviewOutputKey with `mention-format-suggestions`, and either delivery id/log correlation or a documented reason the delivery id is unavailable.

## Observability Impact

Records delivery id, reviewOutputKey, trigger surface, and deployed revision/log lookup path for the live formatter run.
