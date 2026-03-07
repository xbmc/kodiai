# Phase 127: Fork-based write mode with gist patches - Research

**Researched:** 2026-03-07
**Domain:** GitHub API (forks, gists, cross-fork PRs), git push routing, authentication
**Confidence:** HIGH

## Summary

This phase replaces direct branch creation in target repos with a fork-based workflow. All git pushes from write-mode go to a bot-owned fork, and PRs are created cross-fork. Gists become a first-class output for patches and artifacts. The existing codebase has a clear single choke point for push operations (`workspace.ts`) and two consumer flows (mention handler + Slack write-runner).

**Critical architectural constraint:** GitHub App installation tokens CANNOT create forks. The GitHub Apps permission model is installation-scoped and cannot cross account boundaries for fork operations. A dedicated bot user account with a Personal Access Token (PAT) is required for fork creation, fork pushes, and gist creation. The existing `GitHubApp` auth layer handles installation tokens only -- a parallel auth path for the bot PAT is needed.

**Primary recommendation:** Add a `BotUserClient` abstraction (PAT-authenticated Octokit) alongside the existing `GitHubApp` (installation-token-authenticated). Route fork/gist operations through the bot client, keep all other GitHub API calls on installation tokens.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions
- Single bot-owned fork per repo under a dedicated bot user account (e.g. kodiai-bot/repo-name)
- Fork created lazily on first write request targeting a repo -- no eager forking on app install
- Fork kept permanently and reused across all write requests for that repo
- Merged/stale branches in the fork are pruned (auto-delete after PR merge)
- Gists are a first-class output mode, not just a fallback
- Routing logic: explicit "patch" request -> gist; explicit "PR" request -> fork PR; simple single-file change -> gist; complex or multi-file change -> PR
- Gists can also be used for sharing logs, diagnostics, and other artifacts
- Gist format: unified diff (git diff output / .patch format)
- Gist visibility: secret (not publicly listed, accessible via URL)
- Gist link posted as a comment on the issue/PR that triggered the request
- Dual enforcement: code-level guard in workspace.ts + system prompt instructions to the agent
- Direct push attempts are silently redirected to the fork (not blocked with an error)
- No config escape hatch -- fork-only mode is unconditional for all repos
- Existing kodiai/write-* and kodiai/slack/* branches in repos should be cleaned up
- Fork synced with upstream default branch before each write request starts
- If forking or cross-fork PR creation fails, fall back to creating a gist with the patch
- PR title/body format stays the same as today (no new labels or conventions)
- Fork branches auto-deleted after the corresponding PR is merged

### Claude's Discretion
- Bot user account naming and PAT/auth setup details
- Fork sync implementation (GitHub API merge upstream vs git fetch/reset)
- Exact heuristic for simple vs complex change routing (gist vs PR)
- Branch cleanup scheduling/mechanism
- Gist filename conventions

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope

</user_constraints>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @octokit/rest | 22.0.1 | GitHub REST API client | Already in use; provides `repos.createFork`, `gists.create`, `pulls.create` |
| @octokit/auth-app | 8.2.0 | GitHub App authentication | Already in use for installation tokens |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none new) | - | - | All needed APIs are available through existing @octokit/rest |

### No New Dependencies Required
The existing `@octokit/rest` v22 already exposes all needed endpoints:
- `octokit.rest.repos.createFork({ owner, repo })`
- `octokit.rest.gists.create({ files, description, public })`
- `octokit.rest.pulls.create({ owner, repo, head: "fork-owner:branch", base })`
- `octokit.request("POST /repos/{owner}/{repo}/merge-upstream", { branch })` for fork sync
- `octokit.rest.git.deleteRef({ owner, repo, ref })` for branch cleanup

## Architecture Patterns

### Authentication: Dual-Client Pattern

**CRITICAL:** GitHub App installation tokens cannot create forks (confirmed limitation, GitHub community discussion #24607). Gist creation also requires user-level auth (`gist` OAuth scope), not installation tokens.

```
Authentication Architecture:

  GitHubApp (existing)              BotUserClient (NEW)
  ├── Installation tokens           ├── PAT-based Octokit
  ├── Repo-scoped operations        ├── Fork creation
  ├── PR reviews, comments          ├── Fork push (git remote)
  ├── Issue interactions             ├── Gist creation
  └── Read repo contents            ├── Fork sync (merge-upstream)
                                    └── Fork branch cleanup
```

**Implementation:**

```typescript
// src/auth/bot-user.ts (NEW)
export interface BotUserClient {
  /** Octokit authenticated as the bot user (PAT). */
  octokit: Octokit;
  /** Bot user's GitHub login (e.g. "kodiai-bot"). */
  login: string;
  /** Ensure a fork exists for owner/repo. Returns fork full_name. */
  ensureFork(owner: string, repo: string): Promise<{ forkOwner: string; forkRepo: string }>;
  /** Create a secret gist with the given files. */
  createGist(options: { description: string; files: Record<string, { content: string }> }): Promise<{ htmlUrl: string; id: string }>;
  /** Sync fork's branch with upstream. */
  syncFork(forkOwner: string, forkRepo: string, branch: string): Promise<void>;
  /** Delete a branch in the fork. */
  deleteForkBranch(forkOwner: string, forkRepo: string, branch: string): Promise<void>;
}
```

**PAT requirements (classic token):**
- `repo` scope (fork creation, push to fork, cross-fork PR)
- `gist` scope (gist creation)

**Environment variable:** `BOT_USER_PAT` (or `GITHUB_BOT_PAT`)

### Fork Management Pattern

```
Write Request Flow:

