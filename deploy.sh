#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# kodiai -- Azure Container Apps Deployment Script
#
# This script provisions all Azure resources and deploys the kodiai container.
# It is idempotent: safe to re-run (existing resources are updated in place).
#
# Prerequisites:
#   - Azure CLI installed and logged in (az login)
#   - Docker is NOT required (ACR builds the image remotely)
#
# Required environment variables:
#   GITHUB_APP_ID              - GitHub App ID from the app settings page
#   GITHUB_PRIVATE_KEY_BASE64  - Base64-encoded PEM private key
#                                Generate with: base64 -w0 < private-key.pem
#   GITHUB_WEBHOOK_SECRET      - Webhook secret configured in the GitHub App
#   CLAUDE_CODE_OAUTH_TOKEN    - OAuth token from `claude setup-token`
#   VOYAGE_API_KEY             - VoyageAI API key for embeddings
#   SLACK_BOT_TOKEN            - Slack bot OAuth token
#   SLACK_SIGNING_SECRET       - Slack app signing secret
#   SLACK_BOT_USER_ID          - Slack bot user ID
#   SLACK_KODIAI_CHANNEL_ID    - Slack channel ID for #kodiai
#
# The app's loadPrivateKey() handles base64 decoding automatically, so we
# pass the base64-encoded value straight through as GITHUB_PRIVATE_KEY.
###############################################################################

# -- Load .env (optional) ------------------------------------------------------
# If you prefer not to export variables in your shell, create a local `.env`
# file and run `./deploy.sh`. This script will source it automatically.
ENV_FILE=${ENV_FILE:-.env}
if [[ -f "$ENV_FILE" ]]; then
  # Export all variables defined in the file.
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

# -- Configuration (customize as needed) --------------------------------------
RESOURCE_GROUP="rg-kodiai"
LOCATION="eastus"
ENVIRONMENT="cae-kodiai"
APP_NAME="ca-kodiai"
ACR_NAME="kodiairegistry"          # Must be globally unique, alphanumeric only
IDENTITY_NAME="id-kodiai"

# -- Validate required environment variables ----------------------------------
missing=()
[[ -z "${GITHUB_APP_ID:-}" ]]             && missing+=("GITHUB_APP_ID")
[[ -z "${GITHUB_PRIVATE_KEY_BASE64:-}" ]] && missing+=("GITHUB_PRIVATE_KEY_BASE64")
[[ -z "${GITHUB_WEBHOOK_SECRET:-}" ]]     && missing+=("GITHUB_WEBHOOK_SECRET")
[[ -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]]   && missing+=("CLAUDE_CODE_OAUTH_TOKEN")
[[ -z "${VOYAGE_API_KEY:-}" ]]            && missing+=("VOYAGE_API_KEY")
[[ -z "${SLACK_BOT_TOKEN:-}" ]]           && missing+=("SLACK_BOT_TOKEN")
[[ -z "${SLACK_SIGNING_SECRET:-}" ]]      && missing+=("SLACK_SIGNING_SECRET")
[[ -z "${SLACK_BOT_USER_ID:-}" ]]         && missing+=("SLACK_BOT_USER_ID")
[[ -z "${SLACK_KODIAI_CHANNEL_ID:-}" ]]   && missing+=("SLACK_KODIAI_CHANNEL_ID")
[[ -z "${DATABASE_URL:-}" ]]              && missing+=("DATABASE_URL")

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "ERROR: The following environment variables are required but not set:"
  for var in "${missing[@]}"; do
    echo "  - $var"
  done
  echo ""
  echo "Hint: base64-encode your PEM key with:  base64 -w0 < private-key.pem"
  exit 1
fi

# -- Optional environment variables with defaults --------------------------------
SHUTDOWN_GRACE_MS=${SHUTDOWN_GRACE_MS:-300000}

echo "==> Installing / upgrading Azure CLI extensions..."
if ! az extension show --name containerapp >/dev/null 2>&1; then
  az extension add --name containerapp --upgrade -y 2>/dev/null
fi

echo "==> Registering resource providers (may take a minute on first run)..."
APP_PROVIDER_STATE=$(az provider show --namespace Microsoft.App --query registrationState --output tsv 2>/dev/null || true)
if [[ "$APP_PROVIDER_STATE" != "Registered" ]]; then
  az provider register --namespace Microsoft.App --wait
