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
#   CLAUDE_CODE_OAUTH_TOKEN    - 1-year OAuth token from `claude setup-token`
#                                Do not use ~/.claude/.credentials.json
#                                claudeAiOauth.accessToken here — it is a
#                                rotating Claude login token, not the deploy
#                                token this runtime expects.
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

validate_claude_oauth_token_source() {
  CLAUDE_CREDENTIALS_FILE=${CLAUDE_CREDENTIALS_FILE:-$HOME/.claude/.credentials.json}

  if [[ -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" || ! -f "$CLAUDE_CREDENTIALS_FILE" ]]; then
    return 0
  fi

  local machine_token=""
  if command -v jq >/dev/null 2>&1; then
    machine_token=$(jq -r '.claudeAiOauth.accessToken // empty' "$CLAUDE_CREDENTIALS_FILE" 2>/dev/null || true)
  elif command -v node >/dev/null 2>&1; then
    machine_token=$(node -e 'const fs = require("node:fs"); try { const raw = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(raw?.claudeAiOauth?.accessToken ?? ""); } catch { process.stdout.write(""); }' "$CLAUDE_CREDENTIALS_FILE" 2>/dev/null || true)
  fi

  if [[ -n "$machine_token" && "${CLAUDE_CODE_OAUTH_TOKEN:-}" == "$machine_token" ]]; then
    echo "ERROR: CLAUDE_CODE_OAUTH_TOKEN matches $CLAUDE_CREDENTIALS_FILE accessToken."
    echo "Use the 1-year token from `claude setup-token`, not the rotating Claude login access token."
    exit 1
  fi
}

validate_claude_oauth_token_source

yaml_quote() {
  python3 -c 'import json, sys; print(json.dumps(sys.argv[1]))' "$1" || {
    echo "ERROR: yaml_quote failed for value" >&2
    exit 1
  }
}

# -- Configuration (customize as needed) --------------------------------------
RESOURCE_GROUP="rg-kodiai"
LOCATION="eastus"
ENVIRONMENT="cae-kodiai"
APP_NAME="ca-kodiai"
ACR_NAME="kodiairegistry"          # Must be globally unique, alphanumeric only
BUN_BASE_SOURCE_IMAGE=${BUN_BASE_SOURCE_IMAGE:-docker.io/oven/bun:1.3.8-debian}
BUN_BASE_ACR_IMAGE=${BUN_BASE_ACR_IMAGE:-base/oven-bun:1.3.8-debian}
BUN_BASE_IMAGE="${ACR_NAME}.azurecr.io/${BUN_BASE_ACR_IMAGE}"
IDENTITY_NAME="id-kodiai"
KEY_VAULT_NAME=${KEY_VAULT_NAME:-}
SOURCE_COMMIT=${DEPLOY_SOURCE_COMMIT:-$(git rev-parse --verify HEAD)}
if ! git rev-parse --verify "${SOURCE_COMMIT}^{commit}" >/dev/null 2>&1; then
  echo "ERROR: DEPLOY_SOURCE_COMMIT '$SOURCE_COMMIT' is not a valid git commit." >&2
  exit 1
fi
SOURCE_COMMIT=$(git rev-parse --verify "${SOURCE_COMMIT}^{commit}")
SOURCE_COMMIT_SHORT=$(git rev-parse --short=12 "$SOURCE_COMMIT")
ACA_MIN_REPLICAS=${ACA_MIN_REPLICAS:-1}
ACA_MAX_REPLICAS=${ACA_MAX_REPLICAS:-1}
if ! [[ "$ACA_MIN_REPLICAS" =~ ^[0-9]+$ && "$ACA_MAX_REPLICAS" =~ ^[0-9]+$ ]]; then
  echo "ERROR: ACA_MIN_REPLICAS and ACA_MAX_REPLICAS must be non-negative integers." >&2
  exit 1
fi
if (( ACA_MIN_REPLICAS < 1 || ACA_MAX_REPLICAS < ACA_MIN_REPLICAS )); then
  echo "ERROR: ACA_MIN_REPLICAS must be >= 1 and ACA_MAX_REPLICAS must be >= ACA_MIN_REPLICAS." >&2
  exit 1
fi
BUILD_CONTEXT_DIR=$(mktemp -d)
KEYVAULT_TEMP_FILES=()

cleanup_deploy_artifacts() {
  rm -rf "$BUILD_CONTEXT_DIR"
  if [[ ${#KEYVAULT_TEMP_FILES[@]} -gt 0 ]]; then
    rm -f "${KEYVAULT_TEMP_FILES[@]}"
  fi
}
trap cleanup_deploy_artifacts EXIT

prepare_build_context() {
  mkdir -p "$BUILD_CONTEXT_DIR"
  rm -rf "$BUILD_CONTEXT_DIR"/*

  git archive --format=tar "$SOURCE_COMMIT" \
    package.json bun.lock tsconfig.json Dockerfile Dockerfile.agent src \
    | tar -x -C "$BUILD_CONTEXT_DIR"

  echo "==> Prepared git build context at $BUILD_CONTEXT_DIR from commit $SOURCE_COMMIT"
}

prepare_build_context

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

if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: python3 is required for YAML quoting but is not installed."
  exit 1
fi

# -- Optional environment variables with defaults --------------------------------
SHUTDOWN_GRACE_MS=${SHUTDOWN_GRACE_MS:-300000}
BOT_USER_ENV_YAML=""
BOT_USER_SECRET_REF_YAML=""
BOT_USER_CREATE_SECRET_ARGS=()
BOT_USER_CREATE_ENV_ARGS=()

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

KV_PROVIDER_STATE=$(az provider show --namespace Microsoft.KeyVault --query registrationState --output tsv 2>/dev/null || true)
if [[ "$KV_PROVIDER_STATE" != "Registered" ]]; then
  az provider register --namespace Microsoft.KeyVault --wait || {
    echo "ERROR: Failed to register Azure provider Microsoft.KeyVault." >&2
    exit 1
  }
fi

if [[ -z "$KEY_VAULT_NAME" ]]; then
  if ! SUBSCRIPTION_ID=$(az account show --query id --output tsv); then
    echo "ERROR: Failed to read Azure subscription ID for default Key Vault naming." >&2
    exit 1
  fi
  if [[ -z "$SUBSCRIPTION_ID" ]]; then
    echo "ERROR: Azure subscription ID was empty; set KEY_VAULT_NAME explicitly." >&2
    exit 1
  fi
  KEY_VAULT_NAME="kv-kodiai-${SUBSCRIPTION_ID%%-*}"
fi

if [[ ! "$KEY_VAULT_NAME" =~ ^[a-zA-Z][a-zA-Z0-9-]{1,22}[a-zA-Z0-9]$ ]]; then
  echo "ERROR: KEY_VAULT_NAME='$KEY_VAULT_NAME' violates Azure naming constraints." >&2
  echo "       Use 3-24 characters: alphanumerics and hyphens, start with a letter, and do not end with a hyphen." >&2
  exit 1
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

echo "==> Mirroring Bun base image into ACR: $BUN_BASE_SOURCE_IMAGE -> $BUN_BASE_ACR_IMAGE..."
ACR_IMPORT_ARGS=(
  --name "$ACR_NAME"
  --source "$BUN_BASE_SOURCE_IMAGE"
  --image "$BUN_BASE_ACR_IMAGE"
  --force
  --output none
)
if [[ -n "${DOCKERHUB_USERNAME:-}" && -n "${DOCKERHUB_TOKEN:-}" ]]; then
  ACR_IMPORT_ARGS+=(--username "$DOCKERHUB_USERNAME" --password "$DOCKERHUB_TOKEN")
fi
az acr import "${ACR_IMPORT_ARGS[@]}"

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
APP_IMAGE_DIGEST=$(az acr build \
  --registry "$ACR_NAME" \
  --image kodiai:latest \
  --build-arg "BUN_BASE_IMAGE=$BUN_BASE_IMAGE" \
  --no-logs \
  "$BUILD_CONTEXT_DIR" \
  --query 'outputImages[0].digest' \
  --output tsv)
APP_IMAGE="${ACR_NAME}.azurecr.io/kodiai@${APP_IMAGE_DIGEST}"

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
ACA_JOB_IMAGE_DIGEST=$(az acr build \
  --registry "$ACR_NAME" \
  --image kodiai-agent:latest \
  --file Dockerfile.agent \
  --build-arg "BUN_BASE_IMAGE=$BUN_BASE_IMAGE" \
  --no-logs \
  "$BUILD_CONTEXT_DIR" \
  --query 'outputImages[0].digest' \
  --output tsv)

# -- ACA Job (agent runner) ---------------------------------------------------
ACA_JOB_NAME="caj-kodiai-agent"
# Keep the ACA job timeout above the maximum repo-config execution timeout
# (1800s) so the agent can hit its own deadline and publish timeout/error
# handling instead of being hard-killed by the platform first.
ACA_JOB_REPLICA_TIMEOUT=1860
echo "==> Provisioning ACA Job: $ACA_JOB_NAME..."

ACA_JOB_IMAGE="${ACR_NAME}.azurecr.io/kodiai-agent@${ACA_JOB_IMAGE_DIGEST}"
ACA_JOB_YAML=$(mktemp --suffix=.yaml)
cat > "$ACA_JOB_YAML" <<ACAYAML
properties:
  environmentId: /subscriptions/$(az account show --query id -o tsv)/resourceGroups/${RESOURCE_GROUP}/providers/Microsoft.App/managedEnvironments/${ENVIRONMENT}
  configuration:
    triggerType: Manual
    replicaTimeout: ${ACA_JOB_REPLICA_TIMEOUT}
    replicaRetryLimit: 0
    registries:
      - server: "${ACR_NAME}.azurecr.io"
        identity: "${IDENTITY_RESOURCE_ID}"
  template:
    containers:
      - name: "${ACA_JOB_NAME}"
        image: "${ACA_JOB_IMAGE}"
        env:
          - name: SOURCE_COMMIT
            value: ${SOURCE_COMMIT}
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
    --replica-timeout "$ACA_JOB_REPLICA_TIMEOUT" \
    --replica-retry-limit 0 \
    --image "$ACA_JOB_IMAGE" \
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

# -- Azure Key Vault (shared runtime secrets) ----------------------------------
echo "==> Creating Azure Key Vault: $KEY_VAULT_NAME..."
if ! az keyvault show --name "$KEY_VAULT_NAME" --resource-group "$RESOURCE_GROUP" --output none 2>/dev/null; then
  az keyvault create \
    --name "$KEY_VAULT_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --location "$LOCATION" \
    --enable-rbac-authorization true \
    --output none || {
      echo "ERROR: Failed to create Key Vault '$KEY_VAULT_NAME' in resource group '$RESOURCE_GROUP'." >&2
      exit 1
    }
fi

if ! KEY_VAULT_ID=$(az keyvault show --name "$KEY_VAULT_NAME" --resource-group "$RESOURCE_GROUP" --query id --output tsv); then
  echo "ERROR: Failed to read Key Vault resource ID for '$KEY_VAULT_NAME'." >&2
  exit 1
fi
if [[ -z "$KEY_VAULT_ID" ]]; then
  echo "ERROR: Key Vault resource ID for '$KEY_VAULT_NAME' was empty." >&2
  exit 1
fi
KEY_VAULT_URI="https://${KEY_VAULT_NAME}.vault.azure.net/secrets"

ensure_role_assignment() {
  local assignee_object_id="$1"
  local principal_type="$2"
  local role_name="$3"
  local scope="$4"
  local description="$5"
  local err_file
  err_file=$(mktemp)
  KEYVAULT_TEMP_FILES+=("$err_file")
  if az role assignment create \
    --assignee-object-id "$assignee_object_id" \
    --assignee-principal-type "$principal_type" \
    --role "$role_name" \
    --scope "$scope" \
    --output none 2>"$err_file"; then
    rm -f "$err_file"
    return 0
  fi

  if grep -Eqi "already exists|RoleAssignmentExists" "$err_file"; then
    rm -f "$err_file"
    return 0
  fi

  echo "ERROR: Failed to grant $role_name to $description on $scope:" >&2
  cat "$err_file" >&2
  rm -f "$err_file"
  return 1
}

resolve_deployer_principal() {
  DEPLOYER_PRINCIPAL_TYPE=${DEPLOYER_PRINCIPAL_TYPE:-}
  DEPLOYER_OBJECT_ID=${DEPLOYER_OBJECT_ID:-}

  if { [[ -n "$DEPLOYER_OBJECT_ID" ]] && [[ -z "$DEPLOYER_PRINCIPAL_TYPE" ]]; } || { [[ -z "$DEPLOYER_OBJECT_ID" ]] && [[ -n "$DEPLOYER_PRINCIPAL_TYPE" ]]; }; then
    echo "ERROR: DEPLOYER_OBJECT_ID and DEPLOYER_PRINCIPAL_TYPE must be set together." >&2
    echo "       DEPLOYER_PRINCIPAL_TYPE must be User or ServicePrincipal." >&2
    exit 1
  fi

  if [[ -n "$DEPLOYER_OBJECT_ID" && -n "$DEPLOYER_PRINCIPAL_TYPE" ]]; then
    case "$DEPLOYER_PRINCIPAL_TYPE" in
      User|ServicePrincipal) return 0 ;;
      *)
        echo "ERROR: DEPLOYER_PRINCIPAL_TYPE must be User or ServicePrincipal, got '$DEPLOYER_PRINCIPAL_TYPE'." >&2
        exit 1
        ;;
    esac
  fi

  local account_user_type
  account_user_type=$(az account show --query user.type --output tsv 2>/dev/null || true)
  case "$account_user_type" in
    user)
      if [[ -z "$DEPLOYER_OBJECT_ID" ]]; then
        if ! DEPLOYER_OBJECT_ID=$(az ad signed-in-user show --query id --output tsv); then
          echo "ERROR: Failed to resolve Azure signed-in user object ID." >&2
          echo "       Set DEPLOYER_OBJECT_ID and DEPLOYER_PRINCIPAL_TYPE explicitly if directory lookup is blocked." >&2
          exit 1
        fi
      fi
      DEPLOYER_PRINCIPAL_TYPE=${DEPLOYER_PRINCIPAL_TYPE:-User}
      ;;
    servicePrincipal)
      if [[ -z "$DEPLOYER_OBJECT_ID" ]]; then
        local service_principal_app_id
        if ! service_principal_app_id=$(az account show --query user.name --output tsv); then
          echo "ERROR: Failed to resolve Azure service principal app ID from current account." >&2
          exit 1
        fi
        if [[ -z "$service_principal_app_id" ]]; then
          echo "ERROR: Azure service principal app ID was empty." >&2
          exit 1
        fi
        if ! DEPLOYER_OBJECT_ID=$(az ad sp show --id "$service_principal_app_id" --query id --output tsv); then
          echo "ERROR: Failed to resolve Azure service principal object ID for '$service_principal_app_id'." >&2
          echo "       Set DEPLOYER_OBJECT_ID and DEPLOYER_PRINCIPAL_TYPE explicitly if Graph lookup is blocked." >&2
          exit 1
        fi
      fi
      DEPLOYER_PRINCIPAL_TYPE=${DEPLOYER_PRINCIPAL_TYPE:-ServicePrincipal}
      ;;
    *)
      echo "ERROR: Could not determine Azure deployer principal type." >&2
      echo "       Set DEPLOYER_OBJECT_ID and DEPLOYER_PRINCIPAL_TYPE explicitly for non-interactive deploys." >&2
      exit 1
      ;;
  esac

  if [[ -z "$DEPLOYER_OBJECT_ID" ]]; then
    echo "ERROR: Could not resolve Azure deployer object ID." >&2
    echo "       Set DEPLOYER_OBJECT_ID and DEPLOYER_PRINCIPAL_TYPE explicitly for this deployment identity." >&2
    exit 1
  fi

  case "$DEPLOYER_PRINCIPAL_TYPE" in
    User|ServicePrincipal) ;;
    *)
      echo "ERROR: DEPLOYER_PRINCIPAL_TYPE must be User or ServicePrincipal, got '$DEPLOYER_PRINCIPAL_TYPE'." >&2
      exit 1
      ;;
  esac
}

if [[ -n "${BOT_USER_PAT:-}" && -n "${BOT_USER_LOGIN:-}" ]]; then
  BOT_USER_SECRET_REF_YAML=$(cat <<EOF
      - name: bot-user-pat
        keyVaultUrl: ${KEY_VAULT_URI}/bot-user-pat
        identity: ${IDENTITY_RESOURCE_ID}
EOF
)
  BOT_USER_ENV_YAML=$(cat <<EOF
          - name: BOT_USER_PAT
            secretRef: bot-user-pat
          - name: BOT_USER_LOGIN
            value: $(yaml_quote "$BOT_USER_LOGIN")
EOF
)
  BOT_USER_CREATE_SECRET_ARGS+=("bot-user-pat=keyvaultref:${KEY_VAULT_URI}/bot-user-pat,identityref:${IDENTITY_RESOURCE_ID}")
  BOT_USER_CREATE_ENV_ARGS+=(
    "BOT_USER_PAT=secretref:bot-user-pat"
    "BOT_USER_LOGIN=${BOT_USER_LOGIN}"
  )
elif [[ -n "${BOT_USER_PAT:-}" || -n "${BOT_USER_LOGIN:-}" ]]; then
  echo "WARNING: BOT_USER_PAT and BOT_USER_LOGIN must both be set to enable fork/gist features; skipping bot-user env injection."
fi

echo "==> Granting Key Vault secret-read access to managed identity..."
ensure_role_assignment \
  "$IDENTITY_PRINCIPAL_ID" \
  ServicePrincipal \
  "Key Vault Secrets User" \
  "$KEY_VAULT_ID" \
  "managed identity $IDENTITY_NAME" || {
    echo "ERROR: Managed identity cannot read Key Vault secrets; aborting deploy." >&2
    exit 1
  }

echo "==> Granting Key Vault secret-write access to deployer..."
resolve_deployer_principal
ensure_role_assignment \
  "$DEPLOYER_OBJECT_ID" \
  "$DEPLOYER_PRINCIPAL_TYPE" \
  "Key Vault Secrets Officer" \
  "$KEY_VAULT_ID" \
  "deployer principal $DEPLOYER_OBJECT_ID" || {
    echo "ERROR: Deployer cannot write Key Vault secrets; aborting deploy." >&2
    exit 1
  }

set_keyvault_secret() {
  local name="$1"
  local value="$2"
  local attempts=30
  local delay=10
  local i
  local err_file
  local first_err_file
  err_file=$(mktemp)
  first_err_file=$(mktemp)
  KEYVAULT_TEMP_FILES+=("$err_file" "$first_err_file")
  for i in $(seq 1 "$attempts"); do
    if printf '%s' "$value" | az keyvault secret set --vault-name "$KEY_VAULT_NAME" --name "$name" --file /dev/stdin --output none 2>"$err_file"; then
      if [[ "$i" -gt 1 ]]; then
        echo "  -> $name: succeeded after $i attempts"
      fi
      rm -f "$err_file" "$first_err_file"
      return 0
    fi
    if [[ "$i" -eq 1 ]]; then
      cp "$err_file" "$first_err_file"
    fi
    if [[ "$i" -lt "$attempts" ]]; then
      echo "  -> $name: attempt $i/$attempts failed; retrying in ${delay}s..."
    fi
    sleep "$delay"
  done
  echo "ERROR: Failed to set Key Vault secret '$name' after $attempts attempts." >&2
  echo "First failure:" >&2
  cat "$first_err_file" >&2
  echo "Last failure:" >&2
  cat "$err_file" >&2
  rm -f "$err_file" "$first_err_file"
  return 1
}

sync_keyvault_secret() {
  local name="$1"
  local value="$2"
  if [[ -z "$value" ]]; then
    echo "ERROR: Required Key Vault secret '$name' has an empty deploy input value; aborting deploy." >&2
    exit 1
  fi
  set_keyvault_secret "$name" "$value" || {
    echo "ERROR: Required Key Vault secret '$name' was not synced; aborting deploy." >&2
    exit 1
  }
}

echo "==> Syncing runtime secrets into Azure Key Vault..."
sync_keyvault_secret github-app-id "$GITHUB_APP_ID"
sync_keyvault_secret github-private-key "$GITHUB_PRIVATE_KEY_BASE64"
sync_keyvault_secret github-webhook-secret "$GITHUB_WEBHOOK_SECRET"
sync_keyvault_secret claude-code-oauth-token "$CLAUDE_CODE_OAUTH_TOKEN"
sync_keyvault_secret voyage-api-key "$VOYAGE_API_KEY"
sync_keyvault_secret slack-bot-token "$SLACK_BOT_TOKEN"
sync_keyvault_secret slack-signing-secret "$SLACK_SIGNING_SECRET"
sync_keyvault_secret database-url "$DATABASE_URL"
if [[ -n "${BOT_USER_PAT:-}" && -n "${BOT_USER_LOGIN:-}" ]]; then
  sync_keyvault_secret bot-user-pat "$BOT_USER_PAT"
fi

echo "==> Pointing ACA Job secrets at Azure Key Vault..."
az containerapp job secret set \
  --name "$ACA_JOB_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --secrets \
    "claude-code-oauth-token=keyvaultref:${KEY_VAULT_URI}/claude-code-oauth-token,identityref:${IDENTITY_RESOURCE_ID}" \
  --output none || {
    echo "ERROR: Failed to point ACA Job Claude token secret at Azure Key Vault; aborting deploy." >&2
    exit 1
  }

# -- Deploy Container App -----------------------------------------------------
echo "==> Deploying container app: $APP_NAME..."
if az containerapp show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" --output none 2>/dev/null; then
  REVISION_SUFFIX="deploy-${SOURCE_COMMIT_SHORT}-$(date +%Y%m%d-%H%M%S)"
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
        keyVaultUrl: ${KEY_VAULT_URI}/github-app-id
        identity: ${IDENTITY_RESOURCE_ID}
      - name: github-private-key
        keyVaultUrl: ${KEY_VAULT_URI}/github-private-key
        identity: ${IDENTITY_RESOURCE_ID}
      - name: github-webhook-secret
        keyVaultUrl: ${KEY_VAULT_URI}/github-webhook-secret
        identity: ${IDENTITY_RESOURCE_ID}
      - name: claude-code-oauth-token
        keyVaultUrl: ${KEY_VAULT_URI}/claude-code-oauth-token
        identity: ${IDENTITY_RESOURCE_ID}
      - name: voyage-api-key
        keyVaultUrl: ${KEY_VAULT_URI}/voyage-api-key
        identity: ${IDENTITY_RESOURCE_ID}
      - name: slack-bot-token
        keyVaultUrl: ${KEY_VAULT_URI}/slack-bot-token
        identity: ${IDENTITY_RESOURCE_ID}
      - name: slack-signing-secret
        keyVaultUrl: ${KEY_VAULT_URI}/slack-signing-secret
        identity: ${IDENTITY_RESOURCE_ID}
      - name: database-url
        keyVaultUrl: ${KEY_VAULT_URI}/database-url
        identity: ${IDENTITY_RESOURCE_ID}
${BOT_USER_SECRET_REF_YAML}
  template:
    revisionSuffix: ${REVISION_SUFFIX}
    terminationGracePeriodSeconds: 600
    scale:
      minReplicas: ${ACA_MIN_REPLICAS}
      maxReplicas: ${ACA_MAX_REPLICAS}
    containers:
      - name: ${APP_NAME}
        image: ${APP_IMAGE}
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
            value: $(yaml_quote "$SLACK_BOT_USER_ID")
          - name: SLACK_KODIAI_CHANNEL_ID
            value: $(yaml_quote "$SLACK_KODIAI_CHANNEL_ID")
${BOT_USER_ENV_YAML}
          - name: SHUTDOWN_GRACE_MS
            value: $(yaml_quote "$SHUTDOWN_GRACE_MS")
          - name: PORT
            value: "3000"
          - name: LOG_LEVEL
            value: info
          - name: SOURCE_COMMIT
            value: ${SOURCE_COMMIT}
        probes:
          - type: Liveness
            httpGet:
              path: /healthz
              port: 3000
            timeoutSeconds: 3
            initialDelaySeconds: 5
            periodSeconds: 30
            failureThreshold: 3
          - type: Readiness
            httpGet:
              path: /readiness
              port: 3000
            timeoutSeconds: 5
            initialDelaySeconds: 10
            periodSeconds: 10
            failureThreshold: 3
          - type: Startup
            httpGet:
              path: /healthz
              port: 3000
            timeoutSeconds: 3
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
    --image "$APP_IMAGE" \
    --user-assigned "$IDENTITY_RESOURCE_ID" \
    --registry-server "$ACR_NAME.azurecr.io" \
    --registry-identity "$IDENTITY_RESOURCE_ID" \
    --target-port 3000 \
    --ingress external \
    --min-replicas "$ACA_MIN_REPLICAS" \
    --max-replicas "$ACA_MAX_REPLICAS" \
    --termination-grace-period 600 \
    --secrets \
      "github-app-id=keyvaultref:${KEY_VAULT_URI}/github-app-id,identityref:${IDENTITY_RESOURCE_ID}" \
      "github-private-key=keyvaultref:${KEY_VAULT_URI}/github-private-key,identityref:${IDENTITY_RESOURCE_ID}" \
      "github-webhook-secret=keyvaultref:${KEY_VAULT_URI}/github-webhook-secret,identityref:${IDENTITY_RESOURCE_ID}" \
      "claude-code-oauth-token=keyvaultref:${KEY_VAULT_URI}/claude-code-oauth-token,identityref:${IDENTITY_RESOURCE_ID}" \
      "voyage-api-key=keyvaultref:${KEY_VAULT_URI}/voyage-api-key,identityref:${IDENTITY_RESOURCE_ID}" \
      "slack-bot-token=keyvaultref:${KEY_VAULT_URI}/slack-bot-token,identityref:${IDENTITY_RESOURCE_ID}" \
      "slack-signing-secret=keyvaultref:${KEY_VAULT_URI}/slack-signing-secret,identityref:${IDENTITY_RESOURCE_ID}" \
      "database-url=keyvaultref:${KEY_VAULT_URI}/database-url,identityref:${IDENTITY_RESOURCE_ID}" \
      "${BOT_USER_CREATE_SECRET_ARGS[@]}" \
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
      SOURCE_COMMIT="$SOURCE_COMMIT" \
      "${BOT_USER_CREATE_ENV_ARGS[@]}" \
    --output none

  # Configure health probes on first create.
  echo "==> Configuring health probes..."

  PROBE_YAML=$(mktemp)
  cat > "$PROBE_YAML" <<YAML
properties:
  template:
    containers:
      - name: ca-kodiai
        image: ${APP_IMAGE}
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
            value: $(yaml_quote "$SLACK_BOT_USER_ID")
          - name: SLACK_KODIAI_CHANNEL_ID
            value: $(yaml_quote "$SLACK_KODIAI_CHANNEL_ID")
${BOT_USER_ENV_YAML}
          - name: SHUTDOWN_GRACE_MS
            value: $(yaml_quote "$SHUTDOWN_GRACE_MS")
          - name: PORT
            value: "3000"
          - name: LOG_LEVEL
            value: info
          - name: SOURCE_COMMIT
            value: ${SOURCE_COMMIT}
        probes:
          - type: liveness
            httpGet:
              path: /healthz
              port: 3000
            timeoutSeconds: 3
            initialDelaySeconds: 5
            periodSeconds: 30
            failureThreshold: 3
          - type: readiness
            httpGet:
              path: /readiness
              port: 3000
            timeoutSeconds: 5
            initialDelaySeconds: 10
            periodSeconds: 10
            failureThreshold: 3
          - type: startup
            httpGet:
              path: /healthz
              port: 3000
            timeoutSeconds: 3
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
TRAFFIC_ACTIVE_REVISION=$(az containerapp revision list \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query '[?properties.active && properties.trafficWeight > `0`] | sort_by(@, &properties.createdTime) | [-1].name' \
  --output tsv 2>/dev/null || true)
NEWEST_ACTIVE_REVISION=$(az containerapp revision list \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query '[?properties.active] | sort_by(@, &properties.createdTime) | [-1].name' \
  --output tsv 2>/dev/null || true)
ACTIVE_REVISION=${TRAFFIC_ACTIVE_REVISION:-$NEWEST_ACTIVE_REVISION}

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
