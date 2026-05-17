# M068 Candidate Publication Historical Proof Record

This document is a historical proof record for the bounded S05 candidate-approved review publication work on `xbmc/xbmc#28172`. It is **not** an evergreen runnable smoke test. Do not deploy, trigger GitHub events, mutate `xbmc/xbmc#28172`, or run Azure/GitHub write operations from this document without fresh explicit operator approval and a newly selected safe target.

The archived procedure below records the gates and evidence shape used for one mutation-sensitive proof run. Treat all target state as stale until revalidated. Stop at the first failed gate. Do not compensate with ad hoc GitHub writes, manual Review Details publication, synthetic Review Details artifacts, or unbounded evidence capture.

## Target state

| Field | Required value |
|---|---|
| Repository and PR | `xbmc/xbmc#28172` |
| Current automatic trigger stance | do not retry the prior app-authored `ready_for_review` path |
| Preferred next proof path | non-self actor plus either a new head SHA or explicit nested `review.triggers.onSynchronize: true` before a `synchronize` trigger |
| Reviewer-request stance | do not repeat same-head same-action `kodiai` reviewer requests unless run-state evidence proves the event will dispatch |
| Bot-filter stance | app-authored `bot-filter` logs are a hard stop; do not weaken self-event filtering |
| Verifier | `verify:m068` |
| Success status | `status_code=m068_ok` |
| Required visible output | exactly one Review Details artifact for the exact key |
| Candidate publication | candidate-approved publication count greater than zero |
| Volume bound | `candidate_inline_count <= 3` |
| Fallback bound | runtime direct fallback count is zero |
| Redaction bound | `leak_marker_count=0` |

## Current read-only target state

These bounded fields were carried forward from the S06 research snapshot and must be rechecked immediately before any future live mutation because GitHub state can change.

| Field | Observed value |
|---|---|
| Repository and PR | `xbmc/xbmc#28172` |
| PR state | `open` |
| Draft flag | `draft=false` |
| Head SHA | `6b33c9a972c192e5e14ae9546dbc11a55665ea52` |
| Requested reviewers | includes `kodiai` |
| Repository config files | base and head `.kodiai.yml` exist |
| Observed trigger config lines | only `review.enabled: true`; no nested trigger override observed |

## S06 bot-filter diagnosis

Delivery `a2b79210-4bfb-11f1-8c69-019aa7e2848b` reached the webhook router for `pull_request.ready_for_review`, then the router emitted `Event filtered before dispatch` with `filterReason=bot-filter`. Because router filtering runs before handler lookup, this diagnosis is a self-event or actor-class problem, not evidence that `pull_request.ready_for_review` lacks handler registration. The review handler registers `pull_request.ready_for_review`; the event did not reach that handler because self-event loop prevention stopped it first.

Do not weaken the bot filter to force this proof. The next live attempt must change trigger authorship or event eligibility while preserving self-event filtering.

## Hard stop rules

Stop before any public GitHub mutation when any of these is true:

- The local regression set fails.
- Deployment fails, the active revision is unknown, `/healthz` is not HTTP 200, or `/readiness` is not HTTP 200.
- The PR is closed, merged, not `xbmc/xbmc#28172`, has an unexpected head repository, or has an unexpected head branch.
- The intended trigger is not eligible for the current PR state.
- Repository config cannot be confirmed for the fallback path.
- The prior app-authored delivery, or any new delivery from the same actor class, is classified with `filterReason=bot-filter`.
- Kodiai is already requested as a reviewer and a duplicate `review_requested` delivery would be produced.
- A previous exact-key run is still pending or already produced bounded evidence.

Stop without claiming success when `verify:m068` reports pending live evidence, fallback-only evidence, zero candidate-approved publication, missing Review Details, duplicate Review Details, malformed Review Details, visible-volume overflow, missing runtime gates, or any redaction marker.

## Local regression gate

Run these before deployment:

```sh
bun test scripts/verify-m068.test.ts scripts/verify-m067-s05.test.ts
bun test src/execution/mcp/candidate-finding-server.test.ts src/execution/review-prompt.test.ts
bun run verify:m068 --json
bun run verify:m068 -- --preflight-only --json
bun run verify:m068:s01 --json
bun run verify:m068:s02 --json
bun run verify:m068:s03 --json
bun run lint
```

Expected result: every command exits `0`. If any command fails, fix locally and repeat the local regression gate. Do not deploy or trigger GitHub while this gate is red.

## Deploy and readiness gate

Deploy only after the local regression gate is green:

```sh
./deploy.sh
```

Record these bounded fields from the deploy output and Azure checks:

| Evidence field | Capture rule |
|---|---|
| Active revision | revision name only |
| App URL | URL only |
| Health result | HTTP status and compact status body only |
| Readiness result | HTTP status and compact status body only |
| Image | digest or tag only |

Required post-deploy checks:

```sh
az containerapp revision list -n ca-kodiai -g rg-kodiai -o table
curl -fsS "https://<app-host>/healthz"
curl -fsS "https://<app-host>/readiness"
```

If deployment, active revision, health, or readiness is not green, stop before GitHub mutation. Use Azure Container Apps revision and health diagnostics to repair deployment first; do not try to prove M068 against an unhealthy revision.

## Trigger decision gate for `xbmc/xbmc#28172`

Inspect the target PR immediately before choosing a trigger. Capture only bounded metadata: state, draft flag, base branch, head repository, head branch, head SHA, requested reviewer logins, and whether `.kodiai.yml` exists in both base and head.

The previous live attempt proved that an app-authored `ready_for_review` delivery can reach the webhook router and still be filtered before review-handler dispatch. That is different from a missing handler: `pull_request.ready_for_review` is registered, but the bot filter runs before dispatch and always drops events authored by the app itself.

Use this decision table:

| Candidate trigger | Current decision | Why |
|---|---|---|
| Retry `ready_for_review` on the current head | Do not use | The PR is already `draft=false`, and the prior app-authored delivery was classified as `filterReason=bot-filter` before handler dispatch. |
| Same-head same-action reviewer request for `kodiai` | Do not repeat by default | The target already includes `kodiai` as a requested reviewer; duplicate reviewer requests can be skipped or fail to produce a usable key. Use only if bounded run-state evidence proves a new delivery will dispatch. |
| Non-self actor with new head SHA | Preferred safe path | A user-authored or otherwise non-self event avoids the self-event loop-prevention filter while preserving the bot filter. A new head SHA also gives the verifier a fresh exact key. |
| `synchronize` from non-self actor | Eligible only with explicit nested config | Use only after confirming the checked-out config contains `review.triggers.onSynchronize: true`; legacy or absent trigger lines do not enable the runtime trigger. |
| App-authored event that logs `filterReason=bot-filter` | Hard stop | Treat this as self-event protection working as designed. Do not weaken the filter or compensate with manual publication. |

Carry-forward lessons from M067 and S06:

- Do not use `synchronize` as a fallback for this target unless nested `review.triggers.onSynchronize: true` is present in the checked-out repository config. The default is disabled, and legacy `review.onSynchronize` does not enable the runtime trigger.
- Do not issue duplicate reviewer requests. A duplicate `review_requested` run can be skipped as already processed and may not emit a usable key.
- Do not retry live triggers against a key that already failed publication readiness unless the verifier gate says the key is eligible for another attempt.
- Do not interpret `Event filtered before dispatch` with `filterReason=bot-filter` as a review-handler registration failure.

## Trigger execution

Choose exactly one eligible automatic trigger from the decision gate. Record the trigger kind, attempt time window, and bounded PR metadata.

For the current target state, do not use `ready_for_review` again: the PR is already `draft=false`, and the previous app-authored delivery was filtered before handler dispatch. For reviewer request, request the `kodiai` reviewer only if the reviewer state has changed and bounded run-state evidence says the resulting event will dispatch. For a `synchronize` path, require a non-self actor and explicit nested `review.triggers.onSynchronize: true`; otherwise create no mutation and leave the proof blocked.

GitHub write operations should be attributable to the bot/operator tooling in use. Never post or edit Review Details manually. Never create a synthetic comment, review, or artifact to satisfy this runbook.

## Key discovery

Discover the exact live identifiers from webhook delivery and runtime logs after the trigger. Runtime command examples below use shell variables rather than literal placeholder values:

- `LIVE_DELIVERY` — the `X-GitHub-Delivery` value for the single eligible automatic trigger.
- `LIVE_KEY` — the exact `reviewOutputKey` emitted by the deployed handler for `xbmc/xbmc#28172`.

Use bounded log queries scoped by the trigger time window and the delivery id. Capture these signal names and counts only:

