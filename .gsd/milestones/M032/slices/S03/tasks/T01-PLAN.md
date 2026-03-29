---
estimated_steps: 5
estimated_files: 7
skills_used: []
---

# T01: cancelAcaJob, config additions, and Dockerfile.agent

Three small additions that unblock T02 and T03:
1. Add cancelAcaJob() to src/jobs/aca-launcher.ts — thin wrapper around `az containerapp job execution stop`. Signature: `{ resourceGroup, jobName, executionName, logger? }`. Logs at info level after cancellation.
2. Add acaResourceGroup and acaJobName to configSchema in src/config.ts (Zod string with defaults 'rg-kodiai' and 'caj-kodiai-agent'). Add to loadConfig() input object reading from process.env.ACA_RESOURCE_GROUP and process.env.ACA_JOB_NAME. Update AppConfig stubs in test files that need the new fields (check src/routes/slack-events.test.ts and src/routes/slack-commands.test.ts).
3. Create Dockerfile.agent — same base as Dockerfile (oven/bun:1-debian), same git/python3/kodi-addon-checker layer, same src/ copy pattern, but CMD is 'bun run src/execution/agent-entrypoint.ts' instead of 'src/index.ts'. No EXPOSE — the agent job has no incoming ports.
4. Update deploy.sh: the agent image build section already targets kodiai-agent:latest but uses the main Dockerfile (or no --file flag). Change it to `az acr build ... --image kodiai-agent:latest --file Dockerfile.agent .` so the agent image gets the correct entrypoint.

## Inputs

- ``src/jobs/aca-launcher.ts` — add cancelAcaJob() export`
- ``src/config.ts` — add acaResourceGroup and acaJobName fields`

## Expected Output

- ``src/jobs/aca-launcher.ts` — cancelAcaJob() export added`
- ``src/config.ts` — acaResourceGroup and acaJobName in configSchema and loadConfig`
- ``Dockerfile.agent` — new file with agent entrypoint CMD`
- ``deploy.sh` — agent image build uses --file Dockerfile.agent`

## Verification

bun test ./src/jobs/aca-launcher.test.ts && bun run tsc --noEmit && bash -n Dockerfile.agent
