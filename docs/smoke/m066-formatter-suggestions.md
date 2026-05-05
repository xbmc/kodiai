# M066 Formatter Suggestions Smoke Proof

Status: **Accepted.** T05 reran the controlled formatter smoke on PR #134 after deployment of Azure Container Apps revision `ca-kodiai--deploy-20260504-222417`. The fresh `@kodiai format suggestions` trigger produced a formatter `mention-format-suggestions` reviewOutputKey, a same-PR COMMENTED Kodiai Pull Request Review, one fenced GitHub `suggestion` review comment, delivery/log correlation, and `bun run verify:m066:s05` returned `success: true` with `status_code: "m066_s05_ok"`.

This file is the bounded operator record for M066/S05. Do not paste GitHub App private keys, tokens, raw formatter stdout, or unbounded formatter stderr here.

## Scope

- Feature: Explicit formatter suggestions on PR mentions
- Supported triggers:
  - `@kodiai format suggestions`
  - `@kodiai review & format suggestions`
- Required visible surface: same-PR Pull Request Review with at least one fenced `suggestion` block
- Not claimed: formatter suggestions in normal automatic PR reviews

## Current smoke status

T05 posted a fresh explicit formatter trigger from an authenticated operator path against the controlled PR #134. The deployed app classified the request as formatter intent, ran the formatter-suggestion subflow, published one same-PR Kodiai Pull Request Review with one committable fenced suggestion, and emitted bounded structured logs for the same delivery id and formatter reviewOutputKey.

Accepted proof fields:

| Surface | Accepted value |
|---|---|
| Repository | `xbmc/kodiai` |
| PR URL | `https://github.com/xbmc/kodiai/pull/134` |
| PR number | `134` |
| Trigger comment body | `@kodiai format suggestions` |
| Trigger comment URL | `https://github.com/xbmc/kodiai/pull/134#issuecomment-4376745698` |
| Trigger comment ID | `4376745698` |
| Trigger created at | `2026-05-05T05:28:39Z` |
| Captured GitHub `deliveryId` | `462ed8c0-4843-11f1-8135-1c6010084b2c` |
| Formatter `reviewOutputKey` | `kodiai-review-output:v1:inst-109141824:xbmc/kodiai:pr-134:action-mention-format-suggestions:delivery-462ed8c0-4843-11f1-8135-1c6010084b2c:head-df017da6b6959038a288f8eae070b7a384ef0fa4` |
| Active deployed revision | `ca-kodiai--deploy-20260504-222417` |
| Formatter Pull Request Review URL | `https://github.com/xbmc/kodiai/pull/134#pullrequestreview-4225484818` |
| Formatter Pull Request Review ID | `4225484818` |
| Formatter Pull Request Review state | `COMMENTED` |
| Formatter Pull Request Review submitted at | `2026-05-05T05:28:46Z` |
| Suggestion comment URL | `https://github.com/xbmc/kodiai/pull/134#discussion_r3186219778` |
| Suggestion comment ID | `3186219778` |
| Suggestion comment path/line | `README.md`, RIGHT side line `3` |
| Number of posted suggestions | `1` |
| Number skipped | `0` |
| Number capped | `0` |
| Number publisherSkipped | `0` |
| Number publisherFailed | `0` observed by publisher outcome (`publisherFailed` omitted/null in completion log) |
| Formatter status | `posted` |
| Command status | `success` |
| Publisher status | `posted` |
| Verifier status | `success: true`, `status_code: "m066_s05_ok"` |

## T02 credentialed smoke readiness

