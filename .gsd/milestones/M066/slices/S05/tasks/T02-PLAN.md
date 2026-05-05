---
estimated_steps: 3
estimated_files: 7
skills_used: []
---

# T02: Documented explicit formatter-suggestion configuration, operator smoke workflow, and fillable M066 proof record.

skills_used frontmatter expectation: `write-docs`, `github-workflows`, `azure-container-apps`, `verify-before-complete`.

Add operator-facing documentation for the feature and a fillable smoke proof record. In `docs/configuration.md`, add `review.formatterSuggestions` to the quick-start example and the `review` reference with fields `automatic` (boolean, default false, reserved for later automatic-review inclusion until runtime wiring is added), `command` (optional shell command that must emit a git unified diff to stdout and may use `{baseRef}`, `{headRef}`, `{diffRange}`), and `maxSuggestions` (1..100, default 10). In `docs/runbooks/formatter-suggestions.md`, document setup, safe smoke PR shape, explicit `@kodiai format suggestions`, combined `@kodiai review & format suggestions`, the same-PR Pull Request Review surface, idempotency/retry guidance, skipped/capped/failed counts, log messages/fields, the verifier command, and failure interpretation. Cross-link this runbook from `docs/runbooks/mentions.md`, `docs/README.md`, `docs/INDEX.md`, and a concise feature mention in `README.md`. Create `docs/smoke/m066-formatter-suggestions.md` as the durable proof template with slots for repo, PR URL, trigger comment URL, deliveryId, reviewOutputKey, deployed revision, formatter review URL/id, suggestion comment URL/id, verifier command/output, log query, and any screenshot URL.

Requirement Impact (Q4): This task touches R077, R083, R085, and preserves R080/R084 by documenting existing behavior without changing runtime wiring. It must not claim automatic mode is live for normal automatic PR reviews.

## Inputs

- `docs/configuration.md`
- `docs/runbooks/mentions.md`
- `docs/README.md`
- `docs/INDEX.md`
- `README.md`
- `docs/runbooks/m065-rollout-proof.md`
- `docs/deployment.md`

## Expected Output

- `docs/runbooks/formatter-suggestions.md`
- `docs/configuration.md`
- `docs/runbooks/mentions.md`
- `docs/README.md`
- `docs/INDEX.md`
- `README.md`
- `docs/smoke/m066-formatter-suggestions.md`

## Verification

test -s docs/runbooks/formatter-suggestions.md && test -s docs/smoke/m066-formatter-suggestions.md && rg -n "formatterSuggestions|format suggestions|verify:m066:s05|mention-format-suggestions|skipped|capped|publisherFailed|automatic" README.md docs/configuration.md docs/runbooks/formatter-suggestions.md docs/runbooks/mentions.md docs/README.md docs/INDEX.md docs/smoke/m066-formatter-suggestions.md

## Observability Impact

Documents where future agents/operators inspect live formatter status: GitHub delivery id, reviewOutputKey marker, Azure Container Apps/Log Analytics messages, formatter subflow counts, verifier JSON, and the smoke proof artifact.
