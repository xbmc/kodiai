---
estimated_steps: 8
estimated_files: 2
skills_used: []
---

# T01: Add token field to Workspace type and strip token in workspace.create()

Add `token?: string` to the Workspace interface in types.ts. In createWorkspaceManager().create(), after the git clone succeeds, call `git remote set-url origin` with the bare HTTPS URL (no token) to strip the credential from .git/config. For fork clones, strip both origin (fork URL) and upstream remote (base URL). Return `token` in the workspace object so callers can use it for subsequent auth operations.

Steps:
1. In `src/jobs/types.ts`, add `token?: string` to the Workspace interface after the `dir` field. The optional field preserves backward compatibility with test code that constructs `{ dir, cleanup }` literals.
2. In `src/jobs/workspace.ts`, inside `createWorkspaceManager().create()`, after the clone succeeds (and the upstream remote add for fork clones), add the strip calls:
   - Standard clone: `await $\`git -C ${dir} remote set-url origin https://github.com/${owner}/${repo}.git\`.quiet()`
   - Fork clone: `await $\`git -C ${dir} remote set-url origin https://github.com/${forkContext.forkOwner}/${forkContext.forkRepo}.git\`.quiet()` and `await $\`git -C ${dir} remote set-url upstream https://github.com/${owner}/${repo}.git\`.quiet()`
3. Update the return statement from `return { dir, cleanup }` to `return { dir, cleanup, token }`.
4. Run `bunx tsc --noEmit` to verify no type errors.

## Inputs

- `src/jobs/types.ts`
- `src/jobs/workspace.ts`

## Expected Output

- `src/jobs/types.ts`
- `src/jobs/workspace.ts`

## Verification

bunx tsc --noEmit && echo 'types ok'
