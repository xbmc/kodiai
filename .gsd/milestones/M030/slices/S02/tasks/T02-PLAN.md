---
estimated_steps: 29
estimated_files: 3
skills_used: []
---

# T02: Wire runner into addon-check handler and update index.ts

Update src/handlers/addon-check.ts to accept workspaceManager and jobQueue, clone the workspace, resolve the kodi branch, and call runAddonChecker per addon. Update src/index.ts to pass these deps.

Specific changes to addon-check.ts:
1. Add imports: WorkspaceManager, JobQueue from ../jobs/types.ts; runAddonChecker, resolveCheckerBranch, AddonFinding from ../lib/addon-checker-runner.ts; fetchAndCheckoutPullRequestHeadRef from ../jobs/workspace.ts
2. Extend the deps type to include workspaceManager: WorkspaceManager, jobQueue: JobQueue
3. Extend the payload type cast to include pull_request.base.ref (string) and pull_request.head.ref (string) and pull_request.head.repo (optional fork info)
4. Inside handlePullRequest, after extracting addonIds:
   a. Call resolveCheckerBranch(payload.pull_request.base.ref) — if null, handlerLogger.warn({ baseBranch }, 'addon-check: unknown kodi branch, skipping') and return
   b. Wrap the actual check work in jobQueue.enqueue(event.installationId, async () => { ... })
   c. Inside the enqueue: create workspace via workspaceManager.create with the head branch (use fork/non-fork pattern from review.ts lines 1178-1205: if head.repo differs from base repo → clone base branch then fetchAndCheckoutPullRequestHeadRef; else clone head.ref directly). For S02, simplify: always clone base.ref and then call fetchAndCheckoutPullRequestHeadRef for non-fork PRs too — safe and matches review.ts's fork path. Actually: clone head.ref directly (non-fork is the common case for xbmc repos; fork handling can be S03 polish).
   d. For each addonId: call runAddonChecker({ addonDir: path.join(workspace.dir, addonId), branch: kodiVersion, timeBudgetMs: 120000 })
   e. Log findings: for each finding, handlerLogger.info({ addonId: finding.addonId, level: finding.level, message: finding.message }, 'addon-check: finding')
   f. Log summary: handlerLogger.info({ addonIds, totalFindings: allFindings.length }, 'addon-check: complete')
   g. Call workspace.cleanup() in finally
5. Replace the old scaffold log ('Addon check: would check addons') with the new flow
6. Accept __runSubprocessForTests as an optional dep for test injection (same pattern as T01)

Specific changes to index.ts:
- Add workspaceManager and jobQueue to the createAddonCheckHandler call (they're already created on lines 74-75)

Update src/handlers/addon-check.test.ts:
- Add tests:
  a. unknown branch → warns and skips (resolveCheckerBranch returns null path)
  b. workspace.create called with head branch on non-fork PR
  c. runner called per addon with correct addonDir and branch
  d. findings logged with structured bindings
  e. workspace.cleanup called in finally (even on runner error)
- Keep all 5 existing tests passing (they test the scaffold behavior — update the 'logs addon IDs' test to match the new log message 'addon-check: complete' or adjust as needed)

Verify:
- bun test src/handlers/addon-check.test.ts (all tests pass)
- bun test src/lib/addon-checker-runner.test.ts (regression check)
- bun run tsc --noEmit (exit 0)

## Inputs

- `src/lib/addon-checker-runner.ts`
- `src/handlers/addon-check.ts`
- `src/handlers/addon-check.test.ts`
- `src/index.ts`
- `src/jobs/types.ts`
- `src/jobs/workspace.ts`

## Expected Output

- `src/handlers/addon-check.ts`
- `src/handlers/addon-check.test.ts`
- `src/index.ts`

## Verification

bun test src/handlers/addon-check.test.ts && bun test src/lib/addon-checker-runner.test.ts && bun run tsc --noEmit

## Observability Impact

Adds structured log per finding (addonId, level, message bindings at info level) and summary log (addonIds, totalFindings). Warns on unknown kodi branch with baseBranch binding. Warns on toolNotFound (kodi-addon-checker not installed). Warns on runner timeout with addonId.
