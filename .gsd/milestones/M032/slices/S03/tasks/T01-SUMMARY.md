---
id: T01
parent: S03
milestone: M032
provides: []
requires: []
affects: []
key_files: ["src/jobs/aca-launcher.ts", "src/jobs/aca-launcher.test.ts", "src/config.ts", "Dockerfile.agent", "deploy.sh", "src/routes/slack-events.test.ts", "src/routes/slack-commands.test.ts"]
key_decisions: ["cancelAcaJob wraps az --output none and returns void, logs at info after completion", "acaResourceGroup/acaJobName default to deploy.sh provisioned names so zero-config deployments work", "Dockerfile.agent is structurally identical to Dockerfile except no EXPOSE and different CMD"]
patterns_established: []
drill_down_paths: []
observability_surfaces: []
duration: ""
verification_result: "bun test ./src/jobs/aca-launcher.test.ts — 21 pass, 0 fail. bun run tsc --noEmit — exit 0. bash -n Dockerfile.agent — exit 0."
completed_at: 2026-03-29T19:04:40.035Z
blocker_discovered: false
---

# T01: Add cancelAcaJob(), acaResourceGroup/acaJobName config fields, Dockerfile.agent, and fix deploy.sh agent build target

> Add cancelAcaJob(), acaResourceGroup/acaJobName config fields, Dockerfile.agent, and fix deploy.sh agent build target

## What Happened
---
id: T01
parent: S03
milestone: M032
key_files:
  - src/jobs/aca-launcher.ts
  - src/jobs/aca-launcher.test.ts
  - src/config.ts
  - Dockerfile.agent
  - deploy.sh
  - src/routes/slack-events.test.ts
  - src/routes/slack-commands.test.ts
key_decisions:
  - cancelAcaJob wraps az --output none and returns void, logs at info after completion
  - acaResourceGroup/acaJobName default to deploy.sh provisioned names so zero-config deployments work
  - Dockerfile.agent is structurally identical to Dockerfile except no EXPOSE and different CMD
duration: ""
verification_result: passed
completed_at: 2026-03-29T19:04:40.035Z
blocker_discovered: false
---

# T01: Add cancelAcaJob(), acaResourceGroup/acaJobName config fields, Dockerfile.agent, and fix deploy.sh agent build target

**Add cancelAcaJob(), acaResourceGroup/acaJobName config fields, Dockerfile.agent, and fix deploy.sh agent build target**

## What Happened

Added cancelAcaJob() to aca-launcher.ts wrapping `az containerapp job execution stop`. Added acaResourceGroup (default 'rg-kodiai') and acaJobName (default 'caj-kodiai-agent') to configSchema and loadConfig. Created Dockerfile.agent with agent-entrypoint.ts CMD and no EXPOSE. Updated deploy.sh agent build to use --file Dockerfile.agent. Fixed AppConfig stubs in 2 test files and 8 scripts to include the new fields.

## Verification

bun test ./src/jobs/aca-launcher.test.ts — 21 pass, 0 fail. bun run tsc --noEmit — exit 0. bash -n Dockerfile.agent — exit 0.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/jobs/aca-launcher.test.ts` | 0 | ✅ pass | 67ms |
| 2 | `bun run tsc --noEmit` | 0 | ✅ pass | 7700ms |
| 3 | `bash -n Dockerfile.agent` | 0 | ✅ pass | 50ms |


## Deviations

Updated 8 additional script-level AppConfig stubs beyond the 2 test files in the plan — required by the tsc --noEmit gate (KNOWLEDGE.md pattern).

## Known Issues

None.

## Files Created/Modified

- `src/jobs/aca-launcher.ts`
- `src/jobs/aca-launcher.test.ts`
- `src/config.ts`
- `Dockerfile.agent`
- `deploy.sh`
- `src/routes/slack-events.test.ts`
- `src/routes/slack-commands.test.ts`


## Deviations
Updated 8 additional script-level AppConfig stubs beyond the 2 test files in the plan — required by the tsc --noEmit gate (KNOWLEDGE.md pattern).

## Known Issues
None.
