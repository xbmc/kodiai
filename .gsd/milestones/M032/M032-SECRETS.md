# Secrets Manifest

**Milestone:** M032 — Agent Process Isolation — Ephemeral ACA Job Sandbox
**Generated:** 

### AZURE_SUBSCRIPTION_ID

**Service:** 
**Status:** collected
**Destination:** dotenv

1. Navigate to https://portal.azure.com/#view/Microsoft_Azure_Billing/SubscriptionsBlade
2. Click on your subscription (e.g., "Visual Studio Enterprise")
3. Copy the **Subscription ID** value from the overview page

### AZURE_RESOURCE_GROUP

**Service:** 
**Status:** collected
**Destination:** dotenv

1. Navigate to https://portal.azure.com/#browse/resourcegroups
2. Identify the resource group containing the `ca-kodiai` container app
3. Copy the exact resource group name

### ACA_ENVIRONMENT_NAME

**Service:** 
**Status:** skipped
**Destination:** dotenv

1. Navigate to https://portal.azure.com/#browse/Microsoft.App%2FmanagedEnvironments
2. Click on your Container Apps environment
3. Copy the resource name (not the display name)

### ACA_JOB_NAME

**Service:** 
**Status:** skipped
**Destination:** dotenv

1. Run `deploy.sh` once — it creates the job resource and prints the name
2. Or navigate to https://portal.azure.com/#browse/Microsoft.App%2Fjobs and copy the job resource name after creation

### AZURE_FILES_STORAGE_ACCOUNT

**Service:** 
**Status:** skipped
**Destination:** dotenv

1. Run `deploy.sh` — it creates the storage account and prints the name
2. Or navigate to https://portal.azure.com/#browse/Microsoft.Storage%2FStorageAccounts and copy the name after creation

### MCP_INTERNAL_BASE_URL

**Service:** 
**Status:** skipped
**Destination:** dotenv

1. Navigate to https://portal.azure.com → Container Apps → `ca-kodiai` → Ingress
2. Enable internal ingress if not already enabled (in addition to or instead of external)
3. Copy the internal FQDN shown under "Internal ingress"
4. Or run: `az containerapp show --name ca-kodiai --resource-group <rg> --query "properties.configuration.ingress.fqdn" -o tsv`