| Signal | Required proof |
|---|---|
| Webhook delivery | one delivery id for the chosen trigger |
| Runtime key | one review output key for `xbmc/xbmc#28172` |
| Candidate publication gate | `gate="review-candidate-publication"` row present |
| Adapter publication gate | `gate="review-candidate-publication-adapter"` row present |
| Review Details publication | Review Details publication row present |
| Active revision | revision name matches the deployed revision |

Do not store prompt contents, diff contents, full GitHub bodies, unrestricted log exports, candidate payloads, or secret values. Keep only IDs, status codes, check IDs, bounded counts, revision names, and verifier summaries.

## Exact-key verifier gate

Run preflight first with the live identifiers:

```sh
bun run verify:m068 -- --preflight-only --json --repo xbmc/xbmc --review-output-key "$LIVE_KEY" --delivery-id "$LIVE_DELIVERY"
```

Expected result: exit `0`, exact target accepted, and publication readiness not blocked. If this fails, stop. Do not perform another GitHub mutation unless a separate plan explicitly authorizes a new trigger.

Run the full proof only after preflight passes:

```sh
bun run verify:m068 -- --json --repo xbmc/xbmc --review-output-key "$LIVE_KEY" --delivery-id "$LIVE_DELIVERY"
```

Required full verifier result:

| Check | Required value |
|---|---|
| Command exit | `0` |
| `status_code` | `m068_ok` |
| Review Details artifacts | exactly `1` |
| Candidate inline count | less than or equal to `3` |
| Candidate-approved publication | count greater than `0` |
| Runtime direct fallback | `0` |
| Runtime gates | candidate publication, adapter publication, and Review Details publication present |
| Redaction | `leak_marker_count=0` |

## Evidence capture template

Fill this table for the final proof document or task summary. Keep each value bounded.

| Field | Value |
|---|---|
| Target | `xbmc/xbmc#28172` |
| Trigger | `ready_for_review`, `review_requested`, or fallback path used |
| Delivery id | `$LIVE_DELIVERY` |
| Review output key | `$LIVE_KEY` |
| Active revision | revision name |
| Health/readiness | compact HTTP results |
| Preflight command result | exit code and `status_code` |
| Full verifier result | exit code and `status_code` |
| Failing check id | `none` for success, otherwise exact check id |
| Review Details count | verifier count |
| Candidate inline count | verifier count |
| Candidate-approved count | verifier/runtime count |
| Direct fallback count | verifier/runtime count |
| Runtime gates | present/missing booleans |
| Redaction status | `leak_marker_count=0` |

## Evidence redaction and bounds

Allowed evidence:

- Delivery ids, review output keys, revision names, image digests, command names, exit codes, status codes, check IDs, counts, booleans, compact health/readiness bodies, and short bounded issue strings.

Forbidden evidence:

- Prompt contents.
- Diff contents.
- Full GitHub request or response bodies.
- Unrestricted log exports or unrestricted Log Analytics rows.
- Full candidate text or candidate payloads.
- Secret values, tokens, private keys, OAuth material, webhook signatures, or database URLs.
- Synthetic or manually published Review Details.

If the verifier or logs expose forbidden material, stop and redact the capture before sharing. Do not paste it into docs, task summaries, issues, or comments.

## Success statement

Claim S05 success only when the full exact-key verifier exits `0` with `status_code=m068_ok` for `xbmc/xbmc#28172`, the live key and delivery id are recorded, exactly one Review Details artifact exists for the key, candidate-approved publication is greater than zero, visible output is within bounds, runtime direct fallback is zero, required runtime gates are present, and redaction status is clean.

## T05 live execution record — 2026-05-09

Status: **Blocked after one live `ready_for_review` trigger; no success claimed.** Local regression and ACA deployment/readiness passed, and exactly one public mutation was executed against `xbmc/xbmc#28172`. The deployed handler accepted the `pull_request.ready_for_review` webhook, then logged `Event filtered before dispatch` for the delivery before emitting a `reviewOutputKey` or publication gates. The exact-key verifier therefore remains fail-closed with zero Review Details artifacts, zero candidate inline artifacts, zero candidate-approved publications, and no direct fallback output.

No additional GitHub mutation was attempted after this blocked result. No prompt contents, diff contents, complete candidate bodies, raw GitHub bodies, unrestricted log exports, or secrets are recorded here.

### Local regression evidence

| Command | Exit Code | Duration | Verdict |
|---|---:|---:|---|
| `bun test scripts/verify-m068.test.ts scripts/verify-m067-s05.test.ts` | 0 | 1339ms | ✅ pass |
| `bun test src/execution/mcp/candidate-finding-server.test.ts src/execution/review-prompt.test.ts` | 0 | 228ms | ✅ pass |
| `bun run verify:m068 --json` | 0 | 242ms | ✅ pass |
| `bun run verify:m068 -- --preflight-only --json` | 0 | 232ms | ✅ pass |
| `bun run verify:m068:s01 --json` | 0 | 170ms | ✅ pass |
| `bun run verify:m068:s02 --json` | 0 | 32ms | ✅ pass |
| `bun run verify:m068:s03 --json` | 0 | 54ms | ✅ pass |
| `bun run lint` | 0 | 7438ms | ✅ pass |

### Deployment and readiness evidence

| Field | Value |
|---|---|
| Deploy command | `./deploy.sh` |
| Deploy result | succeeded |
| Resource group | `rg-kodiai` |
| Container app | `ca-kodiai` |
| Active revision | `ca-kodiai--deploy-20260509-160410` |
| App image | `kodiairegistry.azurecr.io/kodiai@sha256:5929934b197f9b5f42631ddb7f01739f86e3beadd40b3f205bf7c079988c014f` |
| App URL | `https://ca-kodiai.agreeableisland-d347f806.eastus.azurecontainerapps.io` |
| `/healthz` result | HTTP 200, `{"status":"ok"}` |
| `/readiness` result | HTTP 200, `{"status":"ready"}` |

### Trigger evidence

| Field | Value |
|---|---|
| Target | `xbmc/xbmc#28172` |
| Trigger | `ready_for_review` |
| Attempt window | `2026-05-09T23:05:54Z` → `2026-05-09T23:05:56Z` |
| GitHub mutation result | GraphQL HTTP 200, `graphql_error_count=0` |
| PR state after mutation | `OPEN`, `is_draft=false` |
| Head branch | `kodiai-review-validation-20260411` |
| Head SHA | `6b33c9a972c192e5e14ae9546dbc11a55665ea52` |
| Delivery id | `a2b79210-4bfb-11f1-8c69-019aa7e2848b` |
| Webhook metadata | `pull_request.ready_for_review`, status `OK`, delivered at `2026-05-09T23:05:57.909Z` |
| Runtime tail signal | `Webhook accepted and queued for dispatch`; then `Event filtered before dispatch` with `filterReason=bot-filter` for the same delivery |
| Runtime review output key | not emitted before filtering |
| Deterministic exact key used for verifier | `kodiai-review-output:v1:inst-109141824:xbmc/xbmc:pr-28172:action-ready_for_review:delivery-a2b79210-4bfb-11f1-8c69-019aa7e2848b:head-6b33c9a972c192e5e14ae9546dbc11a55665ea52` |

### Exact-key verifier evidence

Preflight command:

```sh
bun run verify:m068 -- --preflight-only --json --repo xbmc/xbmc --review-output-key "kodiai-review-output:v1:inst-109141824:xbmc/xbmc:pr-28172:action-ready_for_review:delivery-a2b79210-4bfb-11f1-8c69-019aa7e2848b:head-6b33c9a972c192e5e14ae9546dbc11a55665ea52" --delivery-id "a2b79210-4bfb-11f1-8c69-019aa7e2848b"
```

| Field | Value |
|---|---|
| Exit code | 0 |
| Duration | 227ms |
| Status code | `m068_pending_live_evidence` |
| Failing check id | `none` |
| Publication status | `pending_live_evidence` |
| Review Details count | 0 |
| Candidate inline count | 0 |
| Total exact-key artifacts | 0 |
| Redaction | `leak_marker_count=0` |

Full proof command:

```sh
bun run verify:m068 -- --json --repo xbmc/xbmc --review-output-key "kodiai-review-output:v1:inst-109141824:xbmc/xbmc:pr-28172:action-ready_for_review:delivery-a2b79210-4bfb-11f1-8c69-019aa7e2848b:head-6b33c9a972c192e5e14ae9546dbc11a55665ea52" --delivery-id "a2b79210-4bfb-11f1-8c69-019aa7e2848b"
```

