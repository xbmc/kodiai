# S02: Job Infrastructure

**Goal:** Create the job queue module with per-installation concurrency control and extend GitHubApp with raw token access.
**Demo:** Create the job queue module with per-installation concurrency control and extend GitHubApp with raw token access.

## Must-Haves


## Tasks

- [x] **T01: 02-job-infrastructure 01** `est:4min`
  - Create the job queue module with per-installation concurrency control and extend GitHubApp with raw token access.

Purpose: Provides the concurrency infrastructure that ensures only one job runs per GitHub App installation at a time, while allowing parallel execution across installations. Also exposes raw installation tokens needed by the workspace manager in Plan 02.
Output: src/jobs/types.ts, src/jobs/queue.ts (createJobQueue factory), updated src/auth/github-app.ts with getInstallationToken
- [x] **T02: 02-job-infrastructure 02** `est:4min`
  - Create the workspace manager module and wire all job infrastructure into the server.

Purpose: Completes the job infrastructure by providing ephemeral workspace creation (clone, git auth, cleanup) and wiring both the job queue and workspace manager into the server's startup sequence. After this plan, webhook handlers can enqueue jobs that get fresh cloned workspaces with automatic cleanup.
Output: src/jobs/workspace.ts (createWorkspaceManager factory), updated src/index.ts with job infrastructure wiring

## Files Likely Touched

- `package.json`
- `src/jobs/types.ts`
- `src/jobs/queue.ts`
- `src/auth/github-app.ts`
- `src/jobs/workspace.ts`
- `src/index.ts`
