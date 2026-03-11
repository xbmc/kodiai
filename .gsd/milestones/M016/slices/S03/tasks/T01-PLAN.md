# T01: 84-azure-deployment-health-verify-embeddings-voyageai-work-on-deploy-and-fix-container-log-errors 01

**Slice:** S03 — **Milestone:** M016

## Description

Add an embeddings startup smoke test and fix deploy.sh to pass all required environment variables.

Purpose: The deployed container needs VOYAGE_API_KEY and Slack secrets passed through, and needs a smoke test that confirms embeddings work on each boot so operators know immediately if VoyageAI is functional.

Output: Updated src/index.ts with smoke test, updated deploy.sh with complete env var passthrough.

## Must-Haves

- [ ] "Embeddings smoke test runs automatically on container boot and logs pass/fail"
- [ ] "Smoke test failure does not prevent the server from starting (non-fatal)"
- [ ] "deploy.sh passes VOYAGE_API_KEY and Slack env vars to Azure Container Apps"

## Files

- `src/index.ts`
- `deploy.sh`
