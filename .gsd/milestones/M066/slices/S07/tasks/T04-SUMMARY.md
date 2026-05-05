---
id: T04
parent: S07
milestone: M066
key_files:
  - docs/smoke/m066-formatter-suggestions.md
key_decisions:
  - Treat the Azure CLI connection reset during ACA job secret-reference update as a transient deploy failure and retry the documented idempotent deploy command rather than marking deployment unavailable.
duration: 
verification_result: mixed
completed_at: 2026-05-05T05:27:21.204Z
blocker_discovered: false
---

# T04: Deployed the formatter-routing fix to ACA revision ca-kodiai--deploy-20260504-222417 and recorded health/readiness proof.

**Deployed the formatter-routing fix to ACA revision ca-kodiai--deploy-20260504-222417 and recorded health/readiness proof.**

## What Happened

Deployed the runtime used by GitHub webhooks through the documented `./deploy.sh` Azure Container Apps path. The first deploy attempt built app image `ca82` and agent image `ca83`, then failed before the app revision update while pointing ACA Job secrets at Azure Key Vault due to an Azure CLI `Connection reset by peer`. Because the deployment guide documents `deploy.sh` as idempotent, retried the same command once; the retry built app image `ca84`, agent image `ca85`, updated the existing container app with revision suffix `deploy-20260504-222417`, and completed successfully. Independently verified the active traffic revision as `ca-kodiai--deploy-20260504-222417` and confirmed `/healthz` returned HTTP 200 with `{"status":"ok","db":"connected"}` while `/readiness` returned HTTP 200 with `{"status":"ready"}`. Updated `docs/smoke/m066-formatter-suggestions.md` with bounded non-secret deployment evidence and pointed T05 at the fresh revision without claiming accepted same-PR formatter proof.

## Verification

Ran the documented deploy command and retried once after a transient Azure CLI connection reset. Verified active ACA traffic revision with `az containerapp revision list`, fetched the app FQDN with `az containerapp show`, and checked both `/healthz` and `/readiness` with `curl`. After the final smoke-artifact edits, reran the same revision/probe check and asserted that the smoke artifact contains the new revision, T5 retry guidance, and HTTP 200 health/readiness proof markers. Slice-level verification for T04 is satisfied for deployment anchoring; accepted same-PR formatter-suggestion GitHub proof remains intentionally pending for T05.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `memory_query formatter routing deploy healthz readiness` | 1 | ❌ fail | 0ms |
| 2 | `./deploy.sh (first attempt)` | 1 | ❌ fail | 217900ms |
| 3 | `./deploy.sh (retry)` | 0 | ✅ pass | 283300ms |
| 4 | `az containerapp revision list + az containerapp show + curl /healthz + curl /readiness` | 0 | ✅ pass | 10073ms |
| 5 | `final post-edit revision/probe check plus docs/smoke/m066-formatter-suggestions.md marker assertions` | 0 | ✅ pass | 8836ms |
| 6 | `capture_thought deploy gotcha` | 1 | ❌ fail | 0ms |

## Deviations

The first deploy attempt failed at an Azure CLI network boundary before app revision update; a same-command retry was used because the documented deploy script is idempotent.

## Known Issues

The local GSD memory database remains unavailable: `memory_query` failed with `database disk image is malformed`, and `capture_thought` failed to create a memory. Accepted `m066_s05_ok` formatter proof is not part of T04 and remains pending T05.

## Files Created/Modified

- `docs/smoke/m066-formatter-suggestions.md`