| Field | Value |
|---|---|
| Exit code | 1 |
| Duration | 9163ms |
| Status code | `m068_contract_failed` |
| Failing check id | `M068-REDUCER-ADAPTER-PUBLICATION-STATE` |
| Failed checks | `M068-REDUCER-ADAPTER-PUBLICATION-STATE`, `M068-CANDIDATE-PATH-PROOF`, `M068-REVIEW-DETAILS-EVIDENCE`, `M068-RUNTIME-LOG-EVIDENCE` |
| Artifact status | `classified` |
| Review Details count | 0 |
| Candidate inline count | 0 |
| Total exact-key artifacts | 0 |
| Runtime status | `classified` |
| Runtime matched rows | 0 |
| Candidate publication log count | 0 |
| Adapter publication log count | 0 |
| Review Details publication log count | 0 |
| Candidate-approved published count | 0 |
| Direct fallback count | 0 |
| Runtime gates | candidate publication missing; adapter publication missing; Review Details publication missing |
| Redaction | `leak_marker_count=0` |

Final interpretation: the task produced a bounded blocked proof, not an M068 success proof. The local and deployment gates are green, but the only permitted live trigger did not reach the automatic review publication path. The must-have candidate-approved publication count `> 0` is not met, exactly one Review Details artifact is not present, and required runtime publication gates are missing. Because the handler filtered the event before dispatch, this run preserves the visible-volume and no-fallback safety bounds while leaving S05 success unclaimed.

## T03 execution record — 2026-05-09

Status: **Blocked; no additional public GitHub mutation performed.** This task found an existing bounded live attempt record for delivery `a2b79210-4bfb-11f1-8c69-019aa7e2848b` and exact key `kodiai-review-output:v1:inst-109141824:xbmc/xbmc:pr-28172:action-ready_for_review:delivery-a2b79210-4bfb-11f1-8c69-019aa7e2848b:head-6b33c9a972c192e5e14ae9546dbc11a55665ea52`. Because the runbook allows one bounded public attempt and the refreshed PR state still has the same head SHA with `kodiai` already requested, a second reviewer-request mutation would be duplicate/noise rather than eligible non-self proof.

No prompt contents, diff contents, complete candidate bodies, raw GitHub bodies, unrestricted log exports, workspace paths, file bodies, or secrets are recorded here.

### Current-code deployment and readiness evidence

| Field | Value |
|---|---|
| Deploy command | `./deploy.sh` |
| Deploy result | succeeded |
| Deploy duration | 283238ms |
| Resource group | `rg-kodiai` |
| Container app | `ca-kodiai` |
| Active revision | `ca-kodiai--deploy-20260509-160410` |
| App image | `kodiairegistry.azurecr.io/kodiai@sha256:837f97db6a97edf31819d1b74d17a04ab8c2d420835cc4d40899cd8f74ace894` |
| App URL | `https://ca-kodiai.agreeableisland-d347f806.eastus.azurecontainerapps.io` |
| `/healthz` result | HTTP 200, `{"status":"ok"}` |
| `/readiness` result | HTTP 200, `{"status":"ready"}` |

### Read-only trigger eligibility refresh

| Field | Value |
|---|---|
| Target | `xbmc/xbmc#28172` |
| PR state | `open` |
| Draft flag | `draft=false` |
| Base branch | `master` |
| Head repository | `keithah/xbmc` |
| Head branch | `kodiai-review-validation-20260411` |
| Head SHA | `6b33c9a972c192e5e14ae9546dbc11a55665ea52` |
| Requested reviewers | includes `kodiai` |
| Trigger decision | no new mutation; previous one-attempt live proof remains the bounded evidence source |

### Fresh T03 verifier classification

| Field | Value |
|---|---|
| Local S01 verifier | exit 0, `status_code=m068_s01_ok`, `leak_marker_count=0` |
| Local S02 verifier | exit 0, `status_code=m068_s02_ok`, `leak_marker_count=0` |
| Local S03 verifier | exit 0, `status_code=m068_s03_ok`, `leak_marker_count=0` |
| Aggregate preflight without live key | exit 0, `status_code=m068_skipped_missing_review_output_key`, `leak_marker_count=0` |
| Exact-key preflight | exit 0, `status_code=m068_pending_live_evidence`, `leak_marker_count=0` |
| Exact-key full verifier | exit 1, `status_code=m068_contract_failed`, failing check `M068-REDUCER-ADAPTER-PUBLICATION-STATE`, `leak_marker_count=0` |
| Review Details count | 0 |
| Candidate inline count | 0 |
| Candidate-approved published count | 0 |
| Direct fallback count | 0 |
| Runtime gates | candidate publication missing; adapter publication missing; Review Details publication missing |
| Final classification | bounded blocked proof; R114/R115 not validated |

Final T03 interpretation: the exact-key evidence remains safely fail-closed. Current code deploys and health/readiness are green, local verifier gates pass, and redaction remains clean, but the only available live delivery was filtered before dispatch and emitted no authoritative runtime `reviewOutputKey`, publication gates, or Review Details artifact. This is a blocked/partial result, not `status_code=m068_ok` success.

## S07 readiness record — 2026-05-10

Status: **Readiness passed for local verifier/ACA health, but current target state is no-go for an immediate same-head mutation.** A future non-self new-head event remains the preferred eligible path. A `synchronize` live attempt is ineligible until the checked-out repository config has explicit nested `review.triggers.onSynchronize: true`, and a same-head reviewer-request attempt is ineligible by default because `kodiai` is already requested.

No public GitHub mutation was performed for this readiness record. No prompt contents, diff contents, complete candidate bodies, unrestricted logs, workspace paths, raw GitHub bodies, or secrets are recorded here.

### S07 local readiness gate

| Command | Exit Code | Duration ms | Verdict | Bounded summary |
|---|---:|---:|---|---|
| `bun test scripts/verify-m068.test.ts scripts/verify-m067-s05.test.ts` | 0 | 1585 | ✅ pass | tests passed; no command failure |
| `bun test src/execution/mcp/candidate-finding-server.test.ts src/execution/review-prompt.test.ts` | 0 | 220 | ✅ pass | tests passed; no command failure |
| `bun run verify:m068 --json` | 0 | 273 | ✅ pass | `status_code="local_prerequisites_ok"`, `failing_check_id=null`, `success=true` |
| `bun run verify:m068 -- --preflight-only --json` | 0 | 249 | ✅ pass | `status_code="local_prerequisites_ok"`, `failing_check_id=null`, `success=true` |
| `bun run verify:m068:s01 --json` | 0 | 165 | ✅ pass | `status_code="m068_s01_ok"`, `failing_check_id=null`, `success=true` |
| `bun run verify:m068:s02 --json` | 0 | 46 | ✅ pass | `status_code="m068_s02_ok"`, `failing_check_id=null`, `success=true` |
| `bun run verify:m068:s03 --json` | 0 | 73 | ✅ pass | `status_code="m068_s03_ok"`, `failing_check_id=null`, `success=true` |
| `bun run lint` | 0 | 7649 | ✅ pass | eslint completed with exit 0 |

Full command output is preserved under `.gsd/exec/c813b32a-3a96-48ac-9844-25b88601443a.stdout`.

### S07 target PR and trigger config

| Field | Value |
|---|---|
| Target | `xbmc/xbmc#28172` |
| PR state | `open` |
| Draft flag | `draft=false` |
| Merged | `merged=false` |
| Base branch | `master` |
| Base SHA | `9e53f2f4b8e95cb8cc086d4f3606ada677d362cf` |
| Head repository | `keithah/xbmc` |
| Head branch | `kodiai-review-validation-20260411` |
| Head SHA | `6b33c9a972c192e5e14ae9546dbc11a55665ea52` |
| Requested reviewers | includes `kodiai` |
| Base `.kodiai.yml` | exists; nested `review.triggers.onSynchronize` absent |
| Head `.kodiai.yml` | exists; nested `review.triggers.onSynchronize` absent |
| Effective nested synchronize trigger | `false` / ineligible because nested `review.triggers.onSynchronize: true` is absent |
| Legacy synchronize trigger | absent; legacy-only `review.onSynchronize` would remain ineligible |

### S07 ACA revision and readiness

| Field | Value |
|---|---|
| Container app | `ca-kodiai` |
| Resource group | `rg-kodiai` |
| Active revision | `ca-kodiai--deploy-20260509-163641` |
| Active revisions mode | `Single` |
| Active revision traffic | `ca-kodiai--deploy-20260509-163641:100%:Healthy` |
| App URL | `https://ca-kodiai.agreeableisland-d347f806.eastus.azurecontainerapps.io` |
| `/healthz` | HTTP 200, `{"status":"ok"}` |
| `/readiness` | HTTP 200, `{"status":"ready"}` |

