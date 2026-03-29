---
id: S01
parent: M032
milestone: M032
provides:
  - src/jobs/aca-launcher.ts — buildAcaJobSpec, launchAcaJob, pollUntilComplete, readJobResult, APPLICATION_SECRET_NAMES
  - src/jobs/workspace.ts — createAzureFilesWorkspaceDir
  - scripts/test-aca-job.ts — runnable contract check and live smoke test
  - deploy.sh — Storage Account, Azure Files share, ACA env mount, ACA Job create/update sections
  - Security contract: job spec env array structurally cannot contain application secrets at build time
requires:
  []
affects:
  - S02 (MCP HTTP Server in Orchestrator) — depends on S01 launcher module for job dispatch integration
  - S03 (Agent Job Entrypoint + Executor Refactor) — depends on S01 for workspace and launcher primitives
  - S04 (verify:m032 Proof Harness + Deploy Updates) — depends on S01 for APPLICATION_SECRET_NAMES contract to verify against
key_files:
  - src/jobs/aca-launcher.ts
  - src/jobs/aca-launcher.test.ts
  - src/jobs/workspace.ts
  - scripts/test-aca-job.ts
  - deploy.sh
key_decisions:
  - launchAcaJob passes env overrides as --env-vars KEY=VALUE pairs (az CLI convention, not JSON)
  - pollUntilComplete parses both properties.status and top-level status for forward API compatibility
  - buildAcaJobSpec runtime guard throws at build time — fail-loud security contract rather than silent filtering
  - readJobResult failure in live smoke test is non-fatal — smoke container may not write result.json
  - STORAGE_KEY captured once and reused by both ACA env storage set and ACA Job create in deploy.sh
patterns_established:
  - Two-phase smoke-test pattern: pure-code contract check (always runs) + live gate behind missing-env guard (skips gracefully)
  - APPLICATION_SECRET_NAMES as exported readonly constant — the security contract is a named artifact, not an inline list
  - ACA Job env-var passing: spec.env.flatMap(e => ['--env-vars', 'KEY=VALUE']) for Bun $ array spread
  - Dual-status-field parsing: properties.status ?? status ?? undefined for forward ACA API compatibility
observability_surfaces:
  - launchAcaJob logs dispatch at info level with executionName, jobName, workspaceDir
  - pollUntilComplete logs each poll attempt at debug and terminal states (succeeded/failed/timed-out) at info
  - test-aca-job.ts --live prints cold start timing in ms and Azure execution name for portal audit trail lookup
drill_down_paths:
  - milestones/M032/slices/S01/tasks/T01-SUMMARY.md
  - milestones/M032/slices/S01/tasks/T02-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-03-29T18:29:18.929Z
blocker_discovered: false
---

# S01: ACA Job + Azure Files Infrastructure

**Implemented the ACA Job launcher module with APPLICATION_SECRET_NAMES security contract, Azure Files workspace support, deploy.sh infrastructure provisioning, and a two-phase smoke-test script — proving the job spec env array structurally cannot contain application secrets.**

## What Happened

S01 delivered the foundational infrastructure layer for M032's agent process isolation. Two tasks, no blockers.

**T01 — ACA Job launcher module (src/jobs/aca-launcher.ts):**

The core of the slice is the security contract: `buildAcaJobSpec` builds a job env array containing only four keys (ANTHROPIC_API_KEY, MCP_BEARER_TOKEN, WORKSPACE_DIR, GITHUB_INSTALLATION_TOKEN) and throws at build time if any of the nine `APPLICATION_SECRET_NAMES` (GITHUB_PRIVATE_KEY, GITHUB_PRIVATE_KEY_BASE64, GITHUB_APP_ID, GITHUB_WEBHOOK_SECRET, DATABASE_URL, SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, VOYAGE_API_KEY, BOT_USER_PAT) appear in the constructed env array. This fail-loud pattern makes the security contract machine-checkable rather than convention-dependent.

