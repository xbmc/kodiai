# Phase 2: Job Infrastructure - Research

**Researched:** 2026-02-07
**Domain:** In-process job queue with per-installation concurrency, ephemeral workspace management (git clone, auth, cleanup)
**Confidence:** HIGH

## Summary

This phase builds two modules: (1) a job queue that enforces per-installation concurrency limits (one active job per GitHub App installation at a time), and (2) a workspace manager that creates ephemeral clone directories, configures git authentication via installation access tokens, and guarantees cleanup after job completion or failure.

The recommended approach uses **p-queue v9.x** (one PQueue instance per installation ID, stored in a Map) for per-installation concurrency control. Each PQueue instance is configured with `concurrency: 1`, ensuring only one job runs at a time per installation while allowing parallel execution across different installations. For workspace management, use **Bun.$** (Bun shell) for git clone/config commands -- it provides automatic string escaping that prevents shell injection, which is critical since repository names and branch names come from external webhook payloads. Temporary directories use **node:fs mkdtemp** (supported natively by Bun) with explicit cleanup in a try/finally pattern to prevent orphaned directories.

The reference code in `tmp/claude-code-action/src/github/operations/git-config.ts` provides the exact git auth configuration pattern to port. The key insight is that GitHub App installation tokens are used as the HTTP password in the clone URL (`https://x-access-token:{token}@github.com/owner/repo.git`), and `@octokit/auth-app` can provide raw token strings via its `auth({ type: "installation", installationId })` method which returns `{ token: "..." }`.

**Primary recommendation:** Use a Map<number, PQueue> pattern with per-installation PQueue(concurrency: 1) instances. Use Bun.$ for all git commands (automatic escaping). Use node:fs mkdtemp for temp dirs with try/finally cleanup. Get raw installation tokens via createAppAuth's auth() method. Validate branch names before use as the reference code does.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| p-queue | ^9.1.0 | Per-installation concurrency queue | Lightweight, ESM-native, TypeScript support, feature-complete. Used by 2300+ npm packages. Provides exactly the concurrency control needed. |
| Bun.$ (built-in) | Bun runtime | Shell commands for git clone/config | Built-in, automatic string escaping prevents injection, cross-platform shell, no external dependency |
| node:fs (mkdtemp) | Built-in | Temporary directory creation | Bun natively supports node:fs. mkdtemp creates unique dirs with random suffixes. |
| @octokit/auth-app | ^8.2.0 (already installed) | Installation access token generation | Already used in Phase 1. Can produce raw token strings for git URL auth. Built-in token caching. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node:path (join, resolve) | Built-in | Path construction for temp dirs | Joining temp dir prefix with os.tmpdir() |
| node:os (tmpdir) | Built-in | Platform temp directory | Getting system temp dir for workspace creation |
| Bun.spawn | Built-in | Long-running subprocess control | If a git operation needs timeout/kill/AbortSignal support beyond Bun.$ capabilities |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| p-queue | Custom Map + Promise chain | p-queue handles edge cases (error isolation, queue draining, pause/resume, idle detection) that a hand-rolled solution would miss |
| p-queue | BullMQ / Redis-backed queue | Overkill for single-process, in-memory concurrency control. Plan.md mentions "Future: Azure Service Bus" -- current MVP is in-process. |
| Bun.$ | Bun.spawn (array args) | Bun.spawn avoids shell entirely (safest), but Bun.$ auto-escapes interpolated values and is more ergonomic for multi-command git flows. For git commands that take user-controlled branch names, both are safe when input is validated. |
| Bun.$ | execFileSync (as reference code uses) | execFileSync is Node.js API. Bun.$ is the idiomatic Bun approach with better ergonomics and automatic escaping. |
| mkdtemp | Bun-specific temp API | No Bun-specific temp dir API exists beyond node:fs compat. mkdtemp is the correct choice. |

**Installation:**
```bash
bun install p-queue
```

## Architecture Patterns

