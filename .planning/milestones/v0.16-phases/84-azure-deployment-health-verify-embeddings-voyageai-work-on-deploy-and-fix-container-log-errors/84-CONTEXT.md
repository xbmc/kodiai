# Phase 84: Azure Deployment Health - Context

**Gathered:** 2026-02-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Verify embeddings/VoyageAI work in the deployed Azure environment, add a startup smoke test, triage container log errors, and fix critical issues. Graceful degradation already exists from earlier phases — this phase confirms the deploy is healthy and clean.

</domain>

<decisions>
## Implementation Decisions

### Embeddings verification
- This is investigation-first: determine whether VoyageAI embeddings actually work in the deployed environment
- Embeddings are used in multiple features (code search, Slack answers, issue analysis)
- Add a startup smoke test that runs on container boot and logs pass/fail before accepting traffic
- If smoke test fails: log clearly and continue (embeddings are degraded, not fatal)
- Graceful degradation path already exists from earlier phases — no need to build that

### Container log errors
- Purely investigative: deploy, read logs, triage what's found
- Check both Azure Container Apps logs and Docker stdout/stderr
- App is currently deployed and running — this is about cleaning up errors, not fixing a broken deploy
- Triage and categorize: fix critical errors that indicate broken functionality, document the rest for later
- Fix critical issues found during triage and redeploy as part of this phase

### Success bar
- VoyageAI confirmed working in deployed environment
- Clean startup (no error-level output on boot)
- Runtime warnings are acceptable if documented
- Startup smoke test for embeddings runs automatically on container boot

### Claude's Discretion
- Smoke test implementation details (what to embed, timeout thresholds)
- How to structure the log triage findings
- Which log errors are "critical" vs "cosmetic" based on investigation
- Deploy script improvements if needed

</decisions>

<specifics>
## Specific Ideas

- Run deploy.sh and copy the container logs as the starting point for investigation
- Smoke test should run on container startup, not as a separate manual script

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 84-azure-deployment-health-verify-embeddings-voyageai-work-on-deploy-and-fix-container-log-errors*
*Context gathered: 2026-02-19*