T02 established a credentialed operator path and a controlled PR without exposing secrets. T05 completed the accepted formatter-suggestion proof on the same controlled PR.

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
| Formatter config source | PR-head `.kodiai.yml` adds `review.formatterSuggestions.command` because `main` does not configure formatter suggestions |
| Formatter command | `python3 scripts/m066-formatter-smoke.py` |
| Trigger mode for accepted proof | `@kodiai format suggestions` |
| Accepted proof trigger status | Posted by T05 and accepted by deployed formatter subflow |
| Delivery ID (`X-GitHub-Delivery`) | `462ed8c0-4843-11f1-8135-1c6010084b2c` |
| Review output key | `kodiai-review-output:v1:inst-109141824:xbmc/kodiai:pr-134:action-mention-format-suggestions:delivery-462ed8c0-4843-11f1-8135-1c6010084b2c:head-df017da6b6959038a288f8eae070b7a384ef0fa4` |
| Deployed revision/log correlation target | Azure Container Apps `ContainerAppConsoleLogs_CL` workspace `fb0d671a-6537-4c68-9f32-bef49c3d41d8`, revision `ca-kodiai--deploy-20260504-222417` |
| Azure operator access in this shell | `az` authenticated as a bounded operator; no secret values recorded |

## T03 live trigger evidence — bounded decline before fix

T03 posted the explicit trigger from an authenticated operator path and captured non-secret delivery/log evidence. The pre-fix deployed app acknowledged the trigger with an eyes reaction and ran an ACA mention job, but it published a generic PR issue-comment response asking for more context instead of entering the formatter-suggestion subflow. No formatter `reviewOutputKey` containing `mention-format-suggestions` was emitted, no formatter subflow status fields were logged, and no same-PR formatter Pull Request Review or fenced suggestion comment existed before T04 deployed the routing fix.

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
| Trigger mode | `format-only: @kodiai format suggestions` |
| Accepted trigger comment URL | `https://github.com/xbmc/kodiai/pull/134#issuecomment-4376745698` |
| Accepted delivery ID (`X-GitHub-Delivery`) | `462ed8c0-4843-11f1-8135-1c6010084b2c` |
| Accepted review output key | `kodiai-review-output:v1:inst-109141824:xbmc/kodiai:pr-134:action-mention-format-suggestions:delivery-462ed8c0-4843-11f1-8135-1c6010084b2c:head-df017da6b6959038a288f8eae070b7a384ef0fa4` |
| Deployed revision | `ca-kodiai--deploy-20260504-222417` |

## T04 deployment proof — formatter-routing fix

T04 deployed the source revision containing the T03 formatter-routing observability fix through the documented Azure Container Apps deploy path. The first deploy attempt reached ACA job secret-reference update and failed with an Azure CLI `Connection reset by peer` before updating the container app revision. Because `deploy.sh` is documented idempotent, T04 retried the same command; the retry completed successfully and reported active revision `ca-kodiai--deploy-20260504-222417`.

| Field | Value |
|---|---|
| Deploy command | `./deploy.sh` |
| First attempt result | Failed before app revision update while pointing ACA Job secrets at Azure Key Vault: Azure CLI connection reset |
| Retry result | Succeeded |
| ACR app build id | `ca84` |
| ACR agent build id | `ca85` |
| Active revision | `ca-kodiai--deploy-20260504-222417` |
| App URL | `https://ca-kodiai.agreeableisland-d347f806.eastus.azurecontainerapps.io` |
| `/healthz` | HTTP 200, `{"status":"ok","db":"connected"}` |
| `/readiness` | HTTP 200, `{"status":"ready"}` |
| Independent revision check | `az containerapp revision list --name ca-kodiai --resource-group rg-kodiai --query '[?properties.active && properties.trafficWeight > \`0\`] | sort_by(@, &properties.createdTime) | [-1].name' --output tsv` returned `ca-kodiai--deploy-20260504-222417` |

## Formatter review proof

