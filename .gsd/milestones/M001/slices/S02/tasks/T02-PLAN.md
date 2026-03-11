# T02: 02-job-infrastructure 02

**Slice:** S02 — **Milestone:** M001

## Description

Create the workspace manager module and wire all job infrastructure into the server.

Purpose: Completes the job infrastructure by providing ephemeral workspace creation (clone, git auth, cleanup) and wiring both the job queue and workspace manager into the server's startup sequence. After this plan, webhook handlers can enqueue jobs that get fresh cloned workspaces with automatic cleanup.
Output: src/jobs/workspace.ts (createWorkspaceManager factory), updated src/index.ts with job infrastructure wiring

## Must-Haves

- [ ] "A job receives a workspace with a shallow clone of the target repo in a unique temp directory"
- [ ] "The clone URL uses x-access-token:{installationToken} for authentication"
- [ ] "Git user.name and user.email are configured as kodiai[bot] in the cloned workspace"
- [ ] "After job success, the temp directory is deleted"
- [ ] "After job failure (thrown error), the temp directory is still deleted"
- [ ] "Branch names are validated before use in git commands (rejects leading dashes, control chars, etc.)"
- [ ] "Stale kodiai-* temp dirs from previous runs are cleaned up on server startup"
- [ ] "The clone URL token is never logged (redacted)"

## Files

- `src/jobs/workspace.ts`
- `src/index.ts`