1. Receive write request (mention or Slack)
2. Resolve installation context (existing)
3. Ensure fork exists:
   a. Check cache (in-memory Map<string, ForkInfo>)
   b. If miss: GET /repos/{botLogin}/{repo} -- 200 = exists, 404 = create
   c. If 404: POST /repos/{owner}/{repo}/forks (bot PAT) -> wait for fork ready
4. Sync fork with upstream:
   POST /repos/{botLogin}/{repo}/merge-upstream { branch: defaultBranch }
5. Clone from fork (bot PAT auth URL, not installation token)
6. Make changes (existing agent execution)
7. Route output:
   - Gist path: generate diff, create gist, post link as comment
   - PR path: push to fork branch, create cross-fork PR
```

### Push Redirect Pattern (workspace.ts)

The key architectural change is in `workspace.ts`. Currently, `createBranchCommitAndPush`, `commitAndPushToRemoteRef`, and `pushHeadToRemoteRef` all push to `origin` which is the target repo. The redirect pattern changes the git remote to point at the fork instead.

**Approach: Change the remote URL at clone time, not at push time.**

```typescript
// In workspace manager create():
// Instead of cloning from target repo with installation token,
// clone from fork with bot PAT:
const cloneUrl = `https://x-access-token:${botPat}@github.com/${forkOwner}/${forkRepo}.git`;
await $`git clone --depth=1 --single-branch --branch ${ref} ${cloneUrl} ${dir}`.quiet();

// Add upstream remote for reference if needed:
const upstreamUrl = `https://x-access-token:${installationToken}@github.com/${owner}/${repo}.git`;
await $`git -C ${dir} remote add upstream ${upstreamUrl}`.quiet();
```

This way, all existing `git push origin ...` calls in `createBranchCommitAndPush` etc. automatically push to the fork. No changes needed to push functions themselves.

**Guard in workspace.ts:** Add a validation that prevents the `origin` remote from ever pointing at a non-fork repo during write-mode operations. This is the "code-level guard" from the locked decisions.

### Cross-Fork PR Creation

```typescript
// When creating a PR from fork to upstream:
await installationOctokit.rest.pulls.create({
  owner: upstreamOwner,   // target repo owner
  repo: upstreamRepo,     // target repo name
  title: prTitle,
  head: `${forkOwner}:${branchName}`,  // CRITICAL: fork_owner:branch format
  base: defaultBranch,
  body: prBody,
});
```

**Important:** The PR creation API call goes to the UPSTREAM repo endpoint, but the `head` parameter uses `fork_owner:branch_name` format. The installation token (which has access to the upstream repo) is used for this call, NOT the bot PAT.

### Gist Output Pattern

```typescript
// Generate patch from workspace
const patch = (await $`git -C ${dir} diff HEAD`.quiet()).text();
// Or for committed changes:
const patch = (await $`git -C ${dir} format-patch -1 HEAD --stdout`.quiet()).text();

// Create gist via bot PAT
const gist = await botClient.createGist({
  description: `Patch for ${owner}/${repo}: ${summary}`,
  files: {
    [`${owner}-${repo}-${branchSlug}.patch`]: { content: patch },
  },
});