| Field | Value |
|---|---|
| Formatter Pull Request Review URL | `https://github.com/xbmc/kodiai/pull/134#pullrequestreview-4225484818` |
| Formatter Pull Request Review ID | `4225484818` |
| Formatter Pull Request Review state | `COMMENTED` |
| Formatter Pull Request Review body marker | `<!-- kodiai:review-output-key:kodiai-review-output:v1:inst-109141824:xbmc/kodiai:pr-134:action-mention-format-suggestions:delivery-462ed8c0-4843-11f1-8135-1c6010084b2c:head-df017da6b6959038a288f8eae070b7a384ef0fa4 -->` |
| Suggestion comment URL | `https://github.com/xbmc/kodiai/pull/134#discussion_r3186219778` |
| Suggestion comment ID | `3186219778` |
| Suggestion comment review ID | `4225484818` |
| Suggestion comment path/line | `README.md`, RIGHT side line `3` |
| Suggestion comment bounded body | Fenced GitHub suggestion replacing the README first paragraph with the single-space text beginning `Kodiai is an installable GitHub App...`; full public body is at the suggestion comment URL. |
| Number of posted suggestions | `1` |
| Number skipped | `0` |
| Number capped | `0` |
| Number publisherSkipped | `0` |
| Number publisherFailed | `0` observed by published outcome; completion log omits/nulls `publisherFailed` when zero |

## Verifier evidence

Command run by T05:

```sh
bun run verify:m066:s05 -- --repo xbmc/kodiai --review-output-key "kodiai-review-output:v1:inst-109141824:xbmc/kodiai:pr-134:action-mention-format-suggestions:delivery-462ed8c0-4843-11f1-8135-1c6010084b2c:head-df017da6b6959038a288f8eae070b7a384ef0fa4" --delivery-id "462ed8c0-4843-11f1-8135-1c6010084b2c" --json
```

Bounded JSON output:

```json
{
  "command": "verify:m066:s05",
  "generated_at": "2026-05-05T05:29:04.858Z",
  "repo": "xbmc/kodiai",
  "review_output_key": "kodiai-review-output:v1:inst-109141824:xbmc/kodiai:pr-134:action-mention-format-suggestions:delivery-462ed8c0-4843-11f1-8135-1c6010084b2c:head-df017da6b6959038a288f8eae070b7a384ef0fa4",
  "delivery_id": "462ed8c0-4843-11f1-8135-1c6010084b2c",
  "success": true,
  "status_code": "m066_s05_ok",
  "preflight": {
    "githubAccess": "available"
  },
  "proof": {
    "pr_number": 134,
    "pr_url": "https://github.com/xbmc/kodiai/pull/134",
    "review_id": 4225484818,
    "review_url": "https://github.com/xbmc/kodiai/pull/134#pullrequestreview-4225484818",
    "first_suggestion_comment_id": 3186219778,
    "first_suggestion_comment_url": "https://github.com/xbmc/kodiai/pull/134#discussion_r3186219778",
    "matched_review_output_key": "kodiai-review-output:v1:inst-109141824:xbmc/kodiai:pr-134:action-mention-format-suggestions:delivery-462ed8c0-4843-11f1-8135-1c6010084b2c:head-df017da6b6959038a288f8eae070b7a384ef0fa4"
  },
  "artifactCounts": {
    "reviews": 2,
    "matchingReviews": 1,
    "reviewComments": 5,
    "matchingSuggestionComments": 1
  },
  "issues": []
}
```

## Log evidence

T05 bounded Log Analytics query shape:

```kusto
ContainerAppConsoleLogs_CL
| where TimeGenerated between (datetime(2026-05-05T05:28:20Z) .. datetime(2026-05-05T05:33:30Z))
| where ContainerAppName_s == "ca-kodiai"
| where Log_s has "462ed8c0-4843-11f1-8135-1c6010084b2c" or Log_s has "kodiai-review-output:v1:inst-109141824:xbmc/kodiai:pr-134:action-mention-format-suggestions:delivery-462ed8c0-4843-11f1-8135-1c6010084b2c:head-df017da6b6959038a288f8eae070b7a384ef0fa4" or Log_s has "formatterStatus" or Log_s has "publisherStatus" or Log_s has "Formatter suggestion publishing completed" or Log_s has "Format-only formatter suggestion request completed"
| project TimeGenerated, RevisionName_s, Log_s
| order by TimeGenerated asc
```

