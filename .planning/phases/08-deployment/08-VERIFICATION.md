---
phase: 08-deployment
verified: 2026-02-09T16:54:35Z
status: human_needed
score: 6/7 must-haves verified
human_verification:
  - test: "PR open triggers inline review comments in production"
    expected: "Opening a PR on a repo where the GitHub App is installed triggers a review within ~2 minutes and inline review comments appear on diff lines (or the PR is silently approved if clean)."
    why_human: "Requires real GitHub webhook delivery + GitHub API side effects; not verifiable purely from local code inspection."
  - test: "deploy.sh works from a fresh Azure subscription"
    expected: "Running ./deploy.sh provisions RG/ACR/identity/Container Apps env/app, configures secrets + probes, and ends with a reachable FQDN."
    why_human: "Depends on Azure subscription state/provider registration and cannot be safely executed from this verifier environment."
---

# Phase 8: Deployment Verification Report

Phase Goal: The application is packaged as a Docker container and deployed to Azure Container Apps with proper secrets management, running end-to-end in production.

Verified: 2026-02-09T16:54:35Z

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | The application builds as a Docker container using `oven/bun:1-alpine` | ✓ VERIFIED | `Dockerfile` uses `FROM oven/bun:1-alpine` (deps + runtime stages) and `docker build -t kodiai:verify .` succeeded locally |
| 2 | The container runs as non-root user `bun` | ✓ VERIFIED | `Dockerfile` sets `USER bun`; `docker run --rm kodiai:verify whoami` outputs `bun` |
| 3 | `git` is available inside the container | ✓ VERIFIED | `Dockerfile` installs via `apk add --no-cache git`; `docker run --rm kodiai:verify git --version` succeeds |
| 4 | Docker build context excludes development artifacts (no `.git/`, `.planning/`, `tmp/`, `.env*`) | ✓ VERIFIED | `.dockerignore` includes `.git`, `.planning/`, `tmp/`, `.env`, `.env.*`; `Dockerfile` only copies `package.json`, `bun.lock`, `tsconfig.json`, and `src/` |
| 5 | Health endpoints are live and respond in the deployed environment | ✓ VERIFIED | `src/routes/health.ts` defines `/health` + `/readiness` and `src/index.ts` mounts them; `https://ca-kodiai.agreeableisland-d347f806.eastus.azurecontainerapps.io/health` returns `{\"status\":\"ok\"}` and `/readiness` returns `{\"status\":\"ready\"}` |
| 6 | A deployment script exists that deploys to Azure Container Apps with secrets + probes + always-on min replicas | ✓ VERIFIED | `deploy.sh` provisions RG/ACR/identity/Container Apps env/app, injects 4 secrets via `secretref:`, sets `--min-replicas 1`, configures probes for `/health` and `/readiness` |
| 7 | A real PR opened on an installed repo triggers inline review comments in production | ? HUMAN NEEDED | Code path exists (`src/index.ts` wires `createReviewHandler(...)`), but production-side webhook + GitHub API side effects must be tested with a real PR |

Score: 6/7 truths verified

## Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `Dockerfile` | Multi-stage Bun image build + non-root runtime | ✓ VERIFIED | Includes `bun install --production --frozen-lockfile`, `apk add git`, `USER bun`, `CMD ["bun","run","src/index.ts"]` |
| `.dockerignore` | Exclude dev-only files from Docker context | ✓ VERIFIED | Excludes `node_modules`, `.git`, `tmp/`, `.planning/`, `*.md`, `.env*`, build outputs |
| `deploy.sh` | Azure Container Apps provisioning + deployment | ✓ VERIFIED | Uses `az acr build`, `az containerapp create`, secrets + `secretref:` env vars, and YAML-based probes |
| `src/routes/health.ts` | `/health` and `/readiness` endpoints | ✓ VERIFIED | `/health` returns 200; `/readiness` checks `githubApp.checkConnectivity()` and returns 200/503 |

## Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| `Dockerfile` | `src/index.ts` | `CMD ["bun","run","src/index.ts"]` | ✓ WIRED | Container entrypoint starts the server |
| `Dockerfile` | `package.json` / `bun.lock` | `COPY package.json bun.lock` + `bun install --production` | ✓ WIRED | Dependency install occurs in deps stage |
| `deploy.sh` | `Dockerfile` | `az acr build ... .` | ✓ WIRED | Remote ACR build uses repo Dockerfile + context |
| `deploy.sh` | `src/routes/health.ts` | Health probe paths `/health` + `/readiness` | ✓ WIRED | Probes configured to the same paths the server mounts |
| `src/index.ts` | `src/handlers/review.ts` | `createReviewHandler(...)` registration | ✓ WIRED | Review handler is registered on boot |

## Requirements Coverage

| Requirement | Status | Blocking Issue |
| --- | --- | --- |
| OPS-04: Application packaged as Docker container | ✓ SATISFIED | - |
| OPS-05: Deployed to Azure Container Apps with secrets management | ? NEEDS HUMAN | Confirm PR-triggered inline reviews in production (roadmap success criterion #3) |

## Anti-Patterns Found

No obvious stubs/placeholder implementations in phase-owned artifacts (`Dockerfile`, `.dockerignore`, `deploy.sh`).

Note: `deploy.sh` registers Microsoft.App and Microsoft.OperationalInsights providers, but does not explicitly register Microsoft.ContainerRegistry (ACR). Some subscriptions require this before `az acr create` will succeed.

## Human Verification Required

### 1. PR Review End-to-End (Production)

Test: Open a PR on a repo where the GitHub App is installed.
Expected: Inline review comments appear on the diff (or silent approval for clean PRs) within ~2 minutes.
Why human: Requires real GitHub webhook delivery and GitHub API side effects.

### 2. Fresh Azure Provisioning Run

Test: In a fresh subscription/tenant, run `./deploy.sh` with the 4 required env vars.
Expected: Script completes, prints an FQDN, and `https://{FQDN}/health` + `https://{FQDN}/readiness` respond 200.
Why human: Depends on Azure account state/provider registration and cannot be executed here.

---

Verified: 2026-02-09T16:54:35Z
Verifier: Claude (gsd-verifier)
