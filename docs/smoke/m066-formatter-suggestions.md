# M066 Formatter Suggestions Smoke Proof

Status: **ready for authenticated T03 trigger on controlled PR #134; accepted live formatter-suggestion proof still not captured**.

This file is the bounded operator record for M066/S05. Do not paste GitHub App private keys, tokens, raw formatter stdout, or unbounded formatter stderr here.

## Scope

- Feature: Explicit formatter suggestions on PR mentions
- Supported triggers:
  - `@kodiai format suggestions`
  - `@kodiai review & format suggestions`
- Required visible surface: same-PR Pull Request Review with at least one fenced `suggestion` block
- Not claimed: formatter suggestions in normal automatic PR reviews

## Current smoke status

The live smoke is ready for an authenticated T03 trigger, but it is not accepted proof yet. T02 established a controlled PR and a GitHub API operator path; T03/T04 still must post the explicit trigger, capture the delivery/review identifiers, confirm GitHub accepted a same-PR Pull Request Review with a fenced `suggestion` block, and run the verifier to `m066_s05_ok`.

Pending proof fields:

| Surface | Current state | Next step |
|---|---|---|
| Trigger comment URL/id | Pending | T03 posts `@kodiai format suggestions` on PR #134. |
| Captured GitHub `deliveryId` | Pending | Capture the `X-GitHub-Delivery` id for the T03 trigger when available. |
| Captured formatter `reviewOutputKey` | Pending | Capture the key from logs or the review marker; it must encode `action-mention-format-suggestions`. |
| Accepted same-PR formatter Pull Request Review URL/id | Pending | T04 verifies Kodiai posted a PR review, not only an issue comment or standalone PR comment. |
| Accepted suggestion review comment URL/id | Pending | T04 verifies at least one associated review comment contains a fenced GitHub `suggestion` block. |
| Deployed revision/log correlation | Pending | Query Azure Container Apps logs by delivery id and reviewOutputKey and record `RevisionName_s` plus bounded formatter status fields. |
| Verifier JSON | Pending | Run `bun run verify:m066:s05` with the captured repo, reviewOutputKey, and delivery id; proof requires `success: true` and `status_code: "m066_s05_ok"`. |

## T02 credentialed smoke readiness

T02 established a credentialed operator path and a controlled PR without exposing secrets. The accepted formatter-suggestion proof is still pending T03/T04; do not treat this section as `m066_s05_ok` evidence.

| Field | Value |
|---|---|
| Auth path | `gh` CLI authenticated as `keithah`; GitHub API reports admin/maintain/push/pull/triage permissions on `xbmc/kodiai` |
| Write capability checked | Created remote branch `smoke/m066-formatter-suggestions-1777950652` and PR #134 through GitHub API |
| Read capability checked | Read PR metadata, files, reviews, issue comments, and review comments for PR #134 through GitHub API |
| Repository | `xbmc/kodiai` |
| PR URL | `https://github.com/xbmc/kodiai/pull/134` |
| PR number | `134` |
| Base branch / SHA | `main` / `a270c47f8029e6b2e802c645589720ae43c63905` |
| Head branch / SHA | `smoke/m066-formatter-suggestions-1777950652` / `df017da6b6959038a288f8eae070b7a384ef0fa4` |
| Controlled formatting diff | `README.md` has one intentional double-space in the first paragraph; the smoke formatter fixes it back to a single space |
| Formatter config source | PR-head `.kodiai.yml` adds `review.formatterSuggestions.command` because `main` does not yet configure formatter suggestions |
| Formatter command | `python3 scripts/m066-formatter-smoke.py` |
| Trigger mode for T03 | `@kodiai format suggestions` |
| Trigger status | `not posted by T02` |
| Delivery ID (`X-GitHub-Delivery`) | `pending T03 trigger` |
| Review output key | `pending T03 trigger; must encode action-mention-format-suggestions` |
| Deployed revision/log correlation target | Azure Container Apps `ContainerAppConsoleLogs_CL` filtered by the future delivery id or reviewOutputKey; project `RevisionName_s` plus bounded formatter status fields |
| Azure operator access in this shell | `not present; AZURE_CONFIG_DIR/AZURE_CLIENT_ID/AZURE_TENANT_ID/AZURE_SUBSCRIPTION_ID unset` |

## Smoke PR

| Field | Value |
|---|---|
| Repository | `xbmc/kodiai` |
| PR URL | `https://github.com/xbmc/kodiai/pull/134` |
| Safe smoke shape | `controlled PR with one README whitespace-only formatter hunk plus PR-head smoke formatter configuration` |
| Trigger mode | `format-only first: @kodiai format suggestions` |
| Trigger comment URL | `pending T03 — no trigger comment posted by T02` |
| Delivery ID (`X-GitHub-Delivery`) | `pending T03 trigger` |
| Review output key | `pending T03 trigger` |
| Deployed revision | `pending log correlation after T03 trigger` |

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
