# Deployment (Azure Container Apps)

This project is deployed as a containerized Bun service on Azure Container Apps.

## Current Production

- Azure resource group: `rg-kodiai`
- Azure Container Registry (ACR): `kodiairegistry`
- Container Apps environment: `cae-kodiai`
- Container app: `ca-kodiai`

The service exposes:

- Webhook endpoint: `POST /webhooks/github`
- Health: `GET /health`
- Readiness: `GET /readiness`

## Deploy Script

Use `deploy.sh` to provision and deploy.

Key properties:

- Idempotent: safe to re-run
- Remote build: uses `az acr build` (Docker not required locally)
- Managed identity: used for ACR pull (`AcrPull` role)
- Probes: liveness/readiness/startup configured via YAML update

### Required Environment Variables

`deploy.sh` requires:

- `GITHUB_APP_ID`
- `GITHUB_PRIVATE_KEY_BASE64` (base64-encoded PEM)
- `GITHUB_WEBHOOK_SECRET`
- `CLAUDE_CODE_OAUTH_TOKEN`

Notes:

- The app runtime expects `GITHUB_PRIVATE_KEY` and supports base64; the deploy script stores the base64 PEM in an Azure secret and maps it to `GITHUB_PRIVATE_KEY`.

### Run

```bash
./deploy.sh
```

On success, the script prints:

- App FQDN (HTTPS)
- Webhook URL to configure in the GitHub App

## Configuration Details

### Secrets and env vars

Azure secrets created by `deploy.sh`:

- `github-app-id`
- `github-private-key`
- `github-webhook-secret`
- `claude-code-oauth-token`

These are exposed to the container via env vars:

- `GITHUB_APP_ID`
- `GITHUB_PRIVATE_KEY`
- `GITHUB_WEBHOOK_SECRET`
- `CLAUDE_CODE_OAUTH_TOKEN`
- `PORT=3000`
- `LOG_LEVEL=info`

### Scaling

`deploy.sh` currently pins:

- `min-replicas 1`
- `max-replicas 1`

This avoids webhook timeouts from cold starts and reduces concurrency surprises.

## Health Probes

Configured (via the YAML update step in `deploy.sh`):

- Liveness: `GET /health`
- Readiness: `GET /readiness`
- Startup: `GET /health`

Important: the YAML update includes the full container spec (image + env) to avoid wiping env vars on update.

## Operational Runbooks

- Manual re-request / `review_requested` debugging:
  - `docs/runbooks/review-requested-debug.md`

## Common Commands

Show active revision:

```bash
az containerapp revision list \
  --name ca-kodiai \
  --resource-group rg-kodiai \
  --query "[?properties.active].name | [0]" \
  --output tsv
```

Fetch FQDN:

```bash
az containerapp show \
  --name ca-kodiai \
  --resource-group rg-kodiai \
  --query properties.configuration.ingress.fqdn \
  --output tsv
```

Health checks:

```bash
curl -fsS "https://$(az containerapp show --name ca-kodiai --resource-group rg-kodiai --query properties.configuration.ingress.fqdn -o tsv)/health"
curl -fsS "https://$(az containerapp show --name ca-kodiai --resource-group rg-kodiai --query properties.configuration.ingress.fqdn -o tsv)/readiness"
```
