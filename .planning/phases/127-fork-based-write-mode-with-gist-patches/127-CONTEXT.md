# Phase 127: Fork-based write mode with gist patches - Context

**Gathered:** 2026-03-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Configure write-mode to use forked repositories instead of creating branches in main, implement gist creation for patch requests, and add explicit instructions preventing the bot from creating branches directly. Both GitHub @mention write-mode and Slack write-runner are in scope.

</domain>

<decisions>
## Implementation Decisions

### Fork strategy
- Single bot-owned fork per repo under a dedicated bot user account (e.g. kodiai-bot/repo-name)
- Fork created lazily on first write request targeting a repo — no eager forking on app install
- Fork kept permanently and reused across all write requests for that repo
- Merged/stale branches in the fork are pruned (auto-delete after PR merge)

### Gist patch mechanism
- Gists are a first-class output mode, not just a fallback
- Routing logic: explicit "patch" request → gist; explicit "PR" request → fork PR; simple single-file change → gist; complex or multi-file change → PR
- Gists can also be used for sharing logs, diagnostics, and other artifacts
- Gist format: unified diff (git diff output / .patch format)
- Gist visibility: secret (not publicly listed, accessible via URL)
- Gist link posted as a comment on the issue/PR that triggered the request

### Branch prevention enforcement
- Dual enforcement: code-level guard in workspace.ts + system prompt instructions to the agent
- Direct push attempts are silently redirected to the fork (not blocked with an error)
- No config escape hatch — fork-only mode is unconditional for all repos
- Existing kodiai/write-* and kodiai/slack/* branches in repos should be cleaned up

### PR creation from fork
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

</decisions>

<specifics>
## Specific Ideas

- "If someone asks for a patch, then do a gist for it. If someone asks for a PR, then open a PR. If it's complex or touches multiple files, do a PR. If it's a simple patch, then gist is fine. Feel free to also use gist to share logs/etc."
- Silent redirect pattern: the code should not throw errors when a direct push is attempted — it should transparently route to the fork instead

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/jobs/workspace.ts`: `createBranchCommitAndPush()`, `commitAndPushToRemoteRef()`, `pushHeadToRemoteRef()` — all need modification to route through fork
- `src/slack/write-runner.ts`: `createSlackWriteRunner()` with `buildDeterministicBranchName()` — branch naming logic needs updating for fork context
- `src/handlers/mention.ts`: Full write-mode flow for @mention — creates branches, PRs, handles errors
- `src/execution/config.ts`: `writeSchema` with enabled/allowPaths/denyPaths/secretScan — policy layer stays, push target changes
- `WritePolicyError` class — reusable for fork-related failures

### Established Patterns
- Write-mode is gated by `.kodiai.yml` `write.enabled` config
- Deterministic branch naming from request hash (workspace + channel + thread)
- In-memory rate limiting for write requests (lastWriteAt map)
- Idempotency markers in comments to prevent duplicate work
- Error classification with `isLikelyWritePermissionFailure()`

### Integration Points
- `workspace.ts` push functions are the single choke point for all git pushes — ideal place for fork redirect
- `mention.ts` write-mode flow (lines ~1160-2240) creates branches and PRs
- `write-runner.ts` Slack write flow creates branches and PRs
- GitHub App auth (`src/auth/github-app.ts`) — bot user PAT needs separate auth path from installation tokens
- GitHub REST API: `POST /repos/{owner}/{repo}/forks`, `POST /gists`, `DELETE /repos/{owner}/{repo}/git/refs/{ref}`

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 127-fork-based-write-mode-with-gist-patches*
*Context gathered: 2026-03-07*
