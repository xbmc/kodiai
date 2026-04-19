# Deployment (Azure Container Apps)

This project is deployed as a containerized Bun service on Azure Container Apps.

> **See also:** [Architecture](architecture.md) for system design and module map, [Configuration](configuration.md) for the complete `.kodiai.yml` reference, [Graceful Restart Runbook](GRACEFUL-RESTART-RUNBOOK.md) for zero-downtime deploys.

## Current Production

- Azure resource group: `rg-kodiai`
- Azure Container Registry (ACR): `kodiairegistry`
- Container Apps environment: `cae-kodiai`
- Container app: `ca-kodiai`
- ACA job: `caj-kodiai-agent`

The service exposes:

- Webhook endpoint: `POST /webhooks/github`
- Slack events endpoint: `POST /webhooks/slack/events`
- Slack commands endpoint: `POST /webhooks/slack/commands/*`
- Health: `GET /healthz`
- Readiness: `GET /readiness`

## Deploy Script

Use `deploy.sh` to provision and deploy.

Key properties:

- Idempotent: safe to re-run
- Remote build: uses `az acr build` (Docker not required locally)
- Managed identity: used for ACR pull (`AcrPull` role)
- Probes: liveness/readiness/startup are configured in the app template
- Existing app updates are single-shot full YAML updates: image, env, probes, secrets, scale, ingress, and volume mounts are rendered together for `az containerapp update --yaml`
- Success output now prints the active revision plus deploy proof URLs for `/healthz` and `/readiness`

### Why the single-shot YAML matters

Azure Container Apps update semantics are destructive for omitted fields. A two-step update like:

1. `az containerapp update --set-env-vars ... --image ...`
2. `az containerapp update --yaml <partial-template-with-volume-mount>`

can create a second revision that drops env vars and probes if the YAML omits them. In single-revision mode, that broken revision can become the active revision and take the app down.

The deploy script avoids that failure mode by updating existing apps with one full YAML payload.

### Required Environment Variables

`deploy.sh` requires:

- `GITHUB_APP_ID`
- `GITHUB_PRIVATE_KEY_BASE64` (base64-encoded PEM)
- `GITHUB_WEBHOOK_SECRET`
- `CLAUDE_CODE_OAUTH_TOKEN`
- `VOYAGE_API_KEY`
- `SLACK_BOT_TOKEN`
- `SLACK_SIGNING_SECRET`
- `SLACK_BOT_USER_ID`
- `SLACK_KODIAI_CHANNEL_ID`
- `DATABASE_URL`

Optional:

- `SHUTDOWN_GRACE_MS` (defaults to `300000`)
- `BOT_USER_PAT` (optional; enables fork/gist bot-user flows when paired with `BOT_USER_LOGIN`)
- `BOT_USER_LOGIN` (optional; enables fork/gist bot-user flows when paired with `BOT_USER_PAT`)

Notes:

- The app runtime expects `GITHUB_PRIVATE_KEY`; the deploy script stores the base64 PEM in an Azure secret and maps it to `GITHUB_PRIVATE_KEY`.
- `CLAUDE_CODE_OAUTH_TOKEN` must be the 1-year token from `claude setup-token`. Do **not** point it at `~/.claude/.credentials.json` `claudeAiOauth.accessToken`; that rotating login token is rejected by the deployed runtime path.
- Structural-impact output depends on the review-graph and canonical-code substrates being reachable in the deployed environment.

### Run

```bash
./deploy.sh
```

On success, the script prints:

- Active revision
- App URL
- Health URL (`/healthz`)
- Readiness URL (`/readiness`)
- Webhook URL to configure in the GitHub App

## Configuration Details

### Secrets and env vars

See `.env.example` for the full list of environment variables. For repository-level behavior configuration (review rules, mention handling, knowledge features), see [Configuration](configuration.md).

Azure secrets created by `deploy.sh`:

- `github-app-id`
- `github-private-key`
- `github-webhook-secret`
- `claude-code-oauth-token`
- `voyage-api-key`
- `slack-bot-token`
- `slack-signing-secret`
- `database-url`
- `bot-user-pat` (only when both `BOT_USER_PAT` and `BOT_USER_LOGIN` are set)

Runtime env vars set by `deploy.sh` on the app template:

- `GITHUB_APP_ID`
- `GITHUB_PRIVATE_KEY`
- `GITHUB_WEBHOOK_SECRET`
- `CLAUDE_CODE_OAUTH_TOKEN`
- `VOYAGE_API_KEY`
- `SLACK_BOT_TOKEN`
- `SLACK_SIGNING_SECRET`
- `DATABASE_URL`
- `SLACK_BOT_USER_ID`
- `SLACK_KODIAI_CHANNEL_ID`
- `BOT_USER_PAT` (only when both `BOT_USER_PAT` and `BOT_USER_LOGIN` are set)
- `BOT_USER_LOGIN` (only when both `BOT_USER_PAT` and `BOT_USER_LOGIN` are set)
- `SHUTDOWN_GRACE_MS`
- `PORT=3000`
- `LOG_LEVEL=info`

### ACA job launch-contract defaults

The app runtime still has built-in defaults for the ACA job launch contract in `src/config.ts`. When these env vars are absent, the runtime falls back to:

- `ACA_JOB_IMAGE=kodiairegistry.azurecr.io/kodiai-agent:latest`
- `ACA_JOB_NAME=caj-kodiai-agent`
- `ACA_RESOURCE_GROUP=rg-kodiai`
- `MCP_INTERNAL_BASE_URL=http://ca-kodiai`

Those defaults are the current truth. `deploy.sh` does **not** inject them into the container app template anymore.

### Scaling

`deploy.sh` currently pins:

- `min-replicas 1`
- `max-replicas 1`

This avoids webhook timeouts from cold starts and reduces concurrency surprises.

## Health Probes

Configured in the container app template:

- Liveness: `GET /healthz`
- Readiness: `GET /readiness`
- Startup: `GET /healthz`

Important:

- Existing app updates must render the full container app template in one YAML payload.
- Partial YAML updates that only add a volume mount can wipe env vars or probes from the next revision.
- In single-revision mode, a stripped revision can become active immediately and fail startup with missing env vars.

## Post-deploy proof surfaces

These are the fastest operator checks after a deploy:

- Active revision selection
- `GET /healthz`
- `GET /readiness`
- Deploy output showing the exact proof URLs that were just probed
- `bun run verify:m052` when Slack webhook relay is enabled

## Operational Runbooks

- Manual re-request / explicit `@kodiai review` debugging:
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
curl -fsS "https://$(az containerapp show --name ca-kodiai --resource-group rg-kodiai --query properties.configuration.ingress.fqdn -o tsv)/healthz"
curl -fsS "https://$(az containerapp show --name ca-kodiai --resource-group rg-kodiai --query properties.configuration.ingress.fqdn -o tsv)/readiness"
```
how --name ca-kodiai --resource-group rg-kodiai --query properties.configuration.ingress.fqdn -o tsv)/readiness"
```
