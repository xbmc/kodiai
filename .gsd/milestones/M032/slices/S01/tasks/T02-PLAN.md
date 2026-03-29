---
estimated_steps: 48
estimated_files: 2
skills_used: []
---

# T02: test-aca-job.ts script + deploy.sh Azure infrastructure additions

Create `scripts/test-aca-job.ts` and add the Azure infrastructure provisioning steps to `deploy.sh`.

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

## Inputs

- `src/jobs/aca-launcher.ts`
- `deploy.sh`
- `scripts/verify-m031.ts`

## Expected Output

- `scripts/test-aca-job.ts`
- `deploy.sh`

## Verification

bun run scripts/test-aca-job.ts

## Observability Impact

test-aca-job.ts prints cold start timing (durationMs) and explicit pass/fail for the contract check. In --live mode, executionName is printed for Azure portal audit trail lookup.
