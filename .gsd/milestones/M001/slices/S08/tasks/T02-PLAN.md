# T02: 08-deployment 02

**Slice:** S08 — **Milestone:** M001

## Description

Create a deployment script for Azure Container Apps and guide the user through provisioning, GitHub App registration, and end-to-end verification.

Purpose: The application needs to run in production on Azure Container Apps with proper secrets management, health probes, and external ingress so GitHub can deliver webhooks.

Output: A `deploy.sh` script at project root, Azure resources provisioned, and the application running and receiving webhooks.

## Must-Haves

- [ ] "A deployment script exists that provisions all Azure resources and deploys the container"
- [ ] "The script creates ACR, managed identity, Container Apps environment, and the container app with secrets"
- [ ] "Health probes are configured for /health (liveness) and /readiness (readiness)"
- [ ] "The container runs with min-replicas 1 to avoid webhook timeouts from cold starts"
- [ ] "All 4 required secrets are injected as environment variables via Azure secretref"

## Files

- `deploy.sh`
