# S02 Research: Git Remote Sanitization + Token Memory Refactor

**Researched:** 2026-03-28
**Slice:** M031/S02

---

## Summary

This is targeted research on well-understood code. The scope is `src/jobs/workspace.ts` and `src/jobs/types.ts`, with call-site impact in `src/handlers/mention.ts`, `src/handlers/review.ts`, `src/jobs/fork-manager.ts`, and `src/slack/write-runner.ts`.

The key discovery that adds complexity beyond the context's description: **post-clone `git fetch origin` calls (in handlers, before agent execution) also need the token**. The context assumes only `push` functions need auth after the strip — that's incomplete. Fetches run in trusted handler code before the agent, so they can reconstruct the auth URL inline. The design handles this correctly if we pass URLs explicitly to fetch operations rather than relying on the stored origin remote.

---

## Recommendation

**Two-part fix:**

1. **In `workspace.create()`**: After clone, immediately call `git remote set-url origin https://github.com/owner/repo.git` (strip token). For fork clones, also strip token from upstream remote. Store token in the returned `Workspace` object (`Workspace.token?: string`).

2. **In push/fetch functions**: Replace `git push origin HEAD:branch` / `git fetch origin refs/...` with explicit token-URL forms:
   ```
   git push https://x-access-token:TOKEN@github.com/owner/repo.git HEAD:branch
   git fetch https://x-access-token:TOKEN@github.com/owner/repo.git refs/...
   ```
   Token is in-memory only, never stored.

The push functions (`createBranchCommitAndPush`, `commitAndPushToRemoteRef`, `pushHeadToRemoteRef`) currently call `getOriginTokenFromDir()` which reads `.git/config` — after stripping, this returns `undefined`. They need to accept `token` explicitly. The fetch functions in workspace.ts (`fetchAndCheckoutPullRequestHeadRef`) also read the token from the remote URL — same fix applies.

The handler-level fetch calls (`git fetch origin refs/...` in `mention.ts` and `review.ts`) use `origin` as the remote and don't go through workspace.ts helper functions — they need to either: (a) accept and use explicit auth URLs, or (b) have the token threaded to them via context.

---

## Implementation Landscape

### File: `src/jobs/types.ts`

The `Workspace` interface (line 16) currently:
```ts
export interface Workspace {
  dir: string;
  cleanup(): Promise<void>;
}
```
Add `token?: string` field. Optional so existing tests that construct `{ dir, cleanup }` literals continue to compile.

### File: `src/jobs/workspace.ts`

**`createWorkspaceManager().create()` (line 530–580):**

After the `git clone` succeeds, add:
- Standard clone: `git remote set-url origin https://github.com/${owner}/${repo}.git`  
- Fork clone: `git remote set-url origin https://github.com/${forkContext.forkOwner}/${forkContext.forkRepo}.git` (strips botPat from forkCloneUrl). Also strip the upstream remote: `git remote set-url upstream https://github.com/${owner}/${repo}.git`.
- Return `{ dir, cleanup, token }` where `token` = the installation token (available in scope already).
- For fork clone, the Workspace needs both tokens. Current design: `token` = installation token (for upstream/fetch from base repo). The fork push uses `forkContext.botPat` which is available in `mention.ts`/`write-runner.ts` at push time — no need to carry it in Workspace separately.

**`getOriginTokenFromDir()` / `getOriginTokenFromRemoteUrl()` (lines 135–143):**
After the refactor, these functions return `undefined` (stripped URL has no token). They still serve as the `redactTokenFromError` token source — that remains correct (undefined means fall back to regex-only redaction, which already works).

**Push functions — signature change:**

