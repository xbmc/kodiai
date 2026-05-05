# M066 Formatter Suggestions Smoke Proof

Status: **T03 live trigger executed on controlled PR #134; Kodiai acknowledged and completed the mention job, but no formatter-suggestion review was produced. T04 rechecked GitHub review surfaces and verifier inputs; accepted live formatter-suggestion proof is still not captured.**

This file is the bounded operator record for M066/S05. Do not paste GitHub App private keys, tokens, raw formatter stdout, or unbounded formatter stderr here.

## Scope

- Feature: Explicit formatter suggestions on PR mentions
- Supported triggers:
  - `@kodiai format suggestions`
  - `@kodiai review & format suggestions`
- Required visible surface: same-PR Pull Request Review with at least one fenced `suggestion` block
- Not claimed: formatter suggestions in normal automatic PR reviews

## Current smoke status

T03 posted the explicit trigger from an authenticated operator path and captured non-secret delivery/log evidence. The deployed app acknowledged the trigger with an eyes reaction and ran an ACA mention job, but it published a generic PR issue-comment response asking for more context instead of entering the formatter-suggestion subflow. No formatter `reviewOutputKey` containing `mention-format-suggestions` was emitted, no formatter subflow status fields were logged, and no same-PR formatter Pull Request Review or fenced suggestion comment exists yet.

Pending accepted proof fields:

| Surface | Current state | Next step |
|---|---|---|
| Trigger comment URL/id | Captured in T03: `https://github.com/xbmc/kodiai/pull/134#issuecomment-4376297998` / `4376297998` | Retry only after fixing the deployed trigger classification/runtime path. |
| Captured GitHub `deliveryId` | Captured in T03: `9961ce70-4830-11f1-86fa-c01e4dffd5b0` | Reuse only as failure evidence; accepted proof requires the delivery for a formatter run. |
| Captured formatter `reviewOutputKey` | Not captured — no key containing `mention-format-suggestions` appeared in GitHub surfaces or bounded ACA logs. | Capture from a future formatter review marker or completion log. |
| Accepted same-PR formatter Pull Request Review URL/id | Pending — only a Copilot review and Kodiai issue comments were visible after T03. | T04 can proceed only after a formatter review exists. |
| Accepted suggestion review comment URL/id | Pending — current PR review comments contain no fenced `suggestion` blocks. | T04 verifies at least one associated review comment contains a fenced GitHub `suggestion` block. |
| Deployed revision/log correlation | Captured failure correlation: `ca-kodiai--deploy-20260504-081420`, ACA job `caj-kodiai-agent-3dzowdd`, workspace `/mnt/kodiai-workspaces/9961ce70-4830-11f1-86fa-c01e4dffd5b0`. | Query by future formatter delivery id/reviewOutputKey after retry. |
| Verifier JSON | Pending — verifier cannot pass without a formatter `reviewOutputKey`. | Run `bun run verify:m066:s05` only with a captured formatter key. |

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
| Trigger status | `posted by T03` |
| Delivery ID (`X-GitHub-Delivery`) | `9961ce70-4830-11f1-86fa-c01e4dffd5b0` |
| Review output key | `not captured for formatter trigger; no mention-format-suggestions key emitted` |
| Deployed revision/log correlation target | Azure Container Apps `ContainerAppConsoleLogs_CL` workspace `fb0d671a-6537-4c68-9f32-bef49c3d41d8`, revision `ca-kodiai--deploy-20260504-081420` |
| Azure operator access in this shell | `az` authenticated as a bounded operator; no secret values recorded |

## T03 live trigger evidence — bounded decline

| Field | Value |
|---|---|
| Repository | `xbmc/kodiai` |
| PR URL | `https://github.com/xbmc/kodiai/pull/134` |
| PR number | `134` |
| Trigger comment body | `@kodiai format suggestions` |
| Trigger comment URL | `https://github.com/xbmc/kodiai/pull/134#issuecomment-4376297998` |
| Trigger comment ID | `4376297998` |
| Trigger created at | `2026-05-05T03:14:58Z` |
| Kodiai acknowledgement | Eyes reaction by `kodiai[bot]`, reaction id `353526158`, created `2026-05-05T03:15:04Z` |
| Delivery ID (`X-GitHub-Delivery`) | `9961ce70-4830-11f1-86fa-c01e4dffd5b0` |
| Deployed revision | `ca-kodiai--deploy-20260504-081420` |
| Container App log workspace | `fb0d671a-6537-4c68-9f32-bef49c3d41d8` |
| ACA job execution | `caj-kodiai-agent-3dzowdd` |
| ACA job workspace | `/mnt/kodiai-workspaces/9961ce70-4830-11f1-86fa-c01e4dffd5b0` |
| ACA job status | `Succeeded`, `2026-05-05T03:16:40Z` → `2026-05-05T03:19:12Z` |
| Mention execution status | `surface=pr_comment`, `conclusion=success`, `published=true`, `publishResolution=executor`, `writeEnabled=false`, `durationMs=110461` |
| Kodiai response URL/id | `https://github.com/xbmc/kodiai/pull/134#issuecomment-4376311477` / `4376311477` |
| Bounded Kodiai response | Asked for more context to provide formatting suggestions; it offered review-comment formatting, bot-response wrapping, or code-formatting options instead of running formatter suggestions. |
| Formatter reviewOutputKey | `not emitted` |
| Formatter subflow status fields | `not emitted: no log rows with formatterStatus, commandStatus, publisherStatus, Format-only formatter completion, or action-mention-format-suggestions` |
| Formatter decline interpretation | The deployed mention path acknowledged the trigger but did not classify it as the explicit formatter-suggestion intent; no formatter subflow or publisher ran. |
| Non-formatter reviewOutputKey observed | `kodiai-review-output:v1:inst-109141824:xbmc/kodiai:pr-134:action-opened:delivery-097b4660-4830-11f1-886f-a26be3448653:head-df017da6b6959038a288f8eae070b7a384ef0fa4` from the PR-opened review path; this is not formatter proof and must not be used with `verify:m066:s05`. |

