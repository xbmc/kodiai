---
estimated_steps: 15
estimated_files: 1
skills_used: []
---

# T02: Refactor push/fetch functions to accept explicit token and construct auth URL inline

Update the four workspace.ts functions that perform network operations to accept an explicit `token?: string` parameter and construct the auth URL inline rather than relying on a stored remote URL. Add a private `makeAuthUrl` helper to avoid duplication.

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

## Inputs

- `src/jobs/types.ts`
- `src/jobs/workspace.ts`

## Expected Output

- `src/jobs/workspace.ts`

## Verification

bunx tsc --noEmit && echo 'types ok'
