# T01: 02-job-infrastructure 01

**Slice:** S02 — **Milestone:** M001

## Description

Create the job queue module with per-installation concurrency control and extend GitHubApp with raw token access.

Purpose: Provides the concurrency infrastructure that ensures only one job runs per GitHub App installation at a time, while allowing parallel execution across installations. Also exposes raw installation tokens needed by the workspace manager in Plan 02.
Output: src/jobs/types.ts, src/jobs/queue.ts (createJobQueue factory), updated src/auth/github-app.ts with getInstallationToken

## Must-Haves

- [ ] "jobQueue.enqueue(installationId, fn) accepts a job and returns a Promise that resolves when the job completes"
- [ ] "Two jobs for the same installation ID run sequentially (concurrency 1)"
- [ ] "Two jobs for different installation IDs can run in parallel"
- [ ] "getInstallationToken(installationId) returns a raw token string for git URL auth"
- [ ] "Idle queue instances are pruned to prevent memory leaks"

## Files

- `package.json`
- `src/jobs/types.ts`
- `src/jobs/queue.ts`
- `src/auth/github-app.ts`
