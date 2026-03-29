# S01: ACA Job + Azure Files Infrastructure

**Goal:** Define the ACA Job launcher module (job spec builder, dispatch via az CLI, poll, result reader) and Azure Files workspace path support. Prove the contract: the job spec env array never contains application secret key names. Provide deploy.sh additions to provision the required Azure infrastructure (Storage account, Azure Files share, ACA environment mount, ACA Job definition) and a smoke-test script that exercises the contract.
**Demo:** After this: After S01: bun run scripts/test-aca-job.ts → ACA Job spawns, runs trivial script, writes result.json, orchestrator reads it back → cold start timing printed → contract check: job spec object has no application secret key names anywhere in its env array.

## Tasks
- [x] **T01: Add ACA Job launcher module (spec builder, dispatch, poll, result reader) with APPLICATION_SECRET_NAMES security contract; 16/16 tests pass** — Create `src/jobs/aca-launcher.ts` with the ACA Job infrastructure layer. This is the core security contract: `buildAcaJobSpec` must never put application secrets in the job's env array.

**Steps:**
1. Define `AcaJobEnvVar` and `AcaJobSpec` types in the module.
2. Export `APPLICATION_SECRET_NAMES: readonly string[]` — copy the same list from `src/execution/env.test.ts` (GITHUB_PRIVATE_KEY, GITHUB_PRIVATE_KEY_BASE64, GITHUB_APP_ID, GITHUB_WEBHOOK_SECRET, DATABASE_URL, SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, VOYAGE_API_KEY, BOT_USER_PAT). This list is the contract artifact.
3. Implement `buildAcaJobSpec(opts: { jobName: string; image: string; workspaceDir: string; anthropicApiKey?: string; mcpBearerToken: string; githubInstallationToken?: string; timeoutSeconds?: number; }): AcaJobSpec` — builds the spec with env array containing only: ANTHROPIC_API_KEY (if provided), MCP_BEARER_TOKEN, WORKSPACE_DIR, GITHUB_INSTALLATION_TOKEN (if provided). Validate at runtime that no APPLICATION_SECRET_NAMES appear in env names; throw if any do.
4. Implement `launchAcaJob(opts: { resourceGroup: string; jobName: string; spec: AcaJobSpec; logger?: Logger; }): Promise<{ executionName: string }>` — uses Bun `$` to run `az containerapp job execution start` with JSON env overrides. Log dispatch at info.
5. Implement `pollUntilComplete(opts: { resourceGroup: string; jobName: string; executionName: string; timeoutMs: number; pollIntervalMs?: number; logger?: Logger; }): Promise<{ status: 'succeeded' | 'failed' | 'timed-out'; durationMs: number }>` — polls `az containerapp job execution show` every 10s by default, respects timeout.
6. Implement `readJobResult(workspaceDir: string): Promise<unknown>` — reads and JSON-parses `{workspaceDir}/result.json`.
7. In `src/jobs/workspace.ts`, add exported `createAzureFilesWorkspaceDir(opts: { mountBase: string; jobId: string; }): Promise<string>` — creates `{mountBase}/{jobId}` directory and returns its path. No other changes to workspace.ts.
8. Write `src/jobs/aca-launcher.test.ts` with:
   - `buildAcaJobSpec: no APPLICATION_SECRET_NAMES in env array` — iterates APPLICATION_SECRET_NAMES, asserts none appear as env var names in a freshly built spec
   - `buildAcaJobSpec: required env keys present` — asserts MCP_BEARER_TOKEN and WORKSPACE_DIR are in the env array
   - `buildAcaJobSpec: throws if APPLICATION_SECRET_NAMES passed via opts` — pass a spec-building option that somehow injects a secret name and verify the runtime guard throws
   - `readJobResult: reads and parses result.json` — write a real temp file, call readJobResult, assert parsed value
  - Estimate: 2h
  - Files: src/jobs/aca-launcher.ts, src/jobs/aca-launcher.test.ts, src/jobs/workspace.ts
  - Verify: bun test ./src/jobs/aca-launcher.test.ts
- [ ] **T02: test-aca-job.ts script + deploy.sh Azure infrastructure additions** — Create `scripts/test-aca-job.ts` and add the Azure infrastructure provisioning steps to `deploy.sh`.

