# M067 Review Orchestration Smoke Proof

Status: **Blocked after live trigger; remediation is fail-closed rescope/no-retry.** The current code was deployed to Azure Container Apps and two bounded automatic trigger paths were exercised against `xbmc/xbmc#28172`. The preferred `review_requested` trigger was accepted for reviewer `kodiai`; the fallback `synchronize` trigger produced a correlated `deliveryId` and `reviewOutputKey`, but the keyed verifier failed because the runtime skipped review publication for this PR configuration. S06/T03 re-ran the exact-key publication-readiness gate and the read-only full verifier; both still report `review_details_not_published` with exact-key visible artifact counts of zero. No additional GitHub write, reviewer request, synchronize fallback, or other live trigger is safe while this exact key remains blocked. No secret values, raw prompts, raw diffs, full candidate payloads, full logs, or unbounded PR/comment bodies are recorded here.

## Proof target

| Field | Value |
|---|---|
| Repository | `xbmc/xbmc` |
| PR URL | `https://github.com/xbmc/xbmc/pull/28172` |
| PR number | `28172` |
| PR state | `open` |
| PR draft status | `true` |
| Head repository | `keithah/xbmc` |
| Head branch | `kodiai-review-validation-20260411` |
| Original head SHA before fallback | `52d827c5fd643493c7bb94aa20516a8b179fdf7a` |
| Fallback head SHA | `6b33c9a972c192e5e14ae9546dbc11a55665ea52` |

## Deployment proof

| Field | Value |
|---|---|
| Deploy command | `./deploy.sh` |
| Deploy result | `succeeded` |
| Resource group | `rg-kodiai` |
| Container app | `ca-kodiai` |
| Active revision | `ca-kodiai--deploy-20260509-120809` |
| App image | `kodiairegistry.azurecr.io/kodiai@sha256:f183947bad9dc758e60ae245d8776d141fd7eff5c389c4b87a8b2528716ad701` |
| App URL | `https://ca-kodiai.agreeableisland-d347f806.eastus.azurecontainerapps.io` |
| Health URL | `https://ca-kodiai.agreeableisland-d347f806.eastus.azurecontainerapps.io/healthz` |
| `/healthz` result | HTTP 200, `{"status":"ok"}` |
| Readiness URL | `https://ca-kodiai.agreeableisland-d347f806.eastus.azurecontainerapps.io/readiness` |
| `/readiness` result | HTTP 200, `{"status":"ready"}` |

## Trigger attempts

### Preferred trigger: request Kodiai reviewer

| Field | Value |
|---|---|
| Trigger method | `POST /repos/xbmc/xbmc/pulls/28172/requested_reviewers` |
| Requested reviewer | `kodiai` |
| Attempt time | `2026-05-09T19:09:11Z` → `2026-05-09T19:09:12Z` |
| GitHub API result | `accepted` |
| PR requested reviewers after attempt | `kodiai` |
| Runtime delivery id | `909c1d60-4bda-11f1-9a96-8b4004a29a5e` |
| Runtime interpretation | `Accepted review_requested event for kodiai reviewer`; `Reviewing draft PR with draft tone`; then `Skipping review: run state indicates duplicate or already processed` |
| reviewOutputKey | `not emitted for this trigger` |

### Fallback trigger: synchronize with empty commit

| Field | Value |
|---|---|
| Trigger method | GitHub API empty commit on `keithah/xbmc:kodiai-review-validation-20260411` |
| GitHub write log note | `slog` was unavailable in this shell (`command not found`), so the write was recorded here as `action=push-empty-commit`, `tool=github-api`, `reason=m067-s05-synchronize-fallback` |
| Attempt time | `2026-05-09T19:11:44Z` → `2026-05-09T19:11:46Z` |
| Base SHA | `52d827c5fd643493c7bb94aa20516a8b179fdf7a` |
| New SHA | `6b33c9a972c192e5e14ae9546dbc11a55665ea52` |
| Runtime delivery id | `edb93e10-4bda-11f1-897d-5bcecb98ab89` |
| Runtime action | `synchronize` |
| Runtime event | `pull_request` |
| reviewOutputKey | `kodiai-review-output:v1:inst-109141824:xbmc/xbmc:pr-28172:action-synchronize:delivery-edb93e10-4bda-11f1-897d-5bcecb98ab89:head-6b33c9a972c192e5e14ae9546dbc11a55665ea52` |
| Runtime skip marker | `Review trigger disabled in config, skipping` |
| Phase timing summary | present, correlated by `deliveryId` and `reviewOutputKey`, but missing `conclusion` and `published` fields |

## S06 root-cause diagnosis

S06/T01 ran read-only GitHub configuration checks against the exact S05 target. `xbmc/xbmc#28172` is still open and draft, with base `xbmc/xbmc:master`, fork head `keithah/xbmc:kodiai-review-validation-20260411`, and head SHA `6b33c9a972c192e5e14ae9546dbc11a55665ea52`. Both checked repository paths returned `404 Not Found` for `.kodiai.yml`: the base repo branch and the fork head branch do not expose a Kodiai config file for this PR checkout.

The runtime code loads `.kodiai.yml` from the prepared workspace and falls back to defaults when the file is absent. Those defaults enable `opened`, `ready_for_review`, and `review_requested`, but keep `review.triggers.onSynchronize` disabled. The legacy `review.onSynchronize` field is ignored if present; only nested `review.triggers.onSynchronize: true` enables `pull_request.synchronize`. Therefore the S05 `Review trigger disabled in config, skipping` marker is explained by target repo configuration plus verifier target choice: the synchronize fallback key is structurally valid, but publication is not expected for this target without an explicit nested synchronize trigger.

