# Formatter Suggestions Runbook

Use this runbook to smoke test, verify, and troubleshoot explicit formatter-suggestion requests on pull requests.

## Reader and outcome

This runbook is for maintainers and operators who need to prove that Kodiai can publish formatter-generated GitHub suggestions on the same PR that triggered the request. After reading it, you should be able to trigger a safe smoke request, capture the proof identifiers, run the verifier, and interpret failures without exposing secrets or raw formatter output.

## Current support boundary

Formatter suggestions currently run for explicit PR mentions:

- `@kodiai format suggestions`
- `@kodiai review format suggestions`
- `@kodiai review & format suggestions`

Do not treat `review.formatterSuggestions.automatic` as live automatic-review behavior. The field is parsed and defaults to `false`, but normal automatic PR reviews do not include formatter suggestions until future runtime wiring enables that path.

## Configure a repository

Explicit formatter suggestions work by default with `git clang-format --diff origin/{baseRef} HEAD`. Keep `automatic: false` unless a later release explicitly documents automatic-review support. Override `review.formatterSuggestions.command` only when a repository needs different formatter tooling.

```yaml
review:
  formatterSuggestions:
    automatic: false
    command: "git clang-format --diff origin/{baseRef} HEAD"
    maxSuggestions: 10
```

This repository intentionally keeps a controlled-smoke override in `.kodiai.yml`:

```yaml
review:
  formatterSuggestions:
    automatic: false
    command: "python3 scripts/m066-formatter-smoke.py"
    maxSuggestions: 1
```

That repository override exists only to make the local formatter-suggestion smoke deterministic and tightly bounded. It does not change the product default command documented above, and maintainers should not normalize it away as part of proof-capture or documentation cleanup.

Fields:

| Field | Default | Notes |
|---|---:|---|
| `automatic` | `false` | Reserved for later automatic-review inclusion. |
| `command` | `git clang-format --diff origin/{baseRef} HEAD` | Default shell command. Override for non-clang-format tooling. |
| `maxSuggestions` | `10` | Bounded from `1` to `100`. Additional applicable hunks are capped. |

Command requirements:

- Emit a git unified diff to stdout.
- Use only repository-local tooling and dependencies available in the Kodiai workspace.
- May use `{baseRef}`, `{headRef}`, and `{diffRange}` placeholders.
- The default `git clang-format --diff origin/{baseRef} HEAD` command uses `git-clang-format` from the runtime image. If the repository language or formatter differs, override `command` with a tool-specific diff command.
- Must not print secrets. Raw formatter stdout and unbounded stderr must not be copied into proof records.

## Trust model (repo-controlled shell)

Formatter commands are **repository-configured** and executed with `bash -lc` inside the cloned PR workspace. Treat every `.kodiai.yml` maintainer as a trusted operator for that repository.

| Boundary | What Kodiai assumes | What Kodiai does *not* assume |
|---|---|---|
| Config author | Repo maintainers control `review.formatterSuggestions.command` intentionally | Untrusted fork contributors can inject commands without a merged config change |
| Execution context | Command runs in the ephemeral review workspace with repo contents at PR head | Commands are sandboxed beyond normal workspace isolation |
| Placeholders | `{baseRef}`, `{headRef}`, and `{diffRange}` are substituted literally | Placeholder values are shell-escaped |
| Output | Unified diff on stdout is parsed into bounded GitHub suggestions | Raw stdout/stderr is copied into production logs or public comments |

Operational guidance:

- Only enable formatter overrides for repositories whose maintainers understand the shell execution model.
- Prefer diff-emitting tools invoked directly over opaque shell pipelines when possible.
- Keep smoke overrides (like `scripts/m066-formatter-smoke.py`) limited to proof repositories.
- Treat unexpected network egress or credential access from formatter commands as a repository trust incident, not an app bug.

## Prepare a safe smoke PR

Use a small PR with one intentional formatting-only issue that the default formatter command, or the repository's configured override, can fix. Keep the PR narrow:

- One or two changed files.
- A formatting issue that produces a tiny unified diff.
- No generated files, lockfiles, secrets, or unrelated logic changes.
- A base branch and head branch that are both accessible to the installed GitHub App.

The expected visible proof is a same-PR **Pull Request Review** with at least one fenced GitHub `suggestion` block. Issue comments, standalone PR comments, and branch pushes are not sufficient proof for this slice.

## Trigger explicit formatter suggestions

### Format-only request

Comment on the PR:

```text
@kodiai format suggestions
```

Expected behavior:

- Kodiai acknowledges the mention best-effort with an eyes reaction.
- The formatter subflow runs without running a normal review.
- When suggestions are available and publish succeeds, Kodiai posts a Pull Request Review containing committable formatter suggestions.
- If the formatter command fails, Kodiai replies with a bounded diagnostic summarizing the command failure without exposing raw unbounded formatter output.

### Combined review and format request

Comment on the PR with either accepted spelling:

```text
@kodiai review format suggestions
```

```text
@kodiai review & format suggestions
```

Expected behavior:

- Kodiai runs the explicit review path and the formatter-suggestion subflow independently.
- Review publishing and formatter publishing have separate status fields.
- A formatter failure can be partial even when the review path succeeds; inspect both sets of fields before declaring the smoke failed.

## Capture proof identifiers

Record proof in the formatter-suggestions smoke template. Capture:

