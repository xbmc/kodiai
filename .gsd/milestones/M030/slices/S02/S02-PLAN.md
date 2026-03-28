# S02: kodi-addon-checker subprocess and output parsing

**Goal:** Build the kodi-addon-checker subprocess runner and output parser so the handler produces structured findings instead of just logging addon IDs.
**Demo:** After this: After this: given a workspace with a bad addon, structured findings are returned from the runner — visible in test output and logs.

## Tasks
- [x] **T01: Created addon-checker-runner.ts with ANSI-stripping output parser, Kodi branch resolver, and injectable subprocess runner; 19/19 tests pass, TypeScript clean** — Build src/lib/addon-checker-runner.ts as a pure, injectable module. Export:
- ValidKodiVersions: readonly string[] — the 10 known Kodi release branch names (nexus, omega, matrix, leia, jarvis, isengard, helix, gotham, frodo, dharma)
- AddonFinding type: { level: 'ERROR' | 'WARN' | 'INFO'; addonId: string; message: string }
- AddonCheckerResult type: { findings: AddonFinding[]; timedOut: boolean; toolNotFound: boolean }
- parseCheckerOutput(raw: string, addonId: string): AddonFinding[] — strips ANSI codes with /\x1B\[[0-9;]*m/g, then for each line matches /^(ERROR|WARN|INFO): (.+)$/, attaches addonId; ignores non-matching lines
- resolveCheckerBranch(baseBranch: string): string | null — returns baseBranch if it's in ValidKodiVersions, null otherwise
- runAddonChecker(opts: { addonDir: string; branch: string; timeBudgetMs?: number; __runSubprocessForTests?: ... }): Promise<AddonCheckerResult> — spawns kodi-addon-checker with args ['--branch', branch, addonDir], captures stdout, parses with parseCheckerOutput; if subprocess ENOENT → { findings: [], timedOut: false, toolNotFound: true }; if withTimeBudget returns null → { findings: [], timedOut: true, toolNotFound: false }; non-zero exit code (but not ENOENT) is NOT an error — parse stdout regardless

The __runSubprocessForTests injection accepts the same shape as analyzePackageUsage's __runGrepForTests: (params) => Promise<{ exitCode: number; stdout: string; error?: { code?: string } }>. Use Bun's $ shell as the real implementation (same as usage-analyzer.ts uses).

Also create src/lib/addon-checker-runner.test.ts with describe blocks:
1. parseCheckerOutput — strips ANSI, classifies ERROR/WARN/INFO, ignores non-matching lines (XML schema lines, blank lines, debug output), attaches addonId
2. resolveCheckerBranch — returns branch for each known version, null for unknown (e.g. 'main', 'master', 'develop')
3. runAddonChecker — toolNotFound when subprocess returns ENOENT error, timedOut when subprocess takes longer than budget (inject a slow stub), returns parsed findings on success with exit code 1 (non-zero is not failure)
  - Estimate: 90m
  - Files: src/lib/addon-checker-runner.ts, src/lib/addon-checker-runner.test.ts, src/lib/usage-analyzer.ts
  - Verify: bun test src/lib/addon-checker-runner.test.ts
- [x] **T02: Wire runAddonChecker into addon-check handler with workspace lifecycle, jobQueue enqueue, branch resolution, structured finding logs, and 11 passing tests** — Update src/handlers/addon-check.ts to accept workspaceManager and jobQueue, clone the workspace, resolve the kodi branch, and call runAddonChecker per addon. Update src/index.ts to pass these deps.

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
  - Estimate: 90m
  - Files: src/handlers/addon-check.ts, src/handlers/addon-check.test.ts, src/index.ts
  - Verify: bun test src/handlers/addon-check.test.ts && bun test src/lib/addon-checker-runner.test.ts && bun run tsc --noEmit