// Post gist link as comment on triggering issue/PR (via installation token)
await installationOctokit.rest.issues.createComment({
  owner, repo,
  issue_number: issueNumber,
  body: `Here's the patch: ${gist.htmlUrl}\n\nApply with:\n\`\`\`bash\ncurl -sL ${gist.htmlUrl}.patch | git apply\n\`\`\``,
});
```

### Output Routing Heuristic

```typescript
function shouldUseGist(intent: WriteIntent, changedFiles: string[]): boolean {
  // Explicit user intent overrides
  if (intent.keyword === "patch") return true;
  if (intent.keyword === "pr") return false;

  // Simple heuristic for automatic routing
  if (changedFiles.length === 1) return true;  // single file = gist
  if (changedFiles.length > 3) return false;   // many files = PR

  // 2-3 files: check if they're closely related
  // (e.g., same directory = likely gist-appropriate)
  const dirs = new Set(changedFiles.map(f => f.split("/").slice(0, -1).join("/")));
  return dirs.size === 1;
}
```

### Recommended Project Structure Changes

```
src/
├── auth/
│   ├── github-app.ts          # Existing - installation token auth
│   └── bot-user.ts            # NEW - bot PAT auth + fork/gist operations
├── jobs/
│   ├── workspace.ts           # MODIFIED - fork-aware cloning + push guard
│   ├── fork-manager.ts        # NEW - fork lifecycle (ensure, sync, cleanup)
│   └── gist-publisher.ts      # NEW - gist creation + comment posting
├── handlers/
│   └── mention.ts             # MODIFIED - output routing (gist vs PR)
├── slack/
│   └── write-runner.ts        # MODIFIED - output routing (gist vs PR)
└── config.ts                  # MODIFIED - add BOT_USER_PAT env var
```

### Anti-Patterns to Avoid
- **Dual remote push logic:** Do NOT add fork-specific push functions alongside existing ones. Instead, change the clone remote to point at the fork so existing push functions work unchanged.
- **Installation token for fork ops:** Never try to use installation tokens for fork creation or gist creation -- they will fail silently or with confusing errors.
- **Eager fork creation:** Do NOT fork all installed repos upfront. Fork lazily on first write request.
- **Blocking on fork readiness:** GitHub fork creation is async. The API returns 202 and the fork may take seconds to be ready. Must poll or retry.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Fork creation | Manual git clone + push | `octokit.rest.repos.createFork()` | Handles GitHub's async fork process, permissions, naming |
| Fork sync | `git fetch upstream && git reset --hard` | `POST /repos/{owner}/{repo}/merge-upstream` | Handles conflicts gracefully, no local clone needed |
| Gist creation | Manual file upload | `octokit.rest.gists.create()` | Handles visibility, URL generation, API auth |
| Patch generation | Custom diff logic | `git diff` or `git format-patch --stdout` | Standard unified diff format, handles binary files |
| Cross-fork PR | Custom merge logic | `octokit.rest.pulls.create()` with `fork_owner:branch` head | GitHub handles the cross-repo reference |

**Key insight:** All fork/gist operations have dedicated GitHub REST API endpoints. The complexity is in authentication routing (which client to use for which call), not in the operations themselves.

## Common Pitfalls

### Pitfall 1: Fork Creation is Asynchronous
**What goes wrong:** Calling `repos.createFork()` returns 202 Accepted, but the fork is not immediately usable. Attempting to clone or push to it immediately fails.
**Why it happens:** GitHub creates forks asynchronously. The API acknowledges the request before the fork repo is fully created.
**How to avoid:** After `createFork()`, poll `GET /repos/{forkOwner}/{forkRepo}` until it returns 200. Use exponential backoff with a timeout (e.g., 30s max, 1s initial delay).
**Warning signs:** 404 errors when trying to clone or push to a newly created fork.

### Pitfall 2: Cross-Fork PR Head Format
**What goes wrong:** PR creation fails with "head doesn't exist" or similar errors.
**Why it happens:** The `head` parameter for cross-fork PRs must be `fork_owner:branch_name`, not just `branch_name`.
**How to avoid:** Always use the format `${forkOwner}:${branchName}` for the `head` parameter when creating cross-fork PRs.
**Warning signs:** 422 Unprocessable Entity from `pulls.create`.

### Pitfall 3: Installation Token vs Bot PAT Confusion
**What goes wrong:** Using the wrong authentication for different operations causes silent failures or permission errors.
**Why it happens:** The dual-auth pattern means some operations use installation tokens and others use the bot PAT.
**How to avoid:** Create a clear mapping: fork ops + gists = bot PAT; everything else (PR creation on upstream, comments, reviews) = installation token.
**Warning signs:** 403 Forbidden, "Resource not accessible by integration", or "Not Found" on fork/gist endpoints.

### Pitfall 4: Fork Sync Conflicts
**What goes wrong:** `merge-upstream` can fail if the fork's default branch has diverged from upstream (e.g., someone pushed to it directly).
**Why it happens:** The merge-upstream API does a fast-forward merge by default. If the fork branch has commits not in upstream, it fails.
**How to avoid:** If merge-upstream fails, fall back to force-pushing the upstream HEAD to the fork's default branch. The fork is bot-owned so force-push is safe.
**Warning signs:** 409 Conflict from merge-upstream endpoint.

### Pitfall 5: Stale Fork Cache
**What goes wrong:** The in-memory fork cache says a fork exists, but it was deleted externally (manually or by GitHub).
**Why it happens:** In-memory caches don't survive process restarts and can't track external deletions.
**How to avoid:** On any fork operation failure, invalidate the cache entry and retry with `ensureFork()`.
**Warning signs:** 404 on push to fork after successful cache lookup.

### Pitfall 6: Branch Name Collision in Fork
**What goes wrong:** Multiple write requests targeting the same repo create branches with the same name in the fork.
**Why it happens:** The deterministic branch naming scheme is based on the trigger context. Replayed or duplicate webhooks could collide.
**How to avoid:** The existing idempotency checks (writeOutputKey) prevent duplicate work. The fork just needs the same deterministic naming convention.
**Warning signs:** Push rejection due to non-fast-forward.

## Code Examples

### Ensure Fork Exists (with async wait)

```typescript
// Source: GitHub REST API docs + community patterns
async function ensureFork(
  botOctokit: Octokit,
  botLogin: string,
  upstreamOwner: string,
  upstreamRepo: string,
): Promise<{ forkOwner: string; forkRepo: string }> {
  // Check if fork already exists
  try {
    await botOctokit.rest.repos.get({ owner: botLogin, repo: upstreamRepo });
    return { forkOwner: botLogin, forkRepo: upstreamRepo };
  } catch (err) {
    if (!hasStatusCode(err, 404)) throw err;
  }

  // Create fork
  await botOctokit.rest.repos.createFork({
    owner: upstreamOwner,
    repo: upstreamRepo,
    default_branch_only: true,
  });

  // Poll until ready (max 30s)
  const maxWaitMs = 30_000;
  const intervalMs = 2_000;
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await new Promise((r) => setTimeout(r, intervalMs));
    try {
      await botOctokit.rest.repos.get({ owner: botLogin, repo: upstreamRepo });
      return { forkOwner: botLogin, forkRepo: upstreamRepo };
    } catch {
      // Not ready yet
    }
  }

  throw new Error(`Fork ${botLogin}/${upstreamRepo} not ready after ${maxWaitMs}ms`);
}
```

### Sync Fork with Upstream

```typescript
// Source: GitHub REST API POST /repos/{owner}/{repo}/merge-upstream
async function syncForkWithUpstream(
  botOctokit: Octokit,
  forkOwner: string,
  forkRepo: string,
  branch: string,
): Promise<void> {
  try {
    await botOctokit.request("POST /repos/{owner}/{repo}/merge-upstream", {
      owner: forkOwner,
      repo: forkRepo,
      branch,
    });
  } catch (err) {
    // If merge-upstream fails (e.g., conflict), force-update the branch.
    // The fork is bot-owned, so this is safe.
    if (hasStatusCode(err, 409)) {
      // Fallback: use git operations to force-sync
      // This would be done in the workspace after cloning
      throw err; // Let caller handle with git-based fallback
    }
    throw err;
  }
}
```

### Create Secret Gist with Patch

```typescript
// Source: GitHub REST API POST /gists
async function createPatchGist(
  botOctokit: Octokit,
  options: {
    owner: string;
    repo: string;
    summary: string;
    patch: string;
  },
): Promise<{ htmlUrl: string; id: string }> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${options.owner}-${options.repo}-${timestamp}.patch`;

  const response = await botOctokit.rest.gists.create({
    description: `[kodiai] Patch for ${options.owner}/${options.repo}: ${options.summary}`,
    public: false,  // secret gist
    files: {
      [filename]: { content: options.patch },
    },
  });

  return {
    htmlUrl: response.data.html_url!,
    id: response.data.id!,
  };
}
```