### Recommended Project Structure
```
src/
  jobs/
    queue.ts          # Job queue with per-installation concurrency (createJobQueue)
    workspace.ts      # Workspace manager: clone, git auth, cleanup (createWorkspaceManager)
    types.ts          # Job and workspace type definitions
```

### Pattern 1: Per-Installation Queue Map
**What:** A Map<number, PQueue> where each installation ID maps to its own PQueue instance with concurrency: 1. A wrapper "job queue" manages the map, lazily creating PQueue instances on first use, and optionally cleaning up idle queues.
**When to use:** Always -- this is the core concurrency pattern for this phase.
**Example:**
```typescript
// Source: p-queue README + per-key pattern
import PQueue from "p-queue";

interface JobQueue {
  enqueue<T>(installationId: number, fn: () => Promise<T>): Promise<T>;
  getQueueSize(installationId: number): number;
  getPendingCount(installationId: number): number;
}

function createJobQueue(logger: Logger): JobQueue {
  const queues = new Map<number, PQueue>();

  function getQueue(installationId: number): PQueue {
    let queue = queues.get(installationId);
    if (!queue) {
      queue = new PQueue({ concurrency: 1 });
      queues.set(installationId, queue);
      logger.debug({ installationId }, "Created queue for installation");
    }
    return queue;
  }

  return {
    enqueue<T>(installationId: number, fn: () => Promise<T>): Promise<T> {
      const queue = getQueue(installationId);
      return queue.add(fn) as Promise<T>;
    },
    getQueueSize(installationId: number): number {
      return queues.get(installationId)?.size ?? 0;
    },
    getPendingCount(installationId: number): number {
      return queues.get(installationId)?.pending ?? 0;
    },
  };
}
```

### Pattern 2: Workspace Lifecycle (Create, Use, Cleanup)
**What:** A workspace manager creates a temp directory, clones the repo into it with git auth, and guarantees cleanup via try/finally. The workspace object is passed into the job function and cleaned up afterward regardless of success/failure.
**When to use:** Every job execution.
**Example:**
```typescript
// Source: Bun docs + reference git-config.ts
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { $ } from "bun";

interface Workspace {
  dir: string;
  cleanup(): Promise<void>;
}

interface CloneOptions {
  owner: string;
  repo: string;
  ref: string;          // branch or SHA to checkout
  token: string;        // installation access token
  depth?: number;       // shallow clone depth (default: 1)
}

async function createWorkspace(options: CloneOptions, logger: Logger): Promise<Workspace> {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-"));
  const { owner, repo, ref, token, depth = 1 } = options;

  try {
    // Clone with token auth -- Bun.$ auto-escapes all interpolated values
    const cloneUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
    await $`git clone --depth=${depth} --single-branch --branch ${ref} ${cloneUrl} ${dir}`.quiet();

    // Configure git user identity in the cloned repo
    await $`git -C ${dir} config user.name "kodiai[bot]"`;
    await $`git -C ${dir} config user.email "kodiai[bot]@users.noreply.github.com"`;

    logger.info({ owner, repo, ref, dir }, "Workspace created");
  } catch (err) {
    // Cleanup on clone failure
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }

  return {
    dir,
    async cleanup() {
      await rm(dir, { recursive: true, force: true });
      logger.debug({ dir }, "Workspace cleaned up");
    },
  };
}
```

### Pattern 3: Getting Raw Installation Tokens
**What:** Using @octokit/auth-app's `createAppAuth` to get a raw token string (not just an authenticated Octokit). The existing `GitHubApp` interface needs a new method to expose the raw token.
**When to use:** When constructing git clone URLs that need the installation access token embedded.
**Example:**
```typescript
// Source: @octokit/auth-app types + README
import { createAppAuth } from "@octokit/auth-app";

// In the GitHubApp interface, add:
async function getInstallationToken(installationId: number): Promise<string> {
  const auth = createAppAuth({
    appId: config.githubAppId,
    privateKey: config.githubPrivateKey,
  });

  const { token } = await auth({
    type: "installation",
    installationId,
  });

  return token; // Raw token string, cached internally by auth-app
}
```

