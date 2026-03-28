# S02: Git Remote Sanitization + Token Memory Refactor — UAT

**Milestone:** M031
**Written:** 2026-03-28T17:20:04.192Z

## UAT: S02 — Git Remote Sanitization + Token Memory Refactor

### Preconditions
- Project cloned at `/home/keith/src/kodiai`
- Bun runtime available
- `git` CLI available (used by test helpers)

---

### Test 1: URL-strip invariant — `git remote get-url origin` contains no credential after workspace setup

**Test case:** `git remote URL strip after clone simulation > git remote get-url origin does not contain x-access-token after simulated workspace setup`

**Steps:**
1. `bun test src/jobs/workspace.test.ts --grep "git remote URL strip"`
2. Observe: test creates a local bare repo, clones it, sets the remote URL to `https://x-access-token:ghp_test@github.com/owner/repo.git`, then strips it with `git remote set-url`
3. Expected: `git remote get-url origin` returns `https://github.com/owner/repo.git` — no `x-access-token` substring

**Pass criteria:** Test passes; assert `not.toContain("x-access-token")` holds.

---

### Test 2: `buildAuthFetchUrl` — token absent returns 'origin'

**Test case:** `buildAuthFetchUrl > returns 'origin' when token is undefined`

**Steps:**
1. `bun test src/jobs/workspace.test.ts --grep "returns 'origin' when token is undefined"`
2. Expected: function reads stripped remote URL from a local bare repo clone, token=undefined → returns literal `'origin'`

**Pass criteria:** Test passes; returned value equals `'origin'`.

---

### Test 3: `buildAuthFetchUrl` — token present injects credential

**Test cases:** `buildAuthFetchUrl > injects token into a clean https://github.com URL` and `buildAuthFetchUrl > injected URL contains x-access-token prefix`

**Steps:**
1. `bun test src/jobs/workspace.test.ts --grep "buildAuthFetchUrl"`
2. Expected: function returns URL containing `x-access-token:test-token@github.com`; URL starts with `https://x-access-token:`

**Pass criteria:** Both tests pass; credential is embedded in the auth URL.

---

### Test 4: `Workspace.token` memory threading

**Test cases:** `createWorkspaceManager token threading > workspace.token is populated from getInstallationToken` and `createWorkspaceManager token threading > createWorkspaceManager with mocked githubApp returns token in workspace`

**Steps:**
1. `bun test src/jobs/workspace.test.ts --grep "token threading"`
2. Expected: mocked `githubApp.getInstallationToken()` returns a test token; workspace object returned by `create()` has `.token` equal to that value

**Pass criteria:** Both tests pass; `workspace.token` equals the mocked installation token.

---

### Test 5: Full workspace test suite — all 16 tests pass

**Steps:**
1. `bun test src/jobs/workspace.test.ts`
2. Expected: 16 pass, 0 fail

**Pass criteria:** Exit code 0; output shows `16 pass`.

---

### Test 6: TypeScript — no type errors

**Steps:**
1. `bunx tsc --noEmit`
2. Expected: exits 0, no output

**Pass criteria:** Exit code 0. Confirms `token?: string` on Workspace interface, `token?` on all push/fetch option types, and `buildAuthFetchUrl` export signature are all coherent across the codebase.

---

### Edge Cases

**EC1 — Fork clone path:** `Workspace` interface includes `token?: string`; the fork-clone branch in `workspace.ts` also strips both `origin` and `upstream` remotes. Verified by TypeScript — runtime path exercised only with real GitHub App credentials.

**EC2 — Missing token (unauthenticated caller):** All push/fetch functions accept `token?: string`. When undefined, `makeAuthUrl` returns the bare URL unchanged and `buildAuthFetchUrl` returns `'origin'`. No credential injection occurs; the operation falls back to whatever system git auth is available.

**EC3 — Token in error redaction:** `redactTokenFromError` continues to work correctly because it operates on the error message (which may contain the auth URL from a failed push command), not on `.git/config`.

