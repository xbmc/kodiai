# S02: Git Remote Sanitization + Token Memory Refactor

**Goal:** Strip the installation token from the git remote URL immediately after cloning, store it in Workspace.token (memory only), and thread it explicitly through all push and fetch operations so no credential is ever on disk during the agent's execution window.
**Demo:** After this: Unit test reads back git remote get-url origin after workspace.create() and asserts no x-access-token present. bun test src/jobs/workspace.test.ts exits 0.

## Tasks
- [x] **T01: Added Workspace.token field and stripped installation tokens from git remotes immediately after cloning** — Add `token?: string` to the Workspace interface in types.ts. In createWorkspaceManager().create(), after the git clone succeeds, call `git remote set-url origin` with the bare HTTPS URL (no token) to strip the credential from .git/config. For fork clones, strip both origin (fork URL) and upstream remote (base URL). Return `token` in the workspace object so callers can use it for subsequent auth operations.

Steps:
1. In `src/jobs/types.ts`, add `token?: string` to the Workspace interface after the `dir` field. The optional field preserves backward compatibility with test code that constructs `{ dir, cleanup }` literals.
2. In `src/jobs/workspace.ts`, inside `createWorkspaceManager().create()`, after the clone succeeds (and the upstream remote add for fork clones), add the strip calls:
   - Standard clone: `await $\`git -C ${dir} remote set-url origin https://github.com/${owner}/${repo}.git\`.quiet()`
   - Fork clone: `await $\`git -C ${dir} remote set-url origin https://github.com/${forkContext.forkOwner}/${forkContext.forkRepo}.git\`.quiet()` and `await $\`git -C ${dir} remote set-url upstream https://github.com/${owner}/${repo}.git\`.quiet()`
3. Update the return statement from `return { dir, cleanup }` to `return { dir, cleanup, token }`.
4. Run `bunx tsc --noEmit` to verify no type errors.
  - Estimate: 30m
  - Files: src/jobs/types.ts, src/jobs/workspace.ts
  - Verify: bunx tsc --noEmit && echo 'types ok'
- [x] **T02: Added makeAuthUrl helper and refactored all four git network functions to accept explicit token? and construct auth URL inline instead of reading from remote config** — Update the four workspace.ts functions that perform network operations to accept an explicit `token?: string` parameter and construct the auth URL inline rather than relying on a stored remote URL. Add a private `makeAuthUrl` helper to avoid duplication.

