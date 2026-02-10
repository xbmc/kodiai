# Phase 8: Deployment - Research

**Researched:** 2026-02-08
**Domain:** Docker containerization (Bun + Claude Agent SDK), Azure Container Apps deployment, secrets management
**Confidence:** HIGH

## Summary

This phase packages the kodiai Bun application as a Docker container and deploys it to Azure Container Apps with proper secrets management. The two plans cover: (1) Dockerfile creation, `.dockerignore`, and local container build verification, and (2) Azure Container Apps provisioning with secrets, ingress, health probes, and deployment.

A critical finding from this research: the `@anthropic-ai/claude-agent-sdk` package (v0.2.37) bundles a `cli.js` file (11MB JavaScript bundle of the Claude Code CLI) alongside the SDK. When no `pathToClaudeCodeExecutable` is provided, the SDK resolves to this bundled `cli.js` and runs it via the JavaScript runtime (`bun` or `node`). This means the Docker container does NOT need a separate Claude Code CLI installation (`curl -fsSL https://claude.ai/install.sh | bash`). The SDK's `manifest.json` confirms support for `linux-x64-musl` (Alpine), so `oven/bun:1-alpine` should work. The only additional system dependency is `git` (required for workspace cloning).

The application reads four required environment variables (`GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `CLAUDE_CODE_OAUTH_TOKEN`) and two optional ones (`PORT` defaulting to 3000, `LOG_LEVEL` defaulting to "info"). The executor passes `...process.env` to the Claude CLI subprocess, so `CLAUDE_CODE_OAUTH_TOKEN` must be set in the container environment. Azure Container Apps secrets are referenced in env vars using `secretref:` syntax. The private key (multiline PEM) should be base64-encoded when stored as a secret, since the app's `loadPrivateKey()` already handles base64 decoding.

**Primary recommendation:** Use `oven/bun:1-alpine` with a multi-stage build (install deps in temp dir, copy production deps to final image). Install only `git` as the extra system package. Deploy to Azure Container Apps with ACR for image hosting, secrets for sensitive values, external ingress on port 3000, and HTTP health probes pointing at `/health` and `/readiness`.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| oven/bun:1-alpine | Bun 1.x on Alpine Linux | Base Docker image | Official Bun Docker image; Alpine variant is smallest (~100MB); musl support confirmed by agent-sdk manifest |
| Azure Container Apps | N/A | Hosting platform | Specified by project constraints; supports scale-to-zero, secrets, external ingress |
| Azure Container Registry (ACR) | N/A | Container image registry | Native integration with Container Apps; managed identity for pull auth |

### Supporting
| Tool | Purpose | When to Use |
|------|---------|-------------|
| az CLI (containerapp extension) | Provisioning and deploying | All Azure resource creation and deployment |
| docker buildx | Multi-platform builds | If building on non-x64 host for x64 deployment |
| az acr build | Remote image builds without local Docker | Alternative to local `docker build` + `docker push` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| ACR | GitHub Container Registry (ghcr.io) | ghcr.io is free for public repos but requires separate auth config for Container Apps; ACR has native managed identity integration |
| oven/bun:1-alpine | oven/bun:1-debian-slim | ~2x image size but avoids any musl compatibility edge cases; use as fallback if Alpine causes issues |
| Multi-stage Dockerfile | Single-stage | Multi-stage excludes devDependencies and build artifacts, reducing image size by ~30-50% |

## Architecture Patterns

### Recommended Dockerfile Structure

```dockerfile
# Stage 1: Install dependencies
FROM oven/bun:1-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile

# Stage 2: Production image
FROM oven/bun:1-alpine
RUN apk add --no-cache git
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock ./
COPY src/ ./src/
COPY tsconfig.json ./

# Non-root user for security
USER bun

EXPOSE 3000
CMD ["bun", "run", "src/index.ts"]
```

### Key Dockerfile Decisions

1. **No Claude CLI installation needed**: The `@anthropic-ai/claude-agent-sdk` bundles `cli.js` which the SDK runs via `bun cli.js`. The SDK resolves the path as `path.join(dirname(import.meta.url), "..", "cli.js")`.

2. **git is required**: The workspace manager runs `git clone` via `Bun.$` shell. Must be installed in the container.

3. **USER bun**: The `oven/bun` image includes a `bun` user. Running as non-root is a security best practice. The app writes to `/tmp` for workspaces, which is world-writable.

4. **No COPY of tmp/ or .planning/**: These are development-only directories.

### Azure Container Apps Resource Structure

```
Resource Group: rg-kodiai
  |
  +-- Container Apps Environment: cae-kodiai
  |     |
  |     +-- Container App: ca-kodiai
  |           - Image: kodiai.azurecr.io/kodiai:latest
  |           - Ingress: external, port 3000
  |           - Secrets: 4 sensitive values
  |           - Min replicas: 1 (webhook receiver must be always-on)
  |           - Max replicas: 1 (single instance for v1)
  |           - Health probes: /health (liveness), /readiness (readiness)
  |
  +-- Container Registry: kodiai.azurecr.io
  |     - SKU: Basic
  |     - Auth: Managed identity
  |
  +-- User-Assigned Managed Identity: id-kodiai
        - Used for ACR pull
```

### Anti-Patterns to Avoid
- **Installing Claude CLI via curl in Dockerfile**: The agent-sdk bundles cli.js. A separate installation adds 200MB+ of native binaries, doubles startup time, and introduces the OOM installer bug (issue #22536).
- **Storing PEM key as plaintext in Azure secrets**: Newlines get mangled. Base64-encode the key; the app's `loadPrivateKey()` already handles base64 decoding.
- **Scale-to-zero for webhook receivers**: GitHub expects webhook URLs to respond quickly. If the container is scaled to zero, the first webhook after scale-down will timeout (cold start can take 10-30 seconds). Use `--min-replicas 1`.
- **Using `docker.io` public images in Container Apps**: ACR with managed identity provides faster, authenticated pulls with no rate limiting.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Container image registry | Self-hosted registry | Azure Container Registry (Basic SKU) | Managed, integrated with Container Apps via managed identity, ~$5/month |
| SSL/TLS termination | nginx reverse proxy, cert management | Azure Container Apps ingress | Automatic HTTPS with managed certificates |
| Health check infrastructure | Custom monitoring scripts | Container Apps health probes | Built-in liveness/readiness/startup probes with automatic restart |
| Secret rotation | Custom secret management | Azure Container Apps secrets (+ Key Vault for v2) | Scoped to app, referenced in env vars via secretref: |
| Process supervision | supervisord, pm2 | Container Apps + Dockerfile CMD | Container runtime handles restarts on probe failure |

**Key insight:** Azure Container Apps handles TLS, health monitoring, restarts, and scaling. The Dockerfile just needs to run the app correctly.

## Common Pitfalls

### Pitfall 1: Claude Code CLI OOM During Docker Build
**What goes wrong:** Running `curl -fsSL https://claude.ai/install.sh | bash` as root in a Dockerfile causes OOM kill due to the installer scanning the current directory tree (issue #22536, regression since 2026-02-02).
**Why it happens:** The install script's binary recursively scans the working directory when run from `/`.
**How to avoid:** Don't install the CLI at all -- the agent-sdk bundles `cli.js`. If for any reason a native CLI is needed, run the installer from an empty temp directory.
**Warning signs:** Docker build killed with signal 9, OOM messages in dmesg.

### Pitfall 2: Multiline PEM Key in Azure Secrets
**What goes wrong:** The GitHub App private key is a multiline PEM. Passing it directly to `az containerapp create --secrets` mangles newlines.
**Why it happens:** CLI argument parsing strips or escapes newline characters.
**How to avoid:** Base64-encode the PEM before storing: `base64 -w0 < private-key.pem`. The app's `loadPrivateKey()` in `src/config.ts` already handles base64 input (lines 45-51: tries `atob()` as last resort).
**Warning signs:** `GITHUB_PRIVATE_KEY is not a valid PEM string` error on startup; JWT signature failures.

### Pitfall 3: Scale-to-Zero Losing Webhooks
**What goes wrong:** Container scaled to zero, GitHub sends webhook, cold start takes 15+ seconds, GitHub times out and retries.
**Why it happens:** Azure Container Apps cold start includes pulling the image (if evicted) and starting the container.
**How to avoid:** Set `--min-replicas 1`. Cost is minimal (~$5/month for a single idle container). GitHub's webhook timeout is 10 seconds.
**Warning signs:** GitHub webhook delivery logs showing timeouts; duplicate event processing from retries.

### Pitfall 4: Missing git in Alpine Container
**What goes wrong:** Workspace manager's `git clone` command fails with "git: not found".
**Why it happens:** Alpine base images don't include git by default.
**How to avoid:** `RUN apk add --no-cache git` in the Dockerfile.
**Warning signs:** `Bun.$` shell errors during workspace creation; error contains "not found" or ENOENT.

### Pitfall 5: Running as Root in Container
**What goes wrong:** Security vulnerability -- if the application or Claude CLI is compromised, the attacker has root access.
**Why it happens:** Default Docker user is root.
**How to avoid:** Use `USER bun` in the Dockerfile. The `oven/bun` images include a `bun` user. Ensure `/tmp` is writable (it is by default).
**Warning signs:** Container scanning tools flagging root user; security audit failures.

### Pitfall 6: Forgetting CLAUDE_CODE_OAUTH_TOKEN
**What goes wrong:** The executor runs the Claude CLI, but it fails to authenticate because no OAuth token is present.
**Why it happens:** The app doesn't explicitly reference `CLAUDE_CODE_OAUTH_TOKEN` in `src/config.ts` -- it passes `...process.env` to the CLI subprocess (executor.ts line 93-95). Easy to forget when configuring secrets.
**How to avoid:** Add `CLAUDE_CODE_OAUTH_TOKEN` to Azure Container Apps secrets and reference it as an env var. Document it alongside the other 3 required secrets.
**Warning signs:** Claude CLI authentication errors; executor returns error conclusion.

### Pitfall 7: Frozen Lockfile Mismatch
**What goes wrong:** `bun install --frozen-lockfile` fails in Docker build because `bun.lock` is out of sync with `package.json`.
**Why it happens:** Developer added/updated a dependency but didn't commit the updated lockfile.
**How to avoid:** Always commit `bun.lock` after dependency changes. The frozen lockfile flag ensures reproducible builds.
**Warning signs:** Docker build fails at `bun install` step with lockfile mismatch error.

## Code Examples

### Dockerfile (Complete)

```dockerfile
# Source: Bun Docker guide (https://bun.com/docs/guides/ecosystem/docker)
# + project-specific requirements

# Stage 1: Install production dependencies
FROM oven/bun:1-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile

# Stage 2: Production image
FROM oven/bun:1-alpine

# git is required for workspace manager (git clone)
RUN apk add --no-cache git

WORKDIR /app

# Copy production dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source
COPY package.json bun.lock tsconfig.json ./
COPY src/ ./src/

# Run as non-root user (oven/bun images include 'bun' user)
USER bun

EXPOSE 3000

CMD ["bun", "run", "src/index.ts"]
```

### .dockerignore

```
node_modules
.git
.gitignore
tmp/
.planning/
*.md
!package.json
.env
.env.*
Dockerfile
docker-compose.yml
```

### Azure Container Apps Provisioning Script

```bash
#!/bin/bash
# Source: Azure Container Apps docs
# (https://learn.microsoft.com/en-us/azure/container-apps/tutorial-code-to-cloud)

set -euo pipefail

# Configuration
RESOURCE_GROUP="rg-kodiai"
LOCATION="eastus"   # or your preferred region
ENVIRONMENT="cae-kodiai"
APP_NAME="ca-kodiai"
ACR_NAME="kodiairegistry"  # must be globally unique
IDENTITY_NAME="id-kodiai"

# Ensure CLI extensions
az extension add --name containerapp --upgrade -y
az provider register --namespace Microsoft.App --wait
az provider register --namespace Microsoft.OperationalInsights --wait

# Create resource group
az group create --name $RESOURCE_GROUP --location "$LOCATION"

# Create ACR
az acr create \
  --resource-group $RESOURCE_GROUP \
  --name $ACR_NAME \
  --sku Basic \
  --location "$LOCATION"

# Create managed identity for ACR pull
az identity create \
  --name $IDENTITY_NAME \
  --resource-group $RESOURCE_GROUP

IDENTITY_ID=$(az identity show \
  --name $IDENTITY_NAME \
  --resource-group $RESOURCE_GROUP \
  --query id --output tsv)

# Grant identity AcrPull role
ACR_ID=$(az acr show --name $ACR_NAME --query id --output tsv)
IDENTITY_PRINCIPAL=$(az identity show \
  --name $IDENTITY_NAME \
  --resource-group $RESOURCE_GROUP \
  --query principalId --output tsv)

az role assignment create \
  --assignee $IDENTITY_PRINCIPAL \
  --role AcrPull \
  --scope $ACR_ID

# Build and push image to ACR
az acr build \
  --registry $ACR_NAME \
  --image kodiai:latest \
  .

# Create Container Apps environment
az containerapp env create \
  --name $ENVIRONMENT \
  --resource-group $RESOURCE_GROUP \
  --location "$LOCATION"

# Deploy container app with secrets and env vars
# NOTE: GITHUB_PRIVATE_KEY must be base64-encoded PEM
az containerapp create \
  --name $APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --environment $ENVIRONMENT \
  --image "$ACR_NAME.azurecr.io/kodiai:latest" \
  --user-assigned "$IDENTITY_ID" \
  --registry-server "$ACR_NAME.azurecr.io" \
  --registry-identity "$IDENTITY_ID" \
  --target-port 3000 \
  --ingress external \
  --min-replicas 1 \
  --max-replicas 1 \
  --secrets \
    "github-app-id=$GITHUB_APP_ID" \
    "github-private-key=$GITHUB_PRIVATE_KEY_BASE64" \
    "github-webhook-secret=$GITHUB_WEBHOOK_SECRET" \
    "claude-oauth-token=$CLAUDE_CODE_OAUTH_TOKEN" \
  --env-vars \
    "GITHUB_APP_ID=secretref:github-app-id" \
    "GITHUB_PRIVATE_KEY=secretref:github-private-key" \
    "GITHUB_WEBHOOK_SECRET=secretref:github-webhook-secret" \
    "CLAUDE_CODE_OAUTH_TOKEN=secretref:claude-oauth-token" \
    "PORT=3000" \
    "LOG_LEVEL=info" \
  --query properties.configuration.ingress.fqdn
```

### Health Probe Configuration (YAML)

```yaml
# Azure Container Apps health probe config
# Applied via az containerapp update --yaml
properties:
  template:
    containers:
      - name: kodiai
        probes:
          - type: Liveness
            httpGet:
              path: /health
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
              path: /health
              port: 3000
            initialDelaySeconds: 3
            periodSeconds: 3
            failureThreshold: 30
```

### Local Docker Build and Test

```bash
# Build
docker build -t kodiai:local .

# Test run (requires .env with secrets)
docker run --rm -p 3000:3000 \
  -e GITHUB_APP_ID="$GITHUB_APP_ID" \
  -e GITHUB_PRIVATE_KEY="$GITHUB_PRIVATE_KEY" \
  -e GITHUB_WEBHOOK_SECRET="$GITHUB_WEBHOOK_SECRET" \
  -e CLAUDE_CODE_OAUTH_TOKEN="$CLAUDE_CODE_OAUTH_TOKEN" \
  kodiai:local

# Verify health
curl http://localhost:3000/health
# Expected: {"status":"ok"}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Install Claude CLI via `curl` in Docker | Agent SDK bundles `cli.js` -- no separate install | Agent SDK v0.2.x (2025-2026) | Eliminates 200MB+ native binary, avoids OOM installer bug |
| `npm install -g @anthropic-ai/claude-code` in Docker | Use agent-sdk bundled CLI or native installer | 2025 (npm deprecated for CLI) | npm installation is deprecated; native installer or SDK bundle preferred |
| Docker Hub for Azure Container Apps | ACR with managed identity | 2024+ | Faster pulls, no rate limiting, native auth integration |
| Manually manage TLS certs | Container Apps managed certificates | Container Apps GA | Automatic HTTPS, no cert renewal burden |

**Deprecated/outdated:**
- `npm install -g @anthropic-ai/claude-code`: Deprecated in favor of native installer (`curl -fsSL https://claude.ai/install.sh | bash`). However, neither is needed when using the agent-sdk which bundles the CLI.
- Docker Compose for Azure deployment: Use `az containerapp` CLI directly or Infrastructure as Code (Bicep/Terraform).

## Environment Variables Reference

| Variable | Required | Source | Default | Notes |
|----------|----------|--------|---------|-------|
| `GITHUB_APP_ID` | Yes | Azure secret | - | GitHub App numeric ID |
| `GITHUB_PRIVATE_KEY` | Yes | Azure secret | - | PEM string, file path, or base64-encoded |
| `GITHUB_WEBHOOK_SECRET` | Yes | Azure secret | - | Secret for HMAC-SHA256 verification |
| `CLAUDE_CODE_OAUTH_TOKEN` | Yes | Azure secret | - | Claude Max OAuth token (sk-ant-oat01-...) |
| `PORT` | No | Env var | 3000 | Server listen port |
| `LOG_LEVEL` | No | Env var | info | Pino log level |
| `BOT_ALLOW_LIST` | No | Env var | "" | Comma-separated bot usernames to allow |

## Open Questions

1. **Alpine musl compatibility with agent-sdk ripgrep at runtime**
   - What we know: The agent-sdk `manifest.json` lists `linux-x64-musl` as a supported platform. The vendored `ripgrep/x64-linux/rg` binary is statically linked (works on musl), but `ripgrep.node` is dynamically linked against glibc (`libc.so.6`, `ld-linux-x86-64.so.2`). However, the `cli.js` bundle detects Bun via `Bun.embeddedFiles` and uses "bundled" mode for ripgrep when running under Bun (instead of the native `.node` addon). The CLI also has explicit musl detection (`isMuslEnvironment`) and platform resolution (`linux-${arch}-musl`).
   - What's unclear: Whether the "bundled" ripgrep mode under Bun is fully functional on Alpine, or whether there are edge cases. The sharp optional dependency has explicit musl variants (`@img/sharp-linuxmusl-x64`) which suggests the ecosystem accounts for musl.
   - Recommendation: Build with Alpine first. The evidence strongly suggests it will work (musl detection, bundled ripgrep for Bun, sharp musl variants). Fall back to `oven/bun:1-debian-slim` only if runtime testing reveals issues. Test by running a simple Claude CLI query inside the container.

2. **GitHub App registration**
   - What we know: The app needs permissions (contents:write, issues:write, pull_requests:write, actions:read, metadata:read, checks:read) and event subscriptions (issue_comment, issues, pull_request, pull_request_review, pull_request_review_comment).
   - What's unclear: App registration is a manual GitHub UI step -- not automatable in the deployment script.
   - Recommendation: Document the registration steps as prerequisites. The webhook URL is the Container App's FQDN + `/webhooks/github`.

3. **CLAUDE_CODE_OAUTH_TOKEN acquisition**
   - What we know: The token format is `sk-ant-oat01-...`. It can be obtained via `claude setup-token` which opens a browser for OAuth flow.
   - What's unclear: Token expiry/refresh policy. Whether the token needs periodic rotation.
   - Recommendation: Generate the token once, store as Azure secret. Monitor for auth failures in logs that would indicate token expiry.

## Sources

### Primary (HIGH confidence)
- `@anthropic-ai/claude-agent-sdk` v0.2.37 package inspection -- `manifest.json` confirms linux-x64-musl support, `sdk.mjs` source confirms cli.js resolution, `cli.js` source confirms musl detection and bundled ripgrep for Bun, `package.json` shows no postinstall hooks
- Azure Container Apps official docs (https://learn.microsoft.com/en-us/azure/container-apps/) -- secrets management, environment variables, health probes, scaling, ingress
- Bun Docker guide (https://bun.com/docs/guides/ecosystem/docker) -- multi-stage build pattern, USER bun, Alpine support
- Claude Agent SDK hosting guide (https://platform.claude.com/docs/en/agent-sdk/hosting) -- container deployment patterns, system requirements (1GiB RAM, 5GiB disk, 1 CPU recommended)
- Existing codebase inspection -- `src/config.ts` loadPrivateKey() handles PEM/file/base64, `src/execution/executor.ts` passes `...process.env` to CLI

### Secondary (MEDIUM confidence)
- Docker Hub oven/bun tags (https://hub.docker.com/r/oven/bun/tags) -- verified Alpine tags exist (1-alpine, 1.2.0-alpine)
- Azure Container Apps tutorial (https://learn.microsoft.com/en-us/azure/container-apps/tutorial-code-to-cloud) -- full deployment workflow with ACR and managed identity
- Claude Code devcontainer Dockerfile (https://github.com/anthropics/claude-code/blob/main/.devcontainer/Dockerfile) -- uses Node.js 20 + `npm install -g @anthropic-ai/claude-code` (NOT needed for our use case since we use agent-sdk)

### Tertiary (LOW confidence)
- Claude Code installer OOM bug (https://github.com/anthropics/claude-code/issues/22536) -- open issue, workaround known but bug not yet fixed
- Agent SDK spawn ENOENT issue (https://github.com/anthropics/claude-code/issues/14464) -- open issue with pathToClaudeCodeExecutable; we avoid this by using the default cli.js resolution

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- Docker image tags verified on Docker Hub, Azure CLI commands verified against official docs, agent-sdk internals inspected directly
- Architecture: HIGH -- Dockerfile pattern from official Bun docs, Azure provisioning from official tutorial, health probe config from official docs
- Pitfalls: HIGH -- OOM bug verified via GitHub issue, PEM handling verified in source code, scale-to-zero behavior documented in Azure docs
- Open questions: MEDIUM -- Alpine musl runtime behavior needs empirical testing, but evidence strongly favors compatibility (musl detection code, bundled ripgrep for Bun, sharp musl variants)

**Research date:** 2026-02-08
**Valid until:** 2026-03-08 (stable infrastructure, 30-day validity)