`launchAcaJob` dispatches via `az containerapp job execution start` using `--env-vars KEY=VALUE` pairs (not JSON). `pollUntilComplete` polls `az containerapp job execution show` every 10s with configurable timeout, parsing both `properties.status` and top-level `status` fields for forward compatibility across API versions. `readJobResult` reads and JSON-parses `workspaceDir/result.json`. `createAzureFilesWorkspaceDir` was added to workspace.ts to create the per-job directory on the Azure Files mount.

16 tests covering: APPLICATION_SECRET_NAMES list integrity, spec builder env correctness (required keys present, optional keys conditional, forbidden keys absent), runtime guard behavior, result reader (happy path, missing file, invalid JSON). All 16 pass in 22ms.

**T02 — Smoke-test script + deploy.sh additions:**

`scripts/test-aca-job.ts` runs a pure-code contract check unconditionally (calling `buildAcaJobSpec` and asserting no APPLICATION_SECRET_NAMES in env), then optionally dispatches a real ACA Job when `--live` is passed and the three required env vars are set (RESOURCE_GROUP, ACA_JOB_NAME, AZURE_WORKSPACE_MOUNT). The live path polls for completion, prints cold start timing and the Azure execution name (audit trail), and attempts to read result.json (non-fatal — smoke-test container may not write it).

`deploy.sh` received four new idempotent sections: Azure Storage Account provisioning (kodiaistg, Standard_LRS), Azure Files share creation (workspaces), ACA environment storage mount (kodiai-workspaces, ReadWrite), agent image build (kodiai-agent:latest), and ACA Job create/update (caj-kodiai-agent, Manual trigger, 600s timeout, 0 retry). The orchestrator container app update also received a `--volume` flag pointing at the same Azure Files share.

Deviation from plan: `buildAcaJobSpec` requires a `jobName` parameter (not listed in the task plan inputs); the script uses `caj-kodiai-agent` to match deploy.sh. `readJobResult` failure in live mode is non-fatal by design.

**Verification results:** bun test ./src/jobs/aca-launcher.test.ts → 16/16 pass. bun run scripts/test-aca-job.ts → ✅ CONTRACT pass, exits 0. bun run tsc --noEmit → exit 0. bash -n deploy.sh → syntax clean.

## Verification

bun test ./src/jobs/aca-launcher.test.ts → 16 pass, 0 fail (22ms). bun run scripts/test-aca-job.ts → ✅ CONTRACT: no application secrets in job spec env array, exits 0. bun run tsc --noEmit → exit 0, no errors. bash -n deploy.sh → exit 0 (syntax clean).

## Requirements Advanced

None.

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

buildAcaJobSpec requires a jobName parameter not listed in the T02 plan inputs; test-aca-job.ts uses 'caj-kodiai-agent' matching deploy.sh. readJobResult failure in live mode is treated as non-fatal (warning only) since the smoke-test container may not write result.json — this is an explicit design choice, not a bug.

## Known Limitations

Live mode of scripts/test-aca-job.ts requires Azure credentials and a provisioned ACA Job — not runnable in CI without those env vars. The live path skips gracefully when env vars are absent. pollUntilComplete and launchAcaJob are not unit-testable without a real az CLI or a mock subprocess — integration tests against a live ACA Job are deferred to operator-executed smoke tests.

## Follow-ups

S02 (MCP HTTP Server in Orchestrator) can now proceed — it depends on S01 for the job launch infrastructure. S03 (Agent Job Entrypoint) depends on both S01 and S02.

## Files Created/Modified

- `src/jobs/aca-launcher.ts` — New module: buildAcaJobSpec, launchAcaJob, pollUntilComplete, readJobResult, APPLICATION_SECRET_NAMES
- `src/jobs/aca-launcher.test.ts` — New: 16 tests covering security contract, spec builder, and result reader
- `src/jobs/workspace.ts` — Added createAzureFilesWorkspaceDir export
- `scripts/test-aca-job.ts` — New: two-phase contract check + --live smoke test script
- `deploy.sh` — Added Storage Account, Azure Files share, ACA env storage mount, agent image build, and ACA Job create/update sections