### S07 go/no-go decision

| Gate | Decision | Bounded reason |
|---|---|---|
| Local verifier/regression gate | Go | All required commands exited 0. |
| ACA revision/readiness gate | Go | Active revision is healthy with 100% traffic; `/healthz` and `/readiness` returned HTTP 200. |
| Target PR state gate | Go | Target is open, not draft, not merged, and still on the expected head branch/SHA. |
| `synchronize` trigger gate | No-go | Base and head configs do not contain nested `review.triggers.onSynchronize: true`. |
| Same-head reviewer-request gate | No-go by default | `kodiai` is already requested, so a duplicate request would be noisy/ineligible without separate bounded dispatch evidence. |
| Future non-self new-head trigger gate | Go when available | A non-self actor with a new head SHA remains the preferred eligible path while preserving bot-filter protection. |

Final S07 readiness interpretation: no local, verifier, GitHub-read, or ACA-readiness failure blocks future proof collection, but the current target/config state does not authorize an immediate same-head mutation. The next step should either wait for or use exactly one eligible non-self new-head trigger, or record a fresh blocked artifact if no eligible trigger is available.

## S07 blocked record — 2026-05-10

Status: **Blocked before public mutation; no eligible live trigger was available.** A fresh read-only eligibility refresh confirmed the target is still `xbmc/xbmc#28172`, open, not draft, not merged, on the same head SHA `6b33c9a972c192e5e14ae9546dbc11a55665ea52`, and already requesting `kodiai`. The active Azure Container Apps revision is healthy, but the current target/config state does not permit a safe same-head mutation: `review_requested` would be duplicate/noisy, `ready_for_review` is not a real transition because the PR is already ready, and `synchronize` is disabled because base and head configs do not contain nested `review.triggers.onSynchronize: true`.

No public GitHub mutation was performed for this blocked record. No delivery id or `reviewOutputKey` was created in S07/T02. No prompt contents, diff contents, complete candidate bodies, unrestricted logs, workspace paths, raw GitHub bodies, or secrets are recorded here.

### S07 blocked eligibility refresh

| Field | Value |
|---|---|
| Target | `xbmc/xbmc#28172` |
| Refresh window | `2026-05-10T03:20:03Z` → `2026-05-10T03:20:11Z` |
| PR state | `open` |
| Draft flag | `draft=false` |
| Merged | `merged=false` |
| Base branch | `master` |
| Base SHA | `9e53f2f4b8e95cb8cc086d4f3606ada677d362cf` |
| Head repository | `keithah/xbmc` |
| Head branch | `kodiai-review-validation-20260411` |
| Head SHA | `6b33c9a972c192e5e14ae9546dbc11a55665ea52` |
| Requested reviewers | includes `kodiai` |
| Base `.kodiai.yml` | exists; nested `review.triggers.onSynchronize=true` absent |
| Head `.kodiai.yml` | exists; nested `review.triggers.onSynchronize=true` absent |
| Active revision | `ca-kodiai--deploy-20260509-163641` |
| Active revision traffic | `ca-kodiai--deploy-20260509-163641:100%:Healthy` |
| `/healthz` | HTTP 200, `{"status":"ok"}` |
| `/readiness` | HTTP 200, `{"status":"ready"}` |
| Trigger attempt performed | `no` |
| Delivery id | `none` |
| Review output key | `none` |
| Dispatch/filter outcome | no webhook dispatch because no mutation was eligible |

### S07 blocked gate decisions

| Gate | Decision | Bounded reason |
|---|---|---|
| Non-self/new-head event | Blocked | No new non-self head SHA is available in the refreshed target state. |
| `ready_for_review` | Blocked | Target is already `draft=false`; no real draft-to-ready transition is available. |
| `review_requested` | Blocked | `kodiai` is already requested, so a same-head reviewer request would be duplicate/noisy and violates the one-attempt load bound. |
| `synchronize` | Blocked | Base and head configs lack nested `review.triggers.onSynchronize: true`; legacy or absent trigger config must not be treated as enabled. |
| Bot-filter bypass | Blocked | `filterReason=bot-filter` remains hard-stop evidence and `createBotFilter()` must not be weakened. |
| Manual Review Details publication | Blocked | Manual or synthetic Review Details artifacts are forbidden for M068 acceptance. |

### T03 instructions

T03 must treat this T02 result as fail-closed blocked evidence, not as a live proof. Because S07/T02 created no fresh delivery id and no fresh `reviewOutputKey`, do not run an exact-key full verifier for a new S07 attempt and do not reuse the historical S06/T05 key as acceptance evidence. Run the aggregate/no-key `bun run verify:m068 --json` and append an `S07 verifier outcome` section that records a blocked status with `delivery_id=none`, `review_output_key=none`, Review Details count `0`, candidate-approved count `0`, direct fallback count `0`, missing runtime gates, and `leak_marker_count=0`. If an eligible non-self new-head delivery appears before T03 executes, T03 may instead consume that fresh delivery/key only if it can prove the event was produced by exactly one eligible automatic trigger and no manual Review Details publication occurred.

Final S07 blocked interpretation: the system remains ready for a future eligible non-self/new-head proof, but acceptance is unavailable now without violating duplicate-trigger, disabled-synchronize, self-event, or manual-publication safety rules.

## S07 verifier outcome — 2026-05-10

Status: **Fail-closed blocked; no exact-key live verifier was run because S07/T02 produced no fresh delivery id and no fresh `reviewOutputKey`.** The aggregate verifier was run in no-key mode to confirm local prerequisites and redaction remain clean while preserving the load bound: no exact-key GitHub artifact collection and no exact-key Log Analytics query were broadened without live identifiers.

No public GitHub mutation was performed for this verifier outcome. No prompt contents, diff contents, complete candidate bodies, unrestricted logs, workspace paths, raw GitHub bodies, or secrets are recorded here.

### S07 verifier outcome fields

| Field | Value |
|---|---|
| Target | `xbmc/xbmc#28172` |
| Delivery id | `none` |
| Review output key | `none` |
| Exact-key preflight | skipped; no live identifiers from S07/T02 |
| Exact-key full verifier | skipped; no live identifiers from S07/T02 |
| Aggregate verifier command | `bun run verify:m068 --json` |
| Aggregate verifier exit code | `0` |
| Aggregate verifier status_code | `m068_skipped_missing_review_output_key` |
| Aggregate failing check id | `none` |
| Review Details count | `0` |
| Candidate inline count | `0` |
| Candidate-approved published count | `0` |
| Direct fallback count | `0` |
| Runtime matched row count | `0` |
| Runtime gates | candidate publication missing; adapter publication missing; Review Details publication missing |
| Redaction | `leak_marker_count=0` |
| Final classification | fail-closed blocked evidence; not `m068_ok` acceptance |

Final S07 verifier interpretation: M068 acceptance remains unavailable because the exact-key proof inputs do not exist for S07. The local aggregate verifier is green for the no-key path and redaction is clean, but the required live proof conditions are not met: there is no delivery id, no `reviewOutputKey`, no Review Details artifact, no candidate-approved publication, and no runtime publication gates.

## S08 read-only readiness record — 2026-05-10

Status: **No-go for immediate live trigger; wait for an eligible non-self new-head event.** A fresh read-only refresh of `xbmc/xbmc#28172` confirmed the target is still open, not draft, not merged, and on the same head SHA `6b33c9a972c192e5e14ae9546dbc11a55665ea52` with `kodiai` already requested. Azure Container Apps readiness is green and local no-key verifier checks pass, but the current target/config state does not allow T03 to trigger a public mutation safely: same-head reviewer request is duplicate/noisy, `ready_for_review` is not a real transition, and `synchronize` remains disabled in both remote configs because nested `review.triggers.onSynchronize: true` is absent.

No public GitHub mutation was performed for this S08 read-only record. No delivery id or `reviewOutputKey` was created. No prompt contents, diff contents, complete candidate bodies, unrestricted logs, file-system paths, API response bodies, or secrets are recorded here.

### S08 read-only PR and config refresh