**test-aca-job.ts steps:**
1. Import `buildAcaJobSpec`, `APPLICATION_SECRET_NAMES`, `launchAcaJob`, `pollUntilComplete`, `readJobResult` from `../src/jobs/aca-launcher.ts`.
2. **Pure-code contract check (always runs):** Call `buildAcaJobSpec` with test inputs (image: `kodiairegistry.azurecr.io/kodiai:latest`, workspaceDir: `/mnt/kodiai-workspaces/test-job`, mcpBearerToken: `test-token`). Iterate over all env entries in the resulting spec. Assert that none of the env var names appear in `APPLICATION_SECRET_NAMES`. Print `✅ CONTRACT: no application secrets in job spec env array` on pass, `❌ CONTRACT FAILED: <name> found in env array` on fail. Exit 1 if failed.
3. **Live mode (`--live` flag):** Read required env vars (`RESOURCE_GROUP`, `ACA_JOB_NAME`, `AZURE_WORKSPACE_MOUNT`) — skip live test with a clear message if any are absent. If present: dispatch a real job via `launchAcaJob`, poll until complete via `pollUntilComplete(timeoutMs: 120_000)`, read result.json via `readJobResult`. Print cold start timing in ms. Exit 1 if job failed or timed out.
4. Exit 0 when the pure-code check passes (regardless of live mode skip/pass).

**deploy.sh additions:**
Insert a new section after the ACR build and before the Container Apps Environment section:
```
# -- Azure Storage Account (for Azure Files workspace share) --------------------
STORAGE_ACCOUNT_NAME="kodiaistg"   # globally unique, lowercase alphanumeric
FILE_SHARE_NAME="workspaces"

if ! az storage account show --name "$STORAGE_ACCOUNT_NAME" --resource-group "$RESOURCE_GROUP" --output none 2>/dev/null; then
  az storage account create --name "$STORAGE_ACCOUNT_NAME" --resource-group "$RESOURCE_GROUP" --location "$LOCATION" --sku Standard_LRS --kind StorageV2 --output none
fi
STORAGE_KEY=$(az storage account keys list --account-name "$STORAGE_ACCOUNT_NAME" --resource-group "$RESOURCE_GROUP" --query '[0].value' --output tsv)
if ! az storage share exists --name "$FILE_SHARE_NAME" --account-name "$STORAGE_ACCOUNT_NAME" --account-key "$STORAGE_KEY" --query exists --output tsv | grep -q true 2>/dev/null; then
  az storage share create --name "$FILE_SHARE_NAME" --account-name "$STORAGE_ACCOUNT_NAME" --account-key "$STORAGE_KEY" --output none
fi
```
After the Container Apps Environment creation, add:
```
# -- Storage mount on ACA environment -----------------------------------------
az containerapp env storage set --name "$ENVIRONMENT" --resource-group "$RESOURCE_GROUP" \
  --storage-name kodiai-workspaces \
  --azure-file-account-name "$STORAGE_ACCOUNT_NAME" \
  --azure-file-account-key "$STORAGE_KEY" \
  --azure-file-share-name "$FILE_SHARE_NAME" \
  --access-mode ReadWrite --output none 2>/dev/null || true

# -- Build agent image ---------------------------------------------------------
az acr build --registry "$ACR_NAME" --image kodiai-agent:latest .

# -- ACA Job (agent runner) ----------------------------------------------------
ACA_JOB_NAME="caj-kodiai-agent"
if az containerapp job show --name "$ACA_JOB_NAME" --resource-group "$RESOURCE_GROUP" --output none 2>/dev/null; then
  az containerapp job update --name "$ACA_JOB_NAME" --resource-group "$RESOURCE_GROUP" \
    --image "$ACR_NAME.azurecr.io/kodiai-agent:latest" --output none
else
  az containerapp job create --name "$ACA_JOB_NAME" --resource-group "$RESOURCE_GROUP" \
    --environment "$ENVIRONMENT" --trigger-type Manual \
    --replica-timeout 600 --replica-retry-limit 0 \
    --image "$ACR_NAME.azurecr.io/kodiai-agent:latest" \
    --user-assigned "$IDENTITY_RESOURCE_ID" \
    --registry-server "$ACR_NAME.azurecr.io" --registry-identity "$IDENTITY_RESOURCE_ID" \
    --volume-mount-path /mnt/kodiai-workspaces \
    --output none
fi
```
Add also the volume-mount-path configuration to the orchestrator container app update section (add `--volume` flag pointing at the same Azure Files share).
  - Estimate: 1.5h
  - Files: scripts/test-aca-job.ts, deploy.sh
  - Verify: bun run scripts/test-aca-job.ts