### Cross-Fork PR Creation

```typescript
// Source: GitHub REST API POST /repos/{owner}/{repo}/pulls
// Note: uses installation token for the upstream repo, not bot PAT
async function createCrossForkPR(
  installationOctokit: Octokit,
  options: {
    upstreamOwner: string;
    upstreamRepo: string;
    forkOwner: string;
    branchName: string;
    baseBranch: string;
    title: string;
    body: string;
  },
): Promise<{ htmlUrl: string }> {
  const response = await installationOctokit.rest.pulls.create({
    owner: options.upstreamOwner,
    repo: options.upstreamRepo,
    title: options.title,
    head: `${options.forkOwner}:${options.branchName}`,
    base: options.baseBranch,
    body: options.body,
  });

  return { htmlUrl: response.data.html_url };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Push branches to target repo | Push to bot-owned fork | This phase | Eliminates branch pollution in target repos |
| Only PR output | Gist for patches + PR for complex changes | This phase | Lighter-weight output for simple changes |
| Installation token for everything | Dual auth (installation + bot PAT) | This phase | Required for fork/gist operations |
| No fork sync API | `POST /repos/{owner}/{repo}/merge-upstream` | Sept 2021 | Clean fork sync without local git operations |

**Current codebase state:**
- `workspace.ts` push functions assume `origin` = target repo (needs redirect)
- Branch naming: `kodiai/apply/...` (mention) and `kodiai/slack/...` (Slack) -- both push to target repo
- `createWorkspaceManager` clones with installation token -- needs bot PAT option for fork cloning
- No fork or gist code exists yet

## Open Questions

1. **Fork naming when repo names collide**
   - What we know: GitHub forks default to the same name as the upstream repo. If the bot already has a fork of `org-a/utils` and tries to fork `org-b/utils`, GitHub appends a suffix (e.g., `utils-1`).
   - What's unclear: Whether the suffix is predictable and how to handle it reliably.
   - Recommendation: After `createFork()`, use the response's `full_name` field (not assumed naming) and store the mapping in the in-memory cache.

2. **Bot user account provisioning**
   - What we know: Need a GitHub user account with a PAT. The CONTEXT.md mentions "kodiai-bot" as an example name.
   - What's unclear: Whether the account already exists or needs to be created. Whether it's a GitHub user or a machine user.
   - Recommendation: Document the account setup in operational docs. The code should read `BOT_USER_PAT` and `BOT_USER_LOGIN` from environment variables.

3. **Webhook-driven branch cleanup**
   - What we know: Fork branches should auto-delete after PR merge. GitHub can auto-delete head branches on merge, but this setting is per-repo.
   - What's unclear: Whether the "auto-delete head branch" setting on the fork covers cross-fork PRs, or if we need to listen to `pull_request.closed` webhooks.
   - Recommendation: Enable auto-delete on the fork repo via API (`PATCH /repos/{owner}/{repo}` with `delete_branch_on_merge: true`). If that doesn't cover cross-fork PRs, add a webhook handler for `pull_request.closed` that deletes the fork branch.

4. **Legacy branch cleanup scope**
   - What we know: Existing `kodiai/write-*` and `kodiai/slack/*` branches in target repos should be cleaned up.
   - What's unclear: How many branches exist across how many repos. Whether this is a one-time script or an ongoing migration.
   - Recommendation: One-time cleanup script using the installation token. List refs matching `kodiai/` prefix, delete each. Run once after deployment.

## Sources

### Primary (HIGH confidence)
- GitHub Community Discussion #24607 - Confirmed: GitHub Apps cannot fork repositories (installation token limitation)
- GitHub REST API docs - `POST /repos/{owner}/{repo}/forks` endpoint
- GitHub REST API docs - `POST /gists` endpoint (requires `gist` OAuth scope)
- GitHub REST API docs - `POST /repos/{owner}/{repo}/merge-upstream` (fork sync, since Sept 2021)
- GitHub REST API docs - Cross-fork PR creation with `fork_owner:branch` head format
- Existing codebase: `src/jobs/workspace.ts`, `src/handlers/mention.ts`, `src/slack/write-runner.ts`, `src/auth/github-app.ts`

### Secondary (MEDIUM confidence)
- GitHub OAuth scopes docs - `gist` scope for gist creation, `repo` scope for fork operations
- GitHub changelog Sept 2021 - merge-upstream API introduction

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - using existing @octokit/rest, no new deps needed
- Architecture: HIGH - dual-auth pattern is well-documented; fork/gist APIs are stable
- Pitfalls: HIGH - GitHub App fork limitation is confirmed by GitHub staff; cross-fork PR format is documented
- Auth constraints: HIGH - verified through multiple sources that installation tokens cannot create forks

**Research date:** 2026-03-07
**Valid until:** 2026-04-07 (stable APIs, unlikely to change)