| Field | Value |
|---|---|
| Target | `xbmc/xbmc#28172` |
| Refresh window | `2026-05-10T05:59:42Z` → `2026-05-10T05:59:43Z` |
| PR state | `open` |
| Draft flag | `draft=false` |
| Merged | `merged=false` |
| Base branch | `master` |
| Base SHA | `9e53f2f4b8e95cb8cc086d4f3606ada677d362cf` |
| Head repository | `keithah/xbmc` |
| Head branch | `kodiai-review-validation-20260411` |
| Head SHA | `6b33c9a972c192e5e14ae9546dbc11a55665ea52` |
| PR author | `keithah` |
| Requested reviewers include `kodiai` | `true` |
| Requested reviewer count | `1` |
| Base `.kodiai.yml` | exists; nested `review.triggers.onSynchronize=true` absent |
| Head `.kodiai.yml` | exists; nested `review.triggers.onSynchronize=true` absent |
| Trigger attempt performed | `no` |
| Delivery id | `none` |
| Review output key | `none` |

### S08 read-only ACA readiness

| Field | Value |
|---|---|
| Container app | `ca-kodiai` |
| Resource group | `rg-kodiai` |
| Azure revision query | `ok` |
| Active revision | `ca-kodiai--deploy-20260509-163641` |
| Active revision traffic | `100%:Healthy` |
| App URL | `https://ca-kodiai.agreeableisland-d347f806.eastus.azurecontainerapps.io` |
| `/healthz` | HTTP 200, `{"status":"ok"}` |
| `/readiness` | HTTP 200, `{"status":"ready"}` |

### S08 read-only local verifier refresh

| Command | Exit Code | Duration ms | Status code | Leak marker count |
|---|---:|---:|---|---:|
| `bun run verify:m068 --json` | 0 | 243 | `m068_skipped_missing_review_output_key` | 0 |
| `bun run verify:m068 -- --preflight-only --json` | 0 | 241 | `m068_skipped_missing_review_output_key` | 0 |

### S08 read-only go/no-go decision

| Gate | Decision | Bounded reason |
|---|---|---|
| Local verifier readiness | Go | Aggregate and preflight no-key verifier checks exit 0 with `leak_marker_count=0`. |
| ACA health readiness | Go | Active revision has 100% healthy traffic; `/healthz` and `/readiness` return HTTP 200. |
| Target PR state | Go | Target is open, not draft, not merged, and still matches `xbmc/xbmc#28172`. |
| Same-head reviewer request | No-go | `kodiai` is already requested; repeating the request would be duplicate/noisy and not a fresh proof branch. |
| `ready_for_review` trigger | No-go | Target is already `draft=false`; no real draft-to-ready transition is available. |
| `synchronize` trigger | No-go | Base and head configs do not contain nested `review.triggers.onSynchronize: true`. |
| Final readiness decision | `no_go_wait_for_new_head` | T03 is not allowed to trigger now; it must wait for or consume exactly one eligible non-self new-head delivery, or keep the proof fail-closed. |

Final S08 read-only interpretation: deployed readiness and local verifier state are healthy, but current GitHub target eligibility remains blocked. The only permitted live proof branch is a future eligible non-self new-head trigger; no same-head, disabled-synchronize, self-authored, duplicate reviewer-request, or manual-publication path is authorized.

## S08 T03 fail-closed verifier outcome — 2026-05-10

Status: **Fail-closed blocked; no public mutation and no exact-key live verifier were run.** T02 recorded `no_go_wait_for_new_head`, so T03 stopped before any GitHub trigger. The aggregate no-key verifier was run to confirm the verifier remains clean while preserving the one-trigger load bound and avoiding old, manual, duplicate, self-authored, fallback-only, or no-artifact evidence as success.

No public GitHub mutation was performed for this T03 outcome. No delivery id or `reviewOutputKey` was created. No prompt contents, diff contents, complete candidate bodies, unrestricted logs, API response bodies, or secrets are recorded here.

### S08 T03 verifier outcome fields

| Field | Value |
|---|---|
| Target | `xbmc/xbmc#28172` |
| Trigger attempt performed | `no` |
| Delivery id | `none` |
| delivery_id | `none` |
| Review output key | `none` |
| review_output_key | `none` |
| Exact-key preflight | skipped; no fresh live identifiers from S08/T02 |
| Exact-key full verifier | skipped; no fresh live identifiers from S08/T02 |
| Aggregate verifier command | `bun run verify:m068 --json` |
| Aggregate verifier exit code | `0` |
| Aggregate verifier duration | `239ms` |
| Aggregate verifier status_code | `m068_skipped_missing_review_output_key` |
| Aggregate failing check id | `none` |
| review_details_count | `0` |
| candidate_inline_count | `0` |
| candidatePublished | `0` |
| directFallback | `0` |
| Runtime gates | candidate publication missing; adapter publication missing; Review Details publication missing |
| Visible-volume cap | not exercised; no exact-key artifacts collected |
| leak_marker_count | `0` |
| Short failure reason | `no_go_wait_for_new_head` |
| Final classification | fail-closed blocked evidence; not `m068_ok` acceptance |

Final S08 T03 interpretation: M068 acceptance remains unavailable because the exact-key proof inputs do not exist for S08. The no-key aggregate verifier is green with `status_code=m068_skipped_missing_review_output_key`, but the required live proof conditions are not met: there is no delivery id, no `reviewOutputKey`, no Review Details artifact, no candidate-approved publication, and no runtime publication completion gates.


## S08 T04 requirement reconciliation — 2026-05-10

Status: **Requirements reconciled as active/blocked; no milestone acceptance claimed.** R114, R115, and R116 now point at the S08 T03 fail-closed evidence rather than treating blocked/no-key output as success. This reconciliation uses the same bounded evidence fields recorded above: `delivery_id=none`, `review_output_key=none`, aggregate `status_code=m068_skipped_missing_review_output_key`, `review_details_count=0`, `candidatePublished=0`, `directFallback=0`, missing runtime publication gates, and `leak_marker_count=0`.

No public GitHub mutation was performed for this reconciliation. No exact-key verifier was run because S08 has no fresh live identifiers and no `m068_ok` result. R114 and final R116 acceptance remain blocked until a future eligible exact-key run on `xbmc/xbmc#28172` publishes exactly one Review Details artifact with candidate-approved publication evidence inside the visible-volume cap; R115 remains active as the constraint that fallback-only, no-artifact, and no-key outcomes cannot satisfy M068 success.

## S09 baseline reconciliation — 2026-05-10

Status: **S08 placeholder superseded for S09 planning; no milestone acceptance claimed.** The file `.gsd/milestones/M068/slices/S08/S08-SUMMARY.md` is a recovery placeholder, so S09 does not treat it as authoritative acceptance evidence. The bounded S08 smoke sections above remain the factual evidence source for readiness/blocker state until a future eligible exact-key run produces `status_code=m068_ok`.

No public GitHub mutation was performed for this reconciliation. No exact-key verifier was run because S09/T01 has no fresh delivery id and no fresh `reviewOutputKey`. No prompt contents, diff contents, candidate payloads, unrestricted logs, workspace paths, API response bodies, tokens, or secrets are recorded here.

### S09 baseline fields

| Field | Value |
|---|---|
| Reconciliation timestamp | `2026-05-10T06:41:30Z` |
| Source artifact status | S08 summary is a recovery placeholder and is not authoritative for acceptance |
| Authoritative bounded evidence | S08 smoke records plus this S09 baseline reconciliation section |
| Aggregate verifier command | `bun run verify:m068 --json` |
| Aggregate verifier exit code | `0` |
| Aggregate verifier duration | `250ms` |
| Aggregate verifier status_code | `m068_skipped_missing_review_output_key` |
| Aggregate failing check id | `none` |
| delivery_id | `none` |
| review_output_key | `none` |
| Exact-key verifier | skipped; no fresh live identifiers exist for S09/T01 |
| Review Details count | `0` |
| Candidate-approved publication count | `0` |
| Direct fallback count | `0` |
| Runtime gates | candidate publication missing; adapter publication missing; Review Details publication missing |
| leak_marker_count | `0` by scoped redaction scan in this task |
| Requirement-state decision | R114/R115/R116 remain active; S08/S09 no-key readiness/blocker evidence is not acceptance |
| Short reason code | `s09_s08_placeholder_superseded_no_key_readiness_only` |

Final S09 baseline interpretation: this reconciliation distinguishes readiness/blocker evidence from acceptance. S08's placeholder slice summary must not be used to complete M068, and the no-key aggregate verifier status remains fail-closed readiness evidence only until a future eligible live exact-key proof on `xbmc/xbmc#28172` records `m068_ok` with one Review Details artifact and candidate-approved publication evidence.

## S09 readiness refresh — 2026-05-10

