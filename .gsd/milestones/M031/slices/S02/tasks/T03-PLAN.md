---
estimated_steps: 30
estimated_files: 4
skills_used: []
---

# T03: Thread workspace.token through all handler and write-runner call sites

Update all call sites in mention.ts, review.ts, and write-runner.ts that call push/fetch functions or run `git fetch origin` directly, so they pass `workspace.token` (the installation token) or the appropriate bot PAT for fork push operations.

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

## Inputs

- `src/jobs/types.ts`
- `src/jobs/workspace.ts`
- `src/handlers/mention.ts`
- `src/handlers/review.ts`
- `src/slack/write-runner.ts`

## Expected Output

- `src/handlers/mention.ts`
- `src/handlers/review.ts`
- `src/slack/write-runner.ts`
- `src/jobs/workspace.ts`

## Verification

bunx tsc --noEmit && bun test src/jobs/workspace.test.ts