All three push functions currently call `getOriginTokenFromDir(dir)` for redaction only (they don't use the token for the actual push — they rely on the stored remote URL). After stripping, the push will fail. Fix: accept `token?: string` parameter and construct the auth URL inline:

```ts
// Instead of: await $`git -C ${dir} push ${remote} HEAD:${branchName}`.quiet()
const pushUrl = token
  ? `https://x-access-token:${token}@github.com/${owner}/${repo}.git`
  : remote;
await $`git -C ${dir} push ${pushUrl} HEAD:${branchName}`.quiet();
```

**Problem:** The push functions don't know `owner`/`repo`. They only know `dir` and `remote`. Simplest approach: accept a `token?: string` and a `githubUrl?: string` (pre-constructed). Or: accept `token?: string` and reconstruct from the stored (stripped) remote URL + injected token:
```ts
// Reconstruct token URL from stripped remote URL
const strippedRemoteUrl = await $`git -C ${dir} remote get-url ${remote}`.quiet().text().trim();
// strippedRemoteUrl = https://github.com/owner/repo.git
// Add token: https://x-access-token:TOKEN@github.com/owner/repo.git
const authedUrl = token
  ? strippedRemoteUrl.replace("https://", `https://x-access-token:${token}@`)
  : strippedRemoteUrl;
```

This is clean — reads the repo path from git config (no token), injects token at push time, token never persisted.

**`fetchAndCheckoutPullRequestHeadRef()` (line 493):**

Currently calls `getOriginTokenFromRemoteUrl(dir)` for redaction only, then does `git fetch ${remote} pull/${prNumber}/head:${localBranch}`. After stripping, this fetch fails (GitHub requires auth for PR head refs). Same fix: accept `token?: string`, construct auth URL inline.

**`assertOriginIsFork()` (line 622):**
Reads origin URL to check owner path. After strip, url = `https://github.com/forkOwner/repo.git` — still contains owner path. This function works correctly post-strip. No changes needed.

### Handler-level fetch calls

**These do NOT go through workspace.ts helper functions.** They use `$ \`git -C ${workspace.dir} fetch origin ${ref}\`` directly:

- `mention.ts:1027` — fetch base ref
- `mention.ts:2190` — fetch head ref (shallow)
- `mention.ts:2303` — fetch head ref (retry)
- `review.ts:714` — fetch base ref (deepen)
- `review.ts:728` — fetch base ref (unshallow)
- `review.ts:1287` — fetch base ref
- `review.ts:3607` — fetch base ref (retry workspace)

All these happen in trusted handler code BEFORE `executor.execute()`. The agent is not running yet, so they don't need to be auth-stripped — but after we strip the origin URL, they will fail without token injection.

**Fix approach:** Thread `workspace.token` into the call sites and replace `origin` with the inline auth URL. Since `workspace` is already in scope at all these call sites, this is mechanical.

Alternatively: a helper `authUrl(workspace: Workspace, remote: string): string` that returns the token URL if `workspace.token` is set, else returns `remote` as-is.

### File: `src/handlers/mention.ts`

All `git fetch origin` calls use `workspace.dir` — with `workspace.token` now available, replace `"origin"` with `authUrl(workspace, "origin")` or inline the URL construction.

`fetchAndCheckoutPullRequestHeadRef` call at line 1019 passes only `dir`, no token. Needs `token: workspace.token`.

Push calls (lines 2008, 2246, 2349, 2387) pass `dir: workspace.dir`. The push functions need `token: workspace.token` added.

### File: `src/handlers/review.ts`

`fetchAndCheckoutPullRequestHeadRef` call at line 1278 — same fix.

Direct `git fetch origin` calls at lines 714, 728, 1287, 3607 — same auth URL pattern.

### File: `src/slack/write-runner.ts`

`createBranchCommitAndPush` call at line 354/491 — needs `token` passed. `workspace` is in scope. `write-runner.ts` line 69 references `Workspace` type — will pick up the new `token` field automatically.

### File: `src/jobs/workspace.test.ts`

Current tests only cover `enforceWritePolicy` and `buildWritePolicyRefusalMessage`. Need to add:
- Test for `createWorkspaceManager().create()` verifying origin URL has no token after creation (requires a real git repo fixture or spy on shell commands)
- Tests for push functions accepting `token` parameter

**Testing the strip without a real GitHub clone:** Can use a local bare git repo as a remote, or mock the `$` (bun shell) calls. The spec says "unit test reads back `git remote get-url origin` after `workspace.create()` and asserts no x-access-token present" — this requires either a real clone or a carefully crafted integration test with a local bare repo.

Pragmatic approach: use a local bare git repo (`git init --bare`) as the remote for test purposes, then verify the stripped URL. The existing test patterns use real tmp dirs for write-policy tests; the same pattern works here.

---

## Task Decomposition

### T01: Add `token` to `Workspace` type + strip token in `workspace.create()`

**Files:** `src/jobs/types.ts`, `src/jobs/workspace.ts`

- Add `token?: string` to `Workspace` interface
- In `createWorkspaceManager().create()`: after clone, call `git remote set-url origin https://github.com/${owner}/${repo}.git`. For fork clones: strip origin (fork URL) and upstream remote (base URL). Return `token` in workspace object.
- No push function changes yet in this task.

**Verify:** `git remote get-url origin` in the returned workspace dir returns `https://github.com/owner/repo.git` with no `x-access-token`. Unit test: create a local bare repo, clone it via `workspace.create()` (mocked or adapted), assert stripped URL.

### T02: Refactor push/fetch functions to accept token, construct auth URL inline

**Files:** `src/jobs/workspace.ts`

- `createBranchCommitAndPush`: add `token?: string` to options; construct auth push URL from stripped remote
- `commitAndPushToRemoteRef`: same
- `pushHeadToRemoteRef`: same
- `fetchAndCheckoutPullRequestHeadRef`: add `token?: string` to options; construct auth fetch URL

Auth URL construction utility (private function in workspace.ts):
```ts
function makeAuthUrl(strippedUrl: string, token: string | undefined): string {
  if (!token) return strippedUrl;
  return strippedUrl.replace(/^https:\/\//, `https://x-access-token:${token}@`);
}
```

The `getOriginTokenFromDir` / `getOriginTokenFromRemoteUrl` functions remain but return undefined after strip — used only for `redactTokenFromError` fallback. No functional change needed there.

**Verify:** bun test of push/fetch functions with a local bare repo; token passed explicitly works; no token in git config.

### T03: Update call sites in handlers + write-runner + executor

**Files:** `src/handlers/mention.ts`, `src/handlers/review.ts`, `src/slack/write-runner.ts`

- Pass `token: workspace.token` to all `fetchAndCheckoutPullRequestHeadRef` calls
- Pass `token: workspace.token` to all push function calls
- Replace direct `git fetch origin` calls with inline auth URL

**Verify:** Existing handler tests continue to pass. Add a focused test that confirms `workspace.token` is threaded to push/fetch.

### T04: Unit test for workspace.create() + full suite

**Files:** `src/jobs/workspace.test.ts`

Add tests:
- `createWorkspaceManager().create()` strips token from origin URL (use local bare repo)
- `fetchAndCheckoutPullRequestHeadRef` accepts explicit token (mock-based)
- `createBranchCommitAndPush` accepts explicit token (mock-based)

bun test `src/jobs/workspace.test.ts` exits 0.

---

## Risks

### Risk 1: Local bare repo test setup complexity (MEDIUM)
Testing `workspace.create()` with a real clone requires a local bare git repo fixture and a mock `githubApp.getInstallationToken()`. Manageable but non-trivial. Alternative: extract the URL-strip logic into a testable pure function and test it directly, plus test that `create()` calls `git remote set-url origin` via spy.

### Risk 2: Fork clone has two token-bearing URLs (MEDIUM — understood)
Standard clone: one token (installation token for origin). Fork clone: two tokens — `forkContext.botPat` for origin (fork), installation token for upstream. After strip, Workspace carries the installation token in `token`. The botPat is available to push callers via `forkContext.botPat` (already in scope in mention.ts/write-runner.ts). The workspace.ts push functions need to handle this — they won't always push to origin using the installation token; fork pushes use botPat to origin, not installation token to upstream. The push function needs to accept any token, not necessarily workspace.token. The caller knows which token is appropriate.

**Resolution:** Make push functions accept `token?: string` where the caller provides the right token. In mention.ts, fork pushes use `forkContext.botPat`; direct pushes use `workspace.token` (installation token).

### Risk 3: handler-level fetch call sites are many (LOW)
There are 7 direct `git fetch origin` call sites across mention.ts and review.ts. All mechanical changes. Low risk but needs thoroughness.

### Risk 4: `redactTokenFromError` becomes regex-only after strip (LOW — acceptable)
After the strip, `getOriginTokenFromDir()` returns `undefined`. `redactTokenFromError` falls through to the regex-based redaction (already implemented as defense-in-depth). Error messages that include the token URL will still be redacted by the regex pattern. The token value itself might not be redacted if it appears in a non-URL context — but since the token is now never stored, the only way it appears in an error is if the caller passes it in as a string argument, which won't happen with the inline URL approach.

---

## Key Invariants to Preserve

1. `assertOriginIsFork()` works post-strip — verified: reads `github.com/owner/repo.git` path, no token dependency
2. `loadRepoConfig()` and `executor.ts` only need `workspace.dir` — no auth needed for local file reads
3. `git diff`, `git log`, `git status`, `git show` — no auth needed, all operate on on-disk objects
4. write-policy enforcement (`enforceWritePolicy`) — no auth needed, runs on staged files in local clone
5. `cleanupStale()` — no auth needed, filesystem operation only

---

## What Does NOT Need Auth Post-Strip

These all work against the local clone with no remote access:
- `git status`, `git diff`, `git add`, `git commit`
- `git log`, `git show`, `git rev-parse`
- `git checkout -b`, `git checkout`
- `enforceWritePolicy` (reads file content from disk)
- `getGitStatusPorcelain`
- `assertOriginIsFork` (reads config, not GitHub)
- File reads/writes in the workspace dir

These need the token:
- `git fetch origin <ref>` (all 7 call sites, pre-agent)
- `git push origin HEAD:<branch>` (4 push functions)
- `git clone` (at workspace creation — before strip, token is used)
- `fetchAndCheckoutPullRequestHeadRef` (internally does fetch)