Decision for S06 remediation: do not repeat a synchronize fallback or other GitHub write for `xbmc/xbmc#28172` while this target has no `.kodiai.yml` enabling synchronize. The safe path is either a valid automatic proof target whose checked-out repo config enables the needed trigger, a valid `review_requested` automatic-handler key with green publication readiness, or an explicit blocked/rescope artifact. A runtime code change is not indicated by this evidence.

## S06/T03 final gated proof result

T03 used the captured automatic `synchronize` key and delivery id as the only candidate for a gated retry decision. The key parses to `repo=xbmc/xbmc`, `pr=28172`, `action=synchronize`, and `deliveryId=edb93e10-4bda-11f1-897d-5bcecb98ab89`; it is not a `mention-review` key.

Preflight command:

```sh
bun run verify:m067:s05 -- --repo xbmc/xbmc --review-output-key "kodiai-review-output:v1:inst-109141824:xbmc/xbmc:pr-28172:action-synchronize:delivery-edb93e10-4bda-11f1-897d-5bcecb98ab89:head-6b33c9a972c192e5e14ae9546dbc11a55665ea52" --delivery-id "edb93e10-4bda-11f1-897d-5bcecb98ab89" --preflight-only --json
```

| Field | Value |
|---|---|
| Exit code | `1` |
| Duration | `2425ms` |
| Status code | `m067_s05_contract_failed` |
| Failing check id | `M067-S05-PUBLICATION-READINESS` |
| Publication status | `review_details_not_published` |
| GitHub access | `available` |
| Azure access in preflight | `missing` (not queried by `--preflight-only`) |
| GitHub artifact counts | `reviewComments=0`, `issueComments=0`, `reviews=0`, `total=0` |
| Bounded issue | `Review Details artifact was not published for the normalized reviewOutputKey.` |

Because the publication-readiness gate is not green, T03 stopped before any additional reviewer request, synchronize fallback, push, or other GitHub write. This means the final R099 production proof is still blocked by publication readiness for the exact automatic-handler key, and R099 is **not** claimed. R100 visible-volume safety remains preserved because the gate prevented new visible GitHub output and exact-key artifact counts stayed at zero.

Read-only full exact-key verifier command:

```sh
bun run verify:m067:s05 -- --repo xbmc/xbmc --review-output-key "kodiai-review-output:v1:inst-109141824:xbmc/xbmc:pr-28172:action-synchronize:delivery-edb93e10-4bda-11f1-897d-5bcecb98ab89:head-6b33c9a972c192e5e14ae9546dbc11a55665ea52" --delivery-id "edb93e10-4bda-11f1-897d-5bcecb98ab89" --json
```

| Field | Value |
|---|---|
| Exit code | `1` |
| Duration | `9697ms` |
| Status code | `m067_s05_contract_failed` |
| Failing check id | `M067-S05-PUBLICATION-READINESS` |
| Publication status | `review_details_not_published` |
| Matched runtime row count | `1` |
| GitHub artifact counts | `reviewComments=0`, `issueComments=0`, `reviews=0`, `total=0` |
| Runtime signals | `reviewPlanReady=false`, `reviewReducerReady=false`, `candidateExecutorMetadata=false`, `reviewDetailsPublication=false`, `phaseTimingSummary=false` |
| Bounded issue | `Review Details artifact was not published for the normalized reviewOutputKey.` |

## T03 local regression closure

| Command | Exit Code | Duration | Verdict |
|---|---:|---:|---|
| `bun run verify:m067:s01` | 0 | 47ms | ✅ pass |
| `bun run verify:m067:s02` | 0 | 79ms | ✅ pass |
| `bun run verify:m067:s03` | 0 | 164ms | ✅ pass |
| `bun run verify:m067:s04` | 0 | 118ms | ✅ pass |
| `bun run tsc --noEmit` | 0 | 9503ms | ✅ pass |
| `bun run verify:m067:s05 -- --repo xbmc/xbmc --review-output-key "<captured synchronize key>" --delivery-id "edb93e10-4bda-11f1-897d-5bcecb98ab89" --preflight-only --json` | 1 | 2425ms | ✅ pass — expected fail-closed readiness blocker, no retry allowed |
| `bun run verify:m067:s05 -- --repo xbmc/xbmc --review-output-key "<captured synchronize key>" --delivery-id "edb93e10-4bda-11f1-897d-5bcecb98ab89" --json` | 1 | 9697ms | ✅ pass — expected blocked exact-key proof, not a green R099 acceptance proof |

Final interpretation: R099 remains blocked because the exact automatic-handler key still has no Review Details artifact and publication readiness is `review_details_not_published`. R100 visible-volume safety was re-proven for the gated retry decision: no additional GitHub write was performed, and exact-key visible artifact counts remain `reviewComments=0`, `issueComments=0`, `reviews=0`, `total=0`. This task closes the bounded no-retry evidence and local regression evidence, but it does not provide a final live R099 acceptance proof until production publication readiness becomes green for an allowed automatic-handler key or the requirement is explicitly rescoped for milestone completion.

## Redaction notes

- Secret values were not printed or stored.
- Raw prompts, raw diffs, full candidate payloads, full logs, and unbounded PR/comment bodies are not included.
- Runtime evidence is limited to bounded status fields, delivery ids, reviewOutputKey, revision names, counts, and stable verifier check identifiers.
