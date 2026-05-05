# M066 Formatter Suggestions Smoke Proof

Status: **blocked — accepted live formatter-suggestion proof not captured in this environment after T04 recheck**.

This file is the bounded operator record for M066/S05. Do not paste GitHub App private keys, tokens, raw formatter stdout, or unbounded formatter stderr here.

## Scope

- Feature: Explicit formatter suggestions on PR mentions
- Supported triggers:
  - `@kodiai format suggestions`
  - `@kodiai review & format suggestions`
- Required visible surface: same-PR Pull Request Review with at least one fenced `suggestion` block
- Not claimed: formatter suggestions in normal automatic PR reviews

## Blocked smoke status

The live smoke was not accepted because this task session did not have a real captured formatter-suggestion delivery bundle to verify. No PR review URL, suggestion comment URL, deployed revision, or `m066_s05_ok` verifier output was available in tracked artifacts or ambient task context. T04 also found `M066_S05_REPO`, `M066_S05_REVIEW_OUTPUT_KEY`, `GITHUB_APP_ID`, and `GITHUB_PRIVATE_KEY`/`GITHUB_PRIVATE_KEY_BASE64` unset in the ambient shell, so the proof variables for T05 remain unavailable rather than exported with placeholder values.

Missing or unavailable access surfaces observed from this session:

| Surface | Observed state | Retry path |
|---|---|---|
| Captured formatter `reviewOutputKey` | Missing | Trigger `@kodiai format suggestions` on a controlled smoke PR and copy the key that encodes `action-mention-format-suggestions`. |
| Captured GitHub `deliveryId` | Missing | Capture the `X-GitHub-Delivery` id for the same trigger as the formatter review. |
| Accepted same-PR formatter Pull Request Review URL/id | Missing | Verify the deployed app posted a Pull Request Review, not only an issue comment or standalone PR comment. |
| Accepted suggestion review comment URL/id | Missing | Verify at least one associated review comment contains a fenced GitHub `suggestion` block. |
| Deployed revision/log correlation | Missing | Query Azure Container Apps logs by delivery id and reviewOutputKey after the live trigger. |
| Shell `M066_S05_REPO` | Unset in ambient shell | Export the concrete smoke repository slug (for example, the repo that received the accepted formatter PR review) only after a real live trigger is captured. |
| Shell `M066_S05_REVIEW_OUTPUT_KEY` | Unset in ambient shell | Export the captured `action-mention-format-suggestions` reviewOutputKey from the same live trigger; do not use placeholder or synthetic keys. |
| Optional shell `M066_S05_DELIVERY_ID` | Unset in ambient shell | Export the captured `X-GitHub-Delivery` id when available so the verifier can bind proof to the same delivery. |
| Shell `GITHUB_TOKEN` for `gh`/API inspection | Unset | Run from an authenticated operator environment if GitHub API inspection through `gh` is needed. |
| Shell `GITHUB_APP_ID` | Unset in ambient shell | Run the verifier from the deployed/operator environment with GitHub App credentials available; do not paste values into logs. |
| Shell `GITHUB_PRIVATE_KEY` or `GITHUB_PRIVATE_KEY_BASE64` | Unset in ambient shell | Provide one of these keys through the operator secret store before running the live verifier. |
| Azure CLI environment (`AZURE_CONFIG_DIR`, `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`) | Unset in ambient shell | Use an authenticated Azure operator environment to capture deployed revision and log fields. |

A local verifier probe using a synthetic formatter key failed closed and did **not** constitute proof:

```sh
bun run verify:m066:s05 -- --repo xbmc/kodiai --review-output-key kodiai-review-output:v1:inst-42:xbmc/kodiai:pr-101:action-mention-format-suggestions:delivery-delivery-101:head-head-101 --delivery-id delivery-101 --json
```

Bounded result:

```json
{
  "success": false,
  "status_code": "m066_s05_github_unavailable",
  "preflight": {
    "githubAccess": "unavailable"
  },
  "issues": [
    "GitHub formatter-suggestion proof collection failed: Not Found - https://docs.github.com/rest/pulls/reviews#list-reviews-for-a-pull-request"
  ]
}
```

## Smoke PR

| Field | Value |
|---|---|
| Repository | `xbmc/kodiai` preferred, but not verified |
| PR URL | `blocked — no controlled live smoke PR URL captured` |
| Safe smoke shape | `required: one or two files, formatting-only diff, no secrets/generated files` |
| Trigger mode | `required: format-only first` |
| Trigger comment URL | `blocked — no trigger comment URL captured` |
| Delivery ID (`X-GitHub-Delivery`) | `blocked — missing captured delivery id` |
| Review output key | `blocked — missing captured mention-format-suggestions reviewOutputKey` |
| Deployed revision | `blocked — missing Azure Container Apps revision/log access` |

## Formatter review proof

| Field | Value |
|---|---|
| Formatter Pull Request Review URL | `blocked — not captured` |
| Formatter Pull Request Review ID | `blocked — not captured` |
| Suggestion comment URL | `blocked — not captured` |
| Suggestion comment ID | `blocked — not captured` |
| Number of posted suggestions | `blocked — not captured` |
| Number skipped | `blocked — not captured` |
| Number capped | `blocked — not captured` |
| Number publisherFailed | `blocked — not captured` |

## Verifier evidence

Required live command once identifiers are captured and exported:

```sh
if test -n "${M066_S05_DELIVERY_ID:-}"; then
  bun run verify:m066:s05 -- --repo "$M066_S05_REPO" --review-output-key "$M066_S05_REVIEW_OUTPUT_KEY" --delivery-id "$M066_S05_DELIVERY_ID" --json
else
  bun run verify:m066:s05 -- --repo "$M066_S05_REPO" --review-output-key "$M066_S05_REVIEW_OUTPUT_KEY" --json
fi
```

Required passing status before this proof can be accepted:

```json
{
  "success": true,
  "status_code": "m066_s05_ok"
}
```

Current accepted live output: **none**.

## Log evidence

Log query to run after the live trigger, substituting the captured delivery id and reviewOutputKey from the operator environment:

```kusto
ContainerAppConsoleLogs_CL
| where TimeGenerated > ago(24h)
| where Log_s has "captured-delivery-id" or Log_s has "captured-review-output-key"
| project TimeGenerated, RevisionName_s, Log_s
| order by TimeGenerated asc
```

Observed completion message: `blocked — no deployed log row captured`.

Observed bounded fields:

| Field | Value |
|---|---|
| `formatterStatus` | `blocked — not captured` |
| `commandStatus` | `blocked — not captured` |
| `publisherStatus` | `blocked — not captured` |
| `suggestions` | `blocked — not captured` |
| `skipped` | `blocked — not captured` |
| `capped` | `blocked — not captured` |
| `posted` | `blocked — not captured` |
| `publisherSkipped` | `blocked — not captured` |
| `publisherFailed` | `blocked — not captured` |
| `deliveryId` | `blocked — not captured` |
| `reviewOutputKey` | `blocked — not captured` |

## Optional visual evidence

| Field | Value |
|---|---|
| Screenshot URL | `n/a — no accepted live proof` |
| Notes | `Retry from an authenticated operator environment with a fresh trigger comment or new PR head commit to avoid idempotency noise.` |

## Final interpretation

- [ ] The PR review is on the same PR as the trigger.
- [ ] The review body includes the formatter reviewOutputKey marker.
- [ ] At least one associated review comment contains a fenced `suggestion` block.
- [ ] The verifier passed for the captured repo, reviewOutputKey, and delivery id.
- [x] The proof does not claim automatic-review formatter suggestions are live.
