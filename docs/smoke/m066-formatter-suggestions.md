# M066 Formatter Suggestions Smoke Proof

Use this template to record final live proof for same-PR formatter suggestions. Keep entries bounded and redact secrets. Do not paste GitHub App private keys, tokens, raw formatter stdout, or unbounded formatter stderr.

## Scope

- Feature: Explicit formatter suggestions on PR mentions
- Supported triggers:
  - `@kodiai format suggestions`
  - `@kodiai review & format suggestions`
- Required visible surface: same-PR Pull Request Review with at least one fenced `suggestion` block
- Not claimed: formatter suggestions in normal automatic PR reviews

## Smoke PR

| Field | Value |
|---|---|
| Repository | `<owner/repo>` |
| PR URL | `<https://github.com/owner/repo/pull/number>` |
| Safe smoke shape | `<one or two files, formatting-only diff, no secrets/generated files>` |
| Trigger mode | `<format-only / review-and-format>` |
| Trigger comment URL | `<https://github.com/owner/repo/pull/number#issuecomment-...>` |
| Delivery ID (`X-GitHub-Delivery`) | `<delivery-id>` |
| Review output key | `<kodiai-review-output:v1:...:action-mention-format-suggestions:...>` |
| Deployed revision | `<active Azure Container Apps revision>` |

## Formatter review proof

| Field | Value |
|---|---|
| Formatter Pull Request Review URL | `<review-url>` |
| Formatter Pull Request Review ID | `<review-id>` |
| Suggestion comment URL | `<review-comment-url>` |
| Suggestion comment ID | `<review-comment-id>` |
| Number of posted suggestions | `<posted-count>` |
| Number skipped | `<skipped-count>` |
| Number capped | `<capped-count>` |
| Number publisherFailed | `<publisher-failed-count>` |

## Verifier evidence

Command:

```sh
bun run verify:m066:s05 -- --repo <owner/repo> --review-output-key <captured-mention-format-suggestions-key> --delivery-id <captured-delivery-id> --json
```

Output summary:

```json
{
  "status": "<pass/fail>",
  "status_code": "<status-code>",
  "repo": "<owner/repo>",
  "delivery_id": "<delivery-id>",
  "review_output_key": "<review-output-key>",
  "matched_review_id": "<review-id>",
  "suggestion_comment_count": "<count>",
  "issues": []
}
```

## Log evidence

Log query used:

```kusto
ContainerAppConsoleLogs_CL
| where TimeGenerated > ago(24h)
| where Log_s has "<delivery-id>" or Log_s has "<review-output-key>"
| project TimeGenerated, RevisionName_s, Log_s
| order by TimeGenerated asc
```

Observed completion message:

- `<Format-only formatter suggestion request completed / Combined review-and-format mention request completed>`

Observed bounded fields:

| Field | Value |
|---|---|
| `formatterStatus` | `<value>` |
| `commandStatus` | `<value>` |
| `publisherStatus` | `<value>` |
| `suggestions` | `<number>` |
| `skipped` | `<number>` |
| `capped` | `<number>` |
| `posted` | `<number>` |
| `publisherSkipped` | `<number>` |
| `publisherFailed` | `<number>` |
| `deliveryId` | `<delivery-id>` |
| `reviewOutputKey` | `<review-output-key>` |

## Optional visual evidence

| Field | Value |
|---|---|
| Screenshot URL | `<url-or-n/a>` |
| Notes | `<bounded operator notes>` |

## Final interpretation

- [ ] The PR review is on the same PR as the trigger.
- [ ] The review body includes the formatter reviewOutputKey marker.
- [ ] At least one associated review comment contains a fenced `suggestion` block.
- [ ] The verifier passed for the captured repo, reviewOutputKey, and delivery id.
- [ ] The proof does not claim automatic-review formatter suggestions are live.
