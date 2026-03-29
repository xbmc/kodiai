# M032: 

## Vision
Replace the vulnerable in-process agent execution with an ephemeral Azure Container Apps Job, ensuring the agent process never holds application secrets in its environment, /proc filesystem, or any inherited process state — making prompt-injection-to-secret-exfiltration a structurally impossible attack path.

## Slice Overview
| ID | Slice | Risk | Depends | Done | After this |
|----|-------|------|---------|------|------------|
| S01 | ACA Job + Azure Files Infrastructure | high | — | ✅ | After S01: bun run scripts/test-aca-job.ts → ACA Job spawns, runs trivial script, writes result.json, orchestrator reads it back → cold start timing printed → contract check: job spec object has no application secret key names anywhere in its env array. |
| S02 | MCP HTTP Server in Orchestrator | medium | S01 | ✅ | After S02: curl -H 'Authorization: Bearer <valid-token>' http://localhost:PORT/internal/mcp/github_comment → MCP JSON response; same curl without token → 401; wrong token → 401. All 7 server routes respond. |
| S03 | Agent Job Entrypoint + Executor Refactor | medium | S01, S02 | ✅ | After S03: @kodiai mention in a GitHub PR → ACA Job appears in Azure portal executions list → job completes → GitHub comment posted with agent response. Job container env inspection (via Azure portal or job logs): only ANTHROPIC_API_KEY, MCP_BEARER_TOKEN, WORKSPACE_DIR, GITHUB_INSTALLATION_TOKEN present. |
| S04 | verify:m032 Proof Harness + Deploy Updates | low | S01, S02, S03 | ⬜ | After S04: bun run verify:m032 → all checks pass, exits 0. ./deploy.sh run against existing env → all Azure resources verified/created, exits 0 (idempotent re-run succeeds). |
