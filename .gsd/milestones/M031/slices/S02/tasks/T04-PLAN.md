---
estimated_steps: 19
estimated_files: 1
skills_used: []
---

# T04: Add workspace.test.ts tests for URL strip and token threading

Extend src/jobs/workspace.test.ts with tests that verify the two key behaviors of this slice: (1) workspace.create() strips the token from the git remote URL, and (2) the push functions construct auth URLs from an explicit token parameter.

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

## Inputs

- `src/jobs/workspace.ts`
- `src/jobs/types.ts`
- `src/jobs/workspace.test.ts`

## Expected Output

- `src/jobs/workspace.test.ts`

## Verification

bun test src/jobs/workspace.test.ts && echo 'workspace tests pass'