- Repository and PR URL.
- Trigger comment URL.
- GitHub webhook `deliveryId` (`X-GitHub-Delivery`).
- `reviewOutputKey` for the formatter suggestion request. It must encode the `mention-format-suggestions` action.
- Deployed revision active during the run.
- Formatter Pull Request Review URL/id.
- At least one suggestion comment URL/id from that review.
- Verifier command and bounded JSON output.
- Log query used for the delivery.
- Optional screenshot URL.

The `reviewOutputKey` marker is included in the Pull Request Review body and is the correlation key used by the verifier.

## Verify the same-PR review surface

Run the live verifier with the captured identifiers:

```sh
bun run verify:m066:s05 -- --repo <owner/repo> --review-output-key <captured-mention-format-suggestions-key> --delivery-id <captured-delivery-id> --json
```

The verifier requires GitHub App access through environment-managed operational inputs such as `GITHUB_APP_ID` and `GITHUB_PRIVATE_KEY` or `GITHUB_PRIVATE_KEY_BASE64`; do not paste credential values into files, logs, proof records, or chat transcripts.

Passing proof means the verifier found exactly one matching `COMMENTED` Pull Request Review on the target PR and at least one associated review comment with a fenced `suggestion` block. Treat verifier failures, unavailable GitHub/Azure proof systems, malformed identifiers, wrong-action keys, and issue-comment-only surfaces as bounded operational failures, not proof success.

Common verifier failures:

| Symptom | Interpretation | Next check |
|---|---|---|
| Missing GitHub App access | The verifier cannot authenticate locally. | Run from an environment with the app credentials available; do not paste secret values into logs. |
| Malformed review output key | The captured key is not a Kodiai review-output identity. | Re-copy the key from the review marker or completion surface. |
| Wrong action in key | The key is for another flow, such as `mention-review`. | Capture the formatter key that encodes `mention-format-suggestions`. |
| Delivery mismatch | The provided delivery id does not match the encoded key. | Confirm the GitHub delivery and formatter review came from the same request. |
| No matching review | The formatter review was not posted or the wrong PR/repo was checked. | Inspect logs by delivery id and reviewOutputKey. |
| No suggestion comments | A review was found, but it did not contain committable suggestion comments. | Check formatter diff mapping, skipped counts, capped counts, and publisher status. |

## Inspect logs in Azure Container Apps

Use the delivery id and reviewOutputKey together. Start with the delivery id, then narrow to formatter log messages.

Example Log Analytics query:

```kusto
ContainerAppConsoleLogs_CL
| where TimeGenerated > ago(24h)
| where Log_s has "<delivery-id>" or Log_s has "<review-output-key>"
| project TimeGenerated, RevisionName_s, Log_s
| order by TimeGenerated asc
```

Expected formatter completion messages:

- `Format-only formatter suggestion request completed`
- `Combined review-and-format mention request completed`

Important fields:

| Field | Meaning |
|---|---|
| `formatterStatus` | Overall formatter subflow status. |
| `commandStatus` | Formatter command status, including no-op, success, timeout, or command failure states. |
| `publisherStatus` | Pull Request Review publication status. |
| `suggestions` | Applicable suggestions produced from the formatter diff. |
| `skipped` | Formatter diff hunks that could not be mapped to reviewable PR locations. |
| `capped` | Applicable hunks omitted because `maxSuggestions` was reached. |
| `posted` | Suggestions posted in the Pull Request Review. |
| `publisherSkipped` | Suggestions skipped by publication gates. |
| `publisherFailed` | Suggestions that failed during publication. |
| `deliveryId` | Webhook delivery correlation key. |
| `reviewOutputKey` | Review-output marker and verifier correlation key. |

Interpretation guidance:

- `no-op` with `suggestions=0` and `skipped=0` usually means the default formatter found nothing to change.
- `failed` with `commandStatus=failed` means the formatter command itself failed without usable diff stdout. Inspect the bounded visible diagnostic and relevant logs; do not paste raw stderr containing secrets into proof records.
- `suggestions=0` with `skipped>0` usually means the formatter produced changes outside reviewable PR hunks.
- `capped>0` means proof can still pass if at least one suggestion was posted; raise `maxSuggestions` only if maintainers need broader coverage.
- `publisherFailed>0` means inspect GitHub API failures and permissions before retrying.
- A combined request can have `combinedPartialFailure=true` when either the review path or the formatter path is degraded.

## Retry and idempotency guidance

Safe retry pattern:

1. Keep the same smoke PR open.
2. Fix only the configuration or formatter command issue.
3. Add a new explicit trigger comment.
4. Capture the new delivery id and formatter reviewOutputKey.
5. Re-run the verifier with the new identifiers.

Do not reuse proof identifiers across retries. Each trigger has its own delivery id and reviewOutputKey. If a retry produces no new review, use the latest completion log fields to determine whether the run was skipped, capped, blocked, or failed.

## Proof record

Use the smoke template at [Formatter Suggestions Smoke Proof](../smoke/m066-formatter-suggestions.md), and use [M053 Formatter Suggestions Proof Alignment](../smoke/m053-formatter-suggestions.md) when closing M053/S05/R085 against the accepted M066 evidence. Keep proof artifacts bounded: public PR/review/comment URLs, delivery id, review id, reviewOutputKey, deployed revision, verifier JSON, and concise log summaries are acceptable. Do not include GitHub App private keys, tokens, raw formatter stdout, or unbounded formatter stderr.