fi

OPS_PROVIDER_STATE=$(az provider show --namespace Microsoft.OperationalInsights --query registrationState --output tsv 2>/dev/null || true)
if [[ "$OPS_PROVIDER_STATE" != "Registered" ]]; then
  az provider register --namespace Microsoft.OperationalInsights --wait
fi

# -- Resource Group -----------------------------------------------------------
echo "==> Creating resource group: $RESOURCE_GROUP in $LOCATION..."
az group create \
  --name "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --output none

# -- Azure Container Registry ------------------------------------------------
echo "==> Creating Azure Container Registry: $ACR_NAME..."
if ! az acr show --resource-group "$RESOURCE_GROUP" --name "$ACR_NAME" --output none 2>/dev/null; then
  az acr create \
    --resource-group "$RESOURCE_GROUP" \
    --name "$ACR_NAME" \
    --sku Basic \
    --location "$LOCATION" \
    --output none
fi

# -- Managed Identity ---------------------------------------------------------
echo "==> Creating managed identity: $IDENTITY_NAME..."
if ! az identity show --name "$IDENTITY_NAME" --resource-group "$RESOURCE_GROUP" --output none 2>/dev/null; then
  az identity create \
    --name "$IDENTITY_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --output none
fi

# Grant AcrPull to the managed identity on the ACR
IDENTITY_PRINCIPAL_ID=$(az identity show \
  --name "$IDENTITY_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query principalId \
  --output tsv)

IDENTITY_RESOURCE_ID=$(az identity show \
  --name "$IDENTITY_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query id \
  --output tsv)

ACR_RESOURCE_ID=$(az acr show \
  --name "$ACR_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query id \
  --output tsv)

echo "==> Granting AcrPull role to managed identity..."
az role assignment create \
  --assignee "$IDENTITY_PRINCIPAL_ID" \
  --role AcrPull \
  --scope "$ACR_RESOURCE_ID" \
  --output none 2>/dev/null || true   # Idempotent: ignore "already exists"

# -- Build & Push Image -------------------------------------------------------
echo "==> Building and pushing image via ACR (remote build)..."
az acr build \
  --registry "$ACR_NAME" \
  --image kodiai:latest \
  .

# -- Azure Storage Account (for Azure Files workspace share) ------------------
STORAGE_ACCOUNT_NAME="kodiaistg"   # globally unique, lowercase alphanumeric
FILE_SHARE_NAME="workspaces"

echo "==> Provisioning Azure Storage Account: $STORAGE_ACCOUNT_NAME..."
if ! az storage account show --name "$STORAGE_ACCOUNT_NAME" --resource-group "$RESOURCE_GROUP" --output none 2>/dev/null; then
  az storage account create \
    --name "$STORAGE_ACCOUNT_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --location "$LOCATION" \
    --sku Standard_LRS \
    --kind StorageV2 \
    --output none
fi

STORAGE_KEY=$(az storage account keys list \
  --account-name "$STORAGE_ACCOUNT_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query '[0].value' \
  --output tsv)

echo "==> Provisioning Azure Files share: $FILE_SHARE_NAME..."
if ! az storage share exists \
    --name "$FILE_SHARE_NAME" \
    --account-name "$STORAGE_ACCOUNT_NAME" \
    --account-key "$STORAGE_KEY" \
    --query exists \
    --output tsv 2>/dev/null | grep -q true; then
  az storage share create \
    --name "$FILE_SHARE_NAME" \
    --account-name "$STORAGE_ACCOUNT_NAME" \
    --account-key "$STORAGE_KEY" \
    --output none
fi

# -- Container Apps Environment -----------------------------------------------
echo "==> Creating Container Apps environment: $ENVIRONMENT..."
if ! az containerapp env show --name "$ENVIRONMENT" --resource-group "$RESOURCE_GROUP" --output none 2>/dev/null; then
  az containerapp env create \
    --name "$ENVIRONMENT" \
    --resource-group "$RESOURCE_GROUP" \
    --location "$LOCATION" \
    --output none
fi

# -- Storage mount on ACA environment -----------------------------------------
echo "==> Mounting Azure Files share on Container Apps environment..."
az containerapp env storage set \
  --name "$ENVIRONMENT" \
  --resource-group "$RESOURCE_GROUP" \
  --storage-name kodiai-workspaces \
  --azure-file-account-name "$STORAGE_ACCOUNT_NAME" \
  --azure-file-account-key "$STORAGE_KEY" \
  --azure-file-share-name "$FILE_SHARE_NAME" \
  --access-mode ReadWrite \
  --output none 2>/dev/null || true

# -- Build agent image ---------------------------------------------------------
echo "==> Building and pushing agent image via ACR (remote build)..."
az acr build \
  --registry "$ACR_NAME" \
  --image kodiai-agent:latest \
  --file Dockerfile.agent \
  .

# -- ACA Job (agent runner) ---------------------------------------------------
ACA_JOB_NAME="caj-kodiai-agent"
echo "==> Provisioning ACA Job: $ACA_JOB_NAME..."

ACA_JOB_IMAGE="${ACR_NAME}.azurecr.io/kodiai-agent:latest"
ACA_JOB_YAML=$(mktemp --suffix=.yaml)
cat > "$ACA_JOB_YAML" <<ACAYAML
properties:
  environmentId: /subscriptions/$(az account show --query id -o tsv)/resourceGroups/${RESOURCE_GROUP}/providers/Microsoft.App/managedEnvironments/${ENVIRONMENT}
  configuration:
    triggerType: Manual
    replicaTimeout: 600
    replicaRetryLimit: 0
    registries:
      - server: "${ACR_NAME}.azurecr.io"
        identity: "${IDENTITY_RESOURCE_ID}"
  template:
    containers:
      - name: "${ACA_JOB_NAME}"
        image: "${ACA_JOB_IMAGE}"
        volumeMounts:
          - volumeName: kodiai-workspaces
            mountPath: /mnt/kodiai-workspaces
    volumes:
      - name: kodiai-workspaces
        storageName: kodiai-workspaces
        storageType: AzureFile
ACAYAML

if az containerapp job show --name "$ACA_JOB_NAME" --resource-group "$RESOURCE_GROUP" --output none 2>/dev/null; then
  az containerapp job update \
    --name "$ACA_JOB_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --image "$ACA_JOB_IMAGE" \
    --yaml "$ACA_JOB_YAML" \
    --output none
else
  az containerapp job create \
    --name "$ACA_JOB_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --environment "$ENVIRONMENT" \
    --trigger-type Manual \
    --replica-timeout 600 \
    --replica-retry-limit 0 \
    --image "$ACR_NAME.azurecr.io/kodiai-agent:latest" \
    --user-assigned "$IDENTITY_RESOURCE_ID" \
    --registry-server "$ACR_NAME.azurecr.io" \
    --registry-identity "$IDENTITY_RESOURCE_ID" \
    --output none

  # Apply volume mount via YAML update (az containerapp job create lacks --volume flags)
  az containerapp job update \
    --name "$ACA_JOB_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --yaml "$ACA_JOB_YAML" \
    --output none
fi
rm -f "$ACA_JOB_YAML"

# -- Deploy Container App -----------------------------------------------------
echo "==> Deploying container app: $APP_NAME..."
if az containerapp show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" --output none 2>/dev/null; then
  REVISION_SUFFIX="deploy-$(date +%Y%m%d-%H%M%S)"
  echo "==> Updating existing container app (revision: $REVISION_SUFFIX)..."
  APP_YAML=$(mktemp --suffix=.yaml)
  cat > "$APP_YAML" <<APPYAML
properties:
  configuration:
    activeRevisionsMode: Single
    ingress:
      external: true
      targetPort: 3000
      transport: Auto
    registries:
      - server: ${ACR_NAME}.azurecr.io
        identity: ${IDENTITY_RESOURCE_ID}
    secrets:
      - name: github-app-id
        value: ${GITHUB_APP_ID}
      - name: github-private-key
        value: ${GITHUB_PRIVATE_KEY_BASE64}
      - name: github-webhook-secret
        value: ${GITHUB_WEBHOOK_SECRET}
      - name: claude-code-oauth-token
        value: ${CLAUDE_CODE_OAUTH_TOKEN}
      - name: voyage-api-key
        value: ${VOYAGE_API_KEY}
      - name: slack-bot-token
        value: ${SLACK_BOT_TOKEN}
      - name: slack-signing-secret
        value: ${SLACK_SIGNING_SECRET}
      - name: database-url
        value: ${DATABASE_URL}
  template:
    terminationGracePeriodSeconds: 600
    scale:
      minReplicas: 1
      maxReplicas: 1
    containers:
      - name: ${APP_NAME}
        image: ${ACR_NAME}.azurecr.io/kodiai:latest
        env:
          - name: GITHUB_APP_ID
            secretRef: github-app-id
          - name: GITHUB_PRIVATE_KEY
            secretRef: github-private-key
          - name: GITHUB_WEBHOOK_SECRET
            secretRef: github-webhook-secret
          - name: CLAUDE_CODE_OAUTH_TOKEN
            secretRef: claude-code-oauth-token
          - name: VOYAGE_API_KEY
            secretRef: voyage-api-key
          - name: SLACK_BOT_TOKEN
            secretRef: slack-bot-token
          - name: SLACK_SIGNING_SECRET
            secretRef: slack-signing-secret
          - name: DATABASE_URL
            secretRef: database-url
          - name: SLACK_BOT_USER_ID
            value: "${SLACK_BOT_USER_ID}"
          - name: SLACK_KODIAI_CHANNEL_ID
            value: "${SLACK_KODIAI_CHANNEL_ID}"
          - name: SHUTDOWN_GRACE_MS
            value: "${SHUTDOWN_GRACE_MS}"
          - name: PORT
            value: "3000"
          - name: LOG_LEVEL
            value: info
        probes:
          - type: Liveness
            httpGet:
              path: /healthz
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 30
            failureThreshold: 3
          - type: Readiness
            httpGet:
              path: /readiness
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 10
            failureThreshold: 3
          - type: Startup
            httpGet:
              path: /healthz
              port: 3000
            initialDelaySeconds: 3
            periodSeconds: 5
            failureThreshold: 40
        volumeMounts:
          - volumeName: kodiai-workspaces
            mountPath: /mnt/kodiai-workspaces
    volumes:
      - name: kodiai-workspaces
        storageName: kodiai-workspaces
        storageType: AzureFile
APPYAML

  az containerapp update \
    --name "$APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --yaml "$APP_YAML" \
    --output none
  rm -f "$APP_YAML"
else
  echo "==> Creating container app: $APP_NAME..."
  az containerapp create \
    --name "$APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --environment "$ENVIRONMENT" \
    --image "$ACR_NAME.azurecr.io/kodiai:latest" \
    --user-assigned "$IDENTITY_RESOURCE_ID" \
    --registry-server "$ACR_NAME.azurecr.io" \
    --registry-identity "$IDENTITY_RESOURCE_ID" \
    --target-port 3000 \
    --ingress external \
    --min-replicas 1 \
    --max-replicas 1 \
    --termination-grace-period 600 \
    --secrets \
      github-app-id="$GITHUB_APP_ID" \
      github-private-key="$GITHUB_PRIVATE_KEY_BASE64" \
      github-webhook-secret="$GITHUB_WEBHOOK_SECRET" \
      claude-code-oauth-token="$CLAUDE_CODE_OAUTH_TOKEN" \
      voyage-api-key="$VOYAGE_API_KEY" \
      slack-bot-token="$SLACK_BOT_TOKEN" \
      slack-signing-secret="$SLACK_SIGNING_SECRET" \
      database-url="$DATABASE_URL" \
    --env-vars \
      GITHUB_APP_ID=secretref:github-app-id \
      GITHUB_PRIVATE_KEY=secretref:github-private-key \
      GITHUB_WEBHOOK_SECRET=secretref:github-webhook-secret \
      CLAUDE_CODE_OAUTH_TOKEN=secretref:claude-code-oauth-token \
      VOYAGE_API_KEY=secretref:voyage-api-key \
      SLACK_BOT_TOKEN=secretref:slack-bot-token \
      SLACK_SIGNING_SECRET=secretref:slack-signing-secret \
      DATABASE_URL=secretref:database-url \
      SLACK_BOT_USER_ID="$SLACK_BOT_USER_ID" \
      SLACK_KODIAI_CHANNEL_ID="$SLACK_KODIAI_CHANNEL_ID" \
      SHUTDOWN_GRACE_MS="$SHUTDOWN_GRACE_MS" \
      PORT=3000 \
      LOG_LEVEL=info \
    --output none

  # Configure health probes on first create.
  echo "==> Configuring health probes..."

  PROBE_YAML=$(mktemp)
  cat > "$PROBE_YAML" <<YAML
properties:
  template:
    containers:
      - name: ca-kodiai
        image: ${ACR_NAME}.azurecr.io/kodiai:latest
        env:
          - name: GITHUB_APP_ID
            secretRef: github-app-id
          - name: GITHUB_PRIVATE_KEY
            secretRef: github-private-key
          - name: GITHUB_WEBHOOK_SECRET
            secretRef: github-webhook-secret
          - name: CLAUDE_CODE_OAUTH_TOKEN
            secretRef: claude-code-oauth-token
          - name: VOYAGE_API_KEY
            secretRef: voyage-api-key
          - name: SLACK_BOT_TOKEN
            secretRef: slack-bot-token
          - name: SLACK_SIGNING_SECRET
            secretRef: slack-signing-secret
          - name: DATABASE_URL
            secretRef: database-url
          - name: SLACK_BOT_USER_ID
            value: "${SLACK_BOT_USER_ID}"
          - name: SLACK_KODIAI_CHANNEL_ID
            value: "${SLACK_KODIAI_CHANNEL_ID}"
          - name: SHUTDOWN_GRACE_MS
            value: "${SHUTDOWN_GRACE_MS}"
          - name: PORT
            value: "3000"
          - name: LOG_LEVEL
            value: info
        probes:
          - type: liveness
            httpGet:
              path: /healthz
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 30
            failureThreshold: 3
          - type: readiness
            httpGet:
              path: /readiness
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 10
            failureThreshold: 3
          - type: startup
            httpGet:
              path: /healthz
              port: 3000
            initialDelaySeconds: 3
            periodSeconds: 5
            failureThreshold: 40
YAML

  az containerapp update \
    --name "$APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --yaml "$PROBE_YAML" \
    --output none

  rm -f "$PROBE_YAML"
fi

FQDN=$(az containerapp show \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query properties.configuration.ingress.fqdn \
  --output tsv)
HEALTH_URL="https://${FQDN}/healthz"
READINESS_URL="https://${FQDN}/readiness"
ACTIVE_REVISION=$(az containerapp revision list \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query "[?properties.active].name | [0]" \
  --output tsv 2>/dev/null || true)

# -- Post-deploy health check --------------------------------------------------
echo "==> Waiting for new revision to become healthy (up to 60s)..."
HEALTH_OK=false
for i in $(seq 1 12); do
  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_URL" 2>/dev/null || echo "000")
  if [[ "$HTTP_STATUS" == "200" ]]; then
    HEALTH_OK=true
    echo "  Health check passed (HTTP $HTTP_STATUS)"
    break
  fi
  echo "  Attempt $i/12: HTTP $HTTP_STATUS, retrying in 5s..."
  sleep 5
done

if [[ "$HEALTH_OK" != "true" ]]; then
  echo ""
  echo "WARNING: Post-deploy health check failed!"
  echo "  The new revision may not be healthy."
  echo "  To rollback, list revisions and redirect traffic:"
  echo "    az containerapp revision list -n $APP_NAME -g $RESOURCE_GROUP -o table"
  echo "    az containerapp ingress traffic set -n $APP_NAME -g $RESOURCE_GROUP --revision-weight <prev-revision>=100"
  echo ""
fi

# -- Done ---------------------------------------------------------------------
echo ""
echo "============================================================"
echo "  Deployment complete!"
echo ""
echo "  Active revision: ${ACTIVE_REVISION:-unknown}"
echo "  App URL: https://${FQDN}"
echo "  Health URL: ${HEALTH_URL}"
echo "  Readiness URL: ${READINESS_URL}"
echo "  Webhook URL: https://${FQDN}/webhooks/github"
echo ""
echo "  Configure this URL in your GitHub App settings."
echo "============================================================"