Steps:
1. Add a private helper function at the top of workspace.ts (after `redactTokenFromError`):
```ts
function makeAuthUrl(strippedUrl: string, token: string | undefined): string {
  if (!token) return strippedUrl;
  return strippedUrl.replace(/^https:\/\//, `https://x-access-token:${token}@`);
}
```
2. Update `createBranchCommitAndPush` options type: add `token?: string`. Replace `const token = await getOriginTokenFromDir(dir)` with the passed-in token for auth. Construct push URL: read the stripped remote URL with `git remote get-url origin`, apply makeAuthUrl, use it instead of the `remote` constant in the push command. Keep using `token` (or the read-back value) in `redactTokenFromError`. Signature change: `options: { dir, branchName, commitMessage, remote?, token?, policy? }`.
3. Same changes for `commitAndPushToRemoteRef`: add `token?` to options, construct auth push URL inline.
4. Same changes for `pushHeadToRemoteRef`: add `token?` to options, construct auth push URL inline.
5. Update `fetchAndCheckoutPullRequestHeadRef`: add `token?` to options. The current code calls `getOriginTokenFromRemoteUrl(dir)` for error-redaction. After strip, this returns undefined. Instead, use the passed-in token. Construct auth fetch URL inline: read stripped remote URL, apply makeAuthUrl, use it in the `git fetch` command.
6. The `getOriginTokenFromDir` / `getOriginTokenFromRemoteUrl` functions are kept but their usage in push/fetch paths is replaced by the explicit token parameter. They continue to be called only in `redactTokenFromError` fallback paths (returning undefined after strip — regex fallback handles it).
7. Run `bunx tsc --noEmit` to verify no type errors.
  - Estimate: 45m
  - Files: src/jobs/workspace.ts
  - Verify: bunx tsc --noEmit && echo 'types ok'
- [x] **T03: Wired workspace.token and forkContext.botPat through all push/fetch call sites in mention.ts, review.ts, and write-runner.ts via exported buildAuthFetchUrl helper** — Update all call sites in mention.ts, review.ts, and write-runner.ts that call push/fetch functions or run `git fetch origin` directly, so they pass `workspace.token` (the installation token) or the appropriate bot PAT for fork push operations.

Call sites to update:

**src/handlers/mention.ts:**
- Line ~1018: `fetchAndCheckoutPullRequestHeadRef({ dir: workspace.dir, ... })` → add `token: workspace.token`
- Line ~1027: `git -C ${workspace.dir} fetch origin ${mention.baseRef}...` → replace `origin` with the auth URL constructed as `(workspace.token ? \`https://x-access-token:${workspace.token}@github.com\` : 'origin')` pattern, or better: extract the stripped remote URL and apply makeAuthUrl. Simplest inline approach: replace literal `origin` with a variable `const fetchRemote = workspace.token ? \`https://x-access-token:${workspace.token}@github.com/${owner}/${repo}.git\` : 'origin'` — but owner/repo are in scope. Use that variable in the fetch command.
- Line ~2007: `createBranchCommitAndPush({ dir: workspace.dir, ... })` → add `token: forkContext.botPat` (fork pushes use bot PAT, not installation token)
- Line ~2190: `git -C ${workspace.dir} fetch origin ${headRef}...` → same auth URL pattern using workspace.token (this fetch is from base repo, not fork)
- Line ~2245: `commitAndPushToRemoteRef({ dir: workspace.dir, ... })` → add `token: workspace.token`
- Line ~2303: `git -C ${workspace.dir} fetch origin ${headRef}...` → auth URL pattern
- Line ~2348: `pushHeadToRemoteRef({ dir: workspace.dir, ... })` → add appropriate token
- Line ~2386: `createBranchCommitAndPush({ dir: workspace.dir, branchName, ... })` (non-fork push) → add `token: workspace.token`

**src/handlers/review.ts:**
- `collectDiffContext` helper (line ~696): add `token?: string` to its params type. Replace `fetch origin` calls inside with auth URL: `const authRemote = makeAuthUrl(strippedOriginUrl, token)` — but makeAuthUrl is private to workspace.ts. Best approach: add and export a `buildAuthFetchUrl(dir: string, token: string | undefined): Promise<string>` helper from workspace.ts that reads the stripped remote URL and injects the token. Then call-site can await it once and reuse. Alternative: inline the URL construction using `await $\`git -C ${workspaceDir} remote get-url origin\`.quiet().text().trim()` in each fetch call. Choose the exported helper approach for cleanliness.
- Line ~1278: `fetchAndCheckoutPullRequestHeadRef({ dir: workspace.dir, ... })` → add `token: workspace.token`
- Line ~1287: `git -C ${workspace.dir} fetch origin ...` → auth URL
- Line ~3600: `fetchAndCheckoutPullRequestHeadRef({ dir: retryWorkspace.dir, ... })` → add `token: retryWorkspace.token`
- Line ~3607: `git -C ${retryWorkspace.dir} fetch origin ...` → auth URL
- Call `collectDiffContext` at line ~1574 with added `token: workspace.token`

**src/slack/write-runner.ts:**
- Line ~354: `commitBranchAndPush({ dir: workspace.dir, ... })` (fork push) → add `token: forkContext.botPat`
- Line ~491: `commitBranchAndPush({ dir: workspace.dir, ... })` (non-fork push — check context) → add `token: workspace.token`

The exported `buildAuthFetchUrl` helper to add to workspace.ts:
```ts
export async function buildAuthFetchUrl(dir: string, token: string | undefined): Promise<string> {
  if (!token) return 'origin';
  const url = (await $\`git -C ${dir} remote get-url origin\`.quiet()).text().trim();
  return makeAuthUrl(url, token);
}
```

Run `bunx tsc --noEmit` after changes. Run `bun test src/jobs/workspace.test.ts src/handlers/*.test.ts` if handler tests exist.
  - Estimate: 1h
  - Files: src/handlers/mention.ts, src/handlers/review.ts, src/slack/write-runner.ts, src/jobs/workspace.ts
  - Verify: bunx tsc --noEmit && bun test src/jobs/workspace.test.ts
- [ ] **T04: Add workspace.test.ts tests for URL strip and token threading** — Extend src/jobs/workspace.test.ts with tests that verify the two key behaviors of this slice: (1) workspace.create() strips the token from the git remote URL, and (2) the push functions construct auth URLs from an explicit token parameter.

Steps:

1. **URL-strip test using a local bare repo** (the 'unit test reads back git remote get-url origin after workspace.create()' scenario from the roadmap demo):
   - Create a local bare repo: `git init --bare ${tmpDir}/fake-remote.git`
   - Create a repo with a test commit and push to the bare remote
   - The problem: `workspace.create()` takes `installationId` and calls `githubApp.getInstallationToken()`, then clones from GitHub. We can't call it with a real GitHub URL in unit tests.
   - Solution: extract and test `makeAuthUrl` and the URL-strip logic directly. Add an integration-style test that uses a mock workspace manager: create a temp dir, simulate a clone by running `git clone file://${bareRepo} ${dir}`, then call `git remote set-url origin https://github.com/testowner/testrepo.git` and verify `git remote get-url origin` returns the clean URL.
   - Test: `workspace created with local bare repo, then set-url strips token-like URL; git remote get-url origin returns clean https://github.com/... URL`
   - Verify: `git remote get-url origin` output does not contain `x-access-token`

2. **makeAuthUrl unit tests** (test via exported function or inline logic):
   - Import the `buildAuthFetchUrl` helper (if exported from workspace.ts) and test:
     - With token: `https://x-access-token:TOKEN@github.com/owner/repo.git`
     - Without token: returns `'origin'` (the literal fallback)
   - If `makeAuthUrl` is not exported, test the observable behavior through `buildAuthFetchUrl`

3. **Push function token acceptance** (mock-based to avoid real git push):
   - Test that `createBranchCommitAndPush` accepts `token` in its options type (TypeScript compile check is sufficient; actual push behavior requires real git remotes)
   - Alternatively: test that the auth URL would be constructed correctly by calling `buildAuthFetchUrl` with a mock dir that has a known stripped remote URL set up via local bare repo.

4. After writing tests, run `bun test src/jobs/workspace.test.ts` and ensure all pass.

5. Run the full test suite `bun test` to ensure no regressions.
  - Estimate: 45m
  - Files: src/jobs/workspace.test.ts
  - Verify: bun test src/jobs/workspace.test.ts && echo 'workspace tests pass'
