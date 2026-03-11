# S03: Azure Deployment Health Verify Embeddings Voyageai Work On Deploy And Fix Container Log Errors

**Goal:** Add an embeddings startup smoke test and fix deploy.
**Demo:** Add an embeddings startup smoke test and fix deploy.

## Must-Haves


## Tasks

- [x] **T01: 84-azure-deployment-health-verify-embeddings-voyageai-work-on-deploy-and-fix-container-log-errors 01** `est:2min`
  - Add an embeddings startup smoke test and fix deploy.sh to pass all required environment variables.

Purpose: The deployed container needs VOYAGE_API_KEY and Slack secrets passed through, and needs a smoke test that confirms embeddings work on each boot so operators know immediately if VoyageAI is functional.

Output: Updated src/index.ts with smoke test, updated deploy.sh with complete env var passthrough.
- [x] **T02: 84-azure-deployment-health-verify-embeddings-voyageai-work-on-deploy-and-fix-container-log-errors 02** `est:5min`
  - Deploy to Azure, verify embeddings smoke test passes, and triage container log errors.

Purpose: Confirm the deployed environment is healthy -- VoyageAI works, startup is clean, and any log errors are triaged and fixed (critical) or documented (cosmetic).

Output: Healthy deployment with confirmed embeddings, clean startup logs.

## Files Likely Touched

- `src/index.ts`
- `deploy.sh`
