---
id: S02
parent: M030
milestone: M030
provides:
  - runAddonChecker function with full contract (toolNotFound, timedOut, structured findings, non-zero exit tolerance)
  - resolveCheckerBranch mapping from PR base branch to kodi-addon-checker --branch arg
  - addon-check handler wired with workspace lifecycle, jobQueue, branch resolution, per-addon runner calls, and structured finding logs
  - Injection points for test-time subprocess substitution in both the runner and the handler
requires:
  - slice: S01
    provides: createAddonCheckHandler scaffold, addon repo detection via listFiles, handler registration pattern
affects:
  - S03 — consumes runAddonChecker findings; needs fork PR workspace handling added
key_files:
  - src/lib/addon-checker-runner.ts
  - src/lib/addon-checker-runner.test.ts
  - src/handlers/addon-check.ts
  - src/handlers/addon-check.test.ts
  - src/index.ts
key_decisions:
  - Reused withTimeBudget from usage-analyzer.ts rather than duplicating timeout logic
  - addonId derived from last path segment of addonDir in runAddonChecker (caller-agnostic)
  - Non-ENOENT errors fail open — matches usage-analyzer.ts convention
  - Empty addonIds returns early before enqueue to avoid no-op workspace creation
  - createMockLoggerWithArrays centralizes shared-array writes for child-logger assertions
  - Cleanup-on-throw test uses workspace.create throwing (not subprocess) since runAddonChecker fails open
patterns_established:
  - Injectable subprocess runner pattern (addon-checker-runner.ts) mirrors usage-analyzer.ts: __runSubprocessForTests injection, withTimeBudget reuse, ENOENT vs non-ENOENT error discrimination, non-zero exit treated as normal
  - createMockLoggerWithArrays() pattern for handler tests requiring child-logger assertion (see KNOWLEDGE.md)
observability_surfaces:
  - handlerLogger.warn({ baseBranch }, 'addon-check: unknown kodi branch, skipping') — fires when PR base branch is not a known Kodi version
  - handlerLogger.info({ addonId, level, message }, 'addon-check: finding') — structured log per finding (grepping 'addon-check: finding' gives all violations from a run)
  - handlerLogger.info({ addonIds, totalFindings }, 'addon-check: complete') — summary log per PR job (grepping 'addon-check: complete' gives per-PR finding counts)
drill_down_paths:
  - milestones/M030/slices/S02/tasks/T01-SUMMARY.md
  - milestones/M030/slices/S02/tasks/T02-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-03-28T16:11:21.770Z
blocker_discovered: false
---

# S02: kodi-addon-checker subprocess and output parsing

**Built the addon-checker subprocess runner and output parser, wired them into the addon-check handler with workspace lifecycle and job queue, producing structured findings — 30/30 tests pass, TypeScript clean.**

## What Happened

S02 delivered two interdependent units of work across T01 and T02.

**T01 — Pure runner module**

`src/lib/addon-checker-runner.ts` was built as a pure injectable module following the `usage-analyzer.ts` pattern established in M027. Key design points:
- `ValidKodiVersions` is a `readonly string[]` of the 10 known Kodi release branch names (nexus, omega, matrix, leia, jarvis, isengard, helix, gotham, frodo, dharma).
- `parseCheckerOutput(raw, addonId)` strips ANSI codes with `/\x1B\[[0-9;]*m/g` before line splitting, then matches `^(ERROR|WARN|INFO): (.+)$` per line; non-matching lines are silently dropped.
- `resolveCheckerBranch(baseBranch)` returns the branch if present in `ValidKodiVersions`, else null.
- `runAddonChecker` spawns `kodi-addon-checker --branch <branch> <addonDir>`, captures stdout, and parses it. ENOENT → `toolNotFound: true`. Timeout → `timedOut: true`. Non-zero exit code is NOT an error (the tool exits 1 when findings exist). Non-ENOENT errors fail open (returns empty findings).
- `withTimeBudget` was reused from `usage-analyzer.ts` rather than duplicated.
- `addonId` is derived from the last path segment of `addonDir` inside `runAddonChecker`.
- The `__runSubprocessForTests` injection point matches `__runGrepForTests` shape exactly.
- 19 tests covering all three functions across all specified edge cases.

**T02 — Handler wiring**

`src/handlers/addon-check.ts` was updated to accept `workspaceManager` and `jobQueue` as deps alongside the existing `listFiles`. The full flow:
1. `resolveCheckerBranch(payload.pull_request.base.ref)` — unknown branch → warn and return.
2. Empty `addonIds` → early return before `enqueue` to avoid no-op workspace creation.
3. `jobQueue.enqueue(installationId, async () => { ... })` wraps all workspace work.
4. Inside the job: `workspaceManager.create(headBranch)` → for each addonId call `runAddonChecker` → log each finding (`addonId`, `level`, `message`), log summary (`addonIds`, `totalFindings`), `workspace.cleanup()` in finally.
5. `src/index.ts` updated to pass `workspaceManager` and `jobQueue` to `createAddonCheckHandler`.

Test decisions:
- `createMockLoggerWithArrays()` centralizes shared-array writes so child logger assertions work without `.mock.calls` traversal.
- Cleanup-on-throw test throws from `workspace.create` (not the subprocess) since `runAddonChecker` fails open on non-ENOENT errors.
- 11 handler tests (5 from scaffold + 6 new) all pass.

All three verification gates pass: 19 runner tests, 11 handler tests, `bun run tsc --noEmit` exits 0.

## Verification

Three-gate verification all pass:
1. `bun test src/lib/addon-checker-runner.test.ts` → 19 pass, 0 fail (55 expect() calls)
2. `bun test src/handlers/addon-check.test.ts` → 11 pass, 0 fail (29 expect() calls)
3. `bun run tsc --noEmit` → exit 0, no errors

## Requirements Advanced

- R001 — bun run tsc --noEmit exits 0 across the full codebase including new runner and handler files

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

None. Both tasks delivered exactly as planned. The only notable implementation choice (empty addonIds early-return before enqueue) was a sensible guard not explicitly specified but aligned with the handler's existing empty-file-list behavior.

## Known Limitations

Fork PRs are not handled — the handler always clones the PR's head ref directly, which works for same-repo PRs (the common case for xbmc repos). Fork handling (clone base then fetchAndCheckoutPullRequestHeadRef) is deferred to S03 polish per the T02 plan note.

## Follow-ups

S03 should add fork PR workspace handling (clone base + fetchAndCheckoutPullRequestHeadRef) following the review.ts pattern at lines 1178-1205. The __runSubprocessForTests injection point in runAddonChecker is ready for integration testing if a fixture bad-addon directory is added later.

## Files Created/Modified

- `src/lib/addon-checker-runner.ts` — New: pure injectable subprocess runner — ANSI-stripping output parser, Kodi branch resolver, timeout-gated subprocess spawner
- `src/lib/addon-checker-runner.test.ts` — New: 19 tests covering parseCheckerOutput, resolveCheckerBranch, and runAddonChecker edge cases
- `src/handlers/addon-check.ts` — Updated: wired workspaceManager, jobQueue, runAddonChecker, resolveCheckerBranch into handler flow; workspace lifecycle with finally cleanup; per-finding and summary structured logs
- `src/handlers/addon-check.test.ts` — Updated: 6 new tests for branch resolution, workspace lifecycle, runner dispatch, finding logs, cleanup-on-error; 5 scaffold tests retained
- `src/index.ts` — Updated: passes workspaceManager and jobQueue to createAddonCheckHandler