Status: **No-go for immediate live trigger; wait for an eligible non-self new-head event.** A fresh read-only refresh confirmed `xbmc/xbmc#28172` is open, not draft, not merged, still on head SHA `6b33c9a972c192e5e14ae9546dbc11a55665ea52`, and already requesting `kodiai`. Azure Container Apps health/readiness and local no-key verifier checks are green, but current GitHub/config eligibility does not authorize T03 to mutate: same-head reviewer request is duplicate/noisy, `ready_for_review` is not a real transition, and `synchronize` is disabled because both remote configs lack nested `review.triggers.onSynchronize: true`.

No public GitHub mutation was performed for this readiness refresh. No delivery id or `reviewOutputKey` was created. No prompt contents, diff contents, complete candidate bodies, unrestricted logs, API response bodies, tokens, or secrets are recorded here.

### S09 readiness target and config fields

| Field | Value |
|---|---|
| Target | `xbmc/xbmc#28172` |
| Refresh timestamp | `2026-05-10T07:05:20Z` |
| PR state | `open` |
| Draft flag | `draft=false` |
| Merged | `merged=false` |
| Base branch | `master` |
| Base SHA | `9e53f2f4b8e95cb8cc086d4f3606ada677d362cf` |
| Head repository | `keithah/xbmc` |
| Head branch | `kodiai-review-validation-20260411` |
| Head SHA | `6b33c9a972c192e5e14ae9546dbc11a55665ea52` |
| PR author | `keithah` |
| Requested reviewers include `kodiai` | `true` |
| Requested reviewer count | `1` |
| Base `.kodiai.yml` | exists; nested `review.triggers.onSynchronize=true` absent |
| Head `.kodiai.yml` | exists; nested `review.triggers.onSynchronize=true` absent |
| Effective nested synchronize trigger | `false` |
| Trigger attempt performed | `no` |
| delivery_id | `none` |
| review_output_key | `none` |

### S09 readiness ACA and verifier fields

| Field | Value |
|---|---|
| Container app | `ca-kodiai` |
| Resource group | `rg-kodiai` |
| Azure revision query | `ok` |
| Active revision | `ca-kodiai--deploy-20260509-163641` |
| App URL | `https://ca-kodiai.agreeableisland-d347f806.eastus.azurecontainerapps.io` |
| `/healthz` | HTTP 200, `{"status":"ok"}` |
| `/readiness` | HTTP 200, `{"status":"ready"}` |
| Log Analytics availability | workspace list query ok; count `21` |
| Aggregate verifier command | `bun run verify:m068 --json` |
| Aggregate verifier exit code | `0` |
| Aggregate verifier duration | `245ms` |
| Aggregate verifier status_code | `m068_skipped_missing_review_output_key` |
| Aggregate failing check id | `none` |
| Aggregate leak marker count | `0` |
| Preflight verifier command | `bun run verify:m068 -- --preflight-only --json` |
| Preflight verifier exit code | `0` |
| Preflight verifier duration | `254ms` |
| Preflight verifier status_code | `m068_skipped_missing_review_output_key` |
| Preflight failing check id | `none` |
| Preflight leak marker count | `0` |

### S09 readiness go/no-go decision

| Gate | Decision | Bounded reason |
|---|---|---|
| Local verifier readiness | Go | Aggregate and preflight no-key verifier checks exit 0 with `leak_marker_count=0`. |
| ACA health readiness | Go | Revision query succeeds; `/healthz` and `/readiness` return HTTP 200. |
| Target PR state | Go | Target is open, not draft, not merged, and still matches `xbmc/xbmc#28172`. |
| Same-head reviewer request | No-go | `kodiai` is already requested, so repeating the request would be duplicate/noisy and not a fresh proof branch. |
| `ready_for_review` trigger | No-go | Target is already `draft=false`; no real draft-to-ready transition is available. |
| `synchronize` trigger | No-go | Base and head configs do not contain nested `review.triggers.onSynchronize: true`. |
| Final readiness decision | `no_go_wait_for_new_head` | T03 is not authorized to trigger now; it must wait for or consume exactly one eligible non-self new-head delivery, or keep the proof fail-closed. |

Final S09 readiness interpretation: deployed readiness and local verifier state are healthy, but current GitHub target eligibility remains blocked. The only permitted live proof branch is a future eligible non-self new-head trigger; no same-head, disabled-synchronize, self-authored, duplicate reviewer-request, or manual-publication path is authorized.

## S09 fail-closed exact-key proof outcome — 2026-05-10

Status: **Fail-closed blocked; no public GitHub mutation and no exact-key live verifier were run.** T02 recorded `no_go_wait_for_new_head`, so T03 stopped before any trigger, did not reuse stale S06/S08 identifiers, and did not attempt same-head reviewer requests, disabled `synchronize`, self-authored events, manual Review Details publication, or synthetic artifacts. This section is bounded blocker evidence only and is not `m068_ok` acceptance.

No prompt contents, diff contents, complete candidate bodies, unrestricted logs, API response bodies, tokens, or secrets are recorded here.

### S09 fail-closed proof fields

| Field | Value |
|---|---|
| Target | `xbmc/xbmc#28172` |
| Trigger attempt performed | `no` |
| Short failure reason | `no_go_wait_for_new_head` |
| delivery_id | `none` |
| review_output_key | `none` |
| Exact-key preflight | skipped; no fresh normal-handler live identifiers from S09/T02 |
| Exact-key full verifier | skipped; no fresh normal-handler live identifiers from S09/T02 |
| Aggregate verifier command | `bun run verify:m068 --json` |
| Aggregate verifier exit code | `0` |
| Aggregate verifier duration | `237ms` |
| Aggregate verifier status_code | `m068_skipped_missing_review_output_key` |
| Aggregate failing check id | `none` |
| Review Details count | `0` |
| review_details_count | `0` |
| Candidate inline count | `0` |
| candidate_inline_count | `0` |
| Candidate-approved published count | `0` |
| candidatePublished | `0` |
| Direct fallback count | `0` |
| directFallback | `0` |
| Runtime gates | candidate publication missing; adapter publication missing; Review Details publication missing |
| Visible-volume cap | not exercised; no exact-key artifacts collected |
| leak_marker_count | `0` by verifier/redaction gates and scoped forbidden-marker scan |
| Final classification | fail-closed blocked evidence; not `m068_ok` acceptance |

Final S09 fail-closed interpretation: M068 acceptance remains unavailable because the fresh exact-key proof inputs do not exist for S09. The no-key aggregate verifier is green with `status_code=m068_skipped_missing_review_output_key`, but the required live proof conditions are not met: there is no delivery id, no `reviewOutputKey`, no Review Details artifact, no candidate-approved publication, and no runtime publication completion gates. R114/R116 therefore remain active until a future eligible normal automatic delivery can produce exact-key `m068_ok` proof.

## S09 final requirement and validation reconciliation — 2026-05-10

Status: **Requirements finalized as active/blocked; milestone validation recorded as needing remediation; no M068 completion attempted.** T04 reran the targeted regression set and the aggregate verifier, then finalized the blocked branch because S09 still has no fresh normal-handler `delivery_id`, no fresh `review_output_key`, and no exact-key `status_code=m068_ok` acceptance result.

No public GitHub mutation was performed for this reconciliation. No exact-key verifier was run because T03 recorded no fresh live identifiers. No prompt contents, diff contents, complete candidate bodies, unrestricted logs, API response bodies, tokens, or secrets are recorded here.

### S09 final reconciliation fields

| Field | Value |
|---|---|
| Reconciliation timestamp | `2026-05-10T07:08:36Z` |
| Branch | blocked / fail-closed |
| Short failure reason | `no_go_wait_for_new_head` |
| Aggregate verifier command | `bun run verify:m068 --json` |
| Aggregate verifier exit code | `0` |
| Aggregate verifier status_code | `m068_skipped_missing_review_output_key` |
| delivery_id | `none` |
| review_output_key | `none` |
| Exact-key verifier | skipped; no fresh S09 live identifiers exist |
| Review Details count | `0` |
| Candidate-approved publication count | `0` |
| Direct fallback count | `0` |
| Runtime gates | candidate publication missing; adapter publication missing; Review Details publication missing |
| leak_marker_count | `0` by verifier and forbidden-marker scan |
| Requirement result | R114/R116 active/blocked; R115 active constraint advanced by fail-closed proof |
| Milestone validation result | `needs-remediation`; M068 completion not attempted |

Final T04 interpretation: S09 produced bounded blocker evidence, not final acceptance. The active requirements and milestone validation now distinguish the safe no-key/no-artifact branch from a future valid exact-key `m068_ok` proof on `xbmc/xbmc#28172` with exactly one Review Details artifact, candidate-approved publication, zero direct fallback, bounded visible volume, and clean redaction.

