#!/usr/bin/env bash
#
# Provision Azure Database for PostgreSQL Flexible Server with pgvector extension.
#
# Idempotent: safe to re-run. Creates resources only if they don't already exist.
#
# Prerequisites:
#   - Azure CLI (`az`) installed and authenticated (`az login`)
#   - Subscription selected (`az account set --subscription <id>`)
#
# Usage:
#   ./scripts/provision-postgres.sh
#
set -euo pipefail

# ── Configuration (override via environment variables) ────────────────────────
RESOURCE_GROUP="${RESOURCE_GROUP:-kodiai-rg}"
LOCATION="${LOCATION:-eastus}"
SERVER_NAME="${SERVER_NAME:-kodiai-pg}"
ADMIN_USER="${ADMIN_USER:-kodiaiadmin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:?Set ADMIN_PASSWORD environment variable}"
DB_NAME="${DB_NAME:-kodiai}"
SKU="${SKU:-Standard_B1ms}"
TIER="${TIER:-Burstable}"
PG_VERSION="${PG_VERSION:-17}"
STORAGE_SIZE="${STORAGE_SIZE:-32}"

echo "==> Provisioning PostgreSQL Flexible Server"
echo "    Resource Group : ${RESOURCE_GROUP}"
echo "    Location       : ${LOCATION}"
echo "    Server         : ${SERVER_NAME}"
echo "    SKU            : ${TIER} / ${SKU}"
echo "    PG Version     : ${PG_VERSION}"
echo ""

# ── Resource Group ────────────────────────────────────────────────────────────
echo "==> Ensuring resource group '${RESOURCE_GROUP}' exists..."
az group create \
  --name "${RESOURCE_GROUP}" \
  --location "${LOCATION}" \
  --output none

# ── Flexible Server ──────────────────────────────────────────────────────────
echo "==> Ensuring PostgreSQL Flexible Server '${SERVER_NAME}' exists..."
if az postgres flexible-server show \
  --resource-group "${RESOURCE_GROUP}" \
  --name "${SERVER_NAME}" \
  --output none 2>/dev/null; then
  echo "    Server already exists, skipping creation."
else
  az postgres flexible-server create \
    --resource-group "${RESOURCE_GROUP}" \
    --name "${SERVER_NAME}" \
    --location "${LOCATION}" \
    --admin-user "${ADMIN_USER}" \
    --admin-password "${ADMIN_PASSWORD}" \
    --sku-name "${SKU}" \
    --tier "${TIER}" \
    --version "${PG_VERSION}" \
    --storage-size "${STORAGE_SIZE}" \
    --public-access "0.0.0.0" \
    --output none
  echo "    Server created."
fi

# ── Enable pgvector extension ─────────────────────────────────────────────────
echo "==> Enabling pgvector (VECTOR) extension..."
az postgres flexible-server parameter set \
  --resource-group "${RESOURCE_GROUP}" \
  --server-name "${SERVER_NAME}" \
  --name azure.extensions \
  --value VECTOR \
  --output none
echo "    pgvector extension enabled."

# ── Create Database ───────────────────────────────────────────────────────────
echo "==> Ensuring database '${DB_NAME}' exists..."
az postgres flexible-server db create \
  --resource-group "${RESOURCE_GROUP}" \
  --server-name "${SERVER_NAME}" \
  --database-name "${DB_NAME}" \
  --output none 2>/dev/null || true
echo "    Database '${DB_NAME}' ready."

# ── Output connection string ─────────────────────────────────────────────────
CONNECTION_STRING="postgresql://${ADMIN_USER}:${ADMIN_PASSWORD}@${SERVER_NAME}.postgres.database.azure.com:5432/${DB_NAME}?sslmode=require"

echo ""
echo "==> Provisioning complete."
echo ""
echo "Connection string (set as DATABASE_URL):"
echo "  ${CONNECTION_STRING}"
echo ""
echo "Example:"
echo "  export DATABASE_URL='${CONNECTION_STRING}'"
