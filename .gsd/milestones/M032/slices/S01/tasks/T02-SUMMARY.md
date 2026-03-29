---
id: T02
parent: S01
milestone: M032
provides: []
requires: []
affects: []
key_files: ["scripts/test-aca-job.ts", "deploy.sh"]
key_decisions: ["readJobResult failure in live mode is non-fatal — smoke-test container may not write result.json", "volume flag added to orchestrator az containerapp update using --volume name=...,storage-name=...,storage-type=AzureFile", "STORAGE_KEY captured once in storage section and reused by both the ACA env storage set and ACA Job create commands"]
patterns_established: []
drill_down_paths: []
observability_surfaces: []
duration: ""
verification_result: "bun run scripts/test-aca-job.ts → contract check passes, exits 0. bun run tsc --noEmit → exits 0. bash -n deploy.sh → exits 0."
completed_at: 2026-03-29T18:26:32.685Z
blocker_discovered: false
---

# T02: Create scripts/test-aca-job.ts with pure-code contract check + --live smoke test; add Storage Account, Azure Files, ACA env storage mount, and ACA Job sections to deploy.sh

> Create scripts/test-aca-job.ts with pure-code contract check + --live smoke test; add Storage Account, Azure Files, ACA env storage mount, and ACA Job sections to deploy.sh

## What Happened
---
id: T02
parent: S01
milestone: M032
key_files:
  - scripts/test-aca-job.ts
  - deploy.sh
key_decisions:
  - readJobResult failure in live mode is non-fatal — smoke-test container may not write result.json
  - volume flag added to orchestrator az containerapp update using --volume name=...,storage-name=...,storage-type=AzureFile
  - STORAGE_KEY captured once in storage section and reused by both the ACA env storage set and ACA Job create commands
duration: ""
verification_result: passed
completed_at: 2026-03-29T18:26:32.685Z
blocker_discovered: false
---

# T02: Create scripts/test-aca-job.ts with pure-code contract check + --live smoke test; add Storage Account, Azure Files, ACA env storage mount, and ACA Job sections to deploy.sh

**Create scripts/test-aca-job.ts with pure-code contract check + --live smoke test; add Storage Account, Azure Files, ACA env storage mount, and ACA Job sections to deploy.sh**

## What Happened

Created scripts/test-aca-job.ts with a two-phase approach: a pure-code contract check that always runs (calls buildAcaJobSpec and verifies no APPLICATION_SECRET_NAMES appear in the env array), and a --live mode that dispatches a real ACA Job, polls for completion, prints cold start timing and executionName for portal audit trail lookup, and optionally reads result.json. Updated deploy.sh with idempotent Azure Storage Account provisioning, Azure Files share creation, ACA env storage mount, agent image build (kodiai-agent:latest), and ACA Job create/update sections. Added --volume flag to the orchestrator az containerapp update command for shared workspace access.

## Verification

bun run scripts/test-aca-job.ts → contract check passes, exits 0. bun run tsc --noEmit → exits 0. bash -n deploy.sh → exits 0.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun run scripts/test-aca-job.ts` | 0 | ✅ pass | 500ms |
| 2 | `bun run tsc --noEmit` | 0 | ✅ pass | 7600ms |
| 3 | `bash -n deploy.sh` | 0 | ✅ pass | 50ms |


## Deviations

buildAcaJobSpec requires jobName parameter (not listed in task plan inputs); used caj-kodiai-agent to match deploy.sh. readJobResult failure in live mode treated as warning-only since smoke-test container may not write result.json.

## Known Issues

None.

## Files Created/Modified

- `scripts/test-aca-job.ts`
- `deploy.sh`


## Deviations
buildAcaJobSpec requires jobName parameter (not listed in task plan inputs); used caj-kodiai-agent to match deploy.sh. readJobResult failure in live mode treated as warning-only since smoke-test container may not write result.json.

## Known Issues
None.