## Smoke PR

| Field | Value |
|---|---|
| Repository | `xbmc/kodiai` |
| PR URL | `https://github.com/xbmc/kodiai/pull/134` |
| Safe smoke shape | `controlled PR with one README whitespace-only formatter hunk plus PR-head smoke formatter configuration` |
| Trigger mode | `format-only first: @kodiai format suggestions` |
| Trigger comment URL | `https://github.com/xbmc/kodiai/pull/134#issuecomment-4376297998` |
| Delivery ID (`X-GitHub-Delivery`) | `9961ce70-4830-11f1-86fa-c01e4dffd5b0` |
| Review output key | `not captured for formatter trigger` |
| Deployed revision | `ca-kodiai--deploy-20260504-081420` |

## T04 verifier attempt — no accepted proof

T04 rechecked the live PR review surface after T03. GitHub still shows exactly one Pull Request Review on PR #134, from `copilot-pull-request-reviewer[bot]`, with no Kodiai formatter marker. The four associated review comments are from Copilot, contain no fenced `suggestion` blocks, and are not associated with a Kodiai formatter review. Kodiai has only issue comments for the formatter trigger and generic response; no same-PR Kodiai formatter Pull Request Review exists.

The existing verifier was run only as a bounded negative check against the observed non-formatter `action-opened` reviewOutputKey. It correctly returned `success: false`, `status_code: "m066_s05_invalid_arg"`, and issues stating that the key must encode `mention-format-suggestions` and that the provided delivery id does not match the key's encoded delivery id. This is not accepted M066/S05 proof.

## Formatter review proof

| Field | Value |
|---|---|
| Formatter Pull Request Review URL | `blocked — not captured` |
| Formatter Pull Request Review ID | `blocked — not captured` |
| Suggestion comment URL | `blocked — not captured` |
| Suggestion comment ID | `blocked — not captured` |
| Number of posted suggestions | `0` |
| Number skipped | `not emitted` |
| Number capped | `not emitted` |
| Number publisherFailed | `not emitted` |

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

Current accepted live output: **none**. T03 intentionally did not fabricate a formatter key or run the verifier against the non-formatter `action-opened` key.

## Log evidence

T03 bounded Log Analytics query shape:

```kusto
ContainerAppConsoleLogs_CL
| where TimeGenerated between (datetime(2026-05-05T03:14:45Z) .. datetime(2026-05-05T03:30:00Z))
| where ContainerAppName_s == "ca-kodiai"
| where Log_s has_any ("9961ce70-4830-11f1-86fa-c01e4dffd5b0", "4376311477", "Mention execution completed", "format suggestions", "reviewOutputKey", "formatterStatus")
| project TimeGenerated, RevisionName_s, Log_s
| order by TimeGenerated asc
```

Observed completion message: `Mention execution completed`.

Observed bounded fields:

| Field | Value |
|---|---|
| `formatterStatus` | `not emitted` |
| `commandStatus` | `not emitted` |
| `publisherStatus` | `not emitted` |
| `suggestions` | `0` |
| `skipped` | `not emitted` |
| `capped` | `not emitted` |
| `posted` | `0` |
| `publisherSkipped` | `not emitted` |
| `publisherFailed` | `not emitted` |
| `deliveryId` | `9961ce70-4830-11f1-86fa-c01e4dffd5b0` |
| `reviewOutputKey` | `not emitted for formatter trigger` |
| `RevisionName_s` | `ca-kodiai--deploy-20260504-081420` |
| `executionName` | `caj-kodiai-agent-3dzowdd` |

## Optional visual evidence

| Field | Value |
|---|---|
| Screenshot URL | `n/a — no accepted live proof` |
| Notes | `Retry after resolving why @kodiai format suggestions was handled as a generic formatting question instead of the formatter-suggestion intent.` |

## Final interpretation

- [ ] The PR review is on the same PR as the trigger.
- [ ] The review body includes the formatter reviewOutputKey marker.
- [ ] At least one associated review comment contains a fenced `suggestion` block.
- [ ] The verifier passed for the captured repo, reviewOutputKey, and delivery id.
- [x] The proof does not claim automatic-review formatter suggestions are live.
- [x] T03 posted a real authenticated trigger and captured non-secret delivery/log evidence for the bounded decline.