## S10 baseline readiness refresh — 2026-05-10

Status: **External blocker parked; no public mutation performed.** A fresh read-only S10/T01 refresh confirmed the target remains `xbmc/xbmc#28172`, open, not draft, not merged, on the same head SHA `6b33c9a972c192e5e14ae9546dbc11a55665ea52`, and already requesting `kodiai`. Azure Container Apps readiness is green and no-key verifier/preflight checks pass with clean redaction, but there is no fresh eligible non-self/new-head delivery plus `reviewOutputKey` pair to consume. This S10 section is readiness/blocker evidence only and is not `m068_ok` acceptance.

No public GitHub mutation was performed for this S10 baseline. Historical S06/S08/S09 identifiers were not reused as acceptance evidence. No prompt contents, diff contents, complete candidate bodies, unrestricted logs, API response bodies, tokens, or secrets are recorded here.

### S10 target eligibility and config fields

| Field | Value |
|---|---|
| Target | `xbmc/xbmc#28172` |
| Refresh window | `2026-05-10T19:02:27Z` → `2026-05-10T19:02:35Z` |
| PR state | `open` |
| Draft flag | `draft=false` |
| Merged | `merged=false` |
| Base branch | `master` |
| Head repository owner | `keithah` |
| Head branch | `kodiai-review-validation-20260411` |
| Head SHA | `6b33c9a972c192e5e14ae9546dbc11a55665ea52` |
| PR author | `keithah` |
| Requested reviewers include `kodiai` | `true` |
| Requested reviewer count | `1` |
| Base `.kodiai.yml` | exists; nested `review.triggers.onSynchronize=true` absent |
| Head `.kodiai.yml` | exists; nested `review.triggers.onSynchronize=true` absent |
| Effective nested synchronize trigger | `false` |
| Fresh eligible non-self/new-head delivery | `none detected` |
| Fresh reviewOutputKey for eligible delivery | `none` |
| Trigger attempt performed | `no` |
| delivery_id | `none` |
| review_output_key | `none` |

### S10 deployment and verifier readiness fields

| Field | Value |
|---|---|
| Container app | `ca-kodiai` |
| Resource group | `rg-kodiai` |
| Azure revision query | `ok` |
| Active revision | `ca-kodiai--deploy-20260509-163641` |
| Active revision traffic | `100%:Healthy` |
| App URL | `https://ca-kodiai.agreeableisland-d347f806.eastus.azurecontainerapps.io` |
| `/healthz` | HTTP 200, `{"status":"ok"}` |
| `/readiness` | HTTP 200, `{"status":"ready"}` |
| Aggregate verifier command | `bun run verify:m068 --json` |
| Aggregate verifier exit code | `0` |
| Aggregate verifier duration | `240ms` |
| Aggregate verifier status_code | `m068_skipped_missing_review_output_key` |
| Aggregate failing check id | `none` |
| Aggregate review_details_count | `0` |
| Aggregate candidate_inline_count | `0` |
| Aggregate candidate_published_count | `0` |
| Aggregate direct_fallback_count | `0` |
| Aggregate runtime matched rows | `0` |
| Aggregate runtime gates | candidate publication missing; adapter publication missing; Review Details publication missing |
| Aggregate leak_marker_count | `0` |
| Preflight verifier command | `bun run verify:m068 -- --preflight-only --json` |
| Preflight verifier exit code | `0` |
| Preflight verifier duration | `240ms` |
| Preflight verifier status_code | `m068_skipped_missing_review_output_key` |
| Preflight failing check id | `none` |
| Preflight review_details_count | `0` |
| Preflight candidate_inline_count | `0` |
| Preflight candidate_published_count | `0` |
| Preflight direct_fallback_count | `0` |
| Preflight runtime gates | skipped safely without live identifiers |
| Preflight leak_marker_count | `0` |
| public_mutation_performed | `0` (`public_mutation_performed=0`) |

### S10 branch decision

| Gate | Decision | Bounded reason |
|---|---|---|
| Local verifier readiness | Go | Aggregate and preflight no-key verifier checks exit 0 with `leak_marker_count=0`. |
| ACA health readiness | Go | Active revision has 100% healthy traffic; `/healthz` and `/readiness` return HTTP 200. |
| Target PR state | Go | Target is open, not draft, not merged, and still matches `xbmc/xbmc#28172`. |
| Same-head reviewer request | No-go | `kodiai` is already requested, so repeating the request would be duplicate/noisy and not a fresh eligible delivery. |
| `ready_for_review` trigger | No-go | Target is already `draft=false`; no real draft-to-ready transition is available. |
| `synchronize` trigger | No-go | Base and head configs do not contain nested `review.triggers.onSynchronize: true`. |
| Exact-key acceptance | No-go | No fresh eligible delivery id and no fresh `reviewOutputKey` exist for S10/T01. |
| Final branch | `branch_decision=park_external_blocker` | Park the external live-proof blocker until a future eligible non-self/new-head automatic delivery can be consumed. |

Final S10/T01 classification: readiness is healthy, but the exact-key proof inputs are absent. The no-key aggregate verifier is green with `status_code=m068_skipped_missing_review_output_key`, zero Review Details artifacts, zero candidate-approved publications, zero direct fallback, missing runtime publication gates, and `leak_marker_count=0`; this remains fail-closed blocker evidence rather than `m068_ok` acceptance.

## S10 exact-key proof branch outcome — 2026-05-10

Status: **External blocker parked; no public mutation and no exact-key live verifier were run.** T01 recorded `branch_decision=park_external_blocker`, with no fresh eligible non-self/new-head delivery id and no fresh `reviewOutputKey` for `xbmc/xbmc#28172`. T02 therefore preserved the fail-closed path: it did not reuse historical S06/S08/S09 identifiers, did not perform same-head reviewer-request, disabled `synchronize`, self-authored, manual Review Details, synthetic artifact, no-key, no-artifact, or fallback-only acceptance.

This section is bounded blocker evidence only and is not milestone acceptance. M068 remains incomplete until a future eligible automatic delivery can be consumed by exact key and produce `status_code=m068_ok` with one Review Details artifact, candidate-approved publication evidence inside the visible-volume cap, correlated runtime gates, zero direct fallback, and clean redaction.

No prompt contents, diff contents, complete candidate bodies, unrestricted logs, API response bodies, tokens, or secrets are recorded here.

### S10 parked branch verifier fields

| Field | Value |
|---|---|
| Target | `xbmc/xbmc#28172` |
| Branch decision source | `branch_decision=park_external_blocker` from S10/T01 |
| acceptance_classification | `parked_external_blocker_not_m068_ok` |
| reason | `parked_wait_for_external_non_self_new_head` |
| Short failure reason | `parked_wait_for_external_non_self_new_head` |
| Trigger attempt performed | `no` |
| public_mutation_performed | `0` (`public_mutation_performed=0`) |
| delivery_id | `none` (`delivery_id=none`) |
| review_output_key | `none` (`review_output_key=none`) |
| exact_key_verifier_run | `0` (`exact_key_verifier_run=0`) |
| Exact-key preflight | skipped; no fresh eligible delivery/key pair exists |
| Exact-key full verifier | skipped; no fresh eligible delivery/key pair exists |
| Aggregate verifier command | `bun run verify:m068 --json` |
| Aggregate verifier exit code | `0` |
| Aggregate verifier duration | `251ms` |
| Aggregate verifier status_code | `m068_skipped_missing_review_output_key` |
| Aggregate failing check id | `none` |
| Preflight verifier command | `bun run verify:m068 -- --preflight-only --json` |
| Preflight verifier exit code | `0` |
| Preflight verifier duration | `236ms` |
| Preflight verifier status_code | `m068_skipped_missing_review_output_key` |
| Preflight failing check id | `none` |
| Review Details artifact count | `0` |
| review_details_count | `0` |
| Candidate inline visible count | `0` |
| candidate_inline_count | `0` |
| Candidate inline cap result | not exercised; no exact-key artifacts collected |
| Candidate-approved publication count | `0` |
| candidatePublished | `0` |
| Direct fallback count | `0` (`directFallback=0`) |
| directFallback | `0` (`directFallback=0`) |
| Runtime gate presence | candidate publication missing; adapter publication missing; Review Details publication missing |
| Runtime matched row count | `0` |
| leak_marker_count | `0` |
| Final classification | parked external blocker; not `m068_ok` acceptance |

Final S10/T02 interpretation: the decisive S10 branch remains parked because the live exact-key proof inputs do not exist. The aggregate and no-key preflight verifiers exit 0 with `status_code=m068_skipped_missing_review_output_key` and `leak_marker_count=0`, but this is readiness/blocker evidence only: there is no delivery id, no `reviewOutputKey`, no Review Details artifact, no candidate-approved publication, and no runtime publication completion gates.