### Pattern 4: Factory Function Pattern (Consistency with Phase 1)
**What:** All modules export factory functions (createJobQueue, createWorkspaceManager) matching the established codebase pattern.
**When to use:** All new module exports.

### Anti-Patterns to Avoid
- **Global/singleton queue:** Do NOT use a single PQueue for all installations. This would serialize all jobs across the entire app, not just per-installation.
- **Fire-and-forget cleanup:** Do NOT skip awaiting cleanup. Use try/finally to guarantee temp dir removal.
- **Token in logs:** NEVER log the installation access token or the clone URL containing it. Log owner/repo/ref but redact the token.
- **Shell commands without Bun.$:** Do NOT use template literals with `child_process.exec()` or manual string concatenation for git commands. Bun.$ handles escaping automatically.
- **Unbounded queue map:** Do NOT let the Map<installationId, PQueue> grow forever. Idle queues should eventually be cleaned up or the map bounded.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Concurrency control | Custom promise chain / semaphore | p-queue | Edge cases around error handling, queue draining, idle detection, and priority are already solved |
| Installation token generation | Custom JWT + REST API calls | @octokit/auth-app `auth({ type: "installation" })` | Token caching, refresh-before-expiry, and JWT signing are complex. Already installed and used in Phase 1 |
| Temp directory naming | Random string + mkdir | node:fs mkdtemp | OS-level atomic unique directory creation, handles race conditions |
| String escaping for shell | Manual escaping / sanitization | Bun.$ template literals | Bun.$ treats each interpolation as a single argument, preventing injection. Manual escaping is error-prone |
| Branch name validation | Simple regex | Port validateBranchName from reference code | The reference code handles 10+ edge cases (leading dash for option injection, consecutive slashes, .lock suffix, @{ sequences, control chars, etc.) |

**Key insight:** The deceptively complex parts of this phase are (1) ensuring no resource leaks under all failure modes (clone fails, job throws, process killed) and (2) preventing injection attacks through git command arguments. Both are better solved by existing tools and established patterns than custom solutions.

## Common Pitfalls

### Pitfall 1: Token Leaking in Logs or Error Messages
**What goes wrong:** Installation access tokens appear in log output, error stack traces, or crash dumps because the clone URL contains `x-access-token:{token}`.
**Why it happens:** Git clone errors include the remote URL in their error messages. Default error logging serializes the full error including the URL.
**How to avoid:** (1) Use `.quiet()` on Bun.$ git commands to suppress stdout/stderr. (2) Catch git errors and redact the URL before re-throwing. (3) Never log the token or clone URL directly -- log `{owner}/{repo}` instead.
**Warning signs:** Seeing `x-access-token:ghs_...` in log output.

### Pitfall 2: Orphaned Temp Directories
**What goes wrong:** Temp directories accumulate on disk because cleanup is skipped when jobs fail, the process crashes, or an exception interrupts the flow between creation and cleanup.
**Why it happens:** Missing try/finally around the workspace lifecycle, or cleanup code that itself throws (hiding the original error).
**How to avoid:** (1) Always wrap workspace usage in try/finally. (2) Make cleanup idempotent (rm with force: true). (3) Add a startup sweep that removes stale `kodiai-*` dirs from tmpdir (optional defense-in-depth). (4) Use `{ recursive: true, force: true }` so cleanup never throws.
**Warning signs:** Disk usage growing, `ls /tmp/kodiai-*` showing old directories.

### Pitfall 3: Queue Memory Leak from Idle Installations
**What goes wrong:** The Map<installationId, PQueue> grows indefinitely as new installations trigger jobs, but their PQueue instances are never removed.
**Why it happens:** PQueue instances with concurrency:1 are lightweight (~few KB), so the leak is slow. But over months with many installations, it adds up.
**How to avoid:** Periodically prune the map (e.g., remove entries that have been idle for 1+ hours). Or accept the leak for MVP (a PQueue instance is very small) and address later if needed.
**Warning signs:** `queues.size` growing monotonically over time.

### Pitfall 4: Argument Injection via Branch Names
**What goes wrong:** A branch name like `--upload-pack=evil-command` is passed to `git clone` or `git checkout`, and git interprets it as a flag rather than a branch name.
**Why it happens:** Git commands accept flags and arguments positionally. Branch names starting with `--` can be misinterpreted.
**How to avoid:** (1) Validate branch names using the reference code's `validateBranchName()` pattern (rejects leading dashes, control chars, etc.). (2) Use `--` separator in git commands: `git checkout -- ${branchName}`. (3) Bun.$ helps with shell-level injection but does NOT prevent git-level argument injection.
**Warning signs:** Branch names with unusual characters in webhook payloads.

### Pitfall 5: Shallow Clone Too Shallow
**What goes wrong:** A `--depth=1` clone doesn't have enough history for the job to work correctly (e.g., diffing against the PR base requires commits from both sides).
**Why it happens:** Shallow clones are faster but may not include the merge base.
**How to avoid:** For PR-related jobs, use a depth based on the PR's commit count (like the reference code does: `Math.max(commitCount, 20)`). For the MVP workspace manager, default to `--depth=1` for initial clone, but allow callers to specify depth. The workspace manager should not be opinionated about depth -- let the job handler decide.
**Warning signs:** Git diff/merge operations failing with "fatal: no merge base" errors.

### Pitfall 6: Installation Token Expiry During Long Jobs
**What goes wrong:** The installation access token used for the git clone URL expires after 1 hour. If a long-running job tries to push after 50+ minutes, the push fails with auth errors.
**Why it happens:** Installation tokens have a 1-hour TTL. The token is baked into the git remote URL at clone time.
**How to avoid:** (1) For the workspace manager, this is acceptable since clone + config happens at the start. (2) If push operations are needed later, the remote URL can be updated with a fresh token before pushing. (3) @octokit/auth-app's built-in caching handles token refresh for API calls, but the git remote URL is a snapshot. (4) For Phase 2, jobs are not expected to run for 1 hour, so this is LOW risk.
**Warning signs:** 401 errors on git push operations after ~55 minutes.

## Code Examples

Verified patterns from official sources and the existing codebase:

### Getting a Raw Installation Access Token
```typescript
// Source: @octokit/auth-app types (node_modules/@octokit/auth-app/dist-types/types.d.ts)
// The auth() function with type: "installation" returns InstallationAccessTokenAuthentication
// which has a `token` field of type string (ACCESS_TOKEN).

import { createAppAuth } from "@octokit/auth-app";

const auth = createAppAuth({
  appId: config.githubAppId,
  privateKey: config.githubPrivateKey,
});

const result = await auth({
  type: "installation",
  installationId: 12345,
});

// result.token is the raw access token string
// result.expiresAt is the UTC timestamp when it expires
// auth-app caches this internally, so repeated calls are cheap
const cloneUrl = `https://x-access-token:${result.token}@github.com/owner/repo.git`;
```

### Git Clone with Bun Shell (Safe Escaping)
```typescript
// Source: Bun docs (bun.com/docs/runtime/shell)
import { $ } from "bun";

// Bun.$ auto-escapes all interpolated values as single arguments
// This is SAFE even if owner/repo contain special characters
const cloneUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
await $`git clone --depth=${depth} --single-branch --branch ${ref} ${cloneUrl} ${targetDir}`.quiet();

// Configure git identity in the cloned repo
await $`git -C ${targetDir} config user.name "kodiai[bot]"`;
await $`git -C ${targetDir} config user.email "kodiai[bot]@users.noreply.github.com"`;
```

### Creating Temp Directory
```typescript
// Source: Bun reference for node:fs compat (bun.com/reference/node/fs/mkdtemp)
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Creates a unique directory like /tmp/kodiai-aBcDeF
const workDir = await mkdtemp(join(tmpdir(), "kodiai-"));

// Cleanup (idempotent, never throws)
await rm(workDir, { recursive: true, force: true });
```

### PQueue Per-Installation
```typescript
// Source: p-queue README (github.com/sindresorhus/p-queue)
import PQueue from "p-queue";

const queue = new PQueue({ concurrency: 1 });

// .add() returns a promise that resolves when the task completes
const result = await queue.add(async () => {
  return await doWork();
});

// Queue status
queue.size;     // number of waiting tasks
queue.pending;  // number of running tasks

// Wait for all tasks to finish
await queue.onIdle();
```

### Branch Name Validation (Port from Reference)
```typescript
// Source: tmp/claude-code-action/src/github/operations/branch.ts
function validateBranchName(branchName: string): void {
  if (!branchName || branchName.trim().length === 0) {
    throw new Error("Branch name cannot be empty");
  }
  if (branchName.startsWith("-")) {
    throw new Error(`Invalid branch name: "${branchName}". Cannot start with a dash.`);
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F ~^:?*[\]\\]/.test(branchName)) {
    throw new Error(`Invalid branch name: "${branchName}". Contains invalid characters.`);
  }
  const validPattern = /^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/;
  if (!validPattern.test(branchName)) {
    throw new Error(`Invalid branch name: "${branchName}". Invalid format.`);
  }
  if (branchName.includes("..")) throw new Error("Branch name cannot contain '..'");
  if (branchName.endsWith(".lock")) throw new Error("Branch name cannot end with '.lock'");
  if (branchName.includes("@{")) throw new Error("Branch name cannot contain '@{'");
  if (branchName.endsWith("/")) throw new Error("Branch name cannot end with '/'");
  if (branchName.includes("//")) throw new Error("Branch name cannot contain '//'");
}
```

### Extending GitHubApp Interface for Raw Tokens
```typescript
// The existing GitHubApp interface in src/auth/github-app.ts needs a new method.
// This follows the established factory function pattern.