Observed formatter completion messages:

| Time | Revision | Message | Key fields |
|---|---|---|---|
| `2026-05-05T05:28:41.8051934Z` | `ca-kodiai--deploy-20260504-222417` | `Job execution started` | `deliveryId=462ed8c0-4843-11f1-8135-1c6010084b2c`, `eventName=issue_comment`, `action=created`, `jobType=mention`, `prNumber=134` |
| `2026-05-05T05:28:41.8051934Z` | `ca-kodiai--deploy-20260504-222417` | `Router evaluated dispatch keys` | `deliveryId=462ed8c0-4843-11f1-8135-1c6010084b2c`, `action=created` |
| `2026-05-05T05:28:47.7549655Z` | `ca-kodiai--deploy-20260504-222417` | `Format-only formatter suggestion request completed` | `formatterStatus=posted`, `commandStatus=success`, `publisherStatus=posted`, `suggestions=1`, `skipped=0`, `capped=0`, `posted=1`, `publisherSkipped=0`, `reviewOutputKey=kodiai-review-output:v1:inst-109141824:xbmc/kodiai:pr-134:action-mention-format-suggestions:delivery-462ed8c0-4843-11f1-8135-1c6010084b2c:head-df017da6b6959038a288f8eae070b7a384ef0fa4` |
| `2026-05-05T05:28:47.7549655Z` | `ca-kodiai--deploy-20260504-222417` | `Formatter suggestion subflow completed` | `commandStatus=success`, `publisherStatus=posted`, `suggestions=1`, `skipped=0`, `capped=0`, `posted=1`, `reviewId=4225484818`, `reviewUrl=https://github.com/xbmc/kodiai/pull/134#pullrequestreview-4225484818` |
| `2026-05-05T05:28:52.7575275Z` | `ca-kodiai--deploy-20260504-222417` | `Job execution completed` / `Dispatched to 3 handler(s)` | `deliveryId=462ed8c0-4843-11f1-8135-1c6010084b2c`, `action=created` |

Observed bounded fields:

| Field | Value |
|---|---|
| `formatterStatus` | `posted` |
| `commandStatus` | `success` |
| `publisherStatus` | `posted` |
| `suggestions` | `1` |
| `skipped` | `0` |
| `capped` | `0` |
| `posted` | `1` |
| `publisherSkipped` | `0` |
| `publisherFailed` | `0` observed by published outcome; completion log omitted/null when zero |
| `deliveryId` | `462ed8c0-4843-11f1-8135-1c6010084b2c` |
| `reviewOutputKey` | `kodiai-review-output:v1:inst-109141824:xbmc/kodiai:pr-134:action-mention-format-suggestions:delivery-462ed8c0-4843-11f1-8135-1c6010084b2c:head-df017da6b6959038a288f8eae070b7a384ef0fa4` |
| `RevisionName_s` | `ca-kodiai--deploy-20260504-222417` |
| `reviewId` | `4225484818` |
| `reviewUrl` | `https://github.com/xbmc/kodiai/pull/134#pullrequestreview-4225484818` |

## Optional visual evidence

| Field | Value |
|---|---|
| Screenshot URL | `n/a — GitHub API verifier and public review/comment URLs are the accepted proof surface` |
| Notes | `The accepted suggestion is visible as a same-PR GitHub Pull Request Review comment on README.md line 3.` |

## Final interpretation

- [x] The PR review is on the same PR as the trigger.
- [x] The review body includes the formatter reviewOutputKey marker.
- [x] At least one associated review comment contains a fenced `suggestion` block.
- [x] The verifier passed for the captured repo, reviewOutputKey, and delivery id.
- [x] The proof does not claim automatic-review formatter suggestions are live.
- [x] T03 posted a real authenticated trigger and captured non-secret delivery/log evidence for the bounded decline.
- [x] T05 posted a fresh authenticated trigger after T04 deployment and captured accepted same-PR formatter-suggestion proof.