## S10 final requirement and validation reconciliation — 2026-05-10

Status: **Requirements and milestone validation reconciled as needs-remediation; no M068 completion attempted.** R114 and R116 remain active/blocked because S10/T02 parked the external dependency with `delivery_id=none`, `review_output_key=none`, `exact_key_verifier_run=0`, no Review Details artifact, no candidate-approved publication, and missing runtime publication gates. R115 remains active as the rejection constraint that parked/no-key/fallback-only/no-artifact/duplicate/self/disabled-trigger evidence cannot satisfy M068 success.

No public GitHub mutation was performed for this reconciliation. No exact-key verifier was run because S10 has no fresh eligible delivery/key pair and no `status_code=m068_ok` result. The milestone validation verdict is `needs-remediation`, with remediation deferred to a future eligible non-self/new-head automatic delivery for `xbmc/xbmc#28172` that can be verified by exact key.

## S10 closure verification — 2026-05-10

Status: **S10 complete on the parked external-blocker branch; M068 remains incomplete.** T04 reran the targeted regression tests and fresh no-key verifier checks after the S10 parked-branch and validation reconciliation. Because S10 still has no fresh eligible non-self/new-head delivery id and no correlated review output key for `xbmc/xbmc#28172`, no exact-key live verifier was run and no public GitHub mutation was performed.

This closure proves that parked/no-key evidence remains rejected as milestone acceptance: the aggregate and no-key preflight verifiers exit successfully only with `status_code=m068_skipped_missing_review_output_key`, zero Review Details artifacts, zero candidate-approved publication, zero direct fallback, missing runtime publication gates, and `leak_marker_count=0`. It does not prove `m068_ok`.

### S10 closure verification fields

| Field | Value |
|---|---|
| Target | `xbmc/xbmc#28172` |
| Final branch | `branch_decision=park_external_blocker` |
| acceptance_classification | `parked_external_blocker_not_m068_ok` |
| delivery_id | `none` (`delivery_id=none`) |
| review_output_key | `none` (`review_output_key=none`) |
| public_mutation_performed | `0` (`public_mutation_performed=0`) |
| exact_key_verifier_run | `0` (`exact_key_verifier_run=0`) |
| Targeted regression command | `bun test scripts/verify-m068.test.ts src/lib/review-utils.test.ts src/handlers/review.test.ts` |
| Targeted regression result | exit `0`; duration `8568ms` |
| Aggregate verifier command | `bun run verify:m068 --json` |
| Aggregate verifier result | exit `0`; `status_code=m068_skipped_missing_review_output_key`; duration `258ms` |
| Preflight verifier command | `bun run verify:m068 -- --preflight-only --json` |
| Preflight verifier result | exit `0`; `status_code=m068_skipped_missing_review_output_key`; duration `277ms` |
| Review Details artifact count | `0` |
| review_details_count | `0` |
| Candidate inline visible count | `0` |
| candidate_inline_count | `0` |
| Candidate-approved publication count | `0` |
| candidatePublished | `0` |
| Direct fallback count | `0` (`directFallback=0`) |
| directFallback | `0` (`directFallback=0`) |
| Runtime gate presence | candidate publication missing; adapter publication missing; Review Details publication missing |
| Redaction scan | passed for forbidden markers |
| leak_marker_count | `0` |
| Milestone completion | not attempted; parked evidence is not M068 acceptance |
| Final classification | S10 closure passed; M068 deferred pending future exact-key `m068_ok` proof |


## M068 live proof attempt — 2026-05-11

Status: **Failed closed after one authorized non-self `synchronize` trigger; no `m068_ok` success claimed.**

The 2026-05-11 attempt followed the runbook path after explicit approval for one outward-facing proof attempt. The operator deployed the M068-capable `refactor` worktree to ACA, verified health/readiness, then used the authenticated `keithah` GitHub actor to push exactly one public `.kodiai.yml` commit to `keithah/xbmc:kodiai-review-validation-20260411`. The commit added nested `review.triggers.onSynchronize: true`, produced a new head SHA, and emitted one `pull_request.synchronize` delivery.

The webhook reached the deployed handler and produced a review output key, Review Details output, and published review evidence. The full exact-key verifier still failed closed: the only exact-key Review Details artifact reported `mode=direct-fallback`, candidate-approved publication count was zero, direct fallback count was one, and runtime candidate/adapter publication gates were missing. This is not M068 acceptance.

### 2026-05-11 bounded evidence fields

| Field | Value |
|---|---|
| Target | `xbmc/xbmc#28172` |
| Trigger | non-self `pull_request.synchronize` via `.kodiai.yml` config commit |
| Trigger actor | `keithah` |
| Public mutation count | `1` |
| Head repository | `keithah/xbmc` |
| Head branch | `kodiai-review-validation-20260411` |
| New head SHA | `1972551b75bfcabecd45d61ae3a75223f9988865` |
| Active traffic revision | `ca-kodiai--deploy-20260510-210025` |
| App URL | `https://ca-kodiai.agreeableisland-d347f806.eastus.azurecontainerapps.io` |
| `/healthz` | HTTP 200, `{"status":"ok"}` |
| `/readiness` | HTTP 200, `{"status":"ready"}` |
| Delivery id | `3a63ea30-4cee-11f1-951a-db5e2665bb61` |
| Review output key | `kodiai-review-output:v1:inst-109141824:xbmc/xbmc:pr-28172:action-synchronize:delivery-3a63ea30-4cee-11f1-951a-db5e2665bb61:head-1972551b75bfcabecd45d61ae3a75223f9988865` |
| Preflight verifier command | `bun run verify:m068 -- --preflight-only --json --repo xbmc/xbmc --review-output-key "$LIVE_KEY" --delivery-id "$LIVE_DELIVERY"` |
| Preflight verifier result | exit `0`; `status_code=m068_pending_live_evidence`; exact target accepted |
| Full verifier command | `bun run verify:m068 -- --json --repo xbmc/xbmc --review-output-key "$LIVE_KEY" --delivery-id "$LIVE_DELIVERY"` |
| Full verifier result | exit `1`; `status_code=m068_contract_failed` |
| Failing check id | `M068-REDUCER-ADAPTER-PUBLICATION-STATE` |
| Review Details artifact count | `1` |
| review_details_count | `1` |
| Review Details mode | `direct-fallback` |
| Candidate inline visible count | `0` |
| candidate_inline_count | `0` |
| Candidate-approved publication count | `0` |
| candidatePublished | `0` |
| Direct fallback count | `1` (`directFallback=1`) |
| Runtime matched row count | `11` |
| Runtime gates | candidate publication missing; adapter publication missing; Review Details publication present |
| Runtime direct fallback count | `0` |
| Visible volume | `candidateInline=0`, cap `3`, reviewDetails `1`, other `0` |
| Redaction | `leak_marker_count=0` |
| Final classification | fail-closed direct-fallback evidence; not `m068_ok` acceptance |

### 2026-05-11 local/deploy gates

| Command or check | Result |
|---|---|
| `bun test scripts/verify-m068.test.ts scripts/verify-m067-s05.test.ts` | exit `0`; 41 tests passed |
| `bun test src/execution/mcp/candidate-finding-server.test.ts src/execution/review-prompt.test.ts` | exit `0`; 241 tests passed |
| `bun run verify:m068 --json` | exit `0`; `status_code=m068_skipped_missing_review_output_key` before live key existed |
| `bun run verify:m068 -- --preflight-only --json` | exit `0`; `status_code=m068_skipped_missing_review_output_key` before live key existed |
| `bun run verify:m068:s01 --json` | exit `0`; `status_code=m068_s01_ok` |
| `bun run verify:m068:s02 --json` | exit `0`; `status_code=m068_s02_ok` |
| `bun run verify:m068:s03 --json` | exit `0`; `status_code=m068_s03_ok` |
| `bun run lint` | exit `0` |
| `./deploy.sh` | exit `0`; active traffic revision `ca-kodiai--deploy-20260510-210025` |
| Health/readiness | `/healthz` HTTP 200; `/readiness` HTTP 200 |

### 2026-05-11 interpretation

The proof successfully exercised an eligible non-self/new-head `synchronize` path and avoided the previous `bot-filter` self-event blocker. The remaining blocker is semantic publication mode: the live run published Review Details through the direct-fallback path rather than candidate-approved publication. R114/R116 remain active/blocked, and M068 must not be completed from this evidence.
