# S08: Deployment

**Goal:** Create the Dockerfile and .
**Demo:** Create the Dockerfile and .

## Must-Haves


## Tasks

- [x] **T01: 08-deployment 01** `est:1min`
  - Create the Dockerfile and .dockerignore for the kodiai application, then verify the image builds and runs correctly locally.

Purpose: The application needs a Docker container for deployment to Azure Container Apps. The Dockerfile uses a multi-stage build with `oven/bun:1-alpine` to keep the image small while including all runtime dependencies (git for workspace cloning, production node_modules including the bundled Claude CLI via agent-sdk).

Output: A buildable Dockerfile and .dockerignore at project root. The image is verified to build and the health endpoint responds.
- [x] **T02: 08-deployment 02** `est:15min`
  - Create a deployment script for Azure Container Apps and guide the user through provisioning, GitHub App registration, and end-to-end verification.

Purpose: The application needs to run in production on Azure Container Apps with proper secrets management, health probes, and external ingress so GitHub can deliver webhooks.

Output: A `deploy.sh` script at project root, Azure resources provisioned, and the application running and receiving webhooks.

## Files Likely Touched

- `Dockerfile`
- `.dockerignore`
- `deploy.sh`