export interface GitHubApp {
  // ... existing methods ...
  /** Get a raw installation access token string for use in git URLs */
  getInstallationToken(installationId: number): Promise<string>;
}

// Implementation inside createGitHubApp:
async getInstallationToken(installationId: number): Promise<string> {
  const auth = createAppAuth({
    appId: config.githubAppId,
    privateKey: config.githubPrivateKey,
  });

  const { token } = await auth({
    type: "installation",
    installationId,
  });

  return token;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| p-queue CJS import | p-queue ESM-only (v7+) | p-queue v7.0.0 | Must use ESM imports. Bun handles this natively. |
| execFileSync for git | Bun.$ shell with auto-escaping | Bun 1.0+ | Ergonomic and safe by default. No need for manual array-based exec. |
| Manual token refresh | @octokit/auth-app built-in caching | auth-app v4+ | Token caching handles up to 15K tokens with auto-refresh. |
| Full git clone | Shallow clone (--depth) | Always available | Standard practice for CI/CD workloads. Saves time and disk. |
| Custom concurrency via Promise.all | p-queue | p-queue has been stable for years | Battle-tested concurrency control with proper queue semantics |

**Deprecated/outdated:**
- p-queue CommonJS: No longer available as of v7. ESM only. Not an issue for Bun which handles ESM natively.
- execFileSync for Bun projects: While it works, Bun.$ is the idiomatic replacement with better ergonomics and automatic escaping.

## Open Questions

1. **Global concurrency cap across all installations**
   - What we know: Each installation gets its own PQueue(concurrency: 1). There's no global limit on how many installations can run jobs simultaneously.
   - What's unclear: Should there be a global cap (e.g., max 10 concurrent jobs total)?
   - Recommendation: For MVP, no global cap. A single server instance is unlikely to have more than a handful of concurrent installations. Add global limiting later if monitoring shows resource pressure. PQueue supports a `concurrency` option on the global level if needed.

2. **Stale workspace cleanup on startup**
   - What we know: If the process crashes, temp dirs may remain.
   - What's unclear: Should the server scan for and clean up stale `kodiai-*` dirs on startup?
   - Recommendation: Yes, add a simple startup cleanup that removes any `kodiai-*` directories from tmpdir that are older than 1 hour. This is defense-in-depth and prevents disk leaks across restarts. Implement as a non-blocking background task.

3. **Fork PR clone pattern**
   - What we know: For fork PRs, the clone must target the fork repo (not the base repo). The fork repo URL and branch come from the webhook payload's `pull_request.head.repo.full_name` and `pull_request.head.ref`.
   - What's unclear: Whether the installation token has access to clone fork repos (it depends on the fork's visibility and the app's installation scope).
   - Recommendation: The workspace manager should accept an explicit clone URL (owner/repo) rather than always using the event's base repo. The handler that creates the workspace can determine the correct clone target. For public forks, the installation token for the base repo should work; for private forks, this may require additional investigation in later phases.

4. **Bun.$ kill behavior for long-running git operations**
   - What we know: There is an open issue (oven-sh/bun#11868) about Bun.$ not supporting .kill() on shell promises. For long-running operations, Bun.spawn is recommended instead.
   - What's unclear: Whether git clone operations could hang indefinitely (network issues, large repos).
   - Recommendation: For MVP, git clone with `--depth=1` completes quickly. If timeout is needed, use `Bun.spawn` with the `timeout` option instead of `Bun.$` for the clone command specifically. Or wrap Bun.$ with `Promise.race` and an AbortController timeout.

## Sources

### Primary (HIGH confidence)
- `@octokit/auth-app` types (node_modules/@octokit/auth-app/dist-types/types.d.ts) -- verified InstallationAccessTokenAuthentication shape with `token: string` field
- Bun child-process docs (node_modules/bun-types/docs/runtime/child-process.mdx) -- verified Bun.spawn timeout, AbortSignal, kill APIs
- Bun Shell docs (bun.com/docs/runtime/shell, fetched 2026-02-07) -- verified auto-escaping, .quiet(), .nothrow(), .env(), .cwd() APIs
- p-queue README (github.com/sindresorhus/p-queue, fetched 2026-02-07) -- verified v9.1.0, ESM-only, concurrency API, .add(), .onIdle(), .size, .pending
- Reference code: tmp/claude-code-action/src/github/operations/git-config.ts -- git auth configuration pattern (configureGitAuth, setupSshSigning)
- Reference code: tmp/claude-code-action/src/github/operations/branch.ts -- validateBranchName, setupBranch patterns

### Secondary (MEDIUM confidence)
- Bun node:fs/mkdtemp reference (bun.com/reference/node/fs/mkdtemp) -- confirmed Bun supports mkdtemp, mkdtempSync, and mkdtempDisposableSync
- GitHub Docs: git clone with installation token pattern (docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation)
- Bun shell security (bun.com/docs/runtime/shell) -- argument injection caveat (Bun cannot prevent git-level argument injection, only shell injection)

### Tertiary (LOW confidence)
- Bun.$ kill issue (github.com/oven-sh/bun/issues/11868) -- open as of Nov 2025, unclear if resolved. Workaround: use Bun.spawn for killable processes.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- p-queue is well-established, @octokit/auth-app is already in use, Bun.$ is documented in the bun-types package
- Architecture: HIGH -- per-key queue pattern is well-known, workspace lifecycle is standard try/finally, reference code provides exact patterns to port
- Pitfalls: HIGH -- token leaking, orphaned dirs, and argument injection are well-documented concerns with established mitigations

**Research date:** 2026-02-07
**Valid until:** 2026-03-09 (30 days -- all technologies are stable)
