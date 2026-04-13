# T02 wrap-up context draft

## Status
- Task T02 is **not complete**.
- I stopped due the auto wrap-up context-budget guard.
- No task checkbox or completion state was changed.

## Skills used
- `azure-container-apps`
- `test-driven-development`
- `verification-before-completion`
- `executing-plans`
- `brainstorming` was loaded, but the existing approved task plan was treated as the design gate because auto-mode forbids new human clarification.

## Files changed so far
- `src/execution/prepare-agent-workspace.test.ts`
- `src/execution/agent-entrypoint.test.ts`
- `src/execution/executor.test.ts`
- `src/execution/repo-transport.ts` *(new)*
- `src/execution/executor.ts`

## What changed
### 1) Added red tests for the new review-scoped transport contract
`src/execution/prepare-agent-workspace.test.ts`
- Reworked the git-path tests to expect a new `repoTransport` object in `agent-config.json` instead of legacy top-level `repoBundlePath` / `repoOriginUrl`.
- New expected optimized shape:
  - `kind: "review-bundle"`
  - `bundlePath`
  - `headRef`
  - `baseRef`
  - `originUrl` when available
- The tests still pin the important behavior:
  - tracked symlinks survive
  - `git diff origin/<base>...HEAD` works from a clone of the staged bundle
  - shallow repos are unshallowed before bundling

`src/execution/agent-entrypoint.test.ts`
- Kept the legacy `repoBundlePath` compatibility test.
- Added a new test expecting the entrypoint to consume `repoTransport.kind = "review-bundle"` without `repoOriginUrl`, materialize a usable repo checkout, preserve symlinks, and append diagnostics mentioning the chosen transport path.
- Added a new malformed-config test expecting a written `result.json` error and **no SDK invocation** when `repoTransport` is missing required `baseRef`.

`src/execution/executor.test.ts`
- Imported `prepareAgentWorkspace` and updated the executor test harness to use the real workspace-preparation function whenever the staged workspace dir differs from the source workspace dir.
- Preserved the old same-dir shortcut only for harness-only cases where production would never stage into the same directory.
- Reworked the explicit review mention test so it now creates a real git repo and expects the staged `agent-config.json` to contain `repoTransport.kind = "review-bundle"` while preserving the full review tool surface and maxTurns.

### 2) Added a shared repo transport contract file
`src/execution/repo-transport.ts`
- New shared types:
  - `BundleAllRepoTransport`
  - `ReviewBundleRepoTransport`
  - `RepoTransport`
- New parser/normalizer:
  - `resolveRepoTransport(...)`
- Behavior:
  - if new `repoTransport` metadata is present, validate it strictly
  - if absent, fall back to the legacy `repoBundlePath` / `repoOriginUrl` shape as `kind: "bundle-all"`
  - malformed `repoTransport` throws explicit errors like `Invalid repoTransport metadata: review-bundle transport requires baseRef`

### 3) Partially refactored executor-side staging
`src/execution/executor.ts`
- Added helper functions to detect a review-shaped git workspace:
  - determine current local head branch
  - list `refs/remotes/origin/*`
  - detect the single safe base-branch candidate by excluding `HEAD` and the current head branch
- Added `buildGitRepoTransport(...)`:
  - if a safe review-shaped base branch is derivable, temporarily pins a matching local base ref and creates a **smaller review-scoped bundle** with only `refs/heads/<head>` and `refs/heads/<base>`
  - otherwise falls back to legacy `git bundle create --all`
  - restores any temporary/local base ref changes afterward
- Updated `prepareAgentWorkspace(...)` so git-backed workspaces now write `repoTransport` into `agent-config.json` and return `repoTransport` alongside `repoBundlePath`
- Non-git copy path remains unchanged.

## Last command actually run
```bash
bun test ./src/execution/prepare-agent-workspace.test.ts ./src/execution/agent-entrypoint.test.ts ./src/execution/executor.test.ts
```

## Last observed failures from that run
This command was run **before** the later partial production edits and failed with 5 red tests:
1. `prepareAgentWorkspace writes a review bundle transport for repos with tracked symlinks`
   - failure: `agentConfig.repoTransport` was `undefined`
2. `prepareAgentWorkspace unshallows PR workspaces before writing a review bundle transport`
   - failure: `agentConfig.repoTransport` was `undefined`
3. `happy path > materializes review-bundle transport without repoOriginUrl and records the transport path`
   - failure: entrypoint still used `workspaceDir` as cwd because `repoTransport` was ignored
4. `happy path > writes an error result when repoTransport metadata is malformed`
   - failure: `queryFn` was still called because malformed `repoTransport` was ignored
5. `ACA dispatch: explicit review mention stages a review bundle transport without changing review tools`
   - failure at that moment: `$` was not imported in `executor.test.ts`

## Important note about verification state
- I **fixed some code after that red run**:
  - imported `$` in `src/execution/executor.test.ts`
  - added `src/execution/repo-transport.ts`
  - partially refactored `src/execution/executor.ts`
- I **did not** run a fresh test command after those edits because the wrap-up guard fired.
- Therefore there is **no fresh verification evidence** for the current working tree state.

## Most likely remaining work for the next unit
1. Finish `src/execution/agent-entrypoint.ts`
   - import and use `resolveRepoTransport(...)`
   - add materialization logic for `kind: "review-bundle"`
   - keep legacy `repoBundlePath` compatibility via `resolveRepoTransport(...)`
   - emit diagnostics like:
     - `repo transport kind=review-bundle ...`
     - `materialized review bundle cwd=...`
   - ensure malformed `repoTransport` writes `result.json` error and does not call the SDK
2. Re-run the focused red/green command:
   ```bash
   bun test ./src/execution/prepare-agent-workspace.test.ts ./src/execution/agent-entrypoint.test.ts ./src/execution/executor.test.ts
   ```
3. If green, run the task-level verification command from the plan:
   ```bash
   bun test ./src/execution/prepare-agent-workspace.test.ts ./src/execution/agent-entrypoint.test.ts ./src/execution/executor.test.ts ./src/handlers/review.test.ts
   ```
4. Then run:
   ```bash
   bun run tsc --noEmit
   ```
5. Only if all of the above are green, prepare the final task summary and call `gsd_complete_task`.

## Resume cautions
- `src/execution/executor.test.ts` now intentionally uses the real `prepareAgentWorkspace(...)` only when the harness stages into a distinct workspace dir. Do not remove that same-dir harness shortcut unless you also update the non-production tests that reuse the same temp dir for both source and staged workspace.
- The new transport optimization is intentionally conservative: only use `review-bundle` when there is exactly one safe base-branch candidate under `refs/remotes/origin/*` after excluding `HEAD` and the current head branch. Anything ambiguous should stay on the safe legacy `bundle-all` path.
- No handler/review publication continuity code has been changed yet.
